import { api } from './client'
import type { EpisodePreview } from './episodes'

export type AnnotationStatus = 'todo' | 'submitted' | 'rejected' | 'approved'
export type AnnotationPriority = 'urgent' | 'normal'

export interface StatusCountOut {
  todo: number
  rejected: number
  submitted: number
  approved: number
}

export interface AnnotationSummaryOut {
  pool: number
  pool_urgent: number
  mine: StatusCountOut
  mine_pending: number
  mine_expiring: number
  today_submitted: number
  total?: StatusCountOut | null
}

export interface AnnotationItemOut {
  id: number
  code: string
  episode_id: number
  file_name?: string | null
  duration_ms: number
  thumb_url?: string | null
  source?: string | null
  scene_id: number
  scene_name?: string | null
  batch_id: number
  batch_code?: string | null
  status: AnnotationStatus
  status_label: string
  in_pool: boolean
  owner_id?: number | null
  owner_name?: string | null
  priority: AnnotationPriority
  has_warning: boolean
  segment_count: number
  check_score?: number | null
  coverage?: number | null
  claimed_at?: string | null
  claim_expires_at?: string | null
  draft_saved_at?: string | null
  submitted_at?: string | null
  sampled?: boolean | null
  due_at?: string | null
  overdue: boolean
  reviewer_id?: number | null
  reviewer_name?: string | null
  review_claimed_at?: string | null
  reject_reason?: string | null
  reject_count: number
  approved_at?: string | null
  version: number
  created_at?: string | null
  updated_at?: string | null
}

export interface AnnotationHistoryOut extends AnnotationItemOut {
  my_submitted_at?: string | null
  submit_times: number
  last_decision?: string | null
  last_decision_label?: string | null
  last_decided_at?: string | null
}

export interface SegmentIn {
  id?: number | null
  start_ms: number
  end_ms: number
  dict_item_id: number
  semantic?: string | null
  success?: boolean | null
  failure_reason?: string | null
  source?: 'manual' | 'presplit_seq' | 'presplit_force' | 'ai' | null
}

export interface SegmentOut {
  id?: number | null
  seq: number
  start_ms: number
  end_ms: number
  dict_item_id: number
  label_name: string
  semantic?: string | null
  success?: boolean | null
  failure_reason?: string | null
  flag?: string | null
  source: string
}

export interface CheckIssueOut {
  rule: string
  severity: 'block' | 'warn' | 'info'
  message: string
  index?: number | null
  start_ms?: number | null
  end_ms?: number | null
}

export interface CheckReportOut {
  score: number
  coverage?: number | null
  duration_ms: number
  labeled_ms: number
  segment_count: number
  block_count: number
  warn_count: number
  info_count: number
  can_submit: boolean
  issues: CheckIssueOut[]
  dict_version?: string | null
  checked_at?: string | null
}

export interface IssueOut {
  id: number
  review_id?: number | null
  open: boolean
  segment_id?: number | null
  segment?: { start_ms?: number; end_ms?: number; label_name?: string } | null
  at_ms?: number | null
  issue_type: 'boundary' | 'wrong_label' | 'missing' | 'redundant' | 'order' | 'other'
  issue_type_label: string
  severity: 'fatal' | 'normal' | 'suggest'
  severity_label: string
  description: string
  created_by: number
  created_by_name?: string | null
  created_at?: string | null
}

export interface ReviewRecordOut {
  id: number
  decision: 'approve' | 'approve_modified' | 'reject' | 'redo'
  decision_label: string
  reasons?: string[]
  comment?: string | null
  modifications?: string[]
  dim_scores?: Record<string, number> | null
  total_score?: number | null
  duration_s?: number | null
  reviewer_id: number
  reviewer_name?: string | null
  annotator_id: number
  annotator_name?: string | null
  created_at?: string | null
}

export interface RevisionOut {
  rev_no: number
  action: string
  action_label: string
  operator_id: number
  operator_name?: string | null
  created_at?: string | null
  segments: Array<{ s: number; e: number; label: string; dict_item_id: number }>
}

export interface AnnotationItemDetailOut extends AnnotationItemOut {
  scene_key?: string | null
  editable: boolean
  reviewable: boolean
  submit_note?: string | null
  dict_version?: string | null
  episode?: Record<string, any> | null
  preview?: EpisodePreview | null
  segments: SegmentOut[]
  check_report?: CheckReportOut | null
  issues: IssueOut[]
  reviews: ReviewRecordOut[]
  revisions: RevisionOut[]
  markers?: Array<Record<string, any>>
}

export interface ClaimOut {
  claimed: AnnotationItemOut[]
  skipped_ids?: number[]
}

export interface DraftOut {
  version: number
  draft_saved_at?: string | null
  segment_count: number
  check_score?: number | null
  coverage?: number | null
  segments: SegmentOut[]
  check_report: CheckReportOut
}

export interface PresplitOut {
  strategy: string
  note?: string | null
  segments: SegmentOut[]
}

export interface AnnotationPage<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

export const annotationApi = {
  summary: () => api.get<AnnotationSummaryOut>('/annotation/summary'),
  listItems: (params?: {
    view?: 'pool' | 'mine' | 'all'
    status?: AnnotationStatus
    scene_id?: number
    batch_id?: number
    priority?: AnnotationPriority
    keyword?: string
    page?: number
    size?: number
    sort?: string
  }) => api.get<AnnotationPage<AnnotationItemOut>>('/annotation/items', params),
  getItem: (itemId: number) => api.get<AnnotationItemDetailOut>(`/annotation/items/${itemId}`),
  claim: (data: { count?: number; scene_id?: number; ids?: number[] }) =>
    api.post<ClaimOut>('/annotation/items/claim', data),
  assign: (data: { ids: number[]; user_id: number; priority?: AnnotationPriority | null }) =>
    api.post<AnnotationItemOut[]>('/annotation/items/assign', data),
  release: (itemId: number) => api.post<AnnotationItemOut>(`/annotation/items/${itemId}/release`),
  saveSegments: (itemId: number, data: { version: number; segments: SegmentIn[] }) =>
    api.put<DraftOut>(`/annotation/items/${itemId}/segments`, data),
  presplit: (itemId: number, strategy: 'seq' | 'force') =>
    api.post<PresplitOut>(`/annotation/items/${itemId}/presplit`, { strategy }),
  check: (itemId: number, segments?: SegmentIn[] | null) =>
    api.post<CheckReportOut>(`/annotation/items/${itemId}/check`, segments ? { segments } : {}),
  submit: (
    itemId: number,
    data: { version: number; segments?: SegmentIn[] | null; note?: string | null; ignore_warnings?: boolean }
  ) => api.post<AnnotationItemOut>(`/annotation/items/${itemId}/submit`, data),
  withdraw: (itemId: number) => api.post<AnnotationItemOut>(`/annotation/items/${itemId}/withdraw`),
  refreshUrls: (itemId: number) => api.post<EpisodePreview>(`/annotation/items/${itemId}/refresh-urls`),
  history: (params?: { status?: AnnotationStatus; page?: number; size?: number; sort?: string }) =>
    api.get<AnnotationPage<AnnotationHistoryOut>>('/annotation/history', params),
}
