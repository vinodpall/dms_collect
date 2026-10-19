<script setup lang="ts">
const props = defineProps<{ kind: 'fp' | 'tp' | 'wrist' }>()
const spokes = [0, 72, 144, 216, 288].map((a) => ({ x: 80 + 20 * Math.cos((a * Math.PI) / 180), y: 50 + 20 * Math.sin((a * Math.PI) / 180) }))
</script>
<template>
  <svg class="scene" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="160" height="90" fill="#0E1722" />
    <rect y="70" width="160" height="20" fill="#142131" />
    <circle cx="80" cy="50" r="24" fill="none" stroke="#3E5775" stroke-width="6" />
    <circle cx="80" cy="50" r="8" fill="#223347" />
    <line v-for="(s, i) in spokes" :key="i" x1="80" y1="50" :x2="s.x" :y2="s.y" stroke="#3E5775" stroke-width="3" />
    <rect v-if="props.kind === 'wrist'" x="62" y="4" width="36" height="22" rx="4" fill="#51698A" />
    <template v-else>
      <path d="M14 86 L52 58 L92 36" stroke="#51698A" stroke-width="6" fill="none" stroke-linecap="round" />
      <circle cx="92" cy="36" r="5" fill="#6E8DB3" />
    </template>
  </svg>
  <div class="scan"></div>
</template>
