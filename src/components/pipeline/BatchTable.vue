<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import BatchTrack from './BatchTrack.vue'
import BatchStateBadge from './BatchStateBadge.vue'
import { NO_PERM, SCEN, STAGES } from '@/constants'
import type { Batch } from '@/stores/pipeline'

defineProps<{ rows: Batch[]; mayEdit: boolean }>()
const emit = defineEmits<{ (e: 'open', id: string): void; (e: 'retry', id: string): void }>()
const columns = [
  { title: '批次', key: 'id' },
  { title: '来源任务', key: 'task' },
  { title: '条数 / 大小', key: 'size', align: 'right' as const },
  { title: '阶段进度', key: 'trk', width: 260 },
  { title: '状态', key: 'state' },
  { title: '操作', key: 'op', align: 'right' as const },
]
const customRow = (b: Batch) => ({ class: 'row-click', onClick: () => emit('open', b.id) })
</script>
<template>
  <a-table v-if="rows.length" :columns="columns" :data-source="rows" row-key="id" :pagination="false" :custom-row="customRow" :scroll="{ x: 820 }">
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'id'"><span class="mono">{{ (record as Batch).id }}</span></template>
      <template v-else-if="column.key === 'task'">
        <div class="cell-main"><span class="mono">{{ (record as Batch).task }}</span><small>{{ SCEN[(record as Batch).scen].short }}</small></div>
      </template>
      <template v-else-if="column.key === 'size'"><span class="num">{{ (record as Batch).count }} 条 / {{ (record as Batch).size }} GB</span></template>
      <template v-else-if="column.key === 'trk'">
        <BatchTrack :b="record as Batch" />
        <div class="muted" style="font-size: 12px; margin-top: 4px">{{ STAGES[(record as Batch).stage] }}</div>
      </template>
      <template v-else-if="column.key === 'state'"><BatchStateBadge :b="record as Batch" /></template>
      <template v-else-if="column.key === 'op'">
        <span @click.stop>
          <button v-if="(record as Batch).state === 'failed'" type="button" class="btn sm" :disabled="!mayEdit" :title="mayEdit ? undefined : NO_PERM" @click="emit('retry', (record as Batch).id)">重试</button>
          <button v-else type="button" class="btn ghost sm" @click="emit('open', (record as Batch).id)">日志</button>
        </span>
      </template>
    </template>
  </a-table>
  <EmptyState v-else icon="inbox" title="没有符合条件的批次" desc="换个阶段或关键词试试" />
</template>
