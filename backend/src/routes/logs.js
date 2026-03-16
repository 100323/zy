import { Router } from 'express';
import { run, get, all } from '../database/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.get('/', (req, res) => {
  try {
    const { accountId, taskType, status, limit = 50, offset = 0 } = req.query;
    
    let sql = `
      SELECT tl.*, ga.name as account_name 
      FROM task_logs tl 
      JOIN game_accounts ga ON tl.account_id = ga.id 
      WHERE ga.user_id = ?
    `;
    const params = [req.user.userId];
    
    if (accountId) {
      sql += ' AND tl.account_id = ?';
      params.push(accountId);
    }
    
    if (taskType) {
      sql += ' AND tl.task_type = ?';
      params.push(taskType);
    }
    
    if (status) {
      sql += ' AND tl.status = ?';
      params.push(status);
    }
    
    sql += ' ORDER BY tl.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const logs = all(sql, params);
    
    let countSql = `
      SELECT COUNT(*) as total 
      FROM task_logs tl 
      JOIN game_accounts ga ON tl.account_id = ga.id 
      WHERE ga.user_id = ?
    `;
    const countParams = [req.user.userId];
    
    if (accountId) {
      countSql += ' AND tl.account_id = ?';
      countParams.push(accountId);
    }
    
    if (taskType) {
      countSql += ' AND tl.task_type = ?';
      countParams.push(taskType);
    }
    
    if (status) {
      countSql += ' AND tl.status = ?';
      countParams.push(status);
    }
    
    const countResult = get(countSql, countParams);
    
    res.json({
      success: true,
      data: logs,
      total: countResult.total
    });
  } catch (error) {
    console.error('获取日志列表错误:', error);
    res.status(500).json({
      success: false,
      error: '获取日志列表失败'
    });
  }
});

router.get('/recent', (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const logs = all(
      `SELECT tl.*, ga.name as account_name 
       FROM task_logs tl 
       JOIN game_accounts ga ON tl.account_id = ga.id 
       WHERE ga.user_id = ? 
       ORDER BY tl.created_at DESC 
       LIMIT ?`,
      [req.user.userId, parseInt(limit)]
    );
    
    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('获取最近日志错误:', error);
    res.status(500).json({
      success: false,
      error: '获取日志失败'
    });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const log = get(
      `SELECT tl.id FROM task_logs tl 
       JOIN game_accounts ga ON tl.account_id = ga.id 
       WHERE tl.id = ? AND ga.user_id = ?`,
      [req.params.id, req.user.userId]
    );
    
    if (!log) {
      return res.status(404).json({
        success: false,
        error: '日志不存在'
      });
    }
    
    run('DELETE FROM task_logs WHERE id = ?', [req.params.id]);
    
    res.json({
      success: true,
      message: '日志删除成功'
    });
  } catch (error) {
    console.error('删除日志错误:', error);
    res.status(500).json({
      success: false,
      error: '删除日志失败'
    });
  }
});

router.delete('/clear/:accountId', (req, res) => {
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
    
    run('DELETE FROM task_logs WHERE account_id = ?', [accountId]);
    
    res.json({
      success: true,
      message: '日志清空成功'
    });
  } catch (error) {
    console.error('清空日志错误:', error);
    res.status(500).json({
      success: false,
      error: '清空日志失败'
    });
  }
});

export default router;
