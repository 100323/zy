import cron from 'node-cron';
import {
  getEnabledTasks,
  updateTaskRunTime,
  markTaskRunTime,
  addTaskLog,
  ensureDefaultTaskConfigsForAllAccounts,
} from '../routes/tasks.js';
import { get } from '../database/index.js';
import { decrypt } from '../utils/crypto.js';
import GameClient from '../utils/gameClient.js';
import config from '../config/index.js';
import { findAnswer } from '../utils/studyQuestions.js';
import { parseTokenPayload } from '../utils/token.js';
import { calculateNextRunAt } from '../utils/cronSchedule.js';
import {
  executeArenaScheduledTask,
  executeMailClaimScheduledTask,
  executeDailyTaskClaimScheduledTask,
} from '../utils/scheduledTaskHelpers.js';
import {
  runAccountTaskExclusive,
  isAccountTaskRunning,
  registerAccountClient,
  unregisterAccountClient,
} from '../utils/accountTaskCoordinator.js';
import { getUserAvailabilityStatus } from '../utils/userAccess.js';
import {
  buildWsLogContext,
  normalizeDisconnectInfo,
  normalizeErrorMessage,
} from '../utils/wsDiagnostics.js';
import { warmupGameClient } from '../utils/wsWarmup.js';
import { getRefreshedTokenSessionFromStoredBin } from '../utils/accountTokenRefresh.js';

const activeConnections = new Map();
const scheduledJobs = new Map();
const connectionPromises = new Map();
const dailyRewardFlushState = new Map();
const DAILY_REWARD_FLUSH_DELAY_MS = 15000;
const DAILY_REWARD_RETRY_DELAY_MS = 30000;
const DAILY_REWARD_MAX_RETRIES = 3;
const DAILY_POINT_TASK_ID_MAP = {
  SIGN_IN: [1],
  HANGUP_ADD_TIME: [2],
  FRIEND_GOLD: [3],
  RECRUIT: [4],
  HANGUP_CLAIM: [5],
  BUY_GOLD: [6],
  BOX_OPEN: [7],
  ARENA: [8],
  BOTTLE_RESET: [9],
  BOTTLE_CLAIM: [9],
  BLACK_MARKET: [12],
};

const DAILY_REWARD_DIRTY_TASKS = new Set([
  'SIGN_IN',
  'FRIEND_GOLD',
  'RECRUIT',
  'BUY_GOLD',
  'BOX_OPEN',
  'ARENA',
  'BOTTLE_CLAIM',
  'BLACK_MARKET'
]);

function buildWsTokenPayload(token) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return '';

  const now = Date.now();
  const sessId = now * 100 + Math.floor(Math.random() * 100);
  const connId = now + Math.floor(Math.random() * 10);

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.roleToken) {
      return JSON.stringify({
        ...parsed,
        sessId,
        connId,
        isRestore: 0,
        version: parsed.version || config.game.clientVersion,
      });
    }
  } catch {
    // ignore
  }

  return JSON.stringify({
    roleToken: raw,
    sessId,
    connId,
    isRestore: 0,
    version: config.game.clientVersion,
  });
}

function resolveWsUrl(wsUrl, token) {
  const raw = typeof wsUrl === 'string' ? wsUrl.trim() : '';
  const payload = buildWsTokenPayload(token);
  if (!raw) {
    return `${config.game.wsUrl}?p=${encodeURIComponent(payload)}&e=x&lang=chinese`;
  }
  if (raw.includes('{token}')) {
    return raw.replace(/\{token\}/g, encodeURIComponent(payload));
  }
  try {
    const url = new URL(raw);
    url.searchParams.set('p', payload);
    if (!url.searchParams.has('e')) url.searchParams.set('e', 'x');
    if (!url.searchParams.has('lang')) url.searchParams.set('lang', 'chinese');
    return url.toString();
  } catch {
    // 继续走兼容拼接
  }
  if (raw.includes('p=')) {
    return raw.replace(/([?&])p=[^&]*/i, `$1p=${encodeURIComponent(payload)}`);
  }
  const sep = raw.includes('?') ? '&' : '?';
  return `${raw}${sep}p=${encodeURIComponent(payload)}&e=x&lang=chinese`;
}

function shouldIgnoreFailure(error) {
  const message = String(error?.message || '');
  return message.includes('模块未开启');
}

function isRetryableWsError(error) {
  const message = String(error?.message || error || '');
  return message.includes('WebSocket未连接') || message.includes('WebSocket连接已断开');
}

function discardInactiveClient(accountId, accountName, client, reason) {
  console.warn('🧹 丢弃不可复用的定时任务连接', {
    accountId,
    accountName,
    reason,
    connection: client?.getConnectionStateSummary?.() || null,
  });
  activeConnections.delete(accountId);
  unregisterAccountClient(accountId, client);
  try {
    client?.disconnect?.();
  } catch {
    // ignore
  }
}

async function reconnectCurrentClient(client, label = '任务') {
  const accountId = Number(client?.accountId);
  const accountName = client?.accountName || null;

  try {
    client.disconnect();
  } catch {
    // ignore
  }

  if (Number.isFinite(accountId) && accountId > 0) {
    activeConnections.delete(accountId);
    unregisterAccountClient(accountId, client);
  }

  const connectAndWarmup = async () => {
    await client.connect();
    if (!client.isSocketOpen()) {
      throw new Error('WebSocket未连接');
    }

    if (Number.isFinite(accountId) && accountId > 0) {
      activeConnections.set(accountId, client);
      registerAccountClient(accountId, client);
    }

    const warmup = await warmupGameClient(client, {
      roleInfoTimeout: 8000,
      includeRoleId: false,
    });
    console.log(`🔥 ${label}重连预热完成`, {
      accountId: accountId || null,
      accountName,
      handshake: client.lastConnectMeta || null,
      warmup,
    });

    if (!client.isSocketOpen()) {
      throw new Error('WebSocket未连接');
    }

    return client;
  };

  try {
    return await connectAndWarmup();
  } catch (error) {
    if (Number.isFinite(accountId) && accountId > 0) {
      activeConnections.delete(accountId);
      unregisterAccountClient(accountId, client);
    }

    console.warn(`⚠️ ${label}重连失败，尝试通过后端持久化BIN刷新Token`, {
      accountId: accountId || null,
      accountName,
      error: normalizeErrorMessage(error),
      handshake: client?.lastConnectMeta || null,
    });

    if (!Number.isFinite(accountId) || accountId <= 0) {
      throw error;
    }

    const refreshed = await getRefreshedTokenSessionFromStoredBin(accountId, {
      trigger: 'scheduler-reconnect',
      currentWsUrl: client?.wsUrl || '',
    });

    if (!refreshed?.refreshed || !refreshed?.candidates?.length) {
      throw error;
    }

    const refreshedToken = refreshed.tokenMeta?.token || refreshed.token;
    client.token = refreshedToken;
    client.roleId = refreshed.roleId || client.roleId || null;
    client.wsUrl = resolveWsUrl(refreshed.wsUrl || client.wsUrl || '', refreshedToken);

    console.log(`♻️ ${label}已切换为后端BIN刷新后的Token重连`, {
      accountId,
      accountName,
      roleId: client.roleId ?? null,
      handshake: client?.lastConnectMeta || null,
    });

    try {
      client.disconnect();
    } catch {
      // ignore
    }

    return await connectAndWarmup();
  }
}

