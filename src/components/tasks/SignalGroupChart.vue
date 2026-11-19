<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { SignalGroup } from '@/api'

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const COLORS = ['#2ED3E6', '#45E3A8', '#FFC15C', '#FF7A7A', '#A78BFA', '#60A5FA']

const props = defineProps<{
  group: SignalGroup
  t: number[]
  durationMs: number
  rateHz: number
  currentMs: number
}>()

const emit = defineEmits<{
  seek: [ms: number]
}>()

const chartRef = ref<InstanceType<typeof VChart>>()
const cursorX = ref<number | null>(null)

const cursorIdx = computed(() => {
  const n = props.t.length
  if (!n) return 0
  const idx = Math.round((props.currentMs / 1000) * (props.rateHz || 50))
  return Math.max(0, Math.min(n - 1, idx))
})

const currentValues = computed(() => {
  const idx = cursorIdx.value
  return props.group.series.map((s, i) => {
    const v = s.data[idx]
    return {
      key: s.key,
      label: s.label,
      color: COLORS[i % COLORS.length],
      text: v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(2),
    }
  })
})

const option = computed(() => {
  const maxMs = Math.max(props.durationMs || 0, props.t[props.t.length - 1] || 1000)
  return {
    animation: false,
    grid: { left: 48, right: 14, top: 24, bottom: 24 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: '#162A45',
      borderColor: 'rgba(46,211,230,.32)',
      borderWidth: 1,
      textStyle: { color: '#F3F8FC', fontSize: 11.5 },
      formatter: (params: any[]) => {
        if (!Array.isArray(params) || !params.length) return ''
        const ms = Number(params[0].value?.[0] ?? 0)
        const sec = (ms / 1000).toFixed(2)
        const unit = props.group.unit ? ` ${props.group.unit}` : ''
        const lines = params.map((p) => {
          const val = p.value?.[1]
          const txt = val === null || val === undefined ? '—' : `${Number(val).toFixed(3)}${unit}`
          return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${p.seriesName}: <b>${txt}</b>`
        })
        return `<div style="margin-bottom:4px;color:#8EA6BE">${sec} s</div>${lines.join('<br/>')}`
      },
    },
    legend: {
      show: props.group.series.length > 1,
      top: 0,
      right: 8,
      itemWidth: 10,
      itemHeight: 6,
      textStyle: { color: '#B6CADC', fontSize: 11 },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: maxMs,
      axisLine: { lineStyle: { color: '#2B4A6D' } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: '#8EA6BE',
        fontSize: 10.5,
        formatter: (v: number) => `${(v / 1000).toFixed(1)}s`,
      },
    },
    yAxis: {
      type: 'value',
      name: props.group.unit || '',
      nameTextStyle: { color: '#8EA6BE', fontSize: 10.5, padding: [0, 0, 0, -6] },
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#8EA6BE', fontSize: 10.5 },
      splitLine: { lineStyle: { color: 'rgba(43,74,109,.45)', type: 'dashed' } },
    },
    series: props.group.series.map((s, idx) => ({
      name: s.label,
      type: 'line',
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 1.5, color: COLORS[idx % COLORS.length] },
      itemStyle: { color: COLORS[idx % COLORS.length] },
      data: props.t.map((ms, i) => [ms, s.data[i] ?? null]),
    })),
  }
})

function updateCursorPx() {
  const inst = chartRef.value?.chart
  if (!inst) return
  const targetMs = props.t[cursorIdx.value] ?? props.currentMs
  const px = inst.convertToPixel({ xAxisIndex: 0 }, targetMs)
  cursorX.value = typeof px === 'number' && Number.isFinite(px) ? px : null
}

function bindZrClick() {
  const inst = chartRef.value?.chart
  if (!inst) return
  const zr = inst.getZr()
  zr.off('click')
  zr.on('click', (evt: any) => {
    const pt = [evt.offsetX, evt.offsetY]
    if (!inst.containPixel('grid', pt)) return
    const val = inst.convertFromPixel({ xAxisIndex: 0 }, evt.offsetX)
    if (typeof val !== 'number' || !Number.isFinite(val)) return
    const n = props.t.length
    if (!n) {
      emit('seek', Math.max(0, Math.min(props.durationMs, val)))
      return
    }
    const idx = Math.max(0, Math.min(n - 1, Math.round((val / 1000) * (props.rateHz || 50))))
    emit('seek', props.t[idx] ?? val)
  })
  updateCursorPx()
}

onMounted(() => {
  nextTick(() => {
    bindZrClick()
  })
})

watch(
  () => [props.currentMs, props.t.length, props.durationMs],
  () => updateCursorPx(),
)

function onFinished() {
  bindZrClick()
}
</script>

<template>
  <div class="sig-card">
    <div class="sig-head">
      <div class="sig-title">
        <span>{{ group.label }}</span>
        <span v-if="group.unit" class="sig-unit">{{ group.unit }}</span>
      </div>
      <div class="sig-vals">
        <span v-for="v in currentValues" :key="v.key" class="sig-val">
          <i class="sig-dot" :style="{ background: v.color }" />
          <span class="muted">{{ v.label }}</span>
          <b class="mono">{{ v.text }}</b>
        </span>
      </div>
    </div>
    <div class="sig-body">
      <VChart
        ref="chartRef"
        :option="option"
        autoresize
        class="sig-chart"
        @finished="onFinished"
      />
      <div
        v-if="cursorX !== null"
        class="sig-cursor"
        :style="{ left: `${cursorX}px` }"
      />
    </div>
  </div>
</template>

<style scoped>
.sig-card {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(15, 31, 53, 0.72);
  padding: 10px 12px 6px;
}
.sig-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}
.sig-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.sig-unit {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(46, 211, 230, 0.12);
  color: var(--accent-text);
}
.sig-vals {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11.5px;
}
.sig-val {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sig-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.sig-body {
  position: relative;
  height: 168px;
  cursor: crosshair;
}
.sig-chart {
  width: 100%;
  height: 100%;
}
.sig-cursor {
  position: absolute;
  top: 24px;
  bottom: 24px;
  width: 1.5px;
  background: rgba(46, 211, 230, 0.9);
  box-shadow: 0 0 6px rgba(46, 211, 230, 0.7);
  pointer-events: none;
}
</style>
