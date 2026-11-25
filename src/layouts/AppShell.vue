<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import BrandMark from '@/components/BrandMark.vue'
import PageSkeleton from '@/components/PageSkeleton.vue'
import CommandPalette from './CommandPalette.vue'
import { NAV_GROUPS, PAGE_META, UNWIRED_PAGES, type PageKey } from '@/constants'
import { authApi, getToken } from '@/api'
import { useSession } from '@/stores/session'
import { useAlerts } from '@/stores/alerts'
import { useDevices } from '@/stores/devices'
import { usePipeline } from '@/stores/pipeline'
import { useAnnotate } from '@/stores/annotate'
import { useTasks } from '@/stores/tasks'
import { useUi } from '@/stores/ui'
import { toast } from '@/composables/toast'
import { pad } from '@/utils'
import '@/styles/shell.css'
import '@/styles/collect.css'

const route = useRoute()
const router = useRouter()
const session = useSession()
const alerts = useAlerts()
const devicesStore = useDevices()
const pipeline = usePipeline()
const annotate = useAnnotate()
const tasks = useTasks()
const ui = useUi()

const current = computed(() => (route.meta.page as PageKey) ?? 'dashboard')
const groups = computed(() => NAV_GROUPS.map((g) => ({ g: g.g, items: g.items.filter((i) => session.allowed(i)) })).filter((g) => g.items.length))
const selected = computed(() => [current.value])

function badge(id: PageKey): { n: number; soft: boolean } | null {
  let n = 0, soft = false
  if (id === 'monitor') n = alerts.openCount('monitor')
  else if (id === 'pipeline') n = pipeline.failedCount()
  else if (id === 'annotate') { n = annotate.labelTodo(); soft = true }
  else if (id === 'review') { n = annotate.reviewTodo(); soft = true }
  else if (id === 'tasks') { n = tasks.list.filter((t) => t.status === 'running').length; soft = true }
  else if (id === 'devices') n = devicesStore.list.filter((d) => d.st === 'fault').length
  return n ? { n, soft } : null
}
function go(k: string) { if (k !== current.value) router.push({ name: k }) }

const bellOpen = ref(false)

/** 切换页面时先显示骨架屏 */
const loading = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
watch(() => route.name, () => {
  bellOpen.value = false
  loading.value = true
  clearTimeout(timer)
  timer = setTimeout(() => { loading.value = false }, 240)
}, { immediate: true })
const content = ref<HTMLElement>()
watch(loading, (v) => { if (!v && content.value) content.value.scrollTop = 0 })

/** 账号被停用 / 角色权限变更 / 401 失效时及时生效 */
watch(() => session.authed, (v) => { if (!v && route.name !== 'login') router.replace({ name: 'login' }) }, { immediate: true })
watch(() => session.allowed(current.value), (v) => {
  if (!session.authed || v) return
  const first = (Object.keys(PAGE_META) as PageKey[]).find((k) => session.allowed(k))
  if (first) router.replace({ name: first })
})

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '')

/* 通知中心（对接 /auth/notifications 与 /auth/notifications/read） */
interface ShellNotif {
  id: number
  level: 'info' | 'warn' | 'crit'
  title: string
  desc: string
  time: string
  route?: PageKey
  read: boolean
}
const bellLoading = ref(false)
const notifications = ref<ShellNotif[]>([])
const unreadBellCount = computed(() => notifications.value.filter((n) => !n.read).length)

function mapNotif(raw: any): ShellNotif {
  const lv = raw.level === 'crit' || raw.level === 'error' ? 'crit' : raw.level === 'warn' || raw.level === 'warning' ? 'warn' : 'info'
  const routeRaw = raw.route || raw.target_route || raw.module
  const routeKey = routeRaw && routeRaw in PAGE_META ? (routeRaw as PageKey) : undefined
  const timeRaw = raw.created_at || raw.time || ''
  return {
    id: Number(raw.id),
    level: lv,
    title: raw.title || '系统通知',
    desc: raw.content || raw.desc || raw.message || '',
    time: typeof timeRaw === 'string' && timeRaw.includes('T') ? timeRaw.replace('T', ' ').slice(0, 16) : String(timeRaw || ''),
    route: routeKey,
    read: !!(raw.is_read ?? raw.read),
  }
}

