<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useLogs, type LogEntry } from '@/stores/logs'
import { getToken, logsApi } from '@/api'
import { toast } from '@/composables/toast'
import type { BadgeKind } from '@/constants'

const logsStore = useLogs()

const activeMainTab = ref<'audit' | 'pipeline'>('audit')

/* ================= 用户操作审计日志（对接 GET /audit-logs, /audit-logs/{id}, /audit-logs/export） ================= */
const search = ref('')
const filterModule = ref<string>('all')
const filterStatus = ref<string>('all')
const auditPage = ref(1)
const auditPageSize = 10
const exporting = ref(false)

const moduleOptions = [
  { value: 'all', label: '全部业务模块' },
  { value: 'auth', label: '认证中心' },
  { value: 'users', label: '用户管理' },
  { value: 'roles', label: '角色权限' },
  { value: 'devices', label: '设备管理' },
  { value: 'stations', label: '工位配置' },
  { value: 'dict', label: '标注字典' },
  { value: 'scenes', label: '采集场景' },
  { value: 'system', label: '系统管理' },
]

const auditCols = [
  { title: '序号', key: 'seq', width: 64, align: 'center' as const },
  { title: '操作时间', key: 'time', width: 160, ellipsis: true, align: 'center' as const },
  { title: '操作人', key: 'user', width: 105, ellipsis: true, align: 'center' as const },
  { title: '业务模块', key: 'moduleName', width: 105, ellipsis: true, align: 'center' as const },
  { title: '操作动作', key: 'action', width: 115, ellipsis: true, align: 'center' as const },
  { title: '目标对象', key: 'target', ellipsis: true, align: 'center' as const },
  { title: '状态', key: 'status', width: 90, align: 'center' as const },
  { title: '业务说明', key: 'summary', width: 190, ellipsis: true, align: 'center' as const },
  { title: '操作', key: 'act', width: 80, align: 'center' as const },
]

function buildQueryParams() {
  return {
    page: auditPage.value,
    size: auditPageSize,
    module: filterModule.value !== 'all' ? filterModule.value : undefined,
    status: filterStatus.value !== 'all' ? filterStatus.value : undefined,
    keyword: search.value.trim() || undefined,
  }
}

async function loadAuditLogs() {
  try {
    await logsStore.fetchLogs(buildQueryParams())
  } catch (err: any) {
    toast('加载操作审计日志失败：' + (err?.message || '网络异常'), { type: 'crit' })
  }
}

let searchTimer: number | undefined
watch(search, () => {
  auditPage.value = 1
  clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => loadAuditLogs(), 250)
})
watch([filterModule, filterStatus], () => {
  auditPage.value = 1
  loadAuditLogs()
})
onBeforeUnmount(() => clearTimeout(searchTimer))

onMounted(() => {
  loadAuditLogs()
})

const detailModal = reactive<{
  open: boolean
  loading: boolean
  entry: LogEntry | null
}>({
  open: false,
  loading: false,
  entry: null,
})

async function viewDetail(entry: LogEntry) {
  detailModal.entry = entry
  detailModal.open = true
  if (entry.numericId) {
    detailModal.loading = true
    try {
      detailModal.entry = await logsStore.fetchDetail(entry.numericId)
    } catch (err: any) {
      toast('获取日志详情失败：' + (err?.message || '请稍后重试'), { type: 'warn' })
    } finally {
      detailModal.loading = false
    }
  }
}

