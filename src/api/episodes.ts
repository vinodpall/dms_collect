import { api } from './client'

export type EpisodeSource = 'vr' | 'umi' | 'video' | 'lerobot' | (string & {})
export type EpisodeVerdict = 'ok' | 'warn' | 'fail' | null

export interface EpisodeListItem {
  id: number
  file_name: string
  source: EpisodeSource
  scene_id: number | null
  scene_name: string | null
  spec: string | null
  dataset_id: number | null
  dataset_name: string | null
  task_id: number | null
  import_job_id: number | null
  station_id: number | null
  operator_id: number | null
  operator_name: string | null
  duration_ms: number | null
  size_bytes: number | null
  frame_count: number | null
  verdict: EpisodeVerdict
  quality_score: number | null
  ingest_state: string | null
  is_releasable: boolean
  recorded_at: string | null
  created_at: string | null
  has_preview: boolean
  thumb_url: string | null
}

export interface EpisodePageResult {
  items: EpisodeListItem[]
  total: number
  page: number
  size: number
}

export interface EpisodeChannel {
  name: string
  type: 'video' | 'encoder' | 'imu' | 'audio' | 'tactile' | 'trajectory' | string
  side?: 'left' | 'right' | string | null
  rate?: number | null
  frames?: number | null
}

export interface EpisodePreviewVideo {
  camera: string
  label: string
  side?: 'left' | 'right' | string | null
  url: string
  width: number
  height: number
  fps: number
  duration_ms: number
  offset_ms: number
  data_start_ms: number
  data_end_ms: number
}

export interface EpisodePreviewAudio {
  url: string
  duration_ms: number
  offset_ms: number
  offset_estimated?: boolean
}

export interface EpisodePreview {
  expires_at: string
  duration_ms: number
  thumb_url: string | null
  has_signals: boolean
  videos: EpisodePreviewVideo[]
  audio: EpisodePreviewAudio | null
}

export interface EpisodeDetail extends EpisodeListItem {
  channels?: EpisodeChannel[]
  meta?: Record<string, any> | null
  integrity?: number | null
  sync_err_ms?: number | null
  drop_max_ms?: number | null
  verify_detail?: Record<string, any> | null
  session_id?: number | string | null
  seq_in_session?: number | null
  batch_id?: number | string | null
  storage_tier?: string | null
  preview: EpisodePreview | null
}

export interface SignalSeries {
  key: string
  label: string
  data: (number | null)[]
}

export interface SignalGroup {
  key: string
  label: string
  unit: string | null
  series: SignalSeries[]
}

export interface EpisodeSignals {
  rate_hz: number
  duration_ms: number
  start_time: string | null
  count: number
  t: number[]
  groups: SignalGroup[]
}

export interface EpisodeListParams {
  page?: number
  size?: number
  sort?: string
  source?: string
  scene_id?: number
  dataset_id?: number
  task_id?: number
  import_job_id?: number
  verdict?: string
  ingest_state?: string
  has_preview?: boolean
  keyword?: string
  recorded_from?: string
  recorded_to?: string
}

export interface DatasetOption {
  id: number
  code: string
  name: string
  scene_id: number
  status: string
}

export type ImportKind = 'video' | 'umi'
export type ImportOrigin = 'upload' | 'server'
export type ImportStatus = 'uploading' | 'validating' | 'validated' | 'confirmed' | 'failed' | 'canceled'

export interface ImportFileEntry {
  name: string
  size: number
  uploaded?: boolean
  episode_id?: number | null
}

export interface ImportUploadTarget {
  name: string
  size: number
  upload_url: string
}

