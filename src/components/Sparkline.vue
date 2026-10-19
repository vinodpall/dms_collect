<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ values: number[]; color?: string }>()
const W = 120, H = 34
const geo = computed(() => {
  const v = props.values, n = v.length
  const min = Math.min(...v), max = Math.max(...v)
  const sx = (i: number) => (i / (n - 1)) * W
  const sy = (x: number) => H - 4 - ((x - min) / (max - min || 1)) * (H - 8)
  const d = v.map((x, i) => (i ? 'L' : 'M') + sx(i).toFixed(1) + ' ' + sy(x).toFixed(1)).join('')
  return { d, area: d + `L${W} ${H}L0 ${H}Z`, cx: sx(n - 1), cy: sy(v[n - 1]) }
})
const col = computed(() => props.color ?? 'var(--chart-1)')
</script>
<template>
  <svg class="spark" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" aria-hidden="true">
    <path :d="geo.area" :fill="col" opacity=".12" />
    <path :d="geo.d" fill="none" :stroke="col" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />
    <circle :cx="geo.cx" :cy="geo.cy" r="2.6" :fill="col" />
  </svg>
</template>
