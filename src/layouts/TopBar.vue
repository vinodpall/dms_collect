<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { PAGE_META, ROLES, type PageKey, type RoleKey } from '@/constants'
import { useSession } from '@/stores/session'
import { useAlerts } from '@/stores/alerts'
import { useUi } from '@/stores/ui'
import { useRoute } from 'vue-router'
import { toast } from '@/composables/toast'

const router = useRouter()
const route = useRoute()
const session = useSession()
const alerts = useAlerts()
const ui = useUi()
const page = computed(() => (route.meta.page as PageKey) ?? 'dashboard')
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '')
const bellOpen = ref(false)
/** 训练场入口站地址，见 .env 的 VITE_PORTAL_URL；为空则不显示返回入口 */
const PORTAL_URL = (import.meta.env.VITE_PORTAL_URL as string | undefined) ?? ''
function goPortal() { if (PORTAL_URL) window.location.href = PORTAL_URL }
function logout() { userOpen.value = false; session.logout(); router.replace({ name: 'login' }); toast('已退出登录') }
const userOpen = ref(false)

function openAlert(id: string) {
  const a = alerts.list.find((x) => x.id === id)
  if (!a) return
  a.read = true
  bellOpen.value = false
  if (session.allowed(a.route)) router.push({ name: a.route })
  else toast('当前角色无权访问“' + PAGE_META[a.route].title + '”', { type: 'warn' })
}
function switchRole(k: RoleKey) {
  userOpen.value = false
  if (k === session.role) return
  session.role = k
  toast('已切换为“' + ROLES[k].name + '”视角')
}
</script>

<template>
  <header class="topbar">
    <button type="button" class="icon-btn menu-toggle" aria-label="打开导航" @click="ui.navOpen = true">
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    </button>
    <div class="crumbs">
      <template v-if="PORTAL_URL"><button type="button" class="crumb-home" title="返回训练场入口" @click="goPortal"><AppIcon name="apps" size="sm" />全部模块</button><AppIcon name="right" size="sm" /></template><span>数采管理平台</span><AppIcon name="right" size="sm" /><b>{{ PAGE_META[page].title }}</b>
    </div>
    <div class="spacer" />
    <button type="button" class="search-btn" aria-label="打开全局搜索" @click="ui.paletteOpen = true">
      <AppIcon name="search" /><span>搜索页面、任务、数据集</span><kbd>{{ isMac ? '⌘ K' : 'Ctrl K' }}</kbd>
    </button>
    <button type="button" class="icon-btn" aria-label="切换深色模式" title="切换深色 / 浅色" @click="session.toggleTheme(); toast('已切换为' + (session.dark ? '深色' : '浅色') + '模式')">
      <AppIcon :name="session.dark ? 'sun' : 'moon'" />
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
      <button type="button" class="icon-btn" :aria-label="`通知，${alerts.unread} 条未读`" aria-haspopup="true">
        <AppIcon name="bell" /><span v-if="alerts.unread" class="dot">{{ alerts.unread }}</span>
      </button>
    </a-popover>

    <a-popover v-model:open="userOpen" trigger="click" placement="bottomRight" :arrow="false" overlay-class-name="plain-pop">
      <template #content>
        <div style="width:272px">
          <div class="pop-head" style="font-weight:500;font-size:12.5px;color:var(--muted)">切换角色预览权限</div>
          <button v-for="(r, k) in ROLES" :key="k" type="button" class="menu-item" role="menuitemradio" :aria-checked="k === session.role" @click="switchRole(k)">
            <span class="avatar" style="width:28px;height:28px;font-size:12px">{{ r.init }}</span>
            <span style="flex:1">{{ r.name }}<br /><small class="muted">{{ r.user }}</small></span>
            <AppIcon v-if="k === session.role" name="check" size="sm" />
          </button>
          <div class="menu-sep" />
          <button v-if="PORTAL_URL" type="button" class="menu-item" @click="userOpen = false; goPortal()"><AppIcon name="apps" size="sm" />返回训练场入口</button>
          <button type="button" class="menu-item" @click="logout"><AppIcon name="logout" size="sm" />退出登录</button>
        </div>
      </template>
      <button type="button" class="user-btn" aria-haspopup="true">
        <span class="avatar">{{ session.info.init }}</span>
        <span class="nm">{{ session.info.user }}<span>{{ session.info.name }}</span></span>
        <AppIcon name="down" size="sm" />
      </button>
    </a-popover>
  </header>
</template>

<style>
.crumb-home { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 4px 8px; margin-left: -8px; border-radius: 6px; color: var(--muted); }
.crumb-home:hover { background: var(--surface-3); color: var(--text); }
.plain-pop .ant-popover-inner { padding: 0; border-radius: 12px; overflow: hidden; border: 1px solid var(--line); box-shadow: var(--shadow-pop); }
</style>
