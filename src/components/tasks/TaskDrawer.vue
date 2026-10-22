<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import CockpitOverlay from './CockpitOverlay.vue'
import { MODES, NO_PERM, OPS, SCEN, TASK_ST, TODAY } from '@/constants'
import { UPLOAD_STEPS, useTasks, type CheckItem, type Task } from '@/stores/tasks'
import { useDatasets } from '@/stores/datasets'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { useDevices } from '@/stores/devices'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'

const props = defineProps<{ id: string | null }>()
const emit = defineEmits<{ close: [] }>()
const tasks = useTasks()
const session = useSession()
const settings = useSettings()
const dv = useDevices()
const dsets = useDatasets()
const checking = ref(false)

const task = computed<Task | undefined>(() => (props.id ? tasks.byId(props.id) : undefined))
const tab = ref('overview')
const open = computed(() => !!task.value)

// 只有当开始采集 (running / paused) 后才允许使用操作预览
const isCollecting = computed(() => !!task.value && (task.value.status === 'running' || task.value.status === 'paused'))

/* 左侧独立驾驶舱遮罩：只有“采集中(running)”状态进入时默认自动呼出，其他状态不自动显示；亦可随时在头部手动展开/收起 */
const cockpitOpen = ref(false)

watch(
  () => props.id,
  (newId) => {
    if (newId) {
      tab.value = 'overview'
      const t = tasks.byId(newId)
      if (t) {
        tasks.seedLog(t)
        // 只有采集中状态进去会自动显示，其他状态不自动显示
        cockpitOpen.value = t.status === 'running'
      } else {
        cockpitOpen.value = false
      }
    } else {
      cockpitOpen.value = false
    }
  },
  { immediate: true },
)

const mayEdit = computed(() => session.can('tasks'))
const dis = computed(() => (mayEdit.value ? undefined : NO_PERM))
const sc = computed(() => (task.value ? SCEN[task.value.scen] : SCEN.qmd))
const op = computed(() => (task.value ? OPS[task.value.op] : OPS[0]))
const active = computed(() => !!task.value && ['ready', 'paused', 'running'].includes(task.value.status))
const devs = computed(() => (task.value ? task.value.devices.map((id) => dv.byId(id)).filter((d) => !!d) : []))
const eps = computed(() => (task.value ? tasks.episodesFor(task.value) : []))
const nextName = computed(() => (task.value ? settings.nameFile(sc.value.code, TODAY, task.value.done + 1, op.value.c) : ''))
const mode = computed(() => (task.value ? MODES[task.value.mode] : MODES.vr))
const dsName = computed(() => (task.value ? dsets.byId(task.value.datasetId)?.name ?? task.value.datasetId : ''))
const EP_ST = { ok: ['good', '已入库'], warn: ['warn', '带警告入库'], fail: ['crit', '未入库'] } as const
/** 五阶段：任务配置（创建时完成）→ 设备自检 → 场景复位与采集 → 数据校验 → 入库上传 */
const stages = computed(() => {
  const t = task.value
  if (!t) return []
  return [
    ['任务配置', mode.value.name + ' · ' + t.devices.length + ' 台设备 · 数据集 ' + t.datasetId],
    ['设备自检', '每次采集前执行：连接、电量、存储、延迟、标定与占用'],
    ['场景复位与采集', SCEN[t.scen].reset],
    ['数据校验', '自动校验 + 回放抽查，确认哪些数据入库'],
    ['入库上传', UPLOAD_STEPS.join(' → ')],
  ]
})
/** 自检结果按设备分组；全部正常的设备折叠成一行 */
const showAllChecks = ref(false)
const checkGroups = computed(() => {
  const m = new Map<string, CheckItem[]>()
  task.value?.check?.items.forEach((x) => { if (!m.has(x.group)) m.set(x.group, []); m.get(x.group)!.push(x) })
  return [...m.entries()].map(([g, items]) => ({ g, items, bad: items.filter((x) => !x.ok) }))
})

