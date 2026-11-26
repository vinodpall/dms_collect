import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ScenKey } from '@/constants'
import {
  annotationApi,
  reviewApi,
  getToken,
  type AnnotationHistoryOut,
  type AnnotationItemDetailOut,
  type AnnotationItemOut,
  type AnnotationPriority,
  type AnnotationStatus,
  type AnnotationSummaryOut,
  type CheckReportOut,
  type EpisodePreview,
  type IssueOut,
  type ReviewRecordOut,
  type ReviewSummaryOut,
  type RevisionOut,
  type SegmentIn,
  type SegmentOut,
} from '@/api'
import { useDict } from './dict'

export type ClipStatus = AnnotationStatus
export type Prio = AnnotationPriority

export interface Seg {
  /** 前端渲染与选中用唯一 ID（后端已落库则与 serverId 相同） */
  id: number
  /** 后端切片 ID；新切或预切分未落库时为 null */
  serverId?: number | null
  /** 字典词条 ID */
  dictItemId: number
  /** 起止时间（秒） */
  s: number
  e: number
  /** 子任务名称 */
  n: string
  semantic?: string | null
  success?: boolean | null
  failureReason?: string | null
  flag?: string
  source?: string
}

export interface Clip {
  numericId: number
  id: string
  episodeId: number
  file: string
  sceneId: number
  scen: ScenKey
  sceneName: string
  dur: number
  durationMs: number
  batchId: number
  batch: string
  status: ClipStatus
  statusLabel: string
  inPool: boolean
  ownerId?: number | null
  owner?: string
  reviewerId?: number | null
  reviewer?: string
  prio: Prio
  hasWarning: boolean
  segmentCount: number
  checkScore?: number | null
  coverage?: number | null
  dueAt?: string | null
  overdue: boolean
  rejectReason?: string | null
  rejectCount: number
  submitNote?: string | null
  sampled?: boolean | null
  version: number
  editable: boolean
  reviewable: boolean
  decision?: string | null
  decisionLabel?: string | null
  decidedAt?: string | null
  segs: Seg[]
  preview: EpisodePreview | null
  checkReport: CheckReportOut | null
  issues: IssueOut[]
  reviews: ReviewRecordOut[]
  revisions: RevisionOut[]
  detailLoaded: boolean
}

export const SUB_COLORS = ['#2F6FD1', '#2C8F7B', '#B86E1A', '#8A5CC9', '#C2476B', '#4A8FB8', '#D97706', '#059669', '#7C3AED', '#DB2777']

function dictNames(scen?: ScenKey) {
  try {
    return useDict().actionsFor(scen).map((x) => x.name)
  } catch {
    return []
  }
}

export const SUB_NAMES = new Proxy({} as Record<ScenKey, string[]>, {
  get(_t, prop) {
    return dictNames(typeof prop === 'string' ? (prop as ScenKey) : undefined)
  },
})

