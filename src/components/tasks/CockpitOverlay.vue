<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Task } from '@/stores/tasks'
import { SCEN } from '@/constants'
import { traj } from '@/components/annotate/motion'

interface CockpitProps {
  task: Task
  open: boolean
  liveT: number
  mayEdit: boolean
  dis?: string
}

const props = defineProps<CockpitProps>()

interface CockpitEmits {
  (e: 'close'): void
  (e: 'pause'): void
  (e: 'resume'): void
  (e: 'end'): void
  (e: 'flag'): void
  (e: 'note'): void
  (e: 'fail'): void
}

const emit = defineEmits<CockpitEmits>()

const isFullscreen = ref(false)
const focusedCamId = ref<string | null>(null) // 单路聚焦模式：点击相机可放大特写
const viewPerspective = ref<'iso' | 'top' | 'side'>('iso')

const isVr = computed(() => props.task.scen === 'qmd')
const isUmi = computed(() => props.task.scen === 'fhd')
const scenMeta = computed(() => SCEN[props.task.scen])

/* 归一化时间 [0, 1] */
const u = computed(() => (props.liveT % 20) / 20)

/* 当前末端世界坐标 [x, y, z] */
const pos = computed(() => traj(u.value, props.task.scen))

/* 末端速度与姿态角模拟 */
const speed = computed(() => {
  if (props.task.status !== 'running') return 0
  return +(110 + 35 * Math.sin(u.value * Math.PI * 4)).toFixed(0)
})
const eulerAngles = computed(() => {
  const tVal = u.value
  return {
    roll: +(1.2 + 2.1 * Math.sin(tVal * 8)).toFixed(1),
    pitch: +(-0.8 + 1.6 * Math.cos(tVal * 6)).toFixed(1),
    yaw: +(42.5 + 4.8 * Math.sin(tVal * 5)).toFixed(1),
  }
})

/* VR 模式下的 6 路工业相机 */
const vrCams = computed(() => [
  { id: 'CAM-01', name: '第一视角 (头显RGB)', role: '主摄', res: '4K@60', bitrate: '6.4M', i: 0 },
  { id: 'CAM-02', name: '第二视角·左 (工件广角)', role: '侧视', res: '1080P@30', bitrate: '3.8M', i: 1 },
  { id: 'CAM-03', name: '第三视角·右 (工件侧视)', role: '侧视', res: '1080P@30', bitrate: '3.8M', i: 2 },
  { id: 'CAM-04', name: '腕部·左 (机械手末端)', role: '近景', res: '1080P@30', bitrate: '4.2M', i: 3 },
  { id: 'CAM-05', name: '腕部·右 (机械手末端)', role: '近景', res: '1080P@30', bitrate: '4.2M', i: 4 },
  { id: 'CAM-06', name: '俯视全景 (工位顶视)', role: '全景', res: '1080P@30', bitrate: '3.2M', i: 5 },
])

/* UMI 模式下的 4 路工业相机 */
const umiCams = computed(() => [
  { id: 'CAM-01', name: '第一视角 (双目操作)', role: '主摄', res: '4K@60', bitrate: '6.8M', i: 0 },
  { id: 'CAM-02', name: '腕部相机 (手持追踪)', role: '近景', res: '1080P@30', bitrate: '4.2M', i: 1 },
  { id: 'CAM-03', name: '侧视对准 (装配工装)', role: '侧视', res: '1080P@30', bitrate: '3.8M', i: 2 },
  { id: 'CAM-04', name: '台面俯视 (全景监控)', role: '全景', res: '1080P@30', bitrate: '3.2M', i: 3 },
])

const currentCams = computed(() => (isVr.value ? vrCams.value : umiCams.value))

/* 切换单路聚焦放大 */
function toggleFocusCam(id: string) {
  if (focusedCamId.value === id) {
    focusedCamId.value = null
  } else {
    focusedCamId.value = id
  }
}

/* 模拟各视角工业操作运动轨迹与工件渲染数据 */
function getCamMotion(i: number) {
  const a = (i * 54 + 25) * (Math.PI / 180)
  const [x, y, z] = pos.value
  const px = +(80 + (x * Math.cos(a) - y * Math.sin(a)) * 72 + (i % 2 ? -4 : 4)).toFixed(1)
  const py = +(52 - z * 64 + (x * Math.sin(a) + y * Math.cos(a)) * 14).toFixed(1)
  const bx = [14, 146, 12, 80, 80, 144][i % 6]
  const by = [80, 80, 80, 12, 12, 80][i % 6]
  const shade = ['#0C1626', '#0E1A2C', '#0A1422', '#111E32', '#0D1828', '#0B1524'][i % 6]
  return { px, py, bx, by, shade }
}

/* 3D 世界坐标系投影 (支持 ISO 轴测、TOP 顶视、SIDE 侧视 3 种视角切换) */
const K = 150
function projWithView(x: number, y: number, z: number): [number, number] {
  if (viewPerspective.value === 'top') {
    return [160 + x * K * 1.3, 110 - y * K * 1.3]
  } else if (viewPerspective.value === 'side') {
    return [160 + x * K * 1.3, 150 - z * K * 1.4]
  }
  // 默认 ISO 轴测
  return [
    160 + (x - y) * K * 0.55,
    124 + (x + y) * K * 0.28 - z * K * 0.68,
  ]
}

const N = 60
const pts = computed(() => Array.from({ length: N + 1 }, (_, i) => projWithView(...traj(i / N, props.task.scen))))
const donePath = computed(() => pts.value.slice(0, Math.max(1, Math.round(u.value * N) + 1)).map((p) => p.join(',')).join(' '))
const allPath = computed(() => pts.value.map((p) => p.join(',')).join(' '))
const curProj = computed(() => projWithView(...pos.value))
const axis = computed(() => [
  projWithView(0, 0, 0),
  projWithView(0.42, 0, 0),
  projWithView(0, 0.42, 0),
  projWithView(0, 0, 0.42),
])
const gridLines = computed(() => {
  const out: [[number, number], [number, number]][] = []
  for (let i = -3; i <= 3; i++) {
    out.push([projWithView(-0.42, i * 0.14, 0), projWithView(0.42, i * 0.14, 0)])
    out.push([projWithView(i * 0.14, -0.42, 0), projWithView(i * 0.14, 0.42, 0)])
  }
  return out
})

