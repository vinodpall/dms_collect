<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { useLogs, type LogEntry, type LogModule } from '@/stores/logs'
import { toast } from '@/composables/toast'
import type { BadgeKind } from '@/constants'

const logsStore = useLogs()

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

/* 查看详情弹窗 */
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
</script>

<template>
  <PageHead title="操作审计日志" desc="采集、标注、审核及系统字典全链路操作流水审计；支持链路追踪与变更快照比对">
    <div class="row" style="gap:8px">
      <a-button @click="exportCsv"><AppIcon name="download" size="sm" />导出审计流水 (CSV)</a-button>
    </div>
  </PageHead>

  <!-- 统计指标条 -->
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

  <div class="card" style="padding:16px;margin-top:14px">
    <!-- 筛选搜索栏 -->
    <div class="row between" style="margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <a-input
          v-model:value="search"
          placeholder="搜索流水号 / 操作人 / 目标 / 行为"
          style="width:240px"
          size="small"
          allow-clear
        >
          <template #prefix><AppIcon name="search" size="sm" /></template>
        </a-input>

        <a-select v-model:value="filterModule" size="small" style="width:130px">
          <a-select-option value="all">全部业务模块</a-select-option>
          <a-select-option value="annotate">标注工作台</a-select-option>
          <a-select-option value="review">审核工作台</a-select-option>
          <a-select-option value="vocab">字典管理</a-select-option>
          <a-select-option value="collect">采集任务</a-select-option>
          <a-select-option value="pipeline">数据流水线</a-select-option>
          <a-select-option value="system">系统管理</a-select-option>
        </a-select>

        <a-select v-model:value="filterStatus" size="small" style="width:105px">
          <a-select-option value="all">全部状态</a-select-option>
          <a-select-option value="success">成功</a-select-option>
          <a-select-option value="warn">质检告警</a-select-option>
          <a-select-option value="failed">执行失败</a-select-option>
        </a-select>

        <a-select v-model:value="filterUser" size="small" style="width:115px">
          <a-select-option value="all">全部操作人</a-select-option>
          <a-select-option value="林悦">林悦 (标注员)</a-select-option>
          <a-select-option value="陈静">陈静 (审核员)</a-select-option>
          <a-select-option value="周工">周工 (管理员)</a-select-option>
          <a-select-option value="张杰">张杰 (操作员)</a-select-option>
        </a-select>

        <a-radio-group v-model:value="filterTime" button-style="solid" size="small">
          <a-radio-button value="all">全部时间</a-radio-button>
          <a-radio-button value="today">今日</a-radio-button>
          <a-radio-button value="3days">近3天</a-radio-button>
          <a-radio-button value="7days">近7天</a-radio-button>
        </a-radio-group>
      </div>

      <span class="muted" style="font-size:12px">共检索到 {{ filteredList.length }} 条流水</span>
    </div>

    <!-- 日志表格 -->
    <table class="stbl" aria-label="操作日志表格">
      <thead>
        <tr>
          <th style="width:110px">Trace ID</th>
          <th style="width:145px">操作时间</th>
          <th style="width:110px">操作人员</th>
          <th style="width:100px">业务模块</th>
          <th style="width:90px">操作行为</th>
          <th style="width:200px">目标对象</th>
          <th>业务摘要与变更说明</th>
          <th style="width:75px">耗时</th>
          <th style="width:75px">状态</th>
          <th style="width:70px">详情</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in filteredList" :key="l.id">
          <td>
            <a class="mono ell-code" @click="copyText(l.traceId)" title="点击复制 TraceID">{{ l.traceId }}</a>
          </td>
          <td class="muted num" style="font-size:12px">{{ l.time }}</td>
          <td>
            <div class="row" style="gap:4px">
              <b>{{ l.user }}</b>
              <span class="muted" style="font-size:11px">({{ l.role }})</span>
            </div>
          </td>
          <td>
            <a-tag :color="l.module === 'annotate' ? 'blue' : l.module === 'review' ? 'purple' : l.module === 'vocab' ? 'cyan' : l.module === 'collect' ? 'green' : 'orange'">
              {{ l.moduleName }}
            </a-tag>
          </td>
          <td><b>{{ l.action }}</b></td>
          <td><span class="mono" style="font-size:12px">{{ l.target }}</span></td>
          <td class="muted" style="font-size:12.5px">{{ l.summary }}</td>
          <td class="num muted">{{ l.duration }}ms</td>
          <td>
            <StatusBadge
              :kind="(l.status === 'success' ? 'good' : l.status === 'warn' ? 'warn' : 'crit') as BadgeKind"
              :text="l.status === 'success' ? '成功' : l.status === 'warn' ? '打回' : '失败'"
            />
          </td>
          <td>
            <a-button size="small" type="link" @click="viewDetail(l)">查看</a-button>
          </td>
        </tr>
        <tr v-if="!filteredList.length">
          <td colspan="10" class="muted" style="text-align:center;padding:32px">暂无符合条件的审计日志记录</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 详情弹窗 -->
  <a-modal v-model:open="detailModal.open" title="操作流水审计详情" width="640px" centered :footer="null">
    <div v-if="detailModal.entry" class="log-detail-body">
      <div class="row between" style="margin-bottom:12px">
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
        <div class="detail-row"><span class="k">用户代理</span><span class="v" style="font-size:12px">{{ detailModal.entry.ua }}</span></div>
        <div class="detail-row"><span class="k">执行耗时</span><span class="v num">{{ detailModal.entry.duration }} 毫秒</span></div>
        <div class="detail-row"><span class="k">业务说明</span><span class="v">{{ detailModal.entry.summary }}</span></div>
      </div>

      <div v-if="detailModal.entry.before || detailModal.entry.after" style="margin-top:16px">
        <div style="font-weight:600;margin-bottom:8px">数据变更快照对比 (Diff)</div>
        <div class="diff-box">
          <div class="diff-col">
            <span class="diff-title">变更前 (Before)</span>
            <pre class="diff-pre">{{ typeof detailModal.entry.before === 'object' ? JSON.stringify(detailModal.entry.before, null, 2) : (detailModal.entry.before ?? '无') }}</pre>
          </div>
          <div class="diff-col">
            <span class="diff-title">变更后 (After)</span>
            <pre class="diff-pre" style="color:var(--good-solid)">{{ typeof detailModal.entry.after === 'object' ? JSON.stringify(detailModal.entry.after, null, 2) : (detailModal.entry.after ?? '无') }}</pre>
          </div>
        </div>
      </div>
    </div>
  </a-modal>
