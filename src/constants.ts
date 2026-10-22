export const TODAY = '20261013'

/** 角色标识：内置 admin / op / ann / rev / mt，可在「角色权限」页新增自定义角色 */
export type RoleKey = string
export type PageKey = 'dashboard' | 'tasks' | 'monitor' | 'pipeline' | 'annotate' | 'review' | 'dict' | 'datasets' | 'storage' | 'devices' | 'logs' | 'system' | 'users' | 'roles'

export interface RoleDef { name: string; user: string; init: string; all?: boolean; pages: PageKey[]; can: Record<string, 1> }
/** 内置角色的初始权限（角色权限页可调整，持久化在浏览器本地） */
export const ROLES: Record<RoleKey, RoleDef> = {
  admin: { name: '系统管理员', user: '周工', init: '周', all: true, pages: ['dashboard', 'tasks', 'monitor', 'pipeline', 'annotate', 'review', 'dict', 'datasets', 'storage', 'devices', 'logs', 'system', 'users', 'roles'], can: {} },
  op: { name: '采集操作员', user: '张杰', init: '张', pages: ['dashboard', 'tasks', 'monitor'], can: { tasks: 1, monitor: 1 } },
  ann: { name: '标注员', user: '林悦', init: '林', pages: ['dashboard', 'pipeline', 'annotate', 'datasets', 'logs'], can: { annotate: 1, pipeline: 1, datasets: 1 } },
  rev: { name: '审核员', user: '陈静', init: '陈', pages: ['dashboard', 'pipeline', 'annotate', 'review', 'datasets', 'logs'], can: { review: 1, pipeline: 1, datasets: 1 } },
  mt: { name: '维护工程师', user: '赵工', init: '赵', pages: ['dashboard', 'monitor', 'devices', 'logs', 'system'], can: { monitor: 1, devices: 1 } },
}
export const NO_PERM = '当前角色没有此操作权限'

export const NAV_GROUPS: { g: string; items: PageKey[] }[] = [
  { g: '概览', items: ['dashboard'] },
  { g: '采集', items: ['tasks', 'monitor'] },
  { g: '数据治理', items: ['pipeline', 'annotate', 'review', 'dict', 'datasets'] },
  { g: '资源与系统', items: ['storage', 'devices', 'logs', 'system'] },
  { g: '用户与权限', items: ['users', 'roles'] },
]
export const PAGE_META: Record<PageKey, { title: string; icon: string }> = {
  dashboard: { title: '数据看板', icon: 'grid' },
  tasks: { title: '采集任务', icon: 'task' },
  monitor: { title: '实时监控', icon: 'activity' },
  pipeline: { title: '处理流水线', icon: 'flow' },
  annotate: { title: '标注工作台', icon: 'tag' },
  review: { title: '审核工作台', icon: 'check' },
  dict: { title: '标注字典', icon: 'layers' },
  datasets: { title: '数据集管理', icon: 'db' },
  storage: { title: '存储管理', icon: 'drive' },
  devices: { title: '设备管理', icon: 'cpu' },
  logs: { title: '操作审计日志', icon: 'file' },
  system: { title: '系统管理', icon: 'settings' },
  users: { title: '用户管理', icon: 'users' },
  roles: { title: '角色权限', icon: 'shield' },
}

export const OPS = [{ n: '张杰', c: 'ZJ' }, { n: '李明', c: 'LM' }, { n: '王芳', c: 'WF' }, { n: '陈浩', c: 'CH' }]
export type ScenKey = 'qmd' | 'fhd'
/** 采集模式：与场景解耦，场景只给出推荐模式 */
export type ModeKey = 'vr' | 'umi'
export const MODES: Record<ModeKey, { name: string; short: string; desc: string }> = {
  vr: { name: 'VR 遥操作', short: 'VR', desc: 'VR 头显 + 动捕手套遥操作机械臂，适合需要真机执行与多模态对齐的工序' },
  umi: { name: 'UMI 手持', short: 'UMI', desc: '手持 UMI 夹爪直接示教，不需要机械臂，适合快速节拍的工序' },
}
export const SCEN: Record<ScenKey, { name: string; short: string; code: string; mode: string; defMode: ModeKey; dur: [number, number]; reset: string }> = {
  qmd: { name: '轮毂气密性检测', short: '气密性检测', code: 'VR_QMD', mode: 'VR 遥操作', defMode: 'vr', dur: [10, 40], reset: '轮毂工件摆放到位、气密工装复位、压力表归零' },
  fhd: { name: '防护堵安装', short: '防护堵安装', code: 'UMI_FHD', mode: 'UMI 手持', defMode: 'umi', dur: [6, 30], reset: '防护堵料盒补满、轮毂回到安装工位' },
}
/** 采集模式需要的设备槽位：设备按类型匹配，不再按场景归属 */
export interface DevSlot { key: string; label: string; types: string[]; min: number; max: number; hint: string }
export const MODE_SLOTS: Record<ModeKey, DevSlot[]> = {
  vr: [
    { key: 'vr', label: 'VR 头显', types: ['VR 一体机'], min: 1, max: 1, hint: '操作员佩戴，采集头部位姿与第一视角' },
    { key: 'glove', label: '动捕手套', types: ['动捕手套'], min: 0, max: 2, hint: '可选，左右各一，采集手部关节' },
    { key: 'arm', label: '机械臂', types: ['机械臂'], min: 1, max: 2, hint: '被遥操作的执行端；双臂需选同一工位的两台' },
    { key: 'cam', label: '相机', types: ['相机'], min: 1, max: 6, hint: '至少 1 路外部视角' },
    { key: 'ft', label: '力觉传感器', types: ['力觉'], min: 0, max: 2, hint: '可选，腕部六维力' },
  ],
  umi: [
    { key: 'umi', label: 'UMI 手持夹爪', types: ['UMI'], min: 1, max: 2, hint: '单手 1 台，双手 2 台；UMI 自带腕部相机' },
    { key: 'cam', label: '外部相机', types: ['相机'], min: 0, max: 4, hint: '可选，补充第三视角' },
    { key: 'ft', label: '力觉传感器', types: ['力觉'], min: 0, max: 2, hint: '可选' },
  ],
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

/** 操作权限点：页面访问由角色的 pages 控制，页面内的写操作由下列权限点控制 */
export const ACTIONS: { key: string; label: string; page: PageKey }[] = [
  { key: 'tasks', label: '创建 / 执行采集任务', page: 'tasks' },
  { key: 'monitor', label: '处置监控告警', page: 'monitor' },
  { key: 'pipeline', label: '重试 / 处理流水线批次', page: 'pipeline' },
  { key: 'annotate', label: '手动标注', page: 'annotate' },
  { key: 'datasets', label: '发布数据集', page: 'datasets' },
  { key: 'storage', label: '修改存储策略', page: 'storage' },
  { key: 'devices', label: '设备台账维护', page: 'devices' },
  { key: 'system', label: '修改系统设置', page: 'system' },
  { key: 'users', label: '管理用户（新增 / 停用 / 重置密码）', page: 'users' },
  { key: 'roles', label: '管理角色与权限', page: 'roles' },
]

/** 演示账号：初始密码统一为 DEMO_PASSWORD，可在「用户管理」中新增账号或重置密码 */
export const DEMO_PASSWORD = '123456'
