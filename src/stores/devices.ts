import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BadgeKind, ScenKey } from '@/constants'

export type DevStatus = 'online' | 'offline' | 'maint' | 'fault'
export interface Device { id: string; name: string; type: string; st: DevStatus; loc: string; cal: string; next: string; fw: string; /** 所属固定场景，null 为未分配 */ scen: ScenKey | null }
export interface Fault { dev: string; t: string; lv: string; d: string; by: string }
export const DV_ST: Record<DevStatus, [BadgeKind, string]> = { online: ['good', '在线'], offline: ['crit', '离线'], maint: ['warn', '维护中'], fault: ['crit', '故障'] }

export const DEV_TYPES = ['VR 一体机', '动捕手套', 'UMI', '相机', '力觉', '机械臂', '其他']

/** 各类设备的数据通道信息，用于新建任务“采集参数”展示 */
export const DEV_PARAMS: Record<string, { ch: string; rate: string; gb: number }> = {
  'VR 一体机': { ch: '头显 + 双手柄 6DoF 位姿', rate: '90 Hz', gb: 0.08 },
  '动捕手套': { ch: '手部 21 关节角度', rate: '120 Hz', gb: 0.05 },
  UMI: { ch: '末端位姿 + 夹爪开合', rate: '60 Hz', gb: 0.06 },
  '相机': { ch: 'RGB-D 1280×720', rate: '30 fps', gb: 0.28 },
  '力觉': { ch: '六维力 / 力矩', rate: '1 kHz', gb: 0.04 },
  '机械臂': { ch: '7 关节位置 / 速度 / 力矩', rate: '1 kHz', gb: 0.12 },
  '其他': { ch: '自定义数据通道', rate: '—', gb: 0.05 },
}

export const useDevices = defineStore('devices', () => {
  const list = ref<Device[]>([
    { id: 'DV-001', name: 'PICO VR 一体机 #1', type: 'VR 一体机', st: 'online', loc: '采集工位 A', cal: '10-12', next: '10-19', fw: '5.9.2', scen: 'qmd' },
    { id: 'DV-002', name: 'PICO VR 一体机 #2', type: 'VR 一体机', st: 'online', loc: '采集工位 A', cal: '10-12', next: '10-19', fw: '5.9.2', scen: 'qmd' },
    { id: 'DV-003', name: 'PICO VR 一体机 #3', type: 'VR 一体机', st: 'offline', loc: '采集工位 B', cal: '10-09', next: '10-16', fw: '5.9.1', scen: 'qmd' },
    { id: 'DV-004', name: 'PICO VR 一体机 #4', type: 'VR 一体机', st: 'maint', loc: '维修间', cal: '10-02', next: '—', fw: '5.9.0', scen: 'qmd' },
    { id: 'DV-005', name: '动捕手套 左', type: '动捕手套', st: 'online', loc: '采集工位 A', cal: '10-13', next: '10-20', fw: '2.4.0', scen: 'qmd' },
    { id: 'DV-006', name: '动捕手套 右', type: '动捕手套', st: 'online', loc: '采集工位 A', cal: '10-13', next: '10-20', fw: '2.4.0', scen: 'qmd' },
    { id: 'DV-007', name: 'UMI 手持设备 #1', type: 'UMI', st: 'online', loc: '采集工位 C', cal: '10-11', next: '10-18', fw: '1.8.3', scen: 'fhd' },
    { id: 'DV-008', name: 'UMI 手持设备 #2', type: 'UMI', st: 'online', loc: '采集工位 C', cal: '10-11', next: '10-18', fw: '1.8.3', scen: 'fhd' },
    { id: 'DV-009', name: 'RealSense D405（第一视角）', type: '相机', st: 'fault', loc: '机械臂末端', cal: '10-10', next: '—', fw: '5.16.0', scen: 'fhd' },
    { id: 'DV-010', name: 'RealSense D435（第三视角）', type: '相机', st: 'online', loc: '工位上方', cal: '10-10', next: '10-17', fw: '5.16.0', scen: 'qmd' },
    { id: 'DV-011', name: '六维力传感器', type: '力觉', st: 'online', loc: '机械臂腕部', cal: '10-08', next: '10-15', fw: '3.1.0', scen: 'qmd' },
    { id: 'DV-012', name: '7DOF 机械臂', type: '机械臂', st: 'online', loc: '采集工位 A', cal: '10-12', next: '10-26', fw: '7.2.1', scen: 'qmd' },
  ])
  const faults = ref<Fault[]>([{ dev: 'DV-009', t: '10-13 16:07', lv: '一般', d: '掉帧率 2.4%，疑似 USB 带宽不足', by: '赵工' }])
  const byId = (id: string) => list.value.find((d) => d.id === id)
  const nextId = () => 'DV-' + String(Math.max(...list.value.map((d) => parseInt(d.id.slice(3), 10))) + 1).padStart(3, '0')
  function add(x: { name: string; type: string; loc: string; fw: string; scen: ScenKey | null }): Device {
    const d: Device = { id: nextId(), name: x.name, type: x.type, st: 'offline', loc: x.loc || '未设置', cal: '—', next: '—', fw: x.fw || '—', scen: x.scen }
    list.value.unshift(d)
    return d
  }
  /** 某场景下可用于采集的设备（排除维护中/故障） */
  const forScene = (s: ScenKey) => list.value.filter((d) => d.scen === s)
  return { list, faults, byId, add, forScene }
})
