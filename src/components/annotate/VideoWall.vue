<script setup lang="ts">
import { computed } from 'vue'
import { SCEN } from '@/constants'
import type { Clip } from '@/stores/annotate'
import { CAM_NAMES, FINGERS, JOINTS, joint, traj } from './motion'

const props = defineProps<{ clip: Clip; t: number; playing: boolean }>()
const u = computed(() => (props.clip.dur ? props.t / props.clip.dur : 0))
const isVr = computed(() => SCEN[props.clip.scen].mode.includes('VR'))
const names = computed(() => CAM_NAMES[props.clip.scen])
const pos = computed(() => traj(u.value, props.clip.scen))

/* 每路相机用不同的观察角度投影末端位置 */
const cams = computed(() =>
  names.value.map((name, i) => {
    const a = (i * 52 + 20) * (Math.PI / 180)
    const [x, y, z] = pos.value
    const px = 80 + (x * Math.cos(a) - y * Math.sin(a)) * 78 + (i === 0 ? 0 : (i % 2 ? -6 : 6))
    const py = 56 - z * 70 + (x * Math.sin(a) + y * Math.cos(a)) * 14
    const bx = [14, 148, 12, 80, 80, 146][i], by = [84, 84, 84, 8, 8, 84][i]
    return { name, px: +px.toFixed(1), py: +py.toFixed(1), bx, by, shade: ['#192134', '#1B263B', '#172031', '#1D273D', '#1A2436', '#161E2F'][i] }
  }),
)

/* 世界坐标系：等轴测投影 */
const K = 150
const proj = (x: number, y: number, z: number): [number, number] => [150 + (x - y) * K * 0.5, 118 + (x + y) * K * 0.28 - z * K * 0.62]
const N = 60
const pts = computed(() => Array.from({ length: N + 1 }, (_, i) => proj(...traj(i / N, props.clip.scen))))
const done = computed(() => pts.value.slice(0, Math.max(1, Math.round(u.value * N) + 1)).map((p) => p.join(',')).join(' '))
const all = computed(() => pts.value.map((p) => p.join(',')).join(' '))
const cur = computed(() => proj(...pos.value))
const axis = [proj(0, 0, 0), proj(0.42, 0, 0), proj(0, 0.42, 0), proj(0, 0, 0.42)]
const gridLines = computed(() => {
  const out: [[number, number], [number, number]][] = []
  for (let i = -3; i <= 3; i++) { out.push([proj(-0.42, i * 0.14, 0), proj(0.42, i * 0.14, 0)]); out.push([proj(i * 0.14, -0.42, 0), proj(i * 0.14, 0.42, 0)]) }
  return out
})
const hands = computed(() => [0, 1].map((h) => ({ h, name: h ? '右手' : '左手', fingers: FINGERS.map((f, fi) => ({ f, js: JOINTS.map((j, ji) => ({ j, v: joint(u.value, h, fi, ji) })) })) })))
</script>

