<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Task } from '@/stores/tasks'
import umiData from '@/data/umi_sample.json'

interface Props {
  task: Task
  liveT: number
  isDark: boolean
  hasHands?: boolean
  showTraj?: boolean
  showPose?: boolean
  showArm?: boolean
  showFrustum?: boolean
  showGrid?: boolean
  showHandTraj?: boolean
  follow?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  hasHands: true,
  showTraj: true,
  showPose: true,
  showArm: true,
  showFrustum: true,
  showGrid: true,
  showHandTraj: true,
  follow: false,
})

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

// 视图预设与状态
const currentViewName = ref<'iso' | 'top' | 'front' | 'side'>('iso')
const livePos = ref<[number, number, number]>([0, 0, 0])
const isInteracting = ref(false)

// Three.js 核心对象引用
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let animationFrameId: number | null = null
let resizeObserver: ResizeObserver | null = null

// 场景元素引用
let gridHelper: THREE.GridHelper | null = null
let headTrajLine: THREE.Line | null = null
let headTrajDoneLine: THREE.Line | null = null
let leftHandTrajLine: THREE.Line | null = null
let rightHandTrajLine: THREE.Line | null = null

// 动态头/手对象组合
let headGroup: THREE.Group
let headAxes: THREE.AxesHelper
let headFrustum: THREE.LineSegments
let headMarker: THREE.Mesh

let leftHandGroup: THREE.Group
let leftHandAxes: THREE.AxesHelper
let leftHandMarker: THREE.Mesh

let rightHandGroup: THREE.Group
let rightHandAxes: THREE.AxesHelper
let rightHandMarker: THREE.Mesh

// 坐标映射：将光学系 (X右, Y下, Z前) 转换到 Three.js (X右, Y上, Z深)
function cvToThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, -y, z)
}

function cvQuatToThree(qx: number, qy: number, qz: number, qw: number): THREE.Quaternion {
  // y轴取反引起坐标手系转换
  return new THREE.Quaternion(qx, -qy, qz, qw)
}

// 预计算轨迹点
const totalFrames = umiData.num_frames
const headPoints: THREE.Vector3[] = []
const leftPoints: THREE.Vector3[] = []
const rightPoints: THREE.Vector3[] = []

for (let i = 0; i < totalFrames; i++) {
  const hp = umiData.head[i]
  const lp = umiData.left[i]
  const rp = umiData.right[i]

  const hPos = cvToThree(hp[0], hp[1], hp[2])
  const hQuat = cvQuatToThree(hp[3], hp[4], hp[5], hp[6])

  // 手部局部姿态复合到头部世界系
  const lLocalPos = cvToThree(lp[0], lp[1], lp[2])
  const lWorldPos = lLocalPos.clone().applyQuaternion(hQuat).add(hPos)

  const rLocalPos = cvToThree(rp[0], rp[1], rp[2])
  const rWorldPos = rLocalPos.clone().applyQuaternion(hQuat).add(hPos)

  headPoints.push(hPos)
  leftPoints.push(lWorldPos)
  rightPoints.push(rWorldPos)
}

// 构建相机视锥体线框
function createFrustumGeometry(): THREE.BufferGeometry {
  const d = 0.18
  const { fx, fy, cx, cy, width: W, height: H } = umiData.camera_top
  // 4 个角点
  const c0 = cvToThree(((0 - cx) / fx) * d, ((0 - cy) / fy) * d, d)
  const c1 = cvToThree(((W - cx) / fx) * d, ((0 - cy) / fy) * d, d)
  const c2 = cvToThree(((W - cx) / fx) * d, ((H - cy) / fy) * d, d)
  const c3 = cvToThree(((0 - cx) / fx) * d, ((H - cy) / fy) * d, d)
  const origin = new THREE.Vector3(0, 0, 0)

  const vertices: number[] = [
    // 视点到4角
    origin.x, origin.y, origin.z, c0.x, c0.y, c0.z,
    origin.x, origin.y, origin.z, c1.x, c1.y, c1.z,
    origin.x, origin.y, origin.z, c2.x, c2.y, c2.z,
    origin.x, origin.y, origin.z, c3.x, c3.y, c3.z,
    // 矩形边框
    c0.x, c0.y, c0.z, c1.x, c1.y, c1.z,
    c1.x, c1.y, c1.z, c2.x, c2.y, c2.z,
    c2.x, c2.y, c2.z, c3.x, c3.y, c3.z,
    c3.x, c3.y, c3.z, c0.x, c0.y, c0.z,
  ]

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  return geom
}

