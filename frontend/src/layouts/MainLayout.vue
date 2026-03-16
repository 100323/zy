<template>
  <div class="layout-container">
    <el-container>
      <el-aside width="220px" class="sidebar">
        <div class="logo">
          <img src="/icons/xiaoyugan.png" alt="Logo">
          <span>XYZW</span>
        </div>
        
        <el-menu
          :default-active="activeMenu"
          router
          background-color="#1e1e2d"
          text-color="#a2a3b8"
          active-text-color="#fff"
        >
          <el-menu-item
            v-for="item in visibleMenuItems"
            :key="item.index"
            :index="item.index"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </el-menu>
      </el-aside>
      
      <el-container>
        <el-header class="header">
          <div class="header-left">
            <el-button class="mobile-menu-trigger" text @click="mobileMenuOpen = true">
              <el-icon :size="20"><Operation /></el-icon>
            </el-button>
            <h2>{{ pageTitle }}</h2>
          </div>
          
          <div class="header-right">
            <el-dropdown @command="handleCommand">
              <span class="user-info">
                <el-avatar :size="32" icon="UserFilled" />
                <span class="username">{{ authStore.user?.username }}</span>
                <el-icon><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="logout">退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </el-header>
        
        <el-main class="main">
          <router-view v-slot="{ Component }">
            <template v-if="Component">
              <component :is="Component" />
            </template>
            <template v-else>
              <div style="background: red; color: white; padding: 20px;">
                错误: 没有匹配的路由组件!
                <br>当前路径: {{ $route.path }}
              </div>
            </template>
          </router-view>
        </el-main>
      </el-container>
    </el-container>

    <el-drawer
      v-model="mobileMenuOpen"
      class="mobile-drawer"
      direction="ltr"
      size="min(82vw, 280px)"
      :with-header="false"
    >
      <div class="mobile-drawer-content">
        <div class="mobile-drawer-logo">
          <img src="/icons/xiaoyugan.png" alt="Logo">
          <span>XYZW</span>
        </div>

        <el-menu
          :default-active="activeMenu"
          class="mobile-menu"
          @select="handleMobileMenuSelect"
        >
          <el-menu-item
            v-for="item in visibleMenuItems"
            :key="item.index"
            :index="item.index"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </el-menu>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowDown,
  Clock,
  Document,
  HomeFilled,
  Key,
  Operation,
  Setting,
  Ticket,
  Trophy,
  UserFilled
} from '@element-plus/icons-vue';
import { useAuthStore } from '@stores/auth';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const mobileMenuOpen = ref(false);

const activeMenu = computed(() => route.path);
const pageTitle = computed(() => route.meta?.title || 'XYZW 管理后台');
const isAdmin = computed(() => {
  console.log('authStore.user:', authStore.user);
  console.log('role:', authStore.user?.role);
  return authStore.user?.role === 'admin';
});
const menuItems = [
  { index: '/', label: '首页', icon: HomeFilled },
  { index: '/tokens', label: '账号管理', icon: Key },
  { index: '/game-features', label: '游戏功能', icon: Trophy },
  { index: '/daily-tasks', label: '日常任务', icon: Clock },
  { index: '/tasks', label: '任务配置', icon: Setting },
  { index: '/logs', label: '执行日志', icon: Document },
  { index: '/invite-codes', label: '邀请码管理', icon: Ticket, adminOnly: true }
];
const visibleMenuItems = computed(() => menuItems.filter((item) => !item.adminOnly || isAdmin.value));

const handleCommand = (command) => {
  if (command === 'logout') {
    ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' })
      .then(() => {
        authStore.logout();
        router.push('/login');
        ElMessage.success('已退出登录');
      })
      .catch(() => {});
  }
};

const handleMobileMenuSelect = (index) => {
  mobileMenuOpen.value = false;
  if (route.path !== index) {
    router.push(index);
  }
};

watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false;
  }
);
</script>

<style lang="scss" scoped>
.layout-container {
  min-height: 100vh;
  background: #f5f7fa;
}

.el-container {
  min-height: 100vh;
}

.sidebar {
  background: #1e1e2d;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  
  .logo {
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 0 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    
    img {
      width: 32px;
      height: 32px;
    }
    
    span {
      color: white;
      font-size: 18px;
      font-weight: bold;
    }
  }
  
  .el-menu {
    border-right: none;
  }
}

.header {
  background: white;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  position: sticky;
  top: 0;
  z-index: 20;
  
  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;

    h2 {
      margin: 0;
      font-size: 18px;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
  
  .user-info {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    min-width: 0;
    
    .username {
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 180px;
    }
  }
}

.mobile-menu-trigger {
  display: none;
  flex-shrink: 0;
}

.main {
  background: #f5f7fa;
  padding: 20px;
  min-width: 0;
  overflow-x: hidden;
}

.mobile-drawer-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e2d;
}

.mobile-drawer-logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);

  img {
    width: 32px;
    height: 32px;
  }

  span {
    color: white;
    font-size: 18px;
    font-weight: bold;
  }
}

.mobile-menu {
  flex: 1;
  border-right: none;
}

:deep(.mobile-drawer) {
  .el-drawer__body {
    padding: 0;
    background: #1e1e2d;
  }

  .el-menu {
    border-right: none;
    background: #1e1e2d;
  }

  .el-menu-item {
    color: #a2a3b8;
  }

  .el-menu-item.is-active {
    color: #fff;
    background-color: rgba(255, 255, 255, 0.08);
  }
}

@media (max-width: 992px) {
  .sidebar {
    display: none;
  }

  .mobile-menu-trigger {
    display: inline-flex;
  }

  .header {
    padding: 0 16px;
  }
}

@media (max-width: 768px) {
  .header {
    padding: 0 12px;

    .header-left h2 {
      font-size: 16px;
    }

    .user-info {
      gap: 6px;

      .username {
        max-width: 96px;
        font-size: 13px;
      }
    }
  }

  .main {
    padding: 12px;
  }
}

@media (max-width: 480px) {
  .header {
    padding: 0 10px;

    .user-info {
      .username {
        display: none;
      }
    }
  }

  .main {
    padding: 10px;
  }
}
</style>
