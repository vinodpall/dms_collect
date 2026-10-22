import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BadgeKind, ModeKey } from '@/constants'

export type DevStatus = 'online' | 'offline' | 'maint' | 'fault'
/**
 * 设备台账：设备不再归属某个场景，而是归属「工位」，按类型匹配采集模式的设备槽位，可以跨场景使用。
 * 标定为一次性工作：完成后长期有效，仅在设备移位、维修或更换安装位置后需要重新标定。
 */
export interface Device {
  id: string; name: string; type: string; st: DevStatus; loc: string; station: string; fw: string
  /** 一次性标定记录；null 表示尚未标定 */ calib: { at: string; by: string; items: string[] } | null
  /** 采集参数：随设备配置一次，之后所有任务沿用 */ cfg: DevCfg
}
/** rate 为采样率（相机/UMI 为视频帧率）；res、codec 仅对含视频的设备有效 */
export interface DevCfg { rate: number; res?: string; codec?: string }
/** 各类设备可选的采集参数 */
export const CFG_DEF: Record<string, { label: string; unit: string; rates: number[]; video: boolean; def: DevCfg }> = {
  'VR 一体机': { label: '位姿频率', unit: 'Hz', rates: [72, 90], video: false, def: { rate: 90 } },
  '动捕手套': { label: '采样率', unit: 'Hz', rates: [60, 120], video: false, def: { rate: 120 } },
  UMI: { label: '腕部相机帧率', unit: 'fps', rates: [30, 60], video: true, def: { rate: 60, res: '720p', codec: 'H.265' } },
  '相机': { label: '视频帧率', unit: 'fps', rates: [15, 30, 60], video: true, def: { rate: 30, res: '1080p', codec: 'H.265' } },
  '力觉': { label: '采样率', unit: 'Hz', rates: [500, 1000], video: false, def: { rate: 1000 } },
  '机械臂': { label: '状态频率', unit: 'Hz', rates: [500, 1000], video: false, def: { rate: 1000 } },
  '其他': { label: '采样率', unit: 'Hz', rates: [10, 30, 100], video: false, def: { rate: 30 } },
}
export const RES_OPTS = ['720p', '1080p', '4K']
export const CODEC_OPTS = ['H.264', 'H.265']
export const cfgDef = (type: string) => CFG_DEF[type] ?? CFG_DEF['其他']
/** 参数文字：如「30 fps · 1080p · H.265」「1 kHz」 */
export function cfgText(type: string, c: DevCfg) {
  const u = cfgDef(type).unit
  const r = u === 'Hz' && c.rate >= 1000 ? c.rate / 1000 + ' kHz' : c.rate + ' ' + u
  return [r, c.res, c.codec].filter(Boolean).join(' · ')
}
export interface Fault { dev: string; t: string; lv: string; d: string; by: string }
export const DV_ST: Record<DevStatus, [BadgeKind, string]> = { online: ['good', '在线'], offline: ['crit', '离线'], maint: ['warn', '维护中'], fault: ['crit', '故障'] }

export const DEV_TYPES = ['VR 一体机', '动捕手套', 'UMI', '相机', '力觉', '机械臂', '其他']
export const STATIONS = ['采集工位 A', '采集工位 B', '采集工位 C']

/** 各类设备的一次性标定内容 */
export const CALIB_ITEMS: Record<string, string[]> = {
  'VR 一体机': ['VR 坐标系与机械臂基坐标系对齐'],
  '动捕手套': ['手部关节零位标定'],
  UMI: ['腕部相机内参', '夹爪开度量程'],
  '相机': ['相机内参', '相机外参（相对工位坐标系）'],
  '力觉': ['安装位姿与重力补偿'],
  '机械臂': ['机械臂基坐标系', '手眼标定（与相机）'],
  '其他': ['安装位姿'],
}

/** 各类设备的数据通道信息（gb 为默认参数下 20 秒单条体量） */
export const DEV_PARAMS: Record<string, { ch: string; gb: number }> = {
  'VR 一体机': { ch: '头显 + 双手柄 6DoF 位姿', gb: 0.08 },
  '动捕手套': { ch: '手部 21 关节角度', gb: 0.05 },
  UMI: { ch: '末端位姿 + 夹爪开合 + 腕部相机', gb: 0.18 },
  '相机': { ch: 'RGB-D 视频', gb: 0.28 },
  '力觉': { ch: '六维力 / 力矩', gb: 0.04 },
  '机械臂': { ch: '7 关节位置 / 速度 / 力矩', gb: 0.12 },
  '其他': { ch: '自定义数据通道', gb: 0.05 },
}
const RES_K: Record<string, number> = { '720p': 0.55, '1080p': 1, '4K': 3.2 }
/** 按设备参数估算单条体量（GB / 20 秒） */
export function sizeOf(d: Device) {
  const p = DEV_PARAMS[d.type] ?? DEV_PARAMS['其他'], df = cfgDef(d.type)
  if (!df.video) return p.gb * (d.cfg.rate / df.def.rate)
  return p.gb * (RES_K[d.cfg.res ?? '1080p'] / RES_K[df.def.res ?? '1080p']) * (d.cfg.rate / df.def.rate) * (d.cfg.codec === 'H.264' ? 1.4 : 1)
}