// 初始化 3D 场景与 WebGL
function initThree() {
  if (!containerRef.value || !canvasRef.value) return

  const width = containerRef.value.clientWidth || 400
  const height = containerRef.value.clientHeight || 260

  scene = new THREE.Scene()

  camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100)
  camera.position.set(0.58, 0.45, -0.25)

  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    antialias: true,
    alpha: true,
  })
  renderer.setSize(width, height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.screenSpacePanning = true
  controls.minDistance = 0.1
  controls.maxDistance = 4.0
  controls.target.set(0, -0.05, 0.22)
  controls.update()

  controls.addEventListener('start', () => { isInteracting.value = true })
  controls.addEventListener('end', () => { isInteracting.value = false })

  // 1. 地面网格
  buildGrid()

  // 2. 世界坐标原点基准轴
  const worldOriginAxes = new THREE.AxesHelper(0.06)
  scene.add(worldOriginAxes)

  // 3. 头部轨迹线
  const headGeom = new THREE.BufferGeometry().setFromPoints(headPoints)
  const headMat = new THREE.LineBasicMaterial({
    color: props.isDark ? 0x223E63 : 0xCBD5E1,
    linewidth: 1,
    transparent: true,
    opacity: 0.6,
  })
  headTrajLine = new THREE.Line(headGeom, headMat)
  scene.add(headTrajLine)

  // 已走过的高亮头部轨迹
  const headDoneGeom = new THREE.BufferGeometry()
  const headDoneMat = new THREE.LineBasicMaterial({
    color: props.isDark ? 0x38BDF8 : 0x0284C7,
    linewidth: 2.5,
  })
  headTrajDoneLine = new THREE.Line(headDoneGeom, headDoneMat)
  scene.add(headTrajDoneLine)

  // 4. 左手手腕轨迹
  const leftGeom = new THREE.BufferGeometry().setFromPoints(leftPoints)
  const leftMat = new THREE.LineBasicMaterial({
    color: 0x0284C7,
    linewidth: 1.5,
    transparent: true,
    opacity: 0.7,
  })
  leftHandTrajLine = new THREE.Line(leftGeom, leftMat)
  scene.add(leftHandTrajLine)

  // 5. 右手手腕轨迹
  const rightGeom = new THREE.BufferGeometry().setFromPoints(rightPoints)
  const rightMat = new THREE.LineBasicMaterial({
    color: 0xF59E0B,
    linewidth: 1.5,
    transparent: true,
    opacity: 0.7,
  })
  rightHandTrajLine = new THREE.Line(rightGeom, rightMat)
  scene.add(rightHandTrajLine)

  // 6. 头部 Ego Group
  headGroup = new THREE.Group()
  headAxes = new THREE.AxesHelper(0.045)
  headGroup.add(headAxes)

  headFrustum = new THREE.LineSegments(
    createFrustumGeometry(),
    new THREE.LineBasicMaterial({
      color: props.isDark ? 0x38BDF8 : 0x0284C7,
      transparent: true,
      opacity: 0.75,
    }),
  )
  headGroup.add(headFrustum)

  headMarker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.012),
    new THREE.MeshBasicMaterial({ color: 0xFBBF24 }),
  )
  headGroup.add(headMarker)
  scene.add(headGroup)

  // 7. 左手持端 UMI Group
  leftHandGroup = new THREE.Group()
  leftHandAxes = new THREE.AxesHelper(0.035)
  leftHandGroup.add(leftHandAxes)

  leftHandMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.01, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x38BDF8 }),
  )
  leftHandGroup.add(leftHandMarker)
  scene.add(leftHandGroup)

  // 8. 右手持端 UMI Group
  rightHandGroup = new THREE.Group()
  rightHandAxes = new THREE.AxesHelper(0.035)
  rightHandGroup.add(rightHandAxes)

  rightHandMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.01, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xF59E0B }),
  )
  rightHandGroup.add(rightHandMarker)
  scene.add(rightHandGroup)

  // 启动渲染循环
  startAnimationLoop()

  // 监听容器自适应尺寸变更
  resizeObserver = new ResizeObserver(() => {
    handleResize()
  })
  resizeObserver.observe(containerRef.value)
}

// 建立/更新地面标定网格
function buildGrid() {
  if (gridHelper) {
    scene.remove(gridHelper)
    gridHelper.dispose()
    gridHelper = null
  }
  const gridCenterColor = props.isDark ? 0x223E63 : 0x94A3B8
  const gridLineColor = props.isDark ? 0x142032 : 0xE2E8F0
  gridHelper = new THREE.GridHelper(1.2, 24, gridCenterColor, gridLineColor)
  gridHelper.position.set(0, -0.22, 0.22)
  gridHelper.visible = props.showGrid
  scene.add(gridHelper)
}

