<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import FaultDialog from './FaultDialog.vue'
import { NO_PERM, SCEN, type ScenKey } from '@/constants'
import { DV_ST, useDevices } from '@/stores/devices'
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
const scenOpts = [{ value: 'qmd', label: SCEN.qmd.name }, { value: 'fhd', label: SCEN.fhd.name }, { value: '', label: '未分配' }]
function setScen(v: string) {
  const x = d.value
  if (!x) return
  x.scen = (v || null) as ScenKey | null
  toast(x.name + (x.scen ? ' 已分配至「' + SCEN[x.scen].name + '」' : ' 已取消场景分配'))
}

function act(a: string) {
  const x = d.value
  if (!x) return
  if (a === 'maint') { x.st = 'maint'; toast(x.name + ' 已转入维护') }
  else if (a === 'cal') { x.cal = '10-13'; x.next = '10-20'; toast('已记录校准，下次校准 10-20') }
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
      <dl class="kv"><dt>类型</dt><dd>{{ d.type }}</dd><dt>位置</dt><dd>{{ d.loc }}</dd><dt>所属场景</dt><dd><a-select :value="d.scen ?? ''" size="small" style="width:190px" :options="scenOpts" :disabled="!session.isAdmin" :title="session.isAdmin ? undefined : '仅系统管理员可分配场景'" aria-label="所属场景" @change="(v: string) => setScen(v)" /></dd><dt>固件</dt><dd class="mono">{{ d.fw }}</dd><dt>下次校准</dt><dd>{{ d.next }}</dd></dl>
      <div><h3 style="font-size:15px;font-weight:600;margin-bottom:10px">校准与维护记录</h3>
        <div class="list-i"><div v-for="x in [[d.cal, '完成例行校准', '赵工'], ['10-02', '更换线缆并重新标定', '赵工'], ['09-25', '固件升级', '赵工']]" :key="x[0]" class="li"><span class="mono muted" style="width:52px">{{ x[0] }}</span><span class="grow">{{ x[1] }}</span><span class="muted">{{ x[2] }}</span></div></div>
      </div>
      <div><h3 style="font-size:15px;font-weight:600;margin-bottom:10px">故障记录</h3>
        <div v-if="faults.length" class="list-i"><div v-for="(f, i) in faults" :key="i" class="li" style="align-items:flex-start"><span class="alert-ico crit"><AppIcon name="alert" size="sm" /></span><span class="grow"><span class="tt" style="display:block;white-space:normal">{{ f.d }}</span><span class="ss">{{ f.t }} · {{ f.lv }} · {{ f.by }}</span></span></div></div>
        <div v-else class="muted">暂无故障记录</div>
      </div>
    </div>
    <template #footer>
      <div v-if="d" style="display:flex;gap:10px;justify-content:flex-end">
        <a-button :disabled="!mayEdit" :title="dis" @click="faultOpen = true">登记故障</a-button>
        <template v-if="d.st === 'online'"><a-button :disabled="!mayEdit" :title="dis" @click="act('maint')">转入维护</a-button><a-button type="primary" :disabled="!mayEdit" :title="dis" @click="act('cal')">标记已校准</a-button></template>
        <a-button v-else type="primary" :disabled="!mayEdit" :title="dis" @click="act('up')">恢复上线</a-button>
      </div>
    </template>
  </a-drawer>
  <FaultDialog :open="faultOpen" :dev-id="props.id" @close="faultOpen = false" @done="() => {}" />
</template>
