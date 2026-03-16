import { Router } from 'express';
import { get, all } from '../database/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { getScheduledJobs, getActiveConnections } from '../scheduler/index.js';

const router = Router();

router.use(authMiddleware);

router.get('/overview', (req, res) => {
  try {
    const userId = req.user.userId;

    const accountCount = get(
      'SELECT COUNT(*) as count FROM game_accounts WHERE user_id = ?',
      [userId]
    );

    const enabledTaskCount = get(
      `SELECT COUNT(*) as count 
       FROM task_configs tc 
       JOIN game_accounts ga ON tc.account_id = ga.id 
       WHERE ga.user_id = ? AND tc.enabled = 1`,
      [userId]
    );

    const today = new Date().toISOString().split('T')[0];
    const todayLogCount = get(
      `SELECT COUNT(*) as count 
       FROM task_logs tl 
       JOIN game_accounts ga ON tl.account_id = ga.id 
       WHERE ga.user_id = ? AND DATE(tl.created_at) = ?`,
      [userId, today]
    );

    const pendingTaskCount = get(
      `SELECT COUNT(*) as count 
       FROM task_configs tc 
       JOIN game_accounts ga ON tc.account_id = ga.id 
       WHERE ga.user_id = ? AND tc.enabled = 1 AND tc.next_run_at IS NOT NULL`,
      [userId]
    );

    const failedTaskCount = get(
      `SELECT COUNT(*) as count 
       FROM task_logs tl 
       JOIN game_accounts ga ON tl.account_id = ga.id 
       WHERE ga.user_id = ? AND tl.status = 'error' AND DATE(tl.created_at) = ?`,
      [userId, today]
    );

    const successTaskCount = get(
      `SELECT COUNT(*) as count 
       FROM task_logs tl 
       JOIN game_accounts ga ON tl.account_id = ga.id 
       WHERE ga.user_id = ? AND tl.status = 'success' AND DATE(tl.created_at) = ?`,
      [userId, today]
    );

    res.json({
      success: true,
      data: {
        accountCount: accountCount?.count || 0,
        enabledTaskCount: enabledTaskCount?.count || 0,
        todayLogCount: todayLogCount?.count || 0,
        pendingTaskCount: pendingTaskCount?.count || 0,
        failedTaskCount: failedTaskCount?.count || 0,
        successTaskCount: successTaskCount?.count || 0
      }
    });
  } catch (error) {
    console.error('获取统计概览错误:', error);
    res.status(500).json({
      success: false,
      error: '获取统计概览失败'
    });
  }
});

router.get('/system-status', (req, res) => {
  try {
    const scheduledJobs = getScheduledJobs();
    const activeConnections = getActiveConnections();

    const schedulerStatus = {
      status: 'running',
      totalJobs: scheduledJobs.size,
      activeConnections: activeConnections.size,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    };

    const serviceStatus = {
      database: 'connected',
      scheduler: scheduledJobs.size > 0 ? 'active' : 'idle',
      websocket: activeConnections.size > 0 ? 'connected' : 'disconnected'
    };

    const jobs = [];
    for (const [key, job] of scheduledJobs) {
      const [accountId, taskType] = key.split('_');
      jobs.push({
        accountId: parseInt(accountId),
        taskType,
        status: 'scheduled'
      });
    }

    const connections = [];
    for (const [accountId, client] of activeConnections) {
      connections.push({
        accountId,
        status: client.connected ? 'connected' : 'disconnected'
      });
    }

    res.json({
      success: true,
      data: {
        scheduler: schedulerStatus,
        service: serviceStatus,
        jobs,
        connections,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('获取系统状态错误:', error);
    res.status(500).json({
      success: false,
      error: '获取系统状态失败'
    });
  }
});

router.get('/task-summary', (req, res) => {
  try {
    const userId = req.user.userId;
    const { days = 7 } = req.query;

    const taskSummary = all(
      `SELECT 
        tl.task_type,
        COUNT(*) as total_count,
        SUM(CASE WHEN tl.status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN tl.status = 'error' THEN 1 ELSE 0 END) as error_count,
        MAX(tl.created_at) as last_run
       FROM task_logs tl
       JOIN game_accounts ga ON tl.account_id = ga.id
       WHERE ga.user_id = ? AND tl.created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY tl.task_type
       ORDER BY total_count DESC`,
      [userId, days]
    );

    res.json({
      success: true,
      data: taskSummary
    });
  } catch (error) {
    console.error('获取任务摘要错误:', error);
    res.status(500).json({
      success: false,
      error: '获取任务摘要失败'
    });
  }
});

router.get('/recent-activities', (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 10 } = req.query;

    const activities = all(
      `SELECT 
        tl.*,
        ga.name as account_name
       FROM task_logs tl
       JOIN game_accounts ga ON tl.account_id = ga.id
       WHERE ga.user_id = ?
       ORDER BY tl.created_at DESC
       LIMIT ?`,
      [userId, parseInt(limit)]
    );

    res.json({
      success: true,
      data: activities
    });
  } catch (error) {
    console.error('获取最近活动错误:', error);
    res.status(500).json({
      success: false,
      error: '获取最近活动失败'
    });
  }
});

export default router;
