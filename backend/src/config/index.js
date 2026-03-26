/**
 * 应用配置
 */
export const config = {
  server: {
    port: process.env.PORT || 3001,
    host: process.env.HOST || '0.0.0.0'
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'xyzw-jwt-secret-key-2024',
    expiresIn: '7d'
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY || 'xyzw-aes256-encryption-key-32byte',
    ivLength: 16
  },
  database: {
    path: process.env.DB_PATH || './data/xyzw.db'
  },
  game: {
    wsUrl: 'wss://xxz-xyzw.hortorgames.com/agent',
    heartbeatInterval: 30000,
    reconnectDelay: 5000,
    clientVersion: process.env.GAME_CLIENT_VERSION || '2.3.9-wx',
    battleVersion: Number(process.env.GAME_BATTLE_VERSION) || 241201
  },
  cron: {
    timezone: 'Asia/Shanghai'
  },
  scheduler: {
    maxConcurrentAccounts: Number(process.env.MAX_CONCURRENT_ACCOUNTS) || 2,
    dailyCatchupMaxConcurrency: Number(process.env.DAILY_CATCHUP_MAX_CONCURRENCY) || 2,
    staggerWindowMs: Number(process.env.SCHEDULER_STAGGER_WINDOW_MS) || 180000,
    sensitiveTaskThrottleMs: {
      HANGUP_ADD_TIME: Number(process.env.HANGUP_ADD_TIME_THROTTLE_MS) || 3000,
      LEGACY_CLAIM: Number(process.env.LEGACY_CLAIM_THROTTLE_MS) || 4000,
    },
    sensitiveTaskRetry: {
      maxRetries: Number(process.env.SENSITIVE_TASK_MAX_RETRIES) || 2,
      baseDelayMs: Number(process.env.SENSITIVE_TASK_RETRY_BASE_DELAY_MS) || 3000,
      maxDelayMs: Number(process.env.SENSITIVE_TASK_RETRY_MAX_DELAY_MS) || 8000,
    }
  }
};

export default config;
