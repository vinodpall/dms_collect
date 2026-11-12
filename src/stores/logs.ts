import { defineStore } from 'pinia'
import { ref } from 'vue'
import { logsApi, getToken, type AuditLogItem } from '@/api'

export type LogModule = 'collect' | 'annotate' | 'review' | 'vocab' | 'system' | 'pipeline'

export interface LogEntry {
  id: string
  numericId?: number
  traceId: string
  time: string
  timestamp: number
  user: string
  role: string
  module: LogModule
  moduleName: string
  action: string
  target: string
  status: 'success' | 'warn' | 'failed'
  ip: string
  ua: string
  duration: number
  summary: string
  before?: Record<string, unknown> | string
  after?: Record<string, unknown> | string
}

const MODULE_NAMES: Record<string, string> = {
  auth: '认证中心',
  users: '用户管理',
  roles: '角色权限',
  devices: '设备管理',
  stations: '工位管理',
  dict: '标注字典',
  scenes: '场景管理',
  system: '系统设置',
  collect: '采集任务',
  annotate: '标注工作台',
  review: '审核工作台',
  pipeline: '处理流水线',
  vocab: '字典管理',
}

export const useLogs = defineStore('logs', () => {
  const list = ref<LogEntry[]>([])
  const loading = ref(false)
  let logUid = 1083

  function mapModule(m: string): LogModule {
    if (m === 'auth' || m === 'users' || m === 'roles' || m === 'system' || m === 'devices' || m === 'stations') {
      return 'system'
    }
    if (m === 'dict' || m === 'scenes' || m === 'vocab') return 'vocab'
    if (m === 'annotate') return 'annotate'
    if (m === 'review') return 'review'
    if (m === 'pipeline') return 'pipeline'
    return 'collect'
  }

  async function fetchLogs() {
    if (!getToken()) return
    loading.value = true
    try {
      const res = await logsApi.list({ size: 100 })
      const items: AuditLogItem[] = (res as any).items || []

      list.value = items.map((item) => {
        const timeStr = item.created_at ? item.created_at.replace('T', ' ').slice(0, 19) : ''
        const modKey = mapModule(item.module)
        return {
          id: item.code || `LOG-${item.id}`,
          numericId: item.id,
          traceId: item.trace_id,
          time: timeStr,
          timestamp: item.created_at ? new Date(item.created_at).getTime() : Date.now(),
          user: item.user_name || '系统',
          role: item.role_name || '管理员',
          module: modKey,
          moduleName: MODULE_NAMES[item.module] || item.module,
          action: item.action,
          target: item.target_desc || item.target_type || '—',
          status: item.status,
          ip: item.ip || '127.0.0.1',
          ua: 'Chrome 128.0 (Windows 11 x64)',
          duration: 35,
          summary: item.summary || `${item.action}操作`,
        }
      })
    } catch (e) {
      console.warn('[logs] 从后端加载审计日志失败', e)
    } finally {
      loading.value = false
    }
  }

  function addLog(params: {
    user: string
    role: string
    module: LogModule
    moduleName: string
    action: string
    target: string
    summary: string
    status?: 'success' | 'warn' | 'failed'
    duration?: number
    before?: Record<string, unknown> | string
    after?: Record<string, unknown> | string
  }): LogEntry {
    const now = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const timeStr = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
    const id = 'LOG-' + logUid++
    const traceId = 'tr_' + Math.random().toString(36).substring(2, 10)

    const entry: LogEntry = {
      id,
      traceId,
      time: timeStr,
      timestamp: Date.now(),
      user: params.user,
      role: params.role,
      module: params.module,
      moduleName: params.moduleName,
      action: params.action,
      target: params.target,
      status: params.status ?? 'success',
      ip: '192.168.10.45',
      ua: 'Chrome 128.0 (Windows 11 x64)',
      duration: params.duration ?? Math.floor(Math.random() * 40 + 15),
      summary: params.summary,
      before: params.before,
      after: params.after,
    }

    list.value.unshift(entry)
    return entry
  }

  function clear() {
    list.value = []
  }

  if (getToken()) {
    fetchLogs()
  }

  return { list, loading, addLog, clear, fetchLogs }
})
