<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import CockpitOverlay from './CockpitOverlay.vue'
import { NO_PERM, OPS, SCEN, TASK_ST, TODAY } from '@/constants'
import { sopSteps, useTasks, type Task } from '@/stores/tasks'
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
const checking = ref(false)

const task = computed<Task | undefined>(() => (props.id ? tasks.byId(props.id) : undefined))
const tab = ref('overview')
const open = computed(() => !!task.value)

/* 左侧独立驾驶舱遮罩：采集中或已暂停默认呼出，亦可随时展开/收起 */
const cockpitOpen = ref(false)
watch(
  () => [props.id, task.value?.status],
  () => {
    if (task.value && (task.value.status === 'running' || task.value.status === 'paused')) {
      cockpitOpen.value = true
    } else {
      cockpitOpen.value = false
    }
  },
  { immediate: true },
)

watch(() => props.id, (v) => { if (v) { tab.value = 'overview'; const t = tasks.byId(v); if (t) tasks.seedLog(t) } })

const mayEdit = computed(() => session.can('tasks'))
const dis = computed(() => (mayEdit.value ? undefined : NO_PERM))
const sc = computed(() => (task.value ? SCEN[task.value.scen] : SCEN.qmd))
const op = computed(() => (task.value ? OPS[task.value.op] : OPS[0]))
const steps = computed(() => (task.value ? sopSteps(task.value.scen) : []))
const active = computed(() => !!task.value && ['ready', 'paused', 'running'].includes(task.value.status))
const devs = computed(() => (task.value ? task.value.devices.map((id) => dv.byId(id)).filter((d) => !!d) : []))
const eps = computed(() => (task.value ? tasks.episodesFor(task.value) : []))
const nextName = computed(() => (task.value ? settings.nameFile(sc.value.code, TODAY, task.value.done + 1, op.value.c) : ''))
const epOk = (e: { integrity: number; sync: number }) => e.integrity >= settings.cfg.integrity && e.sync <= settings.cfg.sync

/* 动态时间码与运动采样计时器 */
const liveT = ref(0)
let liveTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  liveTimer = setInterval(() => {
    if (task.value?.status === 'running') {
      liveT.value = +((liveT.value + 0.1) % 20).toFixed(2)
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
    msg: '标记失败后，当前正在采集的这一条数据将作为废品丢弃，不计入有效条数（当前已累计 ' + t.done + ' 条）。可立即重新开始本次采集。',
    ok: '标记失败并重采',
    danger: true,
  })
  if (!ok) return
  tasks.addLog(t, '本次采集异常（已标记失败并重置）')
  tasks.touch(t)
  toast('本次采集已标记为失败，已重置当前采集状态')
}

