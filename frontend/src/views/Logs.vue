<template>
  <div class="logs-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <div>
            <span>执行日志</span>
            <div class="header-tip">按游戏账号查看定时任务日志，每个任务显示最新 10 条记录</div>
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

      <el-skeleton v-if="loading" :rows="5" animated />

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
          v-else-if="taskGroups.length === 0"
          description="当前账号暂无定时任务或执行记录"
        />

        <div v-else class="task-log-list">
          <div class="account-summary">
            <span class="account-name">{{ currentAccountName }}</span>
            <span class="task-count">共 {{ taskGroups.length }} 个定时任务</span>
          </div>

          <div class="task-sections">
            <div
              v-for="task in taskGroups"
              :key="task.taskType"
              class="task-section"
            >
              <div class="task-header">
                <div class="task-title-wrap">
                  <span class="task-title">{{ task.taskName }}</span>
                  <el-tag size="small" type="info" effect="plain">
                    下次执行：{{ formatTime(task.nextRunAt) }}
                  </el-tag>
                </div>
                <div class="task-meta">
                  <span>最新 {{ task.logs.length }} 条</span>
                  <el-button
                    link
                    type="primary"
                    @click="toggleTaskExpanded(task.taskType)"
                  >
                    {{ isTaskExpanded(task.taskType) ? '收起' : '展开' }}
                  </el-button>
                </div>
              </div>

              <div v-if="isTaskExpanded(task.taskType)" class="task-body">
                <div v-if="task.logs.length === 0" class="empty-task-log">
                  暂无执行记录
                </div>

                <div v-else class="log-items">
                  <div
                    v-for="log in task.logs"
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
                    </div>
                    <div class="log-message">{{ log.message || '-' }}</div>
                  </div>
                </div>
              </div>
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
const taskGroups = ref([]);
const expandedTaskTypes = ref([]);

const currentAccountName = computed(() => {
  const currentAccount = accounts.value.find((account) => account.id === selectedAccountId.value);
  return currentAccount?.name || '未选择账号';
});

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

const fetchGroupedLogs = async () => {
  if (!selectedAccountId.value) {
    taskGroups.value = [];
    expandedTaskTypes.value = [];
    return;
  }

  loading.value = true;
  try {
    const res = await api.get(`/logs/account/${selectedAccountId.value}/grouped`);
    if (res.success) {
      taskGroups.value = res.data?.tasks || [];
      expandedTaskTypes.value = [];
    }
  } catch (error) {
    console.error('获取日志失败:', error);
    taskGroups.value = [];
    expandedTaskTypes.value = [];
    ElMessage.error('获取日志失败');
  } finally {
    loading.value = false;
  }
};

const handleAccountChange = () => {
  fetchGroupedLogs();
};

const isTaskExpanded = (taskType) => expandedTaskTypes.value.includes(taskType);

const toggleTaskExpanded = (taskType) => {
  if (isTaskExpanded(taskType)) {
    expandedTaskTypes.value = expandedTaskTypes.value.filter((item) => item !== taskType);
  } else {
    expandedTaskTypes.value = [...expandedTaskTypes.value, taskType];
  }
};

const refreshCurrentView = async () => {
  await fetchAccounts();
  await fetchGroupedLogs();
};

onMounted(async () => {
  await fetchAccounts();
  await fetchGroupedLogs();
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

  .task-count {
    font-size: 13px;
    color: #909399;
  }

  .task-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid #ebeef5;
  }

  .task-title-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .task-title {
    font-weight: 600;
    color: #303133;
  }

  .task-meta {
    font-size: 12px;
    color: #909399;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .empty-task-log {
    color: #909399;
    padding: 8px 0;
  }

  .task-sections {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .task-section {
    border: 1px solid #ebeef5;
    border-radius: 10px;
    overflow: hidden;
    background: #fff;
  }

  .task-body {
    padding: 16px 18px;
  }

  .log-items {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .log-item {
    border: 1px solid #ebeef5;
    border-radius: 8px;
    padding: 12px;
    background: #fafafa;
  }

  .log-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .log-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .log-time {
    font-size: 12px;
    color: #909399;
  }

  .log-message {
    color: #303133;
    line-height: 1.6;
    word-break: break-all;
  }
}
</style>
