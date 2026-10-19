import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLES, type PageKey, type RoleKey } from '@/constants'
import { lsGet, lsSet } from '@/utils'

export type ThemeMode = 'auto' | 'light' | 'dark'

export const useSession = defineStore('session', () => {
  const savedAuth = lsGet('dms-auth')
  const initRole = (savedAuth && savedAuth in ROLES ? savedAuth : 'admin') as RoleKey
  const role = ref<RoleKey>(initRole)
  const authed = ref(!!(savedAuth && savedAuth in ROLES))
  /** 演示登录：账号见 DEMO_ACCOUNTS，统一密码 DEMO_PASSWORD；接后端时替换为真实接口 */
  async function login(u: string, pwd: string, remember: boolean): Promise<string | null> {
    await new Promise((r) => setTimeout(r, 700))
    const acc = DEMO_ACCOUNTS.find((a) => a.u === u.trim())
    if (!acc || pwd !== DEMO_PASSWORD) return '账号或密码错误'
    role.value = acc.role
    authed.value = true
    if (remember) lsSet('dms-auth', acc.role)
    else lsSet('dms-auth', '')
    return null
  }
  /** 从训练场入口站跳转时携带角色，免二次登录（演示用；正式环境请改为后端签发的 token 校验） */
  function ssoLogin(r: string): boolean {
    if (!(r in ROLES)) return false
    role.value = r as RoleKey; authed.value = true; lsSet('dms-auth', r)
    return true
  }
  function logout() { authed.value = false; lsSet('dms-auth', '') }
  const saved = lsGet('dms-theme')
  const theme = ref<ThemeMode>(saved === 'light' || saved === 'dark' ? saved : 'auto')
  const collapsed = ref(false)
  const sysDark = ref(typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches)
  if (typeof matchMedia !== 'undefined') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => { sysDark.value = e.matches })
  }
  const dark = computed(() => theme.value === 'dark' || (theme.value === 'auto' && sysDark.value))
  watch(theme, (v) => { if (v !== 'auto') lsSet('dms-theme', v) })
  watch(
    [theme],
    () => {
      const de = document.documentElement
      if (theme.value === 'auto') de.removeAttribute('data-theme')
      else de.setAttribute('data-theme', theme.value)
    },
    { immediate: true },
  )
  const info = computed(() => ROLES[role.value])
  const isAdmin = computed(() => !!info.value.all)
  const can = (k: string) => !!(info.value.all || info.value.can[k])
  const allowed = (p: PageKey) => info.value.pages.includes(p)
  function toggleTheme() { theme.value = dark.value ? 'light' : 'dark' }
  return { role, authed, login, ssoLogin, logout, theme, dark, collapsed, info, isAdmin, can, allowed, toggleTheme }
})