function stepState(i: number) {
  const t = task.value!
  return { done: i < t.sop || (i === 1 && active.value), cur: i === t.sop && active.value }
}
async function runCheck() {
  const t = task.value
  if (!t || checking.value) return
  checking.value = true
  const items = await tasks.selfCheck(t)
  checking.value = false
  const bad = items.filter((x) => !x.ok).length
  if (bad) toast('自检发现 ' + bad + ' 台设备异常，请处理后重试', { type: 'warn' })
  else toast('设备自检通过，设备巡检已完成')
}
async function manualDone(i: number) {
  const t = task.value
  if (!t) return
  if (i === 0 && (!t.check || t.check.items.some((x) => !x.ok))) {
    const ok = await confirmDlg({ title: t.check ? '仍有设备自检异常，确认标记完成？' : '尚未执行设备自检，确认直接标记完成？', msg: '建议先点击“自检设备”确认全部设备状态正常。', ok: '仍然标记完成' })
    if (!ok) return
  }
  if (i === 4) { tasks.finishQc(t, false); return }
  doStep(i)
}
function doStep(i: number) {
  const t = task.value
  if (!t || i !== t.sop || t.sop === 3) return
  tasks.bump(t)
  tasks.addLog(t, '完成「' + steps.value[i][0] + '」')
  if (t.sop === 6) {
    const add = 30 + Math.floor(Math.random() * 50)
    t.done += add
    t.sop = 0; t.qc = 'idle'; t.check = undefined
    tasks.addLog(t, '本次采集已归档，新增 ' + add + ' 条有效数据')
    toast('本次采集已归档，新增 ' + add + ' 条')
  }
  tasks.touch(t)
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
  } else if (a === 'start') { t.status = 'running'; t.sop = 3; cockpitOpen.value = true; tasks.addLog(t, '开始采集'); toast('开始采集 · ' + t.id) }
  else if (a === 'finish') {
    const ok = await confirmDlg({ title: '完成任务 ' + t.id + '？', msg: '共采集 ' + t.done + ' 条有效数据。完成后任务不再接收新数据。', ok: '完成任务' })
    if (!ok) return
    t.status = 'done'; t.sop = 0; cockpitOpen.value = false; tasks.addLog(t, '任务已完成，共 ' + t.done + ' 条'); toast('任务已完成')
  }
  else if (a === 'resume') { t.status = 'running'; tasks.addLog(t, '继续采集'); toast('已继续采集') }
  else if (a === 'pause') {
    t.status = 'paused'; tasks.addLog(t, '暂停采集')
    toast('已暂停', { action: '撤销', onAction: () => { t.status = 'running'; tasks.addLog(t, '撤销暂停'); tasks.touch(t) } })
  } else if (a === 'end') { tasks.endCollect(t); cockpitOpen.value = false; toast('采集已结束，结束动作已自动下发后台，正在自动质检') }
  else if (a === 'cancel') {
    const ok = await confirmDlg({ title: '取消任务 ' + t.id + '？', msg: '已采集的 ' + t.done + ' 条数据会保留，任务将不再接收新数据。之后可以重新开启。', ok: '确认取消', danger: true })
    if (!ok) return
    t.status = 'cancel'; t.sop = 0; cockpitOpen.value = false; tasks.addLog(t, '任务已取消'); toast('任务已取消')
  } else if (a === 'reopen') { t.status = 'ready'; t.sop = 0; tasks.addLog(t, '任务重新开启'); toast('任务已重新开启') }
  tasks.touch(t)
}
const epCols = [
  { title: '数据文件', key: 'file' },
  { title: '时长', key: 'dur', align: 'right' as const },
  { title: '完整率', key: 'integrity', align: 'right' as const },
  { title: '同步误差', key: 'sync', align: 'right' as const },
  { title: '质检', key: 'qc' },
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
            <!-- 驾驶舱浮窗唤出/收起按钮 -->
            <button
              v-if="task.status === 'running' || task.status === 'paused'"
              type="button"
              class="cockpit-trigger-btn"
              :class="{ active: cockpitOpen }"
              :title="cockpitOpen ? '收起左侧驾驶舱' : '展开左侧大疆司空驾驶舱'"
              @click="cockpitOpen = !cockpitOpen"
            >
              <span class="dot-pulse" />
              <span>{{ cockpitOpen ? '收起驾驶舱' : '驾驶舱视角' }}</span>
            </button>

            <button type="button" class="icon-btn" aria-label="关闭" @click="emit('close')"><AppIcon name="x" /></button>
          </div>
        </div>
        <div>
          <h2 style="font-size:20px;font-weight:600">{{ task.name }}</h2>
          <p class="muted" style="margin-top:2px;font-weight:400;font-size:14px">{{ sc.name }} · {{ sc.mode }} · {{ op.n }} · {{ task.devices.length }} 台设备</p>
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
          <span class="muted">{{ task.status === 'done' ? '任务已完成' : '随采集归档累计' }}</span>
        </div></div>

        <!-- 本次采集 SOP 流程：纯净清晰的 6 步，无任何参数杂项干扰 -->
        <div>
          <div class="row between" style="margin-bottom:10px">
            <h3 style="font-size:15px;font-weight:600">本次采集 SOP</h3>
            <span class="muted" style="font-size:12.5px">巡检 → 标定 → 复位 → 采集 → 质检 → 归档</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div v-for="(s, i) in steps" :key="i">
              <div class="sop-item" :class="stepState(i).done ? 'done' : stepState(i).cur ? '' : 'locked'">
                <span class="step"><span class="n" :style="stepState(i).done ? 'background:var(--good-solid);border-color:var(--good-solid);color:#fff' : ''">{{ i + 1 }}</span></span>
                <div style="flex:1;min-width:0"><div class="t">{{ s[0] }}<span v-if="i === 1 && stepState(i).done" class="tag" style="margin-left:8px">默认完成</span></div><div class="d">{{ s[1] }}</div></div>
                <span v-if="stepState(i).done" style="color:var(--good)"><AppIcon name="check" /></span>
                <template v-else-if="stepState(i).cur && i === 3"><StatusBadge v-if="task.status === 'running'" kind="info" text="进行中" /><span v-else class="muted" style="font-size:12.5px">点击“开始采集”</span></template>
                <template v-else-if="stepState(i).cur && i === 4"><StatusBadge v-if="task.qc === 'running'" kind="info" text="后台质检中…" /><a-button size="small" :disabled="!mayEdit" :title="dis" @click="manualDone(4)">标记完成</a-button></template>
                <template v-else-if="stepState(i).cur && i === 0 && task.status !== 'running'">
                  <a-button size="small" type="primary" :loading="checking" :disabled="!mayEdit" :title="dis" @click="runCheck">自检设备</a-button>
                  <a-button size="small" :disabled="!mayEdit || checking" :title="dis" @click="manualDone(0)">标记完成</a-button>
                </template>
                <a-button v-else-if="stepState(i).cur && task.status !== 'running'" size="small" :disabled="!mayEdit" :title="dis" @click="manualDone(i)">标记完成</a-button>
              </div>
              <div v-if="i === 0 && task.check" class="chk">
                <div v-for="x in task.check!.items" :key="x.id" class="chk-i" :class="x.ok ? 'ok' : 'bad'"><AppIcon :name="x.ok ? 'check' : 'alert'" size="sm" /><span class="grow">{{ x.name }}</span><span>{{ x.msg }}</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 任务属性 -->
        <dl class="kv">
          <dt>采集场景</dt><dd>{{ sc.name }}</dd><dt>采集方式</dt><dd>{{ sc.mode }}</dd><dt>操作员</dt><dd>{{ op.n }}（{{ op.c }}）</dd>
          <dt>备注</dt><dd>{{ task.note || '—' }}</dd>
          <dt>采集设备</dt><dd><span v-for="d in devs" :key="d!.id" class="tag" style="margin:0 6px 6px 0">{{ d!.name }}</span></dd><dt>文件命名</dt><dd class="mono">{{ nextName }}</dd>
        </dl>
      </template>

      <template v-else-if="tab === 'records'">
        <template v-if="eps.length">
          <div class="callout info"><AppIcon name="info" /><span>当前质检阈值：完整率 ≥ {{ settings.cfg.integrity }}%，同步误差 ≤ {{ settings.cfg.sync }} ms。可在“系统管理 → 系统设置”调整。</span></div>
          <div class="card">
            <a-table :columns="epCols" :data-source="eps" row-key="file" :pagination="false" size="middle" :scroll="{ x: 560 }">
              <template #bodyCell="{ column, record }">
                <div v-if="column.key === 'file'" class="cell-main"><span class="mono">{{ record.file }}</span><small class="muted">{{ record.size }} GB · 质量分 {{ record.score }}</small></div>
                <span v-else-if="column.key === 'dur'" class="num">{{ record.dur }} s</span>
                <span v-else-if="column.key === 'integrity'" class="num" :style="record.integrity < settings.cfg.integrity ? 'color:var(--crit);font-weight:500' : ''">{{ record.integrity }}%</span>
                <span v-else-if="column.key === 'sync'" class="num" :style="record.sync > settings.cfg.sync ? 'color:var(--crit);font-weight:500' : ''">{{ record.sync }} ms</span>
                <StatusBadge v-else-if="column.key === 'qc'" :kind="epOk(record) ? 'good' : 'crit'" :text="epOk(record) ? '合格' : '已隔离'" />
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
        <template v-else-if="task.status === 'ready'"><a-button danger :disabled="!mayEdit" :title="dis" @click="act('cancel')">取消任务</a-button><a-button v-if="task.done > 0 && task.sop === 0" :disabled="!mayEdit" :title="dis" @click="act('finish')">完成任务</a-button><a-button type="primary" :disabled="!mayEdit || task.sop !== 3" :title="mayEdit ? (task.sop === 3 ? undefined : '请先完成前三步：巡检、标定、复位') : NO_PERM" @click="act('start')"><AppIcon name="play" size="sm" />开始采集</a-button></template>
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
  />

  <!-- 标记对话框 -->
  <a-modal v-model:open="flagDlg.open" title="标记当前采集数据" centered ok-text="确认标记" cancel-text="取消" @ok="doFlag">
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
  <a-modal v-model:open="noteDlg.open" title="修改采集备注" centered ok-text="保存备注" cancel-text="取消" @ok="doNote">
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

.drawer-main-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 抽屉头部驾驶舱控制按钮 */
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
  transition: all 0.15s ease;
}
.cockpit-trigger-btn:hover {
  background: var(--surface-3);
  border-color: var(--accent);
}
.cockpit-trigger-btn.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.dot-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 6px #38bdf8;
  animation: dotBlink 1.4s infinite;
}
@keyframes dotBlink {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.3; transform: scale(0.8); }
}
</style>
