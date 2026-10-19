<script setup lang="ts">
import { reactive, watch } from 'vue'
import { SCEN, type ScenKey } from '@/constants'
import { DEV_TYPES, useDevices } from '@/stores/devices'
import { toast } from '@/composables/toast'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; done: [id: string] }>()
const store = useDevices()
const f = reactive({ name: '', type: undefined as string | undefined, loc: '', fw: '', scen: undefined as ScenKey | undefined, e: { name: '', type: '', scen: '' } })
watch(() => props.open, (v) => { if (v) Object.assign(f, { name: '', type: undefined, loc: '', fw: '', scen: undefined, e: { name: '', type: '', scen: '' } }) })
const scenOpts = (Object.keys(SCEN) as ScenKey[]).map((k) => ({ value: k, label: SCEN[k].name }))
function submit() {
  const n = f.name.trim()
  f.e.name = !n ? '请输入设备名称' : store.list.some((d) => d.name === n) ? '设备名称已存在' : ''
  f.e.type = f.type ? '' : '请选择设备类型'
  f.e.scen = f.scen ? '' : '请分配所属场景'
  if (f.e.name || f.e.type || f.e.scen) return
  const d = store.add({ name: n, type: f.type!, loc: f.loc.trim(), fw: f.fw.trim(), scen: f.scen! })
  emit('close'); toast('已新增设备 ' + d.id + '，分配至「' + SCEN[f.scen!].name + '」'); emit('done', d.id)
}
</script>
<template>
  <a-modal :open="open" title="新增设备" centered ok-text="新增" cancel-text="取消" destroy-on-close @ok="submit" @cancel="emit('close')">
    <a-form layout="vertical">
      <a-form-item label="设备名称" :validate-status="f.e.name ? 'error' : ''" :help="f.e.name"><a-input v-model:value="f.name" placeholder="如：PICO VR 一体机 #5" :maxlength="40" /></a-form-item>
      <div class="two">
        <a-form-item label="设备类型" :validate-status="f.e.type ? 'error' : ''" :help="f.e.type"><a-select v-model:value="f.type" placeholder="请选择" :options="DEV_TYPES.map((t) => ({ value: t }))" /></a-form-item>
        <a-form-item label="所属场景" :validate-status="f.e.scen ? 'error' : ''" :help="f.e.scen" extra="设备只能用于所属场景下的采集任务"><a-select v-model:value="f.scen" placeholder="请选择场景" :options="scenOpts" /></a-form-item>
      </div>
      <div class="two">
        <a-form-item label="安装位置"><a-input v-model:value="f.loc" placeholder="如：采集工位 A" :maxlength="30" /></a-form-item>
        <a-form-item label="固件版本"><a-input v-model:value="f.fw" placeholder="如：5.9.2" :maxlength="20" /></a-form-item>
      </div>
    </a-form>
  </a-modal>
</template>
<style scoped>.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }</style>