async function recruitWithReconnect(client, recruitType, mode, maxReconnectRetries = 1) {
  let attempt = 0;

  while (attempt <= maxReconnectRetries) {
    try {
      const result = await client.recruitHero(recruitType);
      return { ok: true, mode, recruitType, result, retried: attempt };
    } catch (error) {
      const message = String(error?.message || `${mode}招募失败`);
      if (!isRetryableWsError(message) || attempt >= maxReconnectRetries) {
        return { ok: false, mode, recruitType, error: message, retried: attempt };
      }

      attempt += 1;
      console.warn(`🔁 ${mode}招募遇到连接断开，准备重连后重试 (${attempt}/${maxReconnectRetries})`);
      await reconnectCurrentClient(client, `${mode}招募`);
    }
  }

  return { ok: false, mode, recruitType, error: `${mode}招募失败`, retried: maxReconnectRetries };
}

export async function initScheduler() {
  console.log('🕐 初始化定时任务调度器...');

  const seedResult = ensureDefaultTaskConfigsForAllAccounts();
  if (seedResult.created > 0) {
    console.log('🧩 已为现有账号补齐默认定时任务配置', {
      accountCount: seedResult.accountCount,
      createdTaskConfigCount: seedResult.created,
      accounts: seedResult.details,
    });
  }
  
  const tasks = getEnabledTasks();
  console.log(`📋 找到 ${tasks.length} 个启用的任务`);

  for (const task of tasks) {
    scheduleTask(task);
  }

  cron.schedule('* * * * *', async () => {
    await checkAndRunDueTasks();
  }, {
    timezone: config.cron.timezone
  });

  console.log('✅ 定时任务调度器初始化完成');
}

export function scheduleTask(task) {
  const jobKey = `${task.account_id}_${task.task_type}`;
  
  if (scheduledJobs.has(jobKey)) {
    const existing = scheduledJobs.get(jobKey);
    existing.job.stop();
    scheduledJobs.delete(jobKey);
  }

  if (!task.enabled) {
    return;
  }

  try {
    const cronExpression = task.cron_expression;
    const job = cron.schedule(cronExpression, async () => {
      try {
        await executeTask(task);
      } finally {
        updateTaskRunTime(task.id, calculateNextRunAt(cronExpression));
      }
    }, {
      timezone: config.cron.timezone
    });

    scheduledJobs.set(jobKey, {
      job,
      cronExpression
    });
    
    updateTaskRunTime(task.id, calculateNextRunAt(cronExpression));
    
    console.log(`📅 已调度任务: ${task.account_name} - ${task.task_type} (${task.cron_expression})`);
  } catch (error) {
    console.error(`❌ 调度任务失败: ${task.account_name} - ${task.task_type}:`, error.message);
  }
}

export async function checkAndRunDueTasks() {
  const tasks = getEnabledTasks();
  const enabledTaskMap = new Map(
    tasks.map(task => [`${task.account_id}_${task.task_type}`, task])
  );

  for (const [jobKey, scheduled] of scheduledJobs) {
    const task = enabledTaskMap.get(jobKey);
    if (!task) {
      scheduled.job.stop();
      scheduledJobs.delete(jobKey);
      continue;
    }

    if (scheduled.cronExpression !== task.cron_expression) {
      scheduleTask(task);
    }
  }

  for (const [jobKey, task] of enabledTaskMap) {
    if (!scheduledJobs.has(jobKey)) {
      scheduleTask(task);
    }
  }
}

export async function executeTask(task) {
  const accountId = task.account_id ?? task.id;
  const {
    task_type,
    name,
    token_encrypted,
    token_iv,
    config_json,
    token,
    account_name: accountNameFromTask,
    ws_url,
    account_import_method,
    account_updated_at,
  } = task;
  const accountName = accountNameFromTask || name || `账号${accountId ?? '未知'}`;

  if (!accountId) {
    throw new Error('缺少账号ID，无法执行任务');
  }

  return runAccountTaskExclusive(accountId, async () => {
    console.log(`🚀 开始执行任务: ${accountName} - ${task_type}`);

    try {
      const user = get(
        'SELECT id, username, role, is_enabled, access_start_at, access_end_at FROM users WHERE id = ?',
        [task.user_id]
      );
      const userStatus = getUserAvailabilityStatus(user);
      if (!userStatus.allowed) {
        throw new Error(`所属用户不可用，任务已停止：${userStatus.reason}`);
      }

      const rawToken = token || decrypt(token_encrypted, token_iv);
      const tokenMeta = parseTokenPayload(rawToken);
      const tokenCandidates = tokenMeta.candidates?.length
        ? tokenMeta.candidates
        : [tokenMeta.token].filter(Boolean);
      if (tokenCandidates.length === 0) {
        throw new Error('账号Token无效，无法建立WebSocket连接');
      }
      const taskWsUrl = ws_url || tokenMeta.wsUrl || '';
      const taskConfig = config_json ? JSON.parse(config_json) : {};
      let client = await ensureConnectedClient(accountId, accountName, tokenCandidates, tokenMeta.roleId, taskWsUrl, {
        importMethod: account_import_method || null,
        updatedAt: account_updated_at || null,
      });
      let result;
      try {
        result = await runTaskByType(client, task_type, taskConfig);
      } catch (error) {
        if (isRetryableWsError(error)) {
          console.warn(`🔁 检测到连接已断开，重连后重试: ${accountName} - ${task_type}`);
          forceDisconnectClient(accountId);
          client = await ensureConnectedClient(accountId, accountName, tokenCandidates, tokenMeta.roleId, taskWsUrl, {
            importMethod: account_import_method || null,
            updatedAt: account_updated_at || null,
          });
          result = await runTaskByType(client, task_type, taskConfig);
        } else {
          throw error;
        }
      }

      await claimDailyPointRewardsByTask(client, task_type, taskConfig);
      updateDailyRewardFlushAfterTask(accountId, {
        taskType: task_type,
        accountName,
        tokenCandidates,
        roleId: tokenMeta.roleId,
        wsUrl: taskWsUrl,
        importMethod: account_import_method || null,
        updatedAt: account_updated_at || null,
      });

      addTaskLog(accountId, task_type, 'success', result.message || '执行成功', JSON.stringify(result.data || {}));
      if (task.id) {
        markTaskRunTime(task.id, new Date().toISOString(), calculateNextRunAt(task.cron_expression));
      }
      console.log(`✅ 任务执行成功: ${accountName} - ${task_type}`);

      return result;
    } catch (error) {
      console.error(`❌ 任务执行失败: ${accountName} - ${task_type}:`, error.message);
      addTaskLog(
        accountId,
        task_type,
        shouldIgnoreFailure(error) ? 'ignored' : 'error',
        error.message,
        error?.details ? JSON.stringify(error.details) : null
      );
      if (task.id) {
        markTaskRunTime(task.id, new Date().toISOString(), calculateNextRunAt(task.cron_expression));
      }
      throw error;
    }
  });
}

async function claimDailyPointRewardsByTask(client, taskType, taskConfig = {}) {
  const configTaskIds = Array.isArray(taskConfig?.dailyPointTaskIds)
    ? taskConfig.dailyPointTaskIds
    : (typeof taskConfig?.dailyPointTaskIds === 'string'
      ? taskConfig.dailyPointTaskIds.split(',').map((v) => Number(v.trim()))
      : []);
  const mappedIds = DAILY_POINT_TASK_ID_MAP[taskType] || [];
  const taskIds = [...new Set([...mappedIds, ...configTaskIds])]
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);

  for (const taskId of taskIds) {
    try {
      await client.claimDailyPoint(taskId);
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch {
      // 忽略“已领取/未达成”等错误，不影响主任务结果
    }
  }
}

