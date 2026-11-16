<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { SCEN, MODES, type ScenKey, type ModeKey } from '@/constants'
import { LEVELS, useDict, type ActLevel, type DictCat, type DictItem, type DictOp } from '@/stores/dict'
import { useAnnotate } from '@/stores/annotate'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'
import type { SceneItem } from '@/api'

/** 标注字典与场景管理 */
const dict = useDict()
const ann = useAnnotate()
const session = useSession()

// 主页签：'dict' | 'scenes'
const mainTab = ref<'dict' | 'scenes'>('dict')

/* ================= 词条字典相关 ================= */
type Tab = 'all' | ActLevel
const tab = ref<Tab>('all')
const scen = ref<'all' | ScenKey | 'common'>('all')
const q = ref('')
function match(x: DictItem, t: Tab) {
  if (t === 'all') return true
  return x.category === 'action' && (x.level ?? 'compound') === t
}
const rows = computed(() =>
  dict.items.filter((x) => {
    if (!match(x, tab.value)) return false
    if (scen.value !== 'all' && x.scen !== scen.value) return false
    const k = q.value.trim().toLowerCase()
    return !k || [x.name, x.code, ...x.aliases].some((v) => v.toLowerCase().includes(k))
  })
)
/** 被标注引用的次数 */
const usage = (name: string) =>
  ann.clips.reduce((a, c) => a + c.segs.filter((s) => s.n === name).length, 0)

const scenOpts = computed(() => {
  if (dict.scenes?.length) {
    return dict.scenes.map((s) => ({ value: s.scene_key, label: s.short_name || s.name }))
  }
  return (Object.keys(SCEN) as ScenKey[]).map((k) => ({ value: k, label: SCEN[k].short }))
})

const LEVEL_OPTS = (Object.keys(LEVELS) as ActLevel[]).map((k) => ({ value: k, label: LEVELS[k] }))
const scenLabel = (s: DictItem['scen']) => {
  if (s === 'common') return '通用'
  const found = dict.scenes.find((sc) => sc.scene_key === s)
  if (found) return found.short_name || found.name
  return (SCEN as any)[s]?.short ?? s
}

const modal = reactive({
  open: false,
  id: '',
  code: '',
  name: '',
  category: 'action' as DictCat,
  level: 'compound' as ActLevel,
  scen: 'common' as DictItem['scen'],
  aliases: '',
  desc: '',
  required: false,
})

function openAdd() {
  Object.assign(modal, {
    open: true,
    id: '',
    code: '',
    name: '',
    category: 'action',
    level: tab.value === 'all' ? 'compound' : tab.value,
    scen: 'common',
    aliases: '',
    desc: '',
    required: false,
  })
}

function openEdit(x: DictItem) {
  Object.assign(modal, {
    open: true,
    id: x.id,
    code: x.code,
    name: x.name,
    category: x.category,
    level: x.level ?? 'compound',
    scen: x.scen,
    aliases: x.aliases.join('、'),
    desc: x.desc,
    required: !!x.required,
  })
}

async function save() {
  const name = modal.name.trim(),
    code = modal.code.trim().toUpperCase()
  if (!name || !code) return toast('请填写编码与名称', { type: 'warn' })
  if (dict.items.some((x) => x.id !== modal.id && (x.name === name || x.code === code)))
    return toast('名称或编码与已有词条重复', { type: 'warn' })

  const isAct = modal.category === 'action'
  const data = {
    code,
    name,
    category: modal.category,
    scen: modal.scen,
    desc: modal.desc.trim(),
    aliases: modal.aliases
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    level: isAct ? modal.level : undefined,
    required: isAct && modal.level === 'compound' && modal.scen !== 'common' ? modal.required : false,
  }

  if (modal.id) {
    const old = dict.items.find((x) => x.id === modal.id)
    if (old && old.name !== name)
      ann.clips.forEach((c) =>
        c.segs.forEach((s) => {
          if (s.n === old.name) s.n = name
        })
      )
    await dict.update(modal.id, data, session.info.user)
    toast('已保存，字典升级为 ' + dict.version)
  } else {
    await dict.add(data, session.info.user)
    toast('已新增，字典升级为 ' + dict.version)
  }
  modal.open = false
}

