<template>
  <div class="user-management-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>用户管理</span>
          <el-button type="primary" @click="openCreateDialog">新增用户</el-button>
        </div>
      </template>

      <el-table :data="users" v-loading="loading" stripe>
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column label="角色" width="100">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'danger' : 'info'">
              {{ row.role === 'admin' ? '管理员' : '普通用户' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="140">
          <template #default="{ row }">
            <el-tag :type="getUserStatusType(row)">
              {{ getUserStatusText(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="可用时间" min-width="260">
          <template #default="{ row }">
            <div class="time-window">
              <div>开始：{{ formatTime(row.access_start_at) || '不限' }}</div>
              <div>结束：{{ formatTime(row.access_end_at) || '不限' }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="已导入游戏账号" width="130" align="center">
          <template #default="{ row }">
            {{ row.game_account_count || 0 }} / {{ row.max_game_accounts || '不限' }}
          </template>
        </el-table-column>
        <el-table-column label="最后登录" width="180">
          <template #default="{ row }">
            {{ formatTime(row.last_login) || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.created_at) || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button
              link
              :type="row.is_enabled ? 'warning' : 'success'"
              @click="quickToggle(row)"
              :disabled="isCurrentUser(row)"
            >
              {{ row.is_enabled ? '禁用' : '启用' }}
            </el-button>
            <el-button
              link
              type="danger"
              @click="deleteUser(row)"
              :disabled="isCurrentUser(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="isEditing ? '编辑用户' : '新增用户'"
      width="520px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" maxlength="20" show-word-limit />
        </el-form-item>
        <el-form-item :label="isEditing ? '新密码' : '密码'" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="isEditing ? '留空则不修改密码' : '请输入密码'"
            show-password
          />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-radio-group v-model="form.role">
            <el-radio label="user">普通用户</el-radio>
            <el-radio label="admin">管理员</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="启用账号" prop="is_enabled">
          <el-switch v-model="form.is_enabled" />
        </el-form-item>
        <el-form-item label="账号数量上限">
          <div class="limit-setting">
            <el-switch v-model="form.limit_enabled" />
            <span class="limit-setting-text">{{ form.limit_enabled ? '启用限制' : '不限数量' }}</span>
          </div>
          <el-input-number
            v-if="form.limit_enabled"
            v-model="form.max_game_accounts"
            :min="1"
            :max="9999"
            style="width: 100%; margin-top: 8px"
            controls-position="right"
          />
          <div class="form-tip">默认上限为 5。你也可以关闭限制，允许该用户不限数量。</div>
        </el-form-item>
        <el-form-item label="开始可用">
          <el-date-picker
            v-model="form.access_start_at"
            type="datetime"
            placeholder="不限制开始时间"
            style="width: 100%"
            clearable
            value-format="YYYY-MM-DD HH:mm:ss"
          />
        </el-form-item>
        <el-form-item label="结束可用">
          <el-date-picker
            v-model="form.access_end_at"
            type="datetime"
            placeholder="不限制结束时间"
            style="width: 100%"
            clearable
            value-format="YYYY-MM-DD HH:mm:ss"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">
          {{ isEditing ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@utils/api';
import { useAuthStore } from '@stores/auth';

const authStore = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const users = ref([]);
const formRef = ref();

const createEmptyForm = () => ({
  username: '',
  password: '',
  role: 'user',
  is_enabled: true,
  limit_enabled: true,
  max_game_accounts: 5,
  access_start_at: null,
  access_end_at: null
});

const form = reactive(createEmptyForm());

const passwordValidator = (rule, value, callback) => {
  if (!isEditing.value && !value) {
    callback(new Error('请输入密码'));
    return;
  }
  if (value && value.length < 6) {
    callback(new Error('密码至少 6 位'));
    return;
  }
  callback();
};

const timeValidator = (rule, value, callback) => {
  if (form.access_start_at && form.access_end_at) {
    const start = new Date(form.access_start_at).getTime();
    const end = new Date(form.access_end_at).getTime();
    if (start > end) {
      callback(new Error('开始时间不能晚于结束时间'));
      return;
    }
  }
  callback();
};

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度需要在 3-20 个字符之间', trigger: 'blur' }
  ],
  password: [{ validator: passwordValidator, trigger: 'blur' }],
  access_start_at: [{ validator: timeValidator, trigger: 'change' }],
  access_end_at: [{ validator: timeValidator, trigger: 'change' }]
};

const currentUserId = computed(() => Number(authStore.user?.id || 0));

const resetForm = () => {
  Object.assign(form, createEmptyForm());
  editingId.value = null;
  isEditing.value = false;
  formRef.value?.clearValidate?.();
};

const toPickerValue = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (num) => String(num).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + ' ' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(':');
};

const formatTime = (value) => {
  if (!value) return '';
  const text = String(value);
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString('zh-CN', { hour12: false });
};

const getUserStatusText = (row) => {
  if (!row.is_enabled) return '已禁用';
  const now = Date.now();
  if (row.access_start_at && now < new Date(row.access_start_at).getTime()) return '未到开始时间';
  if (row.access_end_at && now > new Date(row.access_end_at).getTime()) return '已过期';
  return '可用';
};

const getUserStatusType = (row) => {
  if (!row.is_enabled) return 'danger';
  const text = getUserStatusText(row);
  if (text === '可用') return 'success';
  if (text === '未到开始时间') return 'warning';
  return 'info';
};

const isCurrentUser = (row) => Number(row.id) === currentUserId.value;

const fetchUsers = async () => {
  loading.value = true;
  try {
    const res = await api.get('/admin/users');
    if (res.success) {
      users.value = res.data;
    }
  } finally {
    loading.value = false;
  }
};

const openCreateDialog = () => {
  resetForm();
  dialogVisible.value = true;
};

const openEditDialog = (row) => {
  resetForm();
  isEditing.value = true;
  editingId.value = row.id;
  Object.assign(form, {
    username: row.username,
    password: '',
    role: row.role || 'user',
    is_enabled: !!row.is_enabled,
    limit_enabled: !!row.max_game_accounts,
    max_game_accounts: row.max_game_accounts || null,
    access_start_at: toPickerValue(row.access_start_at),
    access_end_at: toPickerValue(row.access_end_at)
  });
  dialogVisible.value = true;
};

const buildPayload = () => ({
  username: form.username.trim(),
  password: form.password,
  role: form.role,
  isEnabled: form.is_enabled,
  maxGameAccounts: form.limit_enabled ? (form.max_game_accounts || 5) : null,
  accessStartAt: form.access_start_at || null,
  accessEndAt: form.access_end_at || null
});

watch(
  () => form.limit_enabled,
  (enabled) => {
    if (enabled && !form.max_game_accounts) {
      form.max_game_accounts = 5;
    }
  }
);

const submitForm = async () => {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();
    saving.value = true;

    const payload = buildPayload();
    if (isEditing.value && !payload.password) {
      delete payload.password;
    }

    const res = isEditing.value
      ? await api.put(`/admin/users/${editingId.value}`, payload)
      : await api.post('/admin/users', payload);

    if (res.success) {
      ElMessage.success(isEditing.value ? '用户更新成功' : '用户创建成功');
      dialogVisible.value = false;
      resetForm();
      if (isCurrentUser({ id: editingId.value })) {
        await authStore.fetchUser();
      }
      await fetchUsers();
    }
  } catch (error) {
    if (error !== false) {
      ElMessage.error(error.response?.data?.error || '保存失败');
    }
  } finally {
    saving.value = false;
  }
};

const quickToggle = async (row) => {
  try {
    const res = await api.put(`/admin/users/${row.id}`, {
      isEnabled: !row.is_enabled
    });
    if (res.success) {
      ElMessage.success(!row.is_enabled ? '用户已启用' : '用户已禁用');
      await fetchUsers();
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '操作失败');
  }
};

const deleteUser = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定删除用户「${row.username}」吗？该用户下的游戏账号和任务数据也会一并删除。`,
      '删除确认',
      { type: 'warning' }
    );
    const res = await api.delete(`/admin/users/${row.id}`);
    if (res.success) {
      ElMessage.success('删除成功');
      await fetchUsers();
    }
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error.response?.data?.error || '删除失败');
    }
  }
};

onMounted(() => {
  fetchUsers();
});
</script>

<style scoped>
.user-management-page {
  padding: 20px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.time-window {
  line-height: 1.6;
  color: #606266;
}

.form-tip {
  margin-top: 6px;
  line-height: 1.5;
  font-size: 12px;
  color: #909399;
}

.limit-setting {
  display: flex;
  align-items: center;
  gap: 8px;
}

.limit-setting-text {
  color: #606266;
}
</style>
