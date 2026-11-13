<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
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
const filterUser = ref<string>('all')
const filterTime = ref<'all' | 'today' | '3days' | '7days'>('all')

const filteredList = computed(() => {
  const now = Date.now()
  return logsStore.list.filter((l) => {
    if (filterModule.value !== 'all' && l.module !== filterModule.value) return false
    if (filterStatus.value !== 'all' && l.status !== filterStatus.value) return false
    if (filterUser.value !== 'all' && l.user !== filterUser.value) return false

    if (filterTime.value === 'today') {
      if (now - l.timestamp > 1000 * 60 * 60 * 24) return false
    } else if (filterTime.value === '3days') {
      if (now - l.timestamp > 1000 * 60 * 60 * 24 * 3) return false
    } else if (filterTime.value === '7days') {
      if (now - l.timestamp > 1000 * 60 * 60 * 24 * 7) return false
    }

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

const stats = computed(() => {
  const all = logsStore.list
  return {
    total: all.length,
    success: all.filter((l) => l.status === 'success').length,
    warn: all.filter((l) => l.status === 'warn').length,
    failed: all.filter((l) => l.status === 'failed').length,
  }
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
            <span class="count-badge">{{ logsStore.list.length }}</span>
          </button>
          <button
            type="button"
            class="cyber-tab-item"
            :class="{ active: activeMainTab === 'pipeline' }"
            @click="activeMainTab = 'pipeline'"
          >
            <AppIcon name="activity" size="sm" />
            <span>算法数据处理日志 (Pipeline)</span>
            <span class="count-badge">{{ pipelineLogs.length }}</span>
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
    <div class="stats-row">
      <div class="stat-card">
        <span class="num">{{ stats.total }}</span>
        <span class="lbl">累计操作流水</span>
      </div>
      <div class="stat-card">
        <span class="num" style="color:var(--good-solid)">{{ stats.success }}</span>
        <span class="lbl">正常执行成功</span>
      </div>
      <div class="stat-card">
        <span class="num" style="color:var(--warn-solid)">{{ stats.warn }}</span>
        <span class="lbl">审核打回 / 质检告警</span>
      </div>
      <div class="stat-card">
        <span class="num" style="color:var(--crit-solid)">{{ stats.failed }}</span>
        <span class="lbl">流水线异常 / 拦截</span>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
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

      <div style="overflow-x:auto">
        <table class="stbl" aria-label="操作日志表格">
          <thead>
            <tr>
              <th style="width:110px">TraceID</th>
              <th style="width:140px">操作时间</th>
              <th style="width:100px">操作人</th>
              <th style="width:110px">业务模块</th>
              <th style="width:110px">操作动作</th>
              <th style="width:130px">目标对象</th>
              <th style="width:90px">状态</th>
              <th>业务说明</th>
              <th style="width:70px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in filteredList" :key="l.id">
              <td class="mono" style="font-size:11.5px">
                <span class="ell-code" :title="'点击查看详情: ' + l.traceId" @click="viewDetail(l)">{{ l.traceId.slice(0, 10) }}...</span>
              </td>
              <td class="num muted" style="font-size:12px">{{ l.time }}</td>
              <td><b>{{ l.user }}</b> <small class="muted">({{ l.role }})</small></td>
              <td><span class="tag info">{{ l.moduleName }}</span></td>
              <td><b>{{ l.action }}</b></td>
              <td class="mono muted" style="font-size:12px">{{ l.target }}</td>
              <td>
                <StatusBadge
                  :kind="(l.status === 'success' ? 'good' : l.status === 'warn' ? 'warn' : 'crit') as BadgeKind"
                  :text="l.status === 'success' ? '成功' : l.status === 'warn' ? '告警' : '失败'"
                />
              </td>
              <td style="font-size:12.5px">{{ l.summary }}</td>
              <td>
                <a-button size="small" type="link" @click="viewDetail(l)">详情</a-button>
              </td>
            </tr>
            <tr v-if="!filteredList.length">
              <td colspan="9" style="text-align:center;padding:24px" class="muted">没有匹配的审计日志</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>

  <!-- TAB 2: 算法数据处理日志 (需求 8) -->
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

      <div style="overflow-x:auto">
        <table class="stbl" aria-label="算法数据处理日志表格">
          <thead>
            <tr>
              <th style="width:100px">日志编号</th>
              <th style="width:105px">关联批次</th>
              <th style="width:140px">记录时间</th>
              <th style="width:160px">处理阶段</th>
              <th style="width:160px">算法算子节点</th>
              <th style="width:85px">级别</th>
              <th style="width:85px">耗时</th>
              <th>算法执行输出</th>
              <th style="width:70px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="al in filteredAlgLogs" :key="al.id">
              <td class="mono font-bold">{{ al.id }}</td>
              <td class="mono text-accent">{{ al.batchId }}</td>
              <td class="num muted" style="font-size:12px">{{ al.time }}</td>
              <td><span class="tag info">{{ al.stage }}</span></td>
              <td class="mono" style="font-size:12px">{{ al.node }}</td>
              <td>
                <span
                  class="tag"
                  :class="al.level === 'INFO' ? 'good' : al.level === 'WARN' ? 'warn' : 'crit'"
                >
                  {{ al.level }}
                </span>
              </td>
              <td class="num muted" style="font-size:12px">{{ al.durationMs }} ms</td>
              <td style="font-size:12.5px" :class="{ 'text-crit': al.level === 'ERROR' }">
                {{ al.message }}
              </td>
              <td>
                <a-button size="small" type="link" @click="viewAlgDetail(al)">详情</a-button>
              </td>
            </tr>
            <tr v-if="!filteredAlgLogs.length">
              <td colspan="9" style="text-align:center;padding:24px" class="muted">没有匹配的算法处理日志</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>

  <!-- 用户审计日志详情模态框 -->
  <a-modal v-model:open="detailModal.open" title="审计流水记录详情" :width="680" centered :footer="null">
    <div v-if="detailModal.entry" style="display:flex;flex-direction:column;gap:14px">
      <div class="row between" style="background:var(--surface-3);padding:10px 14px;border-radius:6px">
        <div class="row" style="gap:8px">
          <span class="mono" style="font-size:15px;font-weight:700">{{ detailModal.entry.traceId }}</span>
          <a-button size="small" type="text" @click="copyText(detailModal.entry!.traceId)">复制</a-button>
        </div>
        <StatusBadge
          :kind="(detailModal.entry.status === 'success' ? 'good' : detailModal.entry.status === 'warn' ? 'warn' : 'crit') as BadgeKind"
          :text="detailModal.entry.status === 'success' ? '执行成功' : detailModal.entry.status === 'warn' ? '审核预警/打回' : '执行失败'"
        />
      </div>

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
  </a-modal>

  <!-- 算法数据处理日志详情模态框 -->
  <a-modal v-model:open="algDetailModal.open" title="算法数据处理日志详情" :width="700" centered :footer="null">
    <div v-if="algDetailModal.log" style="display:flex;flex-direction:column;gap:14px">
      <div class="row between" style="background:var(--surface-3);padding:10px 14px;border-radius:6px">
        <div class="row center" style="gap:8px">
          <span class="mono" style="font-size:15px;font-weight:700">{{ algDetailModal.log.id }}</span>
          <span class="tag info">{{ algDetailModal.log.batchId }}</span>
        </div>
        <span
          class="tag"
          :class="algDetailModal.log.level === 'INFO' ? 'good' : algDetailModal.log.level === 'WARN' ? 'warn' : 'crit'"
        >
          {{ algDetailModal.log.level }}
        </span>
      </div>

      <div class="detail-grid">
        <div class="detail-row"><span class="k">记录时间</span><span class="v num">{{ algDetailModal.log.time }}</span></div>
        <div class="detail-row"><span class="k">执行耗时</span><span class="v num">{{ algDetailModal.log.durationMs }} 毫秒</span></div>
        <div class="detail-row"><span class="k">算法阶段</span><span class="v">{{ algDetailModal.log.stage }}</span></div>
        <div class="detail-row"><span class="k">算法算子节点</span><span class="v mono">{{ algDetailModal.log.node }}</span></div>
      </div>

      <div class="field">
        <span class="label">执行消息 (Message)</span>
        <div class="mono" style="padding:10px 12px;background:#090d16;color:#38bdf8;border-radius:6px;font-size:12px">
          {{ algDetailModal.log.message }}
        </div>
      </div>

      <div v-if="algDetailModal.log.details" class="field">
        <span class="label">算子详细追踪与技术参数 (Trace Details)</span>
        <pre class="diff-pre" style="padding:10px 12px;background:#090d16;color:#a5f3fc;border-radius:6px;font-size:12px">{{ algDetailModal.log.details }}</pre>
      </div>
    </div>
  </a-modal>
</template>

<style scoped>
.main-tabs-bar { margin-bottom: 16px; }
.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.stat-card { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; box-shadow: var(--shadow-sm); }
.stat-card .num { display: block; font: 700 22px var(--font-mono); margin-bottom: 2px; }
.stat-card .lbl { font-size: 12px; color: var(--muted); }

.stbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.stbl th { text-align: left; font-weight: 500; color: var(--muted); padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--surface-2); }
.stbl td { padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: middle; }

.ell-code { cursor: pointer; text-decoration: underline; color: var(--accent); }
.text-accent { color: var(--accent); }
.text-crit { color: var(--crit); }

.detail-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; background: var(--surface-2); padding: 12px; border-radius: 6px; font-size: 12.5px; }
.detail-row { display: flex; flex-direction: column; gap: 2px; }
.detail-row .k { color: var(--muted); font-size: 11.5px; }
.detail-row .v { color: var(--text); }

.diff-pre { font: 11.5px var(--font-mono); margin: 0; white-space: pre-wrap; word-break: break-all; max-height: 180px; overflow-y: auto; }

@media (max-width: 900px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
</style>
