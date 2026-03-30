import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../data', path.basename(config.database.path));
const dbTempPath = `${dbPath}.tmp`;
const SAVE_DEBOUNCE_MS = Number(process.env.DB_SAVE_DEBOUNCE_MS) || 800;
const SAVE_MAX_DELAY_MS = Number(process.env.DB_SAVE_MAX_DELAY_MS) || 5000;

let db = null;
let SQL = null;
let saveTimer = null;
let dirtySinceAt = 0;
let isDirty = false;
let saveInFlightPromise = null;
let pendingSavePromise = null;
let pendingSaveResolve = null;
let pendingSaveReject = null;

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  max_game_accounts INTEGER DEFAULT 5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);

CREATE TABLE IF NOT EXISTS game_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  token_encrypted TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  bin_encrypted TEXT,
  bin_iv TEXT,
  bin_updated_at DATETIME,
  ws_url TEXT,
  server TEXT,
  remark TEXT,
  avatar TEXT,
  status TEXT DEFAULT 'active',
  import_method TEXT DEFAULT 'manual',
  source_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  task_type TEXT NOT NULL,
  enabled INTEGER DEFAULT 0,
  cron_expression TEXT,
  cron_is_customized INTEGER,
  default_cron_version INTEGER,
  config_json TEXT,
  last_run_at DATETIME,
  next_run_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ws_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE,
  status TEXT DEFAULT 'disconnected',
  connected_at DATETIME,
  last_message_at DATETIME,
  error_message TEXT,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS batch_scheduled_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  run_type TEXT NOT NULL DEFAULT 'daily',
  run_time TEXT,
  cron_expression TEXT,
  selected_account_ids TEXT NOT NULL,
  selected_task_types TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  last_run_at DATETIME,
  next_run_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS batch_task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_task_id INTEGER NOT NULL,
  account_id INTEGER,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_task_id) REFERENCES batch_scheduled_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_batch_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE,
  template_id INTEGER,
  settings_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS batch_task_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  settings_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_game_accounts_user ON game_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_task_configs_account ON task_configs(account_id);
