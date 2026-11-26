<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { EpisodeSignals, SignalGroup, SignalSeries } from '@/api'

const props = defineProps<{
  signals: EpisodeSignals | null
  currentMs: number
  loading?: boolean
}>()

interface TrajTrack {
  key: string
  label: string
  color: string
  xs: (number | null)[]
  ys: (number | null)[]
  zs: (number | null)[]
  unit: string
}

const TRACK_COLORS = ['#2ED3E6', '#3DBB80', '#F59E0B', '#A78BFA']

function isPositionGroup(g: SignalGroup): boolean {
  const k = (g.key || '').toLowerCase()
  const l = (g.label || '').toLowerCase()
  const combined = `${k} ${l}`
  // 排除加速度、角速度、力/力矩、旋转角/四元数等非位置组
  if (/(acc|gyro|vel|force|torque|tactile|encoder|gripper|quat|euler|rot|orient|加速度|角速度|力觉|触觉|夹爪|姿态角|旋转|四元数)/i.test(combined)) {
    return false
  }
  return /(traj|pose|pos|position|xyz|轨迹|位姿|位置|坐标)/i.test(combined)
}

function findAxis(series: SignalSeries[], axis: 'x' | 'y' | 'z'): SignalSeries | undefined {
  return series.find((s) => {
    const k = (s.key || '').toLowerCase()
    const l = (s.label || '').trim().toLowerCase()
    return (
      k === axis ||
      k.endsWith('.' + axis) ||
      k.endsWith('_' + axis) ||
      k.endsWith('pos_' + axis) ||
      l === axis ||
      l === axis + '轴' ||
      l.startsWith(axis + ' ') ||
      l.startsWith(axis + '(')
    )
  })
}

const tracks = computed<TrajTrack[]>(() => {
  const groups = props.signals?.groups ?? []
  const out: TrajTrack[] = []
  for (const g of groups) {
    if (!isPositionGroup(g)) continue
    const sx = findAxis(g.series, 'x')
    const sy = findAxis(g.series, 'y')
    const sz = findAxis(g.series, 'z')
    if (!sx || !sy || !sz) continue
    out.push({
      key: g.key,
      label: g.label || g.key,
      color: TRACK_COLORS[out.length % TRACK_COLORS.length],
      xs: sx.data,
      ys: sy.data,
      zs: sz.data,
      unit: g.unit || 'm',
    })
  }
  return out
})

const currentIndex = computed(() => {
  const ts = props.signals?.t ?? []
  if (!ts.length) return 0
  let lo = 0
  let hi = ts.length - 1
  const target = props.currentMs
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ts[mid] <= target) lo = mid
    else hi = mid - 1
  }
  return lo
})

const liveCoords = computed(() => {
  const idx = currentIndex.value
  return tracks.value.map((tr) => {
    // 若当前帧为 null，向前找最近有效点
    let k = idx
    while (k >= 0 && (tr.xs[k] == null || tr.ys[k] == null || tr.zs[k] == null)) k--
    if (k < 0) return { key: tr.key, label: tr.label, color: tr.color, unit: tr.unit, x: null, y: null, z: null }
    return {
      key: tr.key,
      label: tr.label,
      color: tr.color,
      unit: tr.unit,
      x: tr.xs[k] as number,
      y: tr.ys[k] as number,
      z: tr.zs[k] as number,
    }
  })
})

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const viewMode = ref<'iso' | 'top' | 'front' | 'side'>('iso')

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let controls: OrbitControls | null = null
let resizeObs: ResizeObserver | null = null
let rafId: number | null = null

let trackGroup: THREE.Group | null = null
let sceneCenter = new THREE.Vector3(0, 0, 0)
let sceneRadius = 0.6

interface TrackRuntime {
  points: (THREE.Vector3 | null)[]
  doneLine: THREE.Line
  marker: THREE.Group
  positions: Float32Array
}
let runtimes: TrackRuntime[] = []

function toThree(x: number, y: number, z: number): THREE.Vector3 {
  // 世界坐标系 (X右, Y前, Z上) -> Three.js (X右, Y上, Z外)
  return new THREE.Vector3(x, z, -y)
}

function setCameraView(mode: 'iso' | 'top' | 'front' | 'side') {
  viewMode.value = mode
  if (!camera || !controls) return
  const d = Math.max(0.5, sceneRadius * 2.4)
  const c = sceneCenter
  if (mode === 'iso') camera.position.set(c.x + d * 0.72, c.y + d * 0.62, c.z + d * 0.72)
  else if (mode === 'top') camera.position.set(c.x, c.y + d * 1.15, c.z + 0.001)
  else if (mode === 'front') camera.position.set(c.x, c.y + d * 0.15, c.z + d * 1.1)
  else camera.position.set(c.x + d * 1.1, c.y + d * 0.15, c.z)
  controls.target.copy(c)
  controls.update()
}

