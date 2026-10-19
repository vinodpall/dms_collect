import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ScenKey } from '@/constants'
import { STAGES, STAGE_MANUAL, SCEN } from '@/constants'
import { useAlerts } from './alerts'

export type BatchState = 'ok' | 'running' | 'wait' | 'failed'
export interface Batch { id: string; task: string; scen: ScenKey; count: number; stage: number; state: BatchState; pct: number; size: number }

export interface LogLine { t: string; lv?: 'WARN' | 'ERROR'; msg: string }

export const usePipeline = defineStore('pipeline', () => {
  const batches = ref<Batch[]>([
    { id: 'B-1013-01', task: 'TK-0138', scen: 'qmd', count: 58, stage: 5, state: 'ok', pct: 100, size: 52.4 },
    { id: 'B-1013-02', task: 'TK-0137', scen: 'fhd', count: 41, stage: 4, state: 'running', pct: 62, size: 38.1 },
    { id: 'B-1013-03', task: 'TK-0138', scen: 'qmd', count: 5, stage: 2, state: 'wait', pct: 0, size: 4.6 },
    { id: 'B-1013-04', task: 'TK-0137', scen: 'fhd', count: 29, stage: 1, state: 'failed', pct: 40, size: 27.2 },
    { id: 'B-1012-07', task: 'TK-0136', scen: 'qmd', count: 64, stage: 1, state: 'running', pct: 35, size: 59.9 },
    { id: 'B-1012-06', task: 'TK-0136', scen: 'qmd', count: 47, stage: 1, state: 'running', pct: 78, size: 44.0 },
    { id: 'B-1013-05', task: 'TK-0138', scen: 'qmd', count: 22, stage: 0, state: 'wait', pct: 0, size: 20.8 },
    { id: 'B-1012-05', task: 'TK-0133', scen: 'fhd', count: 80, stage: 5, state: 'ok', pct: 100, size: 74.5 },
    { id: 'B-1012-04', task: 'TK-0133', scen: 'fhd', count: 3, stage: 3, state: 'wait', pct: 0, size: 2.8 },
  ])
  const failedCount = () => batches.value.filter((b) => b.state === 'failed').length
  const countAtStage = (i: number) => batches.value.filter((b) => b.stage === i).reduce((a, b) => a + b.count, 0)
  /** 推进自动阶段（标准化、格式转换、入库）；手动标注 / 校验阶段不会自动流转 */
  function tick() {
    let changed = false
    batches.value.forEach((b) => {
      if (b.state !== 'running') return
      b.pct += 7 + Math.random() * 8
      changed = true
      if (b.pct >= 100) {
        b.pct = 0; b.stage++
        if (STAGE_MANUAL.includes(b.stage)) b.state = 'wait'
        else if (b.stage >= STAGES.length - 1) { b.stage = STAGES.length - 1; b.state = 'ok'; b.pct = 100 }
      }
    })
    return changed
  }
  /** 标注全部提交 → 进入标注校验；有被打回 → 回到手动标注；全部通过 → 进入格式转换 */
  function sync(batchId: string, c: { todo: number; submitted: number; rejected: number; approved: number; total: number }) {
    const b = batches.value.find((x) => x.id === batchId)
    if (!b || b.stage < 2 || b.stage > 3) return
    if (c.total && c.approved === c.total) { b.stage = 4; b.state = 'running'; b.pct = 0; return }
    if (c.todo + c.rejected > 0) { b.stage = 2; b.state = 'wait'; return }
    b.stage = 3; b.state = 'wait'
  }
  /** 批次处理日志；lv 为 WARN/ERROR 时高亮 */
  function batchLog(b: Batch): LogLine[] {
    const sc = SCEN[b.scen].code
    const lines: LogLine[] = [{ t: '[16:02:11]', msg: '批次 ' + b.id + ' 进入流水线，共 ' + b.count + ' 条，' + b.size + ' GB' }]
    const upto = b.state === 'ok' ? b.stage + 1 : b.stage
    for (let i = 0; i < upto; i++) if (i > 0 || b.stage > 0) lines.push({ t: '[16:0' + (3 + i) + ':' + String(10 + i * 7).padStart(2, '0') + ']', msg: STAGES[i] + ' 完成' })
    if (b.state === 'failed') {
      lines.push({ t: '[14:57:42]', lv: 'WARN', msg: 'camera_3 话题时间戳不连续，丢失 12 帧' })
      lines.push({ t: '[14:58:03]', lv: 'ERROR', msg: '数据标准化失败：' + sc + '_20261013_029.bag → lsdataset 转换出错' })
      lines.push({ t: '[14:58:03]', lv: 'ERROR', msg: '批次已暂停，等待人工处理' })
    } else if (b.state === 'wait' && b.stage === 2) lines.push({ t: '[16:20:00]', msg: '等待标注员完成手动标注（子任务级）' })
    else if (b.state === 'wait' && b.stage === 3) lines.push({ t: '[16:20:00]', msg: '标注已全部提交，等待审核员审核' })
    return lines
  }
  /** 重试失败批次，并确认流水线告警；成功返回 true */
  function retry(id: string) {
    const b = batches.value.find((x) => x.id === id)
    if (!b || b.state !== 'failed') return false
    b.state = 'running'; b.pct = 5
    useAlerts().ackFirst('pipeline')
    return true
  }
  return { batches, failedCount, countAtStage, tick, sync, batchLog, retry }
})