async function del(x: DictItem) {
  const n = usage(x.name)
  const ok = await confirmDlg({
    title: '删除词条？',
    msg: n
      ? `「${x.name}」已被 ${n} 处标注引用，删除后这些标注提交时会提示“标签不在字典中”。建议改为停用。`
      : `确定删除「${x.name}」？`,
    ok: '删除',
    danger: true,
  })
  if (!ok) return
  await dict.remove(x.id, session.info.user)
  toast('已删除，字典升级为 ' + dict.version)
}

async function toggle(x: DictItem) {
  const next = x.status === 'active' ? '停用' : '启用'
  await dict.toggle(x.id, session.info.user)
  toast(`已${next}「${x.name}」`)
}

/* 变更记录视图：'list' | 'log' */
const view = ref<'list' | 'log'>('list')
const logQ = ref('')
const logOp = ref<'all' | DictOp>('all')
const logBy = ref('all')
const OPS: DictOp[] = ['新增', '修改', '启用', '停用', '删除']
const OP_CLS: Record<DictOp, string> = {
  新增: 'good',
  修改: 'info',
  启用: 'good',
  停用: 'warn',
  删除: 'crit',
}
const byOpts = computed(() => [
  { value: 'all', label: '全部操作人' },
  ...Array.from(new Set(dict.changes.map((c) => c.by))).map((u) => ({ value: u, label: u })),
])
const logs = computed(() =>
  dict.changes.filter((c) => {
    if (logOp.value !== 'all' && c.op !== logOp.value) return false
    if (logBy.value !== 'all' && c.by !== logBy.value) return false
    const k = logQ.value.trim()
    return !k || c.target.includes(k) || c.summary.includes(k)
  })
)

/* ================= 场景管理相关 ================= */
const sceneSearch = ref('')
const sceneStatus = ref<'all' | 'active' | 'disabled'>('all')
const sceneList = computed(() => {
  const q = sceneSearch.value.trim().toLowerCase()
  return dict.scenes.filter((s) => {
    if (sceneStatus.value === 'active' && !s.is_active) return false
    if (sceneStatus.value === 'disabled' && s.is_active) return false
    if (!q) return true
    return (
      s.name.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      s.scene_key.toLowerCase().includes(q) ||
      (s.short_name && s.short_name.toLowerCase().includes(q))
    )
  })
})

const sceneModal = reactive({
  open: false,
  isEdit: false,
  id: 0,
  scene_key: '',
  code: '',
  name: '',
  short_name: '',
  default_mode: 'vr' as 'vr' | 'umi',
  dur_min_s: 10,
  dur_max_s: 40,
  reset_desc: '',
  lang_template: '',
  specsStr: '18, 19, 20',
  is_active: true,
  sort_order: 1,
  saving: false,
})

function openAddScene() {
  Object.assign(sceneModal, {
    open: true,
    isEdit: false,
    id: 0,
    scene_key: '',
    code: '',
    name: '',
    short_name: '',
    default_mode: 'vr',
    dur_min_s: 10,
    dur_max_s: 40,
    reset_desc: '',
    lang_template: '',
    specsStr: '18, 19, 20',
    is_active: true,
    sort_order: dict.scenes.length + 1,
    saving: false,
  })
}

function openEditScene(s: SceneItem) {
  Object.assign(sceneModal, {
    open: true,
    isEdit: true,
    id: s.id,
    scene_key: s.scene_key,
    code: s.code,
    name: s.name,
    short_name: s.short_name,
    default_mode: s.default_mode,
    dur_min_s: s.dur_min_s,
    dur_max_s: s.dur_max_s,
    reset_desc: s.reset_desc || '',
    lang_template: s.lang_template || '',
    specsStr: (s.specs || []).join(', '),
    is_active: s.is_active,
    sort_order: s.sort_order,
    saving: false,
  })
}

