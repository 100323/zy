<template>
  <div class="token-import-page">
    <el-card class="header-card">
      <div class="page-header">
        <div class="header-left">
          <h2>账号管理</h2>
          <p>
            管理您的所有游戏账号
            <template v-if="accountLimitText">
              （{{ accountLimitText }}）
            </template>
          </p>
        </div>
        <div class="header-right">
          <el-button type="primary" :disabled="accountLimitReached" @click="openImportForm">
            <el-icon><Plus /></el-icon>
            添加账号
          </el-button>
        </div>
      </div>
    </el-card>

    <el-alert
      v-if="accountLimitReached"
      type="warning"
      show-icon
      :closable="false"
      class="limit-alert"
      :title="`你当前最多可添加 ${maxGameAccounts} 个游戏账号，已达到上限。若需继续添加，请在用户管理中调整上限。`"
    />

    <a-modal
      class="token-import-modal"
      v-model:visible="showImportForm"
      width="40rem"
      :footer="false"
      :default-visible="!tokenStore.hasTokens"
    >
      <template #title>
        <h2 class="modal-title">
          <n-icon>
            <Add />
          </n-icon>
          添加游戏账号
        </h2>
      </template>
      <div class="card-header">
        <n-radio-group
          v-model:value="importMethod"
          class="import-method-tabs"
          size="small"
        >
          <n-radio-button value="manual"> 手动输入 </n-radio-button>
          <n-radio-button value="url"> URL获取 </n-radio-button>
          <n-radio-button value="wxQrcode"> 微信扫码 </n-radio-button>
          <n-radio-button value="bin"> BIN多角色 </n-radio-button>
          <n-radio-button value="singlebin"> BIN单角色 </n-radio-button>
        </n-radio-group>
      </div>
      <div class="card-body">
        <ManualTokenForm
          @cancel="() => (showImportForm = false)"
          @ok="() => (showImportForm = false)"
          v-if="importMethod === 'manual'"
        />
        <UrlTokenForm
          @cancel="() => (showImportForm = false)"
          @ok="() => (showImportForm = false)"
          v-if="importMethod === 'url'"
        />
        <WxQrcodeForm
          @cancel="() => (showImportForm = false)"
          @ok="() => (showImportForm = false)"
          v-if="importMethod === 'wxQrcode'"
        />
        <BinTokenForm
          @cancel="() => (showImportForm = false)"
          @ok="() => (showImportForm = false)"
          v-if="importMethod === 'bin'"
        />
        <SingleBinTokenForm
          @cancel="() => (showImportForm = false)"
          @ok="() => (showImportForm = false)"
          v-if="importMethod === 'singlebin'"
        />
      </div>
    </a-modal>

    <template v-if="tokenStore.hasTokens">
      <el-row :gutter="16" class="token-cards">
        <el-col :xs="24" :sm="12" :md="8" :lg="6" v-for="token in tokenStore.gameTokens" :key="token.id">
          <el-card class="token-card" :class="{ active: selectedTokenId === token.id }" @click="selectToken(token)">
            <div class="token-header">
              <div class="token-info">
                <el-avatar :size="40" :src="token.avatar || '/icons/xiaoyugan.png'">
                  <img src="/icons/xiaoyugan.png" alt="avatar" />
                </el-avatar>
                <div class="token-details">
                  <div class="token-name">{{ token.name }}</div>
                  <div class="token-meta">
                    <el-tag size="small" :type="getServerTagType(token.id)" v-if="token.server">
                      {{ token.server }}
                    </el-tag>
                    <el-tag size="small" :type="getTokenStatusType(token.id)">
                      {{ getConnectionStatusText(token.id) }}
                    </el-tag>
                  </div>
                </div>
              </div>
              <el-dropdown @command="(cmd) => handleTokenAction(cmd, token)" trigger="click">
                <el-button text circle @click.stop>
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">
                      <el-icon><Edit /></el-icon>编辑
                    </el-dropdown-item>
                    <el-dropdown-item command="copy">
                      <el-icon><CopyDocument /></el-icon>复制Token
                    </el-dropdown-item>
                    <el-dropdown-item command="refresh">
                      <el-icon><Refresh /></el-icon>刷新
                    </el-dropdown-item>
                    <el-dropdown-item command="backend-test">
                      <el-icon><RefreshIcon /></el-icon>后端连接测试
                    </el-dropdown-item>
                    <el-dropdown-item divided command="delete">
                      <el-icon><Delete /></el-icon>删除
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>

            <div class="token-body">
              <div class="info-item">
                <span class="label">Token:</span>
                <span class="value">{{ maskToken(token.token) }}</span>
              </div>
              <div class="info-item" v-if="token.remark">
                <span class="label">备注:</span>
                <span class="value">{{ token.remark }}</span>
              </div>
              <div class="info-item">
                <span class="label">创建时间:</span>
                <span class="value">{{ formatTime(token.createdAt) }}</span>
              </div>
              <div class="info-item">
                <span class="label">最后使用:</span>
                <span class="value">{{ formatTime(token.lastUsed) }}</span>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </template>

    <el-empty v-else description="暂无游戏账号" :image-size="200">
      <el-button type="primary" @click="showImportForm = true">添加第一个账号</el-button>
    </el-empty>

    <n-modal
      v-model:show="showEditModal"
      preset="card"
      title="编辑账号"
      style="width: 500px"
    >
      <n-form
        ref="editFormRef"
        :model="editForm"
        :rules="editRules"
        label-placement="left"
        label-width="80px"
      >
        <n-form-item label="名称" path="name">
          <n-input v-model:value="editForm.name" />
        </n-form-item>
        <n-form-item label="Token字符串" path="token">
          <n-input
            v-model:value="editForm.token"
            type="textarea"
            :rows="3"
            placeholder="粘贴Token字符串..."
            clearable
          />
        </n-form-item>
        <n-form-item label="服务器">
          <n-input v-model:value="editForm.server" />
        </n-form-item>
        <n-form-item label="WebSocket地址">
          <n-input v-model:value="editForm.wsUrl" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input
            v-model:value="editForm.remark"
            type="textarea"
            :rows="2"
            placeholder="添加备注信息..."
          />
        </n-form-item>
      </n-form>

      <template #footer>
        <div class="modal-actions">
          <n-button @click="showEditModal = false"> 取消 </n-button>
          <n-button type="primary" @click="saveEdit"> 保存 </n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { useTokenStore, selectedTokenId } from "@/stores/tokenStore";
