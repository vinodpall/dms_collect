<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import FaultDialog from './FaultDialog.vue'
import { NO_PERM } from '@/constants'
import { DV_ST, useDevices, type DevCfg } from '@/stores/devices'
import { confirmDlg } from '@/composables/confirm'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'

const props = defineProps<{ id: string | null }>()
const emit = defineEmits<{ close: [] }>()
const store = useDevices()
const session = useSession()
const d = computed(() => (props.id ? store.byId(props.id) : undefined))
const mayEdit = computed(() => session.can('devices'))
const dis = computed(() => (mayEdit.value ? undefined : NO_PERM))
const faultOpen = ref(false)
const busy = ref(false)
const loadingEvents = ref(false)

const occ = computed(() => d.value?.occupiedTaskCode || '')
const typeInfo = computed(() => (d.value ? store.typeMeta(d.value.typeCode || d.value.type) : null))
const stationOpts = computed(() => store.stations.map((s) => ({ value: s.id, label: s.name })))

const allEvents = computed(() => (d.value ? store.eventsByDevice[d.value.numericId] || [] : []))
const maintEvents = computed(() => allEvents.value.filter((e) => e.event_type !== 'fault'))
const faultEvents = computed(() => allEvents.value.filter((e) => e.event_type === 'fault'))

async function refreshDetailAndEvents() {
  if (!d.value) return
  loadingEvents.value = true
  try {
    await Promise.allSettled([
      store.fetchDeviceDetail(d.value.numericId),
      store.fetchDeviceEvents(d.value.numericId),
    ])
  } finally {
    loadingEvents.value = false
  }
}

watch(
  () => props.id,
  async (val) => {
    if (val && d.value) {
      await refreshDetailAndEvents()
    }
  },
  { immediate: true }
)

function fmtTime(raw: string) {
  return raw ? raw.replace('T', ' ').slice(0, 16) : '—'
}

