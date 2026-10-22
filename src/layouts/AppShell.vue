<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import BrandMark from '@/components/BrandMark.vue'
import PageSkeleton from '@/components/PageSkeleton.vue'
import CommandPalette from './CommandPalette.vue'
import { NAV_GROUPS, PAGE_META, type PageKey } from '@/constants'
import { useSession } from '@/stores/session'
import { useAccess } from '@/stores/access'
import { useAlerts } from '@/stores/alerts'
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
const access = useAccess()
const alerts = useAlerts()
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
  else if (id === 'devices') n = alerts.openCount('devices')
  return n ? { n, soft } : null
}
function go(k: string) { if (k !== current.value) router.push({ name: k }) }

/** 切换页面时先显示骨架屏 */
const loading = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
watch(() => route.name, () => {
  loading.value = true
  clearTimeout(timer)
  timer = setTimeout(() => { loading.value = false }, 240)
}, { immediate: true })
const content = ref<HTMLElement>()
watch(loading, (v) => { if (!v && content.value) content.value.scrollTop = 0 })

/** 账号被停用 / 角色权限变更时及时生效 */
watch(() => session.authed, (v) => { if (!v) { router.replace({ name: 'login' }); toast('登录状态已失效，请重新登录', { type: 'warn' }) } })
watch(() => session.allowed(current.value), (v) => {
  if (v) return
  const first = (Object.keys(PAGE_META) as PageKey[]).find((k) => session.allowed(k))
  if (first) router.replace({ name: first })
})

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '')
const bellOpen = ref(false)
function openAlert(id: string) {
  const a = alerts.list.find((x) => x.id === id)
  if (!a) return
  a.read = true
  bellOpen.value = false
  if (session.allowed(a.route)) router.push({ name: a.route })
  else toast('当前角色无权访问“' + PAGE_META[a.route].title + '”', { type: 'warn' })
}
function logout() { session.logout(); router.replace({ name: 'login' }); toast('已退出登录') }

/* 修改密码 */
const pw = reactive({ open: false, old: '', n1: '', n2: '', err: '', busy: false })
function openPwd() { Object.assign(pw, { open: true, old: '', n1: '', n2: '', err: '', busy: false }) }
async function savePwd() {
  pw.err = ''
  const u = session.user
  if (!u) return
  if (!(await access.checkPwd(u, pw.old))) { pw.err = '当前密码不正确'; return }
  if (pw.n1.length < 8 || !/[A-Za-z]/.test(pw.n1) || !/\d/.test(pw.n1)) { pw.err = '新密码至少 8 位，且需同时包含字母和数字'; return }
  if (pw.n1 !== pw.n2) { pw.err = '两次输入的新密码不一致'; return }
  if (pw.n1 === pw.old) { pw.err = '新密码不能与当前密码相同'; return }
  pw.busy = true
  await access.setPwd(u.id, pw.n1, false)
  pw.busy = false; pw.open = false
  toast('密码已修改')
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
  if (session.user?.mustReset) toast('当前使用的是临时密码，请尽快在右上角修改密码', { type: 'warn' })
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
              <div class="pop-head"><span>通知</span><button type="button" class="btn ghost sm" @click="alerts.readAll()">全部标为已读</button></div>
              <div style="max-height:380px;overflow:auto">
                <button v-for="a in alerts.list" :key="a.id" type="button" class="notif menu-item" :class="{ unread: !a.read }" style="align-items:flex-start" @click="openAlert(a.id)">
                  <span class="alert-ico" :class="a.level"><AppIcon :name="a.level === 'info' ? 'info' : 'alert'" size="sm" /></span>
                  <span style="flex:1;min-width:0"><p>{{ a.title }}</p><small>{{ a.desc }} · {{ a.time }}</small></span>
                </button>
              </div>
            </div>
          </template>
          <button type="button" class="icon-btn cl-bell" :aria-label="`通知，${alerts.unread} 条未读`" aria-haspopup="true">
            <AppIcon name="bell" /><span v-if="alerts.unread" class="dot">{{ alerts.unread }}</span>
          </button>
        </a-popover>
        <span class="pp-clock">{{ time }}</span>
        <a-dropdown placement="bottomRight" :trigger="['click']">
          <div class="pp-user" role="button" tabindex="0"><span class="av">{{ session.info.init }}</span><span>{{ session.info.user }}<small>{{ session.info.name }}</small></span></div>
          <template #overlay>
            <a-menu>
              <a-menu-item key="who" disabled><span class="mono">{{ session.info.account }}</span></a-menu-item>
              <a-menu-item key="pwd" @click="openPwd"><AppIcon name="lock" size="sm" /> 修改密码</a-menu-item>
              <a-menu-item key="out" danger @click="logout"><AppIcon name="logout" size="sm" /> 退出登录</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </header>
    <div class="pp-body">
      <aside class="pp-side">
        <a-menu mode="inline" :selected-keys="selected" class="pp-menu" @click="(e: any) => go(String(e.key))">
          <a-menu-item-group v-for="g in groups" :key="g.g" :title="g.g">
            <a-menu-item v-for="id in g.items" :key="id">
              <template #icon><AppIcon :name="PAGE_META[id].icon" /></template>{{ PAGE_META[id].title }}<span v-if="badge(id)" class="pp-mbadge" :class="{ soft: badge(id)!.soft }">{{ badge(id)!.n }}</span>
            </a-menu-item>
          </a-menu-item-group>
        </a-menu>
        <div class="pp-side-foot"><i class="dot" /> 系统运行正常</div>
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
