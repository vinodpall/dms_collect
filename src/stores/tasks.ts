import { defineStore } from 'pinia'
import { useAnnotate } from './annotate'
import { ref } from 'vue'
import { MODES, OPS, SCEN, TODAY, type ModeKey, type ScenKey, type TaskStatus } from '@/constants'
import { clamp, rng } from '@/utils'
import { useSettings } from './settings'
import { cfgDef, cfgText, useDevices, type Device } from './devices'
import { useAlerts } from './alerts'
import { toast } from '@/composables/toast'

export interface TaskLog { t: string; m: string }
/** 设备自检项：每次采集前都要做 */
export interface CheckItem { id: string; dev: string; group: string; name: string; val: string; rule: string; ok: boolean }
/** 采集过程中打的事件标记（时间点 + 说明），可回退到最近一个标记 */
export interface Mark { t: number; ep: number; label: string }
export interface VerifyRule { key: string; name: string; rule: string; pass: number; warn: number; fail: number }
/** 数据校验报告：自动校验 + 人工回放抽查 → 通过 / 带警告 / 不入库 */
export interface Verify { state: 'running' | 'done'; total: number; rules: VerifyRule[]; pass: number; warn: number; fail: number; replay: number; keepWarn: boolean }
export const UPLOAD_STEPS = ['上传存储', '转码与对齐', '生成元数据与缩略图', '指纹去重', '推送标注任务池']
export interface Upload { state: 'running' | 'done'; step: number; count: number; retry: string[] }
/** 本次采集（一个会话）：从开始采集到结束本次 */
export interface Session { eps: number; marks: Mark[]; fails: number; sec: number }
/** fps / res / codec 为创建时从设备配置带出的主视频参数快照（仅用于展示）；autoRetry 为任务选项 */
export interface Params { fps: number; res: string; codec: string; audio: boolean; autoRetry: boolean }
export const DEF_PARAMS: Params = { fps: 30, res: '1080p', codec: 'H.265', audio: false, autoRetry: true }

export interface Task {
  id: string; scen: ScenKey; mode: ModeKey; name: string; op: number; /** 备注（手动输入） */ note: string; status: TaskStatus
  /** 本任务选用的设备 */ devices: string[]
  /** 目标数据集 */ datasetId: string; params: Params; /** 语言指令 */ lang: string
  /** 已入库有效数据条数 */ done: number
  /** 当前阶段：0 设备自检 / 1 场景复位与采集 / 2 数据校验 / 3 入库上传（“任务配置”在创建时完成） */ sop: number
  /** 场景复位已确认 */ reset: boolean
  check?: { at: string; items: CheckItem[] }
  session?: Session; verify?: Verify; upload?: Upload
  /** 入库失败、自动重试 3 次仍失败的文件，等待手动重传 */ retry: string[]
  updated: string; ts: number; log: TaskLog[]
}
export const STAGE_NAMES = ['任务配置', '设备自检', '场景复位与采集', '数据校验', '入库上传']

export interface Episode { file: string; dur: number; size: number; integrity: number; sync: number; score: number; verdict: 'ok' | 'warn' | 'fail' }
/** 采集历史（Episode 粒度）：采集产出 + 视频上传 + LeRobot 导入 */
export type HistSource = ModeKey | 'video' | 'lerobot'
export type HistState = 'stored' | 'warn' | 'failed' | 'retry'
export interface HistRow { file: string; source: HistSource; task: string; dataset: string; scen: ScenKey; dur: number; size: number; state: HistState; at: string }
export const HIST_SRC: Record<HistSource, string> = { vr: 'VR 遥操作', umi: 'UMI 手持', video: '视频上传', lerobot: 'LeRobot 导入' }
export const HIST_ST: Record<HistState, ['good' | 'warn' | 'crit' | 'info', string]> = { stored: ['good', '已入库'], warn: ['warn', '带警告入库'], failed: ['crit', '未入库'], retry: ['info', '待重传'] }

