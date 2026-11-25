import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { STAGES } from '@/constants'
import {
  pipelineApi,
  getToken,
  type BatchEpisodeOut,
  type BatchLogOut,
  type BatchLogsOut,
  type PipelineBatchDetail,
  type PipelineBatchItem,
  type PipelineBatchListParams,
  type PipelineBatchState,
  type PipelineOverview,
  type RetryOut,
} from '@/api'

export type BatchState = PipelineBatchState

export interface Batch {
  numericId: number
  id: string
  sourceKind: string
  task: string
  sceneId: number
  sceneName: string
  datasetId: number
  datasetName: string
  count: number
  stage: number
  stageName: string
  stageKind: string
  state: BatchState
  stateLabel: string
  pct: number
  sizeBytes: number
  sizeText: string
  failedCount: number
  errorMsg: string
  retryTimes: number
  createdAt: string
  updatedAt: string
  finishedAt: string
}

export interface LogLine {
  t: string
  lv?: 'WARN' | 'ERROR'
  fileName?: string
  msg: string
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let idx = 0
  let v = bytes
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024
    idx++
  }
  return `${idx === 0 ? Math.round(v) : v.toFixed(v >= 100 ? 0 : 1)} ${units[idx]}`
}

function fmtTime(iso?: string | null): string {
  if (!iso) return ''
  return iso.replace('T', ' ').slice(0, 19)
}

function fmtLogTime(iso?: string | null): string {
  if (!iso) return '[--:--:--]'
  const s = iso.replace('T', ' ')
  const m = s.match(/(\d{2}:\d{2}:\d{2})/)
  return m ? `[${m[1]}]` : `[${s.slice(0, 19)}]`
}

function mapBatch(item: PipelineBatchItem): Batch {
  const stageIdx = Math.max(0, Math.min(STAGES.length - 1, Number(item.stage ?? 0)))
  const taskLabel =
    item.task_code ||
    (item.source_kind === 'import'
      ? item.import_job_id
        ? `导入 #${item.import_job_id}`
        : '手动导入'
      : item.task_id
        ? `任务 #${item.task_id}`
        : '-')
  return {
    numericId: item.id,
    id: item.code || `B-${item.id}`,
    sourceKind: item.source_kind || '',
    task: taskLabel,
    sceneId: item.scene_id,
    sceneName: item.scene_name || item.dataset_name || '未分配场景',
    datasetId: item.dataset_id,
    datasetName: item.dataset_name || '',
    count: item.episode_count ?? 0,
    stage: stageIdx,
    stageName: item.stage_name || STAGES[stageIdx] || '',
    stageKind: item.stage_kind || '',
    state: item.state,
    stateLabel: item.state_label || '',
    pct: Number(item.progress ?? 0),
    sizeBytes: Number(item.size_bytes ?? 0),
    sizeText: formatBytes(Number(item.size_bytes ?? 0)),
    failedCount: Number(item.failed_count ?? 0),
    errorMsg: item.error_msg || '',
    retryTimes: Number(item.retry_times ?? 0),
    createdAt: fmtTime(item.created_at),
    updatedAt: fmtTime(item.updated_at),
    finishedAt: fmtTime(item.finished_at),
  }
}

export function mapLogItem(item: BatchLogOut): LogLine {
  const lvRaw = (item.level || '').toLowerCase()
  const lv: LogLine['lv'] =
    lvRaw === 'error' || lvRaw === 'crit' ? 'ERROR' : lvRaw === 'warn' || lvRaw === 'warning' ? 'WARN' : undefined
  return {
    t: fmtLogTime(item.time),
    lv,
    fileName: item.file_name || undefined,
    msg: item.message || '',
  }
}

