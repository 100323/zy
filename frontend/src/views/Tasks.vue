<template>
  <div class="tasks-page">
    <n-card>
      <template #header>
        <div class="card-header">
          <span>任务配置</span>
          <n-space>
            <n-button @click="refreshTasks">
              <template #icon>
                <n-icon><Refresh /></n-icon>
              </template>
              刷新
            </n-button>
            <n-button type="primary" @click="saveCurrentConfig" :loading="saving">
              保存当前账号配置
            </n-button>
          </n-space>
        </div>
      </template>

      <n-alert type="info" style="margin-bottom: 16px">
        选择账号后，可单独配置该账号的任务执行参数。每个账号的配置独立保存。
      </n-alert>

      <div class="account-selector">
        <span>选择账号：</span>
        <n-select
          v-model:value="selectedAccountId"
          :options="accountOptions"
          placeholder="请选择要配置的账号"
          style="width: 300px"
          @update:value="handleAccountChange"
        />
        <n-tag v-if="selectedAccountId" type="success" size="small">
          已加载该账号的配置
        </n-tag>
      </div>
    </n-card>

    <template v-if="selectedAccountId">
      <n-card style="margin-top: 16px">
        <n-tabs type="line" animated>
          <n-tab-pane name="schedule" tab="定时任务">
            <div class="schedule-section">
              <div class="schedule-header">
                <n-space align="center">
                  <span>每日执行时间：</span>
                  <n-time-picker
                    v-model:value="dailyRunTime"
                    format="HH:mm"
                    clearable
                  />
                  <n-button type="primary" size="small" @click="applyDailyTime">
                    应用到所有启用的任务
                  </n-button>
                </n-space>
              </div>

              <n-alert type="info" style="margin-bottom: 16px">
                设置该账号每日任务的执行时间，系统将在指定时间自动执行所有启用的任务
              </n-alert>

              <div class="scheduled-tasks-list">
                <div
                  v-for="task in schedulableTasks"
                  :key="task.value"
                  class="scheduled-task-item"
                >
                  <div class="task-main">
                    <n-switch
                      :value="getTaskEnabled(task.value)"
                      size="small"
                      @update:value="(val) => setTaskEnabled(task.value, val)"
                    />
                    <span class="task-name">{{ task.label }}</span>
                    <n-tag size="small" :type="getGroupType(task.group)">
                      {{ getGroupLabel(task.group) }}
                    </n-tag>
                  </div>
                  <div class="task-time">
                    <n-space align="center" size="small">
                      <n-select
                        :value="getTaskScheduleType(task.value)"
                        :options="scheduleModeOptions"
                        size="small"
                        style="width: 120px"
                        @update:value="(val) => setTaskScheduleType(task.value, val)"
                      />
                      <n-time-picker
                        v-if="getTaskScheduleType(task.value) === 'daily'"
                        :value="getTaskRunTime(task.value)"
                        format="HH:mm"
                        size="small"
                        clearable
                        placeholder="默认时间"
                        @update:value="(val) => setTaskRunTime(task.value, val)"
                      />
                      <n-input-number
                        v-else
                        :value="getTaskIntervalHours(task.value)"
                        :min="1"
                        :max="23"
                        size="small"
                        style="width: 140px"
                        placeholder="每N小时"
                        @update:value="(val) => setTaskIntervalHours(task.value, val)"
                      />
                    </n-space>
                  </div>
                </div>
              </div>
            </div>
          </n-tab-pane>

          <n-tab-pane name="config" tab="任务详细配置">
            <TaskConfigPanel
              v-model="currentAccountConfig.taskConfigs"
              :title="`${currentAccountName} - 任务参数配置`"
              @save="handleConfigSave"
            />
          </n-tab-pane>

          <n-tab-pane name="quick" tab="快捷设置">
            <div class="quick-settings">
              <n-grid :cols="2" :x-gap="16">
                <n-gi>
                  <n-card title="阵容配置" size="small">
                    <n-space vertical>
                      <div class="setting-row">
                        <span>竞技场阵容</span>
                        <n-select
                          v-model:value="currentAccountConfig.settings.arenaFormation"
                          :options="formationOptions"
                          size="small"
                          style="width: 120px"
                        />
                      </div>
                      <div class="setting-row">
                        <span>爬塔阵容</span>
                        <n-select
                          v-model:value="currentAccountConfig.settings.towerFormation"
                          :options="formationOptions"
                          size="small"
                          style="width: 120px"
                        />
                      </div>
                      <div class="setting-row">
                        <span>BOSS阵容</span>
                        <n-select
                          v-model:value="currentAccountConfig.settings.bossFormation"
                          :options="formationOptions"
                          size="small"
                          style="width: 120px"
                        />
                      </div>
                      <div class="setting-row">
                        <span>BOSS次数</span>
                        <n-select
                          v-model:value="currentAccountConfig.settings.bossTimes"
                          :options="bossTimesOptions"
                          size="small"
                          style="width: 120px"
                        />
                      </div>
                    </n-space>
                  </n-card>
                </n-gi>

                <n-gi>
                  <n-card title="功能开关" size="small">
                    <n-space vertical>
                      <div class="setting-row">
                        <span>领罐子</span>
                        <n-switch v-model:value="currentAccountConfig.settings.claimBottle" />
                      </div>
                      <div class="setting-row">
                        <span>领挂机</span>
                        <n-switch v-model:value="currentAccountConfig.settings.claimHangUp" />
                      </div>
                      <div class="setting-row">
                        <span>竞技场</span>
                        <n-switch v-model:value="currentAccountConfig.settings.arenaEnable" />
                      </div>
                      <div class="setting-row">
                        <span>开宝箱</span>
                        <n-switch v-model:value="currentAccountConfig.settings.openBox" />
                      </div>
                      <div class="setting-row">
                        <span>领取邮件</span>
                        <n-switch v-model:value="currentAccountConfig.settings.claimEmail" />
                      </div>
                      <div class="setting-row">
                        <span>黑市采购</span>
                        <n-switch v-model:value="currentAccountConfig.settings.blackMarketPurchase" />
                      </div>
                      <div class="setting-row">
                        <span>付费招募</span>
                        <n-switch v-model:value="currentAccountConfig.settings.payRecruit" />
                      </div>
                    </n-space>
                  </n-card>
                </n-gi>
              </n-grid>

              <n-card title="操作" size="small" style="margin-top: 16px">
                <n-space>
                  <n-button type="primary" @click="enableAllTasks">
                    启用所有任务
                  </n-button>
                  <n-button @click="disableAllTasks">
                    禁用所有任务
                  </n-button>
                  <n-button type="warning" @click="resetToDefault">
                    恢复默认配置
                  </n-button>
                  <n-button type="error" @click="copyToAllAccounts">
                    复制配置到所有账号
                  </n-button>
                </n-space>
              </n-card>
            </div>
          </n-tab-pane>
        </n-tabs>
      </n-card>
    </template>

    <n-empty v-else description="请选择要配置的账号" style="margin-top: 50px" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { Refresh } from '@vicons/ionicons5';