/* 动态时间码与运动采样计时器 */
const liveT = ref(0)
let liveTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  liveTimer = setInterval(() => {
    const t = task.value
    if (t?.status === 'running') {
      liveT.value = +((liveT.value + 0.1) % 20).toFixed(2)
      if (t.session) {
        t.session.sec = +(t.session.sec + 0.1).toFixed(1)
        // 演示：约每 6 秒完成一条 Episode
        if (Math.round(t.session.sec * 10) % 60 === 0) tasks.tickEpisode(t)
      }
    }
  }, 100)
})
onBeforeUnmount(() => {
  if (liveTimer) clearInterval(liveTimer)
})

/* 标记、备注与失败对话框 */
const flagDlg = reactive({
  open: false,
  tag: '工件表面反光',
  custom: '',
  tags: ['工件表面反光', '机械臂抖动', '保压微差波动', '节拍超标', '动作轻微偏移', '典型高质量'],
})
function openFlag() {
  flagDlg.open = true
  flagDlg.custom = ''
}
function doFlag() {
  const t = task.value
  if (!t) return
  const reason = flagDlg.custom.trim() || flagDlg.tag
  t.session?.marks.push({ t: t.session.sec, ep: t.session.eps, label: reason })
  tasks.addLog(t, '操作员标记当前数据：' + reason)
  tasks.touch(t)
  flagDlg.open = false
  toast('已添加数据标记：' + reason)
}

const noteDlg = reactive({ open: false, val: '' })
function openNote() {
  if (!task.value) return
  noteDlg.val = task.value.note || ''
  noteDlg.open = true
}
function doNote() {
  const t = task.value
  if (!t) return
  t.note = noteDlg.val.trim()
  tasks.addLog(t, '修改采集备注：' + (t.note || '已清空'))
  tasks.touch(t)
  noteDlg.open = false
  toast('采集备注已保存')
}

async function doFail() {
  const t = task.value
  if (!t) return
  const ok = await confirmDlg({
    title: '确认标记本次采集失败？',
    msg: '标记失败后，当前正在采集的这一条数据将作为废品丢弃，不进入校验和入库' + (t.params.autoRetry ? '，并自动开始重录这一条' : '') + '。',
    ok: '标记失败并重录',
    danger: true,
  })
  if (!ok) return
  if (t.session) t.session.fails++
  tasks.addLog(t, '当前这一条已标记失败并丢弃，重新录制')
  tasks.touch(t)
  toast('当前这一条已标记失败，开始重录')
}

/** 回退到上一个事件标记：丢弃标记之后采集的数据 */
async function doRollback() {
  const t = task.value
  const m = t?.session?.marks[t.session.marks.length - 1]
  if (!t || !t.session) return
  if (!m) { toast('还没有事件标记，先点“标记”再回退', { type: 'warn' }); return }
  const drop = t.session.eps - m.ep
  const ok = await confirmDlg({ title: '回退到标记「' + m.label + '」？', msg: '将丢弃该标记之后采集的 ' + drop + ' 条数据，从第 ' + (m.ep + 1) + ' 条重新开始录制。', ok: '确认回退', danger: true })
  if (!ok) return
  t.session.eps = m.ep
  t.session.marks.pop()
  tasks.addLog(t, '回退到标记「' + m.label + '」，丢弃 ' + drop + ' 条')
  tasks.touch(t)
  toast('已回退，丢弃 ' + drop + ' 条')
}

/** 停止后的“采集结果”对话框 */
const resultOpen = ref(false)
const fmtSec = (x: number) => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(Math.floor(x % 60)).padStart(2, '0')
function submitVerify() {
  const t = task.value
  if (!t) return
  resultOpen.value = false
  tasks.endCollect(t); cockpitOpen.value = false
  toast('已结束本次采集，正在自动校验')
}
async function discardRun() {
  const t = task.value
  if (!t) return
  const ok = await confirmDlg({ title: '放弃本次采集？', msg: '本次采集的 ' + (t.session?.eps ?? 0) + ' 条数据都不会入库，回到“场景复位与采集”。', ok: '放弃本次', danger: true })
  if (!ok) return
  resultOpen.value = false; cockpitOpen.value = false
  t.status = 'ready'; t.session = undefined; t.reset = false
  tasks.addLog(t, '放弃本次采集'); tasks.touch(t)
}
function confirmReset() {
  const t = task.value
  if (!t) return
  t.reset = true; tasks.addLog(t, '确认场景复位：' + SCEN[t.scen].reset); tasks.touch(t)
}
function replay() {
  const v = task.value?.verify
  if (!v) return
  v.replay = Math.min(v.total, v.replay + 3)
  toast('已回放抽查 ' + v.replay + ' 条，画面与传感器曲线正常')
}
function finishRun() { const t = task.value; if (t) { tasks.closeRun(t); toast('本次采集流程完成，下一次采集前请重新自检') } }

