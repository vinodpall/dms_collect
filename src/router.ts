import { createRouter, createWebHashHistory } from 'vue-router'
import { PAGE_META, type PageKey } from '@/constants'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'

const keys = Object.keys(PAGE_META) as PageKey[]
const loaders: Record<PageKey, () => Promise<unknown>> = {
  dashboard: () => import('@/views/DashboardView.vue'),
  tasks: () => import('@/views/TasksView.vue'),
  monitor: () => import('@/views/MonitorView.vue'),
  pipeline: () => import('@/views/PipelineView.vue'),
  annotate: () => import('@/views/AnnotateView.vue'),
  review: () => import('@/views/ReviewView.vue'),
  datasets: () => import('@/views/DatasetsView.vue'),
  storage: () => import('@/views/StorageView.vue'),
  devices: () => import('@/views/DevicesView.vue'),
  logs: () => import('@/views/LogsView.vue'),
  dict: () => import('@/views/DictView.vue'),
  system: () => import('@/views/SystemView.vue'),
  users: () => import('@/views/UsersView.vue'),
  roles: () => import('@/views/RolesView.vue'),
}

if (typeof window !== 'undefined') {
  const { pathname, search, hash } = window.location
  if (pathname && pathname !== '/' && pathname !== '/index.html') {
    const cleanHash = hash && hash !== '#' ? hash : `#${pathname.startsWith('/') ? pathname : '/' + pathname}`
    const cleanSearch = cleanHash.includes('?') ? '' : search
    window.history.replaceState(null, '', `/${cleanSearch}${cleanHash}`)
  }
}

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true, title: '登录' } },
    ...keys.map((k) => ({ path: '/' + k, name: k, component: loaders[k] as never, meta: { page: k } })),
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

let lastUnauthorizedToastAt = 0
if (typeof window !== 'undefined') {
  window.addEventListener('dms:unauthorized', () => {
    const now = Date.now()
    if (now - lastUnauthorizedToastAt > 2000) {
      lastUnauthorizedToastAt = now
      toast('登录状态已失效，请重新登录', { type: 'warn' })
    }
    const currentRoute = router.currentRoute.value
    if (currentRoute.name !== 'login') {
      const redirect =
        currentRoute.name && currentRoute.fullPath && currentRoute.fullPath !== '/' && currentRoute.fullPath !== '/dashboard'
          ? { redirect: currentRoute.fullPath }
          : {}
      router.replace({ name: 'login', query: redirect }).catch(() => {})
    }
  })
}

router.beforeEach(async (to) => {
  const s0 = useSession()
  if (s0.authed) {
    await s0.ensureVerified()
  }
  if (!s0.authed && !to.meta.public) return { name: 'login', query: to.fullPath === '/dashboard' ? {} : { redirect: to.fullPath } }
  if (s0.authed && to.name === 'login') return { name: 'dashboard' }
  const page = to.meta.page as PageKey | undefined
  if (!page) return true
  if (!s0.allowed(page)) {
    toast('当前角色没有访问该页面的权限', { type: 'warn' })
    const first = keys.find((k) => s0.allowed(k))
    return first && first !== to.name ? { name: first } : true
  }
  return true
})