import TaskConfigPanel from '@/components/Daily/TaskConfigPanel.vue';
import { useTaskStore } from '@stores/task';
import { useAccountStore } from '@stores/account';
import {
  availableTasks,
  taskGroupDefinitions,
  defaultTaskConfigs,
  defaultSettings,
  formationOptions,
  bossTimesOptions,
} from '@/utils/batch/constants';

const message = useMessage();
const taskStore = useTaskStore();
const accountStore = useAccountStore();

const saving = ref(false);
const dailyRunTime = ref(null);
const selectedAccountId = ref(null);
const isHydrating = ref(false);
const autoSyncTimer = ref(null);
const autoSyncRunning = ref(false);

const scheduleModeOptions = [
  { label: '每日固定时间', value: 'daily' },
  { label: '每N小时执行', value: 'interval' },
];

const frontendToBackendTaskMap = {
  claimHangUpRewards: 'HANGUP_CLAIM',
  batchAddHangUpTime: 'HANGUP_ADD_TIME',
  resetBottles: 'BOTTLE_RESET',
  batchlingguanzi: 'BOTTLE_CLAIM',
  batchclubsign: 'LEGION_SIGN',
  batchFriendGold: 'FRIEND_GOLD',
  batchMailClaim: 'MAIL_CLAIM',
  batchStudy: 'STUDY',
  batcharenafight: 'ARENA',
  batchSmartSendCar: 'CAR_SEND',
  batchClaimCars: 'CAR_CLAIM',
  batchBuyGold: 'BUY_GOLD',
  batchRecruit: 'RECRUIT',
  batchFish: 'FISHING',
  batchOpenBox: 'BOX_OPEN',
  store_purchase: 'BLACK_MARKET',
  collection_claimfreereward: 'TREASURE_CLAIM',
  batchLegacyClaim: 'LEGACY_CLAIM',
  climbTower: 'TOWER',
  climbWeirdTower: 'WEIRD_TOWER',
  batchClaimFreeEnergy: 'WEIRD_TOWER_FREE_ITEM',
  batchUseItems: 'WEIRD_TOWER_USE_ITEM',
  batchMergeItems: 'WEIRD_TOWER_MERGE_ITEM',
  legion_storebuygoods: 'LEGION_STORE_FRAGMENT',
  batchmengjing: 'DREAM',
  skinChallenge: 'SKIN_CHALLENGE',
  batchGenieSweep: 'GENIE_SWEEP',
  batchLegionBoss: 'LEGION_BOSS',
  batchBuyDreamItems: 'DREAM_PURCHASE',
  batchDailyBoss: 'DAILY_BOSS',
  batchWelfareClaim: 'WELFARE_CLAIM',
  batchDailyTaskClaim: 'DAILY_TASK_CLAIM',
};

