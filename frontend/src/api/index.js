import axios from "axios";
import { useAuthStore } from "@/stores/auth";

// 创建axios实例
const request = axios.create({
  baseURL: "/api",
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    const authStore = useAuthStore();
    if (authStore.token) {
      config.headers.Authorization = `Bearer ${authStore.token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// 响应拦截器
request.interceptors.response.use(
  (response) => {
    const data = response.data;

    // 统一处理响应格式
    if (data.success !== undefined) {
      return data;
    }

    // 兼容不同的响应格式
    return {
      success: true,
      data: data,
      message: "success",
    };
  },
  (error) => {
    const authStore = useAuthStore();

    // 处理HTTP错误
    if (error.response) {
      const { status, data } = error.response;

      switch (status) {
        case 401:
          // 未授权，清除登录状态
          authStore.logout();
          window.location.href = "/login";
          return Promise.reject({
            success: false,
            message: "登录已过期，请重新登录",
          });
        case 403:
          return Promise.reject({
            success: false,
            message: "没有权限访问",
          });
        case 404:
          return Promise.reject({
            success: false,
            message: "请求的资源不存在",
          });
        case 500:
          return Promise.reject({
            success: false,
            message: "服务器内部错误",
          });
        default:
          return Promise.reject({
            success: false,
            message: data?.message || "请求失败",
          });
      }
    } else if (error.request) {
      // 网络错误
      return Promise.reject({
        success: false,
        message: "网络连接失败，请检查网络",
      });
    } else {
      // 其他错误
      return Promise.reject({
        success: false,
        message: error.message || "未知错误",
      });
    }
  },
);

// API接口定义
const api = {
  // 认证相关
  auth: {
    login: (credentials) => request.post("/auth/login", credentials),
    register: (userInfo) => request.post("/auth/register", userInfo),
    logout: () => request.post("/auth/logout"),
    getUserInfo: () => request.get("/auth/user"),
    refreshToken: () => request.post("/auth/refresh"),
  },

  // 游戏角色相关
  gameRoles: {
    getList: () => request.get("/gamerole_list"),
    add: (roleData) => request.post("/gameroles", roleData),
    update: (roleId, roleData) => request.put(`/gameroles/${roleId}`, roleData),
    delete: (roleId) => request.delete(`/gameroles/${roleId}`),
    getDetail: (roleId) => request.get(`/gameroles/${roleId}`),
  },

  // 日常任务相关
  dailyTasks: {
    getList: (roleId) => request.get(`/daily-tasks?roleId=${roleId}`),
    getStatus: (roleId) => request.get(`/daily-tasks/status?roleId=${roleId}`),
    complete: (taskId, roleId) =>
      request.post(`/daily-tasks/${taskId}/complete`, { roleId }),
    getHistory: (roleId, page = 1, limit = 20) =>
      request.get(
        `/daily-tasks/history?roleId=${roleId}&page=${page}&limit=${limit}`,
      ),
  },

  // 用户相关
  user: {
    getProfile: () => request.get("/user/profile"),
    updateProfile: (profileData) => request.put("/user/profile", profileData),
    changePassword: (passwordData) =>
      request.put("/user/password", passwordData),
    getStats: () => request.get("/user/stats"),
  },

  // 统计相关
  stats: {
    getOverview: () => request.get("/stats/overview"),
    getSystemStatus: () => request.get("/stats/system-status"),
    getTaskSummary: (days = 7) =>
      request.get(`/stats/task-summary?days=${days}`),
    getRecentActivities: (limit = 10) =>
      request.get(`/stats/recent-activities?limit=${limit}`),
  },

  // 批量任务调度相关
  batchScheduler: {
    getTypes: () => request.get("/batch-scheduler/types"),
    getList: () => request.get("/batch-scheduler"),
    getDetail: (id) => request.get(`/batch-scheduler/${id}`),
    create: (data) => request.post("/batch-scheduler", data),
    update: (id, data) => request.put(`/batch-scheduler/${id}`, data),
    delete: (id) => request.delete(`/batch-scheduler/${id}`),
    execute: (id) => request.post(`/batch-scheduler/${id}/execute`),
    getLogs: (id, limit = 50) => request.get(`/batch-scheduler/${id}/logs?limit=${limit}`),
  },

  batchSettings: {
    getAccountSettings: () => request.get("/batch-settings/account-settings"),
    saveAccountSettings: (accountId, data) => request.put(`/batch-settings/account-settings/${accountId}`, data),
    getTemplates: () => request.get("/batch-settings/templates"),
    createTemplate: (data) => request.post("/batch-settings/templates", data),
    updateTemplate: (id, data) => request.put(`/batch-settings/templates/${id}`, data),
    deleteTemplate: (id) => request.delete(`/batch-settings/templates/${id}`),
  },
};

export default api;