export const usePipeline = defineStore('pipeline', () => {
  const overview = ref<PipelineOverview | null>(null)
  const batches = ref<Batch[]>([])
  const total = ref(0)
  const loadingOverview = ref(false)
  const loadingBatches = ref(false)
  const loading = computed(() => loadingOverview.value || loadingBatches.value)

  function isFailedBatch(b: { state: BatchState }): boolean {
    return b.state === 'failed' || b.state === 'partial_failed'
  }

  const failedCount = () => {
    if (overview.value?.batches) {
      return (overview.value.batches.failed || 0) + (overview.value.batches.partial_failed || 0)
    }
    return batches.value.filter(isFailedBatch).length
  }

  const countAtStage = (i: number) => {
    const st = overview.value?.stages?.find((s) => s.stage === i)
    if (st) {
      if (i === STAGES.length - 1 && st.episode_count === 0 && st.done > 0) return st.done
      return st.episode_count
    }
    return batches.value.filter((b) => b.stage === i).reduce((a, b) => a + b.count, 0)
  }

  const stageFailed = (i: number) => {
    const st = overview.value?.stages?.find((s) => s.stage === i)
    if (st) return st.failed > 0
    return batches.value.some((b) => b.stage === i && isFailedBatch(b))
  }

  async function fetchOverview(): Promise<PipelineOverview | null> {
    if (!getToken()) return null
    loadingOverview.value = true
    try {
      const data = await pipelineApi.overview()
      overview.value = data
      return data
    } catch (err) {
      console.warn('[pipeline] 获取流水线总览失败', err)
      return null
    } finally {
      loadingOverview.value = false
    }
  }

  async function fetchBatches(params?: PipelineBatchListParams): Promise<Batch[]> {
    if (!getToken()) return []
    loadingBatches.value = true
    try {
      const res = await pipelineApi.listBatches({ page: 1, size: 100, sort: '-created_at', ...params })
      const items = (res?.items || []).map(mapBatch)
      batches.value = items
      total.value = res?.total ?? items.length
      return items
    } catch (err) {
      console.warn('[pipeline] 获取批次列表失败', err)
      return batches.value
    } finally {
      loadingBatches.value = false
    }
  }

  async function refreshAll(params?: PipelineBatchListParams): Promise<void> {
    await Promise.all([fetchOverview(), fetchBatches(params)])
  }

  async function fetchBatchDetail(numericId: number): Promise<PipelineBatchDetail | null> {
    if (!getToken()) return null
    const detail = await pipelineApi.getBatch(numericId)
    if (detail) {
      const mapped = mapBatch(detail)
      const idx = batches.value.findIndex((b) => b.numericId === numericId)
      if (idx >= 0) batches.value[idx] = mapped
    }
    return detail
  }

  async function fetchBatchLogs(numericId: number): Promise<BatchLogsOut | null> {
    if (!getToken()) return null
    return await pipelineApi.getBatchLogs(numericId)
  }

  async function retryBatch(numericId: number): Promise<PipelineBatchDetail> {
    const detail = await pipelineApi.retryBatch(numericId)
    const mapped = mapBatch(detail)
    const idx = batches.value.findIndex((b) => b.numericId === numericId)
    if (idx >= 0) batches.value[idx] = mapped
    await fetchOverview()
    return detail
  }

  async function retryAllFailed(): Promise<RetryOut> {
    const res = await pipelineApi.retryAllFailed()
    await refreshAll()
    return res
  }

  async function retryEpisode(episodeId: number, batchNumericId?: number): Promise<BatchEpisodeOut> {
    const ep = await pipelineApi.retryEpisode(episodeId)
    if (batchNumericId) {
      await Promise.all([fetchBatchDetail(batchNumericId), fetchOverview()])
    } else {
      await refreshAll()
    }
    return ep
  }

  /** 兼容未接入后端的 annotate store 调用 */
  function sync(_batchId: string, _c: { todo: number; submitted: number; rejected: number; approved: number; total: number }) {
    /* 流水线状态已由后端驱动 */
  }

  function reset() {
    overview.value = null
    batches.value = []
    total.value = 0
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('dms:login', () => {
      refreshAll().catch(() => {})
    })
    window.addEventListener('dms:logout', reset)
  }

  if (getToken()) {
    refreshAll().catch((e) => console.warn('[pipeline] 初始化流水线数据失败', e))
  }

  return {
    overview,
    batches,
    total,
    loading,
    loadingOverview,
    loadingBatches,
    isFailedBatch,
    failedCount,
    countAtStage,
    stageFailed,
    fetchOverview,
    fetchBatches,
    refreshAll,
    fetchBatchDetail,
    fetchBatchLogs,
    retryBatch,
    retryAllFailed,
    retryEpisode,
    sync,
    reset,
  }
})