import { Add } from "@vicons/ionicons5";
import { Plus, MoreFilled, Edit, CopyDocument, Delete, Refresh as RefreshIcon } from '@element-plus/icons-vue';
import { NIcon, useDialog, useMessage } from "naive-ui";
import { computed, defineAsyncComponent, h, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { transformToken } from "@/utils/token";
import useIndexedDB from "@/hooks/useIndexedDB";
import api from "@utils/api";
import { useAuthStore } from "@stores/auth";

const ManualTokenForm = defineAsyncComponent(() => import("./manual.vue"));
const UrlTokenForm = defineAsyncComponent(() => import("./url.vue"));
const BinTokenForm = defineAsyncComponent(() => import("./bin.vue"));
const SingleBinTokenForm = defineAsyncComponent(() => import("./singlebin.vue"));
const WxQrcodeForm = defineAsyncComponent(() => import("./wxqrcode.vue"));

const { getArrayBuffer, storeArrayBuffer, deleteArrayBuffer } = useIndexedDB();

const props = defineProps({
  token: String,
  name: String,
  server: String,
  wsUrl: String,
  api: String,
  auto: Boolean,
});

const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const tokenStore = useTokenStore();
const authStore = useAuthStore();

const showImportForm = ref(false);
const showEditModal = ref(false);
const editFormRef = ref(null);
const editingToken = ref(null);
const importMethod = ref("manual");
const connectingTokens = ref(new Set());

const editForm = reactive({
  name: "",
  token: "",
  server: "",
  wsUrl: "",
  remark: "",
});

const editRules = {
  name: [{ required: true, message: "请输入账号名称", trigger: "blur" }],
  token: [{ required: true, message: "请输入Token字符串", trigger: "blur" }],
};

const maxGameAccounts = computed(() => {
  const raw = authStore.user?.max_game_accounts;
  if (raw === null || raw === undefined || raw === '') return null;
  const normalized = Number(raw);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
});

const accountLimitReached = computed(() => {
  return maxGameAccounts.value !== null && tokenStore.gameTokens.length >= maxGameAccounts.value;
});

const accountLimitText = computed(() => {
  if (maxGameAccounts.value === null) {
    return `已添加 ${tokenStore.gameTokens.length} 个账号，不限数量`;
  }
  return `已添加 ${tokenStore.gameTokens.length}/${maxGameAccounts.value} 个账号`;
});

const openImportForm = () => {
  if (accountLimitReached.value) {
    message.warning(`当前账号最多只能添加 ${maxGameAccounts.value} 个游戏账号，已达到上限`);
    return;
  }
  showImportForm.value = true;
};

const maskToken = (token) => {
  if (!token) return "";
  const len = token.length;
  if (len <= 8) return token;
  return token.substring(0, 4) + "***" + token.substring(len - 4);
};

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleString("zh-CN");
};

