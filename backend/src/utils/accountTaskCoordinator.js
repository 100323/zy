import config from '../config/index.js';

const accountTaskChains = new Map();
const accountClients = new Map();
const queuedAccounts = [];
let activeAccountExecutions = 0;

function normalizeAccountId(accountId) {
  return String(accountId);
}

function getMaxConcurrentAccounts() {
  const value = Number(config?.scheduler?.maxConcurrentAccounts || 0);
  return Number.isFinite(value) && value > 0 ? value : 5;
}

function dispatchQueuedAccounts() {
  const limit = getMaxConcurrentAccounts();
  while (activeAccountExecutions < limit && queuedAccounts.length > 0) {
    const queued = queuedAccounts.shift();
    activeAccountExecutions += 1;
    queued.resolve();
  }
}

async function acquireGlobalAccountSlot(accountId) {
  const key = normalizeAccountId(accountId);
  const limit = getMaxConcurrentAccounts();

  if (activeAccountExecutions < limit) {
    activeAccountExecutions += 1;
    return;
  }

  await new Promise((resolve) => {
    queuedAccounts.push({
      accountId: key,
      queuedAt: Date.now(),
      resolve,
    });
  });
}

function releaseGlobalAccountSlot() {
  activeAccountExecutions = Math.max(0, activeAccountExecutions - 1);
  dispatchQueuedAccounts();
}

export async function runAccountTaskExclusive(accountId, taskExecutor) {
  const key = normalizeAccountId(accountId);
  const previous = accountTaskChains.get(key) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      await acquireGlobalAccountSlot(key);
      try {
        return await taskExecutor();
      } finally {
        releaseGlobalAccountSlot();
      }
    });

  accountTaskChains.set(key, current);
  try {
    return await current;
  } finally {
    if (accountTaskChains.get(key) === current) {
      accountTaskChains.delete(key);
    }
  }
}

export function isAccountTaskRunning(accountId) {
  return accountTaskChains.has(normalizeAccountId(accountId));
}

export function registerAccountClient(accountId, client) {
  if (!client) return;
  const key = normalizeAccountId(accountId);
  const existingSet = accountClients.get(key) || new Set();

  for (const existingClient of existingSet) {
    if (existingClient === client) continue;
    try {
      existingClient.disconnect?.();
    } catch {
      // ignore
    }
    existingSet.delete(existingClient);
  }

  existingSet.add(client);
  accountClients.set(key, existingSet);
}

export function unregisterAccountClient(accountId, client = null) {
  const key = normalizeAccountId(accountId);
  if (!accountClients.has(key)) {
    return;
  }

  if (!client) {
    accountClients.delete(key);
    return;
  }

  const clientSet = accountClients.get(key);
  clientSet.delete(client);
  if (clientSet.size === 0) {
    accountClients.delete(key);
  }
}

export function getAccountTaskCoordinatorStatus() {
  return {
    maxConcurrentAccounts: getMaxConcurrentAccounts(),
    activeAccountExecutions,
    queuedAccountExecutions: queuedAccounts.length,
    runningAccountChains: accountTaskChains.size,
    queuedAccounts: queuedAccounts.map((item) => item.accountId),
  };
}

export function clearAccountTaskCoordinator() {
  accountTaskChains.clear();
  accountClients.clear();
  queuedAccounts.length = 0;
  activeAccountExecutions = 0;
}
