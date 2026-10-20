import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ScenKey } from '@/constants'
import { useLogs } from './logs'

export interface VocabItem {
  id: string
  code: string
  name: string
  category: 'action' | 'object' | 'subtask'
  scen: ScenKey | 'common'
  aliases: string[]
  desc: string
  status: 'active' | 'inactive'
  updatedAt: string
  updatedBy: string
}

export interface ReviewScore {
  timeAccuracy: number // 时间准确性 (1-5)
  actionRationality: number // 动作合理性 (1-5)
  objectCompleteness: number // 物体完整性 (1-5)
  semanticClarity: number // 语义清晰度 (1-5)
  outcomeAccuracy: number // 结果准确性 (1-5)
  consistency: number // 标注一致性 (1-5)
  note: string
}

export interface SegIssue {
  segId: number
  kind: 'boundary' | 'label' | 'missing' | 'redundant' | 'other'
  severity: 'fatal' | 'warn' | 'info'
  desc: string
}

const DEFAULT_VOCAB: VocabItem[] = [
  // 动作词典
  { id: 'V-ACT-01', code: 'PICK', name: '抓取 / 取件', category: 'action', scen: 'common', aliases: ['拿取', '拾取', 'Grasp'], desc: '末端夹爪或人手接触工件并施加夹紧力提起', status: 'active', updatedAt: '2026-10-13 14:10', updatedBy: '陈静' },
  { id: 'V-ACT-02', code: 'CLAMP', name: '夹紧密封', category: 'action', scen: 'qmd', aliases: ['固定', '闭合密封', 'Seal'], desc: '气动机构闭合，橡胶密封垫压紧轮毂气门孔及边缘', status: 'active', updatedAt: '2026-10-13 11:20', updatedBy: '陈静' },
  { id: 'V-ACT-03', code: 'INFLATE', name: '充气保压', category: 'action', scen: 'qmd', aliases: ['加压', '气密测试', 'Pressurize'], desc: '充气管路开启，向轮毂注入测试气压并维持稳定观测', status: 'active', updatedAt: '2026-10-12 16:00', updatedBy: '周工' },
  { id: 'V-ACT-04', code: 'READ', name: '读数判定', category: 'action', scen: 'qmd', aliases: ['观察压降', '判级', 'Inspect'], desc: '视线聚焦压力表指针/数字屏幕，对比压降判断是否漏气', status: 'active', updatedAt: '2026-10-12 16:05', updatedBy: '周工' },
  { id: 'V-ACT-05', code: 'PLACE', name: '取下放回', category: 'action', scen: 'qmd', aliases: ['下料', '复位', 'Release'], desc: '解除夹紧，将轮毂取出并放置至出料传输托盘', status: 'active', updatedAt: '2026-10-12 16:10', updatedBy: '周工' },
  { id: 'V-ACT-06', code: 'ALIGN', name: '对准孔位', category: 'action', scen: 'fhd', aliases: ['定位', '定心', 'Align'], desc: '将防护堵中心轴线与轮毂防护安装孔同轴对齐', status: 'active', updatedAt: '2026-10-13 16:42', updatedBy: '陈静' },
  { id: 'V-ACT-07', code: 'PRESS_IN', name: '压入到位', category: 'action', scen: 'fhd', aliases: ['安装', '按压', 'PressIn'], desc: '垂直施加推力，将橡胶防护堵完全挤压嵌入孔槽内', status: 'active', updatedAt: '2026-10-13 10:15', updatedBy: '陈静' },
  { id: 'V-ACT-08', code: 'CHECK', name: '检查确认', category: 'action', scen: 'fhd', aliases: ['质检', '复查', 'Verify'], desc: '轻触或目测检查防护堵边缘是否平整无翘曲', status: 'active', updatedAt: '2026-10-13 10:18', updatedBy: '陈静' },

  // 物体/部件词典
  { id: 'V-OBJ-01', code: 'WHEEL_HUB', name: '铝合金轮毂', category: 'object', scen: 'common', aliases: ['车轮', '工件', 'Hub'], desc: '待加工/待检测的汽车铝合金压铸或锻造轮毂成品', status: 'active', updatedAt: '2026-10-11 09:30', updatedBy: '周工' },
  { id: 'V-OBJ-02', code: 'SEAL_FIXTURE', name: '气密专用夹具', category: 'object', scen: 'qmd', aliases: ['夹具', '密封测试台', 'Fixture'], desc: '包含上下压紧气缸、密封圈及进气气路的专用检测工装', status: 'active', updatedAt: '2026-10-13 14:10', updatedBy: '陈静' },
  { id: 'V-OBJ-03', code: 'PRESSURE_GAUGE', name: '数字精密压力表', category: 'object', scen: 'qmd', aliases: ['气压表', '差压变送器', 'Gauge'], desc: '用于测量密封腔内微压降的数字式传感器与显示屏', status: 'active', updatedAt: '2026-10-11 10:00', updatedBy: '周工' },
  { id: 'V-OBJ-04', code: 'PLUG_CAP', name: '橡胶防护堵', category: 'object', scen: 'fhd', aliases: ['防尘塞', '防护盖', 'DustPlug'], desc: '安装于轮毂通孔用于防尘、防划伤的特制弹性硅胶塞', status: 'active', updatedAt: '2026-10-11 10:15', updatedBy: '周工' },
  { id: 'V-OBJ-05', code: 'VALVE_PORT', name: '轮毂气门嘴孔', category: 'object', scen: 'common', aliases: ['充气孔', 'ValveHole'], desc: '轮毂侧壁用于安装轮胎充气气门嘴的标准加工孔', status: 'active', updatedAt: '2026-10-11 10:20', updatedBy: '周工' },
]

