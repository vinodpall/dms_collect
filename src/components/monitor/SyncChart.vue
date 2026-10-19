<script setup lang="ts">
import { computed } from 'vue'
import { clamp } from '@/utils'

const props = defineProps<{ vals: number[]; min: number; max: number; th: number; label: string }>()
const W = 680, H = 200, L = 40, R = 8, T = 10, B = 22
const ih = H - T - B, iw = W - L - R
const x = (i: number) => L + (iw * i) / (props.vals.length - 1)
const y = (v: number) => T + ih - ((clamp(v, props.min, props.max) - props.min) / (props.max - props.min)) * ih
const grid = computed(() => [0, 1, 2, 3, 4].map((i) => { const v = props.min + ((props.max - props.min) * i) / 4; return { v, y: y(v) } }))
const path = computed(() => props.vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(''))
const bad = computed(() => props.vals.map((v, i) => ({ v, i })).filter((p) => p.v > props.th))
</script>
<template>
  <svg class="chart" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="label">
    <g v-for="g in grid" :key="g.v">
      <line class="grid-l" :x1="L" :x2="W - R" :y1="g.y" :y2="g.y" />
      <text :x="L - 8" :y="g.y + 4" text-anchor="end">{{ g.v.toFixed(0) }}</text>
    </g>
    <line :x1="L" :x2="W - R" :y1="y(th)" :y2="y(th)" stroke="var(--crit-solid)" stroke-dasharray="5 4" stroke-width="1.4" />
    <text :x="W - R - 4" :y="y(th) - 6" text-anchor="end" fill="var(--crit)">阈值 {{ th }} ms</text>
    <path :d="path" fill="none" stroke="var(--chart-1)" stroke-width="2" stroke-linejoin="round" />
    <circle v-for="p in bad" :key="p.i" :cx="x(p.i)" :cy="y(p.v)" r="3.5" fill="var(--crit-solid)" />
    <text :x="L" :y="H - 4">60 秒前</text>
    <text :x="W - R" :y="H - 4" text-anchor="end">现在</text>
  </svg>
</template>
