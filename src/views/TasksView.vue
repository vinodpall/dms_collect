<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import TaskDrawer from '@/components/tasks/TaskDrawer.vue'
import TaskWizard from '@/components/tasks/TaskWizard.vue'
import ImportDialog, { type ImportMode } from '@/components/tasks/ImportDialog.vue'
import EpisodeDrawer from '@/components/tasks/EpisodeDrawer.vue'
import { MODES, NO_PERM, OPS, SCEN, TASK_ST, type ModeKey, type TaskStatus } from '@/constants'
import {
  episodesApi,
  importsApi,
  type EpisodeListItem,
  type ImportJobListItem,
  type ImportKind,
  type ImportStatus,
} from '@/api'
import { useTasks, type Task } from '@/stores/tasks'
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

/* ---------- Tab 1：采集任务 ---------- */
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
function clearFilters() { st.q = ''; st.status = 'all'; st.scen = 'all' }
function created(id: string) {
  st.status = 'all'; st.page = 1
  toast('任务 ' + id + ' 已创建', { action: '查看', onAction: () => (ui.taskDrawerId = id) })
}

/* ---------- Tab 切换与抽屉状态 ---------- */
const tab = ref<'hist' | 'imports'>('hist')
const imp = reactive({ open: false, mode: 'umi_server' as ImportMode, jobId: null as number | null })
const activeEpisodeId = ref<number | null>(null)

function openImportDrawer(mode: ImportMode) {
  imp.jobId = null
  imp.mode = mode
  imp.open = true
}
function openImportJob(id: number) {
  imp.jobId = id
  imp.open = true
}

/* ---------- Tab 2：采集历史（对接 GET /api/v1/episodes） ---------- */
const epQuery = reactive({
  keyword: '',
  source: 'all' as string,
  sceneId: 'all' as 'all' | number,
  verdict: 'all' as string,
  hasPreview: 'all' as 'all' | 'true' | 'false',
  page: 1,
  size: 10,
})
const epLoading = ref(false)
const epItems = ref<EpisodeListItem[]>([])
const epTotal = ref(0)

const EP_SOURCE_LABELS: Record<string, string> = {
  vr: 'VR 遥操作',
  umi: 'UMI 手持',
  video: '视频上传',
  lerobot: 'LeRobot 导入',
}
const EP_SRC_OPTS = [
  { value: 'all', label: '全部来源' },
  { value: 'umi', label: 'UMI 手持' },
  { value: 'video', label: '视频上传' },
  { value: 'vr', label: 'VR 遥操作' },
  { value: 'lerobot', label: 'LeRobot 导入' },
]
const EP_SCENE_OPTS = computed(() => [
  { value: 'all', label: '全部场景' },
  ...(dict.scenes || []).map((s) => ({ value: s.id, label: s.short_name || s.name })),
])
const EP_VERDICT_OPTS = [
  { value: 'all', label: '全部校验结论' },
  { value: 'ok', label: '通过' },
  { value: 'warn', label: '警告' },
  { value: 'fail', label: '不通过' },
]
const EP_PREVIEW_OPTS = [
  { value: 'all', label: '全部预览状态' },
  { value: 'true', label: '可播放' },
  { value: 'false', label: '无预览' },
]

function epVerdictBadge(v: EpisodeListItem['verdict']): { kind: 'good' | 'warn' | 'crit' | 'muted'; text: string } {
  if (v === 'ok') return { kind: 'good', text: '通过' }
  if (v === 'warn') return { kind: 'warn', text: '警告' }
  if (v === 'fail') return { kind: 'crit', text: '不通过' }
  return { kind: 'muted', text: '未校验' }
}

function fmtDurMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  return `${(ms / 1000).toFixed(1)} s`
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.replace('T', ' ').replace(/\+08:00$/, '').slice(0, 16)
}

async function fetchEpisodes() {
  epLoading.value = true
  try {
    const res = await episodesApi.list({
      page: epQuery.page,
      size: epQuery.size,
      keyword: epQuery.keyword.trim() || undefined,
      source: epQuery.source === 'all' ? undefined : epQuery.source,
      scene_id: epQuery.sceneId === 'all' ? undefined : epQuery.sceneId,
      verdict: epQuery.verdict === 'all' ? undefined : epQuery.verdict,
      has_preview: epQuery.hasPreview === 'all' ? undefined : epQuery.hasPreview === 'true',
    })
    epItems.value = Array.isArray(res?.items) ? res.items : []
    epTotal.value = res?.total ?? epItems.value.length
  } catch (err: any) {
    epItems.value = []
    epTotal.value = 0
    toast(err?.message || '加载采集历史失败', { type: 'warn' })
  } finally {
    epLoading.value = false
  }
}

let epSearchTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => [epQuery.source, epQuery.sceneId, epQuery.verdict, epQuery.hasPreview],
  () => {
    epQuery.page = 1
    if (tab.value === 'hist') fetchEpisodes()
  },
)
watch(
  () => epQuery.keyword,
  () => {
    if (epSearchTimer) clearTimeout(epSearchTimer)
    epSearchTimer = setTimeout(() => {
      epQuery.page = 1
      if (tab.value === 'hist') fetchEpisodes()
    }, 280)
  },
)

function onEpTableChange(p: { current?: number }) {
  epQuery.page = p.current ?? 1
  fetchEpisodes()
}

const epCustomRow = (r: EpisodeListItem) => ({
  class: 'row-click',
  onClick: () => {
    activeEpisodeId.value = r.id
  },
})

const histCols = [
  { title: '封面', key: 'thumb', width: 76, align: 'center' as const },
  { title: '文件名', key: 'file_name', width: 220, ellipsis: true, align: 'center' as const },
  { title: '来源', key: 'source', width: 100, ellipsis: true, align: 'center' as const },
  { title: '场景', key: 'scene_name', width: 120, ellipsis: true, align: 'center' as const },
  { title: '数据集', key: 'dataset_name', width: 130, ellipsis: true, align: 'center' as const },
  { title: '时长', key: 'duration_ms', width: 82, align: 'center' as const },
  { title: '体量', key: 'size_bytes', width: 92, align: 'center' as const },
  { title: '校验结论', key: 'verdict', width: 96, align: 'center' as const },
  { title: '录制时间', key: 'recorded_at', width: 135, ellipsis: true, align: 'center' as const },
  { title: '操作', key: 'act', width: 90, align: 'center' as const },
]

/* ---------- Tab 3：导入记录（对接 GET /api/v1/collect/imports） ---------- */
const impQuery = reactive({
  kind: 'all' as 'all' | ImportKind,
  status: 'all' as 'all' | ImportStatus,
  mine: false,
  page: 1,
  size: 10,
})
const impLoading = ref(false)
const impItems = ref<ImportJobListItem[]>([])
const impTotal = ref(0)

const IMP_STATUS_MAP: Record<ImportStatus, ['good' | 'warn' | 'crit' | 'accent' | 'muted', string]> = {
  uploading: ['accent', '上传中'],
  validating: ['accent', '校验中'],
  validated: ['warn', '待确认'],
  confirmed: ['good', '已入库'],
  failed: ['crit', '失败'],
  canceled: ['muted', '已放弃'],
}
const IMP_KIND_OPTS = [
  { value: 'all', label: '全部类型' },
  { value: 'video', label: '视频上传' },
  { value: 'umi', label: 'UMI 导入' },
]
const IMP_STATUS_OPTS = [
  { value: 'all', label: '全部状态' },
  { value: 'uploading', label: '上传中' },
  { value: 'validating', label: '校验中' },
  { value: 'validated', label: '待确认' },
  { value: 'confirmed', label: '已入库' },
  { value: 'failed', label: '失败' },
  { value: 'canceled', label: '已放弃' },
]

async function fetchImportJobs() {
  impLoading.value = true
  try {
    const res = await importsApi.list({
      page: impQuery.page,
      size: impQuery.size,
      kind: impQuery.kind === 'all' ? undefined : impQuery.kind,
      status: impQuery.status === 'all' ? undefined : impQuery.status,
      mine: impQuery.mine ? true : undefined,
    })
    impItems.value = Array.isArray(res?.items) ? res.items : []
    impTotal.value = res?.total ?? impItems.value.length
  } catch (err: any) {
    impItems.value = []
    impTotal.value = 0
    toast(err?.message || '加载导入记录失败', { type: 'warn' })
  } finally {
    impLoading.value = false
  }
}

watch(
  () => [impQuery.kind, impQuery.status, impQuery.mine],
  () => {
    impQuery.page = 1
    if (tab.value === 'imports') fetchImportJobs()
  },
)

function onImpTableChange(p: { current?: number }) {
  impQuery.page = p.current ?? 1
  fetchImportJobs()
}

const impCustomRow = (r: ImportJobListItem) => ({
  class: 'row-click',
  onClick: () => openImportJob(r.id),
})

const impCols = [
  { title: '导入编号', key: 'id', width: 92, align: 'center' as const },
  { title: '类型 / 来源', key: 'kind', width: 135, ellipsis: true, align: 'center' as const },
  { title: '状态', key: 'status', width: 96, align: 'center' as const },
  { title: '进度', key: 'progress', width: 150, ellipsis: true, align: 'center' as const },
  { title: '文件数 / 体量', key: 'size', width: 130, align: 'center' as const },
  { title: '校验 / 入库', key: 'summary', width: 150, ellipsis: true, align: 'center' as const },
  { title: '创建时间', key: 'created_at', width: 135, ellipsis: true, align: 'center' as const },
  { title: '操作', key: 'act', width: 90, align: 'center' as const },
]