<template>
  <div class="wall" :class="{ vr: isVr }">
    <div v-for="(c, i) in cams" :key="i" class="cam wtile">
      <svg class="scene" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="160" height="90" :fill="c.shade" /><rect y="68" width="160" height="22" fill="#212d46" />
        <circle :cx="60 + (i % 3) * 14" cy="52" r="16" fill="none" stroke="#5C6B97" stroke-width="5" /><circle :cx="60 + (i % 3) * 14" cy="52" r="5" fill="#354260" />
        <path :d="`M${c.bx} ${c.by} L${(c.bx + c.px) / 2} ${Math.min(c.by, c.py) - 6} L${c.px} ${c.py}`" stroke="#51698A" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        <circle :cx="c.px" :cy="c.py" r="4" fill="#6E8DB3" />
      </svg>
      <div class="scan" />
      <span class="wname">{{ c.name }}</span>
    </div>

    <div class="wtile traj">
      <svg viewBox="0 0 300 200" aria-label="世界坐标系轨迹">
        <rect width="300" height="200" fill="#0D1C30" />
        <g stroke="#2F3C5A" stroke-width=".8"><line v-for="(g, i) in gridLines" :key="i" :x1="g[0][0]" :y1="g[0][1]" :x2="g[1][0]" :y2="g[1][1]" /></g>
        <polyline :points="all" fill="none" stroke="#566A97" stroke-width="1.5" stroke-dasharray="3 3" />
        <polyline :points="done" fill="none" stroke="#2ED3E6" stroke-width="2.4" stroke-linejoin="round" />
        <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[1][0]" :y2="axis[1][1]" stroke="#E5534B" stroke-width="1.6" /><line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[2][0]" :y2="axis[2][1]" stroke="#3DBB80" stroke-width="1.6" /><line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[3][0]" :y2="axis[3][1]" stroke="#4C8DF0" stroke-width="1.6" />
        <text :x="axis[1][0] + 4" :y="axis[1][1] + 4" fill="#E5534B" font-size="10">X</text><text :x="axis[2][0] - 12" :y="axis[2][1] + 4" fill="#3DBB80" font-size="10">Y</text><text :x="axis[3][0] + 4" :y="axis[3][1]" fill="#4C8DF0" font-size="10">Z</text>
        <circle :cx="cur[0]" :cy="cur[1]" r="9" fill="#2ED3E6" opacity=".25" /><circle :cx="cur[0]" :cy="cur[1]" r="4" fill="#fff" />
      </svg>
      <span class="wname">世界坐标系 · 末端轨迹</span>
      <span class="wcoord">X {{ pos[0].toFixed(2) }}  Y {{ pos[1].toFixed(2) }}  Z {{ pos[2].toFixed(2) }} m</span>
    </div>

    <template v-if="isVr">
      <div v-for="h in hands" :key="h.h" class="wtile hand">
        <div class="hname">{{ h.name }}灵巧手 · 关节角度 (°)</div>
        <div class="fg">
          <div v-for="f in h.fingers" :key="f.f" class="fing">
            <div class="bars"><span v-for="j in f.js" :key="j.j" class="bar" :title="f.f + ' ' + j.j + ' ' + j.v + '°'"><i :style="{ height: j.v + '%' }" /></span></div>
            <b>{{ f.f }}</b><small class="num">{{ f.js.map((j) => j.v).join(' / ') }}</small>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wall { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.2fr); gap: 8px; }
.wtile { position: relative; border-radius: 8px; overflow: hidden; background: #0D1C30; color: #AFC2D9; }
.wtile.cam { aspect-ratio: 16 / 9; }
.wname { position: absolute; left: 6px; top: 6px; padding: 1px 7px; border-radius: 4px; background: rgba(16,25,42,.7); color: #DCE8F6; font-size: 11px; }
.wcoord { position: absolute; left: 8px; bottom: 6px; font: 11px var(--font-mono); color: #9FB6D2; }
.traj { grid-column: 4; grid-row: 1 / span 2; min-height: 0; }
.traj svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.hand { grid-column: span 2; background: #192336; padding: 8px 10px 8px; }
.hname { font-size: 11.5px; color: #DCE8F6; margin-bottom: 6px; }
.fg { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.fing { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.fing b { font-weight: 500; font-size: 11px; color: #C5D5EA; }
.fing small { font-size: 9.5px; color: #7F95B1; white-space: nowrap; }
.bars { display: flex; gap: 3px; align-items: flex-end; height: 44px; width: 100%; justify-content: center; }
.bar { width: 9px; height: 100%; background: #293755; border-radius: 2px; display: flex; align-items: flex-end; overflow: hidden; }
.bar i { display: block; width: 100%; background: linear-gradient(180deg, #2ED3E6, #1E7F92); transition: height .1s linear; }
.vr .hand { grid-row: 3; }
.vr .hand:nth-of-type(1) { }
.vr .hand { grid-column: span 2; }
@media (max-width: 900px) { .wall { grid-template-columns: repeat(2, minmax(0, 1fr)); } .traj { grid-column: span 2; grid-row: auto; aspect-ratio: 16 / 9; } .hand { grid-column: span 2 !important; } }
</style>
