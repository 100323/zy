import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './database/index.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import taskRoutes from './routes/tasks.js';
import logRoutes from './routes/logs.js';
import weixinRoutes from './routes/weixin.js';
import statsRoutes from './routes/stats.js';
import batchSchedulerRoutes from './routes/batchScheduler.js';
import batchSettingsRoutes from './routes/batchSettings.js';
import inviteCodeRoutes from './routes/inviteCodes.js';
import { initScheduler, executeTask } from './scheduler/index.js';
import { initBatchScheduler } from './batchScheduler/index.js';
import { authMiddleware } from './middleware/auth.js';
import { get } from './database/index.js';
import { decrypt } from './utils/crypto.js';
import config from './config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
  skip: (req) => {
    return req.path.includes('/hortor/comb-login-server/api/v1/login');
  }
}));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/weixin', weixinRoutes);
app.use('/api/hortor', weixinRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/batch-scheduler', batchSchedulerRoutes);
app.use('/api/batch-settings', batchSettingsRoutes);
app.use('/api/invite-codes', inviteCodeRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/tasks/execute', authMiddleware, async (req, res) => {
  try {
    const { accountId, taskType } = req.body;
    
    if (!accountId || !taskType) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数'
      });
    }

    const account = get(
      'SELECT * FROM game_accounts WHERE id = ? AND user_id = ?',
      [accountId, req.user.userId]
    );
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    const token = decrypt(account.token_encrypted, account.token_iv);
    
    const result = await executeTask({
      ...account,
      token,
      task_type: taskType
    });
    
    res.json({
      success: true,
      message: '任务执行成功',
      data: result
    });
  } catch (error) {
    console.error('手动执行任务错误:', error);
    res.status(500).json({
      success: false,
      error: error.message || '任务执行失败'
    });
  }
});

const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    error: '服务器内部错误'
  });
});

async function startServer() {
  try {
    await initDatabase();
    
    await initScheduler();
    
    await initBatchScheduler();
    
    app.listen(config.server.port, config.server.host, () => {
      console.log(`🚀 服务器运行在 http://${config.server.host}:${config.server.port}`);
      console.log(`📝 API 文档:`);
      console.log(`   POST /api/auth/register - 用户注册`);
      console.log(`   POST /api/auth/login - 用户登录`);
      console.log(`   GET  /api/auth/me - 获取当前用户信息`);
      console.log(`   GET  /api/accounts - 获取账号列表`);
      console.log(`   POST /api/accounts - 添加账号`);
      console.log(`   GET  /api/tasks/types - 获取任务类型`);
      console.log(`   GET  /api/tasks/account/:id - 获取账号的任务配置`);
      console.log(`   POST /api/tasks/account/:id - 创建/更新任务配置`);
      console.log(`   GET  /api/logs - 获取执行日志`);
      console.log(`   GET  /api/batch-scheduler - 获取批量任务列表`);
      console.log(`   POST /api/batch-scheduler - 创建批量任务`);
    });
  } catch (error) {
    console.error('启动服务器失败:', error);
    process.exit(1);
  }
}

startServer();

process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n正在关闭服务器...');
  process.exit(0);
});