function ensureDailyRewardFlushEntry(accountId) {
  const todayKey = getDateKey();
  if (!dailyRewardFlushState.has(accountId)) {
    dailyRewardFlushState.set(accountId, {
      dirty: false,
      timer: null,
      flushingPromise: null,
      retryCount: 0,
      dateKey: todayKey,
      accountName: `账号${accountId}`,
      tokenCandidates: [],
      roleId: null,
      wsUrl: '',
      importMethod: null,
      updatedAt: null,
    });
  }

  const entry = dailyRewardFlushState.get(accountId);
  if (entry.dateKey !== todayKey) {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.dirty = false;
    entry.timer = null;
    entry.flushingPromise = null;
    entry.retryCount = 0;
    entry.dateKey = todayKey;
  }
  return entry;
}

function updateDailyRewardFlushAfterTask(accountId, context = {}) {
  const entry = ensureDailyRewardFlushEntry(accountId);
  entry.accountName = context.accountName || entry.accountName;
  entry.tokenCandidates = Array.isArray(context.tokenCandidates) ? [...context.tokenCandidates] : entry.tokenCandidates;
  entry.roleId = context.roleId ?? entry.roleId;
  entry.wsUrl = typeof context.wsUrl === 'string' ? context.wsUrl : entry.wsUrl;
  entry.importMethod = context.importMethod ?? entry.importMethod;
  entry.updatedAt = context.updatedAt ?? entry.updatedAt;
  entry.retryCount = 0;

  if (context.taskType === 'DAILY_TASK_CLAIM') {
    clearDailyRewardFlush(accountId);
    return;
  }

  if (!DAILY_REWARD_DIRTY_TASKS.has(context.taskType)) {
    return;
  }

  entry.dirty = true;
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  entry.timer = setTimeout(() => {
    void flushDailyRewardClaim(accountId, 'debounced');
  }, DAILY_REWARD_FLUSH_DELAY_MS);
}

function clearDailyRewardFlush(accountId) {
  const entry = ensureDailyRewardFlushEntry(accountId);
  entry.dirty = false;
  entry.retryCount = 0;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

async function flushDailyRewardClaim(accountId, reason = 'debounced') {
  const entry = ensureDailyRewardFlushEntry(accountId);
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  if (!entry.dirty) {
    return false;
  }

  if (isAccountTaskRunning(accountId)) {
    entry.timer = setTimeout(() => {
      void flushDailyRewardClaim(accountId, reason);
    }, 5000);
    return false;
  }

  if (entry.flushingPromise) {
    return await entry.flushingPromise;
  }

  const flushContext = {
    accountName: entry.accountName,
    tokenCandidates: Array.isArray(entry.tokenCandidates) ? [...entry.tokenCandidates] : [],
    roleId: entry.roleId,
    wsUrl: entry.wsUrl || '',
    importMethod: entry.importMethod || null,
    updatedAt: entry.updatedAt || null,
  };

  entry.flushingPromise = runAccountTaskExclusive(accountId, async () => {
    try {
      if (!entry.dirty) {
        return false;
      }
      if (!flushContext.tokenCandidates.length) {
        return false;
      }

      console.log(`🎁 开始自动收尾补领: ${flushContext.accountName} (${reason})`);
      let client = await ensureConnectedClient(
        accountId,
        flushContext.accountName,
        flushContext.tokenCandidates,
        flushContext.roleId,
        flushContext.wsUrl,
        {
          importMethod: flushContext.importMethod,
          updatedAt: flushContext.updatedAt,
        }
      );
      let result;
      try {
        result = await executeDailyTaskClaim(client, {});
      } catch (error) {
        if (isRetryableWsError(error)) {
          console.warn(`🔁 自动补领检测到连接断开，重连后重试: ${flushContext.accountName}`);
          forceDisconnectClient(accountId);
          client = await ensureConnectedClient(
            accountId,
            flushContext.accountName,
            flushContext.tokenCandidates,
            flushContext.roleId,
            flushContext.wsUrl,
            {
              importMethod: flushContext.importMethod,
              updatedAt: flushContext.updatedAt,
            }
          );
          result = await executeDailyTaskClaim(client, {});
        } else {
          throw error;
        }
      }

      entry.dirty = false;
      entry.retryCount = 0;
      const claimedCount = Number(result?.data?.claimedCount || 0);
      const flushMessage = claimedCount > 0
        ? `自动收尾补领完成: ${result.message || '每日任务奖励领取完成'}`
        : `自动收尾检查完成: ${result.message || '没有可领取的每日任务奖励'}`;
      addTaskLog(
        accountId,
        'DAILY_TASK_CLAIM',
        'success',
        flushMessage,
        JSON.stringify({
          autoFlush: true,
          reason,
          ...(result.data || {})
        })
      );
      console.log(`✅ ${flushMessage}: ${flushContext.accountName}`);
      return true;
    } catch (error) {
      entry.dirty = true;
      console.error(`❌ 自动收尾补领失败: ${flushContext.accountName}:`, error.message);
      addTaskLog(
        accountId,
        'DAILY_TASK_CLAIM',
        'error',
        `自动收尾补领失败: ${error.message}`,
        error?.details ? JSON.stringify({
          autoFlush: true,
          reason,
          ...(error.details || {}),
        }) : null
      );
      if (entry.retryCount < DAILY_REWARD_MAX_RETRIES && !entry.timer) {
        entry.retryCount += 1;
        entry.timer = setTimeout(() => {
          void flushDailyRewardClaim(accountId, 'retry');
        }, DAILY_REWARD_RETRY_DELAY_MS);
      } else if (entry.retryCount >= DAILY_REWARD_MAX_RETRIES) {
        entry.dirty = false;
        entry.retryCount = 0;
        addTaskLog(accountId, 'DAILY_TASK_CLAIM', 'ignored', '自动收尾补领已停止重试，等待下次任务重新触发');
      }
      return false;
    } finally {
      entry.flushingPromise = null;
    }
  });

  return await entry.flushingPromise;
}

function getDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function forceDisconnectClient(accountId) {
  const client = activeConnections.get(accountId);
  if (!client) return;
  console.warn('🧹 强制断开旧WebSocket连接', {
    accountId,
    accountName: client.accountName || null,
    connected: !!client.isSocketOpen?.(),
    connection: client.getConnectionStateSummary?.() || null,
  });
  try {
    client.disconnect();
  } catch (error) {
    console.warn(`⚠️ 断开旧连接失败: 账号${accountId}`, error.message);
  } finally {
    activeConnections.delete(accountId);
    unregisterAccountClient(accountId, client);
  }
}

async function ensureConnectedClient(accountId, accountName, tokenCandidates, roleId = null, wsUrl = '', extraContext = {}) {
  const existing = activeConnections.get(accountId);
  if (existing?.isSocketOpen?.()) {
    console.log('♻️ 复用已有WebSocket连接', {
      accountId,
      accountName,
      roleId: roleId ?? null,
      importMethod: extraContext.importMethod || null,
      updatedAt: extraContext.updatedAt || null,
      connection: existing.getConnectionStateSummary?.() || null,
    });
    return existing;
  }
  if (existing) {
    discardInactiveClient(accountId, accountName, existing, 'readyState 非 OPEN 或 connected 标记失效');
  }

  if (connectionPromises.has(accountId)) {
    return await connectionPromises.get(accountId);
  }

  const connectPromise = (async () => {
    const maxRetries = 3;
    let lastError = null;
    let currentCandidates = Array.isArray(tokenCandidates) ? [...tokenCandidates] : [];
    let currentRoleId = roleId;
    let currentWsUrl = wsUrl;
    let refreshedByBin = false;

    for (let refreshRound = 0; refreshRound <= 1; refreshRound += 1) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        for (const [candidateIndex, token] of currentCandidates.entries()) {
          const resolvedWsUrl = resolveWsUrl(currentWsUrl, token);
          const client = new GameClient(token, { roleId: currentRoleId, wsUrl: resolvedWsUrl });
          client.accountId = accountId;
          client.accountName = accountName;
          let disconnectInfo = null;
          let wsErrorMessage = null;
          let unexpectedResponse = null;
          const logContext = buildWsLogContext({
            accountId,
            accountName,
            roleId: currentRoleId,
            importMethod: extraContext.importMethod || null,
            updatedAt: extraContext.updatedAt || null,
            attempt,
            maxRetries,
            candidateIndex: candidateIndex + 1,
            candidateCount: currentCandidates.length,
            token,
            wsUrl: resolvedWsUrl,
            extra: {
              refreshedByBin,
            },
          });

          client.onDisconnect = (code, reason, meta) => {
            disconnectInfo = { code, reason };
            console.warn('🔌 定时任务连接断开', {
              ...logContext,
              disconnect: normalizeDisconnectInfo(disconnectInfo),
              handshake: meta || client.lastConnectMeta || null,
            });
            activeConnections.delete(accountId);
            unregisterAccountClient(accountId, client);
          };

          client.onError = (error, meta) => {
            wsErrorMessage = normalizeErrorMessage(error);
            console.error('❌ 定时任务连接错误', {
              ...logContext,
              error: wsErrorMessage,
              handshake: meta || client.lastConnectMeta || null,
            });
            activeConnections.delete(accountId);
            unregisterAccountClient(accountId, client);
          };

          client.onUnexpectedResponse = (details, meta) => {
            unexpectedResponse = details;
            console.error('🚫 定时任务握手异常响应', {
              ...logContext,
              unexpectedResponse: details,
              handshake: meta || client.lastConnectMeta || null,
            });
          };

          try {
            console.log('🔄 尝试建立定时任务WebSocket连接', logContext);
            await client.connect();
            if (!client.isSocketOpen()) {
              throw new Error('WebSocket未连接');
            }
            activeConnections.set(accountId, client);
            registerAccountClient(accountId, client);
            console.log('✅ 定时任务WebSocket连接成功', {
              ...logContext,
              handshake: client.lastConnectMeta || null,
            });
            const warmup = await warmupGameClient(client, {
              roleInfoTimeout: 8000,
              includeRoleId: false,
            });
            console.log('🔥 定时任务连接预热完成', {
              ...logContext,
              handshake: client.lastConnectMeta || null,
              warmup,
            });
            if (!client.isSocketOpen()) {
              throw new Error('WebSocket未连接');
            }
            return client;
          } catch (error) {
            lastError = error;
            console.warn('⚠️ 定时任务候选Token连接失败', {
              ...logContext,
              error: normalizeErrorMessage(error),
              disconnect: normalizeDisconnectInfo(disconnectInfo),
              wsError: wsErrorMessage || null,
              unexpectedResponse,
              handshake: client.lastConnectMeta || null,
            });
            client.disconnect();
            activeConnections.delete(accountId);
            unregisterAccountClient(accountId, client);
          }
        }

        console.error('⚠️ 定时任务连接批次失败', {
          accountId,
          accountName,
          roleId: currentRoleId ?? null,
          importMethod: extraContext.importMethod || null,
          updatedAt: extraContext.updatedAt || null,
          attempt,
          maxRetries,
          refreshedByBin,
          error: normalizeErrorMessage(lastError),
        });
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }

      if (refreshedByBin) {
        break;
      }

      try {
        const refreshed = await getRefreshedTokenSessionFromStoredBin(accountId, {
          trigger: 'scheduler-connect',
          currentWsUrl,
        });
        if (refreshed?.refreshed && refreshed?.candidates?.length) {
          currentCandidates = refreshed.candidates;
          currentRoleId = refreshed.roleId || currentRoleId;
          currentWsUrl = refreshed.wsUrl || currentWsUrl || '';
          refreshedByBin = true;
          console.log('♻️ 定时任务连接已切换为后端BIN刷新后的Token重试', {
            accountId,
            accountName,
            roleId: currentRoleId ?? null,
            importMethod: extraContext.importMethod || null,
            updatedAt: extraContext.updatedAt || null,
            candidateCount: currentCandidates.length,
          });
          continue;
        }
      } catch (error) {
        console.warn('⚠️ 定时任务连接通过持久化BIN刷新Token失败', {
          accountId,
          accountName,
          error: normalizeErrorMessage(error),
        });
      }
      break;
    }

    throw new Error(lastError?.message || 'WebSocket连接失败');
  })();

  connectionPromises.set(accountId, connectPromise);
  try {
    return await connectPromise;
  } finally {
    connectionPromises.delete(accountId);
  }
}

