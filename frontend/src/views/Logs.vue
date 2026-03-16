<template>
  <div class="logs-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>执行日志</span>
          <el-button @click="fetchLogs">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
      </template>
      
      <el-table :data="logs" stripe v-loading="loading">
        <el-table-column prop="account_name" label="账号" width="120" />
        <el-table-column prop="task_type" label="任务类型" width="120">
          <template #default="{ row }">
            <el-tag size="small">{{ getTaskTypeName(row.task_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'success' ? 'success' : 'danger'" size="small">
              {{ row.status === 'success' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="message" label="消息" show-overflow-tooltip />
        <el-table-column prop="created_at" label="时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
      </el-table>
      
      <el-empty v-if="logs.length === 0 && !loading" description="暂无执行日志" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import api from '@utils/api';

const logs = ref([]);
const loading = ref(false);

const taskTypeNames = {
  SIGN_IN: '每日签到',
  LEGION_SIGN: '军团签到',
  ARENA: '竞技场战斗',
  TOWER: '爬塔',
  BOSS_TOWER: '咸王宝库',
  WEIRD_TOWER: '怪异塔',
  WEIRD_TOWER_FREE_ITEM: '怪异塔免费道具',
  WEIRD_TOWER_USE_ITEM: '使用怪异塔道具',
  WEIRD_TOWER_MERGE_ITEM: '怪异塔合成',
  LEGION_BOSS: '军团BOSS',
  DAILY_BOSS: '每日咸王',
  RECRUIT: '武将招募',
  FRIEND_GOLD: '送好友金币',
  BUY_GOLD: '点金',
  FISHING: '钓鱼',
  MAIL_CLAIM: '领取邮件',
  HANGUP_CLAIM: '领取挂机奖励',
  STUDY: '答题',
  HANGUP_ADD_TIME: '一键加钟',
  BOTTLE_RESET: '重置罐子',
  BOTTLE_CLAIM: '领取罐子',
  CAR_SEND: '智能发车',
  CAR_CLAIM: '一键收车',
  BLACK_MARKET: '黑市采购',
  TREASURE_CLAIM: '珍宝阁领取',
  LEGACY_CLAIM: '残卷收取',
  WELFARE_CLAIM: '福利奖励领取',
  DAILY_TASK_CLAIM: '每日任务奖励领取',
  DREAM: '梦境',
  DREAM_PURCHASE: '购买梦境商品',
  SKIN_CHALLENGE: '换皮闯关',
  PEACH_TASK: '蟠桃园任务',
  BOX_OPEN: '批量开箱',
  LEGION_STORE_FRAGMENT: '购买四圣碎片',
  GENIE_SWEEP: '灯神扫荡'
};

const getTaskTypeName = (taskType) => {
  return taskTypeNames[taskType] || taskType;
};

const formatTime = (time) => {
  if (!time) return '-';
  const normalized = String(time).includes('T')
    ? String(time)
    : String(time).replace(' ', 'T');
  // 后端SQLite CURRENT_TIMESTAMP为UTC，这里按UTC解释再转本地时区显示
  return new Date(`${normalized}Z`).toLocaleString('zh-CN');
};

const fetchLogs = async () => {
  loading.value = true;
  try {
    const res = await api.get('/logs');
    if (res.success) {
      logs.value = res.data || [];
    }
  } catch (error) {
    console.error('获取日志失败:', error);
    ElMessage.error('获取日志失败');
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchLogs();
});
</script>

<style lang="scss" scoped>
.logs-page {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}
</style>
