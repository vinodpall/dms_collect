<script setup lang="ts">
import { STAGES } from '@/constants'
import type { Batch } from '@/stores/pipeline'

defineProps<{ b: Batch }>()
function cls(b: Batch, i: number) {
  if (i < b.stage || (i === b.stage && b.state === 'ok')) return 'done'
  if (i === b.stage) return b.state === 'failed' ? 'fail' : b.state === 'wait' ? 'wait' : 'cur'
  return ''
}
</script>
<template>
  <div class="trk" aria-label="处理进度">
    <i v-for="(s, i) in STAGES" :key="s" :class="cls(b, i)" :style="i === b.stage && b.state === 'running' ? { '--p': b.pct + '%' } : undefined" :title="s"></i>
  </div>
</template>
