<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fmt } from '@/utils'

/** 数字滚动：首次出现时从 0 滚到目标值，之后数值变化时从旧值过渡 */
const props = withDefaults(defineProps<{ value: number; decimals?: number; duration?: number; delay?: number }>(), { decimals: 0, duration: 1100, delay: 0 })
const shown = ref(0)
let raf = 0, t0 = 0, from = 0, timer = 0
const reduce = false // 与训练场一致：动效始终播放
function run(to: number) {
  cancelAnimationFrame(raf)
  if (reduce) { shown.value = to; return }
  from = shown.value; t0 = performance.now()
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / props.duration)
    shown.value = from + (to - from) * (1 - Math.pow(1 - k, 3))
    if (k < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}
onMounted(() => { timer = window.setTimeout(() => run(props.value), reduce ? 0 : props.delay) })
watch(() => props.value, (v) => run(v))
onBeforeUnmount(() => { cancelAnimationFrame(raf); clearTimeout(timer) })
const text = () => (props.decimals ? shown.value.toFixed(props.decimals) : fmt(Math.round(shown.value)))
</script>
<template><span class="num">{{ text() }}</span></template>
