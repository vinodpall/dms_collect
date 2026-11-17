import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BadgeKind, ModeKey } from '@/constants'
import {
  devicesApi,
  stationsApi,
  getToken,
  type DeviceEventItem,
  type DeviceItem as ApiDeviceItem,
  type DeviceUpdatePayload,
  type StationItem,
  type DeviceKitItem,
  type DeviceTypeItem,
  type StationCreatePayload,
  type StationUpdatePayload,
} from '@/api'

export type DevStatus = 'online' | 'offline' | 'maint' | 'fault'

export interface DevCfg {
  rate: number
  res?: string
  codec?: string
}

export interface Device {
  id: string
  numericId: number
  name: string
  type: string
  typeCode: string
  st: DevStatus
  loc: string
  station: string
  stationId: number
  model: string
  vendor: string
  serialNo: string
  fw: string
  connIp: string
  connPort: number | null
  occupiedTaskId: number | null
  occupiedTaskCode: string
  calib: { at: string; by: string; items: string[] } | null
  cfg: DevCfg
  version: number
  updatedAt: string
}

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

export function cfgText(type: string, c: DevCfg) {
  const u = cfgDef(type).unit
  const r = u === 'Hz' && c.rate >= 1000 ? c.rate / 1000 + ' kHz' : c.rate + ' ' + u
  return [r, c.res, c.codec].filter(Boolean).join(' · ')
}

export const DV_ST: Record<DevStatus, [BadgeKind, string]> = {
  online: ['good', '在线'],
  offline: ['crit', '离线'],
  maint: ['warn', '维护中'],
  fault: ['crit', '故障'],
}

export const DEV_TYPES = ['VR 一体机', '动捕手套', 'UMI', '相机', '力觉', '机械臂', '其他']

export const TYPE_LABEL_TO_CODE: Record<string, string> = {
  'VR 一体机': 'vr',
  '动捕手套': 'glove',
  UMI: 'umi',
  '相机': 'camera',
  '力觉': 'ft',
  '机械臂': 'arm',
  '其他': 'other',
}

export const TYPE_CODE_TO_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_LABEL_TO_CODE).map(([label, code]) => [code, label])
)

export const CALIB_ITEMS: Record<string, string[]> = {
  'VR 一体机': ['VR 坐标系与机械臂基坐标系对齐'],
  '动捕手套': ['手部关节零位标定'],
  UMI: ['腕部相机内参', '夹爪开度量程'],
  '相机': ['相机内参', '相机外参（相对工位坐标系）'],
  '力觉': ['安装位姿与重力补偿'],
  '机械臂': ['机械臂基坐标系', '手眼标定（与相机）'],
  '其他': ['安装位姿'],
}

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

export function sizeOf(d: Device) {
  const p = DEV_PARAMS[d.type] ?? DEV_PARAMS['其他']
  const df = cfgDef(d.type)
  if (!df.video) return p.gb * (d.cfg.rate / df.def.rate)
  return (
    p.gb *
    (RES_K[d.cfg.res ?? '1080p'] / RES_K[df.def.res ?? '1080p']) *
    (d.cfg.rate / df.def.rate) *
    (d.cfg.codec === 'H.264' ? 1.4 : 1)
  )
}

export interface Kit {
  id: string
  name: string
  mode: ModeKey
  devices: string[]
}
/** 保留供未对接 API 的任务创建向导(TaskWizard)使用 */
export const KITS: Kit[] = [
  { id: 'KIT-A', name: '工位 A · VR 单臂', mode: 'vr', devices: ['DV-001', 'DV-005', 'DV-006', 'DV-012', 'DV-010', 'DV-011'] },
  { id: 'KIT-A2', name: '工位 A · VR 双臂', mode: 'vr', devices: ['DV-002', 'DV-012', 'DV-013', 'DV-010', 'DV-011'] },
  { id: 'KIT-B', name: '工位 B · VR 单臂', mode: 'vr', devices: ['DV-003', 'DV-016', 'DV-015'] },
  { id: 'KIT-C', name: '工位 C · UMI 双手', mode: 'umi', devices: ['DV-007', 'DV-008', 'DV-014'] },
]

