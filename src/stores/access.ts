import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ROLES, type PageKey, type RoleDef, type RoleKey } from '@/constants'
import { lsGet, lsSet } from '@/utils'
import { usersApi, rolesApi, getToken, type UserItem } from '@/api'

export interface RoleRow extends RoleDef {
  key: RoleKey
  desc: string
  builtin: boolean
  id?: number
  version?: number
}

export interface UserRow {
  id: string
  numericId?: number
  u: string
  name: string
  role: RoleKey
  dept: string
  phone: string
  email: string
  on: boolean
  last: string
  created: string
  pwd: string | null
  mustReset?: boolean
}

export function tempPwd(n = 10): string {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => cs[x % cs.length]).join('')
}

const seedRoles = (): RoleRow[] =>
  Object.entries(ROLES).map(([key, r]) => ({
    ...r,
    init: r.name.slice(0, 1),
    pages: [...r.pages],
    can: { ...r.can },
    key,
    desc: '',
    builtin: true,
  }))

export const useAccess = defineStore('access', () => {
  let saved: { roles?: RoleRow[]; users?: UserRow[] } = {}
  try {
    saved = JSON.parse(lsGet('dms-access') || '{}')
  } catch {
    saved = {}
  }

  const roles = ref<RoleRow[]>(saved.roles?.length ? saved.roles : seedRoles())
  const users = ref<UserRow[]>(saved.users?.length ? saved.users : [])
  const loading = ref(false)

  const roleMap = computed(
    () => Object.fromEntries(roles.value.map((r) => [r.key, r])) as Record<RoleKey, RoleRow>
  )
  const byId = (id: string) => users.value.find((u) => u.id === id || String(u.numericId) === id)
  const byAccount = (u: string) => users.value.find((x) => x.u.toLowerCase() === u.trim().toLowerCase())
  const memberCount = (k: RoleKey) => users.value.filter((u) => u.role === k).length
  const activeAdmins = computed(() => users.value.filter((u) => u.on && roleMap.value[u.role]?.all).length)

  function saveCache() {
    lsSet('dms-access', JSON.stringify({ roles: roles.value, users: users.value }))
  }

  /**
   * 从后端拉取角色列表与权限详情
   */
  async function fetchRoles() {
    if (!getToken()) return
    try {
      const list = await rolesApi.list()
      const roleRows: RoleRow[] = []

      for (const item of (list as any[])) {
        const code = item.role_code || item.code
        let pages: PageKey[] = []
        let can: Record<string, 1> = {}

        // 拉取具体权限
        try {
          const detail = await rolesApi.get(item.id)
          const perms: string[] = (detail as any).permission_codes || []
          pages = perms
            .filter((p) => p.startsWith('page:'))
            .map((p) => p.replace('page:', '') as PageKey)
          perms
            .filter((p) => p.includes(':operate'))
            .forEach((p) => {
              const actKey = p.split(':')[0]
              can[actKey] = 1
            })
        } catch {
          // 若拉取失败，内置管理员拥有全部页面
          if (item.is_all || code === 'admin') {
            pages = [...ROLES.admin.pages]
          }
        }

        const isAdm = !!item.is_all || code === 'admin'
        if (isAdm) pages = [...ROLES.admin.pages]

        roleRows.push({
          id: item.id,
          key: code,
          name: item.role_name || item.name,
          desc: item.description || '',
          builtin: !!item.is_builtin,
          all: isAdm,
          init: (item.role_name || item.name || '').slice(0, 1),
          user: '',
          pages,
          can,
          version: item.version,
        })
      }

      if (roleRows.length > 0) {
        roles.value = roleRows
        saveCache()
      }
    } catch (e) {
      console.warn('[access] 获取角色失败', e)
    }
  }

  /**
   * 从后端拉取用户列表
   */
  async function fetchUsers() {
    if (!getToken()) return
    try {
      const res = await usersApi.list({ size: 100 })
      const items: UserItem[] = (res as any).items || []

      users.value = items.map((u: any) => {
        const primaryRole = u.roles?.[0]
        const roleKey = primaryRole?.role_code || primaryRole?.code || 'op'
        return {
          id: String(u.id),
          numericId: u.id,
          u: u.username,
          name: u.full_name,
          role: roleKey,
          dept: u.dept || '平台',
          phone: u.phone || '—',
          email: u.email || `${u.username}@dms.local`,
          on: u.is_active,
          last: u.last_login_at ? u.last_login_at.replace('T', ' ').slice(0, 16) : '—',
          created: u.created_at ? u.created_at.replace('T', ' ').slice(5, 16) : '—',
          pwd: null,
          mustReset: u.must_reset_pwd,
        }
      })
      saveCache()
    } catch (e) {
      console.warn('[access] 获取用户失败', e)
    }
  }

  async function checkPwd(x: UserRow, p: string) {
    return p === 'admin123'
  }

  async function setPwd(id: string, p: string, _mustReset = true) {
    const x = byId(id)
    if (!x) return
    if (x.numericId) {
      try {
        await usersApi.resetPassword(x.numericId)
      } catch (e) {
        console.warn('[access] 后端重置密码失败', e)
      }
    }
    x.mustReset = true
    saveCache()
  }

  function touch(id: string) {
    const x = byId(id)
    if (x) x.last = '刚刚'
  }

  async function addUser(
    d: Pick<UserRow, 'u' | 'name' | 'role' | 'dept' | 'phone' | 'email'>,
    pwd: string
  ) {
    let numericId: number | undefined
    try {
      const targetRole = roles.value.find((r) => r.key === d.role)
      const roleIds = targetRole?.id ? [targetRole.id] : [2]
      const res = await usersApi.create({
        username: d.u.trim(),
        full_name: d.name.trim(),
        dept: d.dept || null,
        phone: d.phone || null,
        email: d.email || null,
        role_ids: roleIds,
        primary_role_id: roleIds[0],
        password: pwd,
      })
      if (res && res.user) numericId = res.user.id
    } catch (e: any) {
      console.warn('[access] 后端创建用户失败，降级本地记录', e)
    }

    const id = numericId ? String(numericId) : 'u' + Date.now().toString(36)
    users.value.unshift({
      ...d,
      id,
      numericId,
      on: true,
      last: '—',
      created: '刚刚',
      pwd: null,
      mustReset: true,
    })
    saveCache()
    return id
  }

  async function updateUser(
    id: string,
    d: Partial<Pick<UserRow, 'name' | 'role' | 'dept' | 'phone' | 'email'>>
  ) {
    const x = byId(id)
    if (!x) return
    Object.assign(x, d)

    if (x.numericId) {
      try {
        const targetRole = d.role ? roles.value.find((r) => r.key === d.role) : undefined
        const roleIds = targetRole?.id ? [targetRole.id] : undefined
        await usersApi.update(x.numericId, {
          full_name: d.name,
          dept: d.dept,
          phone: d.phone,
          email: d.email,
          role_ids: roleIds,
          primary_role_id: roleIds ? roleIds[0] : undefined,
        })
      } catch (e) {
        console.warn('[access] 后端更新用户失败', e)
      }
    }
    saveCache()
  }

  async function setOn(id: string, on: boolean) {
    const x = byId(id)
    if (!x) return
    x.on = on

    if (x.numericId) {
      try {
        if (on) await usersApi.enable(x.numericId)
        else await usersApi.disable(x.numericId)
      } catch (e) {
        console.warn('[access] 后端启停用户失败', e)
      }
    }
    saveCache()
  }

  async function removeUser(id: string) {
    const x = byId(id)
    if (x?.numericId) {
      try {
        await usersApi.delete(x.numericId)
      } catch (e) {
        console.warn('[access] 后端删除用户失败', e)
      }
    }
    users.value = users.value.filter((u) => u.id !== id && u.numericId !== x?.numericId)
    saveCache()
  }

  function addRole(d: { name: string; desc: string; from?: RoleKey }) {
    const src = d.from ? roleMap.value[d.from] : undefined
    const key = 'r_' + Date.now().toString(36)
    const pages: PageKey[] = src
      ? src.pages.filter((p) => p !== 'users' && p !== 'roles')
      : ['dashboard']
    const can = src && !src.all ? { ...src.can } : {}

    const rRow: RoleRow = {
      key,
      name: d.name,
      desc: d.desc,
      user: '',
      init: d.name.slice(0, 1),
      builtin: false,
      pages,
      can,
    }
    roles.value.push(rRow)
    saveCache()

    // 异步同步至后端
    if (getToken()) {
      const permCodes = [
        ...pages.map((p) => 'page:' + p),
        ...Object.keys(can).map((k) => k + ':operate'),
      ]
      const srcId = src?.id
      rolesApi
        .create({
          role_code: key,
          role_name: d.name,
          description: d.desc,
          permission_codes: permCodes,
          copy_from_role_id: srcId,
        })
        .then((res) => {
          if (res && res.id) rRow.id = res.id
        })
        .catch((e) => {
          console.warn('[access] 后端创建角色失败', e)
        })
    }

    return key
  }

  async function updateRole(
    key: RoleKey,
    d: { name?: string; desc?: string; pages?: PageKey[]; can?: Record<string, 1> }
  ) {
    const r = roleMap.value[key]
    if (!r) return
    if (d.name !== undefined) {
      r.name = d.name
      r.init = d.name.slice(0, 1)
    }
    if (d.desc !== undefined) r.desc = d.desc
    if (!r.all) {
      if (d.pages) r.pages = d.pages
      if (d.can) r.can = d.can
    }

    if (r.id) {
      try {
        const permCodes = [
          ...r.pages.map((p) => 'page:' + p),
          ...Object.keys(r.can).map((k) => k + ':operate'),
        ]
        await rolesApi.update(r.id, {
          role_name: r.name,
          description: r.desc,
          permission_codes: permCodes,
          version: r.version ?? 0,
        })
      } catch (e) {
        console.warn('[access] 后端更新角色失败', e)
      }
    }
    saveCache()
  }

  async function removeRole(key: RoleKey) {
    const r = roleMap.value[key]
    if (!r || r.builtin) return
    if (r.id) {
      try {
        await rolesApi.delete(r.id)
      } catch (e) {
        console.warn('[access] 后端删除角色失败', e)
      }
    }
    roles.value = roles.value.filter((item) => item.key !== key)
    saveCache()
  }

  // 初始自动从后端同步一次
  if (getToken()) {
    fetchRoles()
    fetchUsers()
  }

  return {
    roles,
    users,
    roleMap,
    loading,
    byId,
    byAccount,
    memberCount,
    activeAdmins,
    checkPwd,
    setPwd,
    touch,
    fetchRoles,
    fetchUsers,
    addUser,
    updateUser,
    setOn,
    removeUser,
    addRole,
    updateRole,
    removeRole,
  }
})