function handleResize() {
  if (!containerRef.value || !renderer || !camera) return
  const w = containerRef.value.clientWidth
  const h = containerRef.value.clientHeight
  if (w === 0 || h === 0) return
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

// 逐帧更新动效
function startAnimationLoop() {
  const tick = () => {
    animationFrameId = requestAnimationFrame(tick)

    // 计算当前数据帧 (根据播放时间实时循环)
    const curFrame = Math.floor((props.liveT * 5) % totalFrames)

    const hp = umiData.head[curFrame]
    const lp = umiData.left[curFrame]
    const rp = umiData.right[curFrame]

    const hPos = cvToThree(hp[0], hp[1], hp[2])
    const hQuat = cvQuatToThree(hp[3], hp[4], hp[5], hp[6])

    // 更新头部
    headGroup.position.copy(hPos)
    headGroup.quaternion.copy(hQuat)

    // 更新左手 (世界系)
    const lLocalPos = cvToThree(lp[0], lp[1], lp[2])
    const lLocalQuat = cvQuatToThree(lp[3], lp[4], lp[5], lp[6])
    const lWorldPos = lLocalPos.clone().applyQuaternion(hQuat).add(hPos)
    const lWorldQuat = hQuat.clone().multiply(lLocalQuat)
    leftHandGroup.position.copy(lWorldPos)
    leftHandGroup.quaternion.copy(lWorldQuat)

    // 更新右手 (世界系)
    const rLocalPos = cvToThree(rp[0], rp[1], rp[2])
    const rLocalQuat = cvQuatToThree(rp[3], rp[4], rp[5], rp[6])
    const rWorldPos = rLocalPos.clone().applyQuaternion(hQuat).add(hPos)
    const rWorldQuat = hQuat.clone().multiply(rLocalQuat)
    rightHandGroup.position.copy(rWorldPos)
    rightHandGroup.quaternion.copy(rWorldQuat)

    // 暴露实时坐标读数
    livePos.value = [
      +hPos.x.toFixed(2),
      +-hPos.y.toFixed(2),
      +hPos.z.toFixed(2),
    ]

    // 高亮已走过的头部轨迹
    if (headTrajDoneLine && props.showTraj) {
      const doneSlice = headPoints.slice(0, curFrame + 1)
      if (doneSlice.length > 1) {
        headTrajDoneLine.geometry.dispose()
        headTrajDoneLine.geometry = new THREE.BufferGeometry().setFromPoints(doneSlice)
        headTrajDoneLine.visible = true
      } else {
        headTrajDoneLine.visible = false
      }
    }

    // 跟随视角
    if (props.follow && !isInteracting.value) {
      controls.target.lerp(new THREE.Vector3(0, -0.05, hPos.z), 0.05)
    }

    controls.update()
    renderer.render(scene, camera)
  }
  tick()
}

// 视角快捷控制
function resetView() {
  currentViewName.value = 'iso'
  animateCamera(new THREE.Vector3(0.58, 0.45, -0.25), new THREE.Vector3(0, -0.05, 0.22))
}

function setTopView() {
  currentViewName.value = 'top'
  animateCamera(new THREE.Vector3(0, 0.85, 0.22), new THREE.Vector3(0, -0.05, 0.22))
}

function setFrontView() {
  currentViewName.value = 'front'
  animateCamera(new THREE.Vector3(0, 0, -0.65), new THREE.Vector3(0, -0.05, 0.22))
}

function setSideView() {
  currentViewName.value = 'side'
  animateCamera(new THREE.Vector3(0.75, 0, 0.22), new THREE.Vector3(0, -0.05, 0.22))
}

function animateCamera(targetPos: THREE.Vector3, targetLookAt: THREE.Vector3) {
  if (!controls || !camera) return
  camera.position.copy(targetPos)
  controls.target.copy(targetLookAt)
  controls.update()
}

// 响应可见性与图层开关
watch(
  () => [
    props.showTraj,
    props.showPose,
    props.showArm,
    props.showFrustum,
    props.showGrid,
    props.showHandTraj,
    props.hasHands,
    props.isDark,
  ],
  () => {
    if (!scene) return
    if (gridHelper) gridHelper.visible = props.showGrid
    if (headTrajLine) headTrajLine.visible = props.showTraj
    if (headTrajDoneLine) headTrajDoneLine.visible = props.showTraj

    const handsVisible = !!props.hasHands
    if (leftHandTrajLine) leftHandTrajLine.visible = handsVisible && props.showHandTraj
    if (rightHandTrajLine) rightHandTrajLine.visible = handsVisible && props.showHandTraj

    headAxes.visible = props.showPose
    leftHandAxes.visible = handsVisible && props.showPose
    rightHandAxes.visible = handsVisible && props.showPose

    headFrustum.visible = props.showFrustum
    headMarker.visible = props.showArm

    leftHandGroup.visible = handsVisible
    rightHandGroup.visible = handsVisible

    buildGrid()
  },
  { deep: true },
)

onMounted(() => {
  initThree()
})

onBeforeUnmount(() => {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (renderer) {
    renderer.dispose()
  }
  if (controls) {
    controls.dispose()
  }
})
</script>

<template>
  <div ref="containerRef" class="scene-3d-viewport" @dblclick="resetView">
    <!-- WebGL 画布：支持鼠标原生拖动旋转、平移、缩放 -->
    <canvas ref="canvasRef" class="webgl-canvas" />

    <!-- 顶部轻量浮动视角工具条 -->
    <div class="view-preset-bar" @click.stop>
      <button
        type="button"
        class="preset-btn"
        :class="{ active: currentViewName === 'iso' }"
        title="等轴视角 (自由环绕)"
        @click="resetView"
      >
        等轴
      </button>
      <button
        type="button"
        class="preset-btn"
        :class="{ active: currentViewName === 'top' }"
        title="顶视俯瞰 (X-Y)"
        @click="setTopView"
      >
        顶视
      </button>
      <button
        type="button"
        class="preset-btn"
        :class="{ active: currentViewName === 'front' }"
        title="正前视 (X-Z)"
        @click="setFrontView"
      >
        正视
      </button>
      <button
        type="button"
        class="preset-btn"
        :class="{ active: currentViewName === 'side' }"
        title="右侧视 (Y-Z)"
        @click="setSideView"
      >
        侧视
      </button>
      <button
        type="button"
        class="preset-btn reset-btn"
        title="复位视角 (可直接双击画布快速复位)"
        @click="resetView"
      >
        <svg viewBox="0 0 24 24" class="rst-ic"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" /><path d="M3 3v5h5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
        复位
      </button>
    </div>

    <!-- 底部操作提示与实时坐标读数 -->
    <div class="scene-hud-footer mono">
      <div class="hud-tip">
        <span class="hud-ic">🖱️</span>
        <span class="hud-txt">左键旋转 · 右键平移 · 滚轮缩放 · 双击复位</span>
      </div>

      <div class="hud-pos-pill">
        <span>X: <b>{{ livePos[0] }}</b></span>
        <span>Y: <b>{{ livePos[1] }}</b></span>
        <span>Z: <b>{{ livePos[2] }}</b> m</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scene-3d-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 160px;
  overflow: hidden;
  cursor: grab;
  user-select: none;
}
.scene-3d-viewport:active {
  cursor: grabbing;
}

