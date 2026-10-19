import { defineStore } from 'pinia'
import { ref } from 'vue'
import { OPS, SCEN, TODAY, type ScenKey, type TaskStatus } from '@/constants'
import { clamp, rng } from '@/utils'
import { useSettings } from './settings'
import { useDevices } from './devices'
import { useAlerts } from './alerts'
import { toast } from '@/composables/toast'

export interface TaskLog { t: string; m: string }
export interface CheckItem { id: string; name: string; ok: boolean; msg: string }
export interface Task {
  id: string; scen: ScenKey; name: string; op: number; /** 备注（手动输入） */ note: string; status: TaskStatus
  /** 本任务选用的设备 */ devices: string[]
  /** 已采集有效数据条数 */ done: number; /** 当前 SOP 已完成步数 0-6（第 2 步“空间标定”默认完成） */ sop: number
  /** 设备自检结果 */ check?: { at: string; items: CheckItem[] }
  /** 后台自动数据质检：idle 未开始 / running 质检中 / done 已完成 */ qc: 'idle' | 'running' | 'done'
  updated: string; ts: number; log: TaskLog[]
}
const SCEN_DEVS: Record<ScenKey, string[]> = { qmd: ['DV-001', 'DV-005', 'DV-006', 'DV-010', 'DV-011', 'DV-012'], fhd: ['DV-007', 'DV-008', 'DV-009'] }
export interface Episode { file: string; dur: number; size: number; integrity: number; sync: number; score: number }

const mk = (id: string, scen: ScenKey, name: string, op: number, note: string, status: TaskStatus, done: number, sop: number, updated: string, ts: number): Task =>
  ({ id, scen, name, op, note, status, devices: SCEN_DEVS[scen].slice(), done, sop, qc: 'idle', updated, ts, log: [] })

export function sopSteps(scen: ScenKey): [string, string][] {
  const q = scen === 'qmd'
  return [
    ['设备巡检', '点击“自检设备”，自动检查本任务选用的全部设备'],
    ['空间标定', '默认已完成（沿用上次标定结果）'],
    ['场景复位', q ? '轮毂工件摆放到位、工装就位' : '防护堵与工件摆放到位'],
    ['开始采集', q ? '操作员佩戴 VR / 手套，按标准动作执行气密性检测' : '操作员手持 UMI 执行防护堵安装动作'],
    ['数据质检', '采集结束后自动下发后台质检，完成后通知；也可手动标记完成'],
    ['归档上传', '命名规范 → 上传存储 → 填写采集日志'],
  ]
}