async function saveScene() {
  if (!sceneModal.name.trim() || !sceneModal.code.trim()) {
    return toast('请填写场景名称与编码', { type: 'warn' })
  }
  if (!sceneModal.isEdit && !sceneModal.scene_key.trim()) {
    return toast('请填写场景标识 (scene_key)', { type: 'warn' })
  }

  const specs = sceneModal.specsStr
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)

  sceneModal.saving = true
  try {
    if (sceneModal.isEdit) {
      await dict.updateScene(sceneModal.id, {
        name: sceneModal.name.trim(),
        short_name: sceneModal.short_name.trim() || sceneModal.name.trim(),
        default_mode: sceneModal.default_mode,
        dur_min_s: Number(sceneModal.dur_min_s),
        dur_max_s: Number(sceneModal.dur_max_s),
        reset_desc: sceneModal.reset_desc.trim() || null,
        lang_template: sceneModal.lang_template.trim() || null,
        specs,
        is_active: sceneModal.is_active,
        sort_order: Number(sceneModal.sort_order),
      })
      toast('场景「' + sceneModal.name + '」已更新')
    } else {
      await dict.addScene({
        scene_key: sceneModal.scene_key.trim().toLowerCase(),
        code: sceneModal.code.trim().toUpperCase(),
        name: sceneModal.name.trim(),
        short_name: sceneModal.short_name.trim() || sceneModal.name.trim(),
        default_mode: sceneModal.default_mode,
        dur_min_s: Number(sceneModal.dur_min_s),
        dur_max_s: Number(sceneModal.dur_max_s),
        reset_desc: sceneModal.reset_desc.trim() || null,
        lang_template: sceneModal.lang_template.trim() || null,
        specs,
        is_active: sceneModal.is_active,
        sort_order: Number(sceneModal.sort_order),
      })
      toast('场景「' + sceneModal.name + '」已新增')
    }
    sceneModal.open = false
  } catch (err: any) {
    toast('保存失败: ' + err.message, { type: 'warn' })
  } finally {
    sceneModal.saving = false
  }
}

async function toggleSceneStatus(s: SceneItem) {
  try {
    await dict.updateScene(s.id, { is_active: !s.is_active })
    toast(`已${!s.is_active ? '启用' : '停用'}场景「${s.name}」`)
  } catch (err: any) {
    toast('状态修改失败: ' + err.message, { type: 'warn' })
  }
}

function wordCountOfScene(sceneKey: string) {
  return dict.items.filter((x) => x.scen === sceneKey).length
}
</script>

