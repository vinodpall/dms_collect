<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import PageHead from '@/components/PageHead.vue'
import Sparkline from '@/components/Sparkline.vue'
import CountUp from '@/components/CountUp.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import TrendChart, { type TrendSeries } from '@/components/dashboard/TrendChart.vue'
import { trendData, type Range } from '@/components/dashboard/trend'
import { toast } from '@/composables/toast'
import { OPS, SCEN, STAGES, TASK_ST, type PageKey } from '@/constants'
import { useAlerts } from '@/stores/alerts'
import { usePipeline } from '@/stores/pipeline'
import { useSession } from '@/stores/session'
import { useTasks } from '@/stores/tasks'
import { useUi } from '@/stores/ui'
import { clamp, fmt, lsGet, lsSet } from '@/utils'

const router = useRouter()
const session = useSession()
const alerts = useAlerts()
const tasks = useTasks()
const pipeline = usePipeline()
const ui = useUi()

const saved = lsGet('dms-range')
const range = ref<Range>(saved === '7d' || saved === '30d' || saved === 'today' ? saved : 'today')
const hidden = reactive<Record<string, boolean>>({})
const RANGES: [Range, string][] = [['today', '今日'], ['7d', '近 7 天'], ['30d', '近 30 天']]

const go = (p: PageKey) => router.push({ name: p })

const total14 = (() => { const d = trendData('30d'); return d.vr.slice(16).map((v, i) => v + d.um.slice(16)[i]) })()
const tot = total14[total14.length - 1], prev = total14[total14.length - 2]
const delta = Math.round(((tot - prev) / prev) * 100)

const data = computed(() => trendData(range.value))
const series = computed<TrendSeries[]>(() => [
  { key: 'vr', name: 'VR 遥操作', color: 'var(--chart-1)', vals: data.value.vr },
  { key: 'um', name: 'UMI 手持', color: 'var(--chart-2)', vals: data.value.um },
])
const trendSub = computed(() => (range.value === 'today' ? '今日按小时' : range.value === '7d' ? '近 7 天' : '近 30 天') + ' · 单位：' + data.value.unit)

function setRange(r: Range) { range.value = r; lsSet('dms-range', r) }
function toggleSeries(k: string) {
  const left = series.value.filter((s) => !hidden[s.key]).length
  if (!hidden[k] && left === 1) { toast('至少保留一个数据系列', { type: 'warn' }); return }
  hidden[k] = !hidden[k]
}

const running = computed(() => tasks.list.filter((t) => ['running', 'paused', 'ready'].includes(t.status)).slice(0, 4))
const openAlerts = computed(() => alerts.list.filter((a) => !a.ack))
function ack(id: string) {
  alerts.ack(id)
  toast('已确认告警', { action: '撤销', onAction: () => alerts.unack(id) })
}
function openTask(id: string) {
  if (!session.allowed('tasks')) { toast('当前角色无权访问采集任务', { type: 'warn' }); return }
  ui.taskDrawerId = id
  go('tasks')
}
const stageFail = (i: number) => pipeline.batches.some((b) => b.stage === i && b.state === 'failed')
const goals = [{ name: '轮毂气密性检测', v: 2106, t: 5000 }, { name: '防护堵安装', v: 1736, t: 5000 }]
</script>

