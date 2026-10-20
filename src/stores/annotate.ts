import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { OPS, SCEN, TODAY, type ScenKey } from '@/constants'
import { rng } from '@/utils'
import { useSettings } from './settings'
import { usePipeline } from './pipeline'
import { useLogs } from './logs'

/** 待标注 → 已提交（待审核）→ 已通过；审核打回后回到“被打回”，修改后可再次提交 */
export type ClipStatus = 'todo' | 'rejected' | 'submitted' | 'approved'
/** 子任务级标注片段（暂不标注动作级）；flag 为审核员标记的问题说明 */
export interface Seg { id: number; s: number; e: number; n: string; flag?: string }
export interface Clip {
  id: string; file: string; scen: ScenKey; dur: number; batch: string; status: ClipStatus; segs: Seg[]
  reject?: { reason: string; by: string; t: string }
}

/** 统一通用子任务标签体系（所有场景通用） */
export const DEFAULT_SUB_NAMES: string[] = [
  '取件上台',
  '夹紧密封',
  '充气保压',
  '读数判定',
  '取下放回',
  '取防护堵',
  '对准孔位',
  '压入到位',
  '检查确认',
]

/** 兼容旧代码按场景索引 SUB_NAMES[scen] 的访问方式 */
export const SUB_NAMES: Record<string, string[]> & string[] = new Proxy(DEFAULT_SUB_NAMES as any, {
  get(target, prop) {
    if (prop === 'qmd' || prop === 'fhd') {
      try {
        const store = useAnnotate()
        return store.subNames
      } catch {
        return DEFAULT_SUB_NAMES
      }
    }
    return (target as any)[prop]
  },
})

export const SUB_COLORS = ['#2F6FD1', '#2C8F7B', '#B86E1A', '#8A5CC9', '#C2476B', '#4A8FB8', '#D97706', '#059669', '#7C3AED', '#DB2777']

