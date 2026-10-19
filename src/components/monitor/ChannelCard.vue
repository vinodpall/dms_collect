<script setup lang="ts">
import { computed } from 'vue'
import StatusBadge from '@/components/StatusBadge.vue'
import Sparkline from '@/components/Sparkline.vue'
import { useMonitor, type Channel } from '@/stores/monitor'
import { useSettings } from '@/stores/settings'

const props = defineProps<{ ch: Channel }>()
const mon = useMonitor()
const { cfg } = useSettings()
const drop = computed(() => mon.dropRate(props.ch))
const lvl = computed<'good' | 'warn' | 'crit'>(() => (drop.value > 5 ? 'crit' : drop.value > cfg.drop ? 'warn' : 'good'))
const hist = computed(() => mon.hist[props.ch.id])
const v = computed(() => hist.value[hist.value.length - 1])
const color = computed(() => (lvl.value === 'good' ? 'var(--chart-1)' : lvl.value === 'warn' ? 'var(--warn-solid)' : 'var(--crit-solid)'))
</script>
<template>
  <div class="card chan" :class="lvl === 'good' ? '' : lvl">
    <div class="top">
      <div>
        <div class="nm">{{ ch.name }}</div>
        <div class="muted" style="font-size: 12.5px">{{ ch.dev }}</div>
      </div>
      <StatusBadge :kind="lvl" :text="lvl === 'good' ? '正常' : lvl === 'warn' ? '掉帧' : '严重掉帧'" />
    </div>
    <div class="big num">{{ ch.base > 100 ? Math.round(v) : v.toFixed(1) }}<small>{{ ch.unit }}</small></div>
    <Sparkline :values="hist.slice(-30)" :color="color" />
    <div class="meta">
      <span>掉帧率 <b class="num" :style="{ color: lvl === 'good' ? 'inherit' : `var(--${lvl})` }">{{ drop.toFixed(1) }}%</b></span>
      <span>阈值 {{ cfg.drop }}%</span>
    </div>
  </div>
</template>
