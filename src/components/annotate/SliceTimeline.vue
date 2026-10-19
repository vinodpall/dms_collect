<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { colorOf, newSegId, SUB_NAMES, type Clip, type Seg } from '@/stores/annotate'
import { clamp } from '@/utils'
import { fmtT } from './motion'

const props = defineProps<{ clip: Clip; t: number; selected: number | null; editable: boolean }>()
const emit = defineEmits<{ 'update:t': [v: number]; select: [id: number | null]; changed: [] }>()

const MIN = 0.3, SNAP = 0.12
const track = ref<HTMLElement>()
const sorted = computed(() => props.clip.segs.slice().sort((a, b) => a.s - b.s))
const ticks = computed(() => {
  const step = props.clip.dur > 40 ? 5 : props.clip.dur > 20 ? 2 : 1
  return Array.from({ length: Math.floor(props.clip.dur / step) + 1 }, (_, i) => i * step)
})
const pct = (v: number) => (v / props.clip.dur) * 100
const r1 = (v: number) => Math.round(v * 10) / 10

type Drag =
  | { k: 'seek' }
  | { k: 'create'; a: number; b: number }
  | { k: 'move'; seg: Seg; off: number; len: number }
  | { k: 'l' | 'r'; seg: Seg }
const drag = ref<Drag | null>(null)
const ghost = computed(() => (drag.value?.k === 'create' ? { s: Math.min(drag.value.a, drag.value.b), e: Math.max(drag.value.a, drag.value.b) } : null))
let moved = false

function timeAt(e: PointerEvent) {
  const r = track.value!.getBoundingClientRect()
  return clamp(((e.clientX - r.left) / r.width) * props.clip.dur, 0, props.clip.dur)
}
/** 相对其他片段的可移动范围 */
function bounds(seg: Seg): [number, number] {
  const others = sorted.value.filter((x) => x.id !== seg.id)
  const lo = Math.max(0, ...others.filter((x) => x.e <= seg.s + 0.001).map((x) => x.e))
  const hi = Math.min(props.clip.dur, ...others.filter((x) => x.s >= seg.e - 0.001).map((x) => x.s))
  return [lo, hi]
}
function snap(v: number, seg?: Seg) {
  const edges = [0, props.clip.dur, ...sorted.value.filter((x) => x.id !== seg?.id).flatMap((x) => [x.s, x.e])]
  const hit = edges.find((x) => Math.abs(x - v) < SNAP)
  return hit ?? r1(v)
}
/** 在 t 处创建时，找到不与已有片段重叠的空隙 */
function gapAt(t: number): [number, number] {
  const lo = Math.max(0, ...sorted.value.filter((x) => x.e <= t).map((x) => x.e))
  const hi = Math.min(props.clip.dur, ...sorted.value.filter((x) => x.s >= t).map((x) => x.s))
  return [lo, hi]
}

