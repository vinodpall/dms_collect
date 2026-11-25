import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ACTIONS, PAGE_META, ROLES, type PageKey, type RoleKey } from '@/constants'
import {
  usersApi,
  rolesApi,
  getToken,
  type PermissionNode,
  type RoleDetail,
  type RoleListItem,
  type UserItem,
} from '@/api'

export interface RoleMember {
  id: number
  username: string
  full_name: string
  dept: string | null
  avatar_url: string | null
}

export interface RoleRow {
  id: number
  key: RoleKey
  name: string
  user: string
  init: string
  all?: boolean
  pages: PageKey[]
  can: Record<string, 1>
  desc: string
  builtin: boolean
  members: RoleMember[]
  memberCount: number
  version: number
  detailLoaded: boolean
}

export interface ActionDef {
  key: string
  permCode: string
  label: string
  page: PageKey
}

export interface UserRow {
  id: string
  numericId: number
  u: string
  name: string
  role: RoleKey
  roleIds: number[]
  primaryRoleId: number | null
  dept: string
  phone: string
  email: string
  on: boolean
  last: string
  lastIp: string
  created: string
  pwd: string | null
  mustReset: boolean
}

export function tempPwd(n = 10): string {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => cs[x % cs.length]).join('')
}

function flattenPermNodes(nodes: PermissionNode[]): PermissionNode[] {
  const out: PermissionNode[] = []
  const walk = (arr: PermissionNode[]) => {
    for (const n of arr) {
      out.push(n)
      if (Array.isArray(n.children) && n.children.length) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

function mapApiUser(u: UserItem): UserRow {
  const primaryRole =
    (u.primary_role_id ? u.roles?.find((r) => r.id === u.primary_role_id) : undefined) ?? u.roles?.[0]
  const roleKey = primaryRole?.code || (primaryRole as any)?.role_code || ''
  return {
    id: String(u.id),
    numericId: u.id,
    u: u.username,
    name: u.full_name,
    role: roleKey,
    roleIds: (u.roles || []).map((r) => r.id),
    primaryRoleId: u.primary_role_id ?? primaryRole?.id ?? null,
    dept: u.dept || '',
    phone: u.phone || '',
    email: u.email || '',
    on: !!u.is_active,
    last: u.last_login_at ? u.last_login_at.replace('T', ' ').slice(0, 16) : '',
    lastIp: u.last_login_ip || '',
    created: u.created_at ? u.created_at.replace('T', ' ').slice(0, 16) : '',
    pwd: null,
    mustReset: !!u.must_reset_pwd,
  }
}

export const useAccess = defineStore('access', () => {
  // 清理历史版本遗留的本地缓存
  try {
    localStorage.removeItem('dms-access')
  } catch {
    /* ignore */
  }

  const roles = ref<RoleRow[]>([])
  const users = ref<UserRow[]>([])
  const userTotal = ref(0)
  const permNodes = ref<PermissionNode[]>([])
  const loadingRoles = ref(false)
  const loadingUsers = ref(false)
  const loading = computed(() => loadingRoles.value || loadingUsers.value)

  const roleMap = computed(
    () => Object.fromEntries(roles.value.map((r) => [r.key, r])) as Record<RoleKey, RoleRow>
  )
  const byId = (id: string) => users.value.find((u) => u.id === id || String(u.numericId) === id)
  const byAccount = (u: string) => users.value.find((x) => x.u.toLowerCase() === u.trim().toLowerCase())
  const memberCount = (k: RoleKey) => {
    const r = roleMap.value[k]
    if (r) return r.members?.length || r.memberCount || 0
    return users.value.filter((u) => u.role === k).length
  }
  const activeAdmins = computed(() => users.value.filter((u) => u.on && roleMap.value[u.role]?.all).length)

  /** 结合 constants 与 /roles/permissions 生成完整权限编码映射 */
  const flatPerms = computed(() => flattenPermNodes(permNodes.value))

  const pageCodeMap = computed(() => {
    const map: Record<string, string> = {}
    for (const p of Object.keys(PAGE_META) as PageKey[]) {
      const node = flatPerms.value.find(
        (n) => n.type === 'page' && (n.code === 'page:' + p || n.code === p)
      )
      map[p] = node ? node.code : 'page:' + p
    }
    return map
  })

  const actionCatalog = computed<ActionDef[]>(() => {
    const list: ActionDef[] = ACTIONS.map((a) => {
      const node = flatPerms.value.find(
        (n) =>
          n.type === 'action' &&
          (n.code === a.key + ':operate' ||
            n.code === a.key + ':edit' ||
            n.code === 'action:' + a.key ||
            n.code === a.key)
      )
      return {
        key: a.key,
        permCode: node ? node.code : a.key + ':operate',
        label: node?.name || a.label,
        page: a.page,
      }
    })
    // 补充后端额外下发但前端常量未收录的 action 节点
    for (const n of flatPerms.value) {
      if (n.type !== 'action') continue
      if (list.some((x) => x.permCode === n.code || x.key === n.code)) continue
      const parentRaw = (n.parent_code || '').replace(/^page:/, '')
      const prefix = n.code.includes(':') ? n.code.split(':')[0] : n.code
      const pageGuess = (parentRaw in PAGE_META ? parentRaw : prefix in PAGE_META ? prefix : null) as PageKey | null
      if (!pageGuess) continue
      list.push({
        key: n.code,
        permCode: n.code,
        label: n.name || n.code,
        page: pageGuess,
      })
    }
    return list
  })

  function parsePermissions(perms: string[]) {
    const set = new Set(perms)
    const pages = (Object.keys(PAGE_META) as PageKey[]).filter(
      (p) => set.has('page:' + p) || set.has(p) || (pageCodeMap.value[p] && set.has(pageCodeMap.value[p]))
    )
    const can: Record<string, 1> = {}
    for (const act of actionCatalog.value) {
      if (
        set.has(act.permCode) ||
        set.has(act.key + ':operate') ||
        set.has(act.key + ':edit') ||
        set.has('action:' + act.key) ||
        (act.key.includes(':') && set.has(act.key))
      ) {
        can[act.key] = 1
      }
    }
    return { pages, can }
  }

  function encodePermissions(pages: PageKey[], can: Record<string, 1>): string[] {
    const pageCodes = pages.map((p) => pageCodeMap.value[p] || 'page:' + p)
    const actMap = Object.fromEntries(actionCatalog.value.map((a) => [a.key, a.permCode]))
    const actCodes = Object.keys(can)
      .filter((k) => can[k])
      .map((k) => actMap[k] || (k.includes(':') ? k : k + ':operate'))
    return Array.from(new Set([...pageCodes, ...actCodes]))
  }

  function mapRoleToRow(item: RoleListItem | RoleDetail, detail?: RoleDetail | null, fallback?: RoleRow): RoleRow {
    const anyItem = item as any
    const anyDetail = detail as any
    const code = anyDetail?.code || anyDetail?.role_code || anyItem.code || anyItem.role_code || fallback?.key || ''
    const name = anyDetail?.name || anyDetail?.role_name || anyItem.name || anyItem.role_name || fallback?.name || code
    const isAdm = !!(anyDetail?.is_all ?? anyItem.is_all ?? fallback?.all) || code === 'admin'
    const perms: string[] = anyDetail?.permissions ?? anyDetail?.permission_codes ?? anyItem.permissions ?? anyItem.permission_codes ?? []
    const parsed = parsePermissions(perms)
    const pages = isAdm ? [...ROLES.admin.pages] : parsed.pages
    const can = isAdm ? {} : parsed.can
    const members: RoleMember[] = Array.isArray(anyDetail?.members) ? anyDetail.members : []
    const version = detail?.version ?? item.version ?? fallback?.version ?? 0
    return {
      id: item.id,
      key: code,
      name,
      user: members[0]?.full_name || '',
      init: (name || '?').slice(0, 1),
      all: isAdm,
      desc: (detail?.description ?? item.description ?? fallback?.desc) || '',
      builtin: !!(detail?.is_builtin ?? item.is_builtin ?? fallback?.builtin),
      pages,
      can,
      members,
      memberCount: (anyDetail?.member_count ?? anyItem.member_count ?? fallback?.memberCount ?? members.length) as number,
      version,
      detailLoaded: !!detail,
    }
  }

  let rolesPromise: Promise<RoleRow[]> | null = null

  /** 从后端拉取角色列表、权限树与角色详情（并发调用复用同一次请求） */
  async function fetchRoles(): Promise<RoleRow[]> {
    if (!getToken()) return []
    if (rolesPromise) return rolesPromise
    rolesPromise = (async () => {
      loadingRoles.value = true
      try {
        const [listRes, permsRes] = await Promise.allSettled([rolesApi.list(), rolesApi.getPermissions()])
        if (permsRes.status === 'fulfilled' && Array.isArray(permsRes.value)) {
          permNodes.value = permsRes.value
        }
        if (listRes.status === 'rejected') {
          throw listRes.reason
        }
        const list = Array.isArray(listRes.value) ? listRes.value : []
        const details = await Promise.allSettled(list.map((item) => rolesApi.get(item.id)))
        const roleRows = list.map((item, idx) => {
          const dRes = details[idx]
          const detail = dRes && dRes.status === 'fulfilled' ? dRes.value : null
          return mapRoleToRow(item, detail)
        })
        roles.value = roleRows
        return roleRows
      } finally {
        loadingRoles.value = false
        rolesPromise = null
      }
    })()
    return rolesPromise
  }

  /** 按需拉取单个角色详情（仅在未加载详情或显式刷新时调用） */
  async function fetchRoleDetail(id: number): Promise<RoleRow | null> {
    if (!getToken()) return null
    const detail = await rolesApi.get(id)
    const existing = roles.value.find((r) => r.id === id)
    const mapped = mapRoleToRow(detail, detail, existing)
    const idx = roles.value.findIndex((r) => r.id === id)
    if (idx >= 0) roles.value[idx] = mapped
    else roles.value.push(mapped)
    return mapped
  }

  /** 从后端拉取用户列表（支持服务端分页与筛选） */
  async function fetchUsers(params?: {
    page?: number
    size?: number
    keyword?: string
    dept?: string
    role_id?: number
    is_active?: boolean
  }) {
    if (!getToken()) return { items: [], total: 0, page: 1, size: 10, pages: 0 }
    loadingUsers.value = true
    try {
      const res = await usersApi.list({ page: 1, size: 100, ...params })
      const items: UserItem[] = res?.items || []
      users.value = items.map(mapApiUser)
      userTotal.value = res?.total ?? items.length
      return res
    } finally {
      loadingUsers.value = false
    }
  }

  async function fetchUserDetail(numericId: number): Promise<UserRow> {
    const u = await usersApi.get(numericId)
    const row = mapApiUser(u)
    const idx = users.value.findIndex((x) => x.numericId === numericId)
    if (idx >= 0) users.value[idx] = row
    return row
  }

  async function addUser(
    d: Pick<UserRow, 'u' | 'name' | 'role' | 'dept' | 'phone' | 'email'>,
    pwd: string
  ): Promise<{ user: UserRow; initialPassword: string }> {
    const targetRole = roles.value.find((r) => r.key === d.role)
    if (!targetRole?.id) {
      throw new Error('未找到所选角色对应的后端 ID，请刷新后重试')
    }
    const res = await usersApi.create({
      username: d.u.trim(),
      full_name: d.name.trim(),
      dept: d.dept ? d.dept.trim() : null,
      phone: d.phone ? d.phone.trim() : null,
      email: d.email ? d.email.trim() : null,
      role_ids: [targetRole.id],
      primary_role_id: targetRole.id,
      password: pwd || null,
    })
    const createdRow = mapApiUser(res.user)
    users.value.unshift(createdRow)
    userTotal.value += 1
    return {
      user: createdRow,
      initialPassword: res.initial_password || pwd,
    }
  }

  async function updateUser(
    id: string,
    d: Partial<Pick<UserRow, 'name' | 'role' | 'dept' | 'phone' | 'email'>>
  ): Promise<UserRow> {
    const x = byId(id)
    if (!x) throw new Error('用户不存在')
    const targetRole = d.role ? roles.value.find((r) => r.key === d.role) : undefined
    if (d.role && !targetRole?.id) {
      throw new Error('未找到所选角色对应的后端 ID')
    }
    const updated = await usersApi.update(x.numericId, {
      full_name: d.name !== undefined ? d.name : undefined,
      dept: d.dept !== undefined ? (d.dept || null) : undefined,
      phone: d.phone !== undefined ? (d.phone || null) : undefined,
      email: d.email !== undefined ? (d.email || null) : undefined,
      role_ids: targetRole ? [targetRole.id] : undefined,
      primary_role_id: targetRole ? targetRole.id : undefined,
    })
    const row = mapApiUser(updated)
    const idx = users.value.findIndex((u) => u.numericId === x.numericId)
    if (idx >= 0) users.value[idx] = row
    return row
  }

  async function setOn(id: string, on: boolean): Promise<void> {
    const x = byId(id)
    if (!x) throw new Error('用户不存在')
    if (on) await usersApi.enable(x.numericId)
    else await usersApi.disable(x.numericId)
    x.on = on
  }

  async function resetUserPassword(id: string): Promise<{ temp_password: string; expires_in_hours: number }> {
    const x = byId(id)
    if (!x) throw new Error('用户不存在')
    const res = await usersApi.resetPassword(x.numericId)
    x.mustReset = true
    return res
  }

  async function removeUser(id: string): Promise<void> {
    const x = byId(id)
    if (!x) throw new Error('用户不存在')
    await usersApi.delete(x.numericId)
    users.value = users.value.filter((u) => u.numericId !== x.numericId)
    userTotal.value = Math.max(0, userTotal.value - 1)
  }

  async function addRole(d: { name: string; desc: string; from?: RoleKey }): Promise<RoleKey> {
    const src = d.from ? roleMap.value[d.from] : undefined
    const filteredPages: PageKey[] = src
      ? src.pages.filter((p) => p !== 'users' && p !== 'roles')
      : ['dashboard']
    const pages: PageKey[] = filteredPages.length ? filteredPages : ['dashboard']
    const can: Record<string, 1> = {}
    if (src && !src.all) {
      const restricted = new Set(
        actionCatalog.value.filter((a) => a.page === 'users' || a.page === 'roles').map((a) => a.key)
      )
      for (const [k, v] of Object.entries(src.can)) {
        if (v && !restricted.has(k)) can[k] = 1
      }
    }
    const roleCode = 'r_' + Date.now().toString(36).toLowerCase()
    const permCodes = encodePermissions(pages, can)

    const res = await rolesApi.create({
      role_code: roleCode,
      role_name: d.name.trim(),
      description: d.desc.trim() || null,
      permission_codes: permCodes,
      copy_from_role_id: src?.id ?? null,
    })
    await fetchRoles()
    return (res as any)?.code || (res as any)?.role_code || roleCode
  }

  async function updateRole(
    key: RoleKey,
    d: { name?: string; desc?: string; pages?: PageKey[]; can?: Record<string, 1> }
  ): Promise<RoleRow> {
    const r = roleMap.value[key]
    if (!r) throw new Error('角色不存在')

    const nextName = d.name !== undefined ? d.name.trim() : r.name
    const nextDesc = d.desc !== undefined ? d.desc.trim() : r.desc
    const nextPages = !r.all && d.pages ? d.pages : r.pages
    const nextCan = !r.all && d.can ? d.can : r.can
    const permCodes = r.all ? undefined : encodePermissions(nextPages, nextCan)

    const updated = await rolesApi.update(r.id, {
      role_name: nextName,
      description: nextDesc || null,
      permission_codes: permCodes,
      version: r.version,
    })

    const mapped = mapRoleToRow(
      updated,
      updated,
      { ...r, name: nextName, desc: nextDesc }
    )
    const idx = roles.value.findIndex((item) => item.key === key || item.id === r.id)
    if (idx >= 0) roles.value[idx] = mapped
    return mapped
  }

  async function removeRole(key: RoleKey): Promise<void> {
    const r = roleMap.value[key]
    if (!r) throw new Error('角色不存在')
    if (r.builtin) throw new Error('内置角色不可删除')
    await rolesApi.delete(r.id)
    roles.value = roles.value.filter((item) => item.id !== r.id)
  }

  function reset() {
    roles.value = []
    users.value = []
    userTotal.value = 0
    permNodes.value = []
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('dms:login', () => {
      fetchRoles().catch(() => {})
    })
    window.addEventListener('dms:logout', reset)
  }

  if (getToken()) {
    fetchRoles().catch((e) => console.warn('[access] 初始化角色失败', e))
  }

  return {
    roles,
    users,
    userTotal,
    permNodes,
    actionCatalog,
    roleMap,
    loading,
    loadingRoles,
    loadingUsers,
    byId,
    byAccount,
    memberCount,
    activeAdmins,
    fetchRoles,
    fetchRoleDetail,
    fetchUsers,
    fetchUserDetail,
    addUser,
    updateUser,
    setOn,
    resetUserPassword,
    removeUser,
    addRole,
    updateRole,
    removeRole,
    reset,
  }
})
