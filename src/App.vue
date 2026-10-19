<script setup lang="ts">
import { computed } from 'vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { buildTheme } from '@/theme'
import { useSession } from '@/stores/session'
import { useRoute } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import ToastHost from '@/components/ToastHost.vue'

dayjs.locale('zh-cn')
const session = useSession()
const route = useRoute()
const inApp = computed(() => !!route.meta.page)
const theme = computed(() => buildTheme(session.dark))
</script>
<template>
  <a-config-provider :locale="zhCN" :theme="theme">
    <a-app style="height: 100%">
      <AppShell v-if="inApp" />
      <router-view v-else />
      <ToastHost />
    </a-app>
  </a-config-provider>
</template>
