import { defineStore } from 'pinia'
import { ref } from 'vue'
import { OPS, SCEN, TODAY, type BadgeKind, type ScenKey } from '@/constants'
import { SUB_NAMES, type Clip, type ClipStatus, type Seg } from './annotate'

export type DsStatus = 'published' | 'review' | 'draft'
export interface Dataset { id: string; name: string; ver: string; scen: ScenKey; spec: string; count: number; size: number; quality: number; status: DsStatus; tags: string[]; updated: string; owner: string }
export const DS_ST: Record<DsStatus, [BadgeKind, string]> = { published: ['good', '已发布'], review: ['warn', '待审核'], draft: ['', '草稿'] }
export const DS_QUERIES = ['20寸 气密性', '高质量 防护堵', 'UMI 混合规格', '草稿']

export interface DatasetSample extends Clip {
  sampleName: string
  sampleDesc: string
  operator: string
  qualityScore: number
}

export function getDatasetSamples(ds: Dataset): DatasetSample[] {
  const scen = ds.scen
  const isQmd = scen === 'qmd'
  const names = isQmd
    ? ['取件上台', '夹紧密封', '充气保压', '读数判定', '取下放回']
    : ['取防护堵', '对准孔位', '压入到位', '检查确认']

  const sampleConfigs = isQmd
    ? [
        { name: '样本 01 · 标准检测序列', desc: '完整五阶段标准动作，双臂协调轨迹平滑', dur: 21.0, qOffset: 1, cuts: [0, 4.2, 8.0, 14.2, 17.6, 21.0], op: OPS[0].n, opCode: OPS[0].c },
        { name: '样本 02 · 快速节拍样本', desc: '保压时长达标，高节拍生产线实采', dur: 18.5, qOffset: 0, cuts: [0, 3.6, 6.8, 12.5, 15.2, 18.5], op: OPS[1].n, opCode: OPS[1].c },
        { name: '样本 03 · 典型加压保压', desc: '气密性微压变检测试验典型样本', dur: 22.4, qOffset: 2, cuts: [0, 4.5, 8.6, 15.8, 18.9, 22.4], op: '林悦', opCode: 'LY' },
        { name: '样本 04 · 微小姿态校准', desc: '轮毂上台微调与二次夹紧序列', dur: 24.0, qOffset: -1, cuts: [0, 5.2, 9.5, 16.8, 20.2, 24.0], op: OPS[3].n, opCode: OPS[3].c },
      ]
    : [
        { name: '样本 01 · 标准压入到位', desc: '气动抓手四阶段完整对准安装', dur: 18.0, qOffset: 1, cuts: [0, 4.2, 8.8, 14.5, 18.0], op: OPS[3].n, opCode: OPS[3].c },
        { name: '样本 02 · 高速流水作业', desc: '熟练工节拍安装样本', dur: 15.6, qOffset: 0, cuts: [0, 3.5, 7.2, 12.4, 15.6], op: OPS[0].n, opCode: OPS[0].c },
        { name: '样本 03 · 复杂轮毂构型', desc: '深孔防误装二次对齐检测', dur: 20.2, qOffset: 2, cuts: [0, 4.8, 10.2, 16.5, 20.2], op: OPS[1].n, opCode: OPS[1].c },
        { name: '样本 04 · 抽检质检样本', desc: '端到端装配及接触力反馈', dur: 19.0, qOffset: -2, cuts: [0, 4.4, 9.1, 15.2, 19.0], op: OPS[2].n, opCode: OPS[2].c },
      ]

  const status: ClipStatus = ds.status === 'draft' ? 'todo' : ds.status === 'review' ? 'submitted' : 'approved'
  const specLabel = ds.spec === 'mix' ? 'MIX' : ds.spec + 'INCH'

  return sampleConfigs.map((cfg, idx) => {
    const segs: Seg[] = []
    const count = cfg.cuts.length - 1
    for (let i = 0; i < count; i++) {
      segs.push({
        id: (idx + 1) * 100 + i + 1,
        s: cfg.cuts[i],
        e: cfg.cuts[i + 1],
        n: names[i % names.length],
      })
    }
    const epNum = String(idx + 1).padStart(3, '0')
    const file = `${TODAY}_${SCEN[scen].code}_${specLabel}_${epNum}_${cfg.opCode}.bag`
    return {
      id: `${ds.id}-S${epNum}`,
      file,
      scen,
      dur: cfg.dur,
      batch: 'B-1012-0' + (idx + 1),
      status,
      segs,
      sampleName: cfg.name,
      sampleDesc: cfg.desc,
      operator: cfg.op,
      qualityScore: Math.min(99, Math.max(85, ds.quality + cfg.qOffset)),
    }
  })
}

