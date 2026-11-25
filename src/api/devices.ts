import { api } from './client'

export interface DeviceTypeItem {
  type: string
  label: string
  rate_label: string
  unit: string
  rates: number[]
  video: boolean
  resolutions: string[]
  codecs: string[]
  default_config: Record<string, any>
  calib_items: string[]
  channel: string
  gb_per_hour: number
}

export interface DeviceKitItem {
  id: number
  code: string
  name: string
  mode: string
  station_id: number
  station_name: string
  devices: Array<{
    id: number
    code: string
    name: string
    device_type: string
    status: string
    is_calibrated: boolean
    occupied_task_id: number | null
    available: boolean
    reason: string | null
  }>
  all_available: boolean
}

export interface DeviceItem {
  id: number
  code: string
  name: string
  device_type: string
  type_label: string
  station_id: number
  station_code: string
  station_name: string
  location: string | null
  model: string | null
  vendor?: string | null
  serial_no?: string | null
  firmware: string | null
  status: 'online' | 'offline' | 'maint' | 'fault'
  config: Record<string, any>
  ext_config?: Record<string, any> | null
  conn_ip?: string | null
  conn_port?: number | null
  conn_username?: string | null
  conn_password?: string | null
  fw_type?: string | null
  fw_model?: string | null
  is_calibrated: boolean
  calibrated_at?: string | null
  calibrated_by?: number | null
  calibrated_by_name?: string | null
  calib_items?: string[] | null
  calibration?: {
    id: number
    items: string[] | Record<string, any> | null
    calibrated_by: number
    calibrated_by_name?: string | null
    is_valid: boolean
    invalid_reason?: string | null
    created_at: string
  } | null
  calib_items_template?: string[] | null
  occupied_task_id: number | null
  occupied_task_code: string | null
  version: number
  updated_at: string
}

export interface DevicePageResult {
  items: DeviceItem[]
  total: number
  page: number
  size: number
  pages: number
}

export interface DeviceCreatePayload {
  name: string
  device_type: string
  station_id: number
  location?: string | null
  model?: string | null
  vendor?: string | null
  serial_no?: string | null
  firmware?: string | null
  config?: Record<string, any> | null
  ext_config?: Record<string, any> | null
  conn_ip?: string | null
  conn_port?: number | null
  conn_username?: string | null
  conn_password?: string | null
  fw_type?: string | null
  fw_model?: string | null
}

export interface DeviceUpdatePayload {
  name?: string | null
  station_id?: number | null
  location?: string | null
  model?: string | null
  vendor?: string | null
  serial_no?: string | null
  firmware?: string | null
  ext_config?: Record<string, any> | null
  conn_ip?: string | null
  conn_port?: number | null
  conn_username?: string | null
  conn_password?: string | null
  fw_type?: string | null
  fw_model?: string | null
  version: number
}

export interface DeviceEventItem {
  id: number
  event_type: 'fault' | 'maint' | 'calib' | 'config'
  event_level: string | null
  title: string
  description: string | null
  operator_id: number | null
  operator_name: string | null
  created_at: string
}

export const devicesApi = {
  getTypes: () => api.get<DeviceTypeItem[]>('/device-types'),
  getKits: () => api.get<DeviceKitItem[]>('/device-kits'),
  list: (params?: { page?: number; size?: number; station_id?: number; device_type?: string; status?: string; keyword?: string }) =>
    api.get<DevicePageResult>('/devices', params),
  get: (id: number) => api.get<DeviceItem>(`/devices/${id}`),
  create: (data: DeviceCreatePayload) => api.post<DeviceItem>('/devices', data),
  update: (id: number, data: DeviceUpdatePayload) => api.put<DeviceItem>(`/devices/${id}`, data),
  calibrate: (id: number, items: string[], result?: Record<string, any>) =>
    api.post<null>(`/devices/${id}/calibrate`, { items, result }),
  updateConfig: (id: number, config: Record<string, any>, version: number) =>
    api.put<null>(`/devices/${id}/config`, { config, version }),
  getEvents: (id: number) => api.get<DeviceEventItem[]>(`/devices/${id}/events`),
  reportFault: (id: number, severity: 'normal' | 'severe', description: string) =>
    api.post<null>(`/devices/${id}/faults`, { severity, description }),
  maintain: (id: number, description?: string) =>
    api.post<null>(`/devices/${id}/maintain`, { description }),
  recover: (id: number, description?: string) =>
    api.post<null>(`/devices/${id}/recover`, { description }),
}
