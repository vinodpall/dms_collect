import { api } from './client'

export interface LoginParams {
  username: string
  password: string
}

export interface LoginResult {
  access_token: string
  token_type: string
  expires_in: number
  must_reset_pwd: boolean
  user: {
    id: number
    username: string
    full_name: string
    dept: string | null
    avatar_url: string | null
  }
  role: {
    id: number
    code: string
    name: string
  }
  roles: Array<{
    id: number
    code: string
    name: string
  }>
  pages: string[]
  actions: string[]
}

export interface CurrentUserDetail {
  user: {
    id: number
    username: string
    full_name: string
    dept: string | null
    avatar_url: string | null
    phone: string | null
    email: string | null
    must_reset_pwd: boolean
    preferences: Record<string, any> | null
    last_login_at: string | null
    last_login_ip: string | null
  }
  role: {
    id: number
    code: string
    name: string
  }
  roles: Array<{
    id: number
    code: string
    name: string
  }>
  pages: string[]
  actions: string[]
  data_scope: Record<string, any>
  is_all: boolean
  unread_notifications: number
}

export const authApi = {
  login: (data: LoginParams) => api.post<LoginResult>('/auth/login', data, { skipAuth: true }),
  logout: () => api.post<null>('/auth/logout'),
  getMe: () => api.get<CurrentUserDetail>('/auth/me'),
  changePassword: (data: { old_password?: string; new_password: string }) =>
    api.post<null>('/auth/password', data),
  getWsTicket: () => api.post<{ ticket: string; expires_in: number }>('/auth/ws-ticket'),
  getNotifications: (params?: { page?: number; size?: number; unread_only?: boolean }) =>
    api.get<{ items: any[]; total: number; page: number; size: number }>('/auth/notifications', params),
  readNotifications: (notification_ids: number[]) =>
    api.post<null>('/auth/notifications/read', { notification_ids }),
  updatePreferences: (preferences: Record<string, any>) =>
    api.put<null>('/auth/preferences', preferences),
}