<template>
  <div class="dash">
  <PageHead title="数据看板" desc="2026 年 10 月 13 日 周二 · 示例数据">
    <div class="seg" role="group" aria-label="时间范围">
      <button v-for="[k, l] in RANGES" :key="k" type="button" :aria-pressed="range === k" @click="setRange(k)">{{ l }}</button>
    </div>
  </PageHead>

  <div class="grid g4">
    <button type="button" class="card kpi" @click="go('tasks')">
      <span class="k">今日采集 <AppIcon name="right" size="sm" /></span>
      <span class="v"><CountUp :value="tot" :delay="250" /><small>条</small></span>
      <span class="d"><span class="delta" :class="delta >= 0 ? 'up' : 'down'">{{ delta >= 0 ? '▲ ' : '▼ ' }}{{ Math.abs(delta) }}%</span>较昨日 {{ prev }} 条</span>
      <Sparkline :values="total14" />
    </button>
    <button type="button" class="card kpi" @click="go('datasets')">
      <span class="k">总数据量 <AppIcon name="right" size="sm" /></span>
      <span class="v"><CountUp :value="8.6" :decimals="1" :delay="330" /><small>TB</small></span>
      <span class="d"><span class="delta up">▲ 0.13 TB</span>今日新增，不含备份</span>
      <Sparkline :values="[7.9, 8.0, 8.05, 8.15, 8.2, 8.3, 8.37, 8.47, 8.6]" />
    </button>
    <button type="button" class="card kpi" @click="go('monitor')">
      <span class="k">多模态通道 <AppIcon name="right" size="sm" /></span>
      <span class="v"><CountUp :value="5" :delay="410" /><small>/ 6 正常</small></span>
      <span class="d"><span class="dot-s warn" />1 个通道掉帧告警</span>
      <Sparkline :values="[6, 6, 6, 6, 6, 6, 5, 6, 5]" color="var(--warn-solid)" />
    </button>
    <button type="button" class="card kpi" @click="go('storage')">
      <span class="k">存储使用率 <AppIcon name="right" size="sm" /></span>
      <span class="v"><CountUp :value="53" :delay="490" /><small>%</small></span>
      <span class="d">已用 11.6 TB / 已分配 22 TB</span>
      <Sparkline :values="[44, 45, 46, 47, 48, 49, 50, 51, 53]" />
    </button>
  </div>

  <div class="grid g-main">
    <div class="card">
      <div class="card-head">
        <div><h2>采集趋势</h2><div class="sub">{{ trendSub }}</div></div>
        <div class="legend">
          <button v-for="s in series" :key="s.key" type="button" :aria-pressed="!hidden[s.key]" @click="toggleSeries(s.key)"><i :style="{ background: s.color }" />{{ s.name }}</button>
        </div>
      </div>
      <div class="card-body" style="position:relative">
        <TrendChart :data="data" :series="series" :hidden="hidden" />
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><h2>采集目标</h2><div class="sub">每类 5,000 条，合计 1 万条以上</div></div></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:18px">
        <div v-for="g in goals" :key="g.name">
          <div class="row between" style="margin-bottom:8px"><b>{{ g.name }}</b><span class="num muted">{{ fmt(g.v) }} / {{ fmt(g.t) }} · {{ Math.round((g.v / g.t) * 100) }}%</span></div>
          <div class="progress" role="progressbar" :aria-valuenow="Math.round((g.v / g.t) * 100)" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: clamp((g.v / g.t) * 100, 0, 100) + '%' }" /></div>
        </div>
        <div class="callout info"><AppIcon name="info" /><span>合计已采集有效数据 <b class="num">3,842</b> 条（38%）。按每日约 100 条估算，还需约 <b>62</b> 天。</span></div>
      </div>
    </div>
  </div>

  <div class="grid g-main">
    <div class="card">
      <div class="card-head">
        <div><h2>进行中的任务</h2><div class="sub">采集中、待开始和已暂停</div></div>
        <button type="button" class="btn ghost sm" @click="go('tasks')">全部任务 <AppIcon name="right" size="sm" /></button>
      </div>
      <div class="card-body">
        <div class="list-i">
          <button v-for="t in running" :key="t.id" type="button" class="li" style="border:0;background:none;text-align:left;width:100%;cursor:pointer" @click="openTask(t.id)">
            <span class="alert-ico info"><AppIcon :name="t.scen === 'qmd' ? 'activity' : 'task'" size="sm" /></span>
            <span class="grow"><span class="tt" style="display:block">{{ t.id + ' · ' + t.name }}</span><span class="ss">{{ SCEN[t.scen].mode }} · {{ OPS[t.op].n }}</span></span>
            <span class="ss num" style="width:90px;text-align:right">已采集 {{ t.done }} 条</span>
            <StatusBadge :kind="TASK_ST[t.status][0]" :text="TASK_ST[t.status][1]" />
          </button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><h2>待处理告警</h2><div class="sub">{{ openAlerts.length ? openAlerts.length + ' 条未确认' : '全部已确认' }}</div></div></div>
      <div class="card-body">
        <div v-if="openAlerts.length" class="list-i">
          <div v-for="a in openAlerts" :key="a.id" class="li">
            <span class="alert-ico" :class="a.level"><AppIcon :name="a.level === 'info' ? 'info' : 'alert'" size="sm" /></span>
            <span class="grow"><span class="tt" style="display:block">{{ a.title }}</span><span class="ss">{{ a.desc }} · {{ a.time }}</span></span>
            <button type="button" class="btn sm" @click="ack(a.id)">确认</button>
          </div>
        </div>
        <EmptyState v-else icon="check" title="暂无待处理告警" desc="所有告警都已确认" />
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <div><h2>数据处理管线</h2><div class="sub">各阶段当前条数，点击进入处理流水线</div></div>
      <button type="button" class="btn ghost sm" @click="go('pipeline')">查看流水线 <AppIcon name="right" size="sm" /></button>
    </div>
    <div class="card-body">
      <div class="pipe">
        <button v-for="(s, i) in STAGES" :key="s" type="button" class="pipe-stage" :class="{ fail: stageFail(i) }" :style="{ '--i': i }" @click="go('pipeline')">
          <div class="n"><CountUp :value="pipeline.countAtStage(i)" :delay="500 + i * 80" /></div><div class="l">{{ s }}</div>
        </button>
      </div>
    </div>
  </div>
  </div>
</template>

