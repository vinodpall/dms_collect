<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useDevices, type DevCfg } from '@/stores/devices'
import { toast } from '@/composables/toast'

const props = defineProps<{ id: string | null }>()
const emit = defineEmits<{ close: []; done: [] }>()

const store = useDevices()
const loading = ref(false)
const saving = ref(false)

const d = computed(() => (props.id ? store.byId(props.id) : undefined))
const meta = computed(() => (d.value ? store.typeMeta(d.value.typeCode || d.value.type) : null))
const stationOpts = computed(() => store.stations.map((s) => ({ value: s.id, label: s.name })))
const occupied = computed(() => !!d.value?.occupiedTaskCode)

const f = reactive({
  name: '',
  stationId: undefined as number | undefined,
  loc: '',
  model: '',
  vendor: '',
  serialNo: '',
  fw: '',
  fwType: '',
  fwModel: '',
  connIp: '',
  connPort: null as number | null,
  connUsername: '',
  connPassword: '',
  clearConnPassword: false,
  hasConnPassword: false,
  cfg: { rate: 30 } as DevCfg,
  origCfg: { rate: 30 } as DevCfg,
  e: { name: '', station: '' },
})

function fillFromDevice() {
  const x = d.value
  if (!x) return
  f.name = x.name
  f.stationId = x.stationId
  f.loc = x.loc
  f.model = x.model
  f.vendor = x.vendor
  f.serialNo = x.serialNo
  f.fw = x.fw
  f.fwType = x.fwType
  f.fwModel = x.fwModel
  f.connIp = x.connIp
  f.connPort = x.connPort
  f.connUsername = x.connUsername
  f.connPassword = ''
  f.clearConnPassword = false
  f.hasConnPassword = !!x.connPassword
  f.cfg = { ...x.cfg }
  f.origCfg = { ...x.cfg }
  f.e = { name: '', station: '' }
}