export const useReview = defineStore('review', () => {
  const vocabList = ref<VocabItem[]>([...DEFAULT_VOCAB])
  const scores = ref<Record<string, ReviewScore>>({})
  const clipIssues = ref<Record<string, SegIssue[]>>({})

  // 默认评分模板
  function getScore(clipId: string): ReviewScore {
    if (!scores.value[clipId]) {
      scores.value[clipId] = {
        timeAccuracy: 5,
        actionRationality: 5,
        objectCompleteness: 5,
        semanticClarity: 5,
        outcomeAccuracy: 5,
        consistency: 5,
        note: '',
      }
    }
    return scores.value[clipId]
  }

  function setScore(clipId: string, patch: Partial<ReviewScore>) {
    const s = getScore(clipId)
    Object.assign(s, patch)
  }

  function calculateScore(clipId: string): number {
    const s = getScore(clipId)
    const sum = s.timeAccuracy + s.actionRationality + s.objectCompleteness + s.semanticClarity + s.outcomeAccuracy + s.consistency
    // 满分 30，转换为百分制 100
    return Math.round((sum / 30) * 100)
  }

  function getIssues(clipId: string): SegIssue[] {
    return clipIssues.value[clipId] ?? []
  }

  function addIssue(clipId: string, issue: SegIssue) {
    if (!clipIssues.value[clipId]) clipIssues.value[clipId] = []
    const idx = clipIssues.value[clipId].findIndex((x) => x.segId === issue.segId)
    if (idx >= 0) clipIssues.value[clipId][idx] = issue
    else clipIssues.value[clipId].push(issue)
  }

  function removeIssue(clipId: string, segId: number) {
    if (!clipIssues.value[clipId]) return
    clipIssues.value[clipId] = clipIssues.value[clipId].filter((x) => x.segId !== segId)
  }

  // 字典 CRUD
  let vId = 20
  function addVocab(item: Omit<VocabItem, 'id' | 'updatedAt'>, userName: string) {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    const entry: VocabItem = {
      ...item,
      id: 'V-NEW-' + vId++,
      updatedAt: timeStr,
      updatedBy: userName,
    }
    vocabList.value.unshift(entry)
    useLogs().addLog({
      user: userName,
      role: '审核员',
      module: 'vocab',
      moduleName: '字典管理',
      action: '新增词条',
      target: `${entry.name} (${entry.code})`,
      summary: `审核员新增语义字典词条：${entry.name}，分类：${entry.category}`,
      after: entry as unknown as Record<string, unknown>,
    })
    return entry
  }

  function updateVocab(id: string, patch: Partial<VocabItem>, userName: string) {
    const item = vocabList.value.find((x) => x.id === id)
    if (!item) return
    const before = { ...item }
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    Object.assign(item, patch, {
      updatedAt: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      updatedBy: userName,
    })
    useLogs().addLog({
      user: userName,
      role: '审核员',
      module: 'vocab',
      moduleName: '字典管理',
      action: '修改词条',
      target: `${item.name} (${item.code})`,
      summary: `审核员更新词条信息：${item.name}`,
      before: before as unknown as Record<string, unknown>,
      after: item as unknown as Record<string, unknown>,
    })
  }

  function toggleVocabStatus(id: string, userName: string) {
    const item = vocabList.value.find((x) => x.id === id)
    if (!item) return
    const nextSt = item.status === 'active' ? 'inactive' : 'active'
    updateVocab(id, { status: nextSt }, userName)
  }

  function deleteVocab(id: string, userName: string) {
    const idx = vocabList.value.findIndex((x) => x.id === id)
    if (idx >= 0) {
      const removed = vocabList.value.splice(idx, 1)[0]
      useLogs().addLog({
        user: userName,
        role: '审核员',
        module: 'vocab',
        moduleName: '字典管理',
        action: '删除词条',
        target: `${removed.name} (${removed.code})`,
        summary: `审核员删除词条：${removed.name}`,
        before: removed as unknown as Record<string, unknown>,
      })
    }
  }

  return {
    vocabList,
    scores,
    clipIssues,
    getScore,
    setScore,
    calculateScore,
    getIssues,
    addIssue,
    removeIssue,
    addVocab,
    updateVocab,
    toggleVocabStatus,
    deleteVocab,
  }
})