<style>
/* ---------- 首页动效：与训练场首页一致的入场 + 扫描光 + 数据流动，与训练场一致，动效始终播放 ---------- */
.dash { position: relative; }
.dash::after { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 3;
  background: linear-gradient(180deg, transparent, rgba(46,211,230,.05) 40%, rgba(46,211,230,.12) 50%, rgba(46,211,230,.05) 60%, transparent) no-repeat;
  background-size: 100% 180px; background-position: 0 -180px; animation: dash-scan 10s cubic-bezier(.5,0,.5,1) 1.2s infinite; }
@keyframes dash-scan { from { background-position: 0 -180px; } to { background-position: 0 calc(100% + 180px); } }

/* 入场：标题下落，卡片依次上浮 */
.dash > .page-head { animation: dash-down .7s cubic-bezier(.2,.7,.2,1) both; }
.dash > .grid > *, .dash > .card { animation: dash-up .8s cubic-bezier(.2,.7,.2,1) both; }
.dash > .grid:nth-of-type(1) > :nth-child(1) { animation-delay: .08s; }
.dash > .grid:nth-of-type(1) > :nth-child(2) { animation-delay: .16s; }
.dash > .grid:nth-of-type(1) > :nth-child(3) { animation-delay: .24s; }
.dash > .grid:nth-of-type(1) > :nth-child(4) { animation-delay: .32s; }
.dash > .grid:nth-of-type(2) > :nth-child(1) { animation-delay: .4s; }
.dash > .grid:nth-of-type(2) > :nth-child(2) { animation-delay: .48s; }
.dash > .grid:nth-of-type(3) > :nth-child(1) { animation-delay: .56s; }
.dash > .grid:nth-of-type(3) > :nth-child(2) { animation-delay: .64s; }
.dash > .card { animation-delay: .72s; }
@keyframes dash-down { from { opacity: 0; transform: translateY(-10px); } }
@keyframes dash-up { from { opacity: 0; transform: translateY(18px); } }

/* KPI：顶部扫光 + 迷你曲线描线 + 末端呼吸光点 */
.dash .kpi { position: relative; overflow: hidden; }
.dash .kpi::after { content: ''; position: absolute; top: 0; left: 0; width: 40%; height: 100%; pointer-events: none;
  background: linear-gradient(100deg, transparent, rgba(127,243,255,.07) 45%, rgba(127,243,255,.13) 50%, transparent 60%);
  transform: translateX(-120%); animation: dash-sweep 7s ease-in-out infinite; }
.dash .grid:nth-of-type(1) > :nth-child(2)::after { animation-delay: 1.2s; }
.dash .grid:nth-of-type(1) > :nth-child(3)::after { animation-delay: 2.4s; }
.dash .grid:nth-of-type(1) > :nth-child(4)::after { animation-delay: 3.6s; }
@keyframes dash-sweep { 0%, 55% { transform: translateX(-120%); } 85%, 100% { transform: translateX(320%); } }
.dash .kpi .spark { animation: dash-draw 1.4s cubic-bezier(.4,0,.2,1) .5s both; }
.dash .spark-dot { animation: dash-fade .4s 1.8s both; }
.dash .spark-ring { transform-box: fill-box; transform-origin: center; animation: dash-ping 2.4s ease-out 2s infinite; opacity: 0; }
@keyframes dash-draw { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes dash-fade { from { opacity: 0; } }
@keyframes dash-ping { 0% { opacity: .9; transform: scale(1); } 80%, 100% { opacity: 0; transform: scale(3.4); } }

/* 采集目标进度条：生长 + 流光 */
.dash .progress > i { position: relative; overflow: hidden; transform-origin: left; animation: dash-grow 1.3s cubic-bezier(.2,.7,.2,1) .6s both; background: linear-gradient(90deg, #12B5CB, #2ED3E6); box-shadow: 0 0 10px rgba(46,211,230,.45); }
.dash .progress > i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent); width: 40%; animation: dash-shine 2.8s ease-in-out 2s infinite; transform: translateX(-100%); }
@keyframes dash-grow { from { transform: scaleX(0); } }
@keyframes dash-shine { 0% { transform: translateX(-100%); } 60%, 100% { transform: translateX(260%); } }

/* 进行中任务：采集中状态点闪烁 */
.dash .li .badge.info::before { box-shadow: 0 0 6px currentColor; animation: dash-blink 1.6s ease-in-out infinite; }
@keyframes dash-blink { 50% { opacity: .25; } }

/* 处理管线：数据沿阶段依次流过 */
.dash .pipe-stage { overflow: hidden; }
.dash .pipe-stage::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; pointer-events: none;
  background: linear-gradient(90deg, transparent, #2ED3E6, transparent); box-shadow: 0 0 8px #2ED3E6;
  transform: translateX(-100%); opacity: 0; animation: dash-flow 5.6s linear infinite; animation-delay: calc(var(--i, 0) * .7s + 1.4s); }
@keyframes dash-flow { 0% { transform: translateX(-100%); opacity: 0; } 2% { opacity: 1; } 12% { transform: translateX(100%); opacity: 1; } 13%, 100% { transform: translateX(100%); opacity: 0; } }

</style>
