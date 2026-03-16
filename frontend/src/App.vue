<template>
  <n-message-provider>
    <n-dialog-provider>
      <n-notification-provider>
        <router-view />
      </n-notification-provider>
    </n-dialog-provider>
  </n-message-provider>
</template>

<script setup>
import { onMounted } from 'vue';
import { useAuthStore } from '@stores/auth';
import { NMessageProvider, NDialogProvider, NNotificationProvider } from 'naive-ui';

const authStore = useAuthStore();

onMounted(async () => {
  authStore.checkAuth();
  if (authStore.isAuthenticated) {
    await authStore.fetchUser();
  }
});
</script>

<style>
html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
}
</style>