const backendTypeDefaultCronMap = ref({});

const cloneTaskConfigs = (taskConfigs = defaultTaskConfigs) => {
  return JSON.parse(JSON.stringify(taskConfigs));
};

const normalizeTaskConfigs = (taskConfigs = {}) => {
  const normalized = cloneTaskConfigs();

  Object.entries(taskConfigs || {}).forEach(([taskKey, taskValue]) => {
    if (!normalized[taskKey]) {
      return;
    }

    normalized[taskKey] = {
      ...normalized[taskKey],
      ...(taskValue || {}),
      config: {
        ...normalized[taskKey].config,
        ...(taskValue?.config || {}),
      },
    };
  });

  return normalized;
};

const normalizeAccountConfig = (accountConfig = {}) => {
  const taskConfigs = normalizeTaskConfigs(accountConfig.taskConfigs || {});
  const settings = {
    ...defaultSettings,
    ...(accountConfig.settings || {}),
  };

  if (accountConfig?.taskConfigs?.batchMailClaim?.enabled !== undefined) {
    settings.claimEmail = !!accountConfig.taskConfigs.batchMailClaim.enabled;
  } else if (taskConfigs.batchMailClaim) {
    taskConfigs.batchMailClaim.enabled = !!settings.claimEmail;
  }

  return {
    taskConfigs,
    settings,
  };
};

const createDefaultAccountConfig = () => normalizeAccountConfig();

const currentAccountConfig = ref(createDefaultAccountConfig());
const allAccountsConfig = ref({});
const localOnlyTaskKeys = new Set(['startBatch']);

const schedulableTasks = computed(() => {
  return availableTasks.filter((task) => !localOnlyTaskKeys.has(task.value));
});

const accountOptions = computed(() => {
  return accountStore.accounts.map((account) => ({
    label: account.name,
    value: account.id,
  }));
});

const currentAccountName = computed(() => {
  const account = accountStore.accounts.find((t) => t.id === selectedAccountId.value);
  return account?.name || '';
});

const getTaskEnabled = (taskValue) => {
  const config = currentAccountConfig.value.taskConfigs[taskValue];
  return config?.enabled ?? true;
};

const setTaskEnabled = (taskValue, enabled) => {
  if (!currentAccountConfig.value.taskConfigs[taskValue]) {
    currentAccountConfig.value.taskConfigs[taskValue] = {
      enabled: true,
      config: {},
      scheduleType: 'daily',
      intervalHours: 4,
      runTime: null,
    };
  }
  currentAccountConfig.value.taskConfigs[taskValue].enabled = enabled;
};

const getTaskRunTime = (taskValue) => {
  const config = currentAccountConfig.value.taskConfigs[taskValue];
  return config?.runTime || null;
};

const setTaskRunTime = (taskValue, runTime) => {
  if (!currentAccountConfig.value.taskConfigs[taskValue]) {
    currentAccountConfig.value.taskConfigs[taskValue] = {
      enabled: true,
      config: {},
      scheduleType: 'daily',
      intervalHours: 4,
      runTime: null,
    };
  }
  currentAccountConfig.value.taskConfigs[taskValue].runTime = runTime;
};

