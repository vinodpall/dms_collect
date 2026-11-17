<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { useLogs, type LogEntry, type LogModule } from '@/stores/logs'
import { toast } from '@/composables/toast'
import type { BadgeKind } from '@/constants'

const logsStore = useLogs()

// 主页签：'audit' | 'pipeline'
const activeMainTab = ref<'audit' | 'pipeline'>('audit')

/* ================= 用户操作审计日志 ================= */
const search = ref('')
const filterModule = ref<string>('all')
const filterStatus = ref<string>('all')
const auditPage = ref(1)

const auditCols = [
  { title: 'TraceID', key: 'traceId', width: 130, align: 'center' as const },
  { title: '操作时间', key: 'time', width: 160, align: 'center' as const },
  { title: '操作人', key: 'user', width: 130, align: 'center' as const },
  { title: '业务模块', key: 'moduleName', width: 110, align: 'center' as const },
  { title: '操作动作', key: 'action', width: 120, align: 'center' as const },
  { title: '目标对象', key: 'target', width: 130, align: 'center' as const },
  { title: '状态', key: 'status', width: 90, align: 'center' as const },
  { title: '业务说明', key: 'summary', align: 'center' as const },
  { title: '操作', key: 'act', width: 80, align: 'center' as const },
]

const filteredList = computed(() => {
  return logsStore.list.filter((l) => {
    if (filterModule.value !== 'all' && l.module !== filterModule.value) return false
    if (filterStatus.value !== 'all' && l.status !== filterStatus.value) return false

    if (search.value) {
      const q = search.value.toLowerCase()
      const matchTrace = l.traceId.toLowerCase().includes(q)
      const matchTarget = l.target.toLowerCase().includes(q)
      const matchSummary = l.summary.toLowerCase().includes(q)
      const matchAction = l.action.toLowerCase().includes(q)
      const matchUser = l.user.toLowerCase().includes(q)
      if (!matchTrace && !matchTarget && !matchSummary && !matchAction && !matchUser) return false
    }
    return true
  })
})

const detailModal = reactive<{
  open: boolean
  entry: LogEntry | null
}>({
  open: false,
  entry: null,
})

function viewDetail(entry: LogEntry) {
  detailModal.entry = entry
  detailModal.open = true
}

function copyText(txt: string) {
  navigator.clipboard?.writeText(txt)
  toast('已复制到剪贴板')
}