async function fetchNotifications() {
  if (!getToken()) return
  bellLoading.value = true
  try {
    const res = await authApi.getNotifications({ page: 1, size: 20 })
    notifications.value = (res?.items || []).map(mapNotif)
  } catch {
    notifications.value = []
  } finally {
    bellLoading.value = false
  }
}

watch(bellOpen, (open) => {
  if (open) fetchNotifications()
})

async function markReadAll() {
  const unreadIds = notifications.value.filter((n) => !n.read).map((n) => n.id)
  if (!unreadIds.length) return
  try {
    await authApi.readNotifications(unreadIds)
    notifications.value.forEach((n) => { n.read = true })
  } catch (err: any) {
    toast(err?.message || '标记已读失败', { type: 'warn' })
  }
}

async function openNotif(item: ShellNotif) {
  if (!item.read) {
    try {
      await authApi.readNotifications([item.id])
      item.read = true
    } catch {
      /* ignore */
    }
  }
  bellOpen.value = false
  if (item.route) {
    if (session.allowed(item.route)) router.push({ name: item.route })
    else toast('当前角色无权访问“' + PAGE_META[item.route].title + '”', { type: 'warn' })
  }
}

function logout() { session.logout(); router.replace({ name: 'login' }); toast('已退出登录') }

/* 修改密码（对接 /auth/password） */
const pw = reactive({ open: false, old: '', n1: '', n2: '', err: '', busy: false })
function openPwd() { Object.assign(pw, { open: true, old: '', n1: '', n2: '', err: '', busy: false }) }
async function savePwd() {
  pw.err = ''
  if (!pw.old) { pw.err = '请输入当前密码'; return }
  if (pw.n1.length < 8 || !/[A-Za-z]/.test(pw.n1) || !/\d/.test(pw.n1)) { pw.err = '新密码至少 8 位，且需同时包含字母和数字'; return }
  if (pw.n1 !== pw.n2) { pw.err = '两次输入的新密码不一致'; return }
  if (pw.n1 === pw.old) { pw.err = '新密码不能与当前密码相同'; return }
  pw.busy = true
  try {
    await authApi.changePassword({ old_password: pw.old, new_password: pw.n1 })
    session.clearMustReset()
    pw.open = false
    toast('密码已修改')
  } catch (err: any) {
    pw.err = err?.message || '修改密码失败，请检查当前密码是否正确'
  } finally {
    pw.busy = false
  }
}

/* 后端健康检查 */
const sysHealthy = ref(true)
const sysHealthTip = ref('正在检查后端服务状态…')
async function checkHealth() {
  const token = getToken()
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const urls = ['/api/v1/health', '/api/health']
  let lastReason = '健康检查接口未响应'

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers })
      if (res.status === 404) {
        lastReason = `${url} 返回 404`
        continue
      }
      if (!res.ok) {
        lastReason = `${url} HTTP ${res.status}`
        sysHealthy.value = false
        sysHealthTip.value = lastReason
        return
      }
      const ctype = res.headers.get('content-type') || ''
      if (!ctype.includes('application/json')) {
        lastReason = `${url} 返回非 JSON 响应`
        continue
      }
      const json = await res.json()
      // 兼容标准 { code: 0, data: { status, ... } } 与 FastAPI 直出 { status, ... } 两种响应体
      if (json && typeof json.code === 'number' && json.code !== 0) {
        sysHealthy.value = false
        sysHealthTip.value = json.message || `健康检查返回错误码 ${json.code}`
        return
      }
      const data = json && typeof json.code === 'number' ? json.data : json
      const rawStatus = String(data?.status ?? '').toLowerCase()
      const dbStatus = String(data?.db ?? data?.database ?? '').toLowerCase()
      const okSet = new Set(['ok', 'healthy', 'up', 'pass', 'normal', ''])
      const dbOk = !dbStatus || okSet.has(dbStatus)

      if (okSet.has(rawStatus) || (rawStatus === 'degraded' && dbOk)) {
        sysHealthy.value = true
        const parts = [`状态: ${data?.status || 'ok'}`]
        if (data?.version) parts.push(`版本: ${data.version}`)
        if (data?.db) parts.push(`数据库: ${data.db}`)
        if (data?.redis) parts.push(`Redis: ${data.redis}`)
        sysHealthTip.value = parts.join(' · ')
        return
      }

      sysHealthy.value = false
      sysHealthTip.value = `后端状态异常 (${data?.status || 'unknown'})`
      return
    } catch (err: any) {
      lastReason = err?.message || '网络请求失败'
    }
  }

  // 若服务端未暴露 /api/v1/health（均返回 404），但认证态已登录或接口未出错，不误报异常
  if (lastReason.includes('404')) {
    sysHealthy.value = true
    sysHealthTip.value = '后端运行中（未启用 /health 探针）'
  } else {
    sysHealthy.value = false
    sysHealthTip.value = lastReason
  }
}

