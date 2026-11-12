import { api } from './client'

export interface AuditLogItem {
  id: number
  code: string
  trace_id: string
  user_id: number | null
  user_name: string
  role_name: string
  module: string
  action: string
  target_type: string | null
  target_id: string | null
  target_desc: string | null
  status: 'success' | 'warn' | 'failed'
  summary: string | null
  ip: string | null
  created_at: string
}

export interface AuditLogDetail extends AuditLogItem {
  before_data?: any
  after_data?: any
  user_agent?: string | null
  duration_ms?: number | null
}

export interface AuditLogPageResult {
  items: AuditLogItem[]
  total: number
  page: number
  size: number
  pages: number
}

export interface AuditLogStats {
  total: number
  success: number
  warn: number
  failed: number
}

export const logsApi = {
  list: (params?: {
    page?: number
    size?: number
    module?: string
    status?: string
    keyword?: string
    start_time?: string
    end_time?: string
  }) => api.get<AuditLogPageResult>('/audit-logs', params),
  getStats: () => api.get<AuditLogStats>('/audit-logs/stats'),
  get: (id: number) => api.get<AuditLogDetail>(`/audit-logs/${id}`),
  exportUrl: (params?: Record<string, any>) => {
    const q = new URLSearchParams(params).toString()
    return `/api/v1/audit-logs/export${q ? '?' + q : ''}`
  },
}