function stepState(i: number) {
  const t = task.value!
  if (i === 0) return { done: true, cur: false }
  return { done: active.value && i - 1 < t.sop, cur: active.value && i - 1 === t.sop }
}
async function runCheck() {
  const t = task.value
  if (!t || checking.value) return
  checking.value = true
  const items = await tasks.selfCheck(t)
  checking.value = false
  const bad = items.filter((x) => !x.ok).length
  showAllChecks.value = false
  if (bad) toast('自检发现 ' + bad + ' 项异常，请处理后重新自检', { type: 'warn' })
  else toast('设备自检通过')
}
async function act(a: string) {
  const t = task.value
  if (!t) return
  if (a === 'submit') { t.status = 'ready'; tasks.addLog(t, '草稿已提交，等待开始'); toast('任务已提交') }
  else if (a === 'del') {
    const ok = await confirmDlg({ title: '删除草稿 ' + t.id + '？', msg: '草稿删除后无法恢复。', ok: '删除', danger: true })
    if (!ok) return
    tasks.list.splice(tasks.list.indexOf(t), 1)
    emit('close'); toast('草稿已删除'); return
  } else if (a === 'start') { tasks.startSession(t); cockpitOpen.value = true; toast('开始采集 · ' + t.id) }
  else if (a === 'finish') {
    const ok = await confirmDlg({ title: '完成任务 ' + t.id + '？', msg: '共采集 ' + t.done + ' 条有效数据。完成后任务不再接收新数据。', ok: '完成任务' })
    if (!ok) return
    t.status = 'done'; tasks.closeRun(t); cockpitOpen.value = false; tasks.addLog(t, '任务已完成，共 ' + t.done + ' 条'); toast('任务已完成')
  }
  else if (a === 'resume') { t.status = 'running'; tasks.addLog(t, '继续采集'); toast('已继续采集') }
  else if (a === 'pause') {
    t.status = 'paused'; tasks.addLog(t, '暂停采集')
    toast('已暂停', { action: '撤销', onAction: () => { t.status = 'running'; tasks.addLog(t, '撤销暂停'); tasks.touch(t) } })
  } else if (a === 'end') { resultOpen.value = true; return }
  else if (a === 'cancel') {
    const ok = await confirmDlg({ title: '取消任务 ' + t.id + '？', msg: '已采集的 ' + t.done + ' 条数据会保留，任务将不再接收新数据。之后可以重新开启。', ok: '确认取消', danger: true })
    if (!ok) return
    t.status = 'cancel'; tasks.closeRun(t); cockpitOpen.value = false; tasks.addLog(t, '任务已取消'); toast('任务已取消')
  } else if (a === 'reopen') { t.status = 'ready'; t.sop = 0; tasks.addLog(t, '任务重新开启'); toast('任务已重新开启') }
  tasks.touch(t)
}
const epCols = [
  { title: '数据文件', key: 'file' },
  { title: '时长', key: 'dur', align: 'right' as const },
  { title: '完整率', key: 'integrity', align: 'right' as const },
  { title: '同步误差', key: 'sync', align: 'right' as const },
  { title: '结论', key: 'qc' },
]
</script>