async function runTaskByType(client, taskType, config) {
  switch (taskType) {
    case 'SIGN_IN':
      return await executeSignIn(client);
    
    case 'LEGION_SIGN':
      return await executeLegionSignIn(client);
    
    case 'ARENA':
      return await executeArena(client, config);
    
    case 'TOWER':
      return await executeTower(client, config);
    
    case 'BOSS_TOWER':
      return await executeBossTower(client, config);
    
    case 'WEIRD_TOWER':
      return await executeWeirdTower(client, config);

    case 'WEIRD_TOWER_FREE_ITEM':
      return await executeWeirdTowerFreeItem(client, config);

    case 'WEIRD_TOWER_USE_ITEM':
      return await executeWeirdTowerUseItem(client, config);

    case 'WEIRD_TOWER_MERGE_ITEM':
      return await executeWeirdTowerMergeItem(client, config);
    
    case 'LEGION_BOSS':
      return await executeLegionBoss(client, config);
    
    case 'RECRUIT':
      return await executeRecruit(client, config);

    case 'FRIEND_GOLD':
      return await executeFriendGold(client, config);

    case 'BUY_GOLD':
      return await executeBuyGold(client, config);
    
    case 'FISHING':
      return await executeFishing(client, config);
    
    case 'MAIL_CLAIM':
      return await executeMailClaim(client);
    
    case 'HANGUP_CLAIM':
      return await executeHangupClaim(client, config);
    
    case 'STUDY':
      return await executeStudy(client, config);
    
    case 'HANGUP_ADD_TIME':
      return await executeHangupAddTime(client, config);
    
    case 'BOTTLE_RESET':
      return await executeBottleReset(client, config);
    
    case 'BOTTLE_CLAIM':
      return await executeBottleClaim(client, config);
    
    case 'CAR_SEND':
      return await executeCarSend(client, config);
    
    case 'CAR_CLAIM':
      return await executeCarClaim(client, config);
    
    case 'BLACK_MARKET':
      return await executeBlackMarket(client, config);
    
    case 'TREASURE_CLAIM':
      return await executeTreasureClaim(client, config);
    
    case 'LEGACY_CLAIM':
      return await executeLegacyClaim(client, config);
    
    case 'WELFARE_CLAIM':
      return await executeWelfareClaim(client, config);
    
    case 'DAILY_TASK_CLAIM':
      return await executeDailyTaskClaim(client, config);
    
    case 'DAILY_BOSS':
      return await executeDailyBoss(client, config);
    
    case 'DREAM':
      return await executeDream(client, config);
    
    case 'SKIN_CHALLENGE':
      return await executeSkinChallenge(client, config);
    
    case 'PEACH_TASK':
      return await executePeachTask(client, config);
    
    case 'BOX_OPEN':
      return await executeBoxOpen(client, config);

    case 'LEGION_STORE_FRAGMENT':
      return await executeLegionStoreFragment(client, config);
    
    case 'GENIE_SWEEP':
      return await executeGenieSweep(client, config);
    
    case 'DREAM_PURCHASE':
      return await executeDreamPurchase(client, config);

    default:
      throw new Error(`未知任务类型: ${taskType}`);
  }
}