const KIT_DEVS: Record<string, string[]> = {
  vrA: ['DV-001', 'DV-005', 'DV-006', 'DV-012', 'DV-010', 'DV-011'],
  vrB: ['DV-002', 'DV-013'],
  umiC: ['DV-007', 'DV-008', 'DV-014'],
}
const mk = (id: string, scen: ScenKey, kit: string, name: string, op: number, note: string, status: TaskStatus, done: number, sop: number, updated: string, ts: number): Task => ({
  id, scen, mode: SCEN[scen].defMode, name, op, note, status, devices: KIT_DEVS[kit].slice(), datasetId: scen === 'qmd' ? 'DS-014' : 'DS-015',
  params: { ...DEF_PARAMS }, lang: scen === 'qmd' ? '把轮毂放上气密工装，夹紧后充气保压并判定是否合格' : '把防护堵对准轮毂安装孔并压入到位',
  done, sop, reset: sop >= 1, retry: [], updated, ts, log: [],
})

/** 从所选设备带出主视频参数（优先相机，其次 UMI 腕部相机） */
function paramsOf(ids: string[], autoRetry = true): Params {
  const dv = useDevices()
  const ds = ids.map((id) => dv.byId(id)).filter((d): d is Device => !!d)
  const v = ds.find((d) => d.type === '相机') ?? ds.find((d) => cfgDef(d.type).video)
  return { ...DEF_PARAMS, ...(v ? { fps: v.cfg.rate, res: v.cfg.res ?? DEF_PARAMS.res, codec: v.cfg.codec ?? DEF_PARAMS.codec } : {}), autoRetry }
}