export interface ImportCheckItem {
  key: 'format' | 'video' | 'duration' | 'duplicate' | string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

export interface ImportItemResult {
  index: number
  name: string
  verdict: 'ok' | 'warn' | 'fail'
  messages: string[]
  duration_ms: number | null
  size_bytes: number | null
  file_count: number | null
  recorded_at: string | null
  video?: {
    codec: string
    width: number
    height: number
    fps: number
  } | null
  camera_count: number | null
  has_trajectory?: boolean | null
  duplicate_of: number | null
  thumb_url: string | null
  episode_id: number | null
}

export interface ImportSummary {
  total: number
  ok: number
  warn: number
  fail: number
}

export interface ImportJobListItem {
  id: number
  kind: ImportKind
  origin?: ImportOrigin
  status: ImportStatus
  scene_id?: number | null
  scene_name?: string | null
  dataset_id?: number | null
  dataset_name?: string | null
  file_count: number
  size_bytes: number
  progress: number
  progress_text: string | null
  summary: ImportSummary | null
  episode_count: number
  error_msg: string | null
  operator_id?: number | null
  operator_name?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ImportJobDetail extends ImportJobListItem {
  files?: ImportFileEntry[]
  checks?: ImportCheckItem[]
  items?: ImportItemResult[]
  ignored?: string[]
  uploads?: ImportUploadTarget[]
  upload_expires_at?: string | null
  skipped?: string[]
}

export interface ImportJobPageResult {
  items: ImportJobListItem[]
  total: number
  page: number
  size: number
}

export interface CreateImportPayload {
  kind: ImportKind
  scene_id: number
  dataset_id?: number
  dataset_name?: string
  files?: { name: string; size: number }[]
  recordings?: string[]
}

export interface UploadUrlsResult {
  uploads: ImportUploadTarget[]
  upload_expires_at: string
}

export type LocalRecordingState = 'ready' | 'copying' | 'incomplete' | 'importing' | 'imported'

export interface LocalRecordingDevice {
  dir: string
  side: 'left' | 'right' | string
  role?: string | null
  sn?: string | null
  has_trajectory?: boolean
}

export interface LocalRecordingItem {
  dir: string
  state: LocalRecordingState
  state_label: string
  messages: string[]
  recorded_at: string | null
  duration_s: number | null
  devices: LocalRecordingDevice[]
  has_trajectory: boolean
  size_bytes: number
  file_count: number
  changed_at: string | null
  episode_ids?: number[]
  import_job_id?: number | null
}

export interface LocalRecordingsResult {
  enabled: boolean
  stable_seconds: number
  total: number
  items: LocalRecordingItem[]
}

export const episodesApi = {
  list(params?: EpisodeListParams) {
    return api.get<EpisodePageResult>('/episodes', params)
  },
  get(id: number) {
    return api.get<EpisodeDetail>(`/episodes/${id}`)
  },
  getSignals(id: number) {
    return api.get<EpisodeSignals>(`/episodes/${id}/signals`)
  },
  getPreview(id: number) {
    return api.get<EpisodePreview>(`/episodes/${id}/preview`)
  },
}

export const importsApi = {
  getDatasetOptions(params?: { scene_id?: number; keyword?: string }) {
    return api.get<DatasetOption[]>('/datasets/options', params)
  },
  list(params?: { page?: number; size?: number; kind?: ImportKind; status?: ImportStatus; mine?: boolean }) {
    return api.get<ImportJobPageResult>('/collect/imports', params)
  },
  get(id: number) {
    return api.get<ImportJobDetail>(`/collect/imports/${id}`)
  },
  create(payload: CreateImportPayload) {
    return api.post<ImportJobDetail>('/collect/imports', payload)
  },
  refreshUploadUrls(id: number, names?: string[]) {
    return api.post<UploadUrlsResult>(`/collect/imports/${id}/upload-urls`, names?.length ? { names } : {})
  },
  validate(id: number) {
    return api.post<ImportJobDetail>(`/collect/imports/${id}/validate`)
  },
  confirm(id: number, keepWarn: boolean = true) {
    return api.post<ImportJobDetail>(`/collect/imports/${id}/confirm`, { keep_warn: keepWarn })
  },
  abandon(id: number) {
    return api.post<ImportJobDetail>(`/collect/imports/${id}/abandon`)
  },
  getLocalRecordings(state?: LocalRecordingState) {
    return api.get<LocalRecordingsResult>('/collect/imports/local-recordings', state ? { state } : undefined)
  },
}

export class DirectUploadError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'DirectUploadError'
    this.status = status
  }
}

/** 直接 PUT 上传文件到对象存储签名地址（不带 Authorization 请求头） */
export function uploadFileDirect(
  url: string,
  file: Blob,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(file.size, file.size)
        resolve()
      } else {
        reject(new DirectUploadError(`上传失败 (HTTP ${xhr.status})`, xhr.status))
      }
    }
    xhr.onerror = () => reject(new DirectUploadError('网络异常，上传中断', 0))
    xhr.onabort = () => reject(new DirectUploadError('已取消上传', -1))
    if (signal) {
      if (signal.aborted) {
        xhr.abort()
        return
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(file)
  })
}