const getConnectionStatus = (tokenId) => {
  return tokenStore.getWebSocketStatus(tokenId);
};

const getConnectionStatusText = (tokenId) => {
  const status = getConnectionStatus(tokenId);
  const statusMap = {
    connected: "已连接",
    connecting: "连接中...",
    disconnected: "已断开",
    error: "连接错误",
    disconnecting: "断开中...",
  };
  return statusMap[status] || "未连接";
};

const getTokenStatusType = (tokenId) => {
  const status = getConnectionStatus(tokenId);
  const statusMap = {
    connected: "success",
    connecting: "warning",
    disconnected: "info",
    error: "danger",
    disconnecting: "warning",
  };
  return statusMap[status] || "info";
};

const getServerTagType = (tokenId) => {
  const status = getConnectionStatus(tokenId);
  return status === "connected" ? "success" : "info";
};

const handleTokenAction = async (action, token) => {
  switch (action) {
    case "edit":
      editToken(token);
      break;
    case "copy":
      copyToken(token);
      break;
    case "refresh":
      refreshToken(token);
      break;
    case "backend-test":
      testBackendConnection(token);
      break;
    case "delete":
      deleteToken(token);
      break;
  }
};

const testBackendConnection = async (token) => {
  try {
    const accountId = String(token.id || "");
    if (!/^\d+$/.test(accountId)) {
      message.warning("该账号尚未同步到后端，无法进行后端连接测试");
      return;
    }

    message.info(`正在测试后端连接: ${token.name}`);
    const res = await api.post(
      `/accounts/${accountId}/test-connection`,
      {
        timeout: 30000,
        token: token.token || "",
        wsUrl: token.wsUrl || "",
        persist: true,
      },
      { timeout: 30000 }
    );
    if (res?.success) {
      const elapsed = res?.data?.elapsedMs != null ? `${res.data.elapsedMs}ms` : "未知耗时";
      message.success(`后端连接成功 (${elapsed})`);
    } else {
      message.error(res?.error || "后端连接测试失败");
    }
  } catch (error) {
    message.error(error?.response?.data?.error || error?.message || "后端连接测试失败");
  }
};

const editToken = (token) => {
  editingToken.value = token;
  Object.assign(editForm, {
    name: token.name,
    token: token.token,
    server: token.server || "",
    wsUrl: token.wsUrl || "",
    remark: token.remark || "",
  });
  showEditModal.value = true;
};

const saveEdit = async () => {
  if (!editFormRef.value || !editingToken.value) return;

  try {
    await editFormRef.value.validate();

    tokenStore.updateToken(editingToken.value.id, {
      name: editForm.name,
      token: editForm.token,
      server: editForm.server,
      wsUrl: editForm.wsUrl,
      remark: editForm.remark,
    });

    const accountId = String(editingToken.value.id || "");
    if (/^\d+$/.test(accountId)) {
      try {
        await api.put(`/accounts/${accountId}`, {
          name: editForm.name,
          token: editForm.token,
          server: editForm.server,
          wsUrl: editForm.wsUrl,
          remark: editForm.remark,
        });
      } catch (error) {
        message.warning("账号已更新，但同步后端失败");
      }
    }

    message.success("账号信息已更新");
    showEditModal.value = false;
    editingToken.value = null;
  } catch (error) {
    // 验证失败
  }
};

const copyToken = async (token) => {
  try {
    await navigator.clipboard.writeText(token.token);
    message.success("Token已复制到剪贴板");
  } catch (error) {
    message.error("复制失败");
  }
};

