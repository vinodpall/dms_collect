import { api } from './client'

export interface StationItem {
  id: number
  code: string
  name: string
  mqtt_username: string
  api_base_url: string | null
  has_api_token: boolean
  client_ver: string | null
  ip: string | null
  is_online: boolean
  last_seen_at: string | null
  disk_free_gb: number | null
  remark: string | null
  device_count: number
  created_at: string
}

export interface StationCreatePayload {
  code: string
  name: string
  api_base_url?: string | null
  api_token?: string | null
  remark?: string | null
}

export interface StationUpdatePayload {
  name?: string | null
  api_base_url?: string | null
  api_token?: string | null
  remark?: string | null
  reset_mqtt_password?: boolean
}

export interface StationCredentials {
  mqtt_username: string
  mqtt_password?: string | null
  api_token?: string | null
}

export const stationsApi = {
  list: (params?: { is_online?: boolean; keyword?: string }) =>
    api.get<StationItem[]>('/stations', params),
  create: (data: StationCreatePayload) =>
    api.post<{ station: StationItem; credentials: StationCredentials }>('/stations', data),
  update: (id: number, data: StationUpdatePayload) =>
    api.put<{ station: StationItem; credentials?: StationCredentials }>(`/stations/${id}`, data),
}