<template>
  <!-- 右侧：标准 640px 任务抽屉，布局完全不受左侧驾驶舱影响，保持原汁原味原生结构 -->
  <a-drawer
    :open="open"
    :width="640"
    :mask="false"
    :closable="false"
    placement="right"
    :body-style="{ padding: '18px 22px 24px' }"
    :header-style="{ padding: '16px 22px 0', borderBottom: 0 }"
    destroy-on-close
    @close="emit('close')"
  >
    <template #title>
      <div v-if="task" style="display:flex;flex-direction:column;gap:12px;width:100%">
        <div class="row between" style="align-items:center">
          <div class="row" style="gap:10px;align-items:center">
            <span class="mono">{{ task.id }}</span>
            <StatusBadge :kind="TASK_ST[task.status][0]" :text="TASK_ST[task.status][1]" />
          </div>
          <div class="row" style="gap:8px;align-items:center">
            <!-- 驾驶舱浮窗唤出/收起按钮 (只有当开始采集后才能点击使用) -->
            <button
              type="button"
              class="cockpit-trigger-btn"
              :class="{
                active: cockpitOpen && isCollecting,
                disabled: !isCollecting
              }"
              :disabled="!isCollecting"
              :title="!isCollecting ? '只有当开始采集后方可点击使用操作预览' : (cockpitOpen ? '收起操作预览' : '展开操作预览')"
              @click="isCollecting && (cockpitOpen = !cockpitOpen)"
            >
              <span
                class="dot-pulse"
                :class="{
                  live: task.status === 'running',
                  paused: task.status === 'paused'
                }"
              />
              <span>操作预览</span>
            </button>

            <button type="button" class="icon-btn" aria-label="关闭" @click="emit('close')"><AppIcon name="x" /></button>
          </div>
        </div>
        <div>
          <h2 style="font-size:20px;font-weight:600">{{ task.name }}</h2>
          <p class="muted" style="margin-top:2px;font-weight:400;font-size:14px">{{ sc.name }} · {{ mode.name }} · {{ op.n }} · {{ task.devices.length }} 台设备</p>
        </div>
        <a-tabs v-model:active-key="tab" :tab-bar-style="{ marginBottom: 0 }">
          <a-tab-pane key="overview" tab="概览" /><a-tab-pane key="records" tab="采集记录" /><a-tab-pane key="logs" tab="日志" />
        </a-tabs>
      </div>
    </template>

    <div v-if="task" class="drawer-main-content">
      <template v-if="tab === 'overview'">
        <!-- 数据概览卡片 -->
        <div class="card"><div class="card-body row between">
          <div><span class="num" style="font-size:30px;font-weight:600">{{ task.done }}</span><span class="muted"> 条有效数据</span></div>
          <span class="muted">{{ task.status === 'done' ? '任务已完成' : '每次采集校验通过后入库累计' }}</span>
        </div></div>

        <!-- 采集五阶段 -->
        <div>
          <div class="row between" style="margin-bottom:10px">
            <h3 style="font-size:15px;font-weight:600">采集流程</h3>
            <span class="muted" style="font-size:12.5px">配置 → 自检 → 复位与采集 → 校验 → 入库</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div v-for="(s, i) in stages" :key="i">
              <div class="sop-item" :class="stepState(i).done ? 'done' : stepState(i).cur ? '' : 'locked'">
                <span class="step"><span class="n" :style="stepState(i).done ? 'background:var(--good-solid);border-color:var(--good-solid);color:#fff' : ''">{{ i + 1 }}</span></span>
                <div style="flex:1;min-width:0"><div class="t">{{ s[0] }}</div><div class="d">{{ s[1] }}</div></div>
                <span v-if="stepState(i).done" style="color:var(--good)"><AppIcon name="check" /></span>
                <template v-else-if="stepState(i).cur && i === 1">
                  <a-button size="small" type="primary" :loading="checking" :disabled="!mayEdit" :title="dis" @click="runCheck">{{ task.check ? '重新自检' : '开始自检' }}</a-button>
                </template>
                <template v-else-if="stepState(i).cur && i === 2">
                  <StatusBadge v-if="task.status === 'running'" kind="info" :text="'采集中 · 第 ' + ((task.session?.eps ?? 0) + 1) + ' 条'" />
                  <StatusBadge v-else-if="task.status === 'paused'" kind="warn" :text="'已暂停 · 已采 ' + (task.session?.eps ?? 0) + ' 条'" />
                  <a-button v-else-if="!task.reset" size="small" type="primary" :disabled="!mayEdit" :title="dis" @click="confirmReset">确认已复位</a-button>
                  <span v-else class="muted" style="font-size:12.5px">点击“开始采集”</span>
                </template>
                <template v-else-if="stepState(i).cur && i === 3">
                  <StatusBadge v-if="task.verify?.state === 'running'" kind="info" text="自动校验中…" />
                  <StatusBadge v-else kind="warn" text="待确认" />
                </template>
                <template v-else-if="stepState(i).cur && i === 4">
                  <StatusBadge v-if="task.upload?.state === 'running'" kind="info" :text="UPLOAD_STEPS[task.upload.step] + '…'" />
                  <a-button v-else size="small" type="primary" :disabled="!mayEdit" :title="dis" @click="finishRun">完成本次</a-button>
                </template>
              </div>

              <!-- 自检结果 -->
              <div v-if="i === 1 && task.check && stepState(1).cur" class="chk">
                <template v-for="g in checkGroups" :key="g.g">
                  <div v-if="!g.bad.length && !showAllChecks" class="chk-i ok"><AppIcon name="check" size="sm" /><span class="grow">{{ g.g }}</span><span>{{ g.items.length }} 项正常</span></div>
                  <template v-else>
                    <div v-for="x in (showAllChecks ? g.items : g.bad)" :key="x.id" class="chk-i" :class="x.ok ? 'ok' : 'bad'"><AppIcon :name="x.ok ? 'check' : 'alert'" size="sm" /><span class="grow">{{ g.g }} · {{ x.name }}</span><span>{{ x.val }}<span class="muted"> / {{ x.rule }}</span></span></div>
                  </template>
                </template>
                <a-button type="link" size="small" style="align-self:flex-start;padding:0" @click="showAllChecks = !showAllChecks">{{ showAllChecks ? '收起' : '查看全部 ' + task.check.items.length + ' 项' }}</a-button>
              </div>

              <!-- 校验报告 -->
              <div v-if="i === 3 && stepState(3).cur && task.verify?.state === 'done'" class="vf">
                <div class="vf-sum">
                  <span>共 <b class="num">{{ task.verify.total }}</b> 条</span>
                  <span class="good">通过 <b class="num">{{ task.verify.pass }}</b></span>
                  <span class="warn">警告 <b class="num">{{ task.verify.warn }}</b></span>
                  <span class="crit">不通过 <b class="num">{{ task.verify.fail }}</b></span>
                </div>
                <table class="vf-t"><thead><tr><th>校验项</th><th>规则</th><th class="r">通过</th><th class="r">警告</th><th class="r">不通过</th></tr></thead>
                  <tbody><tr v-for="r in task.verify.rules" :key="r.key"><td>{{ r.name }}</td><td class="muted">{{ r.rule }}</td><td class="r num">{{ r.pass }}</td><td class="r num" :class="{ warn: r.warn }">{{ r.warn }}</td><td class="r num" :class="{ crit: r.fail }">{{ r.fail }}</td></tr></tbody></table>
                <div class="row between" style="gap:10px;flex-wrap:wrap">
                  <span class="row" style="gap:12px">
                    <a-button size="small" @click="replay"><AppIcon name="play" size="sm" />回放抽查</a-button>
                    <span class="muted" style="font-size:12.5px">已抽查 {{ task.verify.replay }} 条</span>
                    <a-checkbox v-model:checked="task.verify.keepWarn">警告数据带警告入库</a-checkbox>
                  </span>
                  <a-button size="small" type="primary" :disabled="!mayEdit" :title="dis" @click="tasks.confirmVerify(task)">确认并入库 {{ task.verify.pass + (task.verify.keepWarn ? task.verify.warn : 0) }} 条</a-button>
                </div>
                <span class="muted" style="font-size:12px">不通过的数据不入库；警告数据入库后在标注、审核时会带警告标识</span>
              </div>

              <!-- 入库进度 -->
              <div v-if="i === 4 && stepState(4).cur && task.upload" class="vf">
                <div class="up-steps">
                  <span v-for="(u, k) in UPLOAD_STEPS" :key="u" class="up" :class="k < task.upload.step || task.upload.state === 'done' ? 'done' : k === task.upload.step ? 'cur' : ''"><AppIcon v-if="k < task.upload.step || task.upload.state === 'done'" name="check" size="sm" />{{ u }}</span>
                </div>
                <span class="muted" style="font-size:12.5px">本次入库 {{ task.upload.count }} 条<template v-if="task.upload.retry.length">，其中 {{ task.upload.retry.length }} 条上传失败已进入待重传队列</template></span>
              </div>
            </div>
          </div>
        </div>

        <!-- 待重传队列 -->
        <div v-if="task.retry.length" class="callout warn" style="flex-direction:column;align-items:stretch;gap:8px">
          <span><AppIcon name="alert" size="sm" /> 待重传 {{ task.retry.length }} 条：入库时网络中断，自动重试 3 次仍失败</span>
          <div v-for="f in task.retry" :key="f" class="row between"><span class="mono" style="font-size:12.5px">{{ f }}</span><a-button size="small" :disabled="!mayEdit" :title="dis" @click="tasks.retryUpload(task, f); toast('重传成功')">重传</a-button></div>
        </div>

        <!-- 任务属性 -->
        <dl class="kv">
          <dt>采集场景</dt><dd>{{ sc.name }}</dd><dt>采集模式</dt><dd>{{ mode.name }}</dd><dt>目标数据集</dt><dd>{{ dsName }} <span class="muted mono">{{ task.datasetId }}</span></dd><dt>采集参数</dt><dd>{{ task.params.fps }} fps · {{ task.params.res }} · {{ task.params.codec }} <span class="muted">（来自设备配置）</span></dd><dt>语言指令</dt><dd>{{ task.lang || '—' }}</dd><dt>操作员</dt><dd>{{ op.n }}（{{ op.c }}）</dd>
          <dt>备注</dt><dd>{{ task.note || '—' }}</dd>
          <dt>采集设备</dt><dd><span v-for="d in devs" :key="d!.id" class="tag" style="margin:0 6px 6px 0">{{ d!.name }}</span></dd><dt>文件命名</dt><dd class="mono">{{ nextName }}</dd>
        </dl>
      </template>

      <template v-else-if="tab === 'records'">
        <template v-if="eps.length">
          <div class="callout info"><AppIcon name="info" /><span>校验阈值：完整率 ≥ {{ settings.cfg.integrity }}%，同步误差 ≤ {{ settings.cfg.sync }} ms，单条时长 {{ sc.dur[0] }}–{{ sc.dur[1] }} 秒。完整的采集历史见“采集任务 → 采集历史”。</span></div>
          <div class="card">
            <a-table :columns="epCols" :data-source="eps" row-key="file" :pagination="false" size="middle" :scroll="{ x: 560 }">
              <template #bodyCell="{ column, record }">
                <div v-if="column.key === 'file'" class="cell-main"><span class="mono">{{ record.file }}</span><small class="muted">{{ record.size }} GB · 质量分 {{ record.score }}</small></div>
                <span v-else-if="column.key === 'dur'" class="num">{{ record.dur }} s</span>
                <span v-else-if="column.key === 'integrity'" class="num" :style="record.integrity < settings.cfg.integrity ? 'color:var(--crit);font-weight:500' : ''">{{ record.integrity }}%</span>
                <span v-else-if="column.key === 'sync'" class="num" :style="record.sync > settings.cfg.sync ? 'color:var(--crit);font-weight:500' : ''">{{ record.sync }} ms</span>
                <StatusBadge v-else-if="column.key === 'qc'" :kind="EP_ST[record.verdict as 'ok'][0]" :text="EP_ST[record.verdict as 'ok'][1]" />
              </template>
            </a-table>
          </div>
        </template>
        <EmptyState v-else icon="file" title="还没有采集记录" desc="开始采集后，每一条数据会出现在这里" />
      </template>

      <div v-else class="list-i">
        <div v-for="(x, i) in task.log" :key="i" class="li" style="align-items:flex-start"><span class="mono muted" style="width:64px;flex:none;padding-top:1px">{{ x.t }}</span><span>{{ x.m }}</span></div>
      </div>
    </div>

    <template #footer>
      <div v-if="task" style="display:flex;gap:10px;justify-content:flex-end">
        <template v-if="task.status === 'draft'"><a-button danger :disabled="!mayEdit" :title="dis" @click="act('del')">删除草稿</a-button><a-button type="primary" :disabled="!mayEdit" :title="dis" @click="act('submit')">提交任务</a-button></template>
        <template v-else-if="task.status === 'ready'"><a-button danger :disabled="!mayEdit" :title="dis" @click="act('cancel')">取消任务</a-button><a-button v-if="task.done > 0 && task.sop <= 1" :disabled="!mayEdit" :title="dis" @click="act('finish')">完成任务</a-button><a-button v-if="task.sop <= 1" type="primary" :disabled="!mayEdit || task.sop !== 1 || !task.reset" :title="mayEdit ? (task.sop !== 1 ? '请先完成设备自检' : !task.reset ? '请先确认场景复位' : undefined) : NO_PERM" @click="act('start')"><AppIcon name="play" size="sm" />开始采集</a-button></template>
        <span v-else-if="task.status === 'running' && task.sop >= 2" class="muted" style="font-size:12.5px;align-self:center">本次采集已结束，请在上方完成数据校验与入库</span>
        <template v-else-if="task.status === 'running'"><a-button :disabled="!mayEdit" :title="dis" @click="act('pause')"><AppIcon name="pause" size="sm" />暂停</a-button><a-button type="primary" :disabled="!mayEdit" :title="dis" @click="act('end')"><AppIcon name="stop" size="sm" />结束本次采集</a-button></template>
        <template v-else-if="task.status === 'paused'"><a-button danger :disabled="!mayEdit" :title="dis" @click="act('cancel')">取消任务</a-button><a-button :disabled="!mayEdit" :title="dis" @click="act('finish')">完成任务</a-button><a-button type="primary" :disabled="!mayEdit" :title="dis" @click="act('resume')"><AppIcon name="play" size="sm" />继续采集</a-button></template>
        <template v-else-if="task.status === 'cancel'"><a-button type="primary" :disabled="!mayEdit" :title="dis" @click="act('reopen')">重新开启</a-button></template>
        <a-button v-else @click="emit('close')">关闭</a-button>
      </div>
    </template>
  </a-drawer>

  <!-- 左侧独立的大疆司空风格驾驶舱遮罩面板（独立存在，不连结右侧抽屉，不破坏右侧布局） -->
  <CockpitOverlay
    v-if="open && task && (task.status === 'running' || task.status === 'paused')"
    :open="cockpitOpen"
    :task="task"
    :live-t="liveT"
    :may-edit="mayEdit"
    :dis="dis"
    @close="cockpitOpen = false"
    @pause="act('pause')"
    @resume="act('resume')"
    @end="act('end')"
    @flag="openFlag"
    @note="openNote"
    @fail="doFail"
    @rollback="doRollback"
  />

  <!-- 停止后的采集结果 -->
  <a-modal v-model:open="resultOpen" title="本次采集结果" centered :z-index="2000" :footer="null" :width="480">
    <div v-if="task?.session" style="display:flex;flex-direction:column;gap:14px">
      <div class="res-grid">
        <div><span class="muted">采集时长</span><b class="num">{{ fmtSec(task.session.sec) }}</b></div>
        <div><span class="muted">完成条数</span><b class="num">{{ task.session.eps }}</b></div>
        <div><span class="muted">事件标记</span><b class="num">{{ task.session.marks.length }}</b></div>
        <div><span class="muted">标记失败（已丢弃）</span><b class="num">{{ task.session.fails }}</b></div>
      </div>
      <span class="muted" style="font-size:12.5px">提交后自动校验文件完整性、时长、丢帧、时间同步、{{ task.mode === 'vr' ? 'VR 追踪漂移' : 'UMI 位姿跳变' }}与传感器范围，再由你确认入库。</span>
      <div class="row" style="gap:10px;justify-content:flex-end">
        <a-button danger @click="discardRun">放弃本次</a-button>
        <a-button @click="resultOpen = false">继续采集</a-button>
        <a-button type="primary" :disabled="!task.session.eps" :title="task.session.eps ? undefined : '还没有完整采集的数据'" @click="submitVerify">提交校验</a-button>
      </div>
    </div>
  </a-modal>

  <!-- 标记对话框 -->
  <a-modal v-model:open="flagDlg.open" title="标记当前采集数据" centered :z-index="2000" ok-text="确认标记" cancel-text="取消" @ok="doFlag">
    <a-form layout="vertical">
      <a-form-item label="快捷标记类型">
        <div class="row wrap" style="gap:6px">
          <button v-for="tag in flagDlg.tags" :key="tag" type="button" class="chip" :aria-pressed="flagDlg.tag === tag && !flagDlg.custom" @click="flagDlg.tag = tag; flagDlg.custom = ''">{{ tag }}</button>
        </div>
      </a-form-item>
      <a-form-item label="自定义标记说明">
        <a-textarea v-model:value="flagDlg.custom" :rows="2" :maxlength="50" show-count placeholder="选填，如特定异常工况或重点标注要求" />
      </a-form-item>
    </a-form>
  </a-modal>

  <!-- 备注对话框 -->
  <a-modal v-model:open="noteDlg.open" title="修改采集备注" centered :z-index="2000" ok-text="保存备注" cancel-text="取消" @ok="doNote">
    <a-form layout="vertical">
      <a-form-item label="任务备注信息" help="保存后将记录在任务属性及采集日志中">
        <a-textarea v-model:value="noteDlg.val" :rows="3" :maxlength="100" show-count placeholder="填写工件批次、特殊要求或采集环境记录..." />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style>
