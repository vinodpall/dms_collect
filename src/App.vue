<script setup lang="ts">
import { computed, watch } from 'vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { buildTheme } from '@/theme'
import { useSession } from '@/stores/session'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import ToastHost from '@/components/ToastHost.vue'

dayjs.locale('zh-cn')
const session = useSession()
const route = useRoute()
const router = useRouter()
const inApp = computed(() => !!route.meta.page && session.authed)
const theme = computed(() => buildTheme(session.dark))

watch(
  () => [session.authed, route.meta.page] as const,
  ([authed, page]) => {
    if (!authed && page) {
      router.replace({ name: 'login' })
    }
  },
  { immediate: true }
)
</script>
<template>
  <a-config-provider :locale="zhCN" :theme="theme">
    <a-app style="height: 100%">
      <AppShell v-if="inApp" />
      <router-view v-else-if="route.meta.public" />
      <ToastHost />
    </a-app>
  </a-config-provider>
</template>