export const useTasks = defineStore('tasks', () => {
  const list = ref<Task[]>([
    mk('TK-0138', 'qmd', 'vrA', '19 寸铝合金轮毂 · 第 3 批', 0, '夜班复采，注意工件表面反光', 'running', 362, 1, '16:14', 974),
    mk('TK-0137', 'fhd', 'umiC', '18 寸防护堵 · 快速节拍', 1, '', 'running', 214, 1, '16:09', 969),
    mk('TK-0136', 'qmd', 'vrB', '20 寸轮毂 · 第 2 批', 2, '', 'paused', 188, 1, '15:20', 920),
    mk('TK-0135', 'fhd', 'umiC', '19 寸防护堵 · 多操作员', 3, '', 'ready', 0, 0, '14:40', 880),
    mk('TK-0134', 'qmd', 'vrA', '18 寸轮毂 · 第 1 批', 0, '', 'ready', 96, 0, '13:05', 785),
    mk('TK-0139', 'qmd', 'vrA', '19 寸轮毂 · 第 4 批', 2, '', 'draft', 0, 0, '12:30', 750),
    mk('TK-0133', 'fhd', 'umiC', '20 寸防护堵 · 标准节拍', 1, '', 'done', 500, 0, '昨天 17:48', -372),
    mk('TK-0132', 'qmd', 'vrA', '19 寸轮毂 · 第 2 批', 0, '', 'done', 500, 0, '昨天 16:30', -450),
    mk('TK-0131', 'fhd', 'umiC', '18 寸防护堵 · 第 1 批', 3, '', 'done', 500, 0, '10-11 17:02', -1840),
    mk('TK-0130', 'qmd', 'vrA', '20 寸轮毂 · 第 1 批', 2, '', 'done', 500, 0, '10-10 16:55', -3290),
    mk('TK-0129', 'fhd', 'umiC', '19 寸防护堵 · 第 1 批', 1, '', 'done', 500, 0, '10-09 17:20', -4720),
    mk('TK-0128', 'qmd', 'vrA', '18 寸轮毂 · 试采', 0, '', 'cancel', 32, 0, '10-08 11:12', -6000),
  ])
  list.value.filter((t) => t.status === 'running' || t.status === 'paused').forEach((t, i) => { t.session = { eps: [23, 17, 9][i] ?? 5, marks: [], fails: i === 0 ? 1 : 0, sec: 0 } })
  list.value[1].retry = ['UMI_FHD_20261013_212_LM.bag']

  /** 导入与上传的数据（采集历史） */
  const imports = ref<HistRow[]>([
    { file: 'hub_inspect_demo_01.mp4', source: 'video', task: '—', dataset: 'DS-016', scen: 'qmd', dur: 24, size: 0.21, state: 'stored', at: '今天 10:12' },
    { file: 'hub_inspect_demo_02.mp4', source: 'video', task: '—', dataset: 'DS-016', scen: 'qmd', dur: 31, size: 0.27, state: 'warn', at: '今天 10:12' },
    { file: 'lerobot/plug_insert_v2 · ep_000~039', source: 'lerobot', task: '—', dataset: 'DS-009', scen: 'fhd', dur: 18, size: 3.6, state: 'stored', at: '10-11 09:30' },
  ])

  const byId = (id: string) => list.value.find((t) => t.id === id)
  const nextId = () => 'TK-' + String(Math.max(...list.value.map((t) => parseInt(t.id.slice(3), 10))) + 1).padStart(4, '0')
  /** 设备被哪个“采集中 / 已暂停”的任务占用（同一台设备同一时间只能服务一个任务） */
  function occupant(devId: string, exceptId?: string) {
    return list.value.find((t) => t.id !== exceptId && (t.status === 'running' || t.status === 'paused') && t.devices.includes(devId))?.id
  }
  function seedLog(t: Task) {
    if (t.log.length) return
    const r = rng(parseInt(t.id.slice(3), 10))
    const base: [string, string][] = []
    if (t.done > 0) {
      base.push(['16:14', '本次采集入库 ' + Math.min(t.done, 42) + ' 条，2 条带警告入库'])
      base.push(['15:52', '数据校验完成：1 条时长超出范围，未入库'])
      base.push(['14:20', '操作员 ' + OPS[t.op].n + ' 确认场景复位'])
    }
    base.push(['09:05', '任务创建，目标数据集 ' + t.datasetId])
    t.log = base.slice(0, 2 + Math.floor(r() * 2)).map((x) => ({ t: x[0], m: x[1] }))
  }
  function addLog(t: Task, m: string) { t.log.unshift({ t: '刚刚', m }) }
  function touch(t: Task) { t.updated = '刚刚'; t.ts = 1000 }
  function episodesFor(t: Task): Episode[] {
    const { nameFile, cfg } = useSettings()
    const r = rng(parseInt(t.id.slice(3), 10) * 77)
    const sc = SCEN[t.scen], op = OPS[t.op], rows: Episode[] = []
    for (let i = 0; i < Math.min(8, t.done); i++) {
      const integrity = r() < 0.14 ? +(96 + r() * 2.9).toFixed(1) : +(99 + r() * 0.99).toFixed(1)
      const sync = r() < 0.16 ? +(10.5 + r() * 5).toFixed(1) : +(3 + r() * 6.5).toFixed(1)
      const score = Math.round(clamp(100 - (100 - integrity) * 6 - Math.max(0, sync - 5) * 1.5 - r() * 3, 40, 100))
      const bad = (integrity < cfg.integrity ? 1 : 0) + (sync > cfg.sync ? 1 : 0)
      rows.push({ file: nameFile(sc.code, TODAY, t.done - i, op.c), dur: Math.round(10 + r() * 20), size: +(0.78 + r() * 0.3).toFixed(2), integrity, sync, score, verdict: bad === 0 ? 'ok' : bad === 1 && integrity >= 97 ? 'warn' : 'fail' })
    }
    return rows
  }
  /** 采集历史：各任务最近的 Episode + 待重传 + 导入数据 */
  function history(): HistRow[] {
    const out: HistRow[] = []
    list.value.filter((t) => t.done > 0).forEach((t) => {
      t.retry.forEach((f) => out.push({ file: f, source: t.mode, task: t.id, dataset: t.datasetId, scen: t.scen, dur: 18, size: 0.92, state: 'retry', at: t.updated }))
      episodesFor(t).forEach((e) => out.push({ file: e.file, source: t.mode, task: t.id, dataset: t.datasetId, scen: t.scen, dur: e.dur, size: e.size, state: e.verdict === 'ok' ? 'stored' : e.verdict === 'warn' ? 'warn' : 'failed', at: t.updated }))
    })
    return [...imports.value, ...out]
  }
  function create(w: { scen: ScenKey; mode: ModeKey; name: string; note: string; op: number; devices: string[]; datasetId: string; params: Params; lang: string }, status: TaskStatus): Task {
    const t = mk(nextId(), w.scen, 'vrA', w.name, w.op, w.note, status, 0, 0, '刚刚', 1000)
    Object.assign(t, { mode: w.mode, devices: w.devices.slice(), datasetId: w.datasetId, params: paramsOf(w.devices, w.params.autoRetry), lang: w.lang, reset: false })
    t.log = [{ t: '刚刚', m: '任务创建：' + MODES[w.mode].name + '，选用设备 ' + w.devices.length + ' 台，目标数据集 ' + w.datasetId }]
    list.value.unshift(t)
    return t
  }

  /** 设备自检：每次采集前都执行，按设备类型检查连接、电量、存储、延迟、标定与占用 */
  async function selfCheck(t: Task): Promise<CheckItem[]> {
    const dv = useDevices()
    await new Promise((r) => setTimeout(r, 1300))
    const r = rng(Date.now() % 9973)
    const items: CheckItem[] = []
    const push = (d: Device | null, group: string, name: string, val: string, rule: string, ok: boolean) =>
      items.push({ id: (d?.id ?? 'SYS') + '-' + items.length, dev: d?.id ?? 'SYS', group, name, val, rule, ok })
    const msgOf: Record<string, string> = { online: '在线', offline: '离线', maint: '维护中', fault: '故障' }
    t.devices.forEach((id) => {
      const d = dv.byId(id)
      if (!d) { push(null, id, '设备', '不存在', '—', false); return }
      const g = d.name
      push(d, g, '连接状态', msgOf[d.st], '在线', d.st === 'online')
      if (d.st !== 'online') return
      push(d, g, '标定状态', d.calib ? '已标定 · ' + d.calib.at : '未标定', '已完成一次性标定', !!d.calib)
      const occ = occupant(d.id, t.id)
      push(d, g, '设备占用', occ ? '被 ' + occ + ' 占用' : '空闲', '未被其他任务占用', !occ)
      if (d.type === 'VR 一体机' || d.type === '动捕手套' || d.type === 'UMI') { const b = Math.round(42 + r() * 55); push(d, g, '电量', b + '%', '> 30%', b > 30) }
      if (d.type === 'VR 一体机') push(d, g, '追踪状态', '6DoF 追踪正常', '无丢失', true)
      if (d.type === 'UMI') { const sd = Math.round(18 + r() * 90); push(d, g, 'SD 卡剩余', sd + ' GB', '> 10 GB', sd > 10) }
      if (d.type === '机械臂') {
        push(d, g, '急停状态', '未触发', '未触发', true)
        push(d, g, '关节报错', '无', '无报错', true)
        const lat = Math.round(6 + r() * 14); push(d, g, '通信延迟', lat + ' ms', '< 50 ms', lat < 50)
      }
      const df = cfgDef(d.type)
      if (df.video) {
        const need = d.cfg.rate, f = r() < 0.08 ? Math.round(need * 0.75) : need
        push(d, g, '实际帧率', f + ' fps', '≥ ' + Math.round(need * 0.9) + ' fps（配置 ' + need + '）', f >= need * 0.9)
        push(d, g, '分辨率 / 编码', d.cfg.res + ' · ' + d.cfg.codec, '与设备配置一致', true)
      } else if (d.type !== '其他') push(d, g, '采样率', cfgText(d.type, d.cfg), '与设备配置一致', true)
      if (d.type === '力觉') push(d, g, '零点复位', '已复位', '每次采集前复位', true)
    })
    const disk = Math.round(600 + r() * 400), ptp = +(1.5 + r() * 4).toFixed(1)
    push(null, '采集工作站', '磁盘剩余', disk + ' GB', '> 50 GB', disk > 50)
    push(null, '采集工作站', '时间同步（PTP）', ptp + ' ms', '< 10 ms', ptp < 10)
    t.check = { at: '刚刚', items }
    const bad = items.filter((x) => !x.ok)
    if (!bad.length) {
      addLog(t, '设备自检通过（' + t.devices.length + ' 台设备 · ' + items.length + ' 项）')
      if (t.sop === 0) t.sop = 1
    } else addLog(t, '设备自检发现 ' + bad.length + ' 项异常：' + bad.map((x) => x.group + ' ' + x.name).slice(0, 3).join('、'))
    touch(t)
    return items
  }

  function startSession(t: Task) {
    t.status = 'running'
    t.session = { eps: 0, marks: [], fails: 0, sec: 0 }
    addLog(t, '开始采集')
  }
  /** 采集中每完成一条 Episode */
  function tickEpisode(t: Task) { if (t.session) t.session.eps++ }

  /** 结束本次 → 自动数据校验 */
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  function endCollect(t: Task) {
    const n = Math.max(1, t.session?.eps ?? 1)
    t.sop = 2
    t.verify = { state: 'running', total: n, rules: [], pass: 0, warn: 0, fail: 0, replay: 0, keepWarn: true }
    addLog(t, '结束本次采集（' + n + ' 条），开始自动数据校验')
    clearTimeout(timers.get(t.id))
    timers.set(t.id, setTimeout(() => finishVerify(t), 3200))
    touch(t)
  }
  function finishVerify(t: Task) {
    const v = t.verify
    if (!v || v.state !== 'running') return
    const { cfg } = useSettings()
    const r = rng(parseInt(t.id.slice(3), 10) * 13 + v.total)
    const [dmin, dmax] = SCEN[t.scen].dur
    const defs: [string, string, string][] = [
      ['integrity', '文件完整性', '完整率 ≥ ' + cfg.integrity + '%'],
      ['dur', '时长范围', dmin + '–' + dmax + ' 秒（按场景配置）'],
      ['drop', '丢帧检测', '单次丢帧间隔 ≤ 100 ms'],
      ['sync', '时间同步', '多路时间戳误差 ≤ ' + cfg.sync + ' ms'],
      t.mode === 'vr' ? ['track', 'VR 追踪漂移', '漂移 ≤ 5 cm/s，追踪丢失 ≤ 0.5 s'] : ['pose', 'UMI 位姿跳变', '加速度 ≤ 10 m/s²'],
      ['range', '传感器数值范围', '关节角 / 力觉 / 夹爪开度在量程内'],
    ]
    let warn = 0, fail = 0
    v.rules = defs.map(([key, name, rule]) => {
      const f = r() < 0.35 ? Math.min(v.total, Math.round(r() * 1.6)) : 0
      const w = r() < 0.45 ? Math.min(v.total - f, Math.round(r() * 2.2)) : 0
      warn += w; fail += f
      return { key, name, rule, pass: v.total - f - w, warn: w, fail: f }
    })
    v.fail = Math.min(v.total, fail); v.warn = Math.min(v.total - v.fail, warn); v.pass = v.total - v.fail - v.warn
    v.state = 'done'
    addLog(t, '自动校验完成：通过 ' + v.pass + ' 条，警告 ' + v.warn + ' 条，不通过 ' + v.fail + ' 条')
    useAlerts().add({ level: 'info', title: '任务 ' + t.id + ' 数据校验完成', desc: '请回放抽查后确认入库', time: '刚刚', route: 'tasks' })
    toast('任务 ' + t.id + ' 自动校验完成，请确认校验结果')
    touch(t)
  }
  /** 确认校验结论 → 入库上传（不通过的不入库；警告的按选择带警告入库） */
  function confirmVerify(t: Task) {
    const v = t.verify
    if (!v || v.state !== 'done') return
    const count = v.pass + (v.keepWarn ? v.warn : 0)
    t.sop = 3
    t.upload = { state: 'running', step: 0, count, retry: [] }
    addLog(t, '确认校验结论：' + count + ' 条入库' + (v.keepWarn && v.warn ? '（含 ' + v.warn + ' 条带警告）' : '') + '，' + (v.total - count) + ' 条不入库')
    runUpload(t)
    touch(t)
  }
  function runUpload(t: Task) {
    const u = t.upload
    if (!u || u.state !== 'running') return
    setTimeout(() => {
      if (!t.upload || t.upload !== u) return
      if (u.step === 0 && u.count > 3 && Math.random() < 0.7) {
        const { nameFile } = useSettings()
        u.retry = [nameFile(SCEN[t.scen].code, TODAY, t.done + u.count, OPS[t.op].c)]
        addLog(t, '1 个文件上传中断，自动重试 3 次仍失败，已加入待重传队列')
      }
      u.step++
      if (u.step < UPLOAD_STEPS.length) { runUpload(t); return }
      u.state = 'done'
      const ok = u.count - u.retry.length
      t.done += ok
      t.retry.push(...u.retry)
      useAnnotate().ingest(t.scen, t.scen === 'qmd' ? 'B-1013-03' : 'B-1012-04', Math.min(ok, 5))
      addLog(t, '入库完成：' + ok + ' 条已入库并推送标注任务池' + (u.retry.length ? '，' + u.retry.length + ' 条待重传' : ''))
      toast('本次采集已入库 ' + ok + ' 条' + (u.retry.length ? '，' + u.retry.length + ' 条待重传' : ''))
      touch(t)
    }, 750)
  }
  /** 本次采集流程结束，回到“设备自检”，准备下一次 */
  function closeRun(t: Task) {
    if (t.status === 'running') t.status = 'ready'
    t.sop = 0; t.reset = false; t.check = undefined; t.session = undefined; t.verify = undefined; t.upload = undefined
    touch(t)
  }
  function retryUpload(t: Task, file: string) {
    t.retry = t.retry.filter((f) => f !== file)
    t.done++
    addLog(t, '手动重传成功：' + file)
    touch(t)
  }
  function importData(x: { kind: 'video' | 'lerobot'; dataset: string; scen: ScenKey; files: string[] }) {
    const r = rng(Date.now() % 7919)
    const rows: HistRow[] = x.files.map((f) => ({ file: f, source: x.kind, task: '—', dataset: x.dataset, scen: x.scen, dur: Math.round(12 + r() * 20), size: +(x.kind === 'lerobot' ? 1 + r() * 3 : 0.1 + r() * 0.3).toFixed(2), state: r() < 0.15 ? 'warn' : 'stored', at: '刚刚' }))
    imports.value.unshift(...rows)
    useAnnotate().ingest(x.scen, x.scen === 'qmd' ? 'B-1013-03' : 'B-1012-04', Math.min(rows.length, 5))
    return rows
  }
  return { list, imports, byId, nextId, occupant, seedLog, addLog, touch, episodesFor, history, create, selfCheck, startSession, tickEpisode, endCollect, finishVerify, confirmVerify, closeRun, retryUpload, importData }
})
