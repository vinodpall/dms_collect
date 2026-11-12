import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { type PageKey, type RoleKey } from '@/constants'
import { lsGet, lsSet } from '@/utils'
import { authApi, getToken, setToken, removeToken, type CurrentUserDetail, type LoginResult } from '@/api'

export type ThemeMode = 'dark'

export interface UserSessionProfile {
  id: string
  u: string
  name: string
  role: RoleKey
  dept: string
  avatarUrl?: string | null
  pages: string[]
  actions: string[]
  mustReset?: boolean
}

const USER_CACHE_KEY = 'dms_user_profile'

export const useSession = defineStore('session', () => {
  const token = ref<string | null>(getToken())
  let cachedProfile: UserSessionProfile | null = null
  try {
    const raw = lsGet(USER_CACHE_KEY)
    if (raw) cachedProfile = JSON.parse(raw)
  } catch {
    cachedProfile = null
  }

  const profile = ref<UserSessionProfile | null>(cachedProfile)
  const authed = computed(() => !!token.value && !!profile.value)
  const role = computed<RoleKey>(() => profile.value?.role ?? '')
  const isAdmin = computed(() => role.value === 'admin' || (profile.value?.pages?.length ?? 0) >= 14)

  const user = computed(() => {
    if (!profile.value) return null
    return {
      id: profile.value.id,
      u: profile.value.u,
      name: profile.value.name,
      role: profile.value.role,
      dept: profile.value.dept,
      on: true,
      last: '在线',
      created: '',
      phone: '',
      email: profile.value.u + '@dms.local',
      pwd: null,
      mustReset: !!profile.value.mustReset,
    }
  })

  const info = computed(() => ({
    name: profile.value?.role === 'admin' ? '系统管理员' : (profile.value?.name ?? '未分配角色'),
    user: profile.value?.name ?? '',
    init: (profile.value?.name ?? '?').slice(0, 1),
    account: profile.value?.u ?? '',
  }))

  function saveProfile(p: UserSessionProfile | null) {
    profile.value = p
    if (p) {
      lsSet(USER_CACHE_KEY, JSON.stringify(p))
    } else {
      try {
        localStorage.removeItem(USER_CACHE_KEY)
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 登录：调用后端真实接口
   */
  async function login(u: string, pwd: string, remember: boolean): Promise<string | null> {
    try {
      const res: LoginResult = await authApi.login({ username: u.trim(), password: pwd })
      if (!res.access_token) return '登录失败：未收到令牌'
      
      setToken(res.access_token)
      token.value = res.access_token

      const userProfile: UserSessionProfile = {
        id: String(res.user.id),
        u: res.user.username,
        name: res.user.full_name,
        role: res.role?.code || 'admin',
        dept: res.user.dept || '平台',
        avatarUrl: res.user.avatar_url,
        pages: res.pages || [],
        actions: res.actions || [],
      }
      saveProfile(userProfile)
      lsSet('dms-user', remember ? userProfile.id : '')
      return null
    } catch (err: any) {
      return err.message || '登录失败，请检查账号密码'
    }
  }

  /**
   * 同步当前用户信息
   */
  async function fetchMe(): Promise<void> {
    if (!getToken()) return
    try {
      const me: CurrentUserDetail = await authApi.getMe()
      const userProfile: UserSessionProfile = {
        id: String(me.user.id),
        u: me.user.username,
        name: me.user.full_name,
        role: me.role?.code || 'admin',
        dept: me.user.dept || '平台',
        avatarUrl: me.user.avatar_url,
        pages: me.pages || [],
        actions: me.actions || [],
      }
      saveProfile(userProfile)
    } catch (err) {
      console.warn('[session] 获取用户信息失败', err)
    }
  }

  async function logout() {
    try {
      await authApi.logout()
    } catch {
      /* ignore */
    } finally {
      token.value = null
      removeToken()
      saveProfile(null)
      lsSet('dms-user', '')
    }
  }

  const theme = ref<ThemeMode>('dark')
  const dark = computed(() => true)
  const collapsed = ref(false)
  document.documentElement.setAttribute('data-theme', 'dark')
  document.documentElement.classList.add('cl-theme')

  function can(actionKey: string): boolean {
    if (isAdmin.value) return true
    if (!profile.value) return false
    // 兼容后端 actions 格式 (例如 "tasks:operate" 或 "tasks")
    return profile.value.actions.some((a) => a === actionKey || a.startsWith(actionKey + ':') || a === actionKey + ':operate')
  }

  function allowed(pageKey: PageKey): boolean {
    if (isAdmin.value) return true
    if (!profile.value?.pages?.length) return true
    return profile.value.pages.includes(pageKey)
  }

  function toggleTheme() {
    /* 统一深色赛博主题 */
  }

  // 页面加载时若已有 token 则静默拉取一次最新用户信息
  if (token.value) {
    fetchMe()
  }

  return {
    uid: computed(() => profile.value?.id ?? ''),
    user,
    role,
    authed,
    login,
    logout,
    fetchMe,
    theme,
    dark,
    collapsed,
    info,
    isAdmin,
    can,
    allowed,
    toggleTheme,
  }
})