export const useDatasets = defineStore('datasets', () => {
  const list = ref<Dataset[]>([
    { id: 'DS-014', name: '轮毂气密性检测 · 19 寸', ver: 'v1.3', scen: 'qmd', spec: '19', count: 1240, size: 1198, quality: 96, status: 'published', tags: ['气密性', '19寸', '高质量', 'VR'], updated: '10-12 18:20', owner: '林悦' },
    { id: 'DS-013', name: '轮毂气密性检测 · 20 寸', ver: 'v1.1', scen: 'qmd', spec: '20', count: 640, size: 622, quality: 94, status: 'published', tags: ['气密性', '20寸', '高质量', 'VR'], updated: '10-10 17:05', owner: '林悦' },
    { id: 'DS-012', name: '防护堵安装 · 18 寸', ver: 'v1.0', scen: 'fhd', spec: '18', count: 520, size: 498, quality: 92, status: 'published', tags: ['防护堵', '18寸', 'UMI'], updated: '10-09 16:40', owner: '陈浩' },
    { id: 'DS-015', name: '防护堵安装 · 19 寸', ver: 'v0.4', scen: 'fhd', spec: '19', count: 860, size: 811, quality: 95, status: 'review', tags: ['防护堵', '19寸', '高质量', 'UMI'], updated: '今天 15:12', owner: '林悦' },
    { id: 'DS-016', name: '轮毂气密性检测 · 18 寸', ver: 'v0.2', scen: 'qmd', spec: '18', count: 410, size: 399, quality: 88, status: 'draft', tags: ['气密性', '18寸', 'VR'], updated: '今天 11:30', owner: '周工' },
    { id: 'DS-011', name: '防护堵安装 · 20 寸', ver: 'v1.2', scen: 'fhd', spec: '20', count: 730, size: 702, quality: 93, status: 'published', tags: ['防护堵', '20寸', 'UMI'], updated: '10-07 14:22', owner: '陈浩' },
    { id: 'DS-010', name: '轮毂气密性检测 · 混合规格', ver: 'v2.0', scen: 'qmd', spec: 'mix', count: 2100, size: 2044, quality: 97, status: 'published', tags: ['气密性', '混合规格', '高质量', 'VR', '训练集'], updated: '10-05 10:08', owner: '林悦' },
    { id: 'DS-009', name: '防护堵安装 · 混合规格', ver: 'v1.0', scen: 'fhd', spec: 'mix', count: 1180, size: 1130, quality: 91, status: 'published', tags: ['防护堵', '混合规格', 'UMI', '训练集'], updated: '09-30 09:45', owner: '陈浩' },
  ])
  const byId = (id: string) => list.value.find((d) => d.id === id)
  /** 新建采集任务时快速新建的数据集（草稿），后续在数据集管理中完善 */
  function create(name: string, scen: ScenKey, owner: string): Dataset {
    const id = 'DS-' + String(Math.max(...list.value.map((d) => parseInt(d.id.slice(3), 10))) + 1).padStart(3, '0')
    const d: Dataset = { id, name, ver: 'v0.1', scen, spec: 'mix', count: 0, size: 0, quality: 0, status: 'draft', tags: [SCEN[scen].short], updated: '刚刚', owner }
    list.value.unshift(d)
    return d
  }
  return { list, byId, create }
})