async function executeSignIn(client) {
  try {
    const result = await client.signIn();
    return { message: '每日签到成功', data: result };
  } catch (error) {
    if (error.message.includes('已经签到')) {
      return { message: '今日已签到', data: {} };
    }
    throw error;
  }
}

async function executeLegionSignIn(client) {
  try {
    const result = await client.legionSignIn();
    return { message: '军团签到成功', data: result };
  } catch (error) {
    if (error.message.includes('未加入俱乐部')) {
      return { message: '未加入军团，跳过签到', data: {} };
    }
    throw error;
  }
}

async function executeArena(client, config) {
  return executeArenaScheduledTask(client, config);
}

async function executeTower(client, config) {
  const { maxFloors = 10 } = config;
  const results = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  await client.ensureBattleVersion();

  const claimPendingTowerReward = async () => {
    let rewardFloor = 0;
    try {
      const roleInfo = await client.getRoleInfo(8000);
      const towerId = Number(roleInfo?.role?.tower?.id || 0);
      rewardFloor = Math.floor(towerId / 10);
    } catch {
      // 忽略角色信息刷新失败
    }

    if (rewardFloor <= 0) return false;
    await client.claimTowerReward(rewardFloor);
    return true;
  };
  
  for (let i = 0; i < maxFloors; i++) {
    try {
      const result = await client.startTowerFight();
      results.push(result);
      await sleep(500);
    } catch (error) {
      const message = String(error?.message || '');
      if (message.includes('已经全部通关') || message.includes('能量不足')) {
        break;
      }
      if (message.includes('上座塔的奖励未领取')) {
        try {
          const claimed = await claimPendingTowerReward();
          if (claimed) {
            results.push({ info: '已自动领取爬塔奖励，继续挑战' });
            await sleep(600);
            continue;
          }
          results.push({ error: '上座塔的奖励未领取，且自动领取失败' });
        } catch (claimError) {
          results.push({ error: `上座塔的奖励未领取，自动领取失败: ${claimError.message}` });
        }
        continue;
      }
      results.push({ error: message || '未知错误' });
    }
  }

  const successCount = results.filter(item => !item?.error).length;
  if (successCount === 0 && results.length > 0) {
    const firstError = results.find(item => item?.error)?.error || '未知错误';
    throw new Error(`爬塔执行失败: ${firstError}`);
  }

  return { message: `爬塔完成 (${successCount}层)`, data: { results, successCount } };
}

async function executeBossTower(client, config) {
  await client.ensureBattleVersion();
  try {
    const result = await client.startBossFight();
    return { message: '咸王宝库挑战成功', data: result };
  } catch (error) {
    if (error.message.includes('次数')) {
      return { message: '今日挑战次数已用完', data: {} };
    }
    throw error;
  }
}

