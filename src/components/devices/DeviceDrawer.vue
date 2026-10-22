<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import FaultDialog from './FaultDialog.vue'
import { NO_PERM } from '@/constants'
import { CALIB_ITEMS, CODEC_OPTS, DV_ST, RES_OPTS, STATIONS, cfgDef, cfgText, useDevices, type DevCfg } from '@/stores/devices'
import { useLogs } from '@/stores/logs'
import { useTasks } from '@/stores/tasks'
import { confirmDlg } from '@/composables/confirm'
import { useAlerts } from '@/stores/alerts'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'

const props = defineProps<{ id: string | null }>()
const emit = defineEmits<{ close: [] }>()
const store = useDevices()
const alerts = useAlerts()
const session = useSession()
const d = computed(() => (props.id ? store.byId(props.id) : undefined))
const faults = computed(() => store.faults.filter((f) => f.dev === props.id))
const mayEdit = computed(() => session.can('devices'))
const dis = computed(() => (mayEdit.value ? undefined : NO_PERM))
const faultOpen = ref(false)
const tasks = useTasks()
const occ = computed(() => (d.value ? tasks.occupant(d.value.id) : undefined))
function setStation(v: string) {
  const x = d.value
  if (!x || x.station === v) return
  x.station = v
  if (x.calib) { x.calib = null; toast(x.name + ' 已调整到「' + v + '」，位置变化后需要重新标定', { type: 'warn' }) }
  else toast(x.name + ' 已调整到「' + v + '」')
}
const logs = useLogs()
/** 修改采集参数：只影响之后开始的采集；采集中的设备不允许修改 */
function setCfg(k: keyof DevCfg, v: unknown) {
  const x = d.value
  if (!x || x.cfg[k] === v) return
  const before = cfgText(x.type, x.cfg)
  x.cfg = { ...x.cfg, [k]: v }
  logs.addLog({ user: session.info.user, role: session.info.name, module: 'system', moduleName: '设备管理', action: '修改采集参数', target: x.id + ' ' + x.name, summary: before + ' → ' + cfgText(x.type, x.cfg) })
  toast(x.name + ' 采集参数已更新为 ' + cfgText(x.type, x.cfg) + '，之后的采集生效')
}
async function calibrate() {
  const x = d.value
  if (!x) return
  const items = CALIB_ITEMS[x.type] ?? CALIB_ITEMS['其他']
  const ok = await confirmDlg({ title: (x.calib ? '重新标定 ' : '标定 ') + x.name + '？', msg: '标定内容：' + items.join('、') + '。标定是一次性工作，完成后长期有效，仅在设备移位、维修或更换安装位置后需要重新标定。', ok: '完成标定' })
  if (!ok) return
  store.calibrate(x, session.info.user)
  toast(x.name + ' 标定完成')
}
function act(a: string) {
  const x = d.value
  if (!x) return
  if (a === 'maint') { x.st = 'maint'; toast(x.name + ' 已转入维护，维修完成后建议重新标定') }
  else if (a === 'up') {
    x.st = 'online'; toast(x.name + ' 已恢复上线')
    const al = alerts.list.find((y) => y.route === 'devices' && !y.ack)
    if (al && x.id === 'DV-003') alerts.ack(al.id)
  }
}
</script>
<template>
  <a-drawer :open="!!d" :width="640" :closable="false" :body-style="{ padding: '20px 24px 28px' }" :header-style="{ padding: '18px 24px 14px' }" destroy-on-close @close="emit('close')">
    <template #title>
      <div v-if="d" style="display:flex;flex-direction:column;gap:12px;width:100%">
        <div class="row between"><div class="row"><span class="mono">{{ d.id }}</span><StatusBadge :kind="DV_ST[d.st][0]" :text="DV_ST[d.st][1]" /></div><button type="button" class="icon-btn" aria-label="关闭" @click="emit('close')"><AppIcon name="x" /></button></div>
        <h2 style="font-size:20px;font-weight:600">{{ d.name }}</h2>
      </div>
    </template>
    <div v-if="d" style="display:flex;flex-direction:column;gap:20px">
      <dl class="kv"><dt>类型</dt><dd>{{ d.type }}</dd><dt>位置</dt><dd>{{ d.loc }}</dd><dt>所属工位</dt><dd><a-select :value="d.station" size="small" style="width:190px" :options="STATIONS.map((x) => ({ value: x }))" :disabled="!session.isAdmin" aria-label="所属工位" @change="(v: string) => setStation(v)" /></dd><dt>固件</dt><dd class="mono">{{ d.fw }}</dd><dt>当前占用</dt><dd>{{ occ ? '采集任务 ' + occ : '空闲' }}</dd><dt>适用场景</dt><dd class="muted">不限场景，按设备类型匹配采集模式</dd></dl>
      <div><h3 style="font-size:15px;font-weight:600;margin-bottom:4px">采集参数</h3>
        <div class="muted" style="font-size:12.5px;margin-bottom:10px">设备级固定配置，所有使用该设备的采集任务沿用；正常无需调整，修改后从下一次采集开始生效</div>
        <div class="cfg">
          <label>{{ cfgDef(d.type).label }}<a-select :value="d.cfg.rate" size="small" :disabled="!session.isAdmin || !!occ" :options="cfgDef(d.type).rates.map((v) => ({ value: v, label: v + ' ' + cfgDef(d!.type).unit }))" @change="(v: unknown) => setCfg('rate', v)" /></label>
          <template v-if="cfgDef(d.type).video">
            <label>分辨率<a-select :value="d.cfg.res" size="small" :disabled="!session.isAdmin || !!occ" :options="RES_OPTS.map((v) => ({ value: v }))" @change="(v: unknown) => setCfg('res', v)" /></label>
            <label>视频编码<a-select :value="d.cfg.codec" size="small" :disabled="!session.isAdmin || !!occ" :options="CODEC_OPTS.map((v) => ({ value: v }))" @change="(v: unknown) => setCfg('codec', v)" /></label>
          </template>
        </div>
        <div v-if="occ" class="muted" style="font-size:12px;margin-top:6px">设备正在采集任务 {{ occ }} 中使用，结束后才能修改</div>
      </div>
      <div><h3 style="font-size:15px;font-weight:600;margin-bottom:10px">标定</h3>
        <div v-if="d.calib" class="callout info" style="flex-direction:column;align-items:flex-start;gap:4px"><span><b>已标定</b> · {{ d.calib.at }} · {{ d.calib.by }}</span><span class="muted" style="font-size:12.5px">{{ d.calib.items.join('、') }}；长期有效，设备移位或维修后再重新标定</span></div>
        <div v-else class="callout warn"><AppIcon name="alert" /><span>尚未标定，采集前自检会被拦截。标定内容：{{ (CALIB_ITEMS[d.type] ?? CALIB_ITEMS['其他']).join('、') }}</span></div>
      </div>
      <div><h3 style="font-size:15px;font-weight:600;margin-bottom:10px">维护记录</h3>
        <div class="list-i"><div v-for="x in [[d.calib?.at ?? '—', d.calib ? '完成一次性标定' : '待标定', d.calib?.by ?? '—'], ['10-02', '更换线缆', '赵工'], ['09-25', '固件升级', '赵工']]" :key="x[0]" class="li"><span class="mono muted" style="width:52px">{{ x[0] }}</span><span class="grow">{{ x[1] }}</span><span class="muted">{{ x[2] }}</span></div></div>
      </div>
      <div><h3 style="font-size:15px;font-weight:600;margin-bottom:10px">故障记录</h3>
        <div v-if="faults.length" class="list-i"><div v-for="(f, i) in faults" :key="i" class="li" style="align-items:flex-start"><span class="alert-ico crit"><AppIcon name="alert" size="sm" /></span><span class="grow"><span class="tt" style="display:block;white-space:normal">{{ f.d }}</span><span class="ss">{{ f.t }} · {{ f.lv }} · {{ f.by }}</span></span></div></div>
        <div v-else class="muted">暂无故障记录</div>
      </div>
    </div>
    <template #footer>
      <div v-if="d" style="display:flex;gap:10px;justify-content:flex-end">
        <a-button :disabled="!mayEdit" :title="dis" @click="faultOpen = true">登记故障</a-button>
        <template v-if="d.st === 'online'"><a-button :disabled="!mayEdit" :title="dis" @click="act('maint')">转入维护</a-button><a-button type="primary" :disabled="!mayEdit || !!occ" :title="occ ? '设备正在采集中，结束后再标定' : dis" @click="calibrate">{{ d.calib ? '重新标定' : '执行标定' }}</a-button></template>
        <a-button v-else type="primary" :disabled="!mayEdit" :title="dis" @click="act('up')">恢复上线</a-button>
      </div>
    </template>
  </a-drawer>
  <FaultDialog :open="faultOpen" :dev-id="props.id" @close="faultOpen = false" @done="() => {}" />
</template>
<style scoped>
.cfg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.cfg label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--muted); }
</style>