function hashStr(s = '') {
  const str = String(s || '')
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

export const colorOf = (_scen: unknown, name = '') => {
  const key = String(name || '')
  let idx = dictNames().indexOf(key)
  if (idx < 0) idx = hashStr(key)
  return SUB_COLORS[idx % SUB_COLORS.length]
}

export const CLIP_ST: Record<ClipStatus, [string, string]> = {
  todo: ['warn', '待标注'],
  rejected: ['crit', '已驳回'],
  submitted: ['info', '待审核'],
  approved: ['good', '已通过'],
}

let segUid = -1
export const newSegId = () => segUid--

export function mapSegmentOut(s: SegmentOut): Seg {
  return {
    id: s.id != null ? s.id : newSegId(),
    serverId: s.id ?? null,
    dictItemId: s.dict_item_id,
    s: +(s.start_ms / 1000).toFixed(2),
    e: +(s.end_ms / 1000).toFixed(2),
    n: s.label_name,
    semantic: s.semantic ?? null,
    success: s.success ?? null,
    failureReason: s.failure_reason ?? null,
    flag: s.flag || undefined,
    source: s.source,
  }
}

export function mapItemToClip(item: AnnotationItemOut & Partial<AnnotationItemDetailOut>, existing?: Clip): Clip {
  const durationMs = item.preview?.duration_ms ?? item.duration_ms ?? existing?.durationMs ?? 0
  const dur = durationMs > 0 ? +(durationMs / 1000).toFixed(2) : (existing?.dur ?? 0)
  const hasDetail = Array.isArray(item.segments)
  return {
    numericId: item.id,
    id: item.code || `C-${item.id}`,
    episodeId: item.episode_id,
    file: item.file_name || item.code || `episode_${item.episode_id}`,
    sceneId: item.scene_id,
    scen: (item.scene_key as ScenKey) || existing?.scen || '',
    sceneName: item.scene_name || existing?.sceneName || '',
    dur,
    durationMs,
    batchId: item.batch_id,
    batch: item.batch_code || (item.batch_id ? `B-${item.batch_id}` : ''),
    status: item.status,
    statusLabel: item.status_label || CLIP_ST[item.status]?.[1] || item.status,
    inPool: !!item.in_pool,
    ownerId: item.owner_id ?? null,
    owner: item.owner_name || undefined,
    reviewerId: item.reviewer_id ?? null,
    reviewer: item.reviewer_name || undefined,
    prio: item.priority || 'normal',
    hasWarning: !!item.has_warning,
    segmentCount: item.segment_count ?? (hasDetail ? item.segments!.length : existing?.segmentCount ?? 0),
    checkScore: item.check_score ?? null,
    coverage: item.coverage ?? null,
    dueAt: item.due_at ?? null,
    overdue: !!item.overdue,
    rejectReason: item.reject_reason ?? null,
    rejectCount: item.reject_count ?? 0,
    submitNote: item.submit_note ?? existing?.submitNote ?? null,
    sampled: item.sampled ?? null,
    version: item.version ?? 0,
    editable: item.editable !== undefined ? !!item.editable : (existing?.editable ?? false),
    reviewable: item.reviewable !== undefined ? !!item.reviewable : (existing?.reviewable ?? false),
    decision: (item as any).decision ?? existing?.decision ?? null,
    decisionLabel: (item as any).decision_label ?? existing?.decisionLabel ?? null,
    decidedAt: (item as any).decided_at ?? existing?.decidedAt ?? null,
    segs: hasDetail ? item.segments!.map(mapSegmentOut) : (existing?.segs ?? []),
    preview: item.preview !== undefined ? (item.preview ?? null) : (existing?.preview ?? null),
    checkReport: item.check_report !== undefined ? (item.check_report ?? null) : (existing?.checkReport ?? null),
    issues: Array.isArray(item.issues) ? item.issues : (existing?.issues ?? []),
    reviews: Array.isArray(item.reviews) ? item.reviews : (existing?.reviews ?? []),
    revisions: Array.isArray(item.revisions) ? item.revisions : (existing?.revisions ?? []),
    detailLoaded: hasDetail || (existing?.detailLoaded ?? false),
  }
}

export const useAnnotate = defineStore('annotate', () => {
  const dict = useDict()

  const summary = ref<AnnotationSummaryOut | null>(null)
  const reviewSummary = ref<ReviewSummaryOut | null>(null)
  const clips = ref<Clip[]>([])
  const total = ref(0)
  const history = ref<AnnotationHistoryOut[]>([])
  const historyTotal = ref(0)
  const loadingList = ref(false)
  const loadingDetail = ref(false)
  const loadingHistory = ref(false)

  const curId = ref<number | null>(null)
  const filter = ref<string>('todo')

  const subNames = computed(() => dictNames())
  const namesFor = (scen?: ScenKey) => dictNames(scen)

  const byNumericId = (id: number | null) => (id === null ? undefined : clips.value.find((c) => c.numericId === id))
  const byId = (id: string) => clips.value.find((c) => c.id === id || String(c.numericId) === id)

  const labelTodo = () => summary.value?.mine_pending ?? 0
  const reviewTodo = () => (reviewSummary.value ? reviewSummary.value.pool + reviewSummary.value.mine : 0)
  const todoCount = () => labelTodo() + reviewTodo()

  // 撤销历史栈（按条目 numericId）
  const undoHistory = ref<Record<number, Seg[][]>>({})

  function pushHistory(numericId: number, currentSegs: Seg[]) {
    if (!undoHistory.value[numericId]) undoHistory.value[numericId] = []
    undoHistory.value[numericId].push(JSON.parse(JSON.stringify(currentSegs)))
    if (undoHistory.value[numericId].length > 25) undoHistory.value[numericId].shift()
  }

  function popHistory(numericId: number): Seg[] | null {
    if (!undoHistory.value[numericId] || !undoHistory.value[numericId].length) return null
    return undoHistory.value[numericId].pop() ?? null
  }

  function canUndo(numericId: number) {
    return !!(undoHistory.value[numericId] && undoHistory.value[numericId].length > 0)
  }

  function clearHistory(numericId: number) {
    delete undoHistory.value[numericId]
  }

  function resolveDictItemId(name: string, fallbackId?: number, scen?: ScenKey): number {
    const actions = dict.actionsFor(scen)
    const exact = actions.find((x) => x.name === name) ?? dict.byName(name)
    if (exact?.numericId) return exact.numericId
    if (fallbackId && fallbackId > 0) return fallbackId
    return actions[0]?.numericId ?? dict.items[0]?.numericId ?? 0
  }

  function segsToPayload(segs: Seg[], scen?: ScenKey): SegmentIn[] {
    const validSources = new Set(['manual', 'presplit_seq', 'presplit_force', 'ai'])
    return segs
      .slice()
      .sort((a, b) => a.s - b.s)
      .map((s) => {
        const payload: SegmentIn = {
          start_ms: Math.max(0, Math.round(s.s * 1000)),
          end_ms: Math.max(0, Math.round(s.e * 1000)),
          dict_item_id: resolveDictItemId(s.n, s.dictItemId, scen),
        }
        if (s.serverId && s.serverId > 0) payload.id = s.serverId
        if (s.semantic) payload.semantic = s.semantic
        if (s.success !== undefined && s.success !== null) payload.success = s.success
        if (s.failureReason) payload.failure_reason = s.failureReason
        if (s.source && validSources.has(s.source)) payload.source = s.source as SegmentIn['source']
        return payload
      })
  }

  async function fetchSummary() {
    if (!getToken()) return null
    try {
      const data = await annotationApi.summary()
      summary.value = data
      return data
    } catch (err) {
      console.warn('[annotate] 获取标注概况失败', err)
      return null
    }
  }

  async function fetchReviewBadge() {
    if (!getToken()) return null
    try {
      const data = await reviewApi.summary()
      reviewSummary.value = data
      return data
    } catch {
      return null
    }
  }

  async function fetchItems(params?: {
    view?: 'pool' | 'mine' | 'all'
    status?: AnnotationStatus
    scene_id?: number
    batch_id?: number
    priority?: AnnotationPriority
    keyword?: string
    page?: number
    size?: number
    sort?: string
  }): Promise<Clip[]> {
    if (!getToken()) return []
    loadingList.value = true
    try {
      const res = await annotationApi.listItems({ page: 1, size: 100, ...params })
      const prevMap = new Map(clips.value.map((c) => [c.numericId, c]))
      const mapped = (res?.items || []).map((it) => mapItemToClip(it, prevMap.get(it.id)))
      clips.value = mapped
      total.value = res?.total ?? mapped.length
      return mapped
    } finally {
      loadingList.value = false
    }
  }

  async function fetchDetail(numericId: number): Promise<Clip | null> {
    if (!getToken()) return null
    loadingDetail.value = true
    try {
      const detail = await annotationApi.getItem(numericId)
      const existing = byNumericId(numericId)
      const mapped = mapItemToClip(detail, existing)
      const idx = clips.value.findIndex((c) => c.numericId === numericId)
      if (idx >= 0) clips.value[idx] = mapped
      else clips.value.unshift(mapped)
      return mapped
    } finally {
      loadingDetail.value = false
    }
  }

  async function claim(data: { count?: number; scene_id?: number; ids?: number[] }) {
    const res = await annotationApi.claim(data)
    await fetchSummary()
    return res
  }

  async function assign(data: { ids: number[]; user_id: number; priority?: AnnotationPriority | null }) {
    const res = await annotationApi.assign(data)
    await fetchSummary()
    return res
  }

  async function release(numericId: number) {
    const res = await annotationApi.release(numericId)
    await fetchSummary()
    return res
  }

  async function saveSegments(c: Clip) {
    const payload = segsToPayload(c.segs, c.scen)
    const res = await annotationApi.saveSegments(c.numericId, {
      version: c.version,
      segments: payload,
    })
    c.version = res.version
    c.segs = (res.segments || []).map(mapSegmentOut)
    c.segmentCount = res.segment_count
    c.checkScore = res.check_score ?? null
    c.coverage = res.coverage ?? null
    c.checkReport = res.check_report ?? null
    return res
  }

  async function presplit(c: Clip, strategy: 'seq' | 'force') {
    const res = await annotationApi.presplit(c.numericId, strategy)
    c.segs = (res.segments || []).map(mapSegmentOut)
    return res
  }

  async function check(c: Clip) {
    const payload = segsToPayload(c.segs, c.scen)
    const report = await annotationApi.check(c.numericId, payload)
    c.checkReport = report
    return report
  }

  async function submit(c: Clip, note: string, ignoreWarnings: boolean) {
    const payload = segsToPayload(c.segs, c.scen)
    const res = await annotationApi.submit(c.numericId, {
      version: c.version,
      segments: payload,
      note: note || null,
      ignore_warnings: ignoreWarnings,
    })
    clearHistory(c.numericId)
    await Promise.allSettled([fetchSummary(), fetchReviewBadge()])
    return res
  }

  async function withdraw(numericId: number) {
    const res = await annotationApi.withdraw(numericId)
    await Promise.allSettled([fetchSummary(), fetchReviewBadge()])
    return res
  }

  async function refreshUrls(numericId: number) {
    const preview = await annotationApi.refreshUrls(numericId)
    const target = byNumericId(numericId)
    if (target) {
      target.preview = preview
      if (preview.duration_ms > 0) {
        target.durationMs = preview.duration_ms
        target.dur = +(preview.duration_ms / 1000).toFixed(2)
      }
    }
    return preview
  }

  async function fetchHistory(params?: { status?: AnnotationStatus; page?: number; size?: number }) {
    if (!getToken()) return []
    loadingHistory.value = true
    try {
      const res = await annotationApi.history({ page: 1, size: 50, ...params })
      history.value = res?.items || []
      historyTotal.value = res?.total ?? history.value.length
      return history.value
    } finally {
      loadingHistory.value = false
    }
  }

  /** 兼容尚未对接后端的 tasks store 调用 */
  function ingest(_scen: ScenKey, _batch: string, _count: number) {
    /* 已由后端流水线自动入池 */
  }

  function reset() {
    summary.value = null
    reviewSummary.value = null
    clips.value = []
    total.value = 0
    history.value = []
    historyTotal.value = 0
    curId.value = null
    undoHistory.value = {}
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('dms:login', () => {
      fetchSummary()
      fetchReviewBadge()
    })
    window.addEventListener('dms:logout', reset)
  }

  if (getToken()) {
    fetchSummary()
    fetchReviewBadge()
  }

  return {
    summary,
    reviewSummary,
    clips,
    total,
    history,
    historyTotal,
    loadingList,
    loadingDetail,
    loadingHistory,
    curId,
    filter,
    subNames,
    namesFor,
    byNumericId,
    byId,
    labelTodo,
    reviewTodo,
    todoCount,
    pushHistory,
    popHistory,
    canUndo,
    clearHistory,
    resolveDictItemId,
    segsToPayload,
    fetchSummary,
    fetchReviewBadge,
    fetchItems,
    fetchDetail,
    claim,
    assign,
    release,
    saveSegments,
    presplit,
    check,
    submit,
    withdraw,
    refreshUrls,
    fetchHistory,
    ingest,
    reset,
  }
})
