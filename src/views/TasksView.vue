<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import TaskDrawer from '@/components/tasks/TaskDrawer.vue'
import TaskWizard from '@/components/tasks/TaskWizard.vue'
import { NO_PERM, OPS, SCEN, TASK_ST, type TaskStatus } from '@/constants'
import { useTasks, type Task } from '@/stores/tasks'
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
function clearFilters() { st.q = ''; st.status = 'all'; st.scen = 'all' }
function created(id: string) {
  st.status = 'all'; st.page = 1
  toast('任务 ' + id + ' 已创建', { action: '查看', onAction: () => (ui.taskDrawerId = id) })
}
</script>

<template>
  <PageHead title="采集任务" desc="创建任务、执行 SOP、跟踪采集进度">
    <a-button type="primary" :disabled="!mayEdit" :title="dis" @click="ui.wizardOpen = true"><AppIcon name="plus" />新建任务</a-button>
  </PageHead>

  <div class="card">
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
        <div v-else-if="column.key === 'scen'" class="cell-main"><span>{{ SCEN[record.scen as 'qmd' | 'fhd'].short }}</span><small class="muted">{{ SCEN[record.scen as 'qmd' | 'fhd'].mode }} · {{ record.devices.length }} 台设备</small></div>
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
</template>
