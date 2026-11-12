import { api } from './client'

export interface RoleListItem {
  id: number
  code: string
  name: string
  description: string | null
  is_builtin: boolean
  sort_order: number
  member_count: number
  page_count: number
  action_count: number
  version: number
}

export interface PermissionNode {
  code: string
  name: string
  type: 'page' | 'action'
  parent_code?: string | null
  children?: PermissionNode[]
}

export interface RoleDetail {
  id: number
  code: string
  name: string
  description: string | null
  is_builtin: boolean
  sort_order: number
  version: number
  permissions: string[]
  data_scope: Record<string, any> | null
  members: Array<{
    id: number
    username: string
    full_name: string
    dept: string | null
    avatar_url: string | null
  }>
}

export interface RoleCreatePayload {
  role_code: string
  role_name: string
  description?: string | null
  permission_codes?: string[]
  data_scope?: Record<string, string> | null
  copy_from_role_id?: number | null
  sort_order?: number
}

export interface RoleUpdatePayload {
  role_name?: string | null
  description?: string | null
  permission_codes?: string[] | null
  data_scope?: Record<string, string> | null
  sort_order?: number | null
  version: number
}

export const rolesApi = {
  list: () => api.get<RoleListItem[]>('/roles'),
  getPermissions: () => api.get<PermissionNode[]>('/roles/permissions'),
  get: (id: number) => api.get<RoleDetail>(`/roles/${id}`),
  create: (data: RoleCreatePayload) => api.post<RoleDetail>('/roles', data),
  update: (id: number, data: RoleUpdatePayload) => api.put<RoleDetail>(`/roles/${id}`, data),
  delete: (id: number) => api.del<null>(`/roles/${id}`),
}
