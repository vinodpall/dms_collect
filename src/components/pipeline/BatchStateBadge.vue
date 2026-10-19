<script setup lang="ts">
import StatusBadge from '@/components/StatusBadge.vue'
import type { Batch } from '@/stores/pipeline'

defineProps<{ b: Batch }>()
</script>
<template>
  <StatusBadge v-if="b.state === 'failed'" kind="crit" text="失败" />
  <StatusBadge v-else-if="b.state === 'running'" kind="info" text="处理中" />
  <StatusBadge v-else-if="b.state === 'wait'" kind="warn" :text="b.stage === 2 ? '待人工标注' : b.stage === 3 ? '待标注校验' : '排队中'" />
  <StatusBadge v-else kind="good" text="已完成" />
</template>
