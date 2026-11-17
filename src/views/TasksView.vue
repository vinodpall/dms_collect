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
import { useDict } from '@/stores/dict'
import { useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'

const tasks = useTasks()
const dict = useDict()
const session = useSession()
const ui = useUi()
const mayEdit = computed(() => session.can('tasks'))
const dis = computed(() => (mayEdit.value ? undefined : NO_PERM))

const st = reactive({ status: 'all' as 'all' | TaskStatus, scen: 'all', q: '', key: 'ts', dir: 'descend' as 'ascend' | 'descend' | null, page: 1 })
const selected = ref<string[]>([])
const STATUS_KEYS: TaskStatus[] = ['running', 'ready', 'paused', 'done', 'draft', 'cancel']
const STATUS_OPTS = [{ value: 'all', label: '全部状态' }, ...STATUS_KEYS.map((k) => ({ value: k, label: TASK_ST[k][1] }))]
const SCEN_OPTS = computed(() => {
  const list = dict.scenes?.length
    ? dict.scenes.map((s) => ({ value: s.scene_key, label: s.short_name || s.name }))
    : [
        { value: 'qmd', label: '气密性检测' },
        { value: 'fhd', label: '防护堵安装' },
      ]
  return [{ value: 'all', label: '全部场景' }, ...list]
})
const scenShort = (key: string) => dict.scenes?.find((s) => s.scene_key === key)?.short_name || SCEN[key]?.short || key

const rows = computed(() => {
  const q = st.q.toLowerCase()
  const out = tasks.list.filter((t) => (st.status === 'all' || t.status === st.status) && (st.scen === 'all' || t.scen === st.scen) && (!q || (t.id + t.name + OPS[t.op].n + scenShort(t.scen)).toLowerCase().includes(q)))
  return out.slice().sort((a, b) => b.ts - a.ts)
})
watch(() => [st.status, st.scen, st.q], () => { st.page = 1; selected.value = [] })

const columns = computed(() => [
  { title: '任务', key: 'id', width: 210, ellipsis: true, align: 'center' as const },
  { title: '场景 / 方式', key: 'scen', width: 190, ellipsis: true, align: 'center' as const },
  { title: '操作员', key: 'op', width: 110, ellipsis: true, align: 'center' as const },
  { title: '已采集', key: 'progress', width: 110, align: 'center' as const },
  { title: '状态', key: 'status', width: 110, align: 'center' as const },
  { title: '最近更新', key: 'ts', align: 'center' as const, width: 135, ellipsis: true },
])
function onTableChange(p: { current?: number }) {
  st.page = p.current ?? 1
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
const HIST_ST_OPTS = [{ value: 'all', label: '全部状态' }, ...(Object.keys(HIST_ST) as HistState[]).map((k) => ({ value: k, label: HIST_ST[k][1] }))]
const histCols = [
  { title: '文件', key: 'file', width: 220, ellipsis: true, align: 'center' as const },
  { title: '来源', key: 'source', width: 115, ellipsis: true, align: 'center' as const },
  { title: '任务', key: 'task', width: 100, ellipsis: true, align: 'center' as const },
  { title: '数据集', key: 'dataset', width: 110, ellipsis: true, align: 'center' as const },
  { title: '时长', key: 'dur', width: 85, align: 'center' as const },
  { title: '体量', key: 'size', width: 95, align: 'center' as const },
  { title: '状态', key: 'state', width: 115, align: 'center' as const },
  { title: '时间', key: 'at', width: 120, ellipsis: true, align: 'center' as const },
]
function openTask(id: string) { if (tasks.byId(id)) ui.taskDrawerId = id }
function retryAll() {
  let n = 0
  tasks.list.forEach((t) => [...t.retry].forEach((f) => { tasks.retryUpload(t, f); n++ }))
  toast(n ? `已重传 ${n} 个文件` : '没有待重传的文件', { type: n ? undefined : 'warn' })
}
const retryCount = computed(() => tasks.list.reduce((a, t) => a + t.retry.length, 0))
function clearFilters() { st.q = ''; st.status = 'all'; st.scen = 'all' }
function created(id: string) {
  st.status = 'all'; st.page = 1
  toast('任务 ' + id + ' 已创建', { action: '查看', onAction: () => (ui.taskDrawerId = id) })
}
</script>

<template>
  <PageHead title="采集任务" desc="每次采集：设备自检 → 场景复位与采集 → 数据校验 → 入库；也可上传视频或导入 LeRobot 数据">
    <template #desc>
      <div style="margin-top:10px">
        <div class="cyber-tabs" role="tablist" aria-label="任务视图切换">
          <button
            type="button"
            role="tab"
            class="cyber-tab-item"
            :class="{ active: tab === 'tasks' }"
            :aria-selected="tab === 'tasks'"
            @click="tab = 'tasks'"
          >
            <AppIcon name="task" size="sm" />
            <span>采集任务</span>
          </button>
          <button
            type="button"
            role="tab"
            class="cyber-tab-item"
            :class="{ active: tab === 'hist' }"
            :aria-selected="tab === 'hist'"
            @click="tab = 'hist'"
          >
            <AppIcon name="clock" size="sm" />
            <span>采集历史</span>
          </button>
        </div>
      </div>
    </template>
    <a-button :disabled="!mayEdit" :title="dis" @click="imp.kind = 'video'; imp.open = true"><AppIcon name="camera" />视频上传</a-button>
    <a-button :disabled="!mayEdit" :title="dis" @click="imp.kind = 'lerobot'; imp.open = true"><AppIcon name="db" />LeRobot 导入</a-button>
    <a-button type="primary" :disabled="!mayEdit" :title="dis" @click="ui.wizardOpen = true"><AppIcon name="plus" />新建任务</a-button>
  </PageHead>

  <div v-if="tab === 'hist'" class="card">
    <div class="toolbar">
      <a-input v-model:value="hs.q" class="grow" allow-clear placeholder="搜索文件名、任务、数据集" aria-label="搜索采集历史"><template #prefix><AppIcon name="search" /></template></a-input>
      <a-select v-model:value="hs.src" style="width:140px" aria-label="来源" :options="SRC_OPTS" />
      <a-select v-model:value="hs.state" style="width:140px" aria-label="状态" :options="HIST_ST_OPTS" />
      <a-button :disabled="!retryCount" @click="retryAll"><AppIcon name="refresh" size="sm" />全部重传</a-button>
    </div>
    <a-table size="middle" :row-key="(r: { file: string; task: string }) => r.file + r.task" :columns="histCols" :data-source="histRows" :pagination="{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: false, showTotal: (n: number) => `共 ${n} 条` }">
      <template #bodyCell="{ column, record }">
        <span v-if="column.key === 'file'" class="mono cell-ellipsis" style="font-size:12.5px" :title="record.file">{{ record.file }}</span>
        <span v-else-if="column.key === 'source'" class="cell-ellipsis" :title="HIST_SRC[record.source as HistSource] || record.source">{{ HIST_SRC[record.source as HistSource] || record.source }}</span>
        <a v-else-if="column.key === 'task' && record.task !== '—'" class="mono" @click="openTask(record.task)">{{ record.task }}</a>
        <span v-else-if="column.key === 'dataset'" class="mono muted cell-ellipsis" :title="record.dataset">{{ record.dataset }}</span>
        <span v-else-if="column.key === 'dur'" class="num">{{ record.dur }} s</span>
        <span v-else-if="column.key === 'size'" class="num muted">{{ record.size }} GB</span>
        <StatusBadge v-else-if="column.key === 'state'" :kind="HIST_ST[record.state as HistState][0]" :text="HIST_ST[record.state as HistState][1]" />
        <span v-else-if="column.key === 'at'" class="muted num cell-ellipsis">{{ record.at }}</span>
      </template>
      <template #emptyText><EmptyState icon="inbox" title="没有符合条件的记录" desc="换个筛选条件试试" /></template>
    </a-table>
  </div>

  <div v-else class="card">
    <div class="toolbar">
      <a-input v-model:value="st.q" class="grow" allow-clear placeholder="搜索任务编号、名称、操作员" aria-label="搜索任务"><template #prefix><AppIcon name="search" /></template></a-input>
      <a-select v-model:value="st.scen" style="width:150px" aria-label="场景" :options="SCEN_OPTS" />
      <a-select v-model:value="st.status" style="width:140px" aria-label="状态" :options="STATUS_OPTS" />
    </div>
    <div v-if="selected.length" class="bulkbar">
      <span>已选 {{ selected.length }} 项</span>
      <a-button size="small" :disabled="!mayEdit" :title="dis" @click="bulkPause"><AppIcon name="pause" size="sm" />批量暂停</a-button>
      <a-button size="small" danger :disabled="!mayEdit" :title="dis" @click="bulkCancel">批量取消</a-button>
      <a-button size="small" type="text" style="margin-left:auto" @click="selected = []">清除选择</a-button>
    </div>
    <a-table row-key="id" size="middle" :columns="columns" :data-source="rows" :row-selection="rowSelection" :custom-row="customRow"
      :pagination="{ current: st.page, pageSize: 8, showSizeChanger: false, hideOnSinglePage: false, showTotal: (n: number) => `共 ${n} 个任务` }" @change="onTableChange as never">
      <template #bodyCell="{ column, record }">
        <div v-if="column.key === 'id'" class="cell-main"><span class="mono" :title="record.id">{{ record.id }}</span><span :title="record.name">{{ record.name }}</span></div>
        <div v-else-if="column.key === 'scen'" class="cell-main"><span :title="scenShort(record.scen)">{{ scenShort(record.scen) }}</span><small class="muted" :title="`${MODES[record.mode as ModeKey]?.name || record.mode} · ${record.devices.length} 台设备`">{{ MODES[record.mode as ModeKey]?.name || record.mode }} · {{ record.devices.length }} 台设备</small></div>
        <span v-else-if="column.key === 'op'" class="cell-ellipsis" :title="OPS[record.op].n">{{ OPS[record.op].n }}</span>
        <span v-else-if="column.key === 'progress'" class="num"><b>{{ record.done }}</b> <span class="muted">条</span></span>
        <StatusBadge v-else-if="column.key === 'status'" :kind="TASK_ST[record.status as TaskStatus][0]" :text="TASK_ST[record.status as TaskStatus][1]" />
        <span v-else-if="column.key === 'ts'" class="muted num cell-ellipsis">{{ record.updated }}</span>
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
