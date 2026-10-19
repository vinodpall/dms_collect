import { defineStore } from 'pinia'
import { ref } from 'vue'
import { OPS, SCEN, TODAY, type ScenKey } from '@/constants'
import { rng } from '@/utils'
import { useSettings } from './settings'
import { usePipeline } from './pipeline'

/** 待标注 → 已提交（待审核）→ 已通过；审核打回后回到“被打回”，修改后可再次提交 */
export type ClipStatus = 'todo' | 'rejected' | 'submitted' | 'approved'
/** 子任务级标注片段（暂不标注动作级）；flag 为审核员标记的问题说明 */
export interface Seg { id: number; s: number; e: number; n: string; flag?: string }
export interface Clip {
  id: string; file: string; scen: ScenKey; dur: number; batch: string; status: ClipStatus; segs: Seg[]
  reject?: { reason: string; by: string; t: string }
}

/** 子任务标签体系（按场景） */
export const SUB_NAMES: Record<ScenKey, string[]> = {
  qmd: ['取件上台', '夹紧密封', '充气保压', '读数判定', '取下放回'],
  fhd: ['取防护堵', '对准孔位', '压入到位', '检查'],
}
export const SUB_COLORS = ['#2F6FD1', '#2C8F7B', '#B86E1A', '#8A5CC9', '#C2476B', '#4A8FB8']
export const colorOf = (scen: ScenKey, name: string) => SUB_COLORS[Math.max(0, SUB_NAMES[scen].indexOf(name)) % SUB_COLORS.length]
export const CLIP_ST: Record<ClipStatus, [string, string]> = { todo: ['warn', '待标注'], rejected: ['crit', '被打回'], submitted: ['info', '待审核'], approved: ['good', '已通过'] }

let segUid = 1
export const newSegId = () => segUid++

export const useAnnotate = defineStore('annotate', () => {
  const { nameFile } = useSettings()
  function mkSegs(i: number, scen: ScenKey, dur: number, parts: number): Seg[] {
    const r = rng(900 + i), names = SUB_NAMES[scen]
    const cuts = [0]
    for (let k = 1; k < parts; k++) cuts.push(+((dur * k) / names.length + (r() - 0.5)).toFixed(1))
    cuts.push(parts === names.length ? dur : +((dur * parts) / names.length).toFixed(1))
    return Array.from({ length: parts }, (_, k) => ({ id: newSegId(), s: cuts[k], e: cuts[k + 1], n: names[k] }))
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
  function submit(c: Clip) { c.status = 'submitted'; c.reject = undefined; c.segs.forEach((s) => (s.flag = undefined)); syncBatch(c.batch) }
  function approve(c: Clip) { c.status = 'approved'; c.segs.forEach((s) => (s.flag = undefined)); syncBatch(c.batch) }
  function reject(c: Clip, reason: string, by: string) { c.status = 'rejected'; c.reject = { reason, by, t: '刚刚' }; syncBatch(c.batch) }

  /** 当前所选片段与模式在离开页面后保留 */
  const cur = ref<string>('C200')
  const filter = ref<string>('todo')
  return { clips, byId, countOf, labelTodo, reviewTodo, todoCount, submit, approve, reject, cur, filter }
})
