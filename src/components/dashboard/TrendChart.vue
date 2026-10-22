<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useSession } from '@/stores/session'
import { niceMax, type TrendData } from './trend'

use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

export interface TrendSeries { key: string; name: string; color: string; vals: number[] }
const props = defineProps<{ data: TrendData; series: TrendSeries[]; hidden: Record<string, boolean> }>()
const session = useSession()

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

const option = computed(() => {
  void session.dark // 深浅色切换时重新读取 CSS 变量
  const d = props.data
  const vis = props.series.filter((s) => !props.hidden[s.key])
  const totals = d.labels.map((_, i) => vis.reduce((a, s) => a + s.vals[i], 0))
  const nm = niceMax(Math.max(...totals, 1))
  const axis = cssVar('--chart-axis'), grid = cssVar('--chart-grid')
  const every = d.labels.length > 12 ? 4 : 1
  const font = cssVar('--font-sans') || 'sans-serif'
  const n = d.labels.length
  return {
    animationDuration: 300,
    textStyle: { fontFamily: font },
    grid: { left: 40, right: 6, top: 10, bottom: 28, containLabel: false },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'none' }, confine: true,
      backgroundColor: '#213252', borderWidth: 0, padding: [8, 10], extraCssText: 'box-shadow:var(--shadow-pop);border-radius:8px;',
      textStyle: { color: '#F2F6FB', fontSize: 12.5, fontFamily: font },
      formatter: (ps: { dataIndex: number }[]) => {
        const i = ps[0].dataIndex
        return '<b>' + d.labels[i] + '</b><br>' + vis.map((s) => '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + s.color.replace(/^var\((.*)\)$/, (_m, v: string) => cssVar(v)) + ';margin-right:6px"></span>' + s.name + ' <b>' + s.vals[i] + '</b>').join('<br>') + (vis.length > 1 ? '<br>合计 <b>' + totals[i] + '</b>' : '')
      },
    },
    xAxis: {
      type: 'category', data: d.labels, axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { color: axis, fontSize: 11, margin: 12, interval: (i: number) => i % every === 0 || i === n - 1 },
    },
    yAxis: {
      type: 'value', min: 0, max: nm.top, interval: nm.step,
      axisLabel: { color: axis, fontSize: 11, margin: 8 }, axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: grid, width: 1 } },
    },
    series: vis.map((s, idx) => ({
      name: s.name, type: 'bar', stack: 'total', barMaxWidth: 34, barCategoryGap: '38%',
      data: s.vals, itemStyle: { color: cssVar(s.color.replace(/^var\((.*)\)$/, '$1')), borderRadius: idx === vis.length - 1 ? [2, 2, 0, 0] : 0 },
      emphasis: { focus: 'none', itemStyle: { opacity: 0.85 } },
    })),
  }
})
</script>

<template>
  <VChart :option="option" autoresize style="height:280px;width:100%" aria-label="采集趋势堆叠柱状图" />
</template>
