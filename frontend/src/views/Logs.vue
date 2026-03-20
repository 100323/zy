<template>
  <div class="logs-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <div>
            <span>执行日志</span>
            <div class="header-tip">按游戏账号查看最近 30 条执行记录</div>
          </div>
          <el-button @click="refreshCurrentView" :loading="loading">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
      </template>

      <div class="filter-bar">
        <span class="filter-label">游戏账号</span>
        <el-select
          v-model="selectedAccountId"
          class="account-select"
          placeholder="请选择游戏账号"
          filterable
          clearable
          :loading="accountsLoading"
          @change="handleAccountChange"
        >
          <el-option
            v-for="account in accounts"
            :key="account.id"
            :label="account.name"
            :value="account.id"
          />
        </el-select>
      </div>

      <el-skeleton v-if="loading" :rows="6" animated />

      <template v-else>
        <el-empty
          v-if="accounts.length === 0"
          description="暂无游戏账号"
        />

        <el-empty
          v-else-if="!selectedAccountId"
          description="请选择要查看日志的游戏账号"
        />

        <el-empty
          v-else-if="logs.length === 0"
          description="当前账号暂无执行记录"
        />

        <div v-else class="log-list-wrap">
          <div class="account-summary">
            <span class="account-name">{{ currentAccountName }}</span>
            <span class="log-count">当前显示最近 {{ logs.length }} 条记录</span>
          </div>

          <div class="log-items">
            <div
              v-for="log in logs"
              :key="log.id"
              class="log-item"
            >
              <div class="log-item-header">
                <div class="log-left">
                  <el-tag
                    size="small"
                    :type="getLogStatusType(log.status)"
                  >
                    {{ getLogStatusText(log.status) }}
                  </el-tag>
                  <span class="log-time">{{ formatTime(log.created_at) }}</span>
                </div>
                <div class="log-right">
                  <span class="task-type">{{ getTaskLabel(log.task_type) }}</span>
                </div>
              </div>
              <div class="log-message">{{ log.message || '-' }}</div>
            </div>
          </div>
        </div>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import api from '@utils/api';

const accounts = ref([]);
const accountsLoading = ref(false);
const loading = ref(false);
const selectedAccountId = ref(null);
const logs = ref([]);

const currentAccountName = computed(() => {
  const currentAccount = accounts.value.find((account) => account.id === selectedAccountId.value);
  return currentAccount?.name || '未选择账号';
});

const getTaskLabel = (taskType) => {
  return taskType || '-';
};

const getLogStatusType = (status) => {
  if (status === 'success') return 'success';
  if (status === 'ignored') return 'info';
  return 'danger';
};

const getLogStatusText = (status) => {
  if (status === 'success') return '成功';
  if (status === 'ignored') return '已忽略';
  return '失败';
};

const formatTime = (time) => {
  if (!time) return '-';

  const raw = String(time).trim();
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized);
  const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);

  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString('zh-CN');
};

const fetchAccounts = async () => {
  accountsLoading.value = true;
  try {
    const res = await api.get('/accounts');
    if (res.success) {
      accounts.value = res.data || [];
      if (!selectedAccountId.value && accounts.value.length > 0) {
        selectedAccountId.value = accounts.value[0].id;
      } else if (
        selectedAccountId.value &&
        !accounts.value.some((account) => account.id === selectedAccountId.value)
      ) {
        selectedAccountId.value = accounts.value[0]?.id || null;
      }
    }
  } catch (error) {
    console.error('获取账号失败:', error);
    ElMessage.error('获取账号失败');
  } finally {
    accountsLoading.value = false;
  }
};

const fetchLogs = async () => {
  if (!selectedAccountId.value) {
    logs.value = [];
    return;
  }

  loading.value = true;
  try {
    const res = await api.get('/logs', {
      params: {
        accountId: selectedAccountId.value,
        limit: 30,
      },
    });

    if (res.success) {
      logs.value = Array.isArray(res.data) ? res.data : [];
    } else {
      logs.value = [];
    }
  } catch (error) {
    console.error('获取日志失败:', error);
    logs.value = [];
    ElMessage.error('获取日志失败');
  } finally {
    loading.value = false;
  }
};

const handleAccountChange = () => {
  fetchLogs();
};

const refreshCurrentView = async () => {
  await fetchAccounts();
  await fetchLogs();
};

onMounted(async () => {
  await fetchAccounts();
  await fetchLogs();
});
</script>

<style lang="scss" scoped>
.logs-page {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }

  .header-tip {
    margin-top: 4px;
    font-size: 12px;
    color: #909399;
  }

  .filter-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }

  .filter-label {
    font-size: 14px;
    color: #606266;
    white-space: nowrap;
  }

  .account-select {
    width: 320px;
    max-width: 100%;
  }

  .account-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    gap: 12px;
    flex-wrap: wrap;
  }

  .account-name {
    font-size: 16px;
    font-weight: 600;
    color: #303133;
  }

  .log-count {
    font-size: 13px;
    color: #909399;
  }

  .log-items {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .log-item {
    border: 1px solid #ebeef5;
    border-radius: 10px;
    padding: 14px 16px;
    background: #fff;
  }

  .log-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }

  .log-left,
  .log-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .log-time,
  .task-type {
    font-size: 13px;
    color: #909399;
  }

  .log-message {
    color: #303133;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
  }
}
</style>
