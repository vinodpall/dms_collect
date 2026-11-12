import { api } from './client'

export interface UserItem {
  id: number
  username: string
  full_name: string
  dept: string | null
  phone: string | null
  email: string | null
  avatar_url: string | null
  primary_role_id: number | null
  is_active: boolean
  must_reset_pwd: boolean
  last_login_at: string | null
  last_login_ip: string | null
  created_at: string
  updated_at: string
  roles: Array<{ id: number; code: string; name: string }>
}

export interface UserPageResult {
  items: UserItem[]
  total: number
  page: number
  size: number
  pages: number
  stats?: {
    total: number
    active: number
    inactive: number
    must_reset: number
  }
}

export interface UserCreatePayload {
  username: string
  full_name: string
  dept?: string | null
  phone?: string | null
  email?: string | null
  role_ids: number[]
  primary_role_id?: number | null
  password?: string | null
}

export interface UserUpdatePayload {
  full_name?: string | null
  dept?: string | null
  phone?: string | null
  email?: string | null
  avatar_url?: string | null
  role_ids?: number[] | null
  primary_role_id?: number | null
}

export const usersApi = {
  list: (params?: { page?: number; size?: number; keyword?: string; dept?: string; role_id?: number; is_active?: boolean }) =>
    api.get<UserPageResult>('/users', params),
  get: (id: number) => api.get<UserItem>(`/users/${id}`),
  create: (data: UserCreatePayload) =>
    api.post<{ user: UserItem; initial_password: string }>('/users', data),
  update: (id: number, data: UserUpdatePayload) => api.put<UserItem>(`/users/${id}`, data),
  delete: (id: number) => api.del<null>(`/users/${id}`),
  enable: (id: number) => api.post<null>(`/users/${id}/enable`),
  disable: (id: number) => api.post<null>(`/users/${id}/disable`),
  resetPassword: (id: number) =>
    api.post<{ temp_password: string; expires_in_hours: number }>(`/users/${id}/reset-password`),
}
