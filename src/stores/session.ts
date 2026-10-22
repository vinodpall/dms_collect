import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { type PageKey, type RoleKey } from '@/constants'
import { lsGet, lsSet } from '@/utils'
import { useAccess } from '@/stores/access'

/** 统一采用深空蓝赛博主题（方案一），不再区分浅色 / 深色 */
export type ThemeMode = 'dark'

export const useSession = defineStore('session', () => {
  const access = useAccess()
  const uid = ref<string>(lsGet('dms-user') || '')
  const user = computed(() => access.byId(uid.value))
  /** 账号被停用或删除后立即失效 */
  const authed = computed(() => !!user.value && user.value.on)
  const role = computed<RoleKey>(() => user.value?.role ?? '')
  const roleDef = computed(() => access.roleMap[role.value])

  /** 演示登录：账号来自「用户管理」；正式环境请替换为后端登录接口 */
  async function login(u: string, pwd: string, remember: boolean): Promise<string | null> {
    await new Promise((r) => setTimeout(r, 700))
    const acc = access.byAccount(u)
    if (!acc || !(await access.checkPwd(acc, pwd))) return '账号或密码错误'
    if (!acc.on) return '该账号已停用，请联系系统管理员'
    if (!access.roleMap[acc.role]) return '该账号未分配有效角色，请联系系统管理员'
    uid.value = acc.id
    access.touch(acc.id)
    lsSet('dms-user', remember ? acc.id : '')
    return null
  }
  function logout() { uid.value = ''; lsSet('dms-user', '') }

  const theme = ref<ThemeMode>('dark')
  const dark = computed(() => true)
  const collapsed = ref(false)
  document.documentElement.setAttribute('data-theme', 'dark')
  document.documentElement.classList.add('cl-theme')

  const info = computed(() => ({
    name: roleDef.value?.name ?? '未分配角色',
    user: user.value?.name ?? '',
    init: (user.value?.name ?? '?').slice(0, 1),
    account: user.value?.u ?? '',
  }))
  const isAdmin = computed(() => !!roleDef.value?.all)
  const can = (k: string) => !!(roleDef.value && (roleDef.value.all || roleDef.value.can[k]))
  const allowed = (p: PageKey) => !!(roleDef.value && (roleDef.value.all || roleDef.value.pages.includes(p)))
  function toggleTheme() { /* 统一深色主题 */ }
  return { uid, user, role, authed, login, logout, theme, dark, collapsed, info, isAdmin, can, allowed, toggleTheme }
})
