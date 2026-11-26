import { api } from './client'
import type {
  AnnotationItemDetailOut,
  AnnotationItemOut,
  AnnotationPage,
  AnnotationPriority,
  ClaimOut,
  IssueOut,
  SegmentIn,
} from './annotation'

export type ReviewDecision = 'approve' | 'approve_modified' | 'reject' | 'redo'
export type ReviewIssueType = 'boundary' | 'wrong_label' | 'missing' | 'redundant' | 'order' | 'other'
export type ReviewIssueSeverity = 'fatal' | 'normal' | 'suggest'

export interface ReviewSummaryOut {
  pool: number
  pool_urgent: number
  pool_overdue: number
  mine: number
  mine_overdue: number
  done_today: number
  done_total: number
  sample_ratio: number
}

export interface ReviewItemOut extends AnnotationItemOut {
  decision?: ReviewDecision | null
  decision_label?: string | null
  decided_at?: string | null
}

export interface DecideIn {
  version: number
  decision: ReviewDecision
  segments?: SegmentIn[] | null
  reasons?: ReviewIssueType[] | null
  comment?: string | null
  dim_scores?: Record<string, number> | null
}

export interface IssueIn {
  segment_id?: number | null
  at_ms?: number | null
  issue_type: ReviewIssueType
  severity: ReviewIssueSeverity
  description: string
}

export interface CountOut {
  key: string
  label: string
  count: number
}

export interface AnnotatorStatOut {
  user_id: number
  name?: string | null
  reviewed: number
  passed: number
  modified: number
  rejected: number
  pass_rate?: number | null
  avg_score?: number | null
}

export interface ReviewerStatOut {
  user_id: number
  name?: string | null
  reviewed: number
  avg_duration_s?: number | null
}

export interface ReviewStatsOut {
  range: 'today' | '7d' | '30d'
  start_at?: string | null
  end_at?: string | null
  today_count: number
  total: number
  pass_rate?: number | null
  reject_rate?: number | null
  modified_rate?: number | null
  exempt_count: number
  avg_duration_s?: number | null
  decisions: CountOut[]
  reasons: CountOut[]
  annotators: AnnotatorStatOut[]
  reviewers: ReviewerStatOut[]
}

export const reviewApi = {
  summary: () => api.get<ReviewSummaryOut>('/review/summary'),
  listItems: (params?: {
    view?: 'pool' | 'mine' | 'done'
    scene_id?: number
    batch_id?: number
    priority?: AnnotationPriority
    annotator_id?: number
    keyword?: string
    page?: number
    size?: number
    sort?: string
  }) => api.get<AnnotationPage<ReviewItemOut>>('/review/items', params),
  getItem: (itemId: number) => api.get<AnnotationItemDetailOut>(`/review/items/${itemId}`),
  claim: (data: { count?: number; ids?: number[] }) =>
    api.post<ClaimOut>('/review/items/claim', data),
  release: (itemId: number) => api.post<AnnotationItemOut>(`/review/items/${itemId}/release`),
  decide: (itemId: number, data: DecideIn) =>
    api.post<AnnotationItemOut>(`/review/items/${itemId}/decide`, data),
  addIssue: (itemId: number, data: IssueIn) =>
    api.post<IssueOut>(`/review/items/${itemId}/issues`, data),
  deleteIssue: (itemId: number, issueId: number) =>
    api.del<null>(`/review/items/${itemId}/issues/${issueId}`),
  getSampleRatio: () => api.get<{ sample_ratio: number }>('/review/settings/sample-ratio'),
  setSampleRatio: (sample_ratio: number) =>
    api.put<{ sample_ratio: number }>('/review/settings/sample-ratio', { sample_ratio }),
  stats: (range: 'today' | '7d' | '30d' = 'today') =>
    api.get<ReviewStatsOut>('/review/stats', { range }),
}
