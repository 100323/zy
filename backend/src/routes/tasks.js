import { Router } from 'express';
import { run, get, all, cleanupTaskLogs } from '../database/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

export const TASK_TYPES = {
  SIGN_IN: { name: '每日签到', cron: '0 8 * * *', group: 'daily' },
  LEGION_SIGN: { name: '军团签到', cron: '0 8 * * *', group: 'daily' },
  ARENA: { name: '竞技场战斗', cron: '1 12 * * *', group: 'daily' },
  TOWER: { name: '爬塔', cron: '1 12 * * *', group: 'dungeon' },
  BOSS_TOWER: { name: '咸王宝库', cron: '0 10 * * *', group: 'dungeon' },
  WEIRD_TOWER: { name: '怪异塔', cron: '1 12 * * *', group: 'dungeon' },
  WEIRD_TOWER_FREE_ITEM: { name: '怪异塔免费道具', cron: '1 12 * * *', group: 'dungeon' },
  WEIRD_TOWER_USE_ITEM: { name: '使用怪异塔道具', cron: '1 12 * * *', group: 'dungeon' },
  WEIRD_TOWER_MERGE_ITEM: { name: '怪异塔合成', cron: '1 12 * * *', group: 'dungeon' },
  LEGION_BOSS: { name: '军团BOSS', cron: '1 0 * * *', group: 'dungeon' },
  DAILY_BOSS: { name: '每日咸王', cron: '1 12 * * *', group: 'dungeon' },
  RECRUIT: { name: '武将招募', cron: '1 12 * * *', group: 'resource' },
  FRIEND_GOLD: { name: '送好友金币', cron: '1 12 * * *', group: 'daily' },
  BUY_GOLD: { name: '点金', cron: '1 12 * * *', group: 'resource' },
  FISHING: { name: '钓鱼', cron: '1 12 * * *', group: 'resource' },
  MAIL_CLAIM: { name: '领取邮件', cron: '0 8 * * *', group: 'daily' },
  HANGUP_CLAIM: { name: '领取挂机奖励', cron: '0 */8 * * *', group: 'daily' },
  STUDY: { name: '答题', cron: '1 12 * * *', group: 'daily' },
  HANGUP_ADD_TIME: { name: '一键加钟', cron: '0 */3 * * *', group: 'daily' },
  BOTTLE_RESET: { name: '重置罐子', cron: '0 */7 * * *', group: 'daily' },
  BOTTLE_CLAIM: { name: '领取罐子', cron: '1 12 * * *', group: 'daily' },
  CAR_SEND: { name: '智能发车', cron: '1 12 * * *', group: 'daily' },
  CAR_CLAIM: { name: '一键收车', cron: '1 18 * * *', group: 'daily' },
  BLACK_MARKET: { name: '黑市采购', cron: '1 12 * * *', group: 'daily' },
  TREASURE_CLAIM: { name: '珍宝阁领取', cron: '1 0 * * *', group: 'daily' },
  LEGACY_CLAIM: { name: '残卷收取', cron: '0 */6 * * *', group: 'daily' },
  WELFARE_CLAIM: { name: '福利奖励领取', cron: '1 12 * * *', group: 'daily' },
  DAILY_TASK_CLAIM: { name: '每日任务奖励领取', cron: '1 12 * * *', group: 'daily' },
  DREAM: { name: '梦境', cron: '1 12 * * *', group: 'dungeon' },
  SKIN_CHALLENGE: { name: '换皮闯关', cron: '1 12 * * *', group: 'dungeon' },
  DREAM_PURCHASE: { name: '购买梦境商品', cron: '1 12 * * *', group: 'dungeon' },
  PEACH_TASK: { name: '蟠桃园任务', cron: '0 10 * * *', group: 'dungeon' },
  BOX_OPEN: { name: '批量开箱', cron: '1 12 * * *', group: 'resource' },
  LEGION_STORE_FRAGMENT: { name: '购买四圣碎片', cron: '1 12 * * *', group: 'resource' },
  GENIE_SWEEP: { name: '灯神扫荡', cron: '1 0 * * *', group: 'resource' },
};

router.get('/types', (req, res) => {
  const types = Object.entries(TASK_TYPES).map(([key, value]) => ({
    type: key,
    name: value.name,
    defaultCron: value.cron,
    group: value.group || 'other'
  }));

  res.json({
    success: true,
    data: types
  });
});

