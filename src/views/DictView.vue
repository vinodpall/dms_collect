<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import { SCEN, type ScenKey } from '@/constants'
import { LEVELS, useDict, type ActLevel, type DictCat, type DictItem, type DictOp } from '@/stores/dict'
import { useAnnotate } from '@/stores/annotate'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'

/** 统一标注字典：标注员下拉选项与审核校验共用这一份；子任务分标准 / 异常；每次修改递增版本 */
const dict = useDict()
const ann = useAnnotate()
const session = useSession()

type Tab = 'all' | ActLevel
const tab = ref<Tab>('all')
const scen = ref<'all' | ScenKey | 'common'>('all')
const q = ref('')
const TABS: [Tab, string][] = [['all', '全部'], ['compound', '标准子任务'], ['abnormal', '异常子任务']]
const count = (t: Tab) => dict.items.filter((x) => match(x, t)).length
function match(x: DictItem, t: Tab) {
  if (t === 'all') return true
  return x.category === 'action' && (x.level ?? 'compound') === t
}
const rows = computed(() => dict.items.filter((x) => {
  if (!match(x, tab.value)) return false
  if (scen.value !== 'all' && x.scen !== scen.value) return false
  const k = q.value.trim().toLowerCase()
  return !k || [x.name, x.code, ...x.aliases].some((v) => v.toLowerCase().includes(k))
}))
/** 被标注引用的次数，删除前提示 */
const usage = (name: string) => ann.clips.reduce((a, c) => a + c.segs.filter((s) => s.n === name).length, 0)
const SCEN_OPTS = (Object.keys(SCEN) as ScenKey[]).map((k) => ({ value: k, label: SCEN[k].short }))
const LEVEL_OPTS = (Object.keys(LEVELS) as ActLevel[]).map((k) => ({ value: k, label: LEVELS[k] }))
const scenLabel = (s: DictItem['scen']) => (s === 'common' ? '通用' : SCEN[s].short)

const modal = reactive({ open: false, id: '', code: '', name: '', category: 'action' as DictCat, level: 'compound' as ActLevel, scen: 'common' as DictItem['scen'], aliases: '', desc: '', required: false })
function openAdd() {
  Object.assign(modal, { open: true, id: '', code: '', name: '', category: 'action', level: tab.value === 'all' ? 'compound' : tab.value, scen: 'common', aliases: '', desc: '', required: false })
}
function openEdit(x: DictItem) {
  Object.assign(modal, { open: true, id: x.id, code: x.code, name: x.name, category: x.category, level: x.level ?? 'compound', scen: x.scen, aliases: x.aliases.join('、'), desc: x.desc, required: !!x.required })
}
function save() {
  const name = modal.name.trim(), code = modal.code.trim().toUpperCase()
  if (!name || !code) return toast('请填写编码与名称', { type: 'warn' })
  if (dict.items.some((x) => x.id !== modal.id && (x.name === name || x.code === code))) return toast('名称或编码与已有词条重复', { type: 'warn' })
  const isAct = modal.category === 'action'
  const data = {
    code, name, category: modal.category, scen: modal.scen, desc: modal.desc.trim(),
    aliases: modal.aliases.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean),
    level: isAct ? modal.level : undefined,
    required: isAct && modal.level === 'compound' && modal.scen !== 'common' ? modal.required : false,
  }
  if (modal.id) {
    const old = dict.items.find((x) => x.id === modal.id)
    if (old && old.name !== name) ann.clips.forEach((c) => c.segs.forEach((s) => { if (s.n === old.name) s.n = name }))
    dict.update(modal.id, data, session.info.user)
    toast('已保存，字典升级为 ' + dict.version)
  } else {
    dict.add(data, session.info.user)
    toast('已新增，字典升级为 ' + dict.version)
  }
  modal.open = false
}
async function del(x: DictItem) {
  const n = usage(x.name)
  const ok = await confirmDlg({ title: '删除词条？', msg: n ? `「${x.name}」已被 ${n} 处标注引用，删除后这些标注提交时会提示“标签不在字典中”。建议改为停用。` : `确定删除「${x.name}」？`, ok: '删除', danger: true })
  if (!ok) return
  dict.remove(x.id, session.info.user)
  toast('已删除，字典升级为 ' + dict.version)
}
function toggle(x: DictItem) {
  dict.toggle(x.id, session.info.user)
  toast((x.status === 'active' ? '已启用' : '已停用') + '，字典升级为 ' + dict.version)
}

