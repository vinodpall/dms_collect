<script setup lang="ts">
import { reactive, watch } from 'vue'
import { useDevices } from '@/stores/devices'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'

const props = defineProps<{ open: boolean; devId: string | null }>()
const emit = defineEmits<{ close: []; done: [] }>()
const store = useDevices()
const session = useSession()
const f = reactive({ dev: '' as string, lv: '一般', desc: '', errDev: false, errDesc: false })
watch(() => props.open, (v) => { if (v) Object.assign(f, { dev: props.devId ?? '', lv: '一般', desc: '', errDev: false, errDesc: false }) })
function submit() {
  f.errDev = !f.dev
  f.errDesc = f.desc.trim().length < 5
  if (f.errDev || f.errDesc) return
  store.faults.unshift({ dev: f.dev, t: '刚刚', lv: f.lv, d: f.desc.trim(), by: session.info.user })
  if (f.lv === '严重') store.byId(f.dev)!.st = 'fault'
  emit('close'); toast('故障已登记'); emit('done')
}
</script>
<template>
  <a-modal :open="open" title="登记设备故障" centered ok-text="提交" cancel-text="取消" destroy-on-close @ok="submit" @cancel="emit('close')">
    <a-form layout="vertical">
      <a-form-item label="故障设备" :validate-status="f.errDev ? 'error' : ''" :help="f.errDev ? '请选择设备' : ''"><a-select v-model:value="f.dev" placeholder="请选择设备" :options="store.list.map((d) => ({ value: d.id, label: d.name }))" /></a-form-item>
      <a-form-item label="严重程度" extra="严重故障会将设备置为“故障”并暂停相关任务"><a-select v-model:value="f.lv" :options="[{ value: '一般' }, { value: '严重' }]" /></a-form-item>
      <a-form-item label="故障描述" :validate-status="f.errDesc ? 'error' : ''" :help="f.errDesc ? '请至少填写 5 个字的描述' : ''"><a-textarea v-model:value="f.desc" :rows="3" :maxlength="200" placeholder="现象、发生时间、已尝试的处理" /></a-form-item>
    </a-form>
  </a-modal>
</template>