const refreshToken = async (token) => {
  try {
    if (token.importMethod === "url") {
      let response;

      const isLocalUrl =
        token.sourceUrl.startsWith(window.location.origin) ||
        token.sourceUrl.startsWith("/") ||
        token.sourceUrl.startsWith("http://localhost") ||
        token.sourceUrl.startsWith("http://127.0.0.1");

      if (isLocalUrl) {
        response = await fetch(token.sourceUrl);
      } else {
        try {
          response = await fetch(token.sourceUrl, {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
            mode: "cors",
          });
        } catch (corsError) {
          throw new Error(
            `跨域请求被阻止。请确保目标服务器支持CORS。错误详情: ${corsError.message}`,
          );
        }
      }

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.token) {
        throw new Error("返回数据中未找到token字段");
      }

      tokenStore.updateToken(token.id, {
        token: data.token,
        server: data.server || token.server,
        lastRefreshed: Date.now(),
      });
      const accountId = String(token.id || "");
      if (/^\d+$/.test(accountId)) {
        try {
          await api.put(`/accounts/${accountId}`, {
            token: data.token,
            server: data.server || token.server,
            wsUrl: token.wsUrl || "",
            remark: token.remark || "",
          });
        } catch {
          // 忽略同步失败
        }
      }

      message.success("Token刷新成功");
    } else if (
      token.importMethod === "wxQrcode" ||
      token.importMethod === "bin"
    ) {
      const candidateKeys = Array.from(
        new Set(
          [
            token.id,
            token.storageKey,
            ...(Array.isArray(token.legacyStorageKeys) ? token.legacyStorageKeys : []),
            token.name,
          ]
            .map((key) => String(key || "").trim())
            .filter(Boolean),
        ),
      );

      let userToken = null;
      let matchedKey = null;
      for (const key of candidateKeys) {
        userToken = await getArrayBuffer(key);
        if (userToken) {
          matchedKey = key;
          break;
        }
      }
      if (userToken) {
        const newToken = await transformToken(userToken);
        tokenStore.updateToken(token.id, {
          token: newToken,
          lastRefreshed: Date.now(),
          storageKey: token.id,
          legacyStorageKeys: Array.from(
            new Set(
              [
                ...(Array.isArray(token.legacyStorageKeys) ? token.legacyStorageKeys : []),
                token.storageKey,
                matchedKey,
              ]
                .map((key) => String(key || "").trim())
                .filter(Boolean),
            ),
          ),
        });
        const accountId = String(token.id || "");
        if (/^\d+$/.test(accountId)) {
          try {
            await api.put(`/accounts/${accountId}`, {
              token: newToken,
              wsUrl: token.wsUrl || "",
              remark: token.remark || "",
            });
          } catch {
            // 忽略同步失败
          }
        }
        if (matchedKey && matchedKey !== token.id) {
          await storeArrayBuffer(token.id, userToken);
          await deleteArrayBuffer(matchedKey);
        }
        message.success("Token刷新成功");
      } else {
        throw new Error(`未找到可用于刷新的BIN数据，已尝试: ${candidateKeys.join(", ")}`);
      }
    } else {
      message.info("该Token需要手动刷新");
    }

    if (tokenStore.getWebSocketStatus(token.id) === "connected") {
      tokenStore.closeWebSocketConnection(token.id);
      setTimeout(() => {
        tokenStore.createWebSocketConnection(
          token.id,
          token.token,
          token.wsUrl,
        );
      }, 500);
    }
  } catch (error) {
    console.error("刷新Token失败:", error);
    message.error(error.message || "Token刷新失败");
  }
};

const selectToken = (token) => {
  const isAlreadySelected = selectedTokenId.value === token.id;
  const connectionStatus = getConnectionStatus(token.id);

  if (
    isAlreadySelected &&
    connectionStatus === "connected"
  ) {
    tokenStore.closeWebSocketConnection(token.id);
    message.success(`已断开 ${token.name} 的连接`);
    return;
  }

  if (
    !isAlreadySelected &&
    connectionStatus === "connected"
  ) {
    tokenStore.closeWebSocketConnection(token.id);
    message.success(`已断开 ${token.name} 的连接`);
    return;
  }

  if (
    isAlreadySelected &&
    connectionStatus === "connecting"
  ) {
    message.info(`${token.name} 正在连接中...`);
    return;
  }

  const result = tokenStore.selectToken(token.id);

  if (result) {
    if (isAlreadySelected) {
      message.success(`重新连接：${token.name}`);
    } else {
      message.success(`已选择：${token.name}`);
    }
  } else {
    message.error(`选择账号失败：${token.name}`);
  }
};

