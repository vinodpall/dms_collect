<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import BatchTrack from './BatchTrack.vue'
import BatchStateBadge from './BatchStateBadge.vue'
import { NO_PERM, STAGES } from '@/constants'
import type { Batch } from '@/stores/pipeline'

defineProps<{ rows: Batch[]; mayEdit: boolean; loading?: boolean; retryingId?: number | null }>()
const emit = defineEmits<{ (e: 'open', id: number): void; (e: 'retry', id: number): void }>()
const columns = [
  { title: '批次', key: 'id', width: 140, ellipsis: true, align: 'center' as const },
  { title: '来源 / 场景', key: 'task', width: 170, ellipsis: true, align: 'center' as const },
  { title: '条数 / 大小', key: 'size', width: 140, align: 'center' as const },
  { title: '阶段进度', key: 'trk', width: 260, align: 'center' as const },
  { title: '状态', key: 'state', width: 120, align: 'center' as const },
  { title: '操作', key: 'op', width: 90, align: 'center' as const },
]
const customRow = (b: Batch) => ({ class: 'row-click', onClick: () => emit('open', b.numericId) })
const isFail = (b: Batch) => b.state === 'failed' || b.state === 'partial_failed'
</script>
<template>
  <a-table
    v-if="rows.length || loading"
    size="middle"
    :loading="loading"
    :columns="columns"
    :data-source="rows"
    row-key="numericId"
    :pagination="{
      pageSize: 10,
      showSizeChanger: false,
      hideOnSinglePage: false,
      showTotal: (n: number) => `共 ${n} 个批次`,
    }"
    :custom-row="customRow"
  >
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'id'"><span class="mono">{{ (record as Batch).id }}</span></template>
      <template v-else-if="column.key === 'task'">
        <div class="cell-main"><span class="mono">{{ (record as Batch).task }}</span><small>{{ (record as Batch).sceneName }}</small></div>
      </template>
      <template v-else-if="column.key === 'size'"><span class="num">{{ (record as Batch).count }} 条 / {{ (record as Batch).sizeText }}</span></template>
      <template v-else-if="column.key === 'trk'">
        <BatchTrack :b="record as Batch" />
        <div class="muted" style="font-size: 12px; margin-top: 4px">{{ (record as Batch).stageName || STAGES[(record as Batch).stage] }}</div>
      </template>
      <template v-else-if="column.key === 'state'"><BatchStateBadge :b="record as Batch" /></template>
      <template v-else-if="column.key === 'op'">
        <span @click.stop>
          <button
            v-if="isFail(record as Batch)"
            type="button"
            class="btn sm"
            :disabled="!mayEdit || retryingId === (record as Batch).numericId"
            :title="mayEdit ? undefined : NO_PERM"
            @click="emit('retry', (record as Batch).numericId)"
          >{{ retryingId === (record as Batch).numericId ? '重试中…' : '重试' }}</button>
          <button v-else type="button" class="btn ghost sm" @click="emit('open', (record as Batch).numericId)">详情</button>
        </span>
      </template>
    </template>
  </a-table>
  <EmptyState v-else icon="inbox" title="没有符合条件的批次" desc="换个阶段或关键词试试" />
</template>
