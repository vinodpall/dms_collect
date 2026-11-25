import { api } from './client'

export type PipelineBatchState = 'running' | 'wait' | 'partial_failed' | 'failed' | 'ok'

export interface OverviewStageOut {
  stage: number
  name: string
  kind: string
  episode_count: number
  running: number
  waiting: number
  failed: number
  done: number
}

export interface OverviewBatchesOut {
  total: number
  wait: number
  running: number
  failed: number
  partial_failed: number
  ok: number
}

export interface PipelineOverview {
  stages: OverviewStageOut[]
  batches: OverviewBatchesOut
  failed_episodes: number
}

export interface PipelineBatchItem {
  id: number
  code: string
  source_kind: string
  task_id?: number | null
  task_code?: string | null
  import_job_id?: number | null
  scene_id: number
  scene_name?: string | null
  dataset_id: number
  dataset_name?: string | null
  episode_count: number
  size_bytes: number
  stage: number
  stage_name?: string | null
  stage_kind?: string | null
  state: PipelineBatchState
  state_label: string
  progress: number
  failed_count: number
  error_msg?: string | null
  retry_times: number
  created_at?: string | null
  updated_at?: string | null
  finished_at?: string | null
}

export interface StageCountOut {
  stage: number
  name: string
  kind: string
  done: number
  running: number
  waiting: number
  failed: number
}

export interface JobBriefOut {
  id: number
  job_type: string
  stage?: number | null
  state: string
  attempt: number
  progress: number
  current_step?: string | null
  node_id?: string | null
  error_msg?: string | null
  placeholder: boolean
  created_at?: string | null
  finished_at?: string | null
}

export interface BatchEpisodeOut {
  id: number
  file_name: string
  duration_ms: number
  size_bytes: number
  recorded_at?: string | null
  stage?: number | null
  stage_name?: string | null
  state?: string | null
  state_label: string
  error?: string | null
  is_releasable: boolean
  last_job?: JobBriefOut | null
}

export interface PipelineBatchDetail extends PipelineBatchItem {
  stages: StageCountOut[]
  episodes: BatchEpisodeOut[]
  failed_episodes: BatchEpisodeOut[]
}

export interface BatchLogOut {
  time?: string | null
  level: string
  episode_id?: number | null
  file_name?: string | null
  job_id?: number | null
  job_type?: string | null
  stage?: number | null
  message: string
}

export interface BatchLogsOut {
  total: number
  items: BatchLogOut[]
}

export interface RetryOut {
  batch_count: number
  episode_count: number
}

export interface PipelineBatchListParams {
  stage?: number
  state?: string
  keyword?: string
  scene_id?: number
  dataset_id?: number
  page?: number
  size?: number
  sort?: string
}

export interface PipelineBatchPage {
  items: PipelineBatchItem[]
  total: number
  page: number
  size: number
  pages: number
}

export const pipelineApi = {
  overview: () => api.get<PipelineOverview>('/pipeline/overview'),
  listBatches: (params?: PipelineBatchListParams) =>
    api.get<PipelineBatchPage>('/pipeline/batches', params),
  getBatch: (batchId: number) =>
    api.get<PipelineBatchDetail>(`/pipeline/batches/${batchId}`),
  getBatchLogs: (batchId: number) =>
    api.get<BatchLogsOut>(`/pipeline/batches/${batchId}/logs`),
  retryBatch: (batchId: number) =>
    api.post<PipelineBatchDetail>(`/pipeline/batches/${batchId}/retry`),
  retryAllFailed: () =>
    api.post<RetryOut>('/pipeline/batches/retry-failed'),
  retryEpisode: (episodeId: number) =>
    api.post<BatchEpisodeOut>(`/pipeline/episodes/${episodeId}/retry`),
}