watch(
  () => props.id,
  async (val) => {
    if (!val || !d.value) return
    fillFromDevice()
    loading.value = true
    try {
      await store.fetchDeviceDetail(d.value.numericId)
      fillFromDevice()
    } catch {
      /* 使用列表已有数据兜底 */
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

function cfgChanged(): boolean {
  return (
    f.cfg.rate !== f.origCfg.rate ||
    (f.cfg.res || '') !== (f.origCfg.res || '') ||
    (f.cfg.codec || '') !== (f.origCfg.codec || '')
  )
}

async function submit() {
  const x = d.value
  if (!x) return
  const n = f.name.trim()
  f.e.name = !n ? '请输入设备名称' : ''
  f.e.station = f.stationId ? '' : '请选择所属工位'
  if (f.e.name || f.e.station) return

  saving.value = true
  try {
    const hadCalib = !!x.calib
    const stationChanged = f.stationId !== x.stationId
    const updated = await store.updateDevice(x, {
      name: n,
      station_id: occupied.value ? undefined : f.stationId,
      location: f.loc.trim() || null,
      model: f.model.trim() || null,
      vendor: f.vendor.trim() || null,
      serial_no: f.serialNo.trim() || null,
      firmware: f.fw.trim() || null,
      fw_type: f.fwType.trim() || null,
      fw_model: f.fwModel.trim() || null,
      conn_ip: f.connIp.trim() || null,
      conn_port: f.connPort ?? null,
      conn_username: f.connUsername.trim() || null,
      conn_password: f.clearConnPassword ? '' : f.connPassword ? f.connPassword : undefined,
    })

    if (!occupied.value && cfgChanged()) {
      await store.updateConfig(updated, f.cfg)
    }

    emit('close')
    emit('done')
    if (stationChanged && hadCalib && !updated.calib) {
      toast(`${updated.name} 已更新，工位变化后需要重新标定`, { type: 'warn' })
    } else {
      toast('设备信息已更新')
    }
  } catch (err: any) {
    toast('更新设备失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <a-modal
    :open="!!props.id && !!d"
    :title="d ? `编辑设备 · ${d.id}` : '编辑设备'"
    width="680px"
    centered
    ok-text="保存"
    cancel-text="取消"
    :confirm-loading="saving"
    destroy-on-close
    @ok="submit"
    @cancel="emit('close')"
  >
    <a-spin :spinning="loading">
      <a-form v-if="d" layout="vertical">
        <div class="label-row first">基本信息</div>
        <div class="two">
          <a-form-item label="设备名称" required :validate-status="f.e.name ? 'error' : ''" :help="f.e.name">
            <a-input v-model:value="f.name" :maxlength="64" />
          </a-form-item>
          <a-form-item label="设备类型" extra="设备类型创建后不可修改">
            <a-input :value="d.type" disabled />
          </a-form-item>
        </div>
        <div class="two">
          <a-form-item
            label="所属工位"
            required
            :validate-status="f.e.station ? 'error' : ''"
            :help="f.e.station || (occupied ? `设备正在采集任务 ${d.occupiedTaskCode} 中占用，暂不可切换工位` : undefined)"
          >
            <a-select v-model:value="f.stationId" :disabled="occupied" :options="stationOpts" />
          </a-form-item>
          <a-form-item label="安装位置"><a-input v-model:value="f.loc" :maxlength="64" /></a-form-item>
        </div>
        <div class="three">
          <a-form-item label="设备型号"><a-input v-model:value="f.model" :maxlength="64" /></a-form-item>
          <a-form-item label="生产厂商"><a-input v-model:value="f.vendor" :maxlength="64" /></a-form-item>
          <a-form-item label="序列号 (SN)"><a-input v-model:value="f.serialNo" class="mono" :maxlength="64" /></a-form-item>
        </div>

        <div class="label-row">固件与网络连接</div>
        <div class="three">
          <a-form-item label="固件版本"><a-input v-model:value="f.fw" class="mono" :maxlength="32" /></a-form-item>
          <a-form-item label="固件类型"><a-input v-model:value="f.fwType" class="mono" :maxlength="32" /></a-form-item>
          <a-form-item label="固件型号"><a-input v-model:value="f.fwModel" class="mono" :maxlength="32" /></a-form-item>
        </div>
        <div class="two">
          <a-form-item label="连接 IP"><a-input v-model:value="f.connIp" class="mono" placeholder="如：192.168.10.21" :maxlength="64" /></a-form-item>
          <a-form-item label="通信端口"><a-input-number v-model:value="f.connPort" :min="0" :max="65535" style="width:100%" /></a-form-item>
        </div>
        <div class="two">
          <a-form-item label="连接账号"><a-input v-model:value="f.connUsername" class="mono" :maxlength="64" autocomplete="off" /></a-form-item>
          <a-form-item
            label="连接密码"
            :extra="f.hasConnPassword ? '已配置密码；留空保持不变，勾选清除将移除密码' : '可选'"
          >
            <div style="display:flex;flex-direction:column;gap:6px">
              <a-input-password
                v-model:value="f.connPassword"
                class="mono"
                :disabled="f.clearConnPassword"
                :placeholder="f.hasConnPassword ? '留空保持原密码不变' : '请输入连接密码'"
                :maxlength="128"
                autocomplete="new-password"
              />
              <a-checkbox v-if="f.hasConnPassword" v-model:checked="f.clearConnPassword">清除已保存的连接密码</a-checkbox>
            </div>
          </a-form-item>
        </div>

        <template v-if="meta">
          <div class="label-row">
            采集参数
            <span class="muted">{{ occupied ? `采集任务 ${d.occupiedTaskCode} 进行中，结束后才能修改` : '修改后从下一次采集开始生效' }}</span>
          </div>
          <div class="three">
            <a-form-item :label="meta.label" class="mb-0">
              <a-select v-model:value="f.cfg.rate" :disabled="occupied" :options="meta.rates.map((v) => ({ value: v, label: v + ' ' + meta!.unit }))" />
            </a-form-item>
            <template v-if="meta.video">
              <a-form-item label="分辨率" class="mb-0">
                <a-select v-model:value="f.cfg.res" :disabled="occupied" :options="meta.resolutions.map((v) => ({ value: v }))" />
              </a-form-item>
              <a-form-item label="视频编码" class="mb-0">
                <a-select v-model:value="f.cfg.codec" :disabled="occupied" :options="meta.codecs.map((v) => ({ value: v }))" />
              </a-form-item>
            </template>
          </div>
        </template>
      </a-form>
    </a-spin>
  </a-modal>
</template>

<style scoped>
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }
.label-row { font-weight: 600; margin: 12px 0 8px; font-size: 13.5px; color: var(--text); }
.label-row.first { margin-top: 2px; }
.label-row .muted { font-weight: 400; font-size: 12px; margin-left: 6px; }
:deep(.mb-0.ant-form-item) { margin-bottom: 0 !important; }
</style>