export const useTasks = defineStore('tasks', () => {
  const list = ref<Task[]>([
    mk('TK-0138', 'qmd', '19 寸铝合金轮毂 · 第 3 批', 0, '夜班复采，注意工件表面反光', 'running', 362, 3, '16:14', 974),
    mk('TK-0137', 'fhd', '18 寸防护堵 · 快速节拍', 1, '', 'running', 214, 3, '16:09', 969),
    mk('TK-0136', 'qmd', '20 寸轮毂 · 第 2 批', 2, '', 'paused', 188, 3, '15:20', 920),
    mk('TK-0135', 'fhd', '19 寸防护堵 · 多操作员', 3, '', 'ready', 0, 2, '14:40', 880),
    mk('TK-0134', 'qmd', '18 寸轮毂 · 第 1 批', 0, '', 'ready', 96, 0, '13:05', 785),
    mk('TK-0139', 'qmd', '19 寸轮毂 · 第 4 批', 2, '', 'draft', 0, 0, '12:30', 750),
    mk('TK-0133', 'fhd', '20 寸防护堵 · 标准节拍', 1, '', 'done', 500, 0, '昨天 17:48', -372),
    mk('TK-0132', 'qmd', '19 寸轮毂 · 第 2 批', 0, '', 'done', 500, 0, '昨天 16:30', -450),
    mk('TK-0131', 'fhd', '18 寸防护堵 · 第 1 批', 3, '', 'done', 500, 0, '10-11 17:02', -1840),
    mk('TK-0130', 'qmd', '20 寸轮毂 · 第 1 批', 2, '', 'done', 500, 0, '10-10 16:55', -3290),
    mk('TK-0129', 'fhd', '19 寸防护堵 · 第 1 批', 1, '', 'done', 500, 0, '10-09 17:20', -4720),
    mk('TK-0128', 'qmd', '18 寸轮毂 · 试采', 0, '', 'cancel', 32, 0, '10-08 11:12', -6000),
  ])
  const byId = (id: string) => list.value.find((t) => t.id === id)
  const nextId = () => 'TK-' + String(Math.max(...list.value.map((t) => parseInt(t.id.slice(3), 10))) + 1).padStart(4, '0')
  function seedLog(t: Task) {
    if (t.log.length) return
    const r = rng(parseInt(t.id.slice(3), 10))
    const base: [string, string][] = []
    if (t.done > 0) {
      base.push(['16:14', '第 ' + t.done + ' 条采集完成，质检通过'])
      base.push(['15:52', '第 ' + Math.max(1, t.done - 3) + ' 条完整率 98.6%，已隔离'])
      base.push(['14:20', '操作员 ' + OPS[t.op].n + ' 完成场景复位'])
    }
    base.push(['09:05', '任务创建，目标 500 条'])
    t.log = base.slice(0, 2 + Math.floor(r() * 2)).map((x) => ({ t: x[0], m: x[1] }))
  }
  function addLog(t: Task, m: string) { t.log.unshift({ t: '刚刚', m }) }
  function touch(t: Task) { t.updated = '刚刚'; t.ts = 1000 }
  function episodesFor(t: Task): Episode[] {
    const { nameFile } = useSettings()
    const r = rng(parseInt(t.id.slice(3), 10) * 77)
    const sc = SCEN[t.scen], op = OPS[t.op], rows: Episode[] = []
    for (let i = 0; i < Math.min(8, t.done); i++) {
      const integrity = r() < 0.14 ? +(96 + r() * 2.9).toFixed(1) : +(99 + r() * 0.99).toFixed(1)
      const sync = r() < 0.16 ? +(10.5 + r() * 5).toFixed(1) : +(3 + r() * 6.5).toFixed(1)
      const score = Math.round(clamp(100 - (100 - integrity) * 6 - Math.max(0, sync - 5) * 1.5 - r() * 3, 40, 100))
      rows.push({ file: nameFile(sc.code, TODAY, t.done - i, op.c), dur: Math.round(10 + r() * 20), size: +(0.78 + r() * 0.3).toFixed(2), integrity, sync, score })
    }
    return rows
  }
  function create(w: { scen: ScenKey; name: string; note: string; op: number; devices: string[] }, status: TaskStatus): Task {
    const t = mk(nextId(), w.scen, w.name, w.op, w.note, status, 0, 0, '刚刚', 1000)
    t.devices = w.devices.slice()
    t.log = [{ t: '刚刚', m: '任务创建，选用设备 ' + w.devices.length + ' 台' }]
    list.value.unshift(t)
    return t
  }

  /** SOP 前进一步；“空间标定”默认完成，自动跳过 */
  function bump(t: Task) { t.sop++; if (t.sop === 1) t.sop = 2 }

  /** 设备自检：逐台检查所选设备，全部正常则自动完成“设备巡检” */
  async function selfCheck(t: Task): Promise<CheckItem[]> {
    const dv = useDevices()
    await new Promise((r) => setTimeout(r, 1300))
    const msgOf: Record<string, string> = { online: '连接正常', offline: '设备离线', maint: '维护中，不可用', fault: '设备故障' }
    const items: CheckItem[] = t.devices.map((id) => {
      const d = dv.byId(id)
      return d ? { id, name: d.name, ok: d.st === 'online', msg: msgOf[d.st] } : { id, name: id, ok: false, msg: '设备不存在' }
    })
    t.check = { at: '刚刚', items }
    const bad = items.filter((x) => !x.ok).length
    if (!bad) {
      addLog(t, '设备自检通过（' + items.length + ' 台），设备巡检完成')
      if (t.sop === 0) bump(t)
    } else addLog(t, '设备自检发现 ' + bad + ' 台异常：' + items.filter((x) => !x.ok).map((x) => x.name).join('、'))
    touch(t)
    return items
  }

  /** 结束本次采集：结束动作自动下发后台，后台自动质检 */
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  function endCollect(t: Task) {
    t.status = 'ready'; t.sop = 4; t.qc = 'running'
    addLog(t, '结束动作已自动下发后台，开始自动数据质检')
    clearTimeout(timers.get(t.id))
    timers.set(t.id, setTimeout(() => finishQc(t, true), 4500))
    touch(t)
  }
  function finishQc(t: Task, auto: boolean) {
    if (t.qc !== 'running') return
    clearTimeout(timers.get(t.id)); timers.delete(t.id)
    t.qc = 'done'
    if (t.sop === 4) t.sop = 5
    addLog(t, auto ? '后台质检完成，数据质检通过' : '手动标记数据质检完成')
    if (auto) {
      useAlerts().add({ level: 'info', title: '任务 ' + t.id + ' 数据质检完成', desc: '后台已完成自动质检，可继续归档上传', time: '刚刚', route: 'tasks' })
      toast('任务 ' + t.id + ' 后台质检完成，数据质检已通过')
    }
    touch(t)
  }
  return { list, byId, nextId, seedLog, addLog, touch, episodesFor, create, bump, selfCheck, endCollect, finishQc }
})