/** 工位套装：常用设备组合，新建任务时一键带出，可再按需增减 */
export interface Kit { id: string; name: string; mode: ModeKey; devices: string[] }
export const KITS: Kit[] = [
  { id: 'KIT-A', name: '工位 A · VR 单臂', mode: 'vr', devices: ['DV-001', 'DV-005', 'DV-006', 'DV-012', 'DV-010', 'DV-011'] },
  { id: 'KIT-A2', name: '工位 A · VR 双臂', mode: 'vr', devices: ['DV-002', 'DV-012', 'DV-013', 'DV-010', 'DV-011'] },
  { id: 'KIT-B', name: '工位 B · VR 单臂', mode: 'vr', devices: ['DV-003', 'DV-016', 'DV-015'] },
  { id: 'KIT-C', name: '工位 C · UMI 双手', mode: 'umi', devices: ['DV-007', 'DV-008', 'DV-014'] },
]

const cal = (at: string, type: string) => ({ at, by: '赵工', items: CALIB_ITEMS[type] ?? CALIB_ITEMS['其他'] })
const dv = (id: string, name: string, type: string, st: DevStatus, loc: string, station: string, fw: string, calAt: string | null): Device =>
  ({ id, name, type, st, loc, station, fw, calib: calAt ? cal(calAt, type) : null, cfg: { ...cfgDef(type).def } })

export const useDevices = defineStore('devices', () => {
  const list = ref<Device[]>([
    dv('DV-001', 'PICO VR 一体机 #1', 'VR 一体机', 'online', '采集工位 A', '采集工位 A', '5.9.2', '09-28'),
    dv('DV-002', 'PICO VR 一体机 #2', 'VR 一体机', 'online', '采集工位 A', '采集工位 A', '5.9.2', '09-28'),
    dv('DV-003', 'PICO VR 一体机 #3', 'VR 一体机', 'online', '采集工位 B', '采集工位 B', '5.9.1', '09-30'),
    dv('DV-004', 'PICO VR 一体机 #4', 'VR 一体机', 'maint', '维修间', '采集工位 B', '5.9.0', null),
    dv('DV-005', '动捕手套 左', '动捕手套', 'online', '采集工位 A', '采集工位 A', '2.4.0', '09-28'),
    dv('DV-006', '动捕手套 右', '动捕手套', 'online', '采集工位 A', '采集工位 A', '2.4.0', '09-28'),
    dv('DV-007', 'UMI 手持设备 #1', 'UMI', 'online', '采集工位 C', '采集工位 C', '1.8.3', '10-02'),
    dv('DV-008', 'UMI 手持设备 #2', 'UMI', 'online', '采集工位 C', '采集工位 C', '1.8.3', '10-02'),
    dv('DV-009', 'RealSense D405（腕部视角）', '相机', 'fault', '机械臂末端', '采集工位 A', '5.16.0', '09-28'),
    dv('DV-010', 'RealSense D435（第三视角）', '相机', 'online', '工位上方', '采集工位 A', '5.16.0', '09-28'),
    dv('DV-011', '六维力传感器', '力觉', 'online', '机械臂腕部', '采集工位 A', '3.1.0', '09-28'),
    dv('DV-012', '7DOF 机械臂 #1', '机械臂', 'online', '采集工位 A', '采集工位 A', '7.2.1', '09-28'),
    dv('DV-013', '7DOF 机械臂 #2', '机械臂', 'online', '采集工位 A', '采集工位 A', '7.2.1', '09-28'),
    dv('DV-014', 'RealSense D435（UMI 第三视角）', '相机', 'online', '工位侧上方', '采集工位 C', '5.16.0', '10-02'),
    dv('DV-015', 'RealSense D435（工位 B）', '相机', 'online', '工位上方', '采集工位 B', '5.16.0', '10-06'),
    dv('DV-016', '7DOF 机械臂 #3', '机械臂', 'online', '采集工位 B', '采集工位 B', '7.2.1', '10-06'),
  ])
  const faults = ref<Fault[]>([{ dev: 'DV-009', t: '10-13 16:07', lv: '一般', d: '掉帧率 2.4%，疑似 USB 带宽不足', by: '赵工' }])
  const byId = (id: string) => list.value.find((d) => d.id === id)
  const nextId = () => 'DV-' + String(Math.max(...list.value.map((d) => parseInt(d.id.slice(3), 10))) + 1).padStart(3, '0')
  function add(x: { name: string; type: string; loc: string; fw: string; station: string; cfg?: DevCfg }): Device {
    const d: Device = { id: nextId(), name: x.name, type: x.type, st: 'offline', loc: x.loc || x.station, station: x.station, fw: x.fw || '—', calib: null, cfg: x.cfg ? { ...x.cfg } : { ...cfgDef(x.type).def } }
    list.value.unshift(d)
    return d
  }
  function calibrate(d: Device, by: string) { d.calib = { at: '10-13', by, items: CALIB_ITEMS[d.type] ?? CALIB_ITEMS['其他'] } }
  /** 某类型的全部设备（跨场景、跨工位） */
  const ofTypes = (types: string[]) => list.value.filter((d) => types.includes(d.type))
  return { list, faults, byId, add, calibrate, ofTypes }
})