/* UMI 模式下的左右手遥测数据 */
const umiLeftHand = computed(() => {
  const tVal = u.value
  const openDist = +(32 + 38 * (0.5 + 0.5 * Math.sin(tVal * Math.PI * 4))).toFixed(1)
  const percent = Math.round((openDist / 70) * 100)
  const force = +(7.8 + 4.2 * Math.abs(Math.sin(tVal * Math.PI * 3 + 0.5))).toFixed(1)
  const acc = [
    +(0.03 + 0.04 * Math.sin(tVal * 12)).toFixed(2),
    +(-0.98 + 0.02 * Math.cos(tVal * 10)).toFixed(2),
    +(0.14 + 0.05 * Math.sin(tVal * 8)).toFixed(2),
  ]
  return {
    openDist,
    percent,
    force,
    acc,
    state: percent < 30 ? '闭合夹紧' : percent > 80 ? '完全展开' : '动态进给中',
  }
})

const umiRightHand = computed(() => {
  const tVal = u.value
  const openDist = +(24 + 46 * (0.5 + 0.5 * Math.cos(tVal * Math.PI * 4 + 1))).toFixed(1)
  const percent = Math.round((openDist / 70) * 100)
  const force = +(12.4 + 5.1 * Math.abs(Math.cos(tVal * Math.PI * 3))).toFixed(1)
  const acc = [
    +(-0.05 + 0.03 * Math.cos(tVal * 11)).toFixed(2),
    +(-0.97 + 0.03 * Math.sin(tVal * 9)).toFixed(2),
    +(0.21 + 0.04 * Math.cos(tVal * 7)).toFixed(2),
  ]
  return {
    openDist,
    percent,
    force,
    acc,
    state: percent < 35 ? '持握稳态' : percent > 75 ? '就位待抓' : '微调对准中',
  }
})

/* 时间码 */
const timeStr = computed(() => {
  const sec = Math.floor(props.liveT)
  const m = String(Math.floor(sec / 60)).padStart(2, '0')
  const s = String(sec % 60).padStart(2, '0')
  const ms = String(Math.floor((props.liveT % 1) * 10))
  return `${m}:${s}.${ms}`
})
</script>

