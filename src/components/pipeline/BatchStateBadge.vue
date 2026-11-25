<script setup lang="ts">
import StatusBadge from '@/components/StatusBadge.vue'
import type { Batch } from '@/stores/pipeline'

defineProps<{ b: Batch }>()
</script>
<template>
  <StatusBadge v-if="b.state === 'failed'" kind="crit" :text="b.stateLabel || '失败'" />
  <StatusBadge v-else-if="b.state === 'partial_failed'" kind="crit" :text="b.stateLabel || '部分失败'" />
  <StatusBadge v-else-if="b.state === 'running'" kind="info" :text="b.stateLabel || '处理中'" />
  <StatusBadge v-else-if="b.state === 'wait'" kind="warn" :text="b.stateLabel || (b.stage === 2 ? '待人工标注' : b.stage === 3 ? '待标注校验' : '排队中')" />
  <StatusBadge v-else kind="good" :text="b.stateLabel || '已完成'" />
</template>