const deleteToken = (token) => {
  dialog.warning({
    title: "删除账号",
    content: `确定要删除账号 "${token.name}" 吗？此操作无法恢复。`,
    positiveText: "确定删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      await tokenStore.removeToken(token.id);
      message.success("账号已删除");
    },
  });
};

onMounted(async () => {
  if (authStore.isAuthenticated && authStore.user && authStore.user.max_game_accounts === undefined) {
    await authStore.fetchUser();
  }
  await tokenStore.initTokenStore();

  if (!tokenStore.hasTokens && !props.token && !props.api) {
    showImportForm.value = true;
  }
});
</script>

<style scoped lang="scss">
.token-import-page {
  padding: var(--spacing-md);

  .header-card {
    margin-bottom: 16px;
  }

  .limit-alert {
    margin-bottom: 16px;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .header-left {
      h2 {
        margin: 0 0 4px 0;
        font-size: 18px;
      }

      p {
        margin: 0;
        color: var(--el-text-color-secondary);
        font-size: 14px;
      }
    }
  }

  .token-cards {
    margin-bottom: 16px;
  }

  .token-card {
    margin-bottom: 16px;
    cursor: pointer;
    transition: all 0.3s;

    &:hover {
      box-shadow: var(--el-box-shadow-light);
    }

    &.active {
      border-color: var(--el-color-primary);
      box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.2);
    }

    .token-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .token-info {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }

    .token-details {
      flex: 1;
      min-width: 0;
    }

    .token-name {
      font-weight: 500;
      font-size: 15px;
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .token-meta {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .token-body {
      font-size: 13px;
      color: var(--el-text-color-secondary);

      .info-item {
        display: flex;
        margin-bottom: 6px;

        &:last-child {
          margin-bottom: 0;
        }

        .label {
          color: var(--el-text-color-regular);
          min-width: 70px;
          flex-shrink: 0;
        }

        .value {
          flex: 1;
          word-break: break-all;
        }
      }
    }
  }
}

.modal-actions {
  display: flex;
  gap: var(--spacing-md);
  justify-content: flex-end;
}

@media (max-width: 768px) {
  .token-import-page {
    padding: var(--spacing-sm);

    .page-header {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-md);

      .header-right {
        width: 100%;

        .el-button {
          width: 100%;
        }
      }

      .header-left {
        h2 {
          font-size: var(--font-size-lg);
        }

        p {
          font-size: var(--font-size-sm);
        }
      }
    }

    .token-card {
      .token-header {
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .token-info {
        flex-wrap: wrap;
      }

      .token-body {
        .info-item {
          flex-direction: column;
          gap: 2px;

          .label {
            min-width: auto;
          }
        }
      }
    }
  }
}

@media (max-width: 480px) {
  .token-import-page {
    padding: var(--spacing-xs);

    .page-header {
      .header-left {
        h2 {
          font-size: var(--font-size-md);
        }
      }
    }

    .token-card {
      .token-name {
        font-size: var(--font-size-sm);
      }

      .token-body {
        font-size: var(--font-size-xs);
      }
    }
  }
}

.token-import-modal {
  .modal-title {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: var(--font-size-lg);
    margin: 0;
  }

  .card-header {
    margin-bottom: var(--spacing-md);
  }

  .import-method-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-xs);
  }

  .card-body {
    max-height: 60vh;
    overflow-y: auto;
  }
}

@media (max-width: 768px) {
  .token-import-modal {
    .modal-title {
      font-size: var(--font-size-md);
    }

    .import-method-tabs {
      .n-radio-button {
        flex: 1;
        min-width: calc(50% - var(--spacing-xs));

        :deep(.n-radio-button__button) {
          width: 100%;
          padding: 6px 8px;
          font-size: var(--font-size-xs);
        }
      }
    }
  }
}

@media (max-width: 480px) {
  .token-import-modal {
    .import-method-tabs {
      .n-radio-button {
        min-width: 100%;
      }
    }
  }
}
</style>