<template>
  <Teleport to="body">
    <Transition name="cockpit-anim">
      <div v-if="open" class="cockpit-root">
        <!-- 柔和微磨砂背景遮罩（保持右侧抽屉区域 640px 交互透通） -->
        <div class="cockpit-scrim" @click="emit('close')" />

        <!-- 驾驶舱工作台主窗体 -->
        <div class="cockpit-deck" :class="{ 'deck-fullscreen': isFullscreen }">
          <!-- 1. 顶部 HUD 任务与状态控制台 -->
          <header class="deck-hud-header">
            <!-- 左侧：项目标志、模式标识与任务摘要 -->
            <div class="hud-left-meta">
              <div class="hud-logo-icon">
                <svg viewBox="0 0 24 24" class="svg-ic">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </div>
              <div class="hud-title-wrap">
                <div class="hud-heading">
                  <span class="hud-title-text">数采作业驾驶舱</span>
                  <span class="hud-scen-tag" :class="isVr ? 'vr-tag' : 'umi-tag'">
                    {{ isVr ? 'VR 6目立体遥操作' : 'UMI 手持双臂' }}
                  </span>
                </div>
                <div class="hud-caption">
                  <span class="mono task-id-code">{{ task.id }}</span>
                  <span class="sep-dot">·</span>
                  <span class="task-name-text">{{ task.name }}</span>
                  <span class="sep-dot">·</span>
                  <span class="scen-desc">{{ scenMeta.short }} ({{ task.devices.length }}台设备)</span>
                </div>
              </div>
            </div>

            <!-- 中间：作业状态指示与高精度时间码 -->
            <div class="hud-center-clock">
              <div class="status-indicator" :class="task.status === 'running' ? 'is-live' : task.status === 'paused' ? 'is-paused' : 'is-ready'">
                <span class="status-radar-dot" />
                <span class="status-label">
                  {{ task.status === 'running' ? 'LIVE 采集中' : task.status === 'paused' ? 'PAUSED 已暂停' : 'READY 就绪' }}
                </span>
              </div>

              <div class="master-timecode-box">
                <span class="rec-badge" :class="{ blink: task.status === 'running' }">REC</span>
                <span class="mono tc-digits">{{ timeStr }}</span>
              </div>
            </div>

            <!-- 右侧：遥测指标、布局切换与视窗操作 -->
            <div class="hud-right-actions">
              <div class="mini-kpi-bar">
                <div class="kpi-unit">
                  <span class="kpi-k">帧率</span>
                  <span class="kpi-v mono text-cyan">30 FPS</span>
                </div>
                <div class="kpi-div" />
                <div class="kpi-unit">
                  <span class="kpi-k">同步</span>
                  <span class="kpi-v mono text-emerald">1.1 ms</span>
                </div>
                <div class="kpi-div" />
                <div class="kpi-unit">
                  <span class="kpi-k">延迟</span>
                  <span class="kpi-v mono">16 ms</span>
                </div>
              </div>

              <div class="deck-controls">
                <!-- 切换单路聚焦 / 矩阵模式 -->
                <button
                  type="button"
                  class="deck-btn"
                  :class="{ active: !!focusedCamId }"
                  :title="focusedCamId ? '返回完整多目网格' : '点击相机或此按钮进行特写'"
                  @click="focusedCamId = focusedCamId ? null : currentCams[0].id"
                >
                  <svg viewBox="0 0 24 24" class="btn-ic"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></svg>
                  <span>{{ focusedCamId ? '网格视图' : '聚焦特写' }}</span>
                </button>

                <!-- 全屏切换 -->
                <button
                  type="button"
                  class="deck-btn icon-only"
                  :title="isFullscreen ? '还原视窗' : '全屏驾驶舱'"
                  @click="isFullscreen = !isFullscreen"
                >
                  <svg v-if="!isFullscreen" viewBox="0 0 24 24" class="btn-ic"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  <svg v-else viewBox="0 0 24 24" class="btn-ic"><path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>

                <!-- 收起按钮 -->
                <button
                  type="button"
                  class="deck-btn close-btn"
                  title="收起驾驶舱面板"
                  @click="emit('close')"
                >
                  <svg viewBox="0 0 24 24" class="btn-ic"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
                  <span>收起</span>
                </button>
              </div>
            </div>
          </header>

          <!-- 2. 中间主体工作视区 -->
          <main class="deck-main-body">
            <!-- ========== 模式 1: VR 6目立体遥操作架构 ========== -->
            <div v-if="isVr" class="viewport-duo">
              <!-- 左侧：工业多目视频矩阵 / 聚焦特写双模 -->
              <div class="video-panel-wrap">
                <!-- 场景 A：单路特写模式 (1 大主摄 + 底部 5 路紧凑缩略图) -->
                <div v-if="focusedCamId" class="focus-layout-box">
                  <div class="focus-main-screen">
                    <div v-for="c in [currentCams.find(x => x.id === focusedCamId) || currentCams[0]]" :key="c.id" class="cctv-tile focus-tile">
                      <!-- 视频图像 -->
                      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" class="cctv-svg">
                        <rect width="320" height="180" :fill="getCamMotion(c.i).shade" />
                        <rect y="140" width="320" height="40" fill="#152438" opacity="0.85" />
                        <!-- 背景对齐参考圆盘 -->
                        <circle cx="160" cy="100" r="42" fill="none" stroke="#254164" stroke-width="2" stroke-dasharray="6 4" />
                        <circle cx="160" cy="100" r="10" fill="#1a2d46" />
                        <!-- 机械臂/工件轨迹线 -->
                        <path :d="`M${getCamMotion(c.i).bx * 2} ${getCamMotion(c.i).by * 2} Q 160 30 ${getCamMotion(c.i).px * 2} ${getCamMotion(c.i).py * 2}`" stroke="#38bdf8" stroke-width="3" fill="none" stroke-linecap="round" />
                        <!-- 末端发光光标 -->
                        <circle :cx="getCamMotion(c.i).px * 2" :cy="getCamMotion(c.i).py * 2" r="8" fill="#38bdf8" opacity="0.3" />
                        <circle :cx="getCamMotion(c.i).px * 2" :cy="getCamMotion(c.i).py * 2" r="4.5" fill="#ffffff" />
                        <!-- 高级准心瞄准器 HUD -->
                        <circle cx="160" cy="90" r="28" fill="none" stroke="rgba(56,189,248,0.4)" stroke-width="1.2" />
                        <line x1="160" y1="52" x2="160" y2="72" stroke="rgba(56,189,248,0.5)" stroke-width="1.2" />
                        <line x1="160" y1="108" x2="160" y2="128" stroke="rgba(56,189,248,0.5)" stroke-width="1.2" />
                        <line x1="122" y1="90" x2="142" y2="90" stroke="rgba(56,189,248,0.5)" stroke-width="1.2" />
                        <line x1="178" y1="90" x2="198" y2="90" stroke="rgba(56,189,248,0.5)" stroke-width="1.2" />
                        <!-- 四角机甲标尺括号 -->
                        <path d="M8 20V8H20 M300 8H312V20 M8 160V172H20 M300 172H312V160" stroke="#38bdf8" stroke-width="1.8" fill="none" opacity="0.75" />
                        <text x="24" y="22" fill="rgba(56,189,248,0.8)" font-size="9" font-family="monospace">FOV: 110° · F/1.8 · AF-C LOCK</text>
                      </svg>

                      <!-- 顶部 OSD 栏 -->
                      <div class="cctv-osd-top">
                        <div class="osd-cam-badge">
                          <span class="cam-code">{{ c.id }}</span>
                          <span class="cam-desc">{{ c.name }}</span>
                          <span class="focused-tag">特写监视中</span>
                        </div>
                        <div class="osd-signal-box">
                          <span class="pulse-beacon" />
                          <span class="signal-txt">LIVE 60FPS</span>
                          <span class="stream-pill">{{ c.res }}</span>
                        </div>
                      </div>

                      <!-- 底部 OSD 栏 -->
                      <div class="cctv-osd-bottom">
                        <span class="sub-tag role">{{ c.role }}</span>
                        <span class="sub-tag mono">BITRATE: {{ c.bitrate }}</span>
                        <span class="sub-tag mono">EXP: 1/120s · ISO 200</span>
                      </div>
                    </div>
                  </div>

                  <!-- 底部 5 路微缩缩略图导航栏 -->
                  <div class="focus-sub-row">
                    <div
                      v-for="c in currentCams"
                      :key="c.id"
                      class="sub-thumb-card"
                      :class="{ selected: c.id === focusedCamId }"
                      @click="focusedCamId = c.id"
                    >
                      <span class="thumb-id mono">{{ c.id }}</span>
                      <span class="thumb-name">{{ c.name }}</span>
                      <span class="thumb-role">{{ c.role }}</span>
                    </div>
                  </div>
                </div>

                <!-- 场景 B：标准 6 路网格模式 (2 行 × 3 列，紧凑均匀排布) -->
                <div v-else class="matrix-grid-6">
                  <div
                    v-for="c in vrCams"
                    :key="c.id"
                    class="cctv-tile"
                    @click="toggleFocusCam(c.id)"
                  >
                    <!-- 仿真工业视频画面 -->
                    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="cctv-svg">
                      <rect width="160" height="90" :fill="getCamMotion(c.i).shade" />
                      <rect y="70" width="160" height="20" fill="#132133" opacity="0.8" />
                      <!-- 背景辅助同心圆 -->
                      <circle cx="80" cy="50" r="22" fill="none" stroke="#223b5c" stroke-width="1.8" />
                      <circle cx="80" cy="50" r="5" fill="#182c44" />
                      <!-- 运动骨架 -->
                      <path :d="`M${getCamMotion(c.i).bx} ${getCamMotion(c.i).by} L${(getCamMotion(c.i).bx + getCamMotion(c.i).px) / 2} ${Math.min(getCamMotion(c.i).by, getCamMotion(c.i).py) - 8} L${getCamMotion(c.i).px} ${getCamMotion(c.i).py}`" stroke="#38bdf8" stroke-width="2.4" fill="none" stroke-linecap="round" />
                      <!-- 末端指示点 -->
                      <circle :cx="getCamMotion(c.i).px" :cy="getCamMotion(c.i).py" r="3.8" fill="#60a5fa" />
                      <circle :cx="getCamMotion(c.i).px" :cy="getCamMotion(c.i).py" r="1.6" fill="#ffffff" />
                      <!-- 四角机甲标尺 -->
                      <path d="M4 12V4H12 M148 4H156V12 M4 78V86H12 M148 86H156V78" stroke="rgba(56,189,248,0.4)" stroke-width="1.2" fill="none" />
                    </svg>

                    <!-- 顶部浮层 OSD -->
                    <div class="cctv-osd-top">
                      <div class="osd-cam-badge">
                        <span class="cam-code">{{ c.id }}</span>
                        <span class="cam-desc">{{ c.name }}</span>
                      </div>
                      <div class="osd-signal-box">
                        <span class="pulse-beacon" />
                        <span class="stream-pill">{{ c.res }}</span>
                      </div>
                    </div>

                    <!-- 底部浮层 OSD -->
                    <div class="cctv-osd-bottom">
                      <span class="sub-tag role">{{ c.role }}</span>
                      <span class="sub-tag mono">{{ c.bitrate }}</span>
                    </div>

                    <!-- 鼠标悬浮特写提示 -->
                    <div class="tile-hover-overlay">
                      <svg viewBox="0 0 24 24" class="zoom-ic"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none" /><line x1="21" y1="21" x2="16.5" y2="16.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" /><line x1="11" y1="8" x2="11" y2="14" stroke="currentColor" stroke-width="1.8" /><line x1="8" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.8" /></svg>
                      <span>点击放大特写</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 右侧：世界坐标系 · 3D空间轨迹遥测舱 -->
              <div class="telemetry-panel-wrap">
                <!-- 头部控制栏：支持视角切换 -->
                <div class="panel-section-head">
                  <div class="head-left">
                    <span class="badge-accent">3D FRAME</span>
                    <span class="head-title">世界坐标系 · 3D空间轨迹</span>
                  </div>
                  <!-- 视角切换器 -->
                  <div class="view-switch-tabs">
                    <button type="button" class="v-tab" :class="{ active: viewPerspective === 'iso' }" @click="viewPerspective = 'iso'">轴测</button>
                    <button type="button" class="v-tab" :class="{ active: viewPerspective === 'top' }" @click="viewPerspective = 'top'">顶视</button>
                    <button type="button" class="v-tab" :class="{ active: viewPerspective === 'side' }" @click="viewPerspective = 'side'">侧视</button>
                  </div>
                </div>

                <!-- 3D 轨迹主画布 -->
                <div class="space-3d-box">
                  <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet" class="space-svg">
                    <defs>
                      <linearGradient id="trajGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#06b6d4" />
                        <stop offset="60%" stop-color="#38bdf8" />
                        <stop offset="100%" stop-color="#818cf8" />
                      </linearGradient>
                    </defs>

                    <!-- 网格参考地平面 -->
                    <g stroke="#1b314d" stroke-width="0.8" opacity="0.85">
                      <line v-for="(g, i) in gridLines" :key="i" :x1="g[0][0]" :y1="g[0][1]" :x2="g[1][0]" :y2="g[1][1]" />
                    </g>

                    <!-- 规划预定轨迹 (虚线) -->
                    <polyline :points="allPath" fill="none" stroke="#25476d" stroke-width="1.6" stroke-dasharray="4 3" />

                    <!-- 实时执行轨迹 (发光渐变实体线) -->
                    <polyline :points="donePath" fill="none" stroke="url(#trajGlow)" stroke-width="2.8" stroke-linejoin="round" />

                    <!-- 三维坐标轴 (X 红 / Y 绿 / Z 蓝) -->
                    <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[1][0]" :y2="axis[1][1]" stroke="#ef4444" stroke-width="2" stroke-linecap="round" />
                    <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[2][0]" :y2="axis[2][1]" stroke="#10b981" stroke-width="2" stroke-linecap="round" />
                    <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[3][0]" :y2="axis[3][1]" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" />

                    <text :x="axis[1][0] + 6" :y="axis[1][1] + 4" fill="#ef4444" font-size="11" font-weight="700">X</text>
                    <text :x="axis[2][0] - 14" :y="axis[2][1] + 4" fill="#10b981" font-size="11" font-weight="700">Y</text>
                    <text :x="axis[3][0] + 6" :y="axis[3][1] + 2" fill="#38bdf8" font-size="11" font-weight="700">Z</text>

                    <!-- 末端探头光标与激光环 -->
                    <circle :cx="curProj[0]" :cy="curProj[1]" r="12" fill="#38bdf8" opacity="0.22" />
                    <circle :cx="curProj[0]" :cy="curProj[1]" r="4" fill="#ffffff" />

                    <!-- 画布角尺线 -->
                    <path d="M6 14V6H14 M306 6H314V14 M6 186V194H14 M306 194H314V186" stroke="rgba(56,189,248,0.3)" stroke-width="1.2" fill="none" />
                  </svg>

                  <div class="canvas-legend mono">ISO-9283 标定 · WBF 基准系</div>
                </div>

                <!-- 6-DoF 实时空间位姿卡片 -->
                <div class="pose-metrics-card">
                  <div class="coords-trio">
                    <div class="c-box">
                      <div class="c-head"><span class="ax-tag r">X</span><span class="ax-lbl">横向位置</span></div>
                      <div class="c-body mono">
                        <span class="v">{{ pos[0] >= 0 ? '+' : '' }}{{ pos[0].toFixed(3) }}</span>
                        <span class="u">m</span>
                      </div>
                    </div>
                    <div class="c-box">
                      <div class="c-head"><span class="ax-tag g">Y</span><span class="ax-lbl">纵深位置</span></div>
                      <div class="c-body mono">
                        <span class="v">{{ pos[1] >= 0 ? '+' : '' }}{{ pos[1].toFixed(3) }}</span>
                        <span class="u">m</span>
                      </div>
                    </div>
                    <div class="c-box">
                      <div class="c-head"><span class="ax-tag b">Z</span><span class="ax-lbl">坚直高度</span></div>
                      <div class="c-body mono">
                        <span class="v">{{ pos[2] >= 0 ? '+' : '' }}{{ pos[2].toFixed(3) }}</span>
                        <span class="u">m</span>
                      </div>
                    </div>
                  </div>

                  <!-- 姿态角与末端运动状态 -->
                  <div class="euler-motion-row">
                    <div class="euler-chip">
                      <span class="ek">姿态角</span>
                      <span class="ev mono">R:{{ eulerAngles.roll }}° P:{{ eulerAngles.pitch }}° Y:{{ eulerAngles.yaw }}°</span>
                    </div>
                    <div class="euler-chip">
                      <span class="ek">线速度</span>
                      <span class="ev mono text-cyan">{{ speed }} mm/s</span>
                    </div>
                  </div>

                  <!-- 质控遥测指标 -->
                  <div class="quality-grid">
                    <div class="q-cell">
                      <span class="qk">轨迹拟合度</span>
                      <span class="qv text-emerald mono">99.8%</span>
                    </div>
                    <div class="q-cell">
                      <span class="qk">空间跟踪误差</span>
                      <span class="qv text-emerald mono">&lt; 0.28 mm</span>
                    </div>
                    <div class="q-cell">
                      <span class="qk">姿态抖动率</span>
                      <span class="qv mono">0.04°</span>
                    </div>
                    <div class="q-cell">
                      <span class="qk">数据丢包率</span>
                      <span class="qv text-emerald mono">0.00%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- ========== 模式 2: UMI 手持双臂遥操作架构 ========== -->
            <div v-else-if="isUmi" class="viewport-duo">
              <!-- 左侧：4 路工业相机网格 (2 列 × 2 行) -->
              <div class="video-panel-wrap">
                <div class="matrix-grid-4">
                  <div
                    v-for="c in umiCams"
                    :key="c.id"
                    class="cctv-tile"
                    @click="toggleFocusCam(c.id)"
                  >
                    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="cctv-svg">
                      <rect width="160" height="90" :fill="getCamMotion(c.i).shade" />
                      <rect y="70" width="160" height="20" fill="#132133" opacity="0.8" />
                      <circle cx="80" cy="50" r="20" fill="none" stroke="#223b5c" stroke-width="1.8" />
                      <path :d="`M${getCamMotion(c.i).bx} ${getCamMotion(c.i).by} L${(getCamMotion(c.i).bx + getCamMotion(c.i).px) / 2} ${Math.min(getCamMotion(c.i).by, getCamMotion(c.i).py) - 8} L${getCamMotion(c.i).px} ${getCamMotion(c.i).py}`" stroke="#38bdf8" stroke-width="2.4" fill="none" stroke-linecap="round" />
                      <circle :cx="getCamMotion(c.i).px" :cy="getCamMotion(c.i).py" r="3.8" fill="#38bdf8" />
                      <path d="M4 12V4H12 M148 4H156V12 M4 78V86H12 M148 86H156V78" stroke="rgba(56,189,248,0.4)" stroke-width="1.2" fill="none" />
                    </svg>

                    <div class="cctv-osd-top">
                      <div class="osd-cam-badge">
                        <span class="cam-code">{{ c.id }}</span>
                        <span class="cam-desc">{{ c.name }}</span>
                      </div>
                      <div class="osd-signal-box">
                        <span class="pulse-beacon" />
                        <span class="stream-pill">{{ c.res }}</span>
                      </div>
                    </div>

                    <div class="cctv-osd-bottom">
                      <span class="sub-tag role">{{ c.role }}</span>
                      <span class="sub-tag mono">{{ c.bitrate }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 右侧：UMI 空间轨迹 + 左右手双路力控遥测 -->
              <div class="telemetry-panel-wrap umi-col">
                <!-- 上半部：3D 双臂轨迹 -->
                <div class="space-3d-box umi-half-box">
                  <div class="panel-section-head mini">
                    <span class="head-title">UMI 双臂空间跟踪轨迹</span>
                    <span class="mono text-cyan" style="font-size:11px">拟合度: 99.4%</span>
                  </div>

                  <svg viewBox="0 0 320 150" preserveAspectRatio="xMidYMid meet" class="space-svg">
                    <g stroke="#1b314d" stroke-width="0.8" opacity="0.85">
                      <line v-for="(g, i) in gridLines" :key="i" :x1="g[0][0]" :y1="g[0][1]" :x2="g[1][0]" :y2="g[1][1]" />
                    </g>
                    <polyline :points="allPath" fill="none" stroke="#25476d" stroke-width="1.6" stroke-dasharray="4 3" />
                    <polyline :points="donePath" fill="none" stroke="#38bdf8" stroke-width="2.6" stroke-linejoin="round" />
                    <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[1][0]" :y2="axis[1][1]" stroke="#ef4444" stroke-width="1.8" />
                    <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[2][0]" :y2="axis[2][1]" stroke="#10b981" stroke-width="1.8" />
                    <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[3][0]" :y2="axis[3][1]" stroke="#38bdf8" stroke-width="1.8" />
                    <circle :cx="curProj[0]" :cy="curProj[1]" r="4" fill="#ffffff" />
                  </svg>

                  <div class="coords-mini-bar mono">
                    <span>X: <b class="text-rose">{{ pos[0].toFixed(2) }}</b></span>
                    <span>Y: <b class="text-emerald">{{ pos[1].toFixed(2) }}</b></span>
                    <span>Z: <b class="text-cyan">{{ pos[2].toFixed(2) }}</b> m</span>
                  </div>
                </div>

                <!-- 下半部：左右手夹爪开合与力控舱 -->
                <div class="dual-grippers-row">
                  <!-- 左手 (Left) -->
                  <div class="gripper-card">
                    <div class="g-header">
                      <div class="g-sym l">L</div>
                      <span class="g-title">左手持端 (Left)</span>
                      <span class="g-pill">{{ umiLeftHand.state }}</span>
                    </div>
                    <div class="g-body">
                      <div class="g-row">
                        <span class="gk">夹爪开度</span>
                        <span class="gv mono text-cyan">{{ umiLeftHand.openDist }} mm</span>
                      </div>
                      <div class="meter-bar">
                        <div class="meter-fill l" :style="{ width: umiLeftHand.percent + '%' }" />
                      </div>
                      <div class="g-row">
                        <span class="gk">末端法向力</span>
                        <span class="gv mono highlight">{{ umiLeftHand.force }} N</span>
                      </div>
                      <div class="g-imu mono">Acc: [{{ umiLeftHand.acc.join(', ') }}] g</div>
                    </div>
                  </div>

                  <!-- 右手 (Right) -->
                  <div class="gripper-card">
                    <div class="g-header">
                      <div class="g-sym r">R</div>
                      <span class="g-title">右手持端 (Right)</span>
                      <span class="g-pill">{{ umiRightHand.state }}</span>
                    </div>
                    <div class="g-body">
                      <div class="g-row">
                        <span class="gk">夹爪开度</span>
                        <span class="gv mono text-amber">{{ umiRightHand.openDist }} mm</span>
                      </div>
                      <div class="meter-bar">
                        <div class="meter-fill r" :style="{ width: umiRightHand.percent + '%' }" />
                      </div>
                      <div class="g-row">
                        <span class="gk">末端法向力</span>
                        <span class="gv mono highlight">{{ umiRightHand.force }} N</span>
                      </div>
                      <div class="g-imu mono">Acc: [{{ umiRightHand.acc.join(', ') }}] g</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>

          <!-- 3. 底部工业作业控制台 (告别低质 Emoji，全向量精美交互) -->
          <footer class="deck-hud-footer">
            <!-- 运行参数与实时吞吐量 -->
            <div class="footer-telemetry-left">
              <div class="param-badge">
                <svg viewBox="0 0 24 24" class="param-ic"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="2" fill="none" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="2" fill="none" /></svg>
                <span>参数指标</span>
              </div>

              <div class="param-pills-row">
                <span class="mono">30 FPS</span>
                <span class="sep">/</span>
                <span class="mono">H.265 1080P</span>
                <span class="sep">/</span>
                <span class="mono">写入 48.2 MB/s</span>
                <span class="sep">/</span>
                <span class="mono text-cyan">剩余 820 GB (78%)</span>
              </div>
            </div>

            <!-- 控制按钮群 -->
            <div class="footer-actions-right">
              <!-- 暂停 / 继续按钮 -->
              <button
                type="button"
                class="op-action-btn op-pause"
                :class="{ 'is-paused': task.status === 'paused' }"
                :disabled="!mayEdit"
                :title="dis"
                @click="task.status === 'running' ? emit('pause') : emit('resume')"
              >
                <svg v-if="task.status === 'running'" viewBox="0 0 24 24" class="btn-svg"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" /></svg>
                <svg v-else viewBox="0 0 24 24" class="btn-svg"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" /></svg>
                <span>{{ task.status === 'running' ? '暂停采集' : '继续采集' }}</span>
              </button>

              <!-- 结束采集按钮 -->
              <button
                type="button"
                class="op-action-btn op-stop"
                :disabled="!mayEdit"
                :title="dis"
                @click="emit('end')"
              >
                <svg viewBox="0 0 24 24" class="btn-svg"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" /></svg>
                <span>结束本次</span>
              </button>

              <!-- 标记异常按钮 -->
              <button
                type="button"
                class="op-action-btn op-flag"
                :disabled="!mayEdit"
                :title="dis"
                @click="emit('flag')"
              >
                <svg viewBox="0 0 24 24" class="btn-svg"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
                <span>标记</span>
              </button>

              <!-- 备注按钮 -->
              <button
                type="button"
                class="op-action-btn op-note"
                :disabled="!mayEdit"
                :title="dis"
                @click="emit('note')"
              >
                <svg viewBox="0 0 24 24" class="btn-svg"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
                <span>备注</span>
              </button>

              <!-- 废品/标记失败按钮 -->
              <button
                type="button"
                class="op-action-btn op-fail"
                :disabled="!mayEdit"
                :title="dis"
                @click="emit('fail')"
              >
                <svg viewBox="0 0 24 24" class="btn-svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" /><line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round" /><line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
                <span>标记失败</span>
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 驾驶舱全屏定位容器：右侧保留 640px 给任务抽屉，确保两边协同 */
.cockpit-root {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  right: 640px;
  z-index: 1001;
  pointer-events: none;
}

/* 磨砂背景遮罩：轻微暗化背景，让驾驶舱聚焦，质感高端 */
.cockpit-scrim {
  position: absolute;
  inset: 0;
  background: rgba(10, 16, 26, 0.42);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  pointer-events: auto;
}

/* 驾驶舱主窗体：黑曜石深空玻璃风，精细 1px 微发光边框，完美贴合工业科技感 */
.cockpit-deck {
  pointer-events: auto;
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 16px;
  right: 16px;
  min-width: 720px;
  background: #0B1320;
  border: 1px solid rgba(56, 189, 248, 0.22);
  border-radius: 12px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65), 0 2px 10px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #E2E8F0;
  font-family: var(--font-sans);
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 全屏状态 */
.cockpit-deck.deck-fullscreen {
  position: fixed;
  left: 10px;
  right: 10px;
  top: 10px;
  bottom: 10px;
  z-index: 1005;
}

/* 1. 顶部 HUD 任务与控制台 */
.deck-hud-header {
  height: 46px;
  padding: 0 14px;
  background: #0E1726;
  border-bottom: 1px solid rgba(56, 189, 248, 0.12);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}

.hud-left-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.hud-logo-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #38bdf8;
  flex-shrink: 0;
}
.hud-logo-icon .svg-ic {
  width: 16px;
  height: 16px;
}