function hashStr(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export const colorOf = (_scen: unknown, name: string) => {
  let idx = -1
  try {
    const store = useAnnotate()
    idx = store?.subNames?.indexOf(name) ?? -1
  } catch {
    idx = DEFAULT_SUB_NAMES.indexOf(name)
  }
  if (idx < 0) idx = DEFAULT_SUB_NAMES.indexOf(name)
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

  // 通用响应式子任务标签字典（所有场景通用）
  const subNames = ref<string[]>([...DEFAULT_SUB_NAMES])

  // 通用子任务元数据
  const subtaskMeta = ref<Record<string, SubtaskMeta>>({
    取件上台: { name: '取件上台', desc: '抓取工件移送至检测工位并安放平稳', required: true },
    夹紧密封: { name: '夹紧密封', desc: '气动机构闭合压紧，密封胶垫完全压实气阀孔', required: true },
    充气保压: { name: '充气保压', desc: '向工件充入高压测试气体并持续保持稳定', required: true },
    读数判定: { name: '读数判定', desc: '观察精密微压表压降波动，判定气密是否合格', required: true },
    取下放回: { name: '取下放回', desc: '松开夹具，取出工件移送至传输托盘', required: false },
    取防护堵: { name: '取防护堵', desc: '从零件料盒中精准抓取特制硅胶防护堵塞', required: true },
    对准孔位: { name: '对准孔位', desc: '将防护堵中心轴线与轮毂装配孔同轴对齐', required: true },
    压入到位: { name: '压入到位', desc: '施加推力垂直压入孔槽，确保边缘平整卡紧', required: true },
    检查确认: { name: '检查确认', desc: '轻触并目视确认工件安装平齐无翘曲遗漏', required: false },
  })

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

  // 通用子任务 CRUD
  function addSubName(name: string, desc = '', required = false) {
    const trimmed = name.trim()
    if (!trimmed || subNames.value.includes(trimmed)) return false
    subNames.value.push(trimmed)
    subtaskMeta.value[trimmed] = { name: trimmed, desc, required }

    useLogs().addLog({
      user: '林悦',
      role: '标注员',
      module: 'annotate',
      moduleName: '标注工作台',
      action: '新增子任务',
      target: trimmed,
      summary: `标注员新增通用子任务：${trimmed}`,
      after: { name: trimmed, desc, required },
    })
    return true
  }

  function updateSubName(oldName: string, newName: string, desc?: string, required?: boolean) {
    const trimmed = newName.trim()
    const idx = subNames.value.indexOf(oldName)
    if (idx < 0 || !trimmed) return false

    if (trimmed !== oldName && !subNames.value.includes(trimmed)) {
      subNames.value[idx] = trimmed
      const meta = subtaskMeta.value[oldName] ?? { name: trimmed, desc: desc ?? '', required: !!required }
      delete subtaskMeta.value[oldName]
      subtaskMeta.value[trimmed] = { ...meta, name: trimmed, desc: desc ?? meta.desc, required: required ?? meta.required }

      // 同步更新所有片段中引用的名称
      clips.value.forEach((c) => {
        c.segs.forEach((s) => {
          if (s.n === oldName) s.n = trimmed
        })
      })
    } else if (trimmed === oldName && subtaskMeta.value[oldName]) {
      if (desc !== undefined) subtaskMeta.value[oldName].desc = desc
      if (required !== undefined) subtaskMeta.value[oldName].required = required
    }

    useLogs().addLog({
      user: '林悦',
      role: '标注员',
      module: 'annotate',
      moduleName: '标注工作台',
      action: '修改子任务',
      target: trimmed,
      summary: `标注员更新通用子任务：${oldName} → ${trimmed}`,
      before: { name: oldName },
      after: { name: trimmed, desc, required },
    })
    return true
  }

  function deleteSubName(name: string) {
    const idx = subNames.value.indexOf(name)
    if (idx < 0) return false
    subNames.value.splice(idx, 1)
    if (subtaskMeta.value[name]) delete subtaskMeta.value[name]

    useLogs().addLog({
      user: '林悦',
      role: '标注员',
      module: 'annotate',
      moduleName: '标注工作台',
      action: '删除子任务',
      target: name,
      summary: `标注员删除了通用子任务：${name}`,
    })
    return true
  }

  function resetSubNames() {
    subNames.value = [...DEFAULT_SUB_NAMES]
  }

  function mkSegs(i: number, scen: ScenKey, dur: number, parts: number): Seg[] {
    const r = rng(900 + i)
    const preset = scen === 'qmd'
      ? ['取件上台', '夹紧密封', '充气保压', '读数判定', '取下放回']
      : ['取防护堵', '对准孔位', '压入到位', '检查确认']
    const cuts = [0]
    for (let k = 1; k < parts; k++) cuts.push(+((dur * k) / preset.length + (r() - 0.5)).toFixed(1))
    cuts.push(parts === preset.length ? dur : +((dur * parts) / preset.length).toFixed(1))
    return Array.from({ length: parts }, (_, k) => ({ id: newSegId(), s: cuts[k], e: cuts[k + 1], n: preset[k % preset.length] }))
  }

  function mk(i: number, scen: ScenKey, batch: string, status: ClipStatus, parts: number): Clip {
    const r = rng(500 + i), dur = Math.round(14 + r() * 14)
    return { id: 'C' + (200 + i), file: nameFile(SCEN[scen].code, TODAY, 120 - i, OPS[i % 4].c), scen, dur, batch, status, segs: parts ? mkSegs(i, scen, dur, parts) : [] }
  }

  const clips = ref<Clip[]>([
    mk(0, 'qmd', 'B-1013-03', 'todo', 0),
    mk(1, 'qmd', 'B-1013-03', 'rejected', 5),
    mk(2, 'qmd', 'B-1013-03', 'todo', 2),
    mk(3, 'qmd', 'B-1013-03', 'submitted', 5),
    mk(4, 'qmd', 'B-1013-03', 'todo', 0),
    mk(5, 'fhd', 'B-1012-04', 'submitted', 4),
    mk(6, 'fhd', 'B-1012-04', 'submitted', 4),
    mk(7, 'fhd', 'B-1012-04', 'approved', 4),
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

  function submit(c: Clip) {
    c.status = 'submitted'
    c.reject = undefined
    c.segs.forEach((s) => (s.flag = undefined))
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
    syncBatch(c.batch)
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
    const scenReqs: Record<ScenKey, string[]> = {
      qmd: ['夹紧密封', '充气保压', '读数判定'],
      fhd: ['压入到位'],
    }
    const requiredList = scenReqs[c.scen] || []
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
    subtaskMeta,
    addSubName,
    updateSubName,
    deleteSubName,
    resetSubNames,
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
