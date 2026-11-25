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
  roleName?: string
  dept: string
  phone?: string
  email?: string
  lastLoginAt?: string
  avatarUrl?: string | null
  pages: string[]
  actions: string[]
  isAll?: boolean
  mustReset?: boolean
}

const USER_CACHE_KEY = 'dms_user_profile'

function isJwtExpired(jwt: string | null): boolean {
  if (!jwt) return false
  const parts = jwt.split('.')
  if (parts.length !== 3) return false
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded))
    if (typeof payload?.exp === 'number') {
      return payload.exp * 1000 <= Date.now()
    }
  } catch {
    /* ignore non-standard tokens */
  }
  return false
}

export const useSession = defineStore('session', () => {
  let initialToken = getToken()
  let cachedProfile: UserSessionProfile | null = null
  if (initialToken && isJwtExpired(initialToken)) {
    initialToken = null
    removeToken()
    try {
      localStorage.removeItem(USER_CACHE_KEY)
    } catch {
      /* ignore */
    }
  } else {
    try {
      const raw = lsGet(USER_CACHE_KEY)
      if (raw) cachedProfile = JSON.parse(raw)
    } catch {
      cachedProfile = null
    }
  }

  const token = ref<string | null>(initialToken)
  const profile = ref<UserSessionProfile | null>(cachedProfile)
  const authed = computed(() => !!token.value && !!profile.value)
  const role = computed<RoleKey>(() => profile.value?.role ?? '')
  const isAdmin = computed(() => role.value === 'admin' || !!profile.value?.isAll)

  const user = computed(() => {
    if (!profile.value) return null
    return {
      id: profile.value.id,
      u: profile.value.u,
      name: profile.value.name,
      role: profile.value.role,
      dept: profile.value.dept,
      on: true,
      last: profile.value.lastLoginAt || '',
      created: '',
      phone: profile.value.phone || '',
      email: profile.value.email || '',
      pwd: null,
      mustReset: !!profile.value.mustReset,
    }
  })

  const info = computed(() => ({
    name: profile.value?.roleName || (profile.value?.role === 'admin' ? '系统管理员' : '未分配角色'),
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

  let verified = false
  let verifyPromise: Promise<void> | null = null

  function clearSessionLocal() {
    verified = false
    verifyPromise = null
    token.value = null
    removeToken()
    saveProfile(null)
    lsSet('dms-user', '')
    window.dispatchEvent(new CustomEvent('dms:logout'))
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('dms:unauthorized', () => {
      clearSessionLocal()
    })
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

      const roleCode = res.role?.code || ''
      const userProfile: UserSessionProfile = {
        id: String(res.user.id),
        u: res.user.username,
        name: res.user.full_name,
        role: roleCode,
        roleName: res.role?.name || '',
        dept: res.user.dept || '',
        avatarUrl: res.user.avatar_url,
        pages: res.pages || [],
        actions: res.actions || [],
        isAll: roleCode === 'admin',
        mustReset: !!res.must_reset_pwd,
      }
      saveProfile(userProfile)
      lsSet('dms-user', remember ? userProfile.id : '')

      // 同步完整用户信息（包含 is_all、phone、email 等）并通知已对接 store 刷新
      await fetchMe()
      window.dispatchEvent(new CustomEvent('dms:login'))
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
      const roleCode = me.role?.code || ''
      const userProfile: UserSessionProfile = {
        id: String(me.user.id),
        u: me.user.username,
        name: me.user.full_name,
        role: roleCode,
        roleName: me.role?.name || '',
        dept: me.user.dept || '',
        phone: me.user.phone || '',
        email: me.user.email || '',
        lastLoginAt: me.user.last_login_at ? me.user.last_login_at.replace('T', ' ').slice(0, 16) : '',
        avatarUrl: me.user.avatar_url,
        pages: me.pages || [],
        actions: me.actions || [],
        isAll: !!me.is_all || roleCode === 'admin',
        mustReset: !!me.user.must_reset_pwd,
      }
      saveProfile(userProfile)
      verified = true
    } catch (err) {
      if (token.value) verified = true
      console.warn('[session] 获取用户信息失败', err)
    }
  }

  /**
   * 首次进入页面时校验一次本地缓存的 token（并发复用同一次请求）
   */
  async function ensureVerified(): Promise<void> {
    if (verified || !getToken()) return
    if (!verifyPromise) {
      verifyPromise = fetchMe().finally(() => {
        verifyPromise = null
      })
    }
    await verifyPromise
  }

  function clearMustReset() {
    if (profile.value) {
      saveProfile({ ...profile.value, mustReset: false })
    }
  }

  async function logout() {
    try {
      if (getToken()) await authApi.logout()
    } catch {
      /* ignore */
    } finally {
      clearSessionLocal()
    }
  }

  const SIDE_COLLAPSED_KEY = 'dms_side_collapsed'
  const theme = ref<ThemeMode>('dark')
  const dark = computed(() => true)
  const collapsed = ref(lsGet(SIDE_COLLAPSED_KEY) === '1')
  function toggleCollapsed() {
    collapsed.value = !collapsed.value
    lsSet(SIDE_COLLAPSED_KEY, collapsed.value ? '1' : '0')
  }
  document.documentElement.setAttribute('data-theme', 'dark')
  document.documentElement.classList.add('cl-theme')

  function can(actionKey: string): boolean {
    if (isAdmin.value) return true
    if (!profile.value) return false
    return profile.value.actions.some(
      (a) =>
        a === actionKey ||
        a === actionKey + ':operate' ||
        a === 'action:' + actionKey ||
        a.startsWith(actionKey + ':')
    )
  }

  function allowed(pageKey: PageKey): boolean {
    if (isAdmin.value) return true
    if (!profile.value) return false
    const pages = profile.value.pages || []
    return pages.includes(pageKey) || pages.includes('page:' + pageKey)
  }

  function toggleTheme() {
    /* 统一深色赛博主题 */
  }

  return {
    uid: computed(() => profile.value?.id ?? ''),
    user,
    role,
    authed,
    login,
    logout,
    fetchMe,
    ensureVerified,
    clearMustReset,
    theme,
    dark,
    collapsed,
    toggleCollapsed,
    info,
    isAdmin,
    can,
    allowed,
    toggleTheme,
  }
})
