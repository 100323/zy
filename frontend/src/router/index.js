import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@stores/auth';

import MainLayout from '@layouts/MainLayout.vue';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@views/Login.vue'),
    meta: { title: '登录', public: true }
  },
  {
    path: '/',
    component: MainLayout,
    children: [
      {
        path: '',
        name: 'Home',
        component: () => import('@views/Home.vue'),
        meta: { title: '首页' }
      },
      {
        path: 'tokens',
        name: 'Tokens',
        component: () => import('@views/TokenImport/index.vue'),
        meta: { title: '账号管理', requiresNaive: true, requiresArco: true }
      },
      {
        path: 'game-features',
        name: 'GameFeatures',
        component: () => import('@views/GameFeatures.vue'),
        meta: { title: '游戏功能', requiresNaive: true, requiresArco: true }
      },
      {
        path: 'daily-tasks',
        name: 'DailyTasks',
        component: () => import('@views/DailyTasks.vue'),
        meta: { title: '日常任务' }
      },
      {
        path: 'tasks',
        name: 'Tasks',
        component: () => import('@views/Tasks.vue'),
        meta: { title: '任务配置', requiresNaive: true }
      },
      {
        path: 'logs',
        name: 'Logs',
        component: () => import('@views/Logs.vue'),
        meta: { title: '执行日志' }
      },
      {
        path: 'invite-codes',
        name: 'InviteCodes',
        component: () => import('@views/InviteCodes.vue'),
        meta: { title: '邀请码管理', requiresAdmin: true }
      }
    ]
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore();
  
  if (!to.meta.public && !authStore.isAuthenticated) {
    next({ name: 'Login', query: { redirect: to.fullPath } });
  } else if (to.name === 'Login' && authStore.isAuthenticated) {
    next({ name: 'Home' });
  } else {
    next();
  }
});

export default router;