const getTaskScheduleType = (taskValue) => {
  const config = currentAccountConfig.value.taskConfigs[taskValue];
  return config?.scheduleType || 'daily';
};

const setTaskScheduleType = (taskValue, scheduleType) => {
  if (!currentAccountConfig.value.taskConfigs[taskValue]) {
    currentAccountConfig.value.taskConfigs[taskValue] = {
      enabled: true,
      config: {},
      scheduleType: 'daily',
      intervalHours: 4,
      runTime: null,
    };
  }
  currentAccountConfig.value.taskConfigs[taskValue].scheduleType = scheduleType;
  if (scheduleType === 'interval' && !currentAccountConfig.value.taskConfigs[taskValue].intervalHours) {
    currentAccountConfig.value.taskConfigs[taskValue].intervalHours = 4;
  }
};

const getTaskIntervalHours = (taskValue) => {
  const config = currentAccountConfig.value.taskConfigs[taskValue];
  return config?.intervalHours ?? 4;
};

const setTaskIntervalHours = (taskValue, intervalHours) => {
  if (!currentAccountConfig.value.taskConfigs[taskValue]) {
    currentAccountConfig.value.taskConfigs[taskValue] = {
      enabled: true,
      config: {},
      scheduleType: 'daily',
      intervalHours: 4,
      runTime: null,
    };
  }
  currentAccountConfig.value.taskConfigs[taskValue].intervalHours = intervalHours || 4;
};

const getGroupType = (group) => {
  const typeMap = {
    daily: 'success',
    dungeon: 'warning',
    resource: 'info',
    legacy: 'default',
    monthly: 'error',
    other: 'default',
  };
  return typeMap[group] || 'default';
};

const getGroupLabel = (groupName) => {
  const group = taskGroupDefinitions.find((g) => g.name === groupName);
  return group ? group.label : '其他';
};

