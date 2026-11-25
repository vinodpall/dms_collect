<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { DEV_TYPES, TYPE_LABEL_TO_CODE, useDevices, type DevCfg } from '@/stores/devices'
import { toast } from '@/composables/toast'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; done: [id: string] }>()
const store = useDevices()
const saving = ref(false)

const typeOpts = computed(() =>
  store.types.length
    ? store.types.map((t) => ({ value: t.type, label: t.label }))
    : DEV_TYPES.map((label) => ({ value: TYPE_LABEL_TO_CODE[label] || 'other', label }))
)

const stationOpts = computed(() => store.stations.map((s) => ({ value: s.id, label: s.name })))

const f = reactive({
  cfg: { rate: 30 } as DevCfg,
  name: '',
  typeCode: undefined as string | undefined,
  stationId: undefined as number | undefined,
  loc: '',
  model: '',
  vendor: '',
  serialNo: '',
  fw: '',
  connIp: '',
  connPort: null as number | null,
  e: { name: '', type: '', station: '' },
})

const meta = computed(() => (f.typeCode ? store.typeMeta(f.typeCode) : null))

watch(
  () => f.typeCode,
  (code) => {
    if (code) f.cfg = { ...store.typeMeta(code).def }
  }
)
watch(
  () => props.open,
  (v) => {
    if (v) {
      Object.assign(f, {
        name: '',
        typeCode: undefined,
        stationId: store.stations[0]?.id,
        loc: '',
        model: '',
        vendor: '',
        serialNo: '',
        fw: '',
        connIp: '',
        connPort: null,
        e: { name: '', type: '', station: '' },
      })
    }
  }
)

async function submit() {
  const n = f.name.trim()
  f.e.name = !n ? '请输入设备名称' : store.list.some((d) => d.name === n) ? '设备名称已存在' : ''
  f.e.type = f.typeCode ? '' : '请选择设备类型'
  f.e.station = f.stationId ? '' : '请选择所属工位'
  if (f.e.name || f.e.type || f.e.station) return

  saving.value = true
  try {
    const d = await store.add({
      name: n,
      typeCode: f.typeCode!,
      stationId: f.stationId!,
      loc: f.loc.trim() || undefined,
      model: f.model.trim() || undefined,
      vendor: f.vendor.trim() || undefined,
      serialNo: f.serialNo.trim() || undefined,
      fw: f.fw.trim() || undefined,
      connIp: f.connIp.trim() || undefined,
      connPort: f.connPort,
      cfg: f.cfg,
    })
    emit('close')
    toast('已新增设备 ' + d.id + '，上线后请完成一次性标定')
    emit('done', d.id)
  } catch (err: any) {
    toast('新增设备失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <a-modal :open="open" title="新增设备" width="620px" centered ok-text="新增" cancel-text="取消" :confirm-loading="saving" destroy-on-close @ok="submit" @cancel="emit('close')">
    <a-form layout="vertical">
      <a-form-item label="设备名称" required :validate-status="f.e.name ? 'error' : ''" :help="f.e.name"><a-input v-model:value="f.name" placeholder="如：PICO VR 一体机 #5" :maxlength="40" /></a-form-item>
      <div class="two">
        <a-form-item label="设备类型" required :validate-status="f.e.type ? 'error' : ''" :help="f.e.type"><a-select v-model:value="f.typeCode" placeholder="请选择" :options="typeOpts" /></a-form-item>
        <a-form-item label="所属工位" required :validate-status="f.e.station ? 'error' : ''" :help="f.e.station" extra="设备按类型匹配任意场景"><a-select v-model:value="f.stationId" placeholder="请选择工位" :options="stationOpts" /></a-form-item>
      </div>
      <div class="two">
        <a-form-item label="安装位置"><a-input v-model:value="f.loc" placeholder="如：工位上方 / 机械臂末端" :maxlength="30" /></a-form-item>
        <a-form-item label="序列号 (SN)"><a-input v-model:value="f.serialNo" class="mono" placeholder="可选" :maxlength="50" /></a-form-item>
      </div>
      <div class="two">
        <a-form-item label="设备型号"><a-input v-model:value="f.model" placeholder="可选" :maxlength="40" /></a-form-item>
        <a-form-item label="生产厂商"><a-input v-model:value="f.vendor" placeholder="可选" :maxlength="40" /></a-form-item>
      </div>
      <div class="three">
        <a-form-item label="固件版本" :class="{ 'mb-0': !meta }"><a-input v-model:value="f.fw" class="mono" placeholder="如：5.9.2" :maxlength="20" /></a-form-item>
        <a-form-item label="连接 IP" :class="{ 'mb-0': !meta }"><a-input v-model:value="f.connIp" class="mono" placeholder="如：192.168.10.21" :maxlength="64" /></a-form-item>
        <a-form-item label="通信端口" :class="{ 'mb-0': !meta }"><a-input-number v-model:value="f.connPort" :min="1" :max="65535" placeholder="可选" style="width:100%" /></a-form-item>
      </div>
      <template v-if="meta">
        <div class="label-row">采集参数 <span class="muted">配置一次，后续采集任务沿用</span></div>
        <div class="three">
          <a-form-item :label="meta.label" class="mb-0"><a-select v-model:value="f.cfg.rate" :options="meta.rates.map((v) => ({ value: v, label: v + ' ' + meta!.unit }))" /></a-form-item>
          <template v-if="meta.video">
            <a-form-item label="分辨率" class="mb-0"><a-select v-model:value="f.cfg.res" :options="meta.resolutions.map((v) => ({ value: v }))" /></a-form-item>
            <a-form-item label="视频编码" class="mb-0"><a-select v-model:value="f.cfg.codec" :options="meta.codecs.map((v) => ({ value: v }))" /></a-form-item>
          </template>
        </div>
      </template>
    </a-form>
  </a-modal>
</template>

<style scoped>
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }
.label-row { font-weight: 600; margin: 4px 0 8px; font-size: 13.5px; }
.label-row .muted { font-weight: 400; font-size: 12px; margin-left: 6px; }
:deep(.mb-0.ant-form-item) { margin-bottom: 0 !important; }
</style>
