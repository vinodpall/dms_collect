<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { SCEN, type ScenKey } from '@/constants'
import { useDatasets } from '@/stores/datasets'
import { useTasks } from '@/stores/tasks'
import { toast } from '@/composables/toast'

/** 外部数据进入平台：视频上传（mp4 等）/ LeRobot 数据集导入；先校验再入库，入库后进入标注任务池 */
const props = defineProps<{ open: boolean; kind: 'video' | 'lerobot' }>()
const emit = defineEmits<{ close: [] }>()
const ds = useDatasets()
const tasks = useTasks()

const f = reactive({ scen: 'qmd' as ScenKey, dataset: '', files: [] as string[], repo: '', eps: 40, step: 0 as 0 | 1 | 2, checks: [] as { name: string; ok: boolean; info: string }[] })
watch(() => props.open, (v) => {
  if (!v) return
  Object.assign(f, { scen: 'qmd', dataset: '', files: [], repo: props.kind === 'lerobot' ? 'hf://lerobot/' : '', eps: 40, step: 0, checks: [] })
  f.dataset = dsOpts.value[0]?.value ?? ''
})
const dsOpts = computed(() => ds.list.filter((d) => d.scen === f.scen).map((d) => ({ value: d.id, label: d.id + ' · ' + d.name })))
watch(() => f.scen, () => { f.dataset = dsOpts.value[0]?.value ?? '' }, { immediate: true })
const title = computed(() => (props.kind === 'video' ? '视频上传' : 'LeRobot 导入'))
const ready = computed(() => !!f.dataset && (props.kind === 'video' ? f.files.length > 0 : f.repo.trim().length > 14))

function beforeUpload(file: File) {
  if (!/\.(mp4|mov|mkv|avi)$/i.test(file.name)) { toast(file.name + ' 不是视频文件', { type: 'warn' }); return false }
  if (!f.files.includes(file.name)) f.files.push(file.name)
  return false
}
function addDemo() {
  const n = f.files.length
  f.files.push(...[1, 2, 3].map((k) => `${SCEN[f.scen].code.toLowerCase()}_demo_${String(n + k).padStart(2, '0')}.mp4`))
}
function validate() {
  f.step = 1
  const [lo, hi] = SCEN[f.scen].dur
  setTimeout(() => {
    f.checks = props.kind === 'video'
      ? [
          { name: '文件格式', ok: true, info: 'H.264 / H.265 编码，可解码' },
          { name: '分辨率与帧率', ok: true, info: '≥ 720p，25–60 fps' },
          { name: '时长范围', ok: f.files.length < 4, info: f.files.length < 4 ? `均在 ${lo}–${hi} 秒内` : `1 个文件超过 ${hi} 秒，将带警告入库` },
          { name: '重复检测', ok: true, info: '未发现与已有数据重复' },
        ]
      : [
          { name: 'meta/info.json', ok: true, info: 'LeRobot v2.1 格式，fps 30' },
          { name: '特征字段', ok: true, info: 'observation.images.* / observation.state / action' },
          { name: 'Episode 数量', ok: true, info: `${f.eps} 条，parquet 与视频一一对应` },
          { name: '时长范围', ok: f.eps <= 40, info: f.eps <= 40 ? `均在 ${lo}–${hi} 秒内` : `部分 Episode 超过 ${hi} 秒，将带警告入库` },
        ]
    f.step = 2
  }, 700)
}
function doImport() {
  const files = props.kind === 'video' ? f.files : [`${f.repo.replace(/\/$/, '')} · ep_000~${String(f.eps - 1).padStart(3, '0')}`]
  tasks.importData({ kind: props.kind, dataset: f.dataset, scen: f.scen, files })
  toast(`${title.value}完成：${props.kind === 'video' ? files.length + ' 个视频' : f.eps + ' 条 Episode'} 已入库 ${f.dataset}，并进入标注任务池`)
  emit('close')
}
</script>

<template>
  <a-modal :open="open" :title="title" width="560px" centered :footer="null" @cancel="emit('close')">
    <a-form layout="vertical" :disabled="f.step === 1">
      <div class="row" style="gap:12px">
        <a-form-item label="场景" style="flex:1"><a-select v-model:value="f.scen" :options="[{ value: 'qmd', label: SCEN.qmd.name }, { value: 'fhd', label: SCEN.fhd.name }]" /></a-form-item>
        <a-form-item label="目标数据集" required style="flex:1.4"><a-select v-model:value="f.dataset" :options="dsOpts" placeholder="选择数据集" /></a-form-item>
      </div>
      <template v-if="kind === 'video'">
        <a-form-item label="视频文件" required>
          <a-upload-dragger :before-upload="beforeUpload" :show-upload-list="false" multiple accept=".mp4,.mov,.mkv,.avi">
            <p style="margin:0"><AppIcon name="download" /> 拖入或点击选择视频（mp4 / mov / mkv）</p>
          </a-upload-dragger>
          <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">
            <span v-for="(n, i) in f.files" :key="n" class="tag">{{ n }} <a style="margin-left:4px" @click="f.files.splice(i, 1)">×</a></span>
            <a-button size="small" type="link" @click="addDemo">添加示例文件</a-button>
          </div>
        </a-form-item>
      </template>
      <template v-else>
        <a-form-item label="仓库地址或本地路径" required extra="支持 Hugging Face 仓库（hf://组织/名称）或服务器上的 LeRobot 数据集目录">
          <a-input v-model:value="f.repo" placeholder="hf://lerobot/plug_insert_v3" />
        </a-form-item>
        <a-form-item label="导入 Episode 数"><a-input-number v-model:value="f.eps" :min="1" :max="500" style="width:140px" /></a-form-item>
      </template>
    </a-form>

    <div v-if="f.step === 2" class="checks">
      <div v-for="c in f.checks" :key="c.name" class="ck"><span class="tag" :class="c.ok ? 'good' : 'warn'">{{ c.ok ? '通过' : '警告' }}</span><b>{{ c.name }}</b><span class="muted">{{ c.info }}</span></div>
    </div>

    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:16px">
      <a-button @click="emit('close')">取消</a-button>
      <a-button v-if="f.step < 2" type="primary" :loading="f.step === 1" :disabled="!ready" @click="validate">{{ f.step === 1 ? '校验中…' : '校验' }}</a-button>
      <a-button v-else type="primary" @click="doImport">确认入库</a-button>
    </div>
  </a-modal>
</template>

<style scoped>
.checks { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 8px; background: var(--surface-2); font-size: 13px; }
.ck { display: flex; gap: 8px; align-items: center; }
</style>