async function setStation(stationId: number) {
  const x = d.value
  if (!x || x.stationId === stationId) return
  busy.value = true
  try {
    const hadCalib = !!x.calib
    const updated = await store.updateDevice(x, { station_id: stationId })
    if (hadCalib && !updated.calib) {
      toast(updated.name + ' 已调整到「' + updated.station + '」，位置变化后需要重新标定', { type: 'warn' })
    } else {
      toast(updated.name + ' 已调整到「' + updated.station + '」')
    }
  } catch (err: any) {
    toast('调整工位失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    busy.value = false
  }
}

/** 编辑设备基本信息与连接参数（对接 PUT /devices/{id}） */
const editModal = reactive({
  open: false,
  saving: false,
  name: '',
  location: '',
  model: '',
  vendor: '',
  serial_no: '',
  firmware: '',
  conn_ip: '',
  conn_port: null as number | null,
})

function openEdit() {
  const x = d.value
  if (!x) return
  Object.assign(editModal, {
    open: true,
    saving: false,
    name: x.name,
    location: x.loc,
    model: x.model,
    vendor: x.vendor,
    serial_no: x.serialNo,
    firmware: x.fw,
    conn_ip: x.connIp,
    conn_port: x.connPort,
  })
}

async function saveEdit() {
  const x = d.value
  if (!x) return
  if (!editModal.name.trim()) return toast('请输入设备名称', { type: 'warn' })
  editModal.saving = true
  try {
    await store.updateDevice(x, {
      name: editModal.name.trim(),
      location: editModal.location.trim() || null,
      model: editModal.model.trim() || null,
      vendor: editModal.vendor.trim() || null,
      serial_no: editModal.serial_no.trim() || null,
      firmware: editModal.firmware.trim() || null,
      conn_ip: editModal.conn_ip.trim() || null,
      conn_port: editModal.conn_port ?? null,
    })
    editModal.open = false
    toast('设备信息已更新')
  } catch (err: any) {
    toast('更新失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    editModal.saving = false
  }
}

/** 修改采集参数：只影响之后开始的采集；采集中的设备不允许修改 */
async function setCfg(k: keyof DevCfg, v: unknown) {
  const x = d.value
  if (!x || x.cfg[k] === v) return
  busy.value = true
  try {
    const nextCfg: DevCfg = { ...x.cfg, [k]: v }
    await store.updateConfig(x, nextCfg)
    await store.fetchDeviceEvents(x.numericId).catch(() => {})
    toast(x.name + ' 采集参数已更新，之后的采集生效')
  } catch (err: any) {
    toast('更新采集参数失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    busy.value = false
  }
}

async function calibrate() {
  const x = d.value
  const info = typeInfo.value
  if (!x || !info) return
  const items = info.calibItems
  const ok = await confirmDlg({
    title: (x.calib ? '重新标定 ' : '标定 ') + x.name + '？',
    msg: '标定内容：' + items.join('、') + '。标定完成后将在设备上持久化保存，仅在移位或维修后需重新标定。',
    ok: '完成标定',
  })
  if (!ok) return
  busy.value = true
  try {
    await store.calibrate(x)
    await store.fetchDeviceEvents(x.numericId).catch(() => {})
    toast(x.name + ' 标定完成')
  } catch (err: any) {
    toast('标定失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    busy.value = false
  }
}

async function act(a: 'maint' | 'up') {
  const x = d.value
  if (!x) return
  busy.value = true
  try {
    if (a === 'maint') {
      await store.setStatus(x, 'maint')
      toast(x.name + ' 已转入维护，维修完成后建议重新标定')
    } else {
      await store.setStatus(x, 'online')
      toast(x.name + ' 已恢复上线')
    }
  } catch (err: any) {
    toast('状态流转失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <a-drawer :open="!!d" :width="640" :closable="false" :body-style="{ padding: '20px 24px 28px' }" :header-style="{ padding: '18px 24px 14px' }" destroy-on-close @close="emit('close')">
    <template #title>
      <div v-if="d" style="display:flex;flex-direction:column;gap:12px;width:100%">
        <div class="row between">
          <div class="row"><span class="mono">{{ d.id }}</span><StatusBadge :kind="DV_ST[d.st][0]" :text="DV_ST[d.st][1]" /></div>
          <div class="row" style="gap:6px">
            <a-button size="small" :disabled="!mayEdit" :title="dis" @click="openEdit"><AppIcon name="pencil" size="sm" />编辑信息</a-button>
            <button type="button" class="icon-btn" aria-label="关闭" @click="emit('close')"><AppIcon name="x" /></button>
          </div>
        </div>
        <h2 style="font-size:20px;font-weight:600;margin:0">{{ d.name }}</h2>
      </div>
    </template>
    <div v-if="d && typeInfo" style="display:flex;flex-direction:column;gap:20px">
      <dl class="kv">
        <dt>类型</dt><dd>{{ d.type }}</dd>
        <dt>位置</dt><dd>{{ d.loc || '—' }}</dd>
        <dt>所属工位</dt>
        <dd>
          <a-select
            :value="d.stationId"
            size="small"
            style="width:190px"
            :options="stationOpts"
            :disabled="!mayEdit || busy || !!occ"
            aria-label="所属工位"
            @change="(v: number) => setStation(v)"
          />
        </dd>
        <dt>品牌型号</dt><dd>{{ [d.vendor, d.model].filter(Boolean).join(' · ') || '—' }}</dd>
        <dt>序列号</dt><dd class="mono">{{ d.serialNo || '—' }}</dd>
        <dt>固件</dt><dd class="mono">{{ d.fw || '—' }}</dd>
        <dt>网络地址</dt><dd class="mono">{{ d.connIp ? (d.connPort ? `${d.connIp}:${d.connPort}` : d.connIp) : '—' }}</dd>
        <dt>当前占用</dt><dd>{{ occ ? '采集任务 ' + occ : '空闲' }}</dd>
      </dl>

      <div>
        <h3 style="font-size:15px;font-weight:600;margin-bottom:4px">采集参数</h3>
        <div class="muted" style="font-size:12.5px;margin-bottom:10px">设备级固定配置，所有使用该设备的采集任务沿用；修改后从下一次采集开始生效</div>
        <div class="cfg">
          <label>
            {{ typeInfo.label }}
            <a-select
              :value="d.cfg.rate"
              size="small"
              :disabled="!mayEdit || busy || !!occ"
              :options="typeInfo.rates.map((v) => ({ value: v, label: v + ' ' + typeInfo!.unit }))"
              @change="(v: unknown) => setCfg('rate', v)"
            />
          </label>
          <template v-if="typeInfo.video">
            <label>
              分辨率
              <a-select :value="d.cfg.res" size="small" :disabled="!mayEdit || busy || !!occ" :options="typeInfo.resolutions.map((v) => ({ value: v }))" @change="(v: unknown) => setCfg('res', v)" />
            </label>
            <label>
              视频编码
              <a-select :value="d.cfg.codec" size="small" :disabled="!mayEdit || busy || !!occ" :options="typeInfo.codecs.map((v) => ({ value: v }))" @change="(v: unknown) => setCfg('codec', v)" />
            </label>
          </template>
        </div>
        <div v-if="occ" class="muted" style="font-size:12px;margin-top:6px">设备正在采集任务 {{ occ }} 中使用，结束后才能修改</div>
      </div>

      <div>
        <h3 style="font-size:15px;font-weight:600;margin-bottom:10px">标定状态</h3>
        <div v-if="d.calib" class="callout info" style="flex-direction:column;align-items:flex-start;gap:4px">
          <span><b>已标定</b><template v-if="d.calib.at"> · {{ d.calib.at }}</template><template v-if="d.calib.by && d.calib.by !== '—'"> · {{ d.calib.by }}</template></span>
          <span class="muted" style="font-size:12.5px">{{ d.calib.items.join('、') }}</span>
        </div>
        <div v-else class="callout warn"><AppIcon name="alert" /><span>尚未标定，采集前自检会被拦截。标定内容：{{ typeInfo.calibItems.join('、') }}</span></div>
      </div>

      <div>
        <h3 style="font-size:15px;font-weight:600;margin-bottom:10px">维护与标定记录</h3>
        <div v-if="loadingEvents" class="muted" style="font-size:12.5px">加载设备事件记录中…</div>
        <div v-else-if="maintEvents.length" class="list-i">
          <div v-for="e in maintEvents" :key="e.id" class="li" style="align-items:flex-start">
            <span class="mono muted" style="width:110px;flex:none;font-size:12px">{{ fmtTime(e.created_at) }}</span>
            <span class="grow">
              <span class="tt" style="display:block">{{ e.title }}</span>
              <span v-if="e.description" class="ss">{{ e.description }}</span>
            </span>
            <span class="muted">{{ e.operator_name || '—' }}</span>
          </div>
        </div>
        <div v-else class="muted" style="font-size:12.5px">暂无维护与标定记录</div>
      </div>

      <div>
        <h3 style="font-size:15px;font-weight:600;margin-bottom:10px">故障记录</h3>
        <div v-if="loadingEvents" class="muted" style="font-size:12.5px">加载故障记录中…</div>
        <div v-else-if="faultEvents.length" class="list-i">
          <div v-for="f in faultEvents" :key="f.id" class="li" style="align-items:flex-start">
            <span class="alert-ico crit"><AppIcon name="alert" size="sm" /></span>
            <span class="grow">
              <span class="tt" style="display:block;white-space:normal">{{ f.description || f.title }}</span>
              <span class="ss">{{ fmtTime(f.created_at) }} · {{ f.event_level === 'severe' ? '严重' : '一般' }} · {{ f.operator_name || '—' }}</span>
            </span>
          </div>
        </div>
        <div v-else class="muted" style="font-size:12.5px">暂无故障记录</div>
      </div>
    </div>

    <template #footer>
      <div v-if="d" style="display:flex;gap:10px;justify-content:flex-end">
        <a-button :disabled="!mayEdit || busy" :title="dis" @click="faultOpen = true">登记故障</a-button>
        <template v-if="d.st === 'online'">
          <a-button :disabled="!mayEdit || busy" :title="dis" @click="act('maint')">转入维护</a-button>
          <a-button type="primary" :loading="busy" :disabled="!mayEdit || !!occ" :title="occ ? '设备正在采集中，结束后再标定' : dis" @click="calibrate">{{ d.calib ? '重新标定' : '执行标定' }}</a-button>
        </template>
        <a-button v-else type="primary" :loading="busy" :disabled="!mayEdit" :title="dis" @click="act('up')">恢复上线</a-button>
      </div>
    </template>
  </a-drawer>

  <a-modal v-model:open="editModal.open" title="编辑设备信息" ok-text="保存" cancel-text="取消" :confirm-loading="editModal.saving" width="580px" centered @ok="saveEdit">
    <a-form layout="vertical" style="margin-top:8px">
      <div class="form-row-2">
        <a-form-item label="设备名称" required><a-input v-model:value="editModal.name" :maxlength="40" /></a-form-item>
        <a-form-item label="安装位置"><a-input v-model:value="editModal.location" :maxlength="40" /></a-form-item>
      </div>
      <div class="form-row-2">
        <a-form-item label="设备型号"><a-input v-model:value="editModal.model" :maxlength="40" /></a-form-item>
        <a-form-item label="生产厂商"><a-input v-model:value="editModal.vendor" :maxlength="40" /></a-form-item>
      </div>
      <div class="form-row-2">
        <a-form-item label="序列号 (SN)"><a-input v-model:value="editModal.serial_no" class="mono" :maxlength="50" /></a-form-item>
        <a-form-item label="固件版本"><a-input v-model:value="editModal.firmware" class="mono" :maxlength="30" /></a-form-item>
      </div>
      <div class="form-row-2">
        <a-form-item label="连接 IP" style="margin-bottom:0"><a-input v-model:value="editModal.conn_ip" class="mono" placeholder="如 192.168.10.21" /></a-form-item>
        <a-form-item label="通信端口" style="margin-bottom:0"><a-input-number v-model:value="editModal.conn_port" :min="1" :max="65535" style="width:100%" /></a-form-item>
      </div>
    </a-form>
  </a-modal>

  <FaultDialog :open="faultOpen" :dev-id="props.id" @close="faultOpen = false" @done="refreshDetailAndEvents" />
</template>

<style scoped>
.cfg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.cfg label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--muted); }
</style>