function onDown(e: PointerEvent) {
  const el = e.target as HTMLElement
  moved = false
  track.value!.setPointerCapture(e.pointerId)
  const t = timeAt(e)
  const h = el.closest('[data-h]') as HTMLElement | null
  const sg = el.closest('[data-seg]') as HTMLElement | null
  if (sg && props.editable) {
    const seg = props.clip.segs.find((x) => x.id === +sg.dataset.seg!)!
    emit('select', seg.id)
    if (h) drag.value = { k: h.dataset.h as 'l' | 'r', seg }
    else drag.value = { k: 'move', seg, off: t - seg.s, len: seg.e - seg.s }
  } else if (sg) {
    emit('select', +sg.dataset.seg!); emit('update:t', t)
    drag.value = { k: 'seek' }
  } else if (props.editable && !el.closest('.ruler')) {
    drag.value = { k: 'create', a: t, b: t }
  } else { emit('update:t', t); drag.value = { k: 'seek' } }
}
function onMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  const t = timeAt(e)
  moved = true
  if (d.k === 'seek') emit('update:t', t)
  else if (d.k === 'create') {
    const [lo, hi] = gapAt(d.a)
    d.b = clamp(t, lo, hi)
  } else if (d.k === 'move') {
    const [lo, hi] = bounds(d.seg)
    const s = snap(clamp(t - d.off, lo, hi - d.len), d.seg)
    d.seg.s = clamp(s, lo, hi - d.len); d.seg.e = r1(d.seg.s + d.len)
  } else if (d.k === 'l') {
    const [lo] = bounds(d.seg)
    d.seg.s = clamp(snap(t, d.seg), lo, d.seg.e - MIN)
  } else {
    const [, hi] = bounds(d.seg)
    d.seg.e = clamp(snap(t, d.seg), d.seg.s + MIN, hi)
  }
}
function onUp(e: PointerEvent) {
  const d = drag.value
  drag.value = null
  try { track.value?.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  if (!d) return
  if (d.k === 'create') {
    const s = r1(Math.min(d.a, d.b)), en = r1(Math.max(d.a, d.b))
    if (en - s >= MIN) {
      const used = new Set(props.clip.segs.map((x) => x.n))
      const n = SUB_NAMES[props.clip.scen].find((x) => !used.has(x)) ?? SUB_NAMES[props.clip.scen][0]
      const seg: Seg = { id: newSegId(), s, e: en, n }
      props.clip.segs.push(seg); emit('select', seg.id); emit('changed')
    } else { emit('select', null); emit('update:t', d.a) }
  } else if (d.k !== 'seek' && moved) emit('changed')
}
onBeforeUnmount(() => { drag.value = null })
</script>

<template>
  <div class="tl">
    <div ref="track" class="tl-track" :class="{ edit: editable }" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
      <div class="ruler"><span v-for="k in ticks" :key="k" class="tk" :style="{ left: pct(k) + '%' }"><i />{{ k }}s</span></div>
      <div class="lane">
        <div v-for="s in sorted" :key="s.id" class="sg" :class="{ sel: selected === s.id, flag: !!s.flag }" :data-seg="s.id" :style="{ left: pct(s.s) + '%', width: pct(s.e - s.s) + '%', background: colorOf(clip.scen, s.n) }" :title="s.n + ' ' + s.s + '–' + s.e + ' s' + (s.flag ? '（审核：' + s.flag + '）' : '')">
          <i v-if="editable" class="h l" data-h="l" /><span class="nm">{{ s.n }}</span><i v-if="editable" class="h r" data-h="r" />
        </div>
        <div v-if="ghost" class="sg ghost" :style="{ left: pct(ghost.s) + '%', width: pct(ghost.e - ghost.s) + '%' }"><span class="nm">{{ (ghost.e - ghost.s).toFixed(1) }}s</span></div>
        <span v-if="!clip.segs.length && !ghost" class="empty">{{ editable ? '在此处按住鼠标左右拖动，创建子任务切片' : '暂无标注' }}</span>
      </div>
      <span class="ph" :style="{ left: pct(t) + '%' }"><b>{{ fmtT(t) }}</b></span>
    </div>
  </div>
</template>

<style scoped>
.tl-track { position: relative; user-select: none; touch-action: none; border-radius: 8px; background: var(--surface-3); padding: 0 0 8px; cursor: pointer; }
.tl-track.edit { cursor: crosshair; }
.ruler { position: relative; height: 22px; border-bottom: 1px solid var(--line); cursor: ew-resize; }
.tk { position: absolute; top: 0; font-size: 10.5px; color: var(--faint); padding-left: 4px; line-height: 20px; }
.tk i { position: absolute; left: 0; top: 14px; width: 1px; height: 8px; background: var(--line-strong); }
.lane { position: relative; height: 46px; margin: 8px 0 0; }
.sg { position: absolute; top: 0; bottom: 0; border-radius: 6px; color: #fff; display: flex; align-items: center; min-width: 4px; overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,.25) inset; cursor: grab; }
.sg .nm { flex: 1; padding: 0 9px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.sg.sel { box-shadow: 0 0 0 2px var(--text), 0 2px 8px rgba(0,0,0,.3); z-index: 2; }
.sg.flag::after { content: '!'; position: absolute; right: 6px; top: 3px; width: 15px; height: 15px; border-radius: 50%; background: var(--crit-solid); font-size: 11px; line-height: 15px; text-align: center; font-weight: 700; }
.sg.ghost { background: color-mix(in srgb, var(--accent) 45%, transparent); border: 1px dashed var(--accent); box-shadow: none; pointer-events: none; }
.h { position: absolute; top: 0; bottom: 0; width: 8px; cursor: ew-resize; background: rgba(255,255,255,.18); }
.h.l { left: 0; } .h.r { right: 0; }
.h::after { content: ''; position: absolute; top: 14px; bottom: 14px; left: 3px; width: 2px; border-radius: 1px; background: rgba(255,255,255,.8); }
.empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--faint); font-size: 12.5px; pointer-events: none; }
.ph { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--crit-solid); pointer-events: none; z-index: 3; }
.ph b { position: absolute; top: 2px; left: 5px; padding: 0 5px; border-radius: 3px; background: var(--crit-solid); color: #fff; font: 600 10.5px/16px var(--font-mono); white-space: nowrap; }
</style>
