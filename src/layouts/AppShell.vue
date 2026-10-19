<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageSkeleton from '@/components/PageSkeleton.vue'
import CommandPalette from './CommandPalette.vue'
import TopBar from './TopBar.vue'
import { NAV_GROUPS, PAGE_META, type PageKey } from '@/constants'
import { useSession } from '@/stores/session'
import { useAlerts } from '@/stores/alerts'
import { usePipeline } from '@/stores/pipeline'
import { useAnnotate } from '@/stores/annotate'
import { useTasks } from '@/stores/tasks'
import { useUi } from '@/stores/ui'

const route = useRoute()
const router = useRouter()
const session = useSession()
const alerts = useAlerts()
const pipeline = usePipeline()
const annotate = useAnnotate()
const tasks = useTasks()
const ui = useUi()

const current = computed(() => (route.meta.page as PageKey) ?? 'dashboard')
const groups = computed(() => NAV_GROUPS.map((g) => ({ g: g.g, items: g.items.filter((i) => session.allowed(i)) })).filter((g) => g.items.length))

function badge(id: PageKey): { n: number; soft: boolean } | null {
  let n = 0, soft = false
  if (id === 'monitor') n = alerts.openCount('monitor')
  else if (id === 'pipeline') n = pipeline.failedCount()
  else if (id === 'annotate') { n = annotate.todoCount(); soft = true }
  else if (id === 'tasks') { n = tasks.list.filter((t) => t.status === 'running').length; soft = true }
  else if (id === 'devices') n = alerts.openCount('devices')
  return n ? { n, soft } : null
}

/** 切换页面时先显示骨架屏，和原型一致 */
const loading = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
watch(() => [route.name, session.role], () => {
  loading.value = true
  clearTimeout(timer)
  timer = setTimeout(() => { loading.value = false }, 240)
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))

watch(() => session.role, () => { if (!session.allowed(current.value)) router.replace({ name: 'dashboard' }) })
watch(() => route.fullPath, () => { ui.navOpen = false })

const content = ref<HTMLElement>()
watch(loading, (v) => { if (!v && content.value) content.value.scrollTop = 0 })

function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ui.paletteOpen = true }
  else if (e.key === 'Escape' && ui.navOpen) ui.navOpen = false
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
watch(current, (p) => { document.title = PAGE_META[p].title + ' · 数采管理平台' }, { immediate: true })
</script>

<template>
  <div class="app" :class="{ collapsed: session.collapsed, 'nav-open': ui.navOpen }">
    <aside class="sidebar" aria-label="主导航">
      <div class="brand">
        <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#1F6FD1" />
          <path d="M7.5 12.2L16 8l8.5 4.2L16 16.4 7.5 12.2z" fill="#fff" />
          <path d="M7.5 17l8.5 4.2 8.5-4.2M7.5 21.6l8.5 4.2 8.5-4.2" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".8" />
        </svg>
        <div class="brand-text"><b>数采管理平台</b><span>DMS · 具身智能</span></div>
      </div>
      <nav class="nav" aria-label="功能导航">
        <template v-for="g in groups" :key="g.g">
          <div class="nav-group">{{ g.g }}</div>
          <button v-for="id in g.items" :key="id" type="button" class="nav-item" :aria-current="current === id ? 'page' : undefined" :title="PAGE_META[id].title" @click="router.push({ name: id })">
            <AppIcon :name="PAGE_META[id].icon" />
            <span class="lbl">{{ PAGE_META[id].title }}</span>
            <span v-if="badge(id)" class="nav-badge" :class="{ soft: badge(id)!.soft }">{{ badge(id)!.n }}</span>
          </button>
        </template>
      </nav>
      <div class="side-foot">
        <div class="who"><b>生产环境</b><span class="env-tag"><i class="env-dot" />服务正常</span></div>
        <button type="button" class="icon-btn" style="color:#BCCDE2" :aria-label="session.collapsed ? '展开侧边栏' : '收起侧边栏'" :title="session.collapsed ? '展开侧边栏' : '收起侧边栏'" @click="session.collapsed = !session.collapsed">
          <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
        </button>
      </div>
    </aside>
    <div class="navscrim" @click="ui.navOpen = false" />
    <div class="main">
      <TopBar />
      <main ref="content" class="content" tabindex="-1">
        <PageSkeleton v-if="loading" />
        <router-view v-else v-slot="{ Component }">
          <div class="page" :key="session.role + String(route.name)">
            <component :is="Component" />
          </div>
        </router-view>
      </main>
    </div>
    <CommandPalette />
  </div>
</template>
