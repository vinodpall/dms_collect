import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  reviewApi,
  getToken,
  type DecideIn,
  type IssueIn,
  type IssueOut,
  type ReviewDecision,
  type ReviewIssueSeverity,
  type ReviewIssueType,
  type ReviewStatsOut,
  type ReviewSummaryOut,
} from '@/api'
import { mapItemToClip, useAnnotate, type Clip } from './annotate'

export type IssueSev = ReviewIssueSeverity
export const SEV: Record<IssueSev, [string, string]> = {
  fatal: ['crit', '致命'],
  normal: ['warn', '一般'],
  suggest: ['info', '建议'],
}

export type IssueKind = ReviewIssueType
export const ISSUE_KIND: Record<IssueKind, string> = {
  boundary: '边界不准',
  wrong_label: '子任务错误',
  missing: '遗漏子任务',
  redundant: '多余切片',
  order: '顺序错误',
  other: '其他',
}

export type Verdict = ReviewDecision
export const VERDICT: Record<Verdict, [string, string, string]> = {
  approve: ['good', '通过', '标注质量合格，直接进入后续格式转换'],
  approve_modified: ['info', '修改后通过', '审核员直接修正了切片后通过，无需返回标注员'],
  reject: ['warn', '驳回', '返回原标注员按意见修改'],
  redo: ['crit', '退回重做', '清空标注，放回任务池重新分配'],
}

export const REASON_OPTS: { value: IssueKind; label: string }[] = [
  { value: 'boundary', label: '子任务起止边界偏差' },
  { value: 'wrong_label', label: '子任务与实际动作不符' },
  { value: 'missing', label: '遗漏关键子任务' },
  { value: 'redundant', label: '存在多余或重复切片' },
  { value: 'order', label: '切片顺序与作业流程不符' },
  { value: 'other', label: '其他原因（需填写说明）' },
]

export const DIM_SCORE_DEFS: { key: string; label: string }[] = [
  { key: 'time', label: '时间边界' },
  { key: 'action', label: '动作识别' },
  { key: 'obj', label: '目标对象' },
  { key: 'semantic', label: '语义描述' },
  { key: 'outcome', label: '结果判断' },
  { key: 'consistency', label: '整体一致' },
]

export const useReview = defineStore('review', () => {
  const summary = ref<ReviewSummaryOut | null>(null)
  const items = ref<Clip[]>([])
  const total = ref(0)
  const sampleRate = ref(100)
  const stats = ref<ReviewStatsOut | null>(null)
  const statsRange = ref<'today' | '7d' | '30d'>('today')
  const loadingList = ref(false)
  const loadingDetail = ref(false)
  const loadingStats = ref(false)
  const curId = ref<number | null>(null)

  const byNumericId = (id: number | null) => (id === null ? undefined : items.value.find((c) => c.numericId === id))

  async function fetchSummary() {
    if (!getToken()) return null
    try {
      const data = await reviewApi.summary()
      summary.value = data
      sampleRate.value = data.sample_ratio
      useAnnotate().reviewSummary = data
      return data
    } catch (err) {
      console.warn('[review] 获取审核概况失败', err)
      return null
    }
  }

  async function fetchItems(params?: {
    view?: 'pool' | 'mine' | 'done'
    scene_id?: number
    batch_id?: number
    priority?: 'urgent' | 'normal'
    annotator_id?: number
    keyword?: string
    page?: number
    size?: number
    sort?: string
  }): Promise<Clip[]> {
    if (!getToken()) return []
    loadingList.value = true
    try {
      const res = await reviewApi.listItems({ page: 1, size: 100, ...params })
      const prevMap = new Map(items.value.map((c) => [c.numericId, c]))
      const mapped = (res?.items || []).map((it) => mapItemToClip(it, prevMap.get(it.id)))
      items.value = mapped
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
      const detail = await reviewApi.getItem(numericId)
      const existing = byNumericId(numericId)
      const mapped = mapItemToClip(detail, existing)
      const idx = items.value.findIndex((c) => c.numericId === numericId)
      if (idx >= 0) items.value[idx] = mapped
      else items.value.unshift(mapped)
      return mapped
    } finally {
      loadingDetail.value = false
    }
  }

  async function claim(data: { count?: number; ids?: number[] }) {
    const res = await reviewApi.claim(data)
    await fetchSummary()
    return res
  }

  async function release(numericId: number) {
    const res = await reviewApi.release(numericId)
    await fetchSummary()
    return res
  }

  async function addIssue(numericId: number, payload: IssueIn): Promise<IssueOut> {
    const iss = await reviewApi.addIssue(numericId, payload)
    await fetchDetail(numericId)
    return iss
  }

  async function removeIssue(numericId: number, issueId: number): Promise<void> {
    await reviewApi.deleteIssue(numericId, issueId)
    await fetchDetail(numericId)
  }

  async function decide(numericId: number, payload: DecideIn) {
    const res = await reviewApi.decide(numericId, payload)
    await Promise.allSettled([fetchSummary(), useAnnotate().fetchSummary()])
    return res
  }

  async function fetchSampleRatio() {
    if (!getToken()) return sampleRate.value
    const res = await reviewApi.getSampleRatio()
    sampleRate.value = res.sample_ratio
    return res.sample_ratio
  }

  async function updateSampleRatio(ratio: number) {
    const res = await reviewApi.setSampleRatio(ratio)
    sampleRate.value = res.sample_ratio
    if (summary.value) summary.value.sample_ratio = res.sample_ratio
    return res.sample_ratio
  }

  async function fetchStats(range: 'today' | '7d' | '30d' = statsRange.value) {
    if (!getToken()) return null
    statsRange.value = range
    loadingStats.value = true
    try {
      const data = await reviewApi.stats(range)
      stats.value = data
      return data
    } finally {
      loadingStats.value = false
    }
  }

  function reset() {
    summary.value = null
    items.value = []
    total.value = 0
    stats.value = null
    curId.value = null
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('dms:logout', reset)
  }

  return {
    summary,
    items,
    total,
    sampleRate,
    stats,
    statsRange,
    loadingList,
    loadingDetail,
    loadingStats,
    curId,
    byNumericId,
    fetchSummary,
    fetchItems,
    fetchDetail,
    claim,
    release,
    addIssue,
    removeIssue,
    decide,
    fetchSampleRatio,
    updateSampleRatio,
    fetchStats,
    reset,
  }
})
