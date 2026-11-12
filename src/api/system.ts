import { api } from './client'

export interface SettingItem {
  key: string
  value: any
  description: string
  version: number
  editable: boolean
  updated_at: string
}

export interface WhitelistItem {
  id: number
  cidr: string
  remark: string | null
  created_by?: number | null
  created_at: string
}

export const systemApi = {
  getSettings: () => api.get<{ items: SettingItem[] }>('/system/settings'),
  updateSettings: (items: Record<string, any>, versions?: Record<string, number>) =>
    api.put<{ items: SettingItem[] }>('/system/settings', { items, versions }),
  getWhitelist: () => api.get<WhitelistItem[]>('/system/ip-whitelist'),
  addWhitelist: (cidr: string, remark?: string) =>
    api.post<WhitelistItem>('/system/ip-whitelist', { cidr, remark }),
  removeWhitelist: (id: number) => api.del<null>(`/system/ip-whitelist/${id}`),
  health: () => api.get<{ status: string; version: string; db: string; redis: string }>('/health'),
}