.hud-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.hud-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1.2;
}
.hud-title-text {
  font-size: 13.5px;
  font-weight: 700;
  color: #F8FAFC;
  letter-spacing: 0.3px;
  white-space: nowrap;
}
.hud-scen-tag {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  white-space: nowrap;
}
.hud-scen-tag.vr-tag {
  background: rgba(14, 165, 233, 0.18);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.35);
}
.hud-scen-tag.umi-tag {
  background: rgba(245, 158, 11, 0.18);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.35);
}

.hud-caption {
  font-size: 11px;
  color: #94A3B8;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.task-id-code {
  color: #38bdf8;
  font-weight: 600;
}
.sep-dot {
  opacity: 0.4;
}

/* 中间时间码与状态 */
.hud-center-clock {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
}
.status-indicator.is-live {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.35);
}
.status-indicator.is-paused {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.35);
}
.status-indicator.is-ready {
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.35);
}
.status-radar-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
  animation: radarBlink 1.4s infinite;
}
@keyframes radarBlink {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.8); }
}

.master-timecode-box {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #070D16;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 3px 9px;
  border-radius: 5px;
}
.rec-badge {
  font-size: 10px;
  font-weight: 800;
  color: #ef4444;
  letter-spacing: 0.5px;
}
.rec-badge.blink {
  animation: recBlink 1s infinite alternate;
}
@keyframes recBlink {
  from { opacity: 1; }
  to { opacity: 0.2; }
}
.tc-digits {
  font-size: 14px;
  font-weight: 700;
  color: #F8FAFC;
  letter-spacing: 0.5px;
}