.chk { margin: 6px 0 2px 44px; display: flex; flex-direction: column; gap: 4px; }
.chk-i { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; font-size: 12.5px; background: var(--surface-2); }
.chk-i.ok { color: var(--good); } .chk-i.bad { color: var(--crit); background: var(--crit-soft); }
.chk-i span:last-child { color: inherit; }
.vf { margin: 6px 0 2px 44px; display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 8px; background: var(--surface-2); border: 1px solid var(--line); }
.vf-sum { display: flex; gap: 16px; font-size: 13px; }
.vf-sum .good { color: var(--good); } .vf-sum .warn { color: var(--warn); } .vf-sum .crit { color: var(--crit); }
.vf-t { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.vf-t th { text-align: left; font-weight: 500; color: var(--muted); padding: 4px 6px; border-bottom: 1px solid var(--line); }
.vf-t td { padding: 5px 6px; border-bottom: 1px solid var(--line); }
.vf-t .r { text-align: right; } .vf-t td.warn { color: var(--warn); font-weight: 600; } .vf-t td.crit { color: var(--crit); font-weight: 600; }
.up-steps { display: flex; flex-wrap: wrap; gap: 6px; }
.up { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 12px; font-size: 12px; background: var(--surface-3); color: var(--muted); }
.up.done { background: var(--good-soft); color: var(--good); } .up.cur { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.res-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.res-grid > div { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 8px; background: var(--surface-2); }
.res-grid b { font-size: 20px; }

.drawer-main-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 抽屉头部操作预览控制按钮 */
.cockpit-trigger-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: var(--surface-2);
  border: 1px solid var(--line);
  color: var(--text);
  transition: all 0.2s ease;
}
.cockpit-trigger-btn:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--accent);
}
.cockpit-trigger-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: auto;
}
.cockpit-trigger-btn.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

/* 硬件级呼吸灯指示器 (无抖动、无闪烁，丝滑微晕脉冲) */
.dot-pulse {
  width: 6.5px;
  height: 6.5px;
  border-radius: 50%;
  background: #94a3b8;
  display: inline-block;
  flex-shrink: 0;
  transition: background 0.3s ease;
}

/* 采集中状态：翡翠绿柔和呼吸 */
.dot-pulse.live {
  background: #10b981;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
  animation: smoothBreath 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

/* 暂停中状态：琥珀色平缓呼吸 */
.dot-pulse.paused {
  background: #f59e0b;
  box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
  animation: smoothBreathAmber 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes smoothBreath {
  0% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
    opacity: 1;
  }
  50% {
    box-shadow: 0 0 0 5px rgba(16, 185, 129, 0);
    opacity: 0.75;
  }
  100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
    opacity: 1;
  }
}

@keyframes smoothBreathAmber {
  0% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
    opacity: 1;
  }
  50% {
    box-shadow: 0 0 0 5px rgba(245, 158, 11, 0);
    opacity: 0.75;
  }
  100% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
    opacity: 1;
  }
}
</style>
