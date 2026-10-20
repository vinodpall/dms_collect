export const TODAY = '20261013'

export type RoleKey = 'admin' | 'op' | 'ann' | 'rev' | 'mt'
export type PageKey = 'dashboard' | 'tasks' | 'monitor' | 'pipeline' | 'annotate' | 'review' | 'datasets' | 'storage' | 'devices' | 'logs' | 'system'

export const ROLES: Record<RoleKey, { name: string; user: string; init: string; all?: boolean; pages: PageKey[]; can: Record<string, 1> }> = {
  admin: { name: '系统管理员', user: '周工', init: '周', all: true, pages: ['dashboard', 'tasks', 'monitor', 'pipeline', 'annotate', 'review', 'datasets', 'storage', 'devices', 'logs', 'system'], can: {} },
  op: { name: '采集操作员', user: '张杰', init: '张', pages: ['dashboard', 'tasks', 'monitor'], can: { tasks: 1, monitor: 1 } },
  ann: { name: '标注员', user: '林悦', init: '林', pages: ['dashboard', 'pipeline', 'annotate', 'datasets', 'logs'], can: { annotate: 1, pipeline: 1 } },
  rev: { name: '审核员', user: '陈静', init: '陈', pages: ['dashboard', 'pipeline', 'annotate', 'review', 'datasets', 'logs'], can: { review: 1, pipeline: 1, datasets: 1 } },
  mt: { name: '维护工程师', user: '赵工', init: '赵', pages: ['dashboard', 'monitor', 'devices', 'logs', 'system'], can: { monitor: 1, devices: 1 } },
}
export const NO_PERM = '当前角色没有此操作权限'

export const NAV_GROUPS: { g: string; items: PageKey[] }[] = [
  { g: '概览', items: ['dashboard'] },
  { g: '采集', items: ['tasks', 'monitor'] },
  { g: '数据治理', items: ['pipeline', 'annotate', 'review', 'datasets'] },
  { g: '资源与系统', items: ['storage', 'devices', 'logs', 'system'] },
]
export const PAGE_META: Record<PageKey, { title: string; icon: string }> = {
  dashboard: { title: '数据看板', icon: 'grid' },
  tasks: { title: '采集任务', icon: 'task' },
  monitor: { title: '实时监控', icon: 'activity' },
  pipeline: { title: '处理流水线', icon: 'flow' },
  annotate: { title: '标注工作台', icon: 'tag' },
  review: { title: '审核工作台', icon: 'check' },
  datasets: { title: '数据集管理', icon: 'db' },
  storage: { title: '存储管理', icon: 'drive' },
  devices: { title: '设备管理', icon: 'cpu' },
  logs: { title: '操作审计日志', icon: 'file' },
  system: { title: '系统管理', icon: 'settings' },
}

export const OPS = [{ n: '张杰', c: 'ZJ' }, { n: '李明', c: 'LM' }, { n: '王芳', c: 'WF' }, { n: '陈浩', c: 'CH' }]
export type ScenKey = 'qmd' | 'fhd'
export const SCEN: Record<ScenKey, { name: string; short: string; code: string; mode: string }> = {
  qmd: { name: '轮毂气密性检测', short: '气密性检测', code: 'VR_QMD', mode: 'VR 遥操作' },
  fhd: { name: '防护堵安装', short: '防护堵安装', code: 'UMI_FHD', mode: 'UMI 手持' },
}
export type BadgeKind = '' | 'good' | 'warn' | 'crit' | 'info'
export type TaskStatus = 'draft' | 'ready' | 'running' | 'paused' | 'done' | 'cancel'
export const TASK_ST: Record<TaskStatus, [BadgeKind, string]> = {
  draft: ['', '草稿'], ready: ['', '待开始'], running: ['info', '采集中'], paused: ['warn', '已暂停'], done: ['good', '已完成'], cancel: ['', '已取消'],
}
/** 处理流水线阶段：暂不使用 AI，采用“自动化 + 手动处理”。manual 的阶段需要人工参与 */
export const STAGES = ['原始数据', '数据标准化', '手动标注', '标注校验', '格式转换', '入库发布']
export const STAGE_MANUAL = [2, 3]
export const STAGE_HINT = ['采集归档后的 bag 原始包', '自动：bag 转换为 lsdataset 标准格式', '人工：标注员标注到子任务级', '人工：审核员审核，可打回', '自动：转换为训练所需格式', '自动：入库并生成数据集版本']

export const DEMO_ACCOUNTS: { u: string; role: RoleKey }[] = [
  { u: 'admin', role: 'admin' }, { u: 'zhangjie', role: 'op' }, { u: 'linyue', role: 'ann' }, { u: 'chenjing', role: 'rev' }, { u: 'zhaogong', role: 'mt' },
]
export const DEMO_PASSWORD = '123456'