const parseCronToSchedule = (cronExpression) => {
  if (!cronExpression) {
    return {
      scheduleType: 'daily',
      runTime: null,
      intervalHours: 4,
    };
  }

  const dailyMatch = cronExpression.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (dailyMatch) {
    const minute = Number(dailyMatch[1]);
    const hour = Number(dailyMatch[2]);
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return {
      scheduleType: 'daily',
      runTime: date.getTime(),
      intervalHours: 4,
    };
  }

  const intervalMatch = cronExpression.match(/^(\d{1,2})\s+\*\/(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (intervalMatch) {
    return {
      scheduleType: 'interval',
      runTime: null,
      intervalHours: Math.max(1, Math.min(23, Number(intervalMatch[2]) || 4)),
    };
  }

  return {
    scheduleType: 'daily',
    runTime: null,
    intervalHours: 4,
  };
};

const buildCronExpression = (taskKey, taskConfig) => {
  const scheduleType = taskConfig?.scheduleType || 'daily';

  if (scheduleType === 'interval') {
    const intervalHours = Math.max(1, Math.min(23, Number(taskConfig?.intervalHours) || 4));
    return `0 */${intervalHours} * * *`;
  }

  const runTime = taskConfig?.runTime || dailyRunTime.value;
  if (runTime) {
    const date = new Date(runTime);
    const hour = date.getHours();
    const minute = date.getMinutes();
    return `${minute} ${hour} * * *`;
  }

  const backendTaskType = frontendToBackendTaskMap[taskKey];
  return backendTypeDefaultCronMap.value[backendTaskType] || '0 8 * * *';
};

const mapBackendConfigToFrontend = (taskKey, backendConfig = {}) => {
  const mapped = { ...(backendConfig || {}) };
  if (taskKey === 'batcharenafight' && backendConfig.battleCount !== undefined) {
    mapped.arenaBattleCount = backendConfig.battleCount;
  }
  if (taskKey === 'climbTower' && backendConfig.maxFloors !== undefined) {
    mapped.towerMaxFloors = backendConfig.maxFloors;
  }
  if (taskKey === 'climbWeirdTower' && (backendConfig.weirdTowerMaxFloors !== undefined || backendConfig.maxFloors !== undefined)) {
    mapped.weirdTowerMaxFloors = backendConfig.weirdTowerMaxFloors ?? backendConfig.maxFloors;
  }
  if (taskKey === 'batchSmartSendCar') {
    mapped.smartDepartureGoldThreshold = backendConfig.goldThreshold ?? 0;
    mapped.smartDepartureRecruitThreshold = backendConfig.recruitThreshold ?? 0;
    mapped.smartDepartureJadeThreshold = backendConfig.jadeThreshold ?? 0;
    mapped.smartDepartureTicketThreshold = backendConfig.ticketThreshold ?? 0;
    mapped.smartDepartureMatchAll = backendConfig.matchAll ?? false;
  }
  if (taskKey === 'batchLegacyClaim' && backendConfig.interval !== undefined) {
    mapped.legacyClaimInterval = backendConfig.interval;
  }
  if (taskKey === 'claimHangUpRewards') {
    mapped.hangupClaimCount = backendConfig.count ?? backendConfig.hangupClaimCount ?? 5;
  }
  if (taskKey === 'batchFriendGold') {
    mapped.friendGoldCount = backendConfig.count ?? backendConfig.friendGoldCount ?? 3;
  }
  if (taskKey === 'batchBuyGold' && backendConfig.buyNum !== undefined) {
    mapped.buyGoldTimes = backendConfig.buyNum;
  }
  if (taskKey === 'batchRecruit') {
    mapped.useFreeRecruit = backendConfig.useFreeRecruit ?? true;
    mapped.usePaidRecruit = backendConfig.usePaidRecruit ?? true;
    mapped.freeRecruitCount = backendConfig.freeRecruitCount ?? 1;
    mapped.paidRecruitCount = backendConfig.paidRecruitCount ?? 1;
    // 兼容旧配置
    if (backendConfig.recruitType !== undefined && backendConfig.count !== undefined) {
      mapped.useFreeRecruit = Number(backendConfig.recruitType) === 3;
      mapped.usePaidRecruit = Number(backendConfig.recruitType) === 1;
      if (mapped.useFreeRecruit) mapped.freeRecruitCount = backendConfig.count;
      if (mapped.usePaidRecruit) mapped.paidRecruitCount = backendConfig.count;
    }
  }
  if (taskKey === 'batchOpenBox') {
    mapped.boxType = backendConfig.boxType ?? 2001;
    mapped.boxCount = backendConfig.number ?? backendConfig.count ?? 10;
  }
  if (taskKey === 'batchFish') {
    mapped.fishType = backendConfig.type ?? 1;
    mapped.fishCount = backendConfig.count ?? 3;
  }
  if (taskKey === 'batchBuyDreamItems') {
    const list = backendConfig.purchaseList || [];
    mapped.dreamPurchaseList = Array.isArray(list) ? list.join(',') : (list || '');
  }
  return mapped;
};

const mapFrontendConfigToBackend = (taskKey, taskConfig = {}) => {
  const sourceConfig = taskConfig.config || {};
  if (taskKey === 'batcharenafight') {
    return {
      battleCount: sourceConfig.arenaBattleCount ?? 3,
    };
  }
  if (taskKey === 'climbTower') {
    return {
      maxFloors: sourceConfig.towerMaxFloors ?? 10,
    };
  }
  if (taskKey === 'climbWeirdTower') {
    return {
      weirdTowerMaxFloors: sourceConfig.weirdTowerMaxFloors ?? 10,
    };
  }
  if (taskKey === 'batchSmartSendCar') {
    return {
      goldThreshold: sourceConfig.smartDepartureGoldThreshold ?? 0,
      recruitThreshold: sourceConfig.smartDepartureRecruitThreshold ?? 0,
      jadeThreshold: sourceConfig.smartDepartureJadeThreshold ?? 0,
      ticketThreshold: sourceConfig.smartDepartureTicketThreshold ?? 0,
      matchAll: sourceConfig.smartDepartureMatchAll ?? false,
    };
  }
  if (taskKey === 'batchLegacyClaim') {
    return {
      interval: sourceConfig.legacyClaimInterval ?? 60,
    };
  }
  if (taskKey === 'claimHangUpRewards') {
    return {
      count: sourceConfig.hangupClaimCount ?? 5,
    };
  }
  if (taskKey === 'batchFriendGold') {
    return {
      count: sourceConfig.friendGoldCount ?? 3,
    };
  }
  if (taskKey === 'store_purchase') {
    return {};
  }
  if (taskKey === 'batchBuyGold') {
    return {
      buyNum: sourceConfig.buyGoldTimes ?? 3,
    };
  }
  if (taskKey === 'batchRecruit') {
    return {
      useFreeRecruit: sourceConfig.useFreeRecruit ?? true,
      usePaidRecruit: sourceConfig.usePaidRecruit ?? true,
      freeRecruitCount: sourceConfig.freeRecruitCount ?? 1,
      paidRecruitCount: sourceConfig.paidRecruitCount ?? 1,
    };
  }
  if (taskKey === 'batchOpenBox') {
    return {
      boxType: sourceConfig.boxType ?? 2001,
      number: sourceConfig.boxCount ?? 3,
    };
  }
  if (taskKey === 'batchFish') {
    return {
      type: sourceConfig.fishType ?? 1,
      count: sourceConfig.fishCount ?? 3,
    };
  }
  if (taskKey === 'batchBuyDreamItems') {
    const rawList = sourceConfig.dreamPurchaseList ?? '';
    const purchaseList = String(rawList)
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v && v.includes('-'));
    return {
      purchaseList: purchaseList.length > 0 ? purchaseList : [],
    };
  }
  return sourceConfig;
};

const inferDailyRunTime = (taskConfigs = {}, fallbackRunTime = null) => {
  const firstDailyTask = Object.values(taskConfigs).find((task) => {
    return (task?.scheduleType || 'daily') === 'daily' && !!task?.runTime;
  });
  return firstDailyTask?.runTime || fallbackRunTime || null;
};

const loadAccountTaskConfigsFromBackend = async (accountId) => {
  const res = await taskStore.fetchAccountTasks(accountId);
  if (!res?.success || !Array.isArray(res.data)) {
    return;
  }

  const backendConfigs = res.data;
  const baseConfig = normalizeAccountConfig(allAccountsConfig.value[accountId] || {});
  const mergedTaskConfigs = cloneTaskConfigs(baseConfig.taskConfigs);
  const backendToFrontendTaskMap = Object.fromEntries(
    Object.entries(frontendToBackendTaskMap).map(([frontendTask, backendTask]) => [backendTask, frontendTask]),
  );

  backendConfigs.forEach((item) => {
    const frontendTaskKey = backendToFrontendTaskMap[item.task_type];
    if (!frontendTaskKey || !mergedTaskConfigs[frontendTaskKey]) {
      return;
    }

    const schedule = parseCronToSchedule(item.cron_expression);
    mergedTaskConfigs[frontendTaskKey] = {
      ...mergedTaskConfigs[frontendTaskKey],
      enabled: !!item.enabled,
      config: {
        ...mergedTaskConfigs[frontendTaskKey].config,
        ...mapBackendConfigToFrontend(frontendTaskKey, item.config || {}),
      },
      scheduleType: schedule.scheduleType,
      runTime: schedule.runTime,
      intervalHours: schedule.intervalHours,
    };
  });

  isHydrating.value = true;
  try {
    currentAccountConfig.value = {
      taskConfigs: mergedTaskConfigs,
      settings: {
        ...defaultSettings,
        ...(baseConfig.settings || {}),
      },
    };
    allAccountsConfig.value[accountId] = JSON.parse(JSON.stringify(currentAccountConfig.value));
    dailyRunTime.value = inferDailyRunTime(
      currentAccountConfig.value.taskConfigs,
      currentAccountConfig.value.settings?.dailyRunTime || null,
    );
  } finally {
    isHydrating.value = false;
  }
};

const handleAccountChange = async (accountId) => {
  isHydrating.value = true;
  try {
    if (accountId && allAccountsConfig.value[accountId]) {
      currentAccountConfig.value = normalizeAccountConfig(allAccountsConfig.value[accountId]);
    } else if (accountId) {
      currentAccountConfig.value = createDefaultAccountConfig();
    } else {
      currentAccountConfig.value = createDefaultAccountConfig();
    }
    dailyRunTime.value = inferDailyRunTime(
      currentAccountConfig.value.taskConfigs,
      currentAccountConfig.value.settings?.dailyRunTime || null,
    );
  } finally {
    isHydrating.value = false;
  }

  if (!accountId) {
    return;
  }

  try {
    await loadAccountTaskConfigsFromBackend(accountId);
  } catch (error) {
    console.error('加载后端任务配置失败:', error);
    message.warning('读取后端任务配置失败，已使用本地缓存配置');
  }
};

const applyDailyTime = () => {
  if (!dailyRunTime.value) {
    message.warning('请先选择执行时间');
    return;
  }

  Object.keys(currentAccountConfig.value.taskConfigs).forEach((key) => {
    if (
      currentAccountConfig.value.taskConfigs[key].enabled &&
      (currentAccountConfig.value.taskConfigs[key].scheduleType || 'daily') === 'daily'
    ) {
      currentAccountConfig.value.taskConfigs[key].runTime = dailyRunTime.value;
    }
  });

  message.success('已应用到该账号所有启用的任务');
};

const enableAllTasks = () => {
  Object.keys(currentAccountConfig.value.taskConfigs).forEach((key) => {
    currentAccountConfig.value.taskConfigs[key].enabled = true;
  });
  message.success('已启用所有任务');
};

const disableAllTasks = () => {
  Object.keys(currentAccountConfig.value.taskConfigs).forEach((key) => {
    currentAccountConfig.value.taskConfigs[key].enabled = false;
  });
  message.success('已禁用所有任务');
};

const resetToDefault = () => {
  currentAccountConfig.value = createDefaultAccountConfig();
  message.success('已恢复默认配置');
};

const copyToAllAccounts = () => {
  if (!selectedAccountId.value) {
    message.warning('请先选择账号');
    return;
  }

  const configCopy = JSON.parse(JSON.stringify(currentAccountConfig.value));
  accountStore.accounts.forEach((account) => {
    if (account.id !== selectedAccountId.value) {
      allAccountsConfig.value[account.id] = JSON.parse(JSON.stringify(configCopy));
    }
  });

  saveAllToLocalStorage();
  message.success(`已复制配置到 ${Math.max(accountStore.accounts.length - 1, 0)} 个账号`);
};

const handleConfigSave = (configs) => {
  currentAccountConfig.value.taskConfigs = configs;
  saveCurrentConfig();
};

const syncCurrentConfigToBackend = async ({ notify = false } = {}) => {
  if (!selectedAccountId.value || autoSyncRunning.value) {
    return { success: false };
  }

  autoSyncRunning.value = true;
  if (notify) {
    saving.value = true;
  }

  try {
    allAccountsConfig.value[selectedAccountId.value] = JSON.parse(
      JSON.stringify(currentAccountConfig.value)
    );
    saveAllToLocalStorage();

    let syncedCount = 0;
    let skippedCount = 0;
    const syncErrors = [];

    for (const [taskKey, taskValue] of Object.entries(currentAccountConfig.value.taskConfigs)) {
      if (localOnlyTaskKeys.has(taskKey)) {
        continue;
      }

      const backendTaskType = frontendToBackendTaskMap[taskKey];
      if (!backendTaskType) {
        skippedCount++;
        continue;
      }

      const cronExpression = buildCronExpression(taskKey, taskValue);
      const config = mapFrontendConfigToBackend(taskKey, taskValue);
      try {
        const res = await taskStore.updateTaskConfig(selectedAccountId.value, backendTaskType, {
          enabled: !!taskValue.enabled,
          cronExpression,
          config,
        });
        if (res?.success) {
          syncedCount++;
        } else {
          syncErrors.push(`${taskKey}: ${res?.error || '保存失败'}`);
        }
      } catch (error) {
        syncErrors.push(`${taskKey}: ${error?.response?.data?.error || error?.message || '保存失败'}`);
      }
    }

    if (notify) {
      if (syncErrors.length > 0) {
        message.error(`后端同步失败 ${syncErrors.length} 项，请检查账号与登录状态`);
      } else {
        message.success(`${currentAccountName.value} 的配置已保存，已同步 ${syncedCount} 项任务`);
      }

      if (skippedCount > 0) {
        message.info(`有 ${skippedCount} 项仅本地配置任务未同步到后端调度`);
      }
    }

    return { success: syncErrors.length === 0 };
  } finally {
    autoSyncRunning.value = false;
    if (notify) {
      saving.value = false;
    }
  }
};

const queueAutoSync = () => {
  if (!selectedAccountId.value || isHydrating.value) {
    return;
  }
  if (autoSyncTimer.value) {
    clearTimeout(autoSyncTimer.value);
  }
  autoSyncTimer.value = setTimeout(() => {
    syncCurrentConfigToBackend({ notify: false });
  }, 1000);
};

const saveCurrentConfig = async () => {
  if (!selectedAccountId.value) {
    message.warning('请先选择账号');
    return;
  }
  await syncCurrentConfigToBackend({ notify: true });
};

const saveAllToLocalStorage = () => {
  try {
    localStorage.setItem('allAccountsTaskConfig', JSON.stringify(allAccountsConfig.value));
  } catch (error) {
    console.error('保存配置失败:', error);
  }
};

const loadFromLocalStorage = () => {
  try {
    const saved = localStorage.getItem('allAccountsTaskConfig');
    if (saved) {
      const parsed = JSON.parse(saved);
      allAccountsConfig.value = Object.fromEntries(
        Object.entries(parsed || {}).map(([accountId, accountConfig]) => [
          accountId,
          normalizeAccountConfig(accountConfig),
        ]),
      );
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }
};

const refreshTasks = async () => {
  await accountStore.fetchAccounts();

  const accountIdSet = new Set(accountStore.accounts.map((a) => String(a.id)));
  Object.keys(allAccountsConfig.value).forEach((accountId) => {
    if (!accountIdSet.has(String(accountId))) {
      delete allAccountsConfig.value[accountId];
    }
  });
  saveAllToLocalStorage();

  if (selectedAccountId.value && !accountIdSet.has(String(selectedAccountId.value))) {
    selectedAccountId.value = accountStore.accounts[0]?.id || null;
  }

  loadFromLocalStorage();
  if (selectedAccountId.value) {
    await handleAccountChange(selectedAccountId.value);
  }
  message.success('已刷新配置');
};

watch(
  () => currentAccountConfig.value,
  () => {
    if (selectedAccountId.value) {
      allAccountsConfig.value[selectedAccountId.value] = JSON.parse(
        JSON.stringify(currentAccountConfig.value)
      );
      saveAllToLocalStorage();
    }
    queueAutoSync();
  },
  { deep: true }
);

watch(dailyRunTime, (value) => {
  if (isHydrating.value) {
    return;
  }

  currentAccountConfig.value.settings = {
    ...(currentAccountConfig.value.settings || {}),
    dailyRunTime: value,
  };
});

watch(
  () => currentAccountConfig.value.settings?.claimEmail,
  (value) => {
    if (isHydrating.value || !currentAccountConfig.value.taskConfigs?.batchMailClaim) {
      return;
    }

    if (currentAccountConfig.value.taskConfigs.batchMailClaim.enabled !== !!value) {
      currentAccountConfig.value.taskConfigs.batchMailClaim.enabled = !!value;
    }
  }
);

watch(
  () => currentAccountConfig.value.taskConfigs?.batchMailClaim?.enabled,
  (value) => {
    if (isHydrating.value || value === undefined) {
      return;
    }

    if (currentAccountConfig.value.settings?.claimEmail !== !!value) {
      currentAccountConfig.value.settings = {
        ...(currentAccountConfig.value.settings || {}),
        claimEmail: !!value,
      };
    }
  }
);

onMounted(() => {
  loadFromLocalStorage();
  Promise.all([
    accountStore.fetchAccounts(),
    taskStore.fetchTaskTypes(),
  ]).then(([accountRes, taskTypesRes]) => {
    if (taskTypesRes?.success && Array.isArray(taskTypesRes.data)) {
      backendTypeDefaultCronMap.value = Object.fromEntries(
        taskTypesRes.data.map((item) => [item.type, item.defaultCron]),
      );
    }

    if (accountRes?.success && accountStore.accounts.length > 0 && !selectedAccountId.value) {
      selectedAccountId.value = accountStore.accounts[0].id;
      handleAccountChange(selectedAccountId.value);
    }
  }).catch((error) => {
    console.error('初始化任务配置失败:', error);
  });
});
</script>

<style lang="scss" scoped>
.tasks-page {
  padding: 16px;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}

.account-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.schedule-section {
  .schedule-header {
    margin-bottom: 16px;
    padding: 12px;
    background: var(--bg-secondary);
    border-radius: 8px;
  }
}

.scheduled-tasks-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 500px;
  overflow-y: auto;
}

.scheduled-task-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-light);

  .task-main {
    display: flex;
    align-items: center;
    gap: 12px;

    .task-name {
      font-weight: 500;
    }
  }
}

.quick-settings {
  .setting-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-light);

    &:last-child {
      border-bottom: none;
    }
  }
}
</style>