const now = ref(new Date())
let clock = 0
const time = computed(() => [now.value.getHours(), now.value.getMinutes(), now.value.getSeconds()].map(pad).join(':'))
function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ui.paletteOpen = true }
}
onMounted(() => {
  document.addEventListener('keydown', onKey)
  clock = window.setInterval(() => { now.value = new Date() }, 1000)
  fetchNotifications()
  checkHealth()
  if (session.user?.mustReset) toast('当前使用的是初始密码，请尽快在右上角修改密码', { type: 'warn' })
})
onBeforeUnmount(() => { clearTimeout(timer); clearInterval(clock); document.removeEventListener('keydown', onKey) })
watch(current, (p) => { document.title = PAGE_META[p].title + ' · 数采管理平台' }, { immediate: true })
</script>

<template>
  <div class="pp cl">
    <header class="pp-top">
      <div class="pp-brand" role="link" tabindex="0" @click="go('dashboard')" @keydown.enter="go('dashboard')">
        <BrandMark />
        <div><b>数采管理平台</b><small>Data Collection</small></div>
      </div>
      <i class="pp-sep" />
      <div class="pp-mod"><b>{{ PAGE_META[current].title }}</b><small>DMS · 具身智能</small></div>
      <div class="pp-top-r">
        <button type="button" class="search-btn cl-search" aria-label="打开全局搜索" @click="ui.paletteOpen = true">
          <AppIcon name="search" /><span>搜索页面、任务、数据集</span><kbd>{{ isMac ? '⌘ K' : 'Ctrl K' }}</kbd>
        </button>
        <a-popover v-model:open="bellOpen" trigger="click" placement="bottomRight" :arrow="false" overlay-class-name="plain-pop">
          <template #content>
            <div style="width:360px;max-width:92vw">
              <div class="pop-head">
                <span>通知</span>
                <button v-if="unreadBellCount > 0" type="button" class="btn ghost sm" @click="markReadAll">全部标为已读</button>
              </div>
              <div style="max-height:380px;overflow:auto">
                <div v-if="bellLoading" class="muted" style="padding:18px;text-align:center;font-size:12.5px">加载通知中…</div>
                <template v-else-if="notifications.length">
                  <button v-for="a in notifications" :key="a.id" type="button" class="notif menu-item" :class="{ unread: !a.read }" style="align-items:flex-start" @click="openNotif(a)">
                    <span class="alert-ico" :class="a.level"><AppIcon :name="a.level === 'info' ? 'info' : 'alert'" size="sm" /></span>
                    <span style="flex:1;min-width:0"><p>{{ a.title }}</p><small>{{ a.desc }}<template v-if="a.time"> · {{ a.time }}</template></small></span>
                  </button>
                </template>
                <div v-else class="muted" style="padding:24px 12px;text-align:center;font-size:12.5px">暂无系统通知</div>
              </div>
            </div>
          </template>
          <button type="button" class="icon-btn cl-bell" :aria-label="`通知，${unreadBellCount} 条未读`" aria-haspopup="true">
            <AppIcon name="bell" /><span v-if="unreadBellCount" class="dot">{{ unreadBellCount }}</span>
          </button>
        </a-popover>
        <span class="pp-clock">{{ time }}</span>
        <a-dropdown placement="bottomRight" :trigger="['click']" overlay-class-name="pp-user-drop">
          <div class="pp-user" role="button" tabindex="0">
            <span class="av">{{ session.info.init }}</span>
            <span class="pp-user-info">{{ session.info.user }}<small>{{ session.info.name }}</small></span>
            <AppIcon name="down" size="sm" class="pp-caret" />
          </div>
          <template #overlay>
            <a-menu class="pp-user-menu">
              <a-menu-item key="who" disabled class="pp-who-item">
                <div class="pp-who">
                  <b>{{ session.info.user }}</b>
                  <span class="mono">@{{ session.info.account }}</span>
                </div>
              </a-menu-item>
              <a-menu-divider />
              <a-menu-item key="pwd" @click="openPwd">
                <template #icon><AppIcon name="lock" size="sm" /></template>
                修改密码
              </a-menu-item>
              <a-menu-item key="out" danger @click="logout">
                <template #icon><AppIcon name="logout" size="sm" /></template>
                退出登录
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </header>
    <div class="pp-body">
      <aside class="pp-side" :class="{ collapsed: session.collapsed }">
        <a-menu
          mode="inline"
          :inline-collapsed="session.collapsed"
          :selected-keys="selected"
          class="pp-menu"
          @click="(e: any) => go(String(e.key))"
        >
          <a-menu-item-group v-for="g in groups" :key="g.g" :title="g.g">
            <a-menu-item v-for="id in g.items" :key="id" :class="{ 'pp-menu-unwired': UNWIRED_PAGES.has(id) }">
              <template #icon><AppIcon :name="PAGE_META[id].icon" /></template><span class="pp-menu-name">{{ PAGE_META[id].title }}</span><span v-if="badge(id)" class="pp-mbadge" :class="{ soft: badge(id)!.soft }">{{ badge(id)!.n }}</span>
            </a-menu-item>
          </a-menu-item-group>
        </a-menu>
        <div class="pp-side-foot">
          <a-tooltip :title="session.collapsed ? `${sysHealthy ? '系统运行正常' : '后端服务异常'} · ${sysHealthTip}` : sysHealthTip" placement="right">
            <div class="pp-foot-status">
              <i class="dot" :style="sysHealthy ? undefined : 'background:var(--crit);box-shadow:0 0 8px var(--crit)'" />
              <span v-if="!session.collapsed" class="pp-foot-text">{{ sysHealthy ? '系统运行正常' : '后端服务异常' }}</span>
            </div>
          </a-tooltip>
          <a-tooltip :title="session.collapsed ? '展开左侧菜单' : '收起左侧菜单'" placement="right">
            <button
              type="button"
              class="pp-collapse-btn"
              :aria-label="session.collapsed ? '展开左侧菜单' : '收起左侧菜单'"
              :aria-expanded="!session.collapsed"
              @click="session.toggleCollapsed()"
            >
              <AppIcon :name="session.collapsed ? 'unfold' : 'fold'" size="sm" />
            </button>
          </a-tooltip>
        </div>
      </aside>
      <main class="pp-main flush">
        <div ref="content" class="content cl-content" tabindex="-1">
          <PageSkeleton v-if="loading" />
          <router-view v-else v-slot="{ Component }">
            <div :key="String(route.name)" class="page"><component :is="Component" /></div>
          </router-view>
        </div>
      </main>
    </div>
    <CommandPalette />
    <a-modal v-model:open="pw.open" title="修改密码" ok-text="保存" cancel-text="取消" :confirm-loading="pw.busy" width="420px" @ok="savePwd">
      <a-form layout="vertical" style="margin-top:12px">
        <a-form-item label="当前密码"><a-input-password v-model:value="pw.old" autocomplete="current-password" /></a-form-item>
        <a-form-item label="新密码" extra="至少 8 位，需同时包含字母和数字"><a-input-password v-model:value="pw.n1" autocomplete="new-password" /></a-form-item>
        <a-form-item label="确认新密码" :validate-status="pw.err ? 'error' : ''" :help="pw.err || undefined"><a-input-password v-model:value="pw.n2" autocomplete="new-password" @press-enter="savePwd" /></a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>