export const useDevices = defineStore('devices', () => {
  const list = ref<Device[]>([])
  const deviceTotal = ref(0)
  const stations = ref<StationItem[]>([])
  const kits = ref<DeviceKitItem[]>([])
  const types = ref<DeviceTypeItem[]>([])
  const eventsByDevice = ref<Record<number, DeviceEventItem[]>>({})
  const loading = ref(false)
  const loadingStations = ref(false)

  const byId = (id: string) => list.value.find((d) => d.id === id || String(d.numericId) === id)

  function typeMeta(typeNameOrCode: string) {
    const t = types.value.find((x) => x.type === typeNameOrCode || x.label === typeNameOrCode)
    if (t) {
      return {
        code: t.type,
        label: t.rate_label,
        unit: t.unit,
        rates: t.rates,
        video: t.video,
        resolutions: t.resolutions?.length ? t.resolutions : RES_OPTS,
        codecs: t.codecs?.length ? t.codecs : CODEC_OPTS,
        def: (t.default_config && t.default_config.rate
          ? t.default_config
          : { rate: t.rates?.[0] ?? 30, ...(t.video ? { res: t.resolutions?.[0] ?? '1080p', codec: t.codecs?.[0] ?? 'H.265' } : {}) }) as DevCfg,
        calibItems: t.calib_items?.length ? t.calib_items : (CALIB_ITEMS[t.label] ?? CALIB_ITEMS['其他']),
      }
    }
    const label = TYPE_CODE_TO_LABEL[typeNameOrCode] || typeNameOrCode
    const c = cfgDef(label)
    return {
      code: TYPE_LABEL_TO_CODE[label] || 'other',
      label: c.label,
      unit: c.unit,
      rates: c.rates,
      video: c.video,
      resolutions: RES_OPTS,
      codecs: CODEC_OPTS,
      def: { ...c.def },
      calibItems: CALIB_ITEMS[label] ?? CALIB_ITEMS['其他'],
    }
  }

  function mapApiDevice(item: ApiDeviceItem): Device {
    const typeName = item.type_label || TYPE_CODE_TO_LABEL[item.device_type] || item.device_type
    const meta = typeMeta(item.device_type || typeName)
    return {
      id: item.code,
      numericId: item.id,
      name: item.name,
      type: typeName,
      typeCode: item.device_type,
      st: item.status,
      loc: item.location || '',
      station: item.station_name || '',
      stationId: item.station_id,
      model: item.model || '',
      vendor: item.vendor || '',
      serialNo: item.serial_no || '',
      fw: item.firmware || '',
      connIp: item.conn_ip || '',
      connPort: item.conn_port ?? null,
      occupiedTaskId: item.occupied_task_id ?? null,
      occupiedTaskCode: item.occupied_task_code || '',
      calib: item.is_calibrated
        ? {
            at: item.calibrated_at ? item.calibrated_at.replace('T', ' ').slice(0, 16) : '',
            by: item.calibrated_by_name || '—',
            items: item.calib_items?.length ? item.calib_items : meta.calibItems,
          }
        : null,
      cfg: item.config && item.config.rate ? (item.config as DevCfg) : { ...meta.def },
      version: item.version ?? 0,
      updatedAt: item.updated_at ? item.updated_at.replace('T', ' ').slice(0, 16) : '',
    }
  }

  async function fetchStations(params?: { is_online?: boolean; keyword?: string }) {
    if (!getToken()) return []
    loadingStations.value = true
    try {
      const res = await stationsApi.list(params)
      stations.value = Array.isArray(res) ? res : []
      return stations.value
    } finally {
      loadingStations.value = false
    }
  }

  async function fetchDevices(params?: {
    page?: number
    size?: number
    station_id?: number
    device_type?: string
    status?: string
    keyword?: string
  }) {
    if (!getToken()) return
    const res = await devicesApi.list({ page: 1, size: 100, ...params })
    const items: ApiDeviceItem[] = res?.items || []
    list.value = items.map(mapApiDevice)
    deviceTotal.value = res?.total ?? items.length
  }

  /** 从后端同步设备、工位、套装与类型 */
  async function fetchAll() {
    if (!getToken()) return
    loading.value = true
    try {
      const [typeList, stList, kitList, devRes] = await Promise.allSettled([
        devicesApi.getTypes(),
        stationsApi.list(),
        devicesApi.getKits(),
        devicesApi.list({ page: 1, size: 100 }),
      ])

      if (typeList.status === 'fulfilled' && Array.isArray(typeList.value)) {
        types.value = typeList.value
      }
      if (stList.status === 'fulfilled' && Array.isArray(stList.value)) {
        stations.value = stList.value
      }
      if (kitList.status === 'fulfilled' && Array.isArray(kitList.value)) {
        kits.value = kitList.value
      }
      if (devRes.status === 'fulfilled') {
        const items: ApiDeviceItem[] = devRes.value?.items || []
        list.value = items.map(mapApiDevice)
        deviceTotal.value = devRes.value?.total ?? items.length
      }
    } finally {
      loading.value = false
    }
  }

  async function fetchDeviceDetail(numericId: number): Promise<Device> {
    const res = await devicesApi.get(numericId)
    const mapped = mapApiDevice(res)
    const idx = list.value.findIndex((x) => x.numericId === numericId)
    if (idx >= 0) list.value[idx] = mapped
    else list.value.unshift(mapped)
    return mapped
  }

  async function fetchDeviceEvents(numericId: number): Promise<DeviceEventItem[]> {
    const events = await devicesApi.getEvents(numericId)
    const rows = Array.isArray(events) ? events : []
    eventsByDevice.value[numericId] = rows
    return rows
  }

  async function add(x: {
    name: string
    typeCode: string
    stationId: number
    loc?: string
    model?: string
    vendor?: string
    serialNo?: string
    fw?: string
    connIp?: string
    connPort?: number | null
    cfg?: DevCfg
  }): Promise<Device> {
    const created = await devicesApi.create({
      name: x.name,
      device_type: x.typeCode,
      station_id: x.stationId,
      location: x.loc || null,
      model: x.model || null,
      vendor: x.vendor || null,
      serial_no: x.serialNo || null,
      firmware: x.fw || null,
      conn_ip: x.connIp || null,
      conn_port: x.connPort ?? null,
      config: x.cfg ? { ...x.cfg } : undefined,
    })
    const mapped = mapApiDevice(created)
    list.value.unshift(mapped)
    deviceTotal.value += 1
    // 刷新工位挂载设备计数
    fetchStations().catch(() => {})
    return mapped
  }

  async function updateDevice(d: Device, payload: Omit<DeviceUpdatePayload, 'version'>): Promise<Device> {
    const res = await devicesApi.update(d.numericId, {
      ...payload,
      version: d.version,
    })
    const mapped = mapApiDevice(res)
    const idx = list.value.findIndex((x) => x.numericId === d.numericId)
    if (idx >= 0) list.value[idx] = mapped
    fetchStations().catch(() => {})
    return mapped
  }

  async function calibrate(d: Device): Promise<Device> {
    const items = typeMeta(d.typeCode || d.type).calibItems
    await devicesApi.calibrate(d.numericId, items)
    return await fetchDeviceDetail(d.numericId)
  }

  async function updateConfig(d: Device, cfg: DevCfg): Promise<Device> {
    await devicesApi.updateConfig(d.numericId, { ...cfg }, d.version)
    return await fetchDeviceDetail(d.numericId)
  }

  async function reportFault(devCode: string, lv: '一般' | '严重', desc: string): Promise<void> {
    const d = byId(devCode)
    if (!d) throw new Error('设备不存在')
    await devicesApi.reportFault(d.numericId, lv === '严重' ? 'severe' : 'normal', desc)
    await Promise.allSettled([fetchDeviceDetail(d.numericId), fetchDeviceEvents(d.numericId)])
  }

  async function setStatus(d: Device, st: 'maint' | 'online', description?: string): Promise<Device> {
    if (st === 'maint') await devicesApi.maintain(d.numericId, description)
    else await devicesApi.recover(d.numericId, description)
    const updated = await fetchDeviceDetail(d.numericId)
    fetchDeviceEvents(d.numericId).catch(() => {})
    return updated
  }

  async function createStation(data: StationCreatePayload) {
    const res = await stationsApi.create(data)
    await fetchStations()
    return res
  }

  async function updateStation(id: number, data: StationUpdatePayload) {
    const res = await stationsApi.update(id, data)
    await fetchStations()
    return res
  }

  const ofTypes = (typeLabels: string[]) => list.value.filter((d) => typeLabels.includes(d.type))

  function reset() {
    list.value = []
    deviceTotal.value = 0
    stations.value = []
    kits.value = []
    types.value = []
    eventsByDevice.value = {}
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('dms:login', () => {
      fetchAll().catch(() => {})
    })
    window.addEventListener('dms:logout', reset)
  }

  if (getToken()) {
    fetchAll().catch((e) => console.warn('[devices] 初始化失败', e))
  }

  return {
    list,
    deviceTotal,
    stations,
    kits,
    types,
    eventsByDevice,
    loading,
    loadingStations,
    typeMeta,
    byId,
    add,
    updateDevice,
    calibrate,
    updateConfig,
    reportFault,
    setStatus,
    ofTypes,
    fetchAll,
    fetchDevices,
    fetchStations,
    fetchDeviceDetail,
    fetchDeviceEvents,
    createStation,
    updateStation,
    reset,
  }
})