watch(tab, (v) => {
  if (v === 'hist') fetchEpisodes()
  else if (v === 'imports') fetchImportJobs()
})

function onImportChanged() {
  if (tab.value === 'hist') fetchEpisodes()
  if (tab.value === 'imports') fetchImportJobs()
}

onMounted(() => {
  if (!dict.scenes.length) {
    dict.fetchAll()
  }
  fetchEpisodes()
})
</script>

<template>
  <PageHead title="采集数据与导入" desc="采集数据上传至服务器目录后，选择原始文件进行结构完整性校验与预处理，确认入库后自动进入流水线与标注流程">
    <template #desc>
      <div style="margin-top:10px">
        <div class="cyber-tabs" role="tablist" aria-label="视图切换">
          <a-tooltip title="当前阶段暂未开放手动采集任务，请先使用服务器目录预处理导入">
            <button
              type="button"
              role="tab"
              class="cyber-tab-item is-disabled"
              disabled
              aria-disabled="true"
            >
              <AppIcon name="task" size="sm" />
              <span>采集任务</span>
            </button>
          </a-tooltip>
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
          <button
            type="button"
            role="tab"
            class="cyber-tab-item"
            :class="{ active: tab === 'imports' }"
            :aria-selected="tab === 'imports'"
            @click="tab = 'imports'"
          >
            <AppIcon name="download" size="sm" />
            <span>导入与预处理记录</span>
          </button>
        </div>
      </div>
    </template>
    <a-button :disabled="!mayEdit" :title="dis" @click="openImportDrawer('video')"><AppIcon name="camera" />本地文件导入</a-button>
    <a-button type="primary" :disabled="!mayEdit" :title="dis" @click="openImportDrawer('umi_server')"><AppIcon name="drive" />服务器目录预处理导入</a-button>
    <a-tooltip title="当前阶段暂未开放手动新建采集任务">
      <a-button disabled><AppIcon name="plus" />新建任务</a-button>
    </a-tooltip>
  </PageHead>

  <!-- 采集历史：真实 GET /api/v1/episodes -->
  <div v-if="tab === 'hist'" class="card">
    <div class="toolbar">
      <a-input v-model:value="epQuery.keyword" class="grow" allow-clear placeholder="搜索文件名关键词" aria-label="搜索采集历史"><template #prefix><AppIcon name="search" /></template></a-input>
      <a-select v-model:value="epQuery.source" style="width:130px" aria-label="来源" :options="EP_SRC_OPTS" />
      <a-select v-model:value="epQuery.sceneId" style="width:140px" aria-label="场景" :options="EP_SCENE_OPTS" />
      <a-select v-model:value="epQuery.verdict" style="width:130px" aria-label="校验结论" :options="EP_VERDICT_OPTS" />
      <a-select v-model:value="epQuery.hasPreview" style="width:130px" aria-label="预览状态" :options="EP_PREVIEW_OPTS" />
      <a-button :loading="epLoading" @click="fetchEpisodes"><AppIcon name="refresh" size="sm" />刷新</a-button>
    </div>
    <a-table
      size="middle"
      row-key="id"
      :loading="epLoading"
      :columns="histCols"
      :data-source="epItems"
      :custom-row="epCustomRow"
      :pagination="{
        current: epQuery.page,
        pageSize: epQuery.size,
        total: epTotal,
        showSizeChanger: false,
        hideOnSinglePage: false,
        showTotal: (n: number) => `共 ${n} 条`,
      }"
      @change="onEpTableChange as never"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'thumb'">
          <img v-if="record.thumb_url" :src="record.thumb_url" alt="" class="ep-list-thumb" />
          <span v-else class="ep-list-thumb-empty muted">—</span>
        </template>
        <span v-else-if="column.key === 'file_name'" class="mono cell-ellipsis" style="font-size:12.5px" :title="record.file_name">{{ record.file_name }}</span>
        <span v-else-if="column.key === 'source'" class="cell-ellipsis">{{ EP_SOURCE_LABELS[record.source] || record.source }}</span>
        <span v-else-if="column.key === 'scene_name'" class="cell-ellipsis" :title="record.scene_name || '—'">{{ record.scene_name || '—' }}</span>
        <span v-else-if="column.key === 'dataset_name'" class="muted cell-ellipsis" :title="record.dataset_name || '—'">{{ record.dataset_name || '—' }}</span>
        <span v-else-if="column.key === 'duration_ms'" class="num">{{ fmtDurMs(record.duration_ms) }}</span>
        <span v-else-if="column.key === 'size_bytes'" class="num muted">{{ fmtBytes(record.size_bytes) }}</span>
        <StatusBadge v-else-if="column.key === 'verdict'" :kind="epVerdictBadge(record.verdict).kind" :text="epVerdictBadge(record.verdict).text" />
        <span v-else-if="column.key === 'recorded_at'" class="muted num cell-ellipsis">{{ fmtTime(record.recorded_at || record.created_at) }}</span>
        <a-button v-else-if="column.key === 'act'" size="small" type="link" @click.stop="activeEpisodeId = record.id">
          {{ record.has_preview ? '回放详情' : '查看详情' }}
        </a-button>
      </template>
      <template #emptyText><EmptyState icon="inbox" title="暂无数据条目" desc="可以通过右上角“数据导入”或“服务器目录导入”导入数据" /></template>
    </a-table>
  </div>

  <!-- 导入记录：真实 GET /api/v1/collect/imports -->
  <div v-else-if="tab === 'imports'" class="card">
    <div class="toolbar">
      <a-select v-model:value="impQuery.kind" style="width:140px" aria-label="导入类型" :options="IMP_KIND_OPTS" />
      <a-select v-model:value="impQuery.status" style="width:140px" aria-label="导入状态" :options="IMP_STATUS_OPTS" />
      <a-checkbox v-model:checked="impQuery.mine">仅看我的</a-checkbox>
      <div class="grow" />
      <a-button :loading="impLoading" @click="fetchImportJobs"><AppIcon name="refresh" size="sm" />刷新</a-button>
    </div>
    <a-table
      size="middle"
      row-key="id"
      :loading="impLoading"
      :columns="impCols"
      :data-source="impItems"
      :custom-row="impCustomRow"
      :pagination="{
        current: impQuery.page,
        pageSize: impQuery.size,
        total: impTotal,
        showSizeChanger: false,
        hideOnSinglePage: false,
        showTotal: (n: number) => `共 ${n} 条`,
      }"
      @change="onImpTableChange as never"
    >
      <template #bodyCell="{ column, record }">
        <span v-if="column.key === 'id'" class="mono">#{{ record.id }}</span>
        <span v-else-if="column.key === 'kind'" class="cell-ellipsis">
          {{ record.kind === 'umi' ? (record.origin === 'server' ? 'UMI · 服务器目录' : 'UMI · 目录上传') : '视频上传' }}
        </span>
        <StatusBadge
          v-else-if="column.key === 'status'"
          :kind="IMP_STATUS_MAP[record.status as ImportStatus]?.[0] || 'muted'"
          :text="IMP_STATUS_MAP[record.status as ImportStatus]?.[1] || record.status"
        />
        <span v-else-if="column.key === 'progress'" class="mono muted cell-ellipsis" :title="record.progress_text || `${record.progress}%`">
          {{ record.progress }}%<template v-if="record.progress_text"> · {{ record.progress_text }}</template>
        </span>
        <span v-else-if="column.key === 'size'" class="mono muted">
          {{ record.file_count }} 个 · {{ fmtBytes(record.size_bytes) }}
        </span>
        <span v-else-if="column.key === 'summary'" class="cell-ellipsis">
          <template v-if="record.status === 'confirmed'">入库 {{ record.episode_count }} 条</template>
          <template v-else-if="record.summary">通过 {{ record.summary.ok }} / 警告 {{ record.summary.warn }} / 失败 {{ record.summary.fail }}</template>
          <span v-else class="muted">—</span>
        </span>
        <span v-else-if="column.key === 'created_at'" class="muted num cell-ellipsis">{{ fmtTime(record.created_at) }}</span>
        <a-button v-else-if="column.key === 'act'" size="small" type="link" @click.stop="openImportJob(record.id)">
          {{ record.status === 'validated' ? '去确认' : '查看' }}
        </a-button>
      </template>
      <template #emptyText><EmptyState icon="download" title="暂无导入记录" desc="点击右上角“数据导入”或“服务器目录导入”发起首次导入" /></template>
    </a-table>
  </div>

  <!-- 采集任务 -->
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
  <ImportDialog
    :open="imp.open"
    :initial-mode="imp.mode"
    :job-id="imp.jobId"
    @close="imp.open = false"
    @changed="onImportChanged"
    @open-episode="(id) => (activeEpisodeId = id)"
  />
  <EpisodeDrawer :episode-id="activeEpisodeId" @close="activeEpisodeId = null" />
</template>

<style scoped>
.ep-list-thumb {
  width: 56px;
  height: 36px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--line);
  display: block;
  margin: 0 auto;
}
.ep-list-thumb-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 36px;
  border-radius: 4px;
  background: rgba(15, 31, 53, 0.6);
  border: 1px dashed var(--line);
}
.cyber-tab-item.is-disabled {
  opacity: 0.42;
  cursor: not-allowed;
  filter: grayscale(0.6);
}
.cyber-tab-item.is-disabled:hover {
  color: var(--muted);
  background: transparent;
}
</style>