CREATE INDEX IF NOT EXISTS idx_task_logs_account ON task_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_task_logs_created ON task_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_batch_scheduled_tasks_user ON batch_scheduled_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_batch_task_logs_task ON batch_task_logs(batch_task_id);
CREATE INDEX IF NOT EXISTS idx_account_batch_settings_account ON account_batch_settings(account_id);
CREATE INDEX IF NOT EXISTS idx_batch_task_templates_user ON batch_task_templates(user_id);
`;

export async function initDatabase() {
  if (db) return db;

  SQL = await initSqlJs();
  
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  let dbData = null;
  if (fs.existsSync(dbPath)) {
    dbData = fs.readFileSync(dbPath);
  }

  db = new SQL.Database(dbData);
  db.run('PRAGMA foreign_keys = ON;');
  
  db.run(schema);
  ensureUsersSchema(db);
  ensureGameAccountSchema(db);
  ensureTaskConfigSchema(db);
  ensureSystemSettingsSchema(db);
  normalizeGameAccounts(db);
  cleanupLogTables(db);
  
  await saveDatabase();

  console.log('✅ 数据库初始化完成:', dbPath);
  return db;
}

function ensureUsersSchema(db) {
  try {
    const result = db.exec("PRAGMA table_info('users')");
    const columns = new Set(
      result?.[0]?.values?.map((row) => String(row?.[1] || '').toLowerCase()) || []
    );

    if (!columns.has('is_enabled')) {
      db.run('ALTER TABLE users ADD COLUMN is_enabled INTEGER DEFAULT 1');
      db.run('UPDATE users SET is_enabled = 1 WHERE is_enabled IS NULL');
    }

    if (!columns.has('access_start_at')) {
      db.run('ALTER TABLE users ADD COLUMN access_start_at DATETIME');
    }

    if (!columns.has('access_end_at')) {
      db.run('ALTER TABLE users ADD COLUMN access_end_at DATETIME');
    }

    if (!columns.has('max_game_accounts')) {
      db.run('ALTER TABLE users ADD COLUMN max_game_accounts INTEGER DEFAULT 5');
      db.run('UPDATE users SET max_game_accounts = 5 WHERE max_game_accounts IS NULL');
    }
  } catch (error) {
    console.warn('⚠️ 检查 users 表结构失败:', error?.message || error);
  }
}

function ensureGameAccountSchema(db) {
  try {
    const result = db.exec("PRAGMA table_info('game_accounts')");
    const columns = new Set(
      result?.[0]?.values?.map((row) => String(row?.[1] || '').toLowerCase()) || []
    );
    if (!columns.has('ws_url')) {
      db.run('ALTER TABLE game_accounts ADD COLUMN ws_url TEXT');
    }
    if (!columns.has('bin_encrypted')) {
      db.run('ALTER TABLE game_accounts ADD COLUMN bin_encrypted TEXT');
    }
    if (!columns.has('bin_iv')) {
      db.run('ALTER TABLE game_accounts ADD COLUMN bin_iv TEXT');
    }
    if (!columns.has('bin_updated_at')) {
      db.run('ALTER TABLE game_accounts ADD COLUMN bin_updated_at DATETIME');
    }
  } catch (error) {
    console.warn('⚠️ 检查 game_accounts 表结构失败:', error?.message || error);
  }
}

function ensureTaskConfigSchema(db) {
  try {
    const result = db.exec("PRAGMA table_info('task_configs')");
    const columns = new Set(
      result?.[0]?.values?.map((row) => String(row?.[1] || '').toLowerCase()) || []
    );

    if (!columns.has('cron_is_customized')) {
      db.run('ALTER TABLE task_configs ADD COLUMN cron_is_customized INTEGER');
    }

    if (!columns.has('default_cron_version')) {
      db.run('ALTER TABLE task_configs ADD COLUMN default_cron_version INTEGER');
    }
  } catch (error) {
    console.warn('⚠️ 检查 task_configs 表结构失败:', error?.message || error);
  }
}

function ensureSystemSettingsSchema(db) {
  try {
    db.run(`CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    const existingSchedulerConcurrency = db.exec(
      "SELECT value FROM system_settings WHERE key = 'scheduler_max_concurrent_accounts' LIMIT 1"
    );
    const hasSchedulerConcurrency = Array.isArray(existingSchedulerConcurrency?.[0]?.values)
      && existingSchedulerConcurrency[0].values.length > 0;

    if (!hasSchedulerConcurrency) {
      const defaultValue = String(Number(config?.scheduler?.maxConcurrentAccounts) || 3);
      db.run(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ('scheduler_max_concurrent_accounts', ?, CURRENT_TIMESTAMP)`,
        [defaultValue],
      );
    }
  } catch (error) {
    console.warn('⚠️ 检查 system_settings 表结构失败:', error?.message || error);
  }
}

export function normalizeGameAccounts(targetDb = getDatabase()) {
  try {
    const duplicateGroups = all(
      `SELECT user_id, name, COUNT(*) AS total, GROUP_CONCAT(id) AS ids
       FROM game_accounts
       GROUP BY user_id, name
       HAVING COUNT(*) > 1`
    );

    duplicateGroups.forEach((group) => {
      const ids = String(group.ids || '')
        .split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
        .sort((a, b) => a - b);

      if (ids.length <= 1) {
        return;
      }

      const keepId = ids[0];
      const duplicateIds = ids.slice(1);

      duplicateIds.forEach((duplicateId) => {
        targetDb.run('UPDATE task_configs SET account_id = ? WHERE account_id = ?', [keepId, duplicateId]);
        targetDb.run('UPDATE task_logs SET account_id = ? WHERE account_id = ?', [keepId, duplicateId]);
        targetDb.run('UPDATE batch_task_logs SET account_id = ? WHERE account_id = ?', [keepId, duplicateId]);

        const keepWsConnection = get('SELECT id FROM ws_connections WHERE account_id = ?', [keepId]);
        if (keepWsConnection) {
          targetDb.run('DELETE FROM ws_connections WHERE account_id = ?', [duplicateId]);
        } else {
          targetDb.run('UPDATE ws_connections SET account_id = ? WHERE account_id = ?', [keepId, duplicateId]);
        }

        targetDb.run('DELETE FROM game_accounts WHERE id = ?', [duplicateId]);
      });
    });

    targetDb.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_game_accounts_user_name_unique ON game_accounts(user_id, name)');
  } catch (error) {
    console.warn('⚠️ 规范化 game_accounts 数据失败:', error?.message || error);
  }
}

const TASK_LOG_RETENTION_DAYS = 30;
const TASK_LOG_MAX_PER_ACCOUNT = 30;
const BATCH_LOG_MAX_PER_TASK = 2000;

export function cleanupTaskLogs(targetDb = getDatabase(), accountId = null) {
  try {
    targetDb.run(`DELETE FROM task_logs WHERE created_at < datetime('now', '-${TASK_LOG_RETENTION_DAYS} days')`);
    const accountRows = accountId
      ? [{ account_id: accountId }]
      : all('SELECT DISTINCT account_id FROM task_logs');

    accountRows.forEach((row) => {
      const normalizedAccountId = Number(row?.account_id || 0);
      if (!normalizedAccountId) return;
      targetDb.run(
        `DELETE FROM task_logs
         WHERE id IN (
           SELECT id FROM task_logs
           WHERE account_id = ?
           ORDER BY datetime(created_at) DESC, id DESC
           LIMIT -1 OFFSET ${TASK_LOG_MAX_PER_ACCOUNT}
         )`,
        [normalizedAccountId],
      );
    });
  } catch (error) {
    console.warn('⚠️ 清理 task_logs 失败:', error?.message || error);
  }
}

export function cleanupBatchTaskLogs(targetDb = getDatabase(), batchTaskId = null) {
  try {
    targetDb.run(`DELETE FROM batch_task_logs WHERE created_at < datetime('now', '-${TASK_LOG_RETENTION_DAYS} days')`);
    const taskRows = batchTaskId
      ? [{ batch_task_id: batchTaskId }]
      : all('SELECT DISTINCT batch_task_id FROM batch_task_logs');

    taskRows.forEach((row) => {
      const normalizedTaskId = Number(row?.batch_task_id || 0);
      if (!normalizedTaskId) return;
      targetDb.run(
        `DELETE FROM batch_task_logs
         WHERE id IN (
           SELECT id FROM batch_task_logs
           WHERE batch_task_id = ?
           ORDER BY datetime(created_at) DESC, id DESC
           LIMIT -1 OFFSET ${BATCH_LOG_MAX_PER_TASK}
         )`,
        [normalizedTaskId],
      );
    });
  } catch (error) {
    console.warn('⚠️ 清理 batch_task_logs 失败:', error?.message || error);
  }
}

export function cleanupLogTables(targetDb = getDatabase()) {
  cleanupTaskLogs(targetDb);
  cleanupBatchTaskLogs(targetDb);
}

export async function saveDatabase() {
  if (!db) return;
  markDatabaseDirty();
  await flushDatabaseWrites();
}

function ensurePendingSavePromise() {
  if (!pendingSavePromise) {
    pendingSavePromise = new Promise((resolve, reject) => {
      pendingSaveResolve = resolve;
      pendingSaveReject = reject;
    });
  }
  return pendingSavePromise;
}

function clearPendingSavePromise() {
  pendingSavePromise = null;
  pendingSaveResolve = null;
  pendingSaveReject = null;
}

function resolvePendingSave() {
  pendingSaveResolve?.();
  clearPendingSavePromise();
}

function rejectPendingSave(error) {
  pendingSaveReject?.(error);
  clearPendingSavePromise();
}

function clearSaveTimer() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function markDatabaseDirty() {
  if (!db) return;
  isDirty = true;
  if (!dirtySinceAt) {
    dirtySinceAt = Date.now();
  }
}

function writeDatabaseSnapshotSync() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbTempPath, buffer);
  fs.renameSync(dbTempPath, dbPath);
}

function scheduleDatabaseFlush({ immediate = false } = {}) {
  if (!db) return Promise.resolve();

  markDatabaseDirty();
  const promise = ensurePendingSavePromise();

  if (saveInFlightPromise) {
    return promise;
  }

  const now = Date.now();
  const elapsed = dirtySinceAt ? now - dirtySinceAt : 0;
  const delay = immediate
    ? 0
    : Math.min(
        SAVE_DEBOUNCE_MS,
        Math.max(0, SAVE_MAX_DELAY_MS - elapsed),
      );

  clearSaveTimer();
  saveTimer = setTimeout(() => {
    void flushDatabaseWrites().catch((error) => {
      console.error('❌ 数据库刷盘失败:', error);
      if (db && isDirty) {
        scheduleDatabaseFlush();
      }
    });
  }, delay);

  return promise;
}

export async function flushDatabaseWrites() {
  if (!db) return;
  while (true) {
    if (saveInFlightPromise) {
      await saveInFlightPromise;
      continue;
    }

    if (!isDirty) {
      resolvePendingSave();
      return;
    }

    clearSaveTimer();

    saveInFlightPromise = (async () => {
      try {
        while (db && isDirty) {
          isDirty = false;
          dirtySinceAt = 0;
          writeDatabaseSnapshotSync();
        }
        resolvePendingSave();
      } catch (error) {
        isDirty = true;
        if (!dirtySinceAt) {
          dirtySinceAt = Date.now();
        }
        rejectPendingSave(error);
        throw error;
      } finally {
        saveInFlightPromise = null;
      }
    })();

    await saveInFlightPromise;
  }
}

export function getDatabase() {
  if (!db) {
    throw new Error('数据库未初始化');
  }
  return db;
}

export async function closeDatabase() {
  if (db) {
    await flushDatabaseWrites();
    clearSaveTimer();
    db.close();
    db = null;
    isDirty = false;
    dirtySinceAt = 0;
  }
}

export function run(sql, params = []) {
  const db = getDatabase();
  db.run(sql, params);

  const normalizedSql = String(sql || '').trim().toUpperCase();
  const shouldReadLastInsertRowid =
    normalizedSql.startsWith('INSERT') || normalizedSql.startsWith('REPLACE');
  const lastInsertRowid = shouldReadLastInsertRowid
    ? (() => {
        const lastIdResult = db.exec("SELECT last_insert_rowid() as id");
        return lastIdResult.length > 0 ? lastIdResult[0].values[0][0] : null;
      })()
    : null;
  
  void scheduleDatabaseFlush();
  
  return { 
    changes: db.getRowsModified(),
    lastInsertRowid
  };
}

export function get(sql, params = []) {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function all(sql, params = []) {
  const db = getDatabase();
  const results = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export default {
  initDatabase,
  saveDatabase,
  flushDatabaseWrites,
  getDatabase,
  closeDatabase,
  run,
  get,
  all,
  normalizeGameAccounts,
  cleanupTaskLogs,
  cleanupBatchTaskLogs,
  cleanupLogTables
};
