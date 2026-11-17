<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useDevices } from '@/stores/devices'
import { toast } from '@/composables/toast'

const props = defineProps<{ open: boolean; devId: string | null }>()
const emit = defineEmits<{ close: []; done: [] }>()
const store = useDevices()
const saving = ref(false)
const f = reactive({ dev: '' as string, lv: '一般' as '一般' | '严重', desc: '', errDev: false, errDesc: false })

watch(
  () => props.open,
  (v) => {
    if (v) Object.assign(f, { dev: props.devId ?? '', lv: '一般', desc: '', errDev: false, errDesc: false })
  }
)

async function submit() {
  f.errDev = !f.dev
  f.errDesc = f.desc.trim().length < 5
  if (f.errDev || f.errDesc) return
  saving.value = true
  try {
    await store.reportFault(f.dev, f.lv, f.desc.trim())
    emit('close')
    toast('故障已登记')
    emit('done')
  } catch (err: any) {
    toast('故障登记失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <a-modal :open="open" title="登记设备故障" centered ok-text="提交" cancel-text="取消" :confirm-loading="saving" destroy-on-close @ok="submit" @cancel="emit('close')">
    <a-form layout="vertical">
      <a-form-item label="故障设备" :validate-status="f.errDev ? 'error' : ''" :help="f.errDev ? '请选择设备' : ''"><a-select v-model:value="f.dev" placeholder="请选择设备" :options="store.list.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` }))" /></a-form-item>
      <a-form-item label="严重程度" extra="严重故障会将设备置为“故障”并暂停相关任务"><a-select v-model:value="f.lv" :options="[{ value: '一般' }, { value: '严重' }]" /></a-form-item>
      <a-form-item label="故障描述" :validate-status="f.errDesc ? 'error' : ''" :help="f.errDesc ? '请至少填写 5 个字的描述' : ''"><a-textarea v-model:value="f.desc" :rows="3" :maxlength="200" placeholder="现象、发生时间、已尝试的处理" /></a-form-item>
    </a-form>
  </a-modal>
</template>
