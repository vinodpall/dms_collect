import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { OPS, SCEN, TODAY, type ScenKey } from '@/constants'
import { rng } from '@/utils'
import { useSettings } from './settings'
import { usePipeline } from './pipeline'
import { useLogs } from './logs'
import { useDict } from './dict'
import { useSession } from './session'

/** 待标注 → 已提交（待审核）→ 已通过；审核打回后回到“被打回”，修改后可再次提交 */
export type ClipStatus = 'todo' | 'rejected' | 'submitted' | 'approved'
/**
 * 子任务切片：n 为子任务名称（来自字典），s/e 为起止时间；flag 为审核员标记的问题说明。
 */
export interface Seg {
  id: number; s: number; e: number; n: string; flag?: string
}
export type Prio = 'urgent' | 'normal'
export interface Clip {
  id: string; file: string; scen: ScenKey; dur: number; batch: string; status: ClipStatus; segs: Seg[]
  reject?: { reason: string; by: string; t: string }
  /** 领取人（标注员）；为空表示仍在任务池 */
  owner?: string
  /** 审核领取人 */
  reviewer?: string
  prio?: Prio
  /** 审核时限（剩余小时） */
  dueH?: number
  submitNote?: string
  /** 是否被抽中需人工审核；未抽中的直接按自检结果通过 */
  sampled?: boolean
}

/** 子任务候选来自统一字典（复合动作 + 异常动作） */
function dictNames(scen?: ScenKey) {
  try { return useDict().actionsFor(scen).map((x) => x.name) } catch { return [] }
}
/** 兼容旧代码按场景索引 SUB_NAMES[scen] 的访问方式 */
export const SUB_NAMES = new Proxy({} as Record<ScenKey, string[]>, {
  get(_t, prop) { return dictNames(prop === 'qmd' || prop === 'fhd' ? prop : undefined) },
})

export const SUB_COLORS = ['#2F6FD1', '#2C8F7B', '#B86E1A', '#8A5CC9', '#C2476B', '#4A8FB8', '#D97706', '#059669', '#7C3AED', '#DB2777']

