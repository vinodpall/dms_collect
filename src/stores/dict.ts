import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ScenKey } from '@/constants'
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
  numericId: number
  code: string
  name: string
  category: DictCat
  level?: ActLevel
  scen: ScenKey | 'common'
  aliases: string[]
  desc: string
  required?: boolean
  status: 'active' | 'inactive'
  refCount: number
  updatedAt: string
  updatedBy: string
  version: number
}

export type DictOp = '新增' | '修改' | '启用' | '停用' | '删除'
export interface DictChange {
  id: number
  ver: string
  t: string
  by: string
  op: DictOp
  target: string
  summary: string
}

const OP_MAP: Record<string, DictOp> = {
  create: '新增',
  add: '新增',
  update: '修改',
  edit: '修改',
  enable: '启用',
  activate: '启用',
  disable: '停用',
  deactivate: '停用',
  delete: '删除',
  remove: '删除',
  '新增': '新增',
  '修改': '修改',
  '启用': '启用',
  '停用': '停用',
  '删除': '删除',
}

function mapChangeType(raw: string): DictOp {
  return OP_MAP[raw?.toLowerCase?.() || raw] || '修改'
}

export const useDict = defineStore('dict', () => {
  const items = ref<DictItem[]>([])
  const version = ref('—')
  const scenes = ref<SceneItem[]>([])
  const changes = ref<DictChange[]>([])
  const loading = ref(false)

  function mapEntity(item: DictItemEntity): DictItem {
    return {
      id: item.item_no || `D-${item.id}`,
      numericId: item.id,
      code: item.code,
      name: item.name,
      category: (item.category as DictCat) || 'action',
      level: item.level ? (item.level as ActLevel) : undefined,
      scen: (item.scene_key as ScenKey | 'common') || 'common',
      aliases: Array.isArray(item.aliases) ? item.aliases : [],
      desc: item.definition || '',
      required: !!item.is_required,
      status: item.status,
      refCount: item.ref_count ?? 0,
      updatedAt: item.updated_at ? item.updated_at.replace('T', ' ').slice(0, 16) : '—',
      updatedBy: item.updated_by_name || '—',
      version: item.version ?? 0,
    }
  }

  /** 从后端拉取版本、词条、变更记录与场景 */
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
      if (scenesRes.status === 'fulfilled' && Array.isArray(scenesRes.value)) {
        scenes.value = scenesRes.value
      }
      if (itemsRes.status === 'fulfilled' && Array.isArray(itemsRes.value)) {
        items.value = itemsRes.value.map(mapEntity)
      }
      if (changesRes.status === 'fulfilled' && Array.isArray(changesRes.value)) {
        changes.value = changesRes.value.map((c: DictChangeItem) => ({
          id: c.id,
          ver: c.version,
          t: c.created_at ? c.created_at.replace('T', ' ').slice(0, 16) : '—',
          by: c.operator_name || '系统',
          op: mapChangeType(c.change_type),
          target: c.target_name,
          summary: c.summary,
        }))
      }
    } finally {
      loading.value = false
    }
  }

  async function add(
    x: Omit<DictItem, 'id' | 'numericId' | 'status' | 'refCount' | 'updatedAt' | 'updatedBy' | 'version'>
  ) {
    await dictApi.createItem({
      code: x.code,
      name: x.name,
      category: x.category,
      level: x.level ?? null,
      scene_key: x.scen,
      aliases: x.aliases,
      definition: x.desc || null,
      is_required: !!x.required,
    })
    await fetchAll()
  }

  async function update(
    id: string,
    x: Partial<Omit<DictItem, 'id' | 'numericId' | 'status' | 'refCount' | 'updatedAt' | 'updatedBy' | 'version'>>
  ) {
    const it = items.value.find((i) => i.id === id || String(i.numericId) === id)
    if (!it) throw new Error('词条不存在')
    await dictApi.updateItem(it.numericId, {
      code: x.code,
      name: x.name,
      level: x.level ?? null,
      scene_key: x.scen,
      aliases: x.aliases,
      definition: x.desc ?? null,
      is_required: x.required ?? null,
      version: it.version,
    })
    await fetchAll()
  }

  async function remove(id: string) {
    const it = items.value.find((i) => i.id === id || String(i.numericId) === id)
    if (!it) throw new Error('词条不存在')
    await dictApi.deleteItem(it.numericId)
    await fetchAll()
  }

  async function toggle(id: string) {
    const it = items.value.find((i) => i.id === id || String(i.numericId) === id)
    if (!it) throw new Error('词条不存在')
    await dictApi.toggleItem(it.numericId)
    await fetchAll()
  }

  async function addScene(data: any) {
    const res = await dictApi.createScene(data)
    await fetchAll()
    return res
  }

  async function updateScene(id: number, data: any) {
    const res = await dictApi.updateScene(id, data)
    await fetchAll()
    return res
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

  function reset() {
    items.value = []
    version.value = '—'
    scenes.value = []
    changes.value = []
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('dms:login', () => {
      fetchAll().catch(() => {})
    })
    window.addEventListener('dms:logout', reset)
  }

  if (getToken()) {
    fetchAll().catch((e) => console.warn('[dict] 初始化失败', e))
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
    addScene,
    updateScene,
    byCode,
    byName,
    fetchAll,
    reset,
  }
})