/* 右侧指标与操作 */
.hud-right-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.mini-kpi-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #070D16;
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 3px 10px;
  border-radius: 5px;
}
.kpi-unit {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
}
.kpi-k {
  color: #64748B;
}
.kpi-v {
  font-weight: 600;
  color: #E2E8F0;
}
.kpi-div {
  width: 1px;
  height: 12px;
  background: rgba(255, 255, 255, 0.1);
}

.deck-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.deck-btn {
  height: 28px;
  padding: 0 9px;
  border-radius: 5px;
  background: #142032;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #E2E8F0;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.deck-btn:hover {
  background: #1C2D46;
  border-color: #38bdf8;
  color: #38bdf8;
}
.deck-btn.active {
  background: rgba(56, 189, 248, 0.18);
  border-color: #38bdf8;
  color: #38bdf8;
}
.deck-btn.icon-only {
  padding: 0 7px;
}
.deck-btn.close-btn:hover {
  border-color: #f87171;
  color: #f87171;
  background: rgba(239, 68, 68, 0.15);
}
.btn-ic {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

/* 2. 中间主体工作视区 */
.deck-main-body {
  flex: 1;
  min-height: 0;
  padding: 10px 12px;
  background: #080E18;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.viewport-duo {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  height: 100%;
}

/* 左侧多目监控大区 */
.video-panel-wrap {
  flex: 1.55;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 6 路网格排布 (2 行 × 3 列) */
.matrix-grid-6 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 8px;
  height: 100%;
  width: 100%;
}

/* 4 路网格排布 (2 行 × 2 列) */
.matrix-grid-4 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 8px;
  height: 100%;
  width: 100%;
}