function formatJson(v: unknown) {
  if (v === undefined || v === null || v === '') return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function copyText(txt: string) {
  navigator.clipboard?.writeText(txt).then(
    () => toast('已复制到剪贴板'),
    () => toast('复制失败，请手动复制', { type: 'warn' })
  )
}

async function exportCsv() {
  exporting.value = true
  try {
    const query: Record<string, string> = {}
    if (filterModule.value !== 'all') query.module = filterModule.value
    if (filterStatus.value !== 'all') query.status = filterStatus.value
    if (search.value.trim()) query.keyword = search.value.trim()
    const url = logsApi.exportUrl(query)
    const token = getToken()
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const errJson = await res.json()
        if (errJson?.message) msg = errJson.message
      } catch {
        /* ignore */
      }
      throw new Error(msg)
    }
    const ctype = res.headers.get('content-type') || ''
    if (ctype.includes('application/json')) {
      const json = await res.json()
      if (json?.code && json.code !== 0) throw new Error(json.message || '导出失败')
    }
    const blob = await res.blob()
    const dlUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = dlUrl
    a.download = `dms_audit_logs_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(dlUrl)
    toast('已成功导出审计日志')
  } catch (err: any) {
    toast('导出审计日志失败：' + (err?.message || '后端导出接口异常'), { type: 'crit' })
  } finally {
    exporting.value = false
  }
}

/* ================= 算法数据处理日志（后端暂未提供专用接口，已清理所有模拟数据） ================= */
export interface PipelineLogItem {
  id: string
  batchId: string
  time: string
  stage: string
  node: string
  level: 'INFO' | 'WARN' | 'ERROR'
  durationMs: number
  message: string
  details?: string
}

const pipelineLogs = ref<PipelineLogItem[]>([])
const algSearch = ref('')
const algFilterLevel = ref<string>('all')
const algFilterStage = ref<string>('all')
const algPage = ref(1)

const algCols = [
  { title: '日志编号', key: 'id', width: 110, ellipsis: true, align: 'center' as const },
  { title: '关联批次', key: 'batchId', width: 110, ellipsis: true, align: 'center' as const },
  { title: '记录时间', key: 'time', width: 160, ellipsis: true, align: 'center' as const },
  { title: '处理阶段', key: 'stage', width: 160, ellipsis: true, align: 'center' as const },
  { title: '算法算子节点', key: 'node', width: 160, ellipsis: true, align: 'center' as const },
  { title: '级别', key: 'level', width: 90, align: 'center' as const },
  { title: '耗时', key: 'durationMs', width: 90, align: 'center' as const },
  { title: '算法执行输出', key: 'message', ellipsis: true, align: 'center' as const },
  { title: '操作', key: 'act', width: 80, align: 'center' as const },
]

watch([algSearch, algFilterLevel, algFilterStage], () => { algPage.value = 1 })

const filteredAlgLogs = computed(() => {
  return pipelineLogs.value.filter((l) => {
    if (algFilterLevel.value !== 'all' && l.level !== algFilterLevel.value) return false
    if (algFilterStage.value !== 'all' && l.stage !== algFilterStage.value) return false
    if (algSearch.value) {
      const q = algSearch.value.toLowerCase()
      return (
        l.id.toLowerCase().includes(q) ||
        l.batchId.toLowerCase().includes(q) ||
        l.node.toLowerCase().includes(q) ||
        l.message.toLowerCase().includes(q)
      )
    }
    return true
  })
})

const algDetailModal = reactive<{
  open: boolean
  log: PipelineLogItem | null
}>({
  open: false,
  log: null,
})

function viewAlgDetail(log: PipelineLogItem) {
  algDetailModal.log = log
  algDetailModal.open = true
}

function exportAlgCsv() {
  if (!filteredAlgLogs.value.length) {
    toast('暂无可导出的算法数据处理日志', { type: 'warn' })
    return
  }
  const rows = [
    ['日志编号', '批次ID', '记录时间', '处理阶段', '算法节点', '日志级别', '耗时(ms)', '日志信息', '详细技术输出'],
    ...filteredAlgLogs.value.map((l) => [
      l.id,
      l.batchId,
      l.time,
      l.stage,
      l.node,
      l.level,
      l.durationMs,
      `"${l.message.replace(/"/g, '""')}"`,
      `"${(l.details || '').replace(/"/g, '""')}"`,
    ]),
  ]
  const csvContent = '\uFEFF' + rows.map((e) => e.join(',')).join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `algorithm_pipeline_logs_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast('已成功导出算法处理日志 CSV 文件')
}
</script>

<template>
  <PageHead title="日志管理" desc="用户操作安全审计流水与算法数据处理日志中心">
    <template #desc>
      <div style="margin-top:10px">
        <div class="cyber-tabs">
          <button
            type="button"
            class="cyber-tab-item"
            :class="{ active: activeMainTab === 'audit' }"
            @click="activeMainTab = 'audit'"
          >
            <AppIcon name="shield" size="sm" />
            <span>用户操作审计日志</span>
          </button>
          <button
            type="button"
            class="cyber-tab-item"
            :class="{ active: activeMainTab === 'pipeline' }"
            @click="activeMainTab = 'pipeline'"
          >
            <AppIcon name="activity" size="sm" />
            <span>算法数据处理日志</span>
          </button>
        </div>
      </div>
    </template>

    <div class="row" style="gap:8px">
      <a-button v-if="activeMainTab === 'audit'" :loading="exporting" @click="exportCsv">
        <AppIcon name="download" size="sm" />导出审计流水 (CSV)
      </a-button>
      <a-button v-else :disabled="!filteredAlgLogs.length" @click="exportAlgCsv">
        <AppIcon name="download" size="sm" />导出算法日志 (CSV)
      </a-button>
    </div>
  </PageHead>

  <!-- TAB 1: 用户操作审计日志 -->
  <template v-if="activeMainTab === 'audit'">
    <div class="card">
      <div class="toolbar">
        <a-input
          v-model:value="search"
          class="grow"
          allow-clear
          placeholder="搜索流水号 / 操作人 / 目标 / 行为"
          aria-label="搜索审计日志"
        >
          <template #prefix><AppIcon name="search" /></template>
        </a-input>

        <a-select v-model:value="filterModule" style="width:150px" aria-label="业务模块" :options="moduleOptions" />

        <a-select v-model:value="filterStatus" style="width:130px" aria-label="执行状态">
          <a-select-option value="all">全部状态</a-select-option>
          <a-select-option value="success">成功</a-select-option>
          <a-select-option value="warn">警告</a-select-option>
          <a-select-option value="failed">失败</a-select-option>
        </a-select>
      </div>

      <a-table
        :data-source="logsStore.list"
        :columns="auditCols"
        :loading="logsStore.loading"
        row-key="id"
        size="middle"
        :pagination="{
          current: auditPage,
          pageSize: auditPageSize,
          total: logsStore.total,
          showSizeChanger: false,
          hideOnSinglePage: false,
          showTotal: (total: number) => `共 ${total} 条记录`,
          onChange: (p: number) => { auditPage = p; loadAuditLogs() },
        }"
      >
        <template #bodyCell="{ column, record, index }">
          <template v-if="column.key === 'seq'">
            <span class="num muted">{{ (auditPage - 1) * auditPageSize + index + 1 }}</span>
          </template>
          <template v-else-if="column.key === 'time'">
            <span class="num muted cell-ellipsis" style="font-size:12px" :title="record.time">{{ record.time }}</span>
          </template>
          <template v-else-if="column.key === 'user'">
            <b class="cell-ellipsis" :title="record.user || ''">{{ record.user || '—' }}</b>
          </template>
          <template v-else-if="column.key === 'moduleName'">
            <span class="tag info">{{ record.moduleName }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <b class="cell-ellipsis" :title="record.action || ''">{{ record.action }}</b>
          </template>
          <template v-else-if="column.key === 'target'">
            <span class="mono muted cell-ellipsis" style="font-size:12px" :title="record.target || ''">{{ record.target || '—' }}</span>
          </template>
          <template v-else-if="column.key === 'status'">
            <StatusBadge
              :kind="(record.status === 'success' ? 'good' : record.status === 'warn' ? 'warn' : 'crit') as BadgeKind"
              :text="record.status === 'success' ? '成功' : record.status === 'warn' ? '告警' : '失败'"
            />
          </template>
          <template v-else-if="column.key === 'summary'">
            <span class="cell-ellipsis" style="font-size:12.5px" :title="record.summary || ''">{{ record.summary || '—' }}</span>
          </template>
          <template v-else-if="column.key === 'act'">
            <div class="act-links"><a-button size="small" type="link" @click="viewDetail(record)">详情</a-button></div>
          </template>
        </template>
        <template #emptyText><EmptyState icon="file" title="暂无操作审计日志" desc="当前筛选条件下没有记录" /></template>
      </a-table>
    </div>
  </template>

  <!-- TAB 2: 算法数据处理日志 -->
  <template v-else-if="activeMainTab === 'pipeline'">
    <div class="callout warn" style="margin-bottom:16px">
      <AppIcon name="alert" />
      <span>后端暂未提供「算法数据处理日志」查询接口，已移除静态演示数据，待接口上线后接入。</span>
    </div>
    <div class="card">
      <div class="toolbar">
        <a-input
          v-model:value="algSearch"
          class="grow"
          allow-clear
          placeholder="搜索批次 / 算法节点 / 异常信息"
          aria-label="搜索算法处理日志"
        >
          <template #prefix><AppIcon name="search" /></template>
        </a-input>

        <a-select v-model:value="algFilterLevel" style="width:140px" aria-label="日志级别">
          <a-select-option value="all">全部级别</a-select-option>
          <a-select-option value="INFO">INFO 正常</a-select-option>
          <a-select-option value="WARN">WARN 预警</a-select-option>
          <a-select-option value="ERROR">ERROR 异常</a-select-option>
        </a-select>

        <a-select v-model:value="algFilterStage" style="width:190px" aria-label="算法阶段">
          <a-select-option value="all">全部算法阶段</a-select-option>
        </a-select>
      </div>

      <a-table
        :data-source="filteredAlgLogs"
        :columns="algCols"
        row-key="id"
        size="middle"
        :pagination="{
          current: algPage,
          pageSize: 10,
          showSizeChanger: false,
          hideOnSinglePage: false,
          showTotal: (total: number) => `共 ${total} 条日志`,
          onChange: (p: number) => { algPage = p },
        }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'id'"><span class="mono cell-ellipsis" :title="record.id">{{ record.id }}</span></template>
          <template v-else-if="column.key === 'batchId'"><span class="mono text-accent cell-ellipsis" :title="record.batchId">{{ record.batchId }}</span></template>
          <template v-else-if="column.key === 'time'"><span class="num muted cell-ellipsis" style="font-size:12px" :title="record.time">{{ record.time }}</span></template>
          <template v-else-if="column.key === 'stage'"><span class="tag info">{{ record.stage }}</span></template>
          <template v-else-if="column.key === 'node'"><span class="mono cell-ellipsis" style="font-size:12px" :title="record.node">{{ record.node }}</span></template>
          <template v-else-if="column.key === 'level'">
            <span class="tag" :class="record.level === 'INFO' ? 'good' : record.level === 'WARN' ? 'warn' : 'crit'">{{ record.level }}</span>
          </template>
          <template v-else-if="column.key === 'durationMs'"><span class="num muted">{{ record.durationMs }} ms</span></template>
          <template v-else-if="column.key === 'message'"><span class="cell-ellipsis" :title="record.message">{{ record.message }}</span></template>
          <template v-else-if="column.key === 'act'"><div class="act-links"><a-button size="small" type="link" @click="viewAlgDetail(record)">详情</a-button></div></template>
        </template>
        <template #emptyText>
          <EmptyState icon="activity" title="暂无算法数据处理日志" desc="该标签页尚待后端提供算法流水线日志 API" />
        </template>
      </a-table>
    </div>
  </template>

  <!-- 用户审计日志详情抽屉 -->
  <a-drawer
    :open="detailModal.open"
    placement="right"
    :width="640"
    :closable="false"
    destroy-on-close
    @close="detailModal.open = false"
  >
    <template #title>
      <div v-if="detailModal.entry" style="display:flex;flex-direction:column;gap:8px;width:100%">
        <div class="row between">
          <div class="row" style="gap:8px">
            <span class="mono" style="font-weight:700">{{ detailModal.entry.traceId || detailModal.entry.id }}</span>
            <a-button v-if="detailModal.entry.traceId" size="small" type="text" @click="copyText(detailModal.entry!.traceId)">复制</a-button>
          </div>
          <button type="button" class="icon-btn" aria-label="关闭" @click="detailModal.open = false">
            <AppIcon name="x" />
          </button>
        </div>
        <div class="row" style="gap:8px">
          <StatusBadge
            :kind="(detailModal.entry.status === 'success' ? 'good' : detailModal.entry.status === 'warn' ? 'warn' : 'crit') as BadgeKind"
            :text="detailModal.entry.status === 'success' ? '执行成功' : detailModal.entry.status === 'warn' ? '告警' : '执行失败'"
          />
          <span style="font-size:14px;font-weight:600">{{ detailModal.entry.action }} · {{ detailModal.entry.moduleName }}</span>
        </div>
      </div>
    </template>
    <div v-if="detailModal.entry" style="display:flex;flex-direction:column;gap:16px">
      <div v-if="detailModal.loading" class="muted" style="font-size:12.5px">正在加载完整日志详情…</div>
      <div class="detail-grid">
        <div class="detail-row"><span class="k">日志主键</span><span class="v mono">{{ detailModal.entry.id }}</span></div>
        <div class="detail-row"><span class="k">记录时间</span><span class="v num">{{ detailModal.entry.time }}</span></div>
        <div class="detail-row"><span class="k">操作人员</span><span class="v">{{ detailModal.entry.user }}<template v-if="detailModal.entry.role"> ({{ detailModal.entry.role }})</template></span></div>
        <div class="detail-row"><span class="k">所属模块</span><span class="v">{{ detailModal.entry.moduleName }} ({{ detailModal.entry.module }})</span></div>
        <div class="detail-row"><span class="k">操作动作</span><span class="v"><b>{{ detailModal.entry.action }}</b></span></div>
        <div class="detail-row"><span class="k">目标对象</span><span class="v mono">{{ detailModal.entry.target }}</span></div>
        <div class="detail-row"><span class="k">客户端 IP</span><span class="v mono">{{ detailModal.entry.ip }}</span></div>
        <div class="detail-row"><span class="k">执行耗时</span><span class="v num">{{ detailModal.entry.duration !== null ? `${detailModal.entry.duration} 毫秒` : '—' }}</span></div>
        <div class="detail-row" style="grid-column: span 2"><span class="k">User-Agent</span><span class="v mono" style="word-break:break-all">{{ detailModal.entry.ua || '—' }}</span></div>
        <div class="detail-row" style="grid-column: span 2"><span class="k">业务说明</span><span class="v">{{ detailModal.entry.summary }}</span></div>
      </div>

      <div v-if="formatJson(detailModal.entry.before)" class="field">
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">变更前快照 (Before Data)</div>
        <pre class="diff-pre" style="padding:10px 12px;background:#090d16;color:#fca5a5;border-radius:6px;font-size:12px">{{ formatJson(detailModal.entry.before) }}</pre>
      </div>

      <div v-if="formatJson(detailModal.entry.after)" class="field">
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">变更后快照 (After Data)</div>
        <pre class="diff-pre" style="padding:10px 12px;background:#090d16;color:#a5f3fc;border-radius:6px;font-size:12px">{{ formatJson(detailModal.entry.after) }}</pre>
      </div>
    </div>
  </a-drawer>

  <!-- 算法数据处理日志详情抽屉 -->
  <a-drawer
    :open="algDetailModal.open"
    placement="right"
    :width="640"
    :closable="false"
    destroy-on-close
    @close="algDetailModal.open = false"
  >
    <template #title>
      <div v-if="algDetailModal.log" style="display:flex;flex-direction:column;gap:8px;width:100%">
        <div class="row between">
          <div class="row" style="gap:8px">
            <span class="mono" style="font-weight:700">{{ algDetailModal.log.id }}</span>
            <span class="tag info">{{ algDetailModal.log.batchId }}</span>
          </div>
          <button type="button" class="icon-btn" aria-label="关闭" @click="algDetailModal.open = false">
            <AppIcon name="x" />
          </button>
        </div>
      </div>
    </template>
    <div v-if="algDetailModal.log" style="display:flex;flex-direction:column;gap:16px">
      <pre class="diff-pre" style="padding:10px 12px;background:#090d16;color:#a5f3fc;border-radius:6px;font-size:12px">{{ algDetailModal.log.details || algDetailModal.log.message }}</pre>
    </div>
  </a-drawer>
</template>

<style scoped>
.ell-code { cursor: pointer; text-decoration: underline; color: var(--accent); }
.text-accent { color: var(--accent); }
.detail-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; background: var(--surface-2); padding: 12px; border-radius: 6px; font-size: 12.5px; }
.detail-row { display: flex; flex-direction: column; gap: 2px; }
.detail-row .k { color: var(--muted); font-size: 11.5px; }
.detail-row .v { color: var(--text); }
.diff-pre { font: 11.5px var(--mono, monospace); margin: 0; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
</style>
