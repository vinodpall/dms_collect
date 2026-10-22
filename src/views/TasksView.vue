<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import TaskDrawer from '@/components/tasks/TaskDrawer.vue'
import TaskWizard from '@/components/tasks/TaskWizard.vue'
import ImportDialog from '@/components/tasks/ImportDialog.vue'
import { MODES, NO_PERM, OPS, SCEN, TASK_ST, type ModeKey, type TaskStatus } from '@/constants'
import { HIST_SRC, HIST_ST, useTasks, type HistSource, type HistState, type Task } from '@/stores/tasks'
import { useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'

const tasks = useTasks()
const session = useSession()
const ui = useUi()
const mayEdit = computed(() => session.can('tasks'))
const dis = computed(() => (mayEdit.value ? undefined : NO_PERM))

const st = reactive({ status: 'all' as 'all' | TaskStatus, scen: 'all', q: '', key: 'ts', dir: 'descend' as 'ascend' | 'descend' | null, page: 1 })
const selected = ref<string[]>([])
const chips: ['all' | TaskStatus, string][] = [['all', '全部'], ['running', '采集中'], ['ready', '待开始'], ['paused', '已暂停'], ['done', '已完成'], ['draft', '草稿'], ['cancel', '已取消']]
const count = (k: 'all' | TaskStatus) => (k === 'all' ? tasks.list.length : tasks.list.filter((t) => t.status === k).length)

const rows = computed(() => {
  const q = st.q.toLowerCase()
  const out = tasks.list.filter((t) => (st.status === 'all' || t.status === st.status) && (st.scen === 'all' || t.scen === st.scen) && (!q || (t.id + t.name + OPS[t.op].n + SCEN[t.scen].name).toLowerCase().includes(q)))
  const keyFn: Record<string, (t: Task) => number | string> = { id: (t) => t.id, progress: (t) => t.done, status: (t) => TASK_ST[t.status][1], ts: (t) => t.ts }
  const f = keyFn[st.key]
  const d = st.dir === 'ascend' ? 1 : -1
  return out.slice().sort((a, b) => { const x = f(a), y = f(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh')) * d })
})
watch(() => [st.status, st.scen, st.q], () => { st.page = 1; selected.value = [] })

const columns = computed(() => [
  { title: '任务', key: 'id', sorter: true, sortOrder: st.key === 'id' ? st.dir : null },
  { title: '场景 / 方式', key: 'scen' },
  { title: '操作员', key: 'op', width: 100 },
  { title: '已采集', key: 'progress', width: 130, sorter: true, sortOrder: st.key === 'progress' ? st.dir : null },
  { title: '状态', key: 'status', width: 110, sorter: true, sortOrder: st.key === 'status' ? st.dir : null },
  { title: '最近更新', key: 'ts', align: 'right' as const, width: 130, sorter: true, sortOrder: st.key === 'ts' ? st.dir : null },
])
function onTableChange(p: { current?: number }, _f: unknown, s: { columnKey?: string; order?: 'ascend' | 'descend' | null }) {
  st.page = p.current ?? 1
  if (s && s.columnKey) { st.key = String(s.columnKey); st.dir = s.order ?? null; if (!s.order) { st.key = 'ts'; st.dir = 'descend' } }
}
const rowSelection = computed(() => ({ selectedRowKeys: selected.value, onChange: (k: (string | number)[]) => { selected.value = k as string[] } }))
const customRow = (r: Task) => ({
  class: 'row-click',
  onClick: (e: MouseEvent) => { if ((e.target as HTMLElement).closest('.ant-table-selection-column')) return; ui.taskDrawerId = r.id },
})
const selTasks = computed(() => selected.value.map((id) => tasks.byId(id)).filter((t): t is Task => !!t))

function bulkPause() {
  const hit = selTasks.value.filter((t) => t.status === 'running')
  if (!hit.length) { toast('所选任务中没有“采集中”的任务', { type: 'warn' }); return }
  hit.forEach((t) => { t.status = 'paused'; tasks.touch(t) })
  selected.value = []; toast('已暂停 ' + hit.length + ' 个任务')
}
async function bulkCancel() {
  const hit = selTasks.value.filter((t) => t.status !== 'done' && t.status !== 'cancel')
  if (!hit.length) { toast('所选任务已完成或已取消，无需再取消', { type: 'warn' }); return }
  const ok = await confirmDlg({ title: '取消 ' + hit.length + ' 个任务？', msg: '取消后任务不再接收新数据，已采集的 ' + hit.reduce((a, t) => a + t.done, 0) + ' 条数据会保留。之后可以在任务详情里重新开启。', ok: '确认取消', danger: true })
  if (!ok) return
  hit.forEach((t) => { t.status = 'cancel'; tasks.touch(t) })
  selected.value = []; toast('已取消 ' + hit.length + ' 个任务')
}
/* 采集历史：Episode 粒度，含采集产出、视频上传、LeRobot 导入 */
const tab = ref<'tasks' | 'hist'>('tasks')
const imp = reactive({ open: false, kind: 'video' as 'video' | 'lerobot' })
const hs = reactive({ q: '', src: 'all' as 'all' | HistSource, state: 'all' as 'all' | HistState })
const hist = computed(() => tasks.history())
const histRows = computed(() => {
  const q = hs.q.trim().toLowerCase()
  return hist.value.filter((r) => (hs.src === 'all' || r.source === hs.src) && (hs.state === 'all' || r.state === hs.state) && (!q || (r.file + r.task + r.dataset).toLowerCase().includes(q)))
})
const SRC_OPTS = [{ value: 'all', label: '全部来源' }, ...(Object.keys(HIST_SRC) as HistSource[]).map((k) => ({ value: k, label: HIST_SRC[k] }))]
const HIST_CHIPS: ['all' | HistState, string][] = [['all', '全部'], ...(Object.keys(HIST_ST) as HistState[]).map((k): [HistState, string] => [k, HIST_ST[k][1]])]
const histCount = (k: 'all' | HistState) => (k === 'all' ? hist.value.length : hist.value.filter((r) => r.state === k).length)
const histCols = [
  { title: '文件', key: 'file' },
  { title: '来源', key: 'source', width: 120 },
  { title: '任务', key: 'task', width: 100 },
  { title: '数据集', key: 'dataset', width: 90 },
  { title: '时长', key: 'dur', width: 80, align: 'right' as const },
  { title: '体量', key: 'size', width: 90, align: 'right' as const },
  { title: '状态', key: 'state', width: 120 },
  { title: '时间', key: 'at', width: 110, align: 'right' as const },
]
function openTask(id: string) { if (tasks.byId(id)) ui.taskDrawerId = id }
function retryAll() {
  let n = 0
  tasks.list.forEach((t) => [...t.retry].forEach((f) => { tasks.retryUpload(t, f); n++ }))
  toast(n ? `已重传 ${n} 个文件` : '没有待重传的文件', { type: n ? undefined : 'warn' })
}
const kpi = computed(() => ({
  running: tasks.list.filter((t) => t.status === 'running').length,
  today: tasks.list.reduce((a, t) => a + (t.session?.eps ?? 0), 0),
  retry: tasks.list.reduce((a, t) => a + t.retry.length, 0),
  imported: tasks.imports.length,
}))
function clearFilters() { st.q = ''; st.status = 'all'; st.scen = 'all' }
function created(id: string) {
  st.status = 'all'; st.page = 1
  toast('任务 ' + id + ' 已创建', { action: '查看', onAction: () => (ui.taskDrawerId = id) })
}
</script>

<template>
  <PageHead title="采集任务" desc="每次采集：设备自检 → 场景复位与采集 → 数据校验 → 入库；也可上传视频或导入 LeRobot 数据">
    <div class="seg" role="tablist">
      <button type="button" role="tab" :aria-selected="tab === 'tasks'" @click="tab = 'tasks'"><span>采集任务</span></button>
      <button type="button" role="tab" :aria-selected="tab === 'hist'" @click="tab = 'hist'"><span>采集历史</span></button>
    </div>
    <a-button :disabled="!mayEdit" :title="dis" @click="imp.kind = 'video'; imp.open = true"><AppIcon name="camera" />视频上传</a-button>
    <a-button :disabled="!mayEdit" :title="dis" @click="imp.kind = 'lerobot'; imp.open = true"><AppIcon name="db" />LeRobot 导入</a-button>
    <a-button type="primary" :disabled="!mayEdit" :title="dis" @click="ui.wizardOpen = true"><AppIcon name="plus" />新建任务</a-button>
  </PageHead>

  <div class="grid g4" style="margin-bottom:16px">
    <button type="button" class="card kpi" @click="tab = 'tasks'; st.status = 'running'"><span class="k">采集中任务 <AppIcon name="right" size="sm" /></span><span class="v">{{ kpi.running }}<small>个</small></span><span class="d">设备按工位占用，互不冲突</span></button>
    <div class="card kpi"><span class="k">本次会话采集</span><span class="v">{{ kpi.today }}<small>条</small></span><span class="d">进行中任务的当前会话合计</span></div>
    <button type="button" class="card kpi" @click="tab = 'hist'; hs.state = 'retry'"><span class="k">待重传 <AppIcon name="right" size="sm" /></span><span class="v">{{ kpi.retry }}<small>个文件</small></span><span class="d">上传中断，自动重试失败</span></button>
    <button type="button" class="card kpi" @click="tab = 'hist'; hs.src = 'all'; hs.state = 'all'"><span class="k">外部导入 <AppIcon name="right" size="sm" /></span><span class="v">{{ kpi.imported }}<small>批</small></span><span class="d">视频上传 / LeRobot 导入</span></button>
  </div>

  <div v-if="tab === 'hist'" class="card">
    <div class="toolbar">
      <a-input v-model:value="hs.q" class="grow" allow-clear placeholder="搜索文件名、任务、数据集" aria-label="搜索采集历史"><template #prefix><AppIcon name="search" /></template></a-input>
      <a-select v-model:value="hs.src" style="width:140px" aria-label="来源" :options="SRC_OPTS" />
      <a-button :disabled="!kpi.retry" @click="retryAll"><AppIcon name="refresh" size="sm" />全部重传</a-button>
    </div>
    <div class="toolbar" style="border-bottom:0;padding-bottom:0">
      <div class="chips"><button v-for="c in HIST_CHIPS" :key="c[0]" type="button" class="chip" :aria-pressed="hs.state === c[0]" @click="hs.state = c[0]">{{ c[1] }} <span class="n num">{{ histCount(c[0]) }}</span></button></div>
    </div>
    <a-table :row-key="(r: { file: string; task: string }) => r.file + r.task" :columns="histCols" :data-source="histRows" :scroll="{ x: 900 }" :pagination="{ pageSize: 12, hideOnSinglePage: true, showTotal: (n: number) => `共 ${n} 条` }">
      <template #bodyCell="{ column, record }">
        <span v-if="column.key === 'file'" class="mono" style="font-size:12.5px">{{ record.file }}</span>
        <span v-else-if="column.key === 'source'">{{ HIST_SRC[record.source as HistSource] }}</span>
        <a v-else-if="column.key === 'task' && record.task !== '—'" class="mono" @click="openTask(record.task)">{{ record.task }}</a>
        <span v-else-if="column.key === 'dataset'" class="mono muted">{{ record.dataset }}</span>
        <span v-else-if="column.key === 'dur'" class="num">{{ record.dur }} s</span>
        <span v-else-if="column.key === 'size'" class="num muted">{{ record.size }} GB</span>
        <StatusBadge v-else-if="column.key === 'state'" :kind="HIST_ST[record.state as HistState][0]" :text="HIST_ST[record.state as HistState][1]" />
        <span v-else-if="column.key === 'at'" class="muted num">{{ record.at }}</span>
      </template>
      <template #emptyText><EmptyState icon="inbox" title="没有符合条件的记录" desc="换个筛选条件试试" /></template>
    </a-table>
  </div>

  <div v-else class="card">
    <div class="toolbar">
      <a-input v-model:value="st.q" class="grow" allow-clear placeholder="搜索任务编号、名称、操作员" aria-label="搜索任务"><template #prefix><AppIcon name="search" /></template></a-input>
      <a-select v-model:value="st.scen" style="width:150px" aria-label="场景" :options="[{ value: 'all', label: '全部场景' }, { value: 'qmd', label: '气密性检测' }, { value: 'fhd', label: '防护堵安装' }]" />
    </div>
    <div class="toolbar" style="border-bottom:0;padding-bottom:0">
      <div class="chips"><button v-for="c in chips" :key="c[0]" type="button" class="chip" :aria-pressed="st.status === c[0]" @click="st.status = c[0]">{{ c[1] }} <span class="n num">{{ count(c[0]) }}</span></button></div>
    </div>
    <div v-if="selected.length" class="bulkbar">
      <span>已选 {{ selected.length }} 项</span>
      <a-button size="small" :disabled="!mayEdit" :title="dis" @click="bulkPause"><AppIcon name="pause" size="sm" />批量暂停</a-button>
      <a-button size="small" danger :disabled="!mayEdit" :title="dis" @click="bulkCancel">批量取消</a-button>
      <a-button size="small" type="text" style="margin-left:auto" @click="selected = []">清除选择</a-button>
    </div>
    <a-table row-key="id" :columns="columns" :data-source="rows" :row-selection="rowSelection" :custom-row="customRow" :scroll="{ x: 860 }"
      :pagination="{ current: st.page, pageSize: 8, showSizeChanger: false, hideOnSinglePage: false, showTotal: (n: number) => `共 ${n} 个任务` }" @change="onTableChange as never">
      <template #bodyCell="{ column, record }">
        <div v-if="column.key === 'id'" class="cell-main"><span class="mono">{{ record.id }}</span><span>{{ record.name }}</span></div>
        <div v-else-if="column.key === 'scen'" class="cell-main"><span>{{ SCEN[record.scen as 'qmd' | 'fhd'].short }}</span><small class="muted">{{ MODES[record.mode as ModeKey].name }} · {{ record.devices.length }} 台设备</small></div>
        <span v-else-if="column.key === 'op'">{{ OPS[record.op].n }}</span>
        <span v-else-if="column.key === 'progress'" class="num"><b>{{ record.done }}</b> <span class="muted">条</span></span>
        <StatusBadge v-else-if="column.key === 'status'" :kind="TASK_ST[record.status as TaskStatus][0]" :text="TASK_ST[record.status as TaskStatus][1]" />
        <span v-else-if="column.key === 'ts'" class="muted num">{{ record.updated }}</span>
      </template>
      <template #emptyText>
        <EmptyState icon="inbox" title="没有符合条件的任务" :desc="st.q || st.status !== 'all' || st.scen !== 'all' ? '换个关键词，或清除筛选条件试试' : '点击右上角“新建任务”开始第一次采集'"><a-button size="small" style="margin-top:6px" @click="clearFilters">清除筛选</a-button></EmptyState>
      </template>
    </a-table>
  </div>

  <TaskDrawer :id="ui.taskDrawerId" @close="ui.taskDrawerId = null" />
  <TaskWizard :open="ui.wizardOpen" @close="ui.wizardOpen = false" @done="created" />
  <ImportDialog :open="imp.open" :kind="imp.kind" @close="imp.open = false" />
</template>
