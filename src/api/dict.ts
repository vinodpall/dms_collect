import { api } from './client'

export interface SceneItem {
  id: number
  scene_key: string
  code: string
  name: string
  short_name: string
  default_mode: string
  dur_min_s: number
  dur_max_s: number
  reset_desc: string | null
  lang_template: string | null
  specs: string[] | null
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface DictItemEntity {
  id: number
  item_no: string
  code: string
  name: string
  category: 'action' | 'object' | 'scene'
  level?: 'compound' | 'abnormal' | null
  scene_key: string
  aliases: string[]
  pinyin?: string | null
  definition?: string | null
  is_required: boolean
  seq_order: number
  status: 'active' | 'inactive'
  ref_count: number
  version: number
  updated_by?: number | null
  updated_by_name?: string | null
  updated_at: string
  created_at: string
}

export interface DictVersionInfo {
  version: string
  item_count: number
  active_count: number
  last_change_at: string | null
}

export interface DictChangeItem {
  id: number
  version: string
  change_type: string
  item_no?: string | null
  target_name: string
  summary: string
  operator_id?: number | null
  operator_name?: string | null
  created_at: string
}

export interface DictItemCreatePayload {
  code: string
  name: string
  category?: 'action' | 'object' | 'scene'
  level?: 'compound' | 'abnormal' | null
  scene_key: string
  aliases?: string[]
  definition?: string | null
  is_required?: boolean
  seq_order?: number
}

export interface DictItemUpdatePayload {
  code?: string | null
  name?: string | null
  level?: 'compound' | 'abnormal' | null
  scene_key?: string | null
  aliases?: string[]
  definition?: string | null
  is_required?: boolean | null
  seq_order?: number | null
  version: number
}

export const dictApi = {
  getScenes: () => api.get<SceneItem[]>('/scenes'),
  createScene: (data: any) => api.post<SceneItem>('/scenes', data),
  updateScene: (id: number, data: any) => api.put<SceneItem>(`/scenes/${id}`, data),
  getVersion: () => api.get<DictVersionInfo>('/dict/version'),
  getChanges: () => api.get<DictChangeItem[]>('/dict/changes'),
  getItems: (params?: { scene?: string; category?: string; status?: string; keyword?: string }) =>
    api.get<DictItemEntity[]>('/dict/items', params),
  createItem: (data: DictItemCreatePayload) => api.post<DictItemEntity>('/dict/items', data),
  updateItem: (id: number, data: DictItemUpdatePayload) => api.put<DictItemEntity>(`/dict/items/${id}`, data),
  deleteItem: (id: number) => api.del<null>(`/dict/items/${id}`),
  toggleItem: (id: number) => api.post<null>(`/dict/items/${id}/toggle`),
}
