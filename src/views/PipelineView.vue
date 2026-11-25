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
const openId = ref<number | null>(null)
const retryingId = ref<number | null>(null)
const retryingAll = ref(false)
const modalRef = ref<InstanceType<typeof BatchModal> | null>(null)

const rows = computed(() => {
  const k = q.value.trim().toLowerCase()
  return pl.batches.filter((b) => !k || (b.id + ' ' + b.task + ' ' + b.sceneName + ' ' + b.datasetName).toLowerCase().includes(k))
})
const tblRows = computed(() => rows.value.filter((b) => stage.value === null || b.stage === stage.value))

async function refresh() {
  await pl.refreshAll()
}

async function retry(id: number) {
  const target = pl.batches.find((b) => b.numericId === id)
  retryingId.value = id
  try {
    await pl.retryBatch(id)
    toast(`已重新提交 ${target?.id || '#' + id}`)
    if (openId.value === id) {
      modalRef.value?.reload()
    }
  } catch (err: any) {
    toast(err?.message || '重试批次失败', { type: 'warn' })
  } finally {
    retryingId.value = null
  }
}

async function retryAll() {
  retryingAll.value = true
  try {
    const res = await pl.retryAllFailed()
    if (!res.batch_count && !res.episode_count) {
      toast('当前没有失败的批次')
    } else {
      toast(`已重新提交 ${res.batch_count} 个批次，共 ${res.episode_count} 条失败数据`)
    }
    if (openId.value !== null) {
      modalRef.value?.reload()
    }
  } catch (err: any) {
    toast(err?.message || '批量重试失败', { type: 'warn' })
  } finally {
    retryingAll.value = false
  }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  pl.refreshAll()
  timer = setInterval(() => {
    if (openId.value === null && pl.batches.some((b) => b.state === 'running')) {
      pl.refreshAll()
    }
  }, 10000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>
<template>
  <PageHead title="数据处理流水线" desc="原始数据 → 数据标准化 → 手动标注 → 标注校验 → 格式转换 → 入库发布；当前采用自动化 + 手动处理">
    <a-button :loading="pl.loading" @click="refresh"><AppIcon name="refresh" />刷新</a-button>
    <a-button :disabled="!mayEdit || retryingAll" :loading="retryingAll" :title="mayEdit ? undefined : NO_PERM" @click="retryAll"><AppIcon name="refresh" />重试全部失败</a-button>
  </PageHead>
  <StageSummary v-model:stage="stage" />
  <BatchBoard :rows="rows" @open="openId = $event" />
  <div class="card">
    <div class="card-head">
      <div><h2>批次列表</h2><div class="sub">点击一行查看批次详情与处理日志</div></div>
      <div class="input-wrap" style="width: 240px">
        <AppIcon name="search" />
        <input v-model="q" class="input" type="search" placeholder="搜索批次、任务、场景" aria-label="搜索批次" />
      </div>
    </div>
    <BatchTable :rows="tblRows" :may-edit="mayEdit" :loading="pl.loadingBatches" :retrying-id="retryingId" @open="openId = $event" @retry="retry" />
  </div>
  <BatchModal ref="modalRef" :id="openId" :may-edit="mayEdit" :retrying="openId !== null && retryingId === openId" @close="openId = null" @retry="retry" />
</template>