<template>
  <!-- 统一顶部 PageHead：集成赛博胶囊页签，去除两截式割裂感 -->
  <PageHead
    :title="mainTab === 'dict' ? '标注字典' : '采集场景管理'"
    :desc="mainTab === 'dict' ? '标注与审核共用一份字典 · 当前版本 ' + dict.version + '；子任务分标准 / 异常两类' : '规范化管理采集场景、默认遥操作/示教模式、节拍标准时长以及工件复位标准'"
  >
    <template #desc>
      <div class="head-tabs-wrap">
        <div class="cyber-tabs">
          <button
            type="button"
            class="cyber-tab-item"
            :class="{ active: mainTab === 'dict' }"
            @click="mainTab = 'dict'"
          >
            <AppIcon name="layers" size="sm" />
            <span>标注词条字典</span>
            <span class="count-badge">{{ dict.items.length }}</span>
          </button>
          <button
            type="button"
            class="cyber-tab-item"
            :class="{ active: mainTab === 'scenes' }"
            @click="mainTab = 'scenes'"
          >
            <AppIcon name="grid" size="sm" />
            <span>采集场景管理</span>
            <span class="count-badge">{{ dict.scenes.length }}</span>
          </button>
        </div>
      </div>
    </template>

    <!-- 右侧操作按钮联动 -->
    <template v-if="mainTab === 'dict'">
      <a-button @click="view = view === 'log' ? 'list' : 'log'">
        <AppIcon :name="view === 'log' ? 'left' : 'clock'" />
        <span>{{ view === 'log' ? '返回词条' : '操作记录' }}</span>
      </a-button>
      <a-button type="primary" @click="openAdd">
        <AppIcon name="plus" />新增词条
      </a-button>
    </template>
    <template v-else>
      <a-button
        type="primary"
        :disabled="!session.isAdmin"
        :title="session.isAdmin ? undefined : '仅系统管理员可新增场景'"
        @click="openAddScene"
      >
        <AppIcon name="plus" />新增场景
      </a-button>
    </template>
  </PageHead>

  <!-- ================= 词条字典视图 ================= -->
  <template v-if="mainTab === 'dict'">
    <template v-if="view === 'log'">
      <div class="card">
        <div class="toolbar">
          <a-input v-model:value="logQ" class="grow" allow-clear placeholder="搜索词条或内容" aria-label="搜索操作记录">
            <template #prefix><AppIcon name="search" /></template>
          </a-input>
          <a-select v-model:value="logOp" style="width:130px" aria-label="操作类型" :options="[{ value: 'all', label: '全部操作' }, ...OPS.map((v) => ({ value: v, label: v }))]" />
          <a-select v-model:value="logBy" style="width:130px" aria-label="操作人" :options="byOpts" />
        </div>
        <table class="stbl" aria-label="字典操作记录">
          <thead>
            <tr>
              <th style="width:150px">时间</th>
              <th style="width:90px">版本</th>
              <th style="width:90px">操作人</th>
              <th style="width:80px">操作</th>
              <th style="width:140px">词条</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, i) in logs" :key="i">
              <td class="num muted">{{ c.t }}</td>
              <td><span class="mono ver">{{ c.ver }}</span></td>
              <td>{{ c.by }}</td>
              <td><span class="tag" :class="OP_CLS[c.op]">{{ c.op }}</span></td>
              <td><b>{{ c.target }}</b></td>
              <td class="muted">{{ c.summary }}</td>
            </tr>
            <tr v-if="!logs.length">
              <td colspan="6" class="muted" style="text-align:center;padding:24px">没有匹配的记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <div class="card">
        <div class="toolbar">
          <a-input v-model:value="q" class="grow" allow-clear placeholder="搜索名称、编码、别名" aria-label="搜索词条">
            <template #prefix><AppIcon name="search" /></template>
          </a-input>
          <a-select
            v-model:value="scen"
            style="width:160px"
            aria-label="按场景筛选"
            :options="[{ value: 'all', label: '全部场景' }, { value: 'common', label: '通用' }, ...scenOpts]"
          />
          <a-select
            v-model:value="tab"
            style="width:140px"
            aria-label="按分级筛选"
            :options="[
              { value: 'all', label: '全部分级' },
              { value: 'compound', label: '标准子任务' },
              { value: 'abnormal', label: '异常子任务' },
            ]"
          />
        </div>
        <table class="stbl" aria-label="字典词条">
          <thead>
            <tr>
              <th style="width:120px">编码</th>
              <th style="width:120px">名称</th>
              <th style="width:110px">分级</th>
              <th style="width:110px;white-space:nowrap">场景</th>
              <th>定义与边界说明</th>
              <th style="width:150px">别名</th>
              <th style="width:60px">引用</th>
              <th style="width:64px">启用</th>
              <th style="width:120px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in rows" :key="x.id" :class="{ off: x.status !== 'active' }">
              <td class="mono"><b>{{ x.code }}</b></td>
              <td><b>{{ x.name }}</b> <span v-if="x.required" class="tag crit" style="font-size:11px">必选</span></td>
              <td>
                <span class="tag" :class="x.category === 'object' ? 'good' : x.level === 'abnormal' ? 'warn' : 'info'">
                  {{ x.category === 'object' ? '物体' : LEVELS[x.level ?? 'compound'] }}
                </span>
              </td>
              <td class="muted" style="white-space:nowrap">{{ scenLabel(x.scen) }}</td>
              <td class="muted" style="font-size:12.5px">{{ x.desc }}</td>
              <td><span v-for="a in x.aliases" :key="a" class="alias">{{ a }}</span></td>
              <td class="num muted">{{ usage(x.name) }}</td>
              <td><a-switch size="small" :checked="x.status === 'active'" :aria-label="'启用 ' + x.name" @change="toggle(x)" /></td>
              <td style="white-space:nowrap">
                <a-button size="small" type="link" @click="openEdit(x)">编辑</a-button>
                <a-button size="small" type="link" danger @click="del(x)">删除</a-button>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="9" class="muted" style="text-align:center;padding:24px">没有匹配的词条</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>

  <!-- ================= 采集场景管理视图 ================= -->
  <template v-else-if="mainTab === 'scenes'">
    <div class="card">
      <div class="toolbar">
        <a-input v-model:value="sceneSearch" class="grow" allow-clear placeholder="搜索场景名称、短名、标识或文件代号" aria-label="搜索采集场景">
          <template #prefix><AppIcon name="search" /></template>
        </a-input>
        <a-select
          v-model:value="sceneStatus"
          style="width:140px"
          aria-label="按状态筛选"
          :options="[
            { value: 'all', label: '全部状态' },
            { value: 'active', label: '已启用' },
            { value: 'disabled', label: '已停用' },
          ]"
        />
      </div>

      <div class="scenes-grid">
        <div v-for="s in sceneList" :key="s.id" class="scene-card" :class="{ disabled: !s.is_active }">
          <div class="sc-header">
            <div class="sc-title-wrap">
              <h3 class="sc-name">{{ s.name }}</h3>
              <span class="mono sc-code">{{ s.code }}</span>
            </div>
            <div class="sc-actions">
              <a-switch
                size="small"
                :checked="s.is_active"
                :disabled="!session.isAdmin"
                title="启用/停用场景"
                @change="toggleSceneStatus(s)"
              />
              <a-button size="small" type="link" :disabled="!session.isAdmin" @click="openEditScene(s)">编辑</a-button>
            </div>
          </div>

          <div class="sc-meta-row">
            <div class="sc-badge">
              <span class="tag" :class="s.default_mode === 'vr' ? 'info' : 'good'">
                {{ MODES[s.default_mode as ModeKey]?.name || s.default_mode.toUpperCase() }}
              </span>
            </div>
            <div class="sc-stat-pill">
              <AppIcon name="clock" style="margin-right:4px;font-size:12px" />
              <span>标准时长: <b>{{ s.dur_min_s }} ~ {{ s.dur_max_s }}s</b></span>
            </div>
            <div class="sc-stat-pill">
              <AppIcon name="tag" style="margin-right:4px;font-size:12px" />
              <span>专属词条: <b>{{ wordCountOfScene(s.scene_key) }} 个</b></span>
            </div>
          </div>

          <div class="sc-section">
            <div class="sc-label">工装复位与就位规范</div>
            <div class="sc-desc">{{ s.reset_desc || '暂无复位说明' }}</div>
          </div>

          <div v-if="s.lang_template" class="sc-section">
            <div class="sc-label">语言提示模板</div>
            <div class="sc-desc mono" style="font-size:12px;color:var(--accent)">{{ s.lang_template }}</div>
          </div>

          <div v-if="s.specs && s.specs.length" class="sc-section" style="margin-bottom:0">
            <div class="sc-label">适配工件规格尺寸</div>
            <div class="sc-specs">
              <span v-for="sp in s.specs" :key="sp" class="spec-tag">{{ sp }}寸</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>

  <!-- 词条编辑弹窗（整齐对齐化，640px 宽度） -->
  <a-modal
    v-model:open="modal.open"
    :title="modal.id ? '编辑词条' : '新增词条'"
    :width="640"
    centered
    ok-text="保存"
    cancel-text="取消"
    @ok="save"
  >
    <a-form layout="vertical">
      <div class="form-row-2">
        <a-form-item label="编码" required>
          <a-input v-model:value="modal.code" placeholder="如 CLAMP" />
        </a-form-item>
        <a-form-item label="名称" required>
          <a-input v-model:value="modal.name" placeholder="如 夹紧密封" />
        </a-form-item>
      </div>

      <div class="form-row-2">
        <a-form-item v-if="modal.category === 'action'" label="分级">
          <a-select v-model:value="modal.level" :options="LEVEL_OPTS" />
        </a-form-item>
        <a-form-item label="适用场景">
          <a-select v-model:value="modal.scen" :options="[{ value: 'common', label: '通用' }, ...scenOpts]" />
        </a-form-item>
      </div>

      <a-form-item v-if="modal.category === 'action' && modal.level === 'compound' && modal.scen !== 'common'">
        <a-checkbox v-model:checked="modal.required">该场景的必选子任务（未标注时提交会提示）</a-checkbox>
      </a-form-item>

      <a-form-item label="别名（逗号或顿号分隔）">
        <a-input v-model:value="modal.aliases" placeholder="如 夹紧、闭合气缸" />
      </a-form-item>

      <a-form-item label="定义与边界说明" style="margin-bottom:0">
        <a-textarea v-model:value="modal.desc" :rows="3" placeholder="清楚描述起止边界，便于标注员与审核员统一理解" />
      </a-form-item>
    </a-form>
  </a-modal>

  <!-- 场景编辑/新增弹窗（解决附件2：严格整体对齐、宽高规范化、680px 宽） -->
  <a-modal
    v-model:open="sceneModal.open"
    :title="sceneModal.isEdit ? '编辑采集场景' : '新增采集场景'"
    :width="680"
    centered
    :confirm-loading="sceneModal.saving"
    ok-text="保存场景"
    cancel-text="取消"
    @ok="saveScene"
  >
    <a-form layout="vertical">
      <div class="form-row-2">
        <a-form-item label="场景名称" required>
          <a-input v-model:value="sceneModal.name" placeholder="如 轮毂气密性检测" />
        </a-form-item>
        <a-form-item label="场景简称">
          <a-input v-model:value="sceneModal.short_name" placeholder="如 气密性检测" />
        </a-form-item>
      </div>

      <div class="form-row-2">
        <a-form-item required>
          <template #label>
            <span>场景代号（大写）</span>
            <small class="hint-text">命名前缀</small>
          </template>
          <a-input v-model:value="sceneModal.code" placeholder="如 VR_QMD" />
        </a-form-item>
        <a-form-item required>
          <template #label>
            <span>系统标识 (Key)</span>
            <small class="hint-text">英文小写</small>
          </template>
          <a-input v-model:value="sceneModal.scene_key" :disabled="sceneModal.isEdit" placeholder="如 qmd" />
        </a-form-item>
      </div>

      <div class="form-row-2">
        <a-form-item label="推荐采集模式" required>
          <a-select
            v-model:value="sceneModal.default_mode"
            :options="[
              { value: 'vr', label: 'VR 遥操作 (机械臂/头显/手套)' },
              { value: 'umi', label: 'UMI 手持 (手持夹爪快速采集)' },
            ]"
          />
        </a-form-item>
        <a-form-item label="节拍时长范围 (秒)" required>
          <div class="range-box">
            <a-input-number v-model:value="sceneModal.dur_min_s" :min="1" placeholder="最小" style="width:100%" />
            <span class="range-sep">~</span>
            <a-input-number v-model:value="sceneModal.dur_max_s" :min="1" placeholder="最大" style="width:100%" />
          </div>
        </a-form-item>
      </div>

      <a-form-item label="工装与工件复位规范" extra="录制前操作员必须确认的初始复位条件">
        <a-textarea v-model:value="sceneModal.reset_desc" :rows="2" placeholder="如 轮毂工件摆放到位、气密工装复位、压力表归零" />
      </a-form-item>

      <a-form-item label="任务语音/语言提示模板" extra="训练时对应的任务语义描述">
        <a-input v-model:value="sceneModal.lang_template" placeholder="如 对轮毂进行气密性检测" />
      </a-form-item>

      <a-form-item label="工件规格尺寸列表" extra="多个尺寸用英文逗号分隔" style="margin-bottom:0">
        <a-input v-model:value="sceneModal.specsStr" placeholder="如 18, 19, 20" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style scoped>
