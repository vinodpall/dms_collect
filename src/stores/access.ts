import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { DEMO_PASSWORD, ROLES, type PageKey, type RoleDef, type RoleKey } from '@/constants'
import { lsGet, lsSet } from '@/utils'

/**
 * 用户与权限（演示版）：数据暂存浏览器本地，仅用于前端演示。
 * 正式环境必须由后端完成账号校验、密码存储与权限判定，这里的接口需替换为后端调用。
 * 密码只保存 SHA-256 摘要；pwd 为空表示仍是初始密码。
 */
export interface RoleRow extends RoleDef { key: RoleKey; desc: string; builtin: boolean }
export interface UserRow {
  id: string; u: string; name: string; role: RoleKey; dept: string; phone: string; email: string
  on: boolean; last: string; created: string; pwd: string | null; mustReset?: boolean
}

const ROLE_DESC: Record<string, string> = {
  admin: '拥有全部页面与操作权限，内置角色不可删除',
  op: '在工位执行采集任务，查看实时监控',
  ann: '处理流水线批次、完成手动标注',
  rev: '审核标注结果，发布与导出数据集',
  mt: '维护设备台账，处理设备与存储告警',
}
const seedRoles = (): RoleRow[] => Object.entries(ROLES).map(([key, r]) => ({ ...r, init: r.name.slice(0, 1), pages: [...r.pages], can: { ...r.can }, key, desc: ROLE_DESC[key] ?? '', builtin: true }))
const seedUsers = (): UserRow[] => ([
  ['zhou', 'admin', '周工', 'admin', '平台运维部', '138 0000 1001', '10-01 09:00', '今天 08:41', true],
  ['zhangjie', 'zhangjie', '张杰', 'op', '采集一组', '138 0000 1002', '10-02 10:20', '今天 09:02', true],
  ['liming', 'liming', '李明', 'op', '采集一组', '138 0000 1003', '10-02 10:22', '昨天 17:30', true],
  ['linyue', 'linyue', '林悦', 'ann', '数据标注组', '138 0000 1004', '10-03 14:05', '今天 10:15', true],
  ['chenjing', 'chenjing', '陈静', 'rev', '质量审核组', '138 0000 1005', '10-03 14:10', '今天 10:40', true],
  ['zhaogong', 'zhaogong', '赵工', 'mt', '设备保障组', '138 0000 1006', '10-04 09:30', '今天 08:55', true],
  ['chenhao', 'chenhao', '陈浩', 'op', '采集二组', '138 0000 1007', '10-05 11:00', '10-09 16:20', false],
] as const).map(([id, u, name, role, dept, phone, created, last, on]) => ({ id, u, name, role, dept, phone, email: u + '@dms.local', created, last, on, pwd: null }))

export async function hashPwd(u: string, p: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dms:' + u + ':' + p))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** 生成临时密码：去掉易混淆字符 */
export function tempPwd(n = 10): string {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => cs[x % cs.length]).join('')
}
const stamp = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` }

export const useAccess = defineStore('access', () => {
  let saved: { roles?: RoleRow[]; users?: UserRow[] } = {}
  try { saved = JSON.parse(lsGet('dms-access') || '{}') } catch { saved = {} }
  const roles = ref<RoleRow[]>(saved.roles?.length ? saved.roles : seedRoles())
  const users = ref<UserRow[]>(saved.users?.length ? saved.users : seedUsers())
  const adm = roles.value.find((r) => r.key === 'admin')
  if (adm) adm.pages = [...ROLES.admin.pages] // 内置管理员始终拥有全部页面
  watch([roles, users], () => lsSet('dms-access', JSON.stringify({ roles: roles.value, users: users.value })), { deep: true })

  const roleMap = computed(() => Object.fromEntries(roles.value.map((r) => [r.key, r])) as Record<RoleKey, RoleRow>)
  const byId = (id: string) => users.value.find((u) => u.id === id)
  const byAccount = (u: string) => users.value.find((x) => x.u.toLowerCase() === u.trim().toLowerCase())
  const memberCount = (k: RoleKey) => users.value.filter((u) => u.role === k).length
  const activeAdmins = computed(() => users.value.filter((u) => u.on && roleMap.value[u.role]?.all).length)

  async function checkPwd(x: UserRow, p: string) { return x.pwd ? x.pwd === (await hashPwd(x.u, p)) : p === DEMO_PASSWORD }
  async function setPwd(id: string, p: string, mustReset = true) { const x = byId(id); if (x) { x.pwd = await hashPwd(x.u, p); x.mustReset = mustReset } }
  function touch(id: string) { const x = byId(id); if (x) x.last = '今天 ' + stamp().slice(6) }

  async function addUser(d: Pick<UserRow, 'u' | 'name' | 'role' | 'dept' | 'phone' | 'email'>, pwd: string) {
    const id = 'u' + Date.now().toString(36)
    users.value.unshift({ ...d, id, on: true, last: '—', created: stamp(), pwd: null })
    await setPwd(id, pwd)
    return id
  }
  function updateUser(id: string, d: Partial<Pick<UserRow, 'name' | 'role' | 'dept' | 'phone' | 'email'>>) { const x = byId(id); if (x) Object.assign(x, d) }
  function setOn(id: string, on: boolean) { const x = byId(id); if (x) x.on = on }
  function removeUser(id: string) { users.value = users.value.filter((u) => u.id !== id) }

  function addRole(d: { name: string; desc: string; from?: RoleKey }) {
    const src = d.from ? roleMap.value[d.from] : undefined
    const key = 'r' + Date.now().toString(36)
    const pages: PageKey[] = src ? src.pages.filter((p) => p !== 'users' && p !== 'roles') : ['dashboard']
    roles.value.push({ key, name: d.name, desc: d.desc, user: '', init: d.name.slice(0, 1), builtin: false, pages, can: src && !src.all ? { ...src.can } : {} })
    return key
  }
  function updateRole(key: RoleKey, d: { name?: string; desc?: string; pages?: PageKey[]; can?: Record<string, 1> }) {
    const r = roleMap.value[key]
    if (!r) return
    if (d.name !== undefined) { r.name = d.name; r.init = d.name.slice(0, 1) }
    if (d.desc !== undefined) r.desc = d.desc
    if (r.all) return // 管理员权限固定
    if (d.pages) r.pages = d.pages
    if (d.can) r.can = d.can
  }
  function removeRole(key: RoleKey) { roles.value = roles.value.filter((r) => r.key !== key || r.builtin) }

  return { roles, users, roleMap, byId, byAccount, memberCount, activeAdmins, checkPwd, setPwd, touch, addUser, updateUser, setOn, removeUser, addRole, updateRole, removeRole }
})
