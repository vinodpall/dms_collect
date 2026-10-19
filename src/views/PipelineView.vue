<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StageSummary from '@/components/pipeline/StageSummary.vue'
import BatchBoard from '@/components/pipeline/BatchBoard.vue'
import BatchTable from '@/components/pipeline/BatchTable.vue'
import BatchModal from '@/components/pipeline/BatchModal.vue'
import { usePipeline } from '@/stores/pipeline'
import { useSession } from '@/stores/session'
import { NO_PERM } from '@/constants'
import { toast } from '@/composables/toast'

const pl = usePipeline()
const session = useSession()
const mayEdit = computed(() => session.can('pipeline'))
const stage = ref<number | null>(null)
const q = ref('')
const openId = ref<string | null>(null)

const rows = computed(() => {
  const k = q.value.trim().toLowerCase()
  return pl.batches.filter((b) => !k || (b.id + b.task).toLowerCase().includes(k))
})
const tblRows = computed(() => rows.value.filter((b) => stage.value === null || b.stage === stage.value))

function retry(id: string) {
  if (pl.retry(id)) toast('已重新提交 ' + id)
}
function retryAll() {
  const f = pl.batches.filter((b) => b.state === 'failed')
  if (!f.length) { toast('当前没有失败的批次'); return }
  f.forEach((b) => retry(b.id))
}
function retryFromModal(id: string) { openId.value = null; retry(id) }

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { if (!openId.value) pl.tick() }, 1800) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>
<template>
  <PageHead title="数据处理流水线" desc="原始数据 → 数据标准化 → 手动标注 → 标注校验 → 格式转换 → 入库发布；当前采用自动化 + 手动处理">
    <a-button :disabled="!mayEdit" :title="mayEdit ? undefined : NO_PERM" @click="retryAll"><AppIcon name="refresh" />重试全部失败</a-button>
  </PageHead>
  <StageSummary v-model:stage="stage" />
  <BatchBoard :rows="rows" @open="openId = $event" />
  <div class="card">
    <div class="card-head">
      <div><h2>批次列表</h2><div class="sub">点击一行查看处理日志</div></div>
      <div class="input-wrap" style="width: 240px">
        <AppIcon name="search" />
        <input v-model="q" class="input" type="search" placeholder="搜索批次、任务" aria-label="搜索批次" />
      </div>
    </div>
    <BatchTable :rows="tblRows" :may-edit="mayEdit" @open="openId = $event" @retry="retry" />
  </div>
  <BatchModal :id="openId" :may-edit="mayEdit" @close="openId = null" @retry="retryFromModal" />
</template>
