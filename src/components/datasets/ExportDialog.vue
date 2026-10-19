<script setup lang="ts">
import { ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { fmt } from '@/utils'
import type { Dataset } from '@/stores/datasets'
import { useSettings } from '@/stores/settings'
import { toast } from '@/composables/toast'

const props = defineProps<{ ds: Dataset | null }>()
const emit = defineEmits<{ close: [] }>()
const settings = useSettings()
const FORMATS = [['rosbag', 'ROS bag', '.bag，保留话题与时间戳，可直接回放'], ['hdf5', 'HDF5', '.h5，按通道分组，适合大批量读取'], ['lerobot', 'LeRobot', 'parquet + mp4，可直接用于模仿学习训练']]
const fmtKey = ref('rosbag')
const range = ref(0)
watch(() => props.ds, () => { fmtKey.value = 'rosbag'; range.value = 0 })
function go() {
  const f = FORMATS.find((x) => x[0] === fmtKey.value)![1]
  toast('导出任务已创建：' + props.ds!.id + ' · ' + f, { action: '好的' })
  emit('close')
}
</script>
<template>
  <a-modal :open="!!ds" :title="ds ? '导出 ' + ds.name : ''" centered ok-text="创建导出任务" cancel-text="取消" destroy-on-close @ok="go" @cancel="emit('close')">
    <div v-if="ds" style="display:flex;flex-direction:column;gap:16px">
      <div class="field"><span class="label">导出格式</span>
        <div style="display:flex;flex-direction:column;gap:10px">
          <label v-for="f in FORMATS" :key="f[0]" class="fmtcard"><input v-model="fmtKey" type="radio" name="xf" :value="f[0]" /><span><b>{{ f[1] }}</b><br /><span class="muted" style="font-size:12.5px">{{ f[2] }}</span></span></label>
        </div>
      </div>
      <div class="field"><span class="label">范围</span><a-select v-model:value="range" :options="[{ value: 0, label: '全部 ' + fmt(ds.count) + ' 条' }, { value: 1, label: '仅质量分 ≥ 95' }, { value: 2, label: '随机抽样 100 条' }]" /></div>
      <div class="callout info"><AppIcon name="info" /><span>导出文件{{ settings.cfg.watermark ? '会带数据水印，' : '' }}{{ settings.cfg.encrypt ? '传输全程加密，' : '' }}并记录到审计日志。</span></div>
    </div>
  </a-modal>
</template>
