import { defineStore } from 'pinia'
import { ref } from 'vue'
import { logsApi, getToken, type AuditLogItem, type AuditLogDetail, type AuditLogStats } from '@/api'

export type LogModule =
  | 'auth'
  | 'users'
  | 'roles'
  | 'devices'
  | 'stations'
  | 'dict'
  | 'scenes'
  | 'system'
  | 'collect'
  | 'annotate'
  | 'review'
  | 'pipeline'
  | 'vocab'

export interface LogEntry {
  id: string
  numericId: number
  traceId: string
  time: string
  timestamp: number
  user: string
  role: string
  module: string
  moduleName: string
  action: string
  target: string
  status: 'success' | 'warn' | 'failed'
  ip: string
  ua: string
  duration: number | null
  summary: string
  before?: any
  after?: any
}

export const MODULE_NAMES: Record<string, string> = {
  auth: '认证中心',
  users: '用户管理',
  roles: '角色权限',
  devices: '设备管理',
  stations: '工位配置',
  dict: '标注字典',
  scenes: '采集场景',
  system: '系统管理',
  collect: '采集任务',
  annotate: '标注工作台',
  review: '审核工作台',
  pipeline: '处理流水线',
  vocab: '字典管理',
}

export const useLogs = defineStore('logs', () => {
  const list = ref<LogEntry[]>([])
  const total = ref(0)
  const stats = ref<AuditLogStats | null>(null)
  const loading = ref(false)

  function mapLog(item: AuditLogItem | AuditLogDetail): LogEntry {
    const detail = item as AuditLogDetail
    const timeStr = item.created_at ? item.created_at.replace('T', ' ').slice(0, 19) : '—'
    return {
      id: item.code || `LOG-${item.id}`,
      numericId: item.id,
      traceId: item.trace_id || '',
      time: timeStr,
      timestamp: item.created_at ? new Date(item.created_at).getTime() : 0,
      user: item.user_name || '—',
      role: item.role_name || '',
      module: item.module,
      moduleName: MODULE_NAMES[item.module] || item.module,
      action: item.action,
      target: item.target_desc || item.target_type || item.target_id || '—',
      status: item.status,
      ip: item.ip || '—',
      ua: detail.user_agent || '',
      duration: detail.duration_ms ?? null,
      summary: item.summary || item.action,
      before: detail.before_data,
      after: detail.after_data,
    }
  }

  async function fetchLogs(params?: {
    page?: number
    size?: number
    module?: string
    status?: string
    keyword?: string
    start_time?: string
    end_time?: string
  }) {
    if (!getToken()) return { items: [], total: 0, page: 1, size: 10, pages: 0 }
    loading.value = true
    try {
      const res = await logsApi.list({ page: 1, size: 10, ...params })
      const items: AuditLogItem[] = res?.items || []
      list.value = items.map(mapLog)
      total.value = res?.total ?? items.length
      return res
    } finally {
      loading.value = false
    }
  }

  async function fetchDetail(id: number): Promise<LogEntry> {
    const detail = await logsApi.get(id)
    const entry = mapLog(detail)
    const idx = list.value.findIndex((x) => x.numericId === id)
    if (idx >= 0) list.value[idx] = entry
    return entry
  }

  async function fetchStats(): Promise<AuditLogStats | null> {
    if (!getToken()) return null
    const res = await logsApi.getStats()
    stats.value = res
    return res
  }

  /**
   * 保留空操作接口以兼容尚未对接后端的页面（AnnotateView / ReviewView / annotate.ts），
   * 不再向真实操作审计日志列表注入本地伪造数据
   */
  function addLog(_params: {
    user: string
    role: string
    module: LogModule
    moduleName: string
    action: string
    target: string
    summary: string
    status?: 'success' | 'warn' | 'failed'
    duration?: number
    before?: unknown
    after?: unknown
  }): LogEntry | null {
    return null
  }

  function clear() {
    list.value = []
    total.value = 0
    stats.value = null
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('dms:logout', clear)
  }

  return { list, total, stats, loading, addLog, clear, fetchLogs, fetchDetail, fetchStats }
})
