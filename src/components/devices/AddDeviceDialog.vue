<script setup lang="ts">
import { reactive, watch } from 'vue'
import { CODEC_OPTS, DEV_TYPES, RES_OPTS, STATIONS, cfgDef, useDevices, type DevCfg } from '@/stores/devices'
import { toast } from '@/composables/toast'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; done: [id: string] }>()
const store = useDevices()
const f = reactive({ cfg: { rate: 30 } as DevCfg, name: '', type: undefined as string | undefined, loc: '', fw: '', station: undefined as string | undefined, e: { name: '', type: '', station: '' } })
watch(() => f.type, (t) => { if (t) f.cfg = { ...cfgDef(t).def } })
watch(() => props.open, (v) => { if (v) Object.assign(f, { name: '', type: undefined, loc: '', fw: '', station: undefined, e: { name: '', type: '', station: '' } }) })
function submit() {
  const n = f.name.trim()
  f.e.name = !n ? '请输入设备名称' : store.list.some((d) => d.name === n) ? '设备名称已存在' : ''
  f.e.type = f.type ? '' : '请选择设备类型'
  f.e.station = f.station ? '' : '请选择所属工位'
  if (f.e.name || f.e.type || f.e.station) return
  const d = store.add({ name: n, type: f.type!, loc: f.loc.trim(), fw: f.fw.trim(), station: f.station!, cfg: f.cfg })
  emit('close'); toast('已新增设备 ' + d.id + '，上线后请完成一次性标定'); emit('done', d.id)
}
</script>
<template>
  <a-modal :open="open" title="新增设备" centered ok-text="新增" cancel-text="取消" destroy-on-close @ok="submit" @cancel="emit('close')">
    <a-form layout="vertical">
      <a-form-item label="设备名称" :validate-status="f.e.name ? 'error' : ''" :help="f.e.name"><a-input v-model:value="f.name" placeholder="如：PICO VR 一体机 #5" :maxlength="40" /></a-form-item>
      <div class="two">
        <a-form-item label="设备类型" :validate-status="f.e.type ? 'error' : ''" :help="f.e.type"><a-select v-model:value="f.type" placeholder="请选择" :options="DEV_TYPES.map((t) => ({ value: t }))" /></a-form-item>
        <a-form-item label="所属工位" :validate-status="f.e.station ? 'error' : ''" :help="f.e.station" extra="设备不绑定场景，按类型用于任意场景的采集任务"><a-select v-model:value="f.station" placeholder="请选择工位" :options="STATIONS.map((x) => ({ value: x }))" /></a-form-item>
      </div>
      <div class="two">
        <a-form-item label="安装位置"><a-input v-model:value="f.loc" placeholder="如：采集工位 A" :maxlength="30" /></a-form-item>
        <a-form-item label="固件版本"><a-input v-model:value="f.fw" placeholder="如：5.9.2" :maxlength="20" /></a-form-item>
      </div>
      <template v-if="f.type">
        <div class="label-row">采集参数 <span class="muted">配置一次，所有采集任务沿用，不需要每次新建任务时选择</span></div>
        <div class="three">
          <a-form-item :label="cfgDef(f.type).label"><a-select v-model:value="f.cfg.rate" :options="cfgDef(f.type).rates.map((v) => ({ value: v, label: v + ' ' + cfgDef(f.type!).unit }))" /></a-form-item>
          <template v-if="cfgDef(f.type).video">
            <a-form-item label="分辨率"><a-select v-model:value="f.cfg.res" :options="RES_OPTS.map((v) => ({ value: v }))" /></a-form-item>
            <a-form-item label="视频编码"><a-select v-model:value="f.cfg.codec" :options="CODEC_OPTS.map((v) => ({ value: v }))" /></a-form-item>
          </template>
        </div>
      </template>
    </a-form>
  </a-modal>
</template>
<style scoped>.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.label-row { font-weight: 600; margin: 4px 0 8px; font-size: 13.5px; }
.label-row .muted { font-weight: 400; font-size: 12px; margin-left: 6px; }</style>