router.get('/account/:accountId', (req, res) => {
  try {
    const { accountId } = req.params;

    const account = get(
      'SELECT id FROM game_accounts WHERE id = ? AND user_id = ?',
      [accountId, req.user.userId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    const configs = all(
      `SELECT id, account_id, task_type, enabled, cron_expression, config_json, last_run_at, next_run_at, created_at, updated_at 
       FROM task_configs 
       WHERE account_id = ?`,
      [accountId]
    );

    const parsedConfigs = configs.map(config => ({
      ...config,
      enabled: !!config.enabled,
      config: config.config_json ? JSON.parse(config.config_json) : {}
    }));

    res.json({
      success: true,
      data: parsedConfigs
    });
  } catch (error) {
    console.error('获取任务配置错误:', error);
    res.status(500).json({
      success: false,
      error: '获取任务配置失败'
    });
  }
});

router.post('/account/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { taskType, enabled, cronExpression, config } = req.body;

    if (!taskType || !TASK_TYPES[taskType]) {
      return res.status(400).json({
        success: false,
        error: '无效的任务类型'
      });
    }

    const account = get(
      'SELECT id FROM game_accounts WHERE id = ? AND user_id = ?',
      [accountId, req.user.userId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    const existing = get(
      'SELECT id FROM task_configs WHERE account_id = ? AND task_type = ?',
      [accountId, taskType]
    );

    const cron = cronExpression || TASK_TYPES[taskType].cron;
    const configJson = config ? JSON.stringify(config) : null;

    if (existing) {
      run(
        `UPDATE task_configs 
         SET enabled = ?, cron_expression = ?, config_json = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [enabled ? 1 : 0, cron, configJson, existing.id]
      );

      const { checkAndRunDueTasks } = await import('../scheduler/index.js');
      await checkAndRunDueTasks();

      res.json({
        success: true,
        message: '任务配置更新成功'
      });
    } else {
      const result = run(
        `INSERT INTO task_configs (account_id, task_type, enabled, cron_expression, config_json) 
         VALUES (?, ?, ?, ?, ?)`,
        [accountId, taskType, enabled ? 1 : 0, cron, configJson]
      );

      const { checkAndRunDueTasks } = await import('../scheduler/index.js');
      await checkAndRunDueTasks();

      res.status(201).json({
        success: true,
        message: '任务配置创建成功',
        data: { id: result.lastInsertRowid }
      });
    }
  } catch (error) {
    console.error('创建/更新任务配置错误:', error);
    res.status(500).json({
      success: false,
      error: '操作失败'
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled, cronExpression, config } = req.body;

    const taskConfig = get(
      `SELECT tc.id FROM task_configs tc 
       JOIN game_accounts ga ON tc.account_id = ga.id 
       WHERE tc.id = ? AND ga.user_id = ?`,
      [id, req.user.userId]
    );

    if (!taskConfig) {
      return res.status(404).json({
        success: false,
        error: '任务配置不存在'
      });
    }

    const updateFields = [];
    const updateValues = [];

    if (enabled !== undefined) {
      updateFields.push('enabled = ?');
      updateValues.push(enabled ? 1 : 0);
    }
    if (cronExpression !== undefined) {
      updateFields.push('cron_expression = ?');
      updateValues.push(cronExpression);
    }
    if (config !== undefined) {
      updateFields.push('config_json = ?');
      updateValues.push(JSON.stringify(config));
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: '没有要更新的内容'
      });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(id);

    run(
      `UPDATE task_configs SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    const { checkAndRunDueTasks } = await import('../scheduler/index.js');
    await checkAndRunDueTasks();

    res.json({
      success: true,
      message: '任务配置更新成功'
    });
  } catch (error) {
    console.error('更新任务配置错误:', error);
    res.status(500).json({
      success: false,
      error: '更新任务配置失败'
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const taskConfig = get(
      `SELECT tc.id FROM task_configs tc 
       JOIN game_accounts ga ON tc.account_id = ga.id 
       WHERE tc.id = ? AND ga.user_id = ?`,
      [req.params.id, req.user.userId]
    );

    if (!taskConfig) {
      return res.status(404).json({
        success: false,
        error: '任务配置不存在'
      });
    }

    run('DELETE FROM task_configs WHERE id = ?', [req.params.id]);

    const { checkAndRunDueTasks } = await import('../scheduler/index.js');
    await checkAndRunDueTasks();

    res.json({
      success: true,
      message: '任务配置删除成功'
    });
  } catch (error) {
    console.error('删除任务配置错误:', error);
    res.status(500).json({
      success: false,
      error: '删除任务配置失败'
    });
  }
});

router.get('/logs/:accountId', (req, res) => {
  try {
    const { accountId } = req.params;
    const { limit = 50, taskType } = req.query;

    const account = get(
      'SELECT id FROM game_accounts WHERE id = ? AND user_id = ?',
      [accountId, req.user.userId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    let sql = 'SELECT * FROM task_logs WHERE account_id = ?';
    const params = [accountId];

    if (taskType) {
      sql += ' AND task_type = ?';
      params.push(taskType);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const logs = all(sql, params);

    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('获取任务日志错误:', error);
    res.status(500).json({
      success: false,
      error: '获取任务日志失败'
    });
  }
});

export function getEnabledTasks() {
  return all(
    `SELECT tc.*, ga.user_id, ga.name as account_name, ga.token_encrypted, ga.token_iv, ga.server, ga.ws_url
     FROM task_configs tc
     JOIN game_accounts ga ON tc.account_id = ga.id
     WHERE tc.enabled = 1 AND ga.status = 'active'`
  );
}

export function updateTaskRunTime(taskId, nextRunAt) {
  run(
    'UPDATE task_configs SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [nextRunAt, taskId]
  );
}

export function markTaskRunTime(taskId, lastRunAt, nextRunAt) {
  run(
    'UPDATE task_configs SET last_run_at = ?, next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [lastRunAt, nextRunAt, taskId]
  );
}

export function addTaskLog(accountId, taskType, status, message, details = null) {
  run(
    'INSERT INTO task_logs (account_id, task_type, status, message, details) VALUES (?, ?, ?, ?, ?)',
    [accountId, taskType, status, message, details]
  );
  cleanupTaskLogs(undefined, accountId);
}

export default router;
