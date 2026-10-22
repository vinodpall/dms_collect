import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type IssueSev = 'fatal' | 'warn' | 'info'
export const SEV: Record<IssueSev, [string, string]> = { fatal: ['crit', '致命'], warn: ['warn', '一般'], info: ['info', '建议'] }
export type IssueKind = 'boundary' | 'label' | 'missing' | 'redundant' | 'other'
export const ISSUE_KIND: Record<IssueKind, string> = { boundary: '边界不准', label: '子任务错误', missing: '遗漏子任务', redundant: '多余切片', other: '其他' }
export interface SegIssue { segId: number; kind: IssueKind; severity: IssueSev; desc: string }

export type Verdict = 'pass' | 'fixpass' | 'reject' | 'redo'
export const VERDICT: Record<Verdict, [string, string, string]> = {
  pass: ['good', '通过', '标注质量合格，直接入库'],
  fixpass: ['info', '修改后通过', '审核员直接修正了切片后通过，无需返回标注员'],
  reject: ['warn', '驳回', '返回原标注员按意见修改'],
  redo: ['crit', '退回重做', '清空标注，放回任务池重新分配'],
}
export const REJECT_TPL = ['子任务起止边界偏差超过 0.5s', '子任务与实际动作不符', '遗漏关键子任务', '存在多余或重复切片', '切片顺序与作业流程不符']

export interface ReviewRecord { clipId: string; annotator: string; reviewer: string; verdict: Verdict; reasons: string[]; t: string; today: boolean }

const seedRecords = (): ReviewRecord[] => {
  const ann = ['林悦', '王磊', '周工', '林悦', '刘洋', '林悦', '王磊', '刘洋']
  const vs: Verdict[] = ['pass', 'pass', 'fixpass', 'pass', 'reject', 'pass', 'reject', 'pass', 'redo', 'pass', 'fixpass', 'pass']
  return Array.from({ length: 36 }, (_, i) => {
    const v = vs[i % vs.length]
    const reasons = v === 'reject' ? [REJECT_TPL[i % 5]] : v === 'redo' ? [REJECT_TPL[2], REJECT_TPL[1]] : v === 'fixpass' ? [i % 2 ? '调整切片边界' : '修正子任务名称'] : []
    return { clipId: 'H' + (100 + i), annotator: ann[i % ann.length], reviewer: i % 3 ? '陈静' : '周工', verdict: v, reasons, t: i < 14 ? '今天' : '近 7 天', today: i < 14 }
  })
}

export const useReview = defineStore('review', () => {
  const clipIssues = ref<Record<string, SegIssue[]>>({})
  const records = ref<ReviewRecord[]>(seedRecords())

  /** 抽检比例：提交时按比例随机抽中人工审核，未抽中的免检通过；100% 即全检 */
  const sampleRate = ref(100)
  const rateOf = (_name?: string) => sampleRate.value
  const sampleFor = (_name?: string) => Math.random() * 100 < sampleRate.value

  const getIssues = (clipId: string): SegIssue[] => clipIssues.value[clipId] ?? []
  function addIssue(clipId: string, issue: SegIssue) {
    const l = (clipIssues.value[clipId] ??= [])
    const i = l.findIndex((x) => x.segId === issue.segId)
    if (i >= 0) l[i] = issue
    else l.push(issue)
  }
  function removeIssue(clipId: string, segId: number) {
    if (clipIssues.value[clipId]) clipIssues.value[clipId] = clipIssues.value[clipId].filter((x) => x.segId !== segId)
  }
  function record(r: Omit<ReviewRecord, 't' | 'today'>) { records.value.unshift({ ...r, t: '刚刚', today: true }) }

  /** 质量统计 */
  const stats = computed(() => {
    const rs = records.value, n = rs.length || 1
    const ok = rs.filter((r) => r.verdict === 'pass' || r.verdict === 'fixpass').length
    const reasons: Record<string, number> = {}
    rs.filter((r) => r.verdict === 'reject' || r.verdict === 'redo').forEach((r) => r.reasons.forEach((x) => (reasons[x] = (reasons[x] ?? 0) + 1)))
    const by = (v: Verdict) => rs.filter((r) => r.verdict === v).length
    return {
      today: rs.filter((r) => r.today).length, total: rs.length,
      passRate: Math.round((ok / n) * 100), rejectRate: Math.round(((by('reject') + by('redo')) / n) * 100),
      fixRate: Math.round((by('fixpass') / n) * 100),
      verdicts: (Object.keys(VERDICT) as Verdict[]).map((v) => ({ v, n: by(v) })),
      reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
    }
  })

  return { clipIssues, records, sampleRate, rateOf, sampleFor, getIssues, addIssue, removeIssue, record, stats }
})