/** 操作记录子页 */
const view = ref<'list' | 'log'>('list')
const logQ = ref('')
const logOp = ref<'all' | DictOp>('all')
const logBy = ref('all')
const OPS: DictOp[] = ['新增', '修改', '启用', '停用', '删除']
const OP_CLS: Record<DictOp, string> = { 新增: 'good', 修改: 'info', 启用: 'good', 停用: 'warn', 删除: 'crit' }
const byOpts = computed(() => [{ value: 'all', label: '全部操作人' }, ...[...new Set(dict.changes.map((c) => c.by))].map((v) => ({ value: v, label: v }))])
const logs = computed(() => dict.changes.filter((c) => {
  if (logOp.value !== 'all' && c.op !== logOp.value) return false
  if (logBy.value !== 'all' && c.by !== logBy.value) return false
  const k = logQ.value.trim()
  return !k || c.target.includes(k) || c.summary.includes(k)
}))
</script>

<template>
  <template v-if="view === 'log'">
    <PageHead title="字典操作记录" :desc="'当前版本 ' + dict.version + ' · 共 ' + dict.changes.length + ' 条记录，每次新增、修改、启停、删除都会升级版本'">
      <a-button @click="view = 'list'"><AppIcon name="left" />返回字典</a-button>
    </PageHead>
    <div class="card">
      <div class="toolbar">
        <a-input v-model:value="logQ" class="grow" allow-clear placeholder="搜索词条或内容" aria-label="搜索操作记录"><template #prefix><AppIcon name="search" /></template></a-input>
        <a-select v-model:value="logOp" style="width:130px" aria-label="操作类型" :options="[{ value: 'all', label: '全部操作' }, ...OPS.map((v) => ({ value: v, label: v }))]" />
        <a-select v-model:value="logBy" style="width:130px" aria-label="操作人" :options="byOpts" />
      </div>
      <table class="stbl" aria-label="字典操作记录">
        <thead><tr><th style="width:150px">时间</th><th style="width:90px">版本</th><th style="width:90px">操作人</th><th style="width:80px">操作</th><th style="width:140px">词条</th><th>内容</th></tr></thead>
        <tbody>
          <tr v-for="(c, i) in logs" :key="i">
            <td class="num muted">{{ c.t }}</td>
            <td><span class="mono ver">{{ c.ver }}</span></td>
            <td>{{ c.by }}</td>
            <td><span class="tag" :class="OP_CLS[c.op]">{{ c.op }}</span></td>
            <td><b>{{ c.target }}</b></td>
            <td class="muted">{{ c.summary }}</td>
          </tr>
          <tr v-if="!logs.length"><td colspan="6" class="muted" style="text-align:center;padding:24px">没有匹配的记录</td></tr>
        </tbody>
      </table>
    </div>
  </template>

  <template v-else>
  <PageHead title="标注字典" :desc="'标注与审核共用一份字典 · 当前版本 ' + dict.version + '；子任务分标准 / 异常两类'">
    <a-button @click="view = 'log'"><AppIcon name="clock" />操作记录</a-button>
    <a-button type="primary" @click="openAdd"><AppIcon name="plus" />新增词条</a-button>
  </PageHead>

  <div class="card">
      <div class="toolbar">
        <a-input v-model:value="q" class="grow" allow-clear placeholder="搜索名称、编码、别名" aria-label="搜索词条"><template #prefix><AppIcon name="search" /></template></a-input>
        <a-select v-model:value="scen" style="width:150px" aria-label="按场景筛选" :options="[{ value: 'all', label: '全部场景' }, { value: 'common', label: '通用' }, ...SCEN_OPTS]" />
      </div>
      <div class="toolbar" style="border-bottom:0;padding-bottom:0">
        <div class="chips"><button v-for="t in TABS" :key="t[0]" type="button" class="chip" :aria-pressed="tab === t[0]" @click="tab = t[0]">{{ t[1] }} <span class="n num">{{ count(t[0]) }}</span></button></div>
      </div>
      <table class="stbl" aria-label="字典词条">
        <thead><tr><th style="width:120px">编码</th><th style="width:120px">名称</th><th style="width:110px">分级</th><th style="width:100px;white-space:nowrap">场景</th><th>定义</th><th style="width:150px">别名</th><th style="width:60px">引用</th><th style="width:64px">启用</th><th style="width:120px">操作</th></tr></thead>
        <tbody>
          <tr v-for="x in rows" :key="x.id" :class="{ off: x.status !== 'active' }">
            <td class="mono"><b>{{ x.code }}</b></td>
            <td><b>{{ x.name }}</b> <span v-if="x.required" class="tag crit" style="font-size:11px">必选</span></td>
            <td><span class="tag" :class="x.category === 'object' ? 'good' : x.level === 'abnormal' ? 'warn' : 'info'">{{ x.category === 'object' ? '物体' : LEVELS[x.level ?? 'compound'] }}</span></td>
            <td class="muted" style="white-space:nowrap">{{ scenLabel(x.scen) }}</td>
            <td class="muted" style="font-size:12.5px">{{ x.desc }}</td>
            <td><span v-for="a in x.aliases" :key="a" class="alias">{{ a }}</span></td>
            <td class="num muted">{{ usage(x.name) }}</td>
            <td><a-switch size="small" :checked="x.status === 'active'" :aria-label="'启用 ' + x.name" @change="toggle(x)" /></td>
            <td style="white-space:nowrap"><a-button size="small" type="link" @click="openEdit(x)">编辑</a-button><a-button size="small" type="link" danger @click="del(x)">删除</a-button></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="9" class="muted" style="text-align:center;padding:24px">没有匹配的词条</td></tr>
        </tbody>
      </table>
    </div>

  </template>

  <a-modal v-model:open="modal.open" :title="modal.id ? '编辑词条' : '新增词条'" centered ok-text="保存" cancel-text="取消" @ok="save">
    <a-form layout="vertical">
      <div class="row" style="gap:12px">
        <a-form-item label="编码" required style="flex:1"><a-input v-model:value="modal.code" placeholder="如 CLAMP" /></a-form-item>
        <a-form-item label="名称" required style="flex:1"><a-input v-model:value="modal.name" placeholder="如 夹紧密封" /></a-form-item>
      </div>
      <div class="row" style="gap:12px">
        
        <a-form-item v-if="modal.category === 'action'" label="分级" style="flex:1"><a-select v-model:value="modal.level" :options="LEVEL_OPTS" /></a-form-item>
        <a-form-item label="适用场景" style="flex:1"><a-select v-model:value="modal.scen" :options="[{ value: 'common', label: '通用' }, ...SCEN_OPTS]" /></a-form-item>
      </div>
      <a-form-item v-if="modal.category === 'action' && modal.level === 'compound' && modal.scen !== 'common'">
        <a-checkbox v-model:checked="modal.required">该场景的必选子任务（未标注时提交会提示）</a-checkbox>
      </a-form-item>
      <a-form-item label="别名（逗号或顿号分隔）"><a-input v-model:value="modal.aliases" placeholder="如 夹紧、闭合气缸" /></a-form-item>
      <a-form-item label="定义"><a-textarea v-model:value="modal.desc" :rows="3" placeholder="清楚描述起止边界，便于标注员与审核员统一理解" /></a-form-item>
    </a-form>
  </a-modal>
</template>

<style scoped>
.stbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.stbl th { text-align: left; font-weight: 500; color: var(--muted); padding: 8px; border-bottom: 1px solid var(--line); background: var(--surface-2); }
.stbl td { padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.stbl tr.off td { opacity: .5; }
.alias { display: inline-block; font-size: 11px; padding: 0 6px; margin: 1px 3px 1px 0; border-radius: 4px; background: var(--surface-3); color: var(--muted); }
.vlog { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
.vlog li { display: flex; gap: 10px; }
.ver { flex: none; font-size: 12px; padding: 1px 6px; height: 20px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); }
</style>
