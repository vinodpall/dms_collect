import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type LogModule = 'collect' | 'annotate' | 'review' | 'vocab' | 'system' | 'pipeline'

export interface LogEntry {
  id: string
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

const INITIAL_LOGS: LogEntry[] = [
  {
    id: 'LOG-1082',
    traceId: 'tr_c819a701',
    time: '2026-10-13 16:45:12',
    timestamp: Date.now() - 1000 * 60 * 5,
    user: '陈静',
    role: '审核员',
    module: 'review',
    moduleName: '审核工作台',
    action: '打回重标',
    target: '批次 B-1013-03 · 片段 C201',
    status: 'warn',
    ip: '192.168.10.45',
    ua: 'Chrome 128.0 (Windows 11 x64)',
    duration: 64,
    summary: '审核打回：切片“夹紧密封”结束时间偏早，需覆盖至开始充气前',
    before: { status: 'submitted', flagCount: 0 },
    after: { status: 'rejected', reason: '“夹紧密封”结束时间偏早，应覆盖到开始充气前', flaggedSegId: 2 },
  },
  {
    id: 'LOG-1081',
    traceId: 'tr_e720b642',
    time: '2026-10-13 16:42:08',
    timestamp: Date.now() - 1000 * 60 * 8,
    user: '陈静',
    role: '审核员',
    module: 'vocab',
    moduleName: '字典管理',
    action: '新增词条',
    target: '动作字典 · 对准孔位 (ALIGN_HOLE)',
    status: 'success',
    ip: '192.168.10.45',
    ua: 'Chrome 128.0 (Windows 11 x64)',
    duration: 38,
    summary: '新增标准语义动作词条：对准孔位，所属场景：UMI_FHD',
    before: '无',
    after: { code: 'ALIGN_HOLE', name: '对准孔位', scen: 'fhd', category: '操作动作', status: '启用' },
  },
  {
    id: 'LOG-1080',
    traceId: 'tr_f315a992',
    time: '2026-10-13 16:38:50',
    timestamp: Date.now() - 1000 * 60 * 12,
    user: '林悦',
    role: '标注员',
    module: 'annotate',
    moduleName: '标注工作台',
    action: '提交审核',
    target: '批次 B-1013-03 · 片段 C203',
    status: 'success',
    ip: '192.168.10.36',
    ua: 'Chrome 128.0 (Windows 11 x64)',
    duration: 45,
    summary: '完成 5 段子任务标注并通过质量自检（覆盖率 94%），已提交审核',
    before: { status: 'todo', segCount: 5, coverage: 94 },
    after: { status: 'submitted', submittedAt: '2026-10-13 16:38:50' },
  },
  {
    id: 'LOG-1079',
    traceId: 'tr_b481d330',
    time: '2026-10-13 16:35:19',
    timestamp: Date.now() - 1000 * 60 * 15,
    user: '林悦',
    role: '标注员',
    module: 'annotate',
    moduleName: '标注工作台',
    action: '切分切片',
    target: '片段 C203 · 时间戳 8.4s',
    status: 'success',
    ip: '192.168.10.36',
    ua: 'Chrome 128.0 (Windows 11 x64)',
    duration: 12,
    summary: '在播放头 8.4s 处切分生成新切片：“充气保压”',
    before: { seg: { s: 3.2, e: 14.1, n: '夹紧密封' } },
    after: { seg1: { s: 3.2, e: 8.4, n: '夹紧密封' }, seg2: { s: 8.4, e: 14.1, n: '充气保压' } },
  },
  {
    id: 'LOG-1078',
    traceId: 'tr_77ab92c1',
    time: '2026-10-13 16:20:00',
    timestamp: Date.now() - 1000 * 60 * 30,
    user: '陈静',
    role: '审核员',
    module: 'review',
    moduleName: '审核工作台',
    action: '审核通过',
    target: '批次 B-1012-04 · 片段 C207',
    status: 'success',
    ip: '192.168.10.45',
    ua: 'Chrome 128.0 (Windows 11 x64)',
    duration: 52,
    summary: '完成 6 维度质检评分（综合分 96 分），审核判定通过，数据流转至格式转换',
    before: { status: 'submitted' },
    after: { status: 'approved', score: 96, dimensions: { time: 5, action: 5, obj: 5, semantic: 4, outcome: 5, consistency: 5 } },
  },
  {
    id: 'LOG-1077',
    traceId: 'tr_11fa68c2',
    time: '2026-10-13 15:58:33',
    timestamp: Date.now() - 1000 * 60 * 52,
    user: '周工',
    role: '系统管理员',
    module: 'system',
    moduleName: '系统设置',
    action: '配置变更',
    target: '存储管理 · 冷热数据迁移策略',
    status: 'success',
    ip: '192.168.10.10',
    ua: 'Firefox 130.0 (Windows 11 x64)',
    duration: 80,
    summary: '修改冷数据归档触发阈值从 45 天变更为 30 天',
    before: { coldDays: 45 },
    after: { coldDays: 30 },
  },
  {
    id: 'LOG-1076',
    traceId: 'tr_98bc01d5',
    time: '2026-10-13 15:30:14',
    timestamp: Date.now() - 1000 * 60 * 80,
    user: '张杰',
    role: '采集操作员',
    module: 'collect',
    moduleName: '采集任务',
    action: '完成采集',
    target: '任务 TK-0138 · 批次 B-1013-03',
    status: 'success',
    ip: '192.168.10.22',
    ua: 'Chrome 128.0 (Windows 11 x64)',
    duration: 110,
    summary: '完成 5 组轮毂气密性检测数据录制与包完整性校验，触发标准化入库流水线',
    before: { taskStatus: 'running', recorded: 4 },
    after: { taskStatus: 'done', recorded: 5, bagSize: '4.6GB' },
  },
  {
    id: 'LOG-1075',
    traceId: 'tr_34dc881e',
    time: '2026-10-13 14:58:10',
    timestamp: Date.now() - 1000 * 60 * 110,
    user: '系统调度器',
    role: '后台进程',
    module: 'pipeline',
    moduleName: '数据流水线',
    action: '标准化失败',
    target: '批次 B-1013-04 · bag 标准化转 lsdataset',
    status: 'failed',
    ip: '127.0.0.1',
    ua: 'DMS Pipeline Daemon v2.1',
    duration: 320,
    summary: '标准化进程异常中断：相机第一视角话题时间戳存在断层跳跃（Δt > 80ms），需人工干预重试',
    before: { stage: 1, state: 'running' },
    after: { stage: 1, state: 'failed', error: 'Timestamp discontinuous in /cam_wrist/color/image_raw' },
  },
  {
    id: 'LOG-1074',
    traceId: 'tr_42ad556f',
    time: '2026-10-13 14:10:22',
    timestamp: Date.now() - 1000 * 60 * 160,
    user: '陈静',
    role: '审核员',
    module: 'vocab',
    moduleName: '字典管理',
    action: '修改词条',
    target: '物体字典 · 气密夹具 (FIXTURE_QMD)',
    status: 'success',
    ip: '192.168.10.45',
    ua: 'Chrome 128.0 (Windows 11 x64)',
    duration: 35,
    summary: '更新物体别名列表：新增“快速气动夹爪”、“锁紧气缸”',
    before: { aliases: ['气密治具'] },
    after: { aliases: ['气密治具', '快速气动夹爪', '锁紧气缸'] },
  },
  {
    id: 'LOG-1073',
    traceId: 'tr_55ee771a',
    time: '2026-10-13 13:40:05',
    timestamp: Date.now() - 1000 * 60 * 190,
    user: '林悦',
    role: '标注员',
    module: 'annotate',
    moduleName: '标注工作台',
    action: '保存草稿',
    target: '片段 C202 · 轮毂气密性检测',
    status: 'success',
    ip: '192.168.10.36',
    ua: 'Chrome 128.0 (Windows 11 x64)',
    duration: 18,
    summary: '自动保存切片草稿（共 2 个切片）',
    before: '草稿已过期',
    after: '草稿已保存',
  },
]

let logUid = 1083

export const useLogs = defineStore('logs', () => {
  const list = ref<LogEntry[]>([...INITIAL_LOGS])

  function addLog(params: {
    user: string
    role: string
    module: LogModule
    moduleName: string
    action: string
    target: string
    status?: 'success' | 'warn' | 'failed'
    summary: string
    before?: Record<string, unknown> | string
    after?: Record<string, unknown> | string
    duration?: number
  }) {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
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
      ip: '192.168.10.' + (Math.floor(Math.random() * 40) + 20),
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

  return { list, addLog, clear }
})
