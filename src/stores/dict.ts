import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ScenKey } from '@/constants'
import { useLogs } from './logs'

/**
 * 统一标注字典：标注员选子任务/物体、审核员校验标签都用这一份。
 * 词条即子任务（标注的唯一粒度），分标准子任务 / 异常子任务。每次修改递增小版本号。
 */
export type DictCat = 'action' | 'object'
export type ActLevel = 'compound' | 'abnormal'
export const LEVELS: Record<ActLevel, string> = { compound: '标准子任务', abnormal: '异常子任务' }
export interface DictItem {
  id: string; code: string; name: string; category: DictCat; level?: ActLevel; scen: ScenKey | 'common'
  aliases: string[]; desc: string; /** 该场景的核心必选子任务 */ required?: boolean
  status: 'active' | 'inactive'; updatedAt: string; updatedBy: string
}
export type DictOp = '新增' | '修改' | '启用' | '停用' | '删除'
export interface DictChange { ver: string; t: string; by: string; op: DictOp; target: string; summary: string }

const T = '2026-10-12 16:00'
const A = (id: string, code: string, name: string, level: ActLevel, scen: DictItem['scen'], aliases: string[], desc: string, required = false): DictItem =>
  ({ id, code, name, category: 'action', level, scen, aliases, desc, required, status: 'active', updatedAt: T, updatedBy: '陈静' })

const DEFAULTS: DictItem[] = [
  A('D-S01', 'LOAD', '取件上台', 'compound', 'qmd', ['上料', '取件'], '抓取工件移送至检测工位并安放平稳', true),
  A('D-S02', 'CLAMP', '夹紧密封', 'compound', 'qmd', ['固定', '闭合密封', 'Seal'], '气动机构闭合压紧，密封胶垫完全压实气阀孔', true),
  A('D-S03', 'INFLATE', '充气保压', 'compound', 'qmd', ['加压', '气密测试'], '向工件充入测试气体并保持稳定', true),
  A('D-S04', 'READ', '读数判定', 'compound', 'qmd', ['观察压降', '判级'], '观察微压表压降，判定气密是否合格', true),
  A('D-S05', 'UNLOAD', '取下放回', 'compound', 'qmd', ['下料', '复位'], '松开夹具，取出工件移送至传输托盘'),
  A('D-S06', 'PICK_PLUG', '取防护堵', 'compound', 'fhd', ['取料'], '从料盒中抓取硅胶防护堵', true),
  A('D-S07', 'ALIGN', '对准孔位', 'compound', 'fhd', ['定位', '定心', 'Align'], '将防护堵中心轴线与轮毂安装孔同轴对齐', true),
  A('D-S08', 'PRESS_IN', '压入到位', 'compound', 'fhd', ['安装', 'PressIn'], '垂直施加推力压入孔槽，边缘平整卡紧', true),
  A('D-S09', 'VERIFY', '检查确认', 'compound', 'fhd', ['复查', 'Verify'], '轻触并目视确认安装平齐无翘曲'),
  A('D-E01', 'REGRASP', '重新抓取', 'abnormal', 'common', ['二次抓取', '补抓'], '首次抓取失败或姿态不佳后的再次抓取'),
  A('D-E02', 'DROP', '工件掉落', 'abnormal', 'common', ['脱手', 'Drop'], '工件在搬运或放置中意外脱落'),
  A('D-E03', 'MISALIGN', '对位偏差', 'abnormal', 'fhd', ['偏位', '没对准'], '对准后仍明显偏离孔位，需要回退调整'),
]