</template>

<style scoped>
.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.stat-card { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; box-shadow: var(--shadow-sm); }
.stat-card .num { display: block; font: 700 22px var(--font-mono); margin-bottom: 2px; }
.stat-card .lbl { font-size: 12px; color: var(--muted); }

.stbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.stbl th { text-align: left; font-weight: 500; color: var(--muted); padding: 8px 8px; border-bottom: 1px solid var(--line); background: var(--surface-2); }
.stbl td { padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }

.ell-code { cursor: pointer; text-decoration: underline; color: var(--accent); }

.detail-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; background: var(--surface-2); padding: 12px; border-radius: 6px; font-size: 12.5px; }
.detail-row { display: flex; flex-direction: column; gap: 2px; }
.detail-row .k { color: var(--muted); font-size: 11.5px; }
.detail-row .v { color: var(--text); }

.diff-box { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.diff-col { background: var(--surface-2); border-radius: 6px; padding: 10px; }
.diff-title { font-size: 12px; font-weight: 600; margin-bottom: 6px; display: block; }
.diff-pre { font: 11.5px var(--font-mono); margin: 0; white-space: pre-wrap; word-break: break-all; max-height: 180px; overflow-y: auto; }

@media (max-width: 900px) { .stats-row { grid-template-columns: repeat(2, 1fr); } .diff-box { grid-template-columns: 1fr; } }
</style>