async function executeWeirdTower(client, config) {
  const results = [];
  let successCount = 0;
  const maxFloors = Math.min(100, Math.max(1, Number(config?.weirdTowerMaxFloors ?? 100) || 100));
  
  // 获取怪异塔信息
  let towerInfo;
  try {
    towerInfo = await client.sendWithPromise('evotower_getinfo', {}, 8000);
  } catch (error) {
    return { message: `获取怪异塔信息失败: ${error.message}`, data: { results: [], successCount: 0 } };
  }
  
  let currentEnergy = towerInfo?.evoTower?.energy || 0;
  if (currentEnergy <= 0) {
    return { message: '怪异塔能量不足', data: { results: [], successCount: 0, energy: 0 } };
  }
  
  let count = 0;
  let consecutiveFailures = 0;
  
  while (currentEnergy > 0 && count < maxFloors) {
    try {
      // 准备战斗
      await client.sendWithPromise('evotower_readyfight', {}, 5000);
      
      // 战斗
      const fightResult = await client.sendWithPromise('evotower_fight', { 
        battleNum: 1, 
        winNum: 1 
      }, 10000);
      
      count++;
      successCount++;
      consecutiveFailures = 0;
      results.push({ floor: count, ok: true, result: fightResult });
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 获取最新信息
      const newInfo = await client.sendWithPromise('evotower_getinfo', {}, 5000);
      
      // 检查并领取每日任务奖励
      if (newInfo?.evoTower?.taskClaimMap) {
        const now = new Date();
        const year = now.getFullYear().toString().slice(2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const dateKey = `${year}${month}${day}`;
        const dailyTasks = newInfo.evoTower.taskClaimMap[dateKey] || {};
        
        for (const taskId of [1, 2, 3]) {
          if (!dailyTasks[taskId]) {
            try {
              await client.sendWithPromise('evotower_claimtask', { taskId }, 2000);
            } catch (e) {
              // 忽略领取失败
            }
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      }
      
      // 检查是否通关10层，领取通关奖励
      const towerId = newInfo?.evoTower?.towerId || 0;
      const floor = (towerId % 10) + 1;
      if (fightResult?.winList?.[0] === true && floor === 1) {
        try {
          await client.sendWithPromise('evotower_claimreward', {}, 5000);
        } catch (e) {
          // 忽略领取失败
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // 刷新能量
      currentEnergy = newInfo?.evoTower?.energy || 0;
      
    } catch (error) {
      consecutiveFailures++;
      results.push({ floor: count + 1, ok: false, error: error.message });
      
      if (consecutiveFailures >= 3) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return { 
    message: `怪异塔爬塔完成 (${successCount}/${count}次)`, 
    data: { results, successCount, totalFloors: count, maxFloors } 
  };
}

async function executeWeirdTowerFreeItem(client, config) {
  const info = await client.sendWithPromise('mergebox_getinfo', { actType: 1 }, 5000);
  const freeEnergy = Number(info?.mergeBox?.freeEnergy || 0) || 0;
  if (freeEnergy <= 0) {
    return { message: '暂无怪异塔免费道具可领取', data: { freeEnergy: 0 } };
  }

  const result = await client.sendWithPromise('mergebox_claimfreeenergy', { actType: 1 }, 5000);
  return { message: `怪异塔免费道具领取完成 (${freeEnergy}个)`, data: { freeEnergy, result } };
}

async function executeWeirdTowerUseItem(client, config) {
  const infoRes = await client.sendWithPromise('mergebox_getinfo', { actType: 1 }, 5000);
  const towerInfoRes = await client.sendWithPromise('evotower_getinfo', {}, 5000);

  if (!infoRes?.mergeBox) {
    throw new Error('获取怪异塔活动信息失败');
  }

  let costTotalCnt = Number(infoRes.mergeBox.costTotalCnt || 0) || 0;
  let lotteryLeftCnt = Number(towerInfoRes?.evoTower?.lotteryLeftCnt || 0) || 0;
  if (lotteryLeftCnt <= 0) {
    return { message: '没有剩余怪异塔道具可使用', data: { processedCount: 0 } };
  }

  let processedCount = 0;
  while (lotteryLeftCnt > 0) {
    let pos = { gridX: 6, gridY: 3 };
    if (costTotalCnt < 2) {
      pos = { gridX: 4, gridY: 5 };
    } else if (costTotalCnt < 102) {
      pos = { gridX: 7, gridY: 3 };
    }

    await client.sendWithPromise('mergebox_openbox', { actType: 1, pos }, 5000);
    costTotalCnt += 1;
    lotteryLeftCnt -= 1;
    processedCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  await client.sendWithPromise('mergebox_claimcostprogress', { actType: 1 }, 5000).catch(() => null);
  return { message: `使用怪异塔道具完成 (${processedCount}次)`, data: { processedCount } };
}

async function executeWeirdTowerMergeItem(client, config) {
  let mergedCount = 0;
  let claimedRewardCount = 0;
  const MAX_LOOPS = 20;

  for (let loopCount = 0; loopCount < MAX_LOOPS; loopCount += 1) {
    const infoRes = await client.sendWithPromise('mergebox_getinfo', { actType: 1 }, 5000);
    if (!infoRes?.mergeBox) {
      throw new Error('获取怪异塔合成信息失败');
    }

    if (infoRes.mergeBox.taskMap) {
      const taskMap = infoRes.mergeBox.taskMap;
      const taskClaimMap = infoRes.mergeBox.taskClaimMap || {};
      for (const taskId of Object.keys(taskMap)) {
        if (taskMap[taskId] !== 0 && !taskClaimMap[taskId]) {
          const claimed = await client.sendWithPromise(
            'mergebox_claimmergeprogress',
            { actType: 1, taskId: Number(taskId) },
            2000,
          ).catch(() => null);
          if (claimed) {
            claimedRewardCount += 1;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    }

    const gridMap = infoRes.mergeBox.gridMap || {};
    const groupedItems = {};
    for (const xStr of Object.keys(gridMap)) {
      for (const yStr of Object.keys(gridMap[xStr] || {})) {
        const item = gridMap[xStr][yStr];
        if (item?.gridConfId == 0 && item?.gridItemId > 0 && !item?.isLock) {
          const key = String(item.gridItemId);
          if (!groupedItems[key]) {
            groupedItems[key] = [];
          }
          groupedItems[key].push({ x: Number(xStr), y: Number(yStr) });
        }
      }
    }

    const hasPotentialMerge = Object.values(groupedItems).some((group) => Array.isArray(group) && group.length >= 2);
    if (!hasPotentialMerge) {
      if (mergedCount === 0 && claimedRewardCount === 0) {
        return { message: '当前没有可合成的怪异塔物品', data: { mergedCount: 0, claimedRewardCount: 0 } };
      }
      return { message: `怪异塔合成完成 (${mergedCount}次合成, ${claimedRewardCount}次领奖)`, data: { mergedCount, claimedRewardCount } };
    }

    const isLevel8OrAbove = Boolean(infoRes.mergeBox.taskMap?.['251212208']);
    if (isLevel8OrAbove) {
      await client.sendWithPromise('mergebox_automergeitem', { actType: 1 }, 10000);
      mergedCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 800));
      continue;
    }

    let loopMerged = 0;
    for (const group of Object.values(groupedItems)) {
      while (Array.isArray(group) && group.length >= 2) {
        const source = group.shift();
        const target = group.shift();
        await client.sendWithPromise(
          'mergebox_mergeitem',
          {
            actType: 1,
            sourcePos: { gridX: source.x, gridY: source.y },
            targetPos: { gridX: target.x, gridY: target.y },
          },
          1000,
        ).catch(() => null);
        loopMerged += 1;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (loopMerged === 0) {
      break;
    }
    mergedCount += loopMerged;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return { message: `怪异塔合成完成 (${mergedCount}次合成, ${claimedRewardCount}次领奖)`, data: { mergedCount, claimedRewardCount } };
}

async function executeLegionBoss(client, config) {
  await client.ensureBattleVersion();
  const bossTimes = Math.max(1, Number(config?.bossTimes ?? 2) || 2);
  const bossFormation = Number(config?.bossFormation ?? 1) || 1;
  const results = [];
  let successCount = 0;
  let switchedFormation = false;
  let originalFormation = null;

  try {
    const teamInfo = await client.getPresetTeamInfo();
    originalFormation = teamInfo?.presetTeamInfo?.useTeamId;
    console.log(`[军团BOSS] 当前阵容: ${originalFormation}, 目标阵容: ${bossFormation}`);
    
    if (originalFormation !== bossFormation) {
      console.log(`[军团BOSS] 切换阵容 ${originalFormation} -> ${bossFormation}`);
      await client.savePresetTeam(bossFormation);
      switchedFormation = true;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.warn(`[军团BOSS] 阵容切换失败，使用当前阵容: ${error.message}`);
  }
  
  for (let i = 0; i < bossTimes; i++) {
    try {
      const result = await client.startLegionBossFight();
      results.push({ round: i + 1, ok: true, result });
      successCount++;
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      if (error.message.includes('次数') || error.message.includes('未加入')) {
        results.push({ round: i + 1, ok: false, error: error.message, stop: true });
        break;
      }
      results.push({ round: i + 1, ok: false, error: error.message });
    }
  }

  if (switchedFormation && originalFormation) {
    try {
      console.log(`[军团BOSS] 恢复原阵容: ${bossFormation} -> ${originalFormation}`);
      await client.savePresetTeam(originalFormation);
    } catch (error) {
      console.warn(`[军团BOSS] 恢复原阵容失败: ${error.message}`);
    }
  }
  
  return { 
    message: `军团BOSS挑战完成 (${successCount}/${bossTimes}次)`, 
    data: { results, successCount, bossTimes, bossFormation } 
  };
}

async function executeRecruit(client, config) {
  const results = [];
  const maxReconnectRetries = Math.max(0, Number(config?.reconnectRetries ?? 1) || 0);

  const hasNewSwitches = config?.useFreeRecruit !== undefined || config?.usePaidRecruit !== undefined;
  if (hasNewSwitches) {
    const useFreeRecruit = config?.useFreeRecruit !== false;
    const usePaidRecruit = config?.usePaidRecruit !== false;
    const freeRecruitCount = Math.max(1, Number(config?.freeRecruitCount ?? 1) || 1);
    const paidRecruitCount = Math.max(1, Number(config?.paidRecruitCount ?? 1) || 1);

    if (!useFreeRecruit && !usePaidRecruit) {
      return { message: '招募已关闭（免费/付费都未启用）', data: { results: [], successCount: 0, totalCount: 0 } };
    }

    if (useFreeRecruit) {
      for (let i = 0; i < freeRecruitCount; i++) {
        const result = await recruitWithReconnect(client, 3, 'free', maxReconnectRetries);
        results.push(result);
        if (!result.ok) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    if (usePaidRecruit) {
      for (let i = 0; i < paidRecruitCount; i++) {
        const result = await recruitWithReconnect(client, 1, 'paid', maxReconnectRetries);
        results.push(result);
        if (!result.ok) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  } else {
    // 兼容旧配置：按 recruitType/count 执行
    const recruitType = Number(config?.recruitType ?? 1) || 1;
    const count = Math.max(1, Number(config?.count ?? 2) || 2);
    for (let i = 0; i < count; i++) {
      const result = await recruitWithReconnect(client, recruitType, 'legacy', maxReconnectRetries);
      results.push(result);
      if (!result.ok) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  const successCount = results.filter((x) => x.ok).length;
  if (successCount === 0 && results.length > 0) {
    throw new Error(results[0].error || '招募失败');
  }
  return { message: `招募完成 (${successCount}/${results.length}次)`, data: { results, successCount, totalCount: results.length } };
}

async function executeFriendGold(client, config) {
  const count = Math.max(1, Number(config?.count || config?.friendGoldCount || 3));
  const results = [];
  for (let i = 0; i < count; i++) {
    try {
      const result = await client.sendFriendGold(0);
      results.push({ ok: true, result });
    } catch (error) {
      results.push({ ok: false, error: error.message });
      if (String(error.message || '').includes('次数') || String(error.message || '').includes('上限')) {
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const successCount = results.filter((x) => x.ok).length;
  if (successCount === 0 && results.length > 0) {
    throw new Error(results[0].error || '送好友金币失败');
  }
  return { message: `送好友金币完成 (${successCount}/${results.length})`, data: { results, successCount, count } };
}

async function executeBuyGold(client, config) {
  const buyNum = Math.max(1, Number(config?.buyNum || config?.buyGoldTimes || 3));
  const results = [];
  for (let i = 0; i < buyNum; i++) {
    try {
      const result = await client.buyGold(1);
      results.push({ ok: true, result });
    } catch (error) {
      results.push({ ok: false, error: error.message });
      if (String(error.message || '').includes('次数') || String(error.message || '').includes('不足')) {
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const successCount = results.filter((x) => x.ok).length;
  if (successCount === 0 && results.length > 0) {
    throw new Error(results[0].error || '点金执行失败');
  }
  return { message: `点金完成 (${successCount}/${results.length})`, data: { buyNum, results, successCount } };
}

async function executeFishing(client, config) {
  const { count = 3, type = 1 } = config;
  const results = [];
  
  for (let i = 0; i < count; i++) {
    try {
      const result = await client.fishing(1, type);
      results.push({ ok: true, result });
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      if (error.message.includes('次数')) {
        break;
      }
      results.push({ ok: false, error: error.message });
    }
  }

  const successCount = results.filter((x) => x.ok).length;
  if (successCount === 0 && results.length > 0) {
    throw new Error(results[0].error || '钓鱼失败');
  }
  return { message: `钓鱼完成 (${successCount}/${results.length}次)`, data: { results, successCount, count, type } };
}

async function executeMailClaim(client) {
  return executeMailClaimScheduledTask(client);
}

async function executeHangupClaim(client, config) {
  const count = Math.max(1, Number(config?.count || config?.hangupClaimCount || 5));
  const results = [];
  for (let i = 0; i < count; i++) {
    try {
      const result = await client.claimHangupReward();
      results.push({ ok: true, result });
    } catch (error) {
      results.push({ ok: false, error: error.message });
      if (error.message.includes('频繁')) {
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const successCount = results.filter((x) => x.ok).length;
  if (successCount === 0 && results.length > 0) {
    throw new Error(results[0].error || '挂机奖励领取失败');
  }
  return { message: `挂机奖励领取完成 (${successCount}/${results.length})`, data: { results, successCount, count } };
}

async function executeStudy(client, config) {
  const roleInfo = await client.getRoleInfo();
  const study = roleInfo?.role?.study || {};
  const maxCorrectNum = Number(study.maxCorrectNum || 0);
  const beginTimeMs = Number(study.beginTime || 0) * 1000;

  if (maxCorrectNum >= 10 && isInCurrentWeek(beginTimeMs)) {
    return { message: '本周咸鱼大冲关已完成', data: { maxCorrectNum } };
  }

  let session = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const startResp = await client.startStudy();
    const questionList =
      startResp?.questionList ||
      startResp?.questions ||
      startResp?.questionlist ||
      startResp?.study?.questionList ||
      null;
    const studyId =
      startResp?.role?.study?.id ||
      startResp?.study?.id ||
      startResp?.id ||
      study.id;
    if (Array.isArray(questionList) && questionList.length > 0 && studyId) {
      session = { questionList, studyId };
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  if (!session) {
    throw new Error('未获取到答题题目或学习ID');
  }
  const { questionList, studyId } = session;

  const answerResults = [];
  for (let i = 0; i < questionList.length; i++) {
    const q = questionList[i];
    const questionId = q?.id;
    const questionText = q?.question || '';
    if (!questionId) continue;

    const answer = findAnswer(questionText) || 1;
    try {
      const result = await client.answerStudy(studyId, questionId, answer);
      answerResults.push({ questionId, answer, ok: true, result });
    } catch (error) {
      answerResults.push({ questionId, answer, ok: false, error: error.message });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const rewardResults = [];
  for (let rewardId = 1; rewardId <= 10; rewardId++) {
    try {
      const result = await client.claimStudyReward(rewardId);
      rewardResults.push({ rewardId, ok: true, result });
    } catch (error) {
      rewardResults.push({ rewardId, ok: false, error: error.message });
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const answered = answerResults.filter((item) => item.ok).length;
  return {
    message: `咸鱼大冲关完成，成功提交 ${answered}/${questionList.length} 题`,
    data: {
      totalQuestions: questionList.length,
      answered,
      answerResults,
      rewardResults
    }
  };
}

function isInCurrentWeek(timestampMs) {
  if (!timestampMs) return false;
  const now = new Date();
  const currentDay = now.getDay();
  const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  const ts = new Date(timestampMs);
  return ts >= weekStart && ts < weekEnd;
}

async function executeHangupAddTime(client, config) {
  try {
    const result = await client.addHangupTime();
    return { message: '加钟成功', data: result };
  } catch (error) {
    if (error.message.includes('次数')) {
      return { message: '今日加钟次数已用完', data: {} };
    }
    throw error;
  }
}

async function executeBottleReset(client, config) {
  try {
    const result = await client.resetBottles();
    return { message: '罐子重置成功', data: result };
  } catch (error) {
    throw error;
  }
}

async function executeBottleClaim(client, config) {
  try {
    const result = await client.claimAllBottles();
    return { message: '罐子领取成功', data: result };
  } catch (error) {
    throw error;
  }
}

async function executeCarSend(client, config) {
  const { goldThreshold = 0, recruitThreshold = 0, jadeThreshold = 0, ticketThreshold = 0, matchAll = false } = config;
  try {
    const result = await client.smartSendCar({
      goldThreshold,
      recruitThreshold,
      jadeThreshold,
      ticketThreshold,
      matchAll
    });
    return { message: '智能发车完成', data: result };
  } catch (error) {
    throw error;
  }
}

async function executeCarClaim(client, config) {
  try {
    const result = await client.claimAllCars();
    return { message: '收车完成', data: result };
  } catch (error) {
    throw error;
  }
}

async function executeBlackMarket(client, config) {
  const results = [];

  try {
    const result = await client.blackMarketPurchase();
    results.push({ ok: true, command: 'store_purchase', mode: 'purchase_list', result });
    return { message: '使用游戏采购清单成功', data: { results, successCount: 1, mode: 'purchase_list' } };
  } catch (error) {
    const message = String(error?.message || '黑市采购失败');
    results.push({ ok: false, command: 'store_purchase', mode: 'purchase_list', error: message });

    if (!message.includes('商店采购未开启')) {
      throw new Error(message);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 250));

  try {
    const result = await client.directStoreBuy(1);
    results.push({
      ok: true,
      command: 'store_buy',
      mode: 'fallback',
      goodsId: 1,
      itemName: '青铜宝箱',
      quantity: 1,
      displayName: '购买青铜宝箱*1',
      result,
    });

    return {
      message: '黑市采购未开启，已兜底购买青铜宝箱*1',
      data: { results, successCount: 1, fallbackUsed: true, goodsId: 1 },
    };
  } catch (error) {
    const message = String(error?.message || '黑市采购失败');
    results.push({
      ok: false,
      command: 'store_buy',
      mode: 'fallback',
      goodsId: 1,
      itemName: '青铜宝箱',
      quantity: 1,
      displayName: '购买青铜宝箱*1',
      error: message,
    });
    throw new Error(message);
  }
}

async function executeTreasureClaim(client, config) {
  try {
    const result = await client.claimTreasureFreeReward();
    return { message: '珍宝阁领取完成', data: result };
  } catch (error) {
    throw error;
  }
}

async function executeLegacyClaim(client, config) {
  await client.getRoleInfo(8000).catch(() => {});
  try {
    const result = await client.claimLegacyScrolls();
    return { message: '残卷收取完成', data: result };
  } catch (error) {
    if (String(error?.message || '').includes('出了点小问题')) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await client.getRoleInfo(8000).catch(() => {});
      const retryResult = await client.claimLegacyScrolls();
      return { message: '残卷收取完成(重试成功)', data: retryResult };
    }
    throw error;
  }
}

async function executeWelfareClaim(client, config) {
  const results = [];
  const rewards = [
    { name: '福利签到', cmd: 'system_signinreward' },
    { name: '俱乐部签到', cmd: 'legion_signin' },
    { name: '领取每日礼包', cmd: 'discount_claimreward', params: { discountId: 1 } },
    { name: '领取每日免费奖励', cmd: 'collection_claimfreereward' },
    { name: '领取免费礼包', cmd: 'card_claimreward', params: { cardId: 1 } },
    { name: '领取永久卡礼包', cmd: 'card_claimreward', params: { cardId: 4003 } },
  ];
  
  for (const reward of rewards) {
    try {
      const result = await client.sendWithPromise(reward.cmd, reward.params || {});
      results.push({ name: reward.name, ok: true, result });
    } catch (error) {
      results.push({ name: reward.name, ok: false, error: error.message });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  
  const successCount = results.filter((x) => x.ok).length;
  return { 
    message: `福利奖励领取完成 (${successCount}/${results.length})`, 
    data: { results, successCount } 
  };
}

async function executeDailyTaskClaim(client, config) {
  return executeDailyTaskClaimScheduledTask(client, config);
}

function getTodayBossId() {
  const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905];
  const dayOfWeek = new Date().getDay();
  return DAY_BOSS_MAP[dayOfWeek];
}

async function executeDailyBoss(client, config) {
  await client.ensureBattleVersion();
  const todayBossId = getTodayBossId();
  const results = [];
  let successCount = 0;
  const maxAttempts = 5;
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await client.startDailyBossFight(todayBossId);
      results.push({ round: i + 1, ok: true, result });
      successCount++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      if (error.message.includes('次数') || error.message.includes('已挑战')) {
        results.push({ round: i + 1, ok: false, error: error.message, stop: true });
        break;
      }
      results.push({ round: i + 1, ok: false, error: error.message });
    }
  }
  
  return { 
    message: `每日咸王挑战完成 (${successCount}/${results.length}次)`, 
    data: { results, successCount, bossId: todayBossId } 
  };
}

async function executeDream(client, config) {
  const result = await client.startDreamBattle();
  if (result.skipped) {
    return { message: result.reason, data: result };
  }
  return { message: '梦境挑战完成', data: result };
}

async function executeSkinChallenge(client, config) {
  const result = await client.startSkinChallenge();
  if (result.skipped) {
    return { message: result.reason, data: result };
  }
  const clearedCount = result.clearedCount || 0;
  return { message: `换皮闯关完成 (通关${clearedCount}个BOSS)`, data: result };
}

async function executeDreamPurchase(client, config) {
  const purchaseList = config?.purchaseList || [];
  if (!Array.isArray(purchaseList) || purchaseList.length === 0) {
    return { message: '购买清单为空，跳过购买', data: {} };
  }
  const result = await client.buyDreamItems(purchaseList);
  if (result.skipped) {
    return { message: result.reason, data: result };
  }
  return { message: `梦境购买完成 (成功${result.successCount}/${result.results?.length || 0})`, data: result };
}

async function executePeachTask(client, config) {
  try {
    const result = await client.claimPeachTasks();
    return { message: '蟠桃园任务领取完成', data: result };
  } catch (error) {
    throw error;
  }
}

async function executeBoxOpen(client, config) {
  const itemId = Number(config?.boxType ?? config?.itemId ?? 2001) || 2001;
  const totalCount = Math.max(1, Number(config?.number ?? config?.count ?? 3) || 3);
  const batchSize = 10;
  const fullBatches = Math.floor(totalCount / batchSize);
  const remainder = totalCount % batchSize;
  const results = [];

  await client.getRoleInfo(8000).catch(() => {});
  for (let i = 0; i < fullBatches; i++) {
    const result = await client.openBox(itemId, batchSize);
    results.push({ ok: true, number: batchSize, result });
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  if (remainder > 0) {
    const result = await client.openBox(itemId, remainder);
    results.push({ ok: true, number: remainder, result });
  }
  try {
    await client.claimBoxPointReward();
  } catch {
    // 积分奖励领取失败不影响主流程
  }

  return {
    message: `开箱完成 (itemId=${itemId}, number=${totalCount})`,
    data: { itemId, number: totalCount, requestCount: results.length, results }
  };
}

async function executeLegionStoreFragment(client, config) {
  try {
    const result = await client.sendWithPromise('legion_storebuygoods', { id: 6 }, 5000);
    return { message: '购买四圣碎片成功', data: result };
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('俱乐部商品购买数量超出上限')) {
      return { message: '本周已购买过四圣碎片', data: {} };
    }
    if (message.includes('物品不存在')) {
      return { message: '盐锭不足或未加入军团，无法购买四圣碎片', data: {} };
    }
    throw error;
  }
}

async function executeGenieSweep(client, config) {
  const result = await client.genieDailySweep(config);
  if (result?.skipped) {
    return { message: `灯神扫荡跳过: ${result.reason}`, data: result };
  }

  const sweptNames = (result?.sweepResults || [])
    .filter((item) => item.success)
    .map((item) => item.name)
    .join('、');
  const sweptSummary = sweptNames || '无';
  return {
    message: `灯神扫荡完成 (扫荡:${sweptSummary}, 领取扫荡券:${result?.claimedTickets || 0}次)`,
    data: result,
  };
}

export function stopScheduler() {
  for (const [key, { job }] of scheduledJobs) {
    job.stop();
  }
  scheduledJobs.clear();
  connectionPromises.clear();
  
  for (const entry of dailyRewardFlushState.values()) {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
  }
  dailyRewardFlushState.clear();
  
  for (const [accountId, client] of activeConnections) {
    client.disconnect();
    unregisterAccountClient(accountId, client);
  }
  activeConnections.clear();
  
  console.log('🛑 定时任务调度器已停止');
}

export function getActiveConnections() {
  return activeConnections;
}

export function getScheduledJobs() {
  return scheduledJobs;
}

export default {
  initScheduler,
  scheduleTask,
  executeTask,
  stopScheduler,
  getActiveConnections,
  getScheduledJobs
};