export const useDict = defineStore('dict', () => {
  const items = ref<DictItem[]>(DEFAULTS.map((x) => ({ ...x, aliases: [...x.aliases] })))
  const version = ref('v1.3')
  const C = (ver: string, t: string, by: string, op: DictOp, target: string, summary: string): DictChange => ({ ver, t, by, op, target, summary })
  const changes = ref<DictChange[]>([
    C('v1.3', '2026-10-13 14:10', '陈静', '新增', '对位偏差', '新增异常子任务「对位偏差」（防护堵安装）'),
    C('v1.2', '2026-10-12 16:00', '周工', '修改', '夹紧密封', '调整定义：以密封胶垫完全压实为结束边界'),
    C('v1.2', '2026-10-12 15:52', '周工', '修改', '充气保压', '新增别名「气密测试」'),
    C('v1.1', '2026-10-10 11:30', '陈静', '停用', '人工复检', '停用「人工复检」，并入「读数判定」'),
    C('v1.1', '2026-10-08 10:20', '陈静', '新增', '检查确认', '新增防护堵安装子任务「检查确认」'),
    C('v1.0', '2026-10-06 09:00', '陈静', '新增', '初始字典', '合并标注与审核两套字典，建立初始版本'),
  ])
  const now = () => {
    const d = new Date(), p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  function bump(by: string, op: DictOp, target: string, summary: string) {
    const [maj, min] = version.value.slice(1).split('.').map(Number)
    version.value = `v${maj}.${min + 1}`
    changes.value.unshift({ ver: version.value, t: now(), by, op, target, summary })
    useLogs().addLog({ user: by, role: '审核员', module: 'vocab', moduleName: '标注字典', action: '字典变更', target: version.value, summary })
  }
  const active = computed(() => items.value.filter((x) => x.status === 'active'))
  const fits = (x: DictItem, scen?: ScenKey) => !scen || x.scen === 'common' || x.scen === scen
  /** 标注下拉：某场景可用的子任务（标准在前，异常在后） */
  function actionsFor(scen?: ScenKey) {
    return active.value.filter((x) => x.category === 'action' && fits(x, scen)).sort((a, b) => (a.level === 'abnormal' ? 1 : 0) - (b.level === 'abnormal' ? 1 : 0))
  }
  const objectsFor = (scen?: ScenKey) => active.value.filter((x) => x.category === 'object' && fits(x, scen))
  /** 某场景核心必选子任务 */
  const requiredFor = (scen: ScenKey) => active.value.filter((x) => x.category === 'action' && x.required && x.scen === scen).map((x) => x.name)
  /** 子任务（复合动作）的标准顺序，用于规则预切分 */
  const sequenceFor = (scen: ScenKey) => active.value.filter((x) => x.level === 'compound' && x.scen === scen).map((x) => x.name)
  const byName = (name: string) => items.value.find((x) => x.name === name)
  const isValid = (name: string) => active.value.some((x) => x.name === name)

  function add(x: Omit<DictItem, 'id' | 'updatedAt' | 'updatedBy' | 'status'>, by: string) {
    const id = 'D-' + (x.category === 'object' ? 'O' : 'A') + String(items.value.length + 1).padStart(2, '0') + Math.floor(Math.random() * 90 + 10)
    items.value.unshift({ ...x, id, status: 'active', updatedAt: now(), updatedBy: by })
    bump(by, '新增', x.name, '新增' + (x.category === 'object' ? '物体' : LEVELS[x.level ?? 'compound']) + '「' + x.name + '」')
  }
  function update(id: string, patch: Partial<DictItem>, by: string) {
    const it = items.value.find((x) => x.id === id)
    if (!it) return
    const diff: string[] = []
    if (patch.name && patch.name !== it.name) diff.push('名称「' + it.name + '」→「' + patch.name + '」')
    if (patch.desc !== undefined && patch.desc !== it.desc) diff.push('定义')
    if (patch.aliases && patch.aliases.join() !== it.aliases.join()) diff.push('别名')
    if (patch.scen && patch.scen !== it.scen) diff.push('适用场景')
    if (patch.level && patch.level !== it.level) diff.push('分级')
    if (patch.required !== undefined && !!patch.required !== !!it.required) diff.push(patch.required ? '设为必选' : '取消必选')
    Object.assign(it, patch, { updatedAt: now(), updatedBy: by })
    bump(by, '修改', it.name, diff.length ? '修改' + diff.join('、') : '保存（无内容变化）')
  }
  function toggle(id: string, by: string) {
    const it = items.value.find((x) => x.id === id)
    if (!it) return
    it.status = it.status === 'active' ? 'inactive' : 'active'
    it.updatedAt = now(); it.updatedBy = by
    bump(by, it.status === 'active' ? '启用' : '停用', it.name, (it.status === 'active' ? '启用' : '停用') + '「' + it.name + '」')
  }
  function remove(id: string, by: string) {
    const i = items.value.findIndex((x) => x.id === id)
    if (i < 0) return
    const [r] = items.value.splice(i, 1)
    bump(by, '删除', r.name, '删除「' + r.name + '」')
  }
  return { items, version, changes, active, actionsFor, objectsFor, requiredFor, sequenceFor, byName, isValid, add, update, toggle, remove }
})