function exportCsv() {
  const rows = [
    ['日志ID', 'TraceID', '时间', '操作人', '角色', '所属模块', '操作行为', '目标对象', '状态', '耗时(ms)', '客户端IP', '业务说明'],
    ...filteredList.value.map((l) => [
      l.id,
      l.traceId,
      l.time,
      l.user,
      l.role,
      l.moduleName,
      l.action,
      l.target,
      l.status,
      l.duration,
      l.ip,
      `"${l.summary.replace(/"/g, '""')}"`,
    ]),
  ]
  const csvContent = '\uFEFF' + rows.map((e) => e.join(',')).join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `dms_audit_logs_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast('已成功导出审计日志 CSV 文件')
}

/* ================= 需求 8：算法数据处理日志 (Pipeline Execution Logs) ================= */
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

const pipelineLogs = ref<PipelineLogItem[]>([
  {
    id: 'ALG-1024',
    batchId: 'B-1012-01',
    time: '2026-10-13 14:28:11',
    stage: '时间戳对齐 (Sync)',
    node: 'node_time_align_ptp',
    level: 'INFO',
    durationMs: 340,
    message: '完成多模态数据流时间基准对齐：RGB (30fps) 与 FT力觉 (1000Hz) 插值对齐，最大时间偏差 2.1ms (阈值 10ms)',
    details: 'PTP 硬件时钟同步锁相环正常锁定；插值方式：Hermite 立方样条；丢失帧数: 0',
  },
  {
    id: 'ALG-1023',
    batchId: 'B-1012-01',
    time: '2026-10-13 14:28:05',
    stage: 'ROS2 Bag 解包',
    node: 'node_bag_demuxer',
    level: 'INFO',
    durationMs: 820,
    message: '成功解析 raw_bag 文件：包含 3 路视频流与 2 路传感器时序，有效帧数 620 帧',
  },
  {
    id: 'ALG-1022',
    batchId: 'B-1012-02',
    time: '2026-10-13 14:26:40',
    stage: '深度点云生成',
    node: 'node_depth_reconstruction',
    level: 'WARN',
    durationMs: 1420,
    message: '腕部相机左边缘存在反光噪点，已自动启动双边滤波去噪 (残差率 1.4%)',
    details: '深度图有效区域: 98.6%；滤波核半径: 5px；去噪后已满足几何一致性校验',
  },
  {
    id: 'ALG-1021',
    batchId: 'B-1012-03',
    time: '2026-10-13 14:22:15',
    stage: '轨迹平滑与位姿滤波',
    node: 'node_kinematics_filter',
    level: 'ERROR',
    durationMs: 210,
    message: '机械臂关节角速度突变检测超标：J4 轴角加速度达到 18.2 rad/s²，超过机器人动力学安全阈值',
    details: '异常位于时间片段 12.4s ~ 13.1s；已打上 [KINEMATIC_JITTER] 标记并通知标注端复核',
  },
  {
    id: 'ALG-1020',
    batchId: 'B-1012-04',
    time: '2026-10-13 14:15:02',
    stage: 'LeRobot / OpenX 格式转换',
    node: 'node_format_converter',
    level: 'INFO',
    durationMs: 950,
    message: '数据标准化打包完成，生成 LeRobot v2.0 兼容数据集结构与元数据 JSON',
  },
  {
    id: 'ALG-1019',
    batchId: 'B-1012-01',
    time: '2026-10-13 14:10:00',
    stage: '数据标准化校验',
    node: 'node_data_validator',
    level: 'INFO',
    durationMs: 180,
    message: '动作起止边界对齐校验通过：与标注字典子任务 [取件上台] [夹紧密封] 时间区间吻合',
  },
])

const algSearch = ref('')
const algFilterLevel = ref<string>('all')
const algFilterStage = ref<string>('all')
const algPage = ref(1)

const algCols = [
  { title: '日志编号', key: 'id', width: 110, align: 'center' as const },
  { title: '关联批次', key: 'batchId', width: 110, align: 'center' as const },
  { title: '记录时间', key: 'time', width: 160, align: 'center' as const },
  { title: '处理阶段', key: 'stage', width: 160, align: 'center' as const },
  { title: '算法算子节点', key: 'node', width: 160, align: 'center' as const },
  { title: '级别', key: 'level', width: 90, align: 'center' as const },
  { title: '耗时', key: 'durationMs', width: 90, align: 'center' as const },
  { title: '算法执行输出', key: 'message', align: 'center' as const },
  { title: '操作', key: 'act', width: 80, align: 'center' as const },
]

watch([search, filterModule, filterStatus], () => { auditPage.value = 1 })
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
  <PageHead title="日志审计与算法日志中心" desc="用户操作安全审计流水与算法数据处理全链路实时日志追踪">
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
      <a-button v-if="activeMainTab === 'audit'" @click="exportCsv">
        <AppIcon name="download" size="sm" />导出审计流水 (CSV)
      </a-button>
      <a-button v-else @click="exportAlgCsv">
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

        <a-select v-model:value="filterModule" style="width:150px" aria-label="业务模块">
          <a-select-option value="all">全部业务模块</a-select-option>
          <a-select-option value="annotate">标注工作台</a-select-option>
          <a-select-option value="review">审核工作台</a-select-option>
          <a-select-option value="vocab">字典管理</a-select-option>
          <a-select-option value="collect">采集任务</a-select-option>
          <a-select-option value="pipeline">数据流水线</a-select-option>
          <a-select-option value="system">系统管理</a-select-option>
        </a-select>

        <a-select v-model:value="filterStatus" style="width:130px" aria-label="执行状态">
          <a-select-option value="all">全部状态</a-select-option>
          <a-select-option value="success">成功</a-select-option>
          <a-select-option value="warn">质检告警</a-select-option>
          <a-select-option value="failed">执行失败</a-select-option>
        </a-select>
      </div>

      <a-table
        :data-source="filteredList"
        :columns="auditCols"
        row-key="id"
        size="middle"
        :pagination="{
          current: auditPage,
          pageSize: 10,
          showSizeChanger: false,
          hideOnSinglePage: false,
          showTotal: (total: number) => `共 ${total} 条记录`,
          onChange: (p: number) => { auditPage = p },
        }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'traceId'">
            <span class="mono ell-code" :title="'点击查看详情: ' + record.traceId" @click="viewDetail(record)">
              {{ record.traceId.slice(0, 10) }}...
            </span>
          </template>
          <template v-else-if="column.key === 'time'">
            <span class="num muted" style="font-size:12px">{{ record.time }}</span>
          </template>
          <template v-else-if="column.key === 'user'">
            <b>{{ record.user }}</b> <small class="muted">({{ record.role }})</small>
          </template>
          <template v-else-if="column.key === 'moduleName'">
            <span class="tag info">{{ record.moduleName }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <b>{{ record.action }}</b>
          </template>
          <template v-else-if="column.key === 'target'">
            <span class="mono muted" style="font-size:12px">{{ record.target }}</span>
          </template>
          <template v-else-if="column.key === 'status'">
            <StatusBadge
              :kind="(record.status === 'success' ? 'good' : record.status === 'warn' ? 'warn' : 'crit') as BadgeKind"
              :text="record.status === 'success' ? '成功' : record.status === 'warn' ? '告警' : '失败'"
            />
          </template>
          <template v-else-if="column.key === 'summary'">
            <span style="font-size:12.5px">{{ record.summary }}</span>
          </template>
          <template v-else-if="column.key === 'act'">
            <a-button size="small" type="link" @click="viewDetail(record)">详情</a-button>
          </template>
        </template>
      </a-table>
    </div>
  </template>

  <!-- TAB 2: 算法数据处理日志 -->
  <template v-else-if="activeMainTab === 'pipeline'">
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
          <a-select-option value="时间戳对齐 (Sync)">时间戳对齐 (Sync)</a-select-option>
          <a-select-option value="ROS2 Bag 解包">ROS2 Bag 解包</a-select-option>
          <a-select-option value="深度点云生成">深度点云生成</a-select-option>
          <a-select-option value="轨迹平滑与位姿滤波">轨迹平滑与位姿滤波</a-select-option>
          <a-select-option value="LeRobot / OpenX 格式转换">格式转换与打包</a-select-option>
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
          <template v-if="column.key === 'id'">
            <span class="mono font-bold">{{ record.id }}</span>
          </template>
          <template v-else-if="column.key === 'batchId'">
            <span class="mono text-accent">{{ record.batchId }}</span>
          </template>
          <template v-else-if="column.key === 'time'">
            <span class="num muted" style="font-size:12px">{{ record.time }}</span>
          </template>
          <template v-else-if="column.key === 'stage'">
            <span class="tag info">{{ record.stage }}</span>
          </template>
          <template v-else-if="column.key === 'node'">
            <span class="mono" style="font-size:12px">{{ record.node }}</span>
          </template>
          <template v-else-if="column.key === 'level'">
            <span
              class="tag"
              :class="record.level === 'INFO' ? 'good' : record.level === 'WARN' ? 'warn' : 'crit'"
            >
              {{ record.level }}
            </span>
          </template>
          <template v-else-if="column.key === 'durationMs'">
            <span class="num muted" style="font-size:12px">{{ record.durationMs }} ms</span>
          </template>
          <template v-else-if="column.key === 'message'">
            <span style="font-size:12.5px" :class="{ 'text-crit': record.level === 'ERROR' }">
              {{ record.message }}
            </span>
          </template>
          <template v-else-if="column.key === 'act'">
            <a-button size="small" type="link" @click="viewAlgDetail(record)">详情</a-button>
          </template>
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
            <span class="mono" style="font-weight:700">{{ detailModal.entry.traceId }}</span>
            <a-button size="small" type="text" @click="copyText(detailModal.entry!.traceId)">复制</a-button>
          </div>
          <button type="button" class="icon-btn" aria-label="关闭" @click="detailModal.open = false">
            <AppIcon name="x" />
          </button>
        </div>
        <div class="row" style="gap:8px">
          <StatusBadge
            :kind="(detailModal.entry.status === 'success' ? 'good' : detailModal.entry.status === 'warn' ? 'warn' : 'crit') as BadgeKind"
            :text="detailModal.entry.status === 'success' ? '执行成功' : detailModal.entry.status === 'warn' ? '审核预警/打回' : '执行失败'"
          />
          <span style="font-size:14px;font-weight:600">{{ detailModal.entry.action }} · {{ detailModal.entry.moduleName }}</span>
        </div>
      </div>
    </template>
    <div v-if="detailModal.entry" style="display:flex;flex-direction:column;gap:16px">
      <div class="detail-grid">
        <div class="detail-row"><span class="k">日志主键</span><span class="v mono">{{ detailModal.entry.id }}</span></div>
        <div class="detail-row"><span class="k">记录时间</span><span class="v num">{{ detailModal.entry.time }}</span></div>
        <div class="detail-row"><span class="k">操作人员</span><span class="v">{{ detailModal.entry.user }} ({{ detailModal.entry.role }})</span></div>
        <div class="detail-row"><span class="k">所属模块</span><span class="v">{{ detailModal.entry.moduleName }} ({{ detailModal.entry.module }})</span></div>
        <div class="detail-row"><span class="k">操作动作</span><span class="v"><b>{{ detailModal.entry.action }}</b></span></div>
        <div class="detail-row"><span class="k">目标对象</span><span class="v mono">{{ detailModal.entry.target }}</span></div>
        <div class="detail-row"><span class="k">客户端 IP</span><span class="v mono">{{ detailModal.entry.ip }}</span></div>
        <div class="detail-row"><span class="k">执行耗时</span><span class="v num">{{ detailModal.entry.duration }} 毫秒</span></div>
        <div class="detail-row" style="grid-column: span 2"><span class="k">业务说明</span><span class="v">{{ detailModal.entry.summary }}</span></div>
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
        <div class="row" style="gap:8px">
          <span
            class="tag"
            :class="algDetailModal.log.level === 'INFO' ? 'good' : algDetailModal.log.level === 'WARN' ? 'warn' : 'crit'"
          >
            {{ algDetailModal.log.level }}
          </span>
          <span style="font-size:14px;font-weight:600">{{ algDetailModal.log.stage }}</span>
        </div>
      </div>
    </template>
    <div v-if="algDetailModal.log" style="display:flex;flex-direction:column;gap:16px">
      <div class="detail-grid">
        <div class="detail-row"><span class="k">记录时间</span><span class="v num">{{ algDetailModal.log.time }}</span></div>
        <div class="detail-row"><span class="k">执行耗时</span><span class="v num">{{ algDetailModal.log.durationMs }} 毫秒</span></div>
        <div class="detail-row"><span class="k">算法阶段</span><span class="v">{{ algDetailModal.log.stage }}</span></div>
        <div class="detail-row"><span class="k">算法算子节点</span><span class="v mono">{{ algDetailModal.log.node }}</span></div>
      </div>

      <div class="field">
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">执行消息 (Message)</div>
        <div class="mono" style="padding:10px 12px;background:#090d16;color:#38bdf8;border-radius:6px;font-size:12px">
          {{ algDetailModal.log.message }}
        </div>
      </div>

      <div v-if="algDetailModal.log.details" class="field">
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">算子详细追踪与技术参数 (Trace Details)</div>
        <pre class="diff-pre" style="padding:10px 12px;background:#090d16;color:#a5f3fc;border-radius:6px;font-size:12px">{{ algDetailModal.log.details }}</pre>
      </div>
    </div>
  </a-drawer>
</template>

<style scoped>
.stbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.stbl th { text-align: left; font-weight: 500; color: var(--muted); padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--surface-2); white-space: nowrap; }
.stbl td { padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.stbl tbody tr:last-child td { border-bottom: 0; }

.ell-code { cursor: pointer; text-decoration: underline; color: var(--accent); }
.text-accent { color: var(--accent); }
.text-crit { color: var(--crit); }

.detail-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; background: var(--surface-2); padding: 12px; border-radius: 6px; font-size: 12.5px; }
.detail-row { display: flex; flex-direction: column; gap: 2px; }
.detail-row .k { color: var(--muted); font-size: 11.5px; }
.detail-row .v { color: var(--text); }

.diff-pre { font: 11.5px var(--font-mono); margin: 0; white-space: pre-wrap; word-break: break-all; max-height: 180px; overflow-y: auto; }
</style>