function clearTracks() {
  if (!trackGroup) return
  while (trackGroup.children.length) {
    const child = trackGroup.children.pop()!
    child.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose?.()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose?.())
        else obj.material.dispose?.()
      }
    })
  }
  runtimes = []
}

function rebuildTracks() {
  if (!scene || !trackGroup) return
  clearTracks()
  if (!tracks.value.length) return

  const box = new THREE.Box3()
  let hasAny = false

  for (const tr of tracks.value) {
    const n = Math.min(tr.xs.length, tr.ys.length, tr.zs.length)
    const pts: (THREE.Vector3 | null)[] = []
    const validPts: THREE.Vector3[] = []
    for (let i = 0; i < n; i++) {
      const x = tr.xs[i]
      const y = tr.ys[i]
      const z = tr.zs[i]
      if (x != null && y != null && z != null && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        const v = toThree(x, y, z)
        pts.push(v)
        validPts.push(v)
        box.expandByPoint(v)
        hasAny = true
      } else {
        pts.push(null)
      }
    }
    if (!validPts.length) continue

    const col = new THREE.Color(tr.color)

    // 全程半透明参考轨迹
    const fullGeo = new THREE.BufferGeometry().setFromPoints(validPts)
    const fullMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.25 })
    trackGroup.add(new THREE.Line(fullGeo, fullMat))

    // 已播放轨迹（动态 drawRange）
    const positions = new Float32Array(n * 3)
    let lastValid = validPts[0]
    for (let i = 0; i < n; i++) {
      const p = pts[i] ?? lastValid
      if (pts[i]) lastValid = pts[i]!
      positions[i * 3] = p.x
      positions[i * 3 + 1] = p.y
      positions[i * 3 + 2] = p.z
    }
    const doneGeo = new THREE.BufferGeometry()
    doneGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    doneGeo.setDrawRange(0, 1)
    const doneMat = new THREE.LineBasicMaterial({ color: col })
    const doneLine = new THREE.Line(doneGeo, doneMat)
    trackGroup.add(doneLine)

    // 末端实时标记点 + 局部坐标轴
    const marker = new THREE.Group()
    const sphereGeo = new THREE.SphereGeometry(1, 16, 16)
    const sphereMat = new THREE.MeshBasicMaterial({ color: col })
    marker.add(new THREE.Mesh(sphereGeo, sphereMat))
    const haloGeo = new THREE.SphereGeometry(1.9, 16, 16)
    const haloMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22 })
    marker.add(new THREE.Mesh(haloGeo, haloMat))
    const localAxes = new THREE.AxesHelper(4.5)
    marker.add(localAxes)
    trackGroup.add(marker)

    runtimes.push({ points: pts, doneLine, marker, positions })
  }

  if (hasAny) {
    const size = new THREE.Vector3()
    box.getCenter(sceneCenter)
    box.getSize(size)
    sceneRadius = Math.max(0.25, size.length() * 0.55)

    // 动态适配网格、世界坐标轴和标记点尺寸
    const gridSize = Math.max(0.6, sceneRadius * 2.6)
    const grid = new THREE.GridHelper(gridSize, 12, 0x2ed3e6, 0x1e3350)
    grid.position.set(sceneCenter.x, box.min.y - sceneRadius * 0.05, sceneCenter.z)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.45
    trackGroup.add(grid)

    const worldAxes = new THREE.AxesHelper(sceneRadius * 0.55)
    worldAxes.position.set(sceneCenter.x - sceneRadius * 0.8, box.min.y - sceneRadius * 0.04, sceneCenter.z + sceneRadius * 0.8)
    trackGroup.add(worldAxes)

    const markerScale = Math.max(0.008, sceneRadius * 0.025)
    runtimes.forEach((rt) => rt.marker.scale.setScalar(markerScale))

    setCameraView(viewMode.value)
    updatePlayhead()
  }
}

function updatePlayhead() {
  const idx = currentIndex.value
  for (const rt of runtimes) {
    const count = Math.min(rt.points.length, Math.max(1, idx + 1))
    rt.doneLine.geometry.setDrawRange(0, count)
    const clamped = Math.min(rt.points.length - 1, Math.max(0, idx))
    rt.marker.position.set(
      rt.positions[clamped * 3],
      rt.positions[clamped * 3 + 1],
      rt.positions[clamped * 3 + 2],
    )
  }
}

