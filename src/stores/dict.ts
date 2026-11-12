import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ScenKey } from '@/constants'
import { useLogs } from './logs'
import {
  dictApi,
  getToken,
  type DictItemEntity,
  type DictChangeItem,
  type SceneItem,
} from '@/api'

export type DictCat = 'action' | 'object'
export type ActLevel = 'compound' | 'abnormal'
export const LEVELS: Record<ActLevel, string> = { compound: '标准子任务', abnormal: '异常子任务' }

export interface DictItem {
  id: string
  numericId?: number
  code: string
  name: string
  category: DictCat
  level?: ActLevel
  scen: ScenKey | 'common'
  aliases: string[]
  desc: string
  required?: boolean
  status: 'active' | 'inactive'
  updatedAt: string
  updatedBy: string
  version?: number
}

export type DictOp = '新增' | '修改' | '启用' | '停用' | '删除'
export interface DictChange {
  ver: string
  t: string
  by: string
  op: DictOp
  target: string
  summary: string
}

const T = '2026-10-12 16:00'
const A = (
  id: string,
  code: string,
  name: string,
  level: ActLevel,
  scen: DictItem['scen'],
  aliases: string[],
  desc: string,
  required = false
): DictItem => ({
  id,
  code,
  name,
  category: 'action',
  level,
  scen,
  aliases,
  desc,
  required,
  status: 'active',
  updatedAt: T,
  updatedBy: '陈静',
})

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
  const scenes = ref<SceneItem[]>([])
  const changes = ref<DictChange[]>([
    { ver: 'v1.3', t: '2026-10-13 14:10', by: '陈静', op: '新增', target: '对位偏差', summary: '新增异常子任务「对位偏差」（防护堵安装）' },
    { ver: 'v1.2', t: '2026-10-12 16:00', by: '周工', op: '修改', target: '夹紧密封', summary: '调整定义：以密封胶垫完全压实为结束边界' },
    { ver: 'v1.2', t: '2026-10-12 15:52', by: '周工', op: '修改', target: '充气保压', summary: '新增别名「气密测试」' },
    { ver: 'v1.1', t: '2026-10-10 11:30', by: '陈静', op: '停用', target: '人工复检', summary: '停用「人工复检」，并入「读数判定」' },
    { ver: 'v1.1', t: '2026-10-08 10:20', by: '陈静', op: '新增', target: '检查确认', summary: '新增防护堵安装子任务「检查确认」' },
    { ver: 'v1.0', t: '2026-10-06 09:00', by: '陈静', op: '新增', target: '初始字典', summary: '合并标注与审核两套字典，建立初始版本' },
  ])
  const loading = ref(false)

  const now = () => {
    const d = new Date(),
      p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  function bump(by: string, op: DictOp, target: string, summary: string) {
    const [maj, min] = version.value.slice(1).split('.').map(Number)
    version.value = `v${maj}.${(min || 0) + 1}`
    changes.value.unshift({ ver: version.value, t: now(), by, op, target, summary })
    useLogs().addLog({
      user: by,
      role: '审核员',
      module: 'vocab',
      moduleName: '标注字典',
      action: '字典变更',
      target: version.value,
      summary,
    })
  }

  /** 从后端拉取版本、词条与变更记录 */
  async function fetchAll() {
    if (!getToken()) return
    loading.value = true
    try {
      const [verRes, itemsRes, changesRes, scenesRes] = await Promise.allSettled([
        dictApi.getVersion(),
        dictApi.getItems(),
        dictApi.getChanges(),
        dictApi.getScenes(),
      ])

      if (verRes.status === 'fulfilled' && verRes.value?.version) {
        version.value = verRes.value.version
      }
      if (scenesRes.status === 'fulfilled') {
        scenes.value = scenesRes.value
      }

      if (itemsRes.status === 'fulfilled' && Array.isArray(itemsRes.value)) {
        items.value = itemsRes.value.map((item: DictItemEntity) => ({
          id: item.item_no || `D-${item.id}`,
          numericId: item.id,
          code: item.code,
          name: item.name,
          category: (item.category as DictCat) || 'action',
          level: (item.level as ActLevel) || 'compound',
          scen: (item.scene_key as ScenKey | 'common') || 'common',
          aliases: item.aliases || [],
          desc: item.definition || '',
          required: !!item.is_required,
          status: item.status,
          updatedAt: item.updated_at ? item.updated_at.replace('T', ' ').slice(0, 16) : T,
          updatedBy: item.updated_by_name || '陈静',
          version: item.version,
        }))
      }

      if (changesRes.status === 'fulfilled' && Array.isArray(changesRes.value)) {
        changes.value = changesRes.value.map((c: DictChangeItem) => ({
          ver: c.version,
          t: c.created_at ? c.created_at.replace('T', ' ').slice(0, 16) : now(),
          by: c.operator_name || '系统',
          op: (c.change_type as DictOp) || '修改',
          target: c.target_name,
          summary: c.summary,
        }))
      }
    } catch (e) {
      console.warn('[dict] 从后端加载失败', e)
    } finally {
      loading.value = false
    }
  }

  async function add(
    x: Omit<DictItem, 'id' | 'status' | 'updatedAt' | 'updatedBy'>,
    by: string
  ) {
    let numericId: number | undefined
    let itemNo = `D-${(x.level === 'abnormal' ? 'E' : 'S') + String(items.value.length + 1).padStart(2, '0')}`

    try {
      const res = await dictApi.createItem({
        code: x.code,
        name: x.name,
        category: x.category,
        level: x.level,
        scene_key: x.scen,
        aliases: x.aliases,
        definition: x.desc,
        is_required: x.required,
      })
      if (res) {
        numericId = res.id
        if (res.item_no) itemNo = res.item_no
      }
    } catch (e) {
      console.warn('[dict] 后端创建词条失败，降级本地存储', e)
    }

    const item: DictItem = {
      ...x,
      id: itemNo,
      numericId,
      status: 'active',
      updatedAt: now(),
      updatedBy: by,
    }
    items.value.unshift(item)
    bump(by, '新增', x.name, `新增${LEVELS[x.level ?? 'compound']}「${x.name}」（${x.code}）`)
  }

  async function update(
    id: string,
    x: Partial<Omit<DictItem, 'id' | 'status' | 'updatedAt' | 'updatedBy'>>,
    by: string
  ) {
    const it = items.value.find((i) => i.id === id || String(i.numericId) === id)
    if (!it) return
    const beforeName = it.name
    Object.assign(it, x, { updatedAt: now(), updatedBy: by })

    if (it.numericId) {
      try {
        await dictApi.updateItem(it.numericId, {
          code: x.code,
          name: x.name,
          level: x.level,
          scene_key: x.scen,
          aliases: x.aliases,
          definition: x.desc,
          is_required: x.required,
          version: it.version ?? 0,
        })
        it.version = (it.version ?? 0) + 1
      } catch (e) {
        console.warn('[dict] 后端更新词条失败', e)
      }
    }

    bump(
      by,
      '修改',
      it.name,
      beforeName !== it.name ? `重命名「${beforeName}」→「${it.name}」` : `更新词条「${it.name}」`
    )
  }

  async function remove(id: string, by: string) {
    const it = items.value.find((i) => i.id === id || String(i.numericId) === id)
    if (!it) return

    if (it.numericId) {
      try {
        await dictApi.deleteItem(it.numericId)
      } catch (e) {
        console.warn('[dict] 后端删除词条失败', e)
      }
    }

    items.value = items.value.filter((i) => i.id !== id && i.numericId !== it.numericId)
    bump(by, '删除', it.name, `删除词条「${it.name}」（${it.code}）`)
  }

  async function toggle(id: string, by: string) {
    const it = items.value.find((i) => i.id === id || String(i.numericId) === id)
    if (!it) return
    const next = it.status === 'active' ? 'inactive' : 'active'
    it.status = next
    it.updatedAt = now()
    it.updatedBy = by

    if (it.numericId) {
      try {
        await dictApi.toggleItem(it.numericId)
      } catch (e) {
        console.warn('[dict] 后端启停词条失败', e)
      }
    }

    bump(
      by,
      next === 'active' ? '启用' : '停用',
      it.name,
      `${next === 'active' ? '启用' : '停用'}词条「${it.name}」`
    )
  }

  const active = computed(() => items.value.filter((x) => x.status === 'active'))
  const fits = (x: DictItem, scen?: ScenKey) => !scen || x.scen === 'common' || x.scen === scen
  /** 标注下拉：某场景可用的子任务（标准在前，异常在后） */
  function actionsFor(scen?: ScenKey) {
    return active.value
      .filter((x) => x.category === 'action' && fits(x, scen))
      .sort((a, b) => (a.level === 'abnormal' ? 1 : 0) - (b.level === 'abnormal' ? 1 : 0))
  }
  const objectsFor = (scen?: ScenKey) => active.value.filter((x) => x.category === 'object' && fits(x, scen))
  /** 某场景核心必选子任务 */
  const requiredFor = (scen: ScenKey) =>
    active.value.filter((x) => x.category === 'action' && x.required && x.scen === scen).map((x) => x.name)
  /** 子任务（复合动作）的标准顺序，用于规则预切分 */
  const sequenceFor = (scen: ScenKey) =>
    active.value.filter((x) => x.level === 'compound' && x.scen === scen).map((x) => x.name)
  const isValid = (name: string) => active.value.some((x) => x.name === name)

  const byCode = (code: string) => items.value.find((x) => x.code === code)
  const byName = (name: string) => items.value.find((x) => x.name === name)

  if (getToken()) {
    fetchAll()
  }

  return {
    items,
    version,
    scenes,
    changes,
    loading,
    active,
    actionsFor,
    objectsFor,
    requiredFor,
    sequenceFor,
    isValid,
    add,
    update,
    remove,
    toggle,
    byCode,
    byName,
    fetchAll,
  }
})