function hashStr(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export const colorOf = (_scen: unknown, name: string) => {
  let idx = dictNames().indexOf(name)
  if (idx < 0) idx = hashStr(name)
  return SUB_COLORS[idx % SUB_COLORS.length]
}

export const CLIP_ST: Record<ClipStatus, [string, string]> = {
  todo: ['warn', '待标注'],
  rejected: ['crit', '被打回'],
  submitted: ['info', '待审核'],
  approved: ['good', '已通过'],
}

let segUid = 1
export const newSegId = () => segUid++

export interface SubtaskMeta {
  name: string
  desc: string
  required?: boolean
}

export interface ValidationIssue {
  id: string
  severity: 'fatal' | 'warn' | 'info'
  rule: string
  desc: string
  segId?: number
  segName?: string
  time?: number
}

export interface ValidationReport {
  passed: boolean
  hasFatal: boolean
  score: number
  coverage: number
  totalSegs: number
  validDuration: number
  issues: ValidationIssue[]
}

export const useAnnotate = defineStore('annotate', () => {
  const { nameFile } = useSettings()

  const dict = useDict()
  /** 子任务下拉（全部场景）；页面内按场景用 namesFor */
  const subNames = computed(() => dictNames())
  const namesFor = (scen: ScenKey) => dictNames(scen)

  // 撤销历史栈（按片段 ID）
  const undoHistory = ref<Record<string, Seg[][]>>({})

  function pushHistory(clipId: string, currentSegs: Seg[]) {
    if (!undoHistory.value[clipId]) undoHistory.value[clipId] = []
    undoHistory.value[clipId].push(JSON.parse(JSON.stringify(currentSegs)))
    if (undoHistory.value[clipId].length > 25) undoHistory.value[clipId].shift()
  }

  function popHistory(clipId: string): Seg[] | null {
    if (!undoHistory.value[clipId] || !undoHistory.value[clipId].length) return null
    return undoHistory.value[clipId].pop() ?? null
  }

  function canUndo(clipId: string) {
    return !!(undoHistory.value[clipId] && undoHistory.value[clipId].length > 0)
  }

  const me = () => useSession().info.user
  function mkSegs(i: number, scen: ScenKey, dur: number, parts: number): Seg[] {
    const r = rng(900 + i)
    const preset = dict.sequenceFor(scen)
    const cuts = [0]
    for (let k = 1; k < parts; k++) cuts.push(+((dur * k) / preset.length + (r() - 0.5)).toFixed(1))
    cuts.push(parts === preset.length ? dur : +((dur * parts) / preset.length).toFixed(1))
    return Array.from({ length: parts }, (_, k) => ({ id: newSegId(), s: cuts[k], e: cuts[k + 1], n: preset[k % preset.length] }))
  }

  function mk(i: number, scen: ScenKey, batch: string, status: ClipStatus, parts: number, extra: Partial<Clip> = {}): Clip {
    const r = rng(500 + i), dur = Math.round(14 + r() * 14)
    return { id: 'C' + (200 + i), file: nameFile(SCEN[scen].code, TODAY, 120 - i, OPS[i % 4].c), scen, dur, batch, status, segs: parts ? mkSegs(i, scen, dur, parts) : [], ...extra }
  }

  const ME = me()
  const clips = ref<Clip[]>([
    mk(0, 'qmd', 'B-1013-03', 'todo', 0),
    mk(1, 'qmd', 'B-1013-03', 'rejected', 5, { owner: ME }),
    mk(2, 'qmd', 'B-1013-03', 'todo', 2, { owner: ME }),
    mk(3, 'qmd', 'B-1013-03', 'submitted', 5, { owner: ME, prio: 'urgent', dueH: 3, sampled: true }),
    mk(4, 'qmd', 'B-1013-03', 'todo', 0),
    mk(5, 'fhd', 'B-1012-04', 'submitted', 4, { owner: '林悦', prio: 'normal', dueH: 20, sampled: true }),
    mk(6, 'fhd', 'B-1012-04', 'submitted', 4, { owner: '林悦', prio: 'urgent', dueH: 5, sampled: true, reviewer: ME }),
    mk(7, 'fhd', 'B-1012-04', 'approved', 4, { owner: ME }),
    mk(8, 'qmd', 'B-1013-03', 'todo', 0),
    mk(9, 'fhd', 'B-1012-04', 'todo', 0),
    mk(10, 'fhd', 'B-1012-04', 'todo', 0),
    mk(11, 'qmd', 'B-1013-03', 'submitted', 5, { owner: '王磊', prio: 'normal', dueH: 30, sampled: true }),
    mk(12, 'qmd', 'B-1013-03', 'approved', 5, { owner: '林悦' }),
  ])

  const c1 = clips.value[1]
  c1.reject = { reason: '“夹紧密封”结束时间偏早，应覆盖到开始充气前', by: '陈静', t: '今天 15:48' }
  c1.segs[1].flag = '结束时间偏早'

  const byId = (id: string) => clips.value.find((c) => c.id === id)
  const countOf = (st: ClipStatus | ClipStatus[]) => clips.value.filter((c) => (Array.isArray(st) ? st.includes(c.status) : c.status === st)).length
  /** 标注员待处理：待标注 + 被打回 */
  const labelTodo = () => countOf(['todo', 'rejected'])
  const reviewTodo = () => countOf('submitted')
  const todoCount = () => labelTodo() + reviewTodo()

  function syncBatch(batch: string) {
    const cs = clips.value.filter((c) => c.batch === batch)
    const n = (s: ClipStatus) => cs.filter((c) => c.status === s).length
    usePipeline().sync(batch, { todo: n('todo'), submitted: n('submitted'), rejected: n('rejected'), approved: n('approved'), total: cs.length })
  }

  const pool = computed(() => clips.value.filter((c) => c.status === 'todo' && !c.owner))
  const mine = (u = me()) => clips.value.filter((c) => c.owner === u)
  /** 从任务池领取：传 Clip 领取单条，传数字按顺序批量领取（1–10 条） */
  function claim(x: Clip | number, scen?: ScenKey) {
    const list = typeof x === 'number' ? pool.value.filter((c) => !scen || c.scen === scen).slice(0, Math.min(10, Math.max(1, x))) : [x]
    list.forEach((c) => (c.owner = me()))
    if (list.length) useLogs().addLog({ user: me(), role: '标注员', module: 'annotate', moduleName: '标注工作台', action: '领取任务', target: list.map((c) => c.id).join('、'), summary: '从任务池领取 ' + list.length + ' 条待标注数据' })
    return list
  }
  /** 放回任务池（保留已做的草稿） */
  function release(c: Clip) {
    if (c.status !== 'todo') return
    c.owner = undefined
  }

  /** 规则预切分：seq 按字典中该场景子任务标准顺序均分；force 模拟按夹爪力觉突变点切分 */
  function presplit(c: Clip, how: 'seq' | 'force' = 'seq') {
    const names = dict.sequenceFor(c.scen)
    if (!names.length) return 0
    const r = rng(Date.now() % 9973)
    const w = names.map(() => (how === 'force' ? 0.6 + r() * 0.8 : 1))
    const sum = w.reduce((a, b) => a + b, 0)
    let acc = 0.3
    const span = c.dur - 0.6
    c.segs = names.map((n, k) => {
      const s = +acc.toFixed(1)
      acc += (span * w[k]) / sum
      return { id: newSegId(), s, e: +(k === names.length - 1 ? c.dur - 0.3 : acc - 0.1).toFixed(1), n }
    })
    return c.segs.length
  }

  /** 入库完成的数据进入标注任务池 */
  function ingest(scen: ScenKey, batch: string, count: number) {
    const base = clips.value.length
    for (let k = 0; k < count; k++) {
      const i = base + k, r = rng(700 + i)
      clips.value.push({ id: 'C' + (200 + i), file: nameFile(SCEN[scen].code, TODAY, 60 - k, OPS[i % 4].c), scen, dur: Math.round(14 + r() * 14), batch, status: 'todo', segs: [] })
    }
  }

  function submit(c: Clip, note = '', sampled = true) {
    c.status = 'submitted'
    c.reject = undefined
    c.submitNote = note || undefined
    c.prio = c.prio ?? 'normal'
    c.dueH = c.prio === 'urgent' ? 4 : 24
    c.reviewer = undefined
    c.sampled = sampled
    c.segs.forEach((s) => (s.flag = undefined))
    /** 未被抽中的数据免检通过 */
    if (!sampled) c.status = 'approved'
    syncBatch(c.batch)
  }

  function approve(c: Clip) {
    c.status = 'approved'
    c.segs.forEach((s) => (s.flag = undefined))
    syncBatch(c.batch)
  }

  function reject(c: Clip, reason: string, by: string) {
    c.status = 'rejected'
    c.reject = { reason, by, t: '刚刚' }
    c.reviewer = undefined
    syncBatch(c.batch)
  }

  /** 退回重做：清空标注，放回任务池重新分配 */
  function redo(c: Clip, reason: string, by: string) {
    c.status = 'todo'
    c.segs = []
    c.owner = undefined
    c.reviewer = undefined
    c.reject = { reason: '退回重做：' + reason, by, t: '刚刚' }
    syncBatch(c.batch)
  }

  /** 审核领取：优先级加急在前，再按剩余时限 */
  const reviewPool = computed(() => clips.value.filter((c) => c.status === 'submitted' && !c.reviewer).sort((a, b) => (a.prio === 'urgent' ? 0 : 1) - (b.prio === 'urgent' ? 0 : 1) || (a.dueH ?? 99) - (b.dueH ?? 99)))
  function claimReview(x: Clip | number) {
    const list = typeof x === 'number' ? reviewPool.value.slice(0, Math.min(10, Math.max(1, x))) : [x]
    list.forEach((c) => (c.reviewer = me()))
    return list
  }

  /** 提交前数据质量自检引擎 */
  function validateClip(c: Clip): ValidationReport {
    const issues: ValidationIssue[] = []
    const segs = c.segs.slice().sort((a, b) => a.s - b.s)
    const totalSegs = segs.length

    // 1. 切片非空检查
    if (!totalSegs) {
      issues.push({
        id: 'iss-empty',
        severity: 'fatal',
        rule: '切片非空检测',
        desc: '当前视频尚未创建任何子任务切片，无法提交审核。请在时间轴上创建标注。',
      })
      return {
        passed: false,
        hasFatal: true,
        score: 0,
        coverage: 0,
        totalSegs: 0,
        validDuration: 0,
        issues,
      }
    }

    // 2. 切片时序与重叠检测
    for (let i = 0; i < segs.length; i++) {
      const cur = segs[i]
      if (cur.s >= cur.e) {
        issues.push({
          id: `iss-order-${cur.id}`,
          severity: 'fatal',
          rule: '时序起止异常',
          desc: `切片 [${cur.n}] 开始时间 (${cur.s.toFixed(1)}s) 大于或等于结束时间 (${cur.e.toFixed(1)}s)`,
          segId: cur.id,
          segName: cur.n,
          time: cur.s,
        })
      }
      if (i > 0) {
        const prev = segs[i - 1]
        if (prev.e > cur.s + 0.05) {
          issues.push({
            id: `iss-overlap-${prev.id}-${cur.id}`,
            severity: 'fatal',
            rule: '时间区间重叠',
            desc: `切片 [${prev.n}] (${prev.s.toFixed(1)}~${prev.e.toFixed(1)}s) 与 [${cur.n}] (${cur.s.toFixed(1)}~${cur.e.toFixed(1)}s) 存在重叠区间 (${(prev.e - cur.s).toFixed(1)}s)`,
            segId: cur.id,
            segName: cur.n,
            time: cur.s,
          })
        }
      }
    }

    // 3. 微小时长切片检测（疑似误触）
    for (const seg of segs) {
      const dur = seg.e - seg.s
      if (dur < 0.5) {
        issues.push({
          id: `iss-micro-${seg.id}`,
          severity: 'warn',
          rule: '微小切片疑似误触',
          desc: `切片 [${seg.n}] 时长仅 ${dur.toFixed(1)}s (< 0.5s)，极短动作通常为误触创建，建议检查或合并`,
          segId: seg.id,
          segName: seg.n,
          time: seg.s,
        })
      }
    }

    // 4. 覆盖率检测
    const validDuration = +segs.reduce((acc, s) => acc + Math.max(0, s.e - s.s), 0).toFixed(1)
    const coverage = Math.min(100, Math.round((validDuration / c.dur) * 100))

    if (coverage < 60) {
      issues.push({
        id: 'iss-cov-fatal',
        severity: 'fatal',
        rule: '总标注覆盖率过低',
        desc: `总覆盖率仅 ${coverage}%（有效标注时长 ${validDuration}s / 总时长 ${c.dur}s），低于系统最低提交阈值 60%`,
      })
    } else if (coverage < 85) {
      issues.push({
        id: 'iss-cov-warn',
        severity: 'warn',
        rule: '标注覆盖率偏低',
        desc: `总覆盖率为 ${coverage}%，存在较多未标注空白区域，建议核实是否遗漏了部分操作流程`,
      })
    }

    // 5. 核心关键子任务完整性检测
    const usedNames = new Set(segs.map((s) => s.n))
    const requiredList = dict.requiredFor(c.scen)
    requiredList.forEach((reqName) => {
      if (!usedNames.has(reqName)) {
        issues.push({
          id: `iss-req-${reqName}`,
          severity: 'warn',
          rule: '核心子任务缺失',
          desc: `当前场景关键步骤 [${reqName}] 尚未标注，请确认视频中是否包含此操作流程`,
          segName: reqName,
        })
      }
    })

    // 6. 异常时间空隙检测 (> 3.0s)
    for (let i = 0; i < segs.length - 1; i++) {
      const gap = segs[i + 1].s - segs[i].e
      if (gap > 3.0) {
        issues.push({
          id: `iss-gap-${segs[i].id}`,
          severity: 'info',
          rule: '中间存在较长空白',
          desc: `切片 [${segs[i].n}] 与 [${segs[i + 1].n}] 之间存在 ${gap.toFixed(1)}s 未标注空白空隙`,
          time: segs[i].e,
        })
      }
    }

    // 7. 子任务标签必须在当前字典中
    if (totalSegs < 3) issues.push({ id: 'iss-few', severity: 'warn', rule: '子任务区间过少', desc: `仅 ${totalSegs} 个子任务区间，完整作业通常不少于 3 个` })
    for (const seg of segs) {
      const at = { segId: seg.id, segName: seg.n, time: seg.s }
      if (!dict.isValid(seg.n)) issues.push({ id: `iss-dict-${seg.id}`, severity: 'fatal', rule: '标签不在字典中', desc: `[${seg.n}] 不在当前字典 ${dict.version} 中或已停用，请重新选择`, ...at })
    }

    const hasFatal = issues.some((i) => i.severity === 'fatal')
    const fatalCount = issues.filter((i) => i.severity === 'fatal').length
    const warnCount = issues.filter((i) => i.severity === 'warn').length
    const infoCount = issues.filter((i) => i.severity === 'info').length

    let score = 100 - fatalCount * 35 - warnCount * 12 - infoCount * 3
    if (score < 0) score = 0
    if (hasFatal && score > 59) score = 59

    return {
      passed: !hasFatal && warnCount === 0,
      hasFatal,
      score,
      coverage,
      totalSegs,
      validDuration,
      issues,
    }
  }

  /** 当前所选片段与模式在离开页面后保留 */
  const cur = ref<string>('C200')
  const filter = ref<string>('todo')

  return {
    clips,
    subNames,
    namesFor,
    pool,
    mine,
    claim,
    release,
    presplit,
    ingest,
    redo,
    reviewPool,
    claimReview,
    pushHistory,
    popHistory,
    canUndo,
    validateClip,
    byId,
    countOf,
    labelTodo,
    reviewTodo,
    todoCount,
    submit,
    approve,
    reject,
    cur,
    filter,
  }
})