function initThree() {
  if (!canvasRef.value || !containerRef.value) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x091322)

  const w = Math.max(100, containerRef.value.clientWidth)
  const h = Math.max(100, containerRef.value.clientHeight)
  camera = new THREE.PerspectiveCamera(42, w / h, 0.005, 500)
  renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(w, h, false)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08

  trackGroup = new THREE.Group()
  scene.add(trackGroup)

  rebuildTracks()

  resizeObs = new ResizeObserver(() => {
    if (!containerRef.value || !camera || !renderer) return
    const nw = Math.max(100, containerRef.value.clientWidth)
    const nh = Math.max(100, containerRef.value.clientHeight)
    camera.aspect = nw / nh
    camera.updateProjectionMatrix()
    renderer.setSize(nw, nh, false)
  })
  resizeObs.observe(containerRef.value)

  const animate = () => {
    rafId = requestAnimationFrame(animate)
    controls?.update()
    if (renderer && scene && camera) renderer.render(scene, camera)
  }
  animate()
}

watch(tracks, () => rebuildTracks())
watch(currentIndex, () => updatePlayhead())

onMounted(() => initThree())
onBeforeUnmount(() => {
  if (rafId !== null) cancelAnimationFrame(rafId)
  resizeObs?.disconnect()
  clearTracks()
  controls?.dispose()
  renderer?.dispose()
})
</script>

<template>
  <div class="w3d-card">
    <div class="w3d-head">
      <div class="row" style="gap:8px;align-items:center">
        <b>世界坐标系 · 末端轨迹</b>
        <span v-if="tracks.length" class="muted" style="font-size:11.5px">{{ tracks.length }} 条位姿轨迹</span>
      </div>
      <div v-if="tracks.length" class="w3d-views">
        <button type="button" :class="{ active: viewMode === 'iso' }" @click="setCameraView('iso')">等轴</button>
        <button type="button" :class="{ active: viewMode === 'top' }" @click="setCameraView('top')">俯视</button>
        <button type="button" :class="{ active: viewMode === 'front' }" @click="setCameraView('front')">正视</button>
        <button type="button" :class="{ active: viewMode === 'side' }" @click="setCameraView('side')">侧视</button>
      </div>
    </div>

    <div ref="containerRef" class="w3d-stage">
      <canvas v-show="tracks.length" ref="canvasRef" class="w3d-canvas" />
      <div v-if="loading && !tracks.length" class="w3d-empty">
        <a-spin size="small" />
        <span class="muted">加载位姿轨迹中…</span>
      </div>
      <div v-else-if="!tracks.length" class="w3d-empty">
        <span class="muted">当前数据暂无 3D 位姿轨迹信号</span>
      </div>

      <div v-if="tracks.length" class="w3d-overlay">
        <div v-for="c in liveCoords" :key="c.key" class="w3d-coord-row">
          <i class="w3d-dot" :style="{ background: c.color }" />
          <span class="w3d-lbl">{{ c.label }}</span>
          <span class="mono w3d-xyz">
            <template v-if="c.x !== null && c.y !== null && c.z !== null">
              X {{ c.x.toFixed(3) }} · Y {{ c.y.toFixed(3) }} · Z {{ c.z.toFixed(3) }} {{ c.unit }}
            </template>
            <template v-else>—</template>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.w3d-card {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: #091322;
  overflow: hidden;
  min-height: 260px;
}
.w3d-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--line);
  background: rgba(14, 27, 46, 0.85);
  font-size: 12.5px;
}
.w3d-views {
  display: inline-flex;
  padding: 2px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  gap: 2px;
}
.w3d-views button {
  border: 0;
  background: none;
  color: var(--muted);
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 4px;
  cursor: pointer;
}
.w3d-views button.active {
  background: rgba(46, 211, 230, 0.18);
  color: var(--accent);
  font-weight: 600;
}
.w3d-stage {
  position: relative;
  flex: 1;
  min-height: 230px;
}
.w3d-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.w3d-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12.5px;
}
.w3d-overlay {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  pointer-events: none;
}
.w3d-coord-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 5px;
  background: rgba(9, 19, 34, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.16);
  font-size: 11px;
  width: fit-content;
  max-width: 100%;
}
.w3d-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.w3d-lbl {
  color: #DCE8F6;
  white-space: nowrap;
}
.w3d-xyz {
  color: #9FB6D2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