/* 单路聚焦模式 */
.focus-layout-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  width: 100%;
}
.focus-main-screen {
  flex: 1;
  min-height: 0;
  border-radius: 8px;
  overflow: hidden;
}
.focus-main-screen .cctv-tile {
  height: 100%;
}
.focus-sub-row {
  height: 48px;
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.sub-thumb-card {
  flex: 1;
  min-width: 0;
  background: #0E1929;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  transition: all 0.15s;
}
.sub-thumb-card:hover {
  background: #142339;
  border-color: rgba(56, 189, 248, 0.35);
}
.sub-thumb-card.selected {
  background: rgba(56, 189, 248, 0.15);
  border-color: #38bdf8;
}
.thumb-id {
  font-size: 10px;
  font-weight: 700;
  color: #38bdf8;
}
.thumb-name {
  font-size: 10.5px;
  color: #E2E8F0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.thumb-role {
  font-size: 9px;
  color: #64748B;
}

/* 工业视频视口单元 */
.cctv-tile {
  position: relative;
  border-radius: 7px;
  overflow: hidden;
  background: #08111D;
  border: 1px solid rgba(56, 189, 248, 0.18);
  box-shadow: inset 0 0 16px rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.18s ease;
}
.cctv-tile:hover {
  border-color: rgba(56, 189, 248, 0.55);
  box-shadow: inset 0 0 20px rgba(56, 189, 248, 0.15), 0 4px 12px rgba(0, 0, 0, 0.3);
}
.cctv-svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* 视频上方悬浮 OSD */
.cctv-osd-top {
  position: absolute;
  top: 5px;
  left: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
  z-index: 2;
}
.osd-cam-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(7, 13, 23, 0.82);
  backdrop-filter: blur(4px);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  max-width: 75%;
}
.cam-code {
  color: #38bdf8;
  font-size: 9.5px;
  font-weight: 700;
  font-family: var(--font-mono);
}
.cam-desc {
  color: #F1F5F9;
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.focused-tag {
  background: #38bdf8;
  color: #070D16;
  font-size: 9px;
  font-weight: 700;
  padding: 0 4px;
  border-radius: 3px;
}
.osd-signal-box {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(7, 13, 23, 0.82);
  backdrop-filter: blur(4px);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(16, 185, 129, 0.25);
}
.pulse-beacon {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 5px #10b981;
}
.signal-txt {
  font-size: 9.5px;
  font-weight: 700;
  color: #34d399;
  font-family: var(--font-mono);
}
.stream-pill {
  color: #94A3B8;
  font-size: 9px;
  font-family: var(--font-mono);
}

/* 视频下方悬浮 OSD */
.cctv-osd-bottom {
  position: absolute;
  bottom: 5px;
  left: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
  z-index: 2;
}
.sub-tag {
  background: rgba(7, 13, 23, 0.8);
  backdrop-filter: blur(4px);
  padding: 1px 5px;
  border-radius: 3px;
  color: #94A3B8;
  font-size: 9.5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.sub-tag.role {
  color: #CBD5E1;
  font-weight: 500;
  border-color: rgba(56, 189, 248, 0.2);
}

.tile-hover-overlay {
  position: absolute;
  inset: 0;
  background: rgba(8, 17, 30, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
  color: #38bdf8;
  font-size: 11.5px;
  font-weight: 600;
}
.cctv-tile:hover .tile-hover-overlay {
  opacity: 1;
}
.zoom-ic {
  width: 15px;
  height: 15px;
}

/* 右侧：世界坐标系 3D 轨迹遥测舱 */
.telemetry-panel-wrap {
  flex: 1;
  min-width: 310px;
  max-width: 420px;
  height: 100%;
  background: #0B1423;
  border: 1px solid rgba(56, 189, 248, 0.18);
  border-radius: 7px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-section-head {
  height: 32px;
  padding: 0 10px;
  background: #0E192B;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.panel-section-head.mini {
  height: 28px;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.badge-accent {
  background: rgba(56, 189, 248, 0.16);
  color: #38bdf8;
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--font-mono);
  border: 1px solid rgba(56, 189, 248, 0.3);
}
.head-title {
  font-size: 11.5px;
  font-weight: 600;
  color: #F1F5F9;
}

.view-switch-tabs {
  display: flex;
  background: #08101C;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 1px;
}
.v-tab {
  background: none;
  border: none;
  color: #94A3B8;
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
}
.v-tab.active {
  background: #1E324E;
  color: #38bdf8;
  font-weight: 600;
}

/* 3D 轨迹画布容器 */
.space-3d-box {
  flex: 1.1;
  min-height: 140px;
  position: relative;
  background: radial-gradient(circle at center, #0F1E32 0%, #07101B 100%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.space-3d-box.umi-half-box {
  flex: 1;
}
.space-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.canvas-legend {
  position: absolute;
  bottom: 5px;
  right: 8px;
  font-size: 9px;
  color: rgba(148, 163, 184, 0.5);
  pointer-events: none;
}

/* 6-DoF 实时空间位姿卡片 */
.pose-metrics-card {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #0B1423;
  flex-shrink: 0;
}

.coords-trio {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.c-box {
  background: #0F1B2C;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  padding: 4px 6px;
}
.c-head {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ax-tag {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
}
.ax-tag.r { background: #ef4444; }
.ax-tag.g { background: #10b981; }
.ax-tag.b { background: #38bdf8; }
.ax-lbl {
  font-size: 9.5px;
  color: #64748B;
}
.c-body {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 2px;
}
.c-body .v {
  font-size: 13px;
  font-weight: 700;
  color: #F8FAFC;
}
.c-body .u {
  font-size: 9px;
  color: #64748B;
}

.euler-motion-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.euler-chip {
  flex: 1;
  background: #0E1828;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  padding: 3px 6px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}
.euler-chip .ek {
  color: #64748B;
}
.euler-chip .ev {
  color: #E2E8F0;
  font-weight: 600;
}

.quality-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  padding-top: 6px;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
}
.q-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  background: #08101C;
  padding: 3px 6px;
  border-radius: 4px;
}
.qk {
  color: #64748B;
}
.qv {
  font-weight: 600;
  color: #E2E8F0;
}

/* UMI 模式右侧列 */
.telemetry-panel-wrap.umi-col {
  display: flex;
  flex-direction: column;
}
.coords-mini-bar {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 4px 8px;
  background: #0B1423;
  font-size: 10.5px;
  color: #94A3B8;
}

.dual-grippers-row {
  flex: 1;
  min-height: 130px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 8px;
}
.gripper-card {
  background: #0E1829;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.g-header {
  display: flex;
  align-items: center;
  gap: 5px;
}
.g-sym {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
}
.g-sym.l { background: rgba(56, 189, 248, 0.2); color: #38bdf8; }
.g-sym.r { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
.g-title {
  font-size: 11px;
  font-weight: 600;
  color: #E2E8F0;
}
.g-pill {
  margin-left: auto;
  font-size: 9px;
  color: #64748B;
  background: #08101C;
  padding: 1px 4px;
  border-radius: 3px;
}
.g-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.g-row {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
}
.g-row .gk { color: #64748B; }
.g-row .gv { font-weight: 600; }
.g-row .gv.highlight { color: #34d399; }
.meter-bar {
  height: 4px;
  background: #08101C;
  border-radius: 2px;
  overflow: hidden;
}
.meter-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.15s ease-out;
}
.meter-fill.l { background: linear-gradient(90deg, #0284c7, #38bdf8); }
.meter-fill.r { background: linear-gradient(90deg, #d97706, #fbbf24); }
.g-imu {
  font-size: 8.5px;
  color: #64748B;
  background: #08101C;
  padding: 2px 4px;
  border-radius: 3px;
}

/* 3. 底部工业作业控制台 */
.deck-hud-footer {
  height: 46px;
  padding: 0 14px;
  background: #0E1726;
  border-top: 1px solid rgba(56, 189, 248, 0.12);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}

.footer-telemetry-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.param-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: #94A3B8;
}
.param-ic {
  width: 14px;
  height: 14px;
  color: #38bdf8;
}
.param-pills-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: #94A3B8;
  background: #070D16;
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
}
.param-pills-row .sep {
  opacity: 0.3;
}

.footer-actions-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.op-action-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 11px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #142134;
  color: #E2E8F0;
  transition: all 0.15s ease;
}
.op-action-btn:hover:not(:disabled) {
  filter: brightness(1.15);
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.2);
}
.op-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn-svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}

/* 暂停/继续 */
.op-action-btn.op-pause {
  background: rgba(245, 158, 11, 0.18);
  border-color: rgba(245, 158, 11, 0.45);
  color: #fbbf24;
}
.op-action-btn.op-pause.is-paused {
  background: rgba(16, 185, 129, 0.2);
  border-color: rgba(16, 185, 129, 0.45);
  color: #34d399;
}

/* 结束本次采集 */
.op-action-btn.op-stop {
  background: rgba(239, 68, 68, 0.18);
  border-color: rgba(239, 68, 68, 0.4);
  color: #f87171;
}

/* 标记工况 */
.op-action-btn.op-flag {
  background: rgba(14, 165, 233, 0.18);
  border-color: rgba(56, 189, 248, 0.4);
  color: #38bdf8;
}

/* 备注 */
.op-action-btn.op-note {
  background: #142338;
  border-color: rgba(255, 255, 255, 0.15);
  color: #E2E8F0;
}

/* 标记失败 */
.op-action-btn.op-fail {
  background: rgba(244, 63, 94, 0.12);
  border-color: rgba(244, 63, 94, 0.35);
  color: #fb7185;
}

/* 字体色彩辅助类 */
.text-cyan { color: #38bdf8 !important; }
.text-emerald { color: #34d399 !important; }
.text-amber { color: #fbbf24 !important; }
.text-rose { color: #f43f5e !important; }

/* 动效过渡 */
.cockpit-anim-enter-active,
.cockpit-anim-leave-active {
  transition: opacity 0.2s ease;
}
.cockpit-anim-enter-from,
.cockpit-anim-leave-to {
  opacity: 0;
}
.cockpit-anim-enter-active .cockpit-deck,
.cockpit-anim-leave-active .cockpit-deck {
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}
.cockpit-anim-enter-from .cockpit-deck {
  transform: translateX(-16px) scale(0.99);
  opacity: 0;
}
.cockpit-anim-leave-to .cockpit-deck {
  transform: translateX(-16px) scale(0.99);
  opacity: 0;
}
</style>