.head-tabs-wrap {
  margin-top: 10px;
}
.hint-text {
  font-size: 11.5px;
  color: var(--muted, #B6CADC);
  margin-left: 6px;
  font-weight: 400;
}
.stbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.stbl th { text-align: left; font-weight: 500; color: var(--muted); padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--surface-2); white-space: nowrap; }
.stbl td { padding: 9px 14px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.stbl tbody tr:last-child td { border-bottom: 0; }
.stbl tr.off td { opacity: .5; }
.alias { display: inline-block; font-size: 11px; padding: 0 6px; margin: 1px 3px 1px 0; border-radius: 4px; background: var(--surface-3); color: var(--muted); }
.vlog { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
.vlog li { display: flex; gap: 10px; }
.ver { flex: none; font-size: 12px; padding: 1px 6px; height: 20px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); }

/* 场景卡片网格样式 */
.scenes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
  padding: 16px;
}
.scene-card {
  background: var(--surface-2, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--line, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: all 0.2s ease;
}
.scene-card:hover {
  border-color: rgba(38, 198, 218, 0.4);
}
.scene-card.disabled {
  opacity: 0.55;
  filter: grayscale(0.6);
}
.sc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.sc-title-wrap {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.sc-name {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.sc-code {
  font-size: 11.5px;
  color: var(--accent);
}
.sc-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sc-meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.sc-stat-pill {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: var(--muted);
  background: var(--surface-3);
  padding: 2px 8px;
  border-radius: 4px;
}
.sc-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sc-label {
  font-size: 11.5px;
  color: var(--muted);
}
.sc-desc {
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--text);
}
.sc-specs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.spec-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--surface-3);
  color: var(--accent);
  border: 1px solid var(--line);
}
</style>
