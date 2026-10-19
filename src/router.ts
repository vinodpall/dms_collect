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
  datasets: () => import('@/views/DatasetsView.vue'),
  storage: () => import('@/views/StorageView.vue'),
  devices: () => import('@/views/DevicesView.vue'),
  system: () => import('@/views/SystemView.vue'),
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

router.beforeEach((to) => {
  const s0 = useSession()
  const sso = typeof to.query.sso === 'string' ? to.query.sso : ''
  if (sso) {
    // 来自入口站的跳转：携带角色直接登录，并清掉地址里的 sso 参数
    const ok = s0.ssoLogin(sso)
    const { sso: _x, ...rest } = to.query
    return ok ? { path: to.name === 'login' ? '/dashboard' : to.path, query: rest, replace: true } : { name: 'login' }
  }
  if (!s0.authed && !to.meta.public) return { name: 'login', query: to.fullPath === '/dashboard' ? {} : { redirect: to.fullPath } }
  if (s0.authed && to.name === 'login') return { name: 'dashboard' }
  const page = to.meta.page as PageKey | undefined
  if (!page) return true
  const s = useSession()
  if (!s.allowed(page)) {
    toast('当前角色没有访问该页面的权限', { type: 'warn' })
    return to.name === 'dashboard' ? true : { name: 'dashboard' }
  }
  return true
})