.webgl-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

/* 浮动视角预设按纽条 */
.view-preset-bar {
  position: absolute;
  top: 8px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 3px;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  padding: 2px;
  z-index: 5;
}
:root:not([data-theme="dark"]) .view-preset-bar {
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid #CBD5E1;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.preset-btn {
  background: transparent;
  border: none;
  font-size: 10.5px;
  font-weight: 500;
  color: #94A3B8;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 2px;
}
:root:not([data-theme="dark"]) .preset-btn {
  color: #475569;
}
.preset-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #F8FAFC;
}
:root:not([data-theme="dark"]) .preset-btn:hover {
  background: #E2E8F0;
  color: #0F172A;
}
.preset-btn.active {
  background: rgba(56, 189, 248, 0.2);
  color: #38BDF8;
  font-weight: 600;
}
:root:not([data-theme="dark"]) .preset-btn.active {
  background: #0284C7;
  color: #FFFFFF;
}
.rst-ic {
  width: 10px;
  height: 10px;
}

/* 底部 HUD 提示与读数 */
.scene-hud-footer {
  position: absolute;
  bottom: 6px;
  left: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
  font-size: 10px;
  z-index: 5;
}

.hud-tip {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #64748B;
  background: rgba(7, 12, 21, 0.6);
  padding: 1px 6px;
  border-radius: 3px;
  backdrop-filter: blur(2px);
}
:root:not([data-theme="dark"]) .hud-tip {
  color: #475569;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid #E2E8F0;
}
.hud-ic {
  font-size: 10px;
}

.hud-pos-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #94A3B8;
  background: rgba(7, 12, 21, 0.6);
  padding: 1px 7px;
  border-radius: 3px;
  backdrop-filter: blur(2px);
}
:root:not([data-theme="dark"]) .hud-pos-pill {
  color: #475569;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid #E2E8F0;
}
.hud-pos-pill b {
  color: #F8FAFC;
}
:root:not([data-theme="dark"]) .hud-pos-pill b {
  color: #0F172A;
}
</style>
