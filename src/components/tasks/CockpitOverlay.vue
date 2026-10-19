<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
// 视频流模式：'rgb_depth' (RGB三路 + Depth深度三路) 或 'all_rgb' (6路全RGB)
const streamMode = ref<'rgb_depth' | 'all_rgb'>('rgb_depth')

const isVr = computed(() => props.task.scen === 'qmd')
const isUmi = computed(() => props.task.scen === 'fhd')
const scenMeta = computed(() => SCEN[props.task.scen])

// 是否包含手部遥测：默认 UMI (fhd) 模式为 true，VR (qmd) 模式为 false；亦可手动切换
const hasHands = ref(false)
watch(
  () => props.task.scen,
  (scen) => {
    hasHands.value = scen === 'fhd'
  },
  { immediate: true },
)

// 3D 场景图层开关
const showTraj = ref(true)
const showPose = ref(true)
const showArm = ref(true)
const showFrustum = ref(true)
const showGrid = ref(true)

/* 归一化时间 [0, 1] */
const u = computed(() => (props.liveT % 20) / 20)

/* 当前末端世界坐标 [x, y, z] */
const pos = computed(() => traj(u.value, props.task.scen))

/* 时间码 */
const timeStr = computed(() => {
  const sec = Math.floor(props.liveT)
  const m = String(Math.floor(sec / 60)).padStart(2, '0')
  const s = String(sec % 60).padStart(2, '0')
  const ms = String(Math.floor((props.liveT % 1) * 10))
  return `${m}:${s}.${ms}`
})

/* 3D 轨迹计算 (中间卡片视角) */
const K = 140
function proj(x: number, y: number, z: number): [number, number] {
  return [
    160 + (x - y) * K * 0.65,
    65 + (x + y) * K * 0.28 - z * K * 0.55,
  ]
}

/* 宽屏 3D 投影计算 (满宽模式下居中投影，舒展纵深) */
function projWide(x: number, y: number, z: number): [number, number] {
  return [
    270 + (x - y) * K * 1.05,
    95 + (x + y) * K * 0.35 - z * K * 0.65,
  ]
}

const N = 50
const pts = computed(() => Array.from({ length: N + 1 }, (_, i) => proj(...traj(i / N, props.task.scen))))
const donePath = computed(() => pts.value.slice(0, Math.max(1, Math.round(u.value * N) + 1)).map((p) => p.join(',')).join(' '))
const allPath = computed(() => pts.value.map((p) => p.join(',')).join(' '))
const curProj = computed(() => proj(...pos.value))
const axis = computed(() => [
  proj(0, 0, 0),
  proj(0.35, 0, 0),
  proj(0, 0.35, 0),
  proj(0, 0, 0.35),
])
const gridLines = computed(() => {
  const out: [[number, number], [number, number]][] = []
  for (let i = -3; i <= 3; i++) {
    out.push([proj(-0.35, i * 0.12, 0), proj(0.35, i * 0.12, 0)])
    out.push([proj(i * 0.12, -0.35, 0), proj(i * 0.12, 0.35, 0)])
  }
  return out
})

/* 满宽模式轨迹 */
const ptsWide = computed(() => Array.from({ length: N + 1 }, (_, i) => projWide(...traj(i / N, props.task.scen))))
const donePathWide = computed(() => ptsWide.value.slice(0, Math.max(1, Math.round(u.value * N) + 1)).map((p) => p.join(',')).join(' '))
const allPathWide = computed(() => ptsWide.value.map((p) => p.join(',')).join(' '))
const curProjWide = computed(() => projWide(...pos.value))
const axisWide = computed(() => [
  projWide(0, 0, 0),
  projWide(0.35, 0, 0),
  projWide(0, 0.35, 0),
  projWide(0, 0, 0.35),
])
const gridLinesWide = computed(() => {
  const out: [[number, number], [number, number]][] = []
  for (let i = -3; i <= 3; i++) {
    out.push([projWide(-0.35, i * 0.12, 0), projWide(0.35, i * 0.12, 0)])
    out.push([projWide(i * 0.12, -0.35, 0), projWide(i * 0.12, 0.35, 0)])
  }
  return out
})

/* 左右手持遥测数据 */
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

/* 模拟运动位移 */
const armX = computed(() => +(80 + pos.value[0] * 60).toFixed(1))
const armY = computed(() => +(45 - pos.value[2] * 40).toFixed(1))
</script>

<template>
  <Teleport to="body">
    <Transition name="cockpit-anim">
      <div v-if="open" class="cockpit-root">
        <!-- 柔和磨砂背景遮罩 -->
        <div class="cockpit-scrim" @click="emit('close')" />

        <!-- 驾驶舱主窗体 -->
        <div class="cockpit-deck" :class="{ 'deck-fullscreen': isFullscreen }">
          <!-- 1. 顶部紧凑导航头 -->
          <header class="deck-topbar">
            <div class="top-brand">
              <span class="brand-dot" :class="{ live: task.status === 'running' }" />
              <span class="brand-title">数采作业驾驶舱 · {{ isVr ? 'VR 遥操作 (6目立体视觉)' : 'UMI 手持双臂' }}</span>
              <span class="task-id-tag mono">{{ task.id }}</span>
              <span class="task-desc muted">{{ task.name }}</span>
            </div>

            <div class="top-controls">
              <!-- 视频流模式切换 -->
              <div class="stream-switcher">
                <button
                  type="button"
                  class="switch-btn"
                  :class="{ active: streamMode === 'rgb_depth' }"
                  title="RGB彩色三路 + Depth深度三路（对标典型数采多目可视化）"
                  @click="streamMode = 'rgb_depth'"
                >
                  RGB + Depth
                </button>
                <button
                  type="button"
                  class="switch-btn"
                  :class="{ active: streamMode === 'all_rgb' }"
                  title="6路全RGB多视角"
                  @click="streamMode = 'all_rgb'"
                >
                  全路 RGB
                </button>
              </div>

              <!-- 全屏与收起 -->
              <button
                type="button"
                class="icon-action-btn"
                :title="isFullscreen ? '退出全屏' : '全屏驾驶舱'"
                @click="isFullscreen = !isFullscreen"
              >
                <svg v-if="!isFullscreen" viewBox="0 0 24 24" class="svg-ic"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
                <svg v-else viewBox="0 0 24 24" class="svg-ic"><path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>

              <button
                type="button"
                class="icon-action-btn close-btn"
                title="收起驾驶舱"
                @click="emit('close')"
              >
                <svg viewBox="0 0 24 24" class="svg-ic"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" /></svg>
              </button>
            </div>
          </header>

          <!-- 2. 操作与时间控制条 -->
          <div class="deck-action-bar">
            <div class="act-left">
              <!-- 采集状态与录制时间 -->
              <div class="status-chip" :class="task.status === 'running' ? 'live' : 'paused'">
                <span class="chip-dot" />
                <span>{{ task.status === 'running' ? 'LIVE 采集中' : 'PAUSED 已暂停' }}</span>
              </div>
              <div class="timer-chip mono">
                <span class="rec-txt">REC</span>
                <span>{{ timeStr }}</span>
              </div>
              <span class="stream-stat muted mono">30 FPS · 1080P · 0 丢包</span>
            </div>

            <!-- 控制按钮组 -->
            <div class="act-right">
              <button
                type="button"
                class="op-btn pause"
                :class="{ 'is-paused': task.status === 'paused' }"
                :disabled="!mayEdit"
                :title="dis"
                @click="task.status === 'running' ? emit('pause') : emit('resume')"
              >
                <svg v-if="task.status === 'running'" viewBox="0 0 24 24" class="btn-ic"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" /></svg>
                <svg v-else viewBox="0 0 24 24" class="btn-ic"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" /></svg>
                <span>{{ task.status === 'running' ? '暂停' : '继续' }}</span>
              </button>

              <button
                type="button"
                class="op-btn stop"
                :disabled="!mayEdit"
                :title="dis"
                @click="emit('end')"
              >
                <svg viewBox="0 0 24 24" class="btn-ic"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></svg>
                <span>结束本次</span>
              </button>

              <button
                type="button"
                class="op-btn"
                :disabled="!mayEdit"
                :title="dis"
                @click="emit('flag')"
              >
                <svg viewBox="0 0 24 24" class="btn-ic"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
                <span>标记</span>
              </button>

              <button
                type="button"
                class="op-btn"
                :disabled="!mayEdit"
                :title="dis"
                @click="emit('note')"
              >
                <svg viewBox="0 0 24 24" class="btn-ic"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
                <span>备注</span>
              </button>

              <button
                type="button"
                class="op-btn fail"
                :disabled="!mayEdit"
                :title="dis"
                @click="emit('fail')"
              >
                <svg viewBox="0 0 24 24" class="btn-ic"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none" /><line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round" /><line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
                <span>标记失败</span>
              </button>
            </div>
          </div>

          <!-- 3. 主体视口区域 -->
          <div class="deck-scroll-area">
            <!-- 模式一：RGB 三路 + Depth 深度三路 -->
            <template v-if="streamMode === 'rgb_depth'">
              <!-- 第一排：RGB 三路彩色视频 -->
              <div class="video-trio-row">
                <!-- 左侧视 -->
                <div class="widescreen-tile">
                  <div class="tile-header">
                    <span class="v-label">左侧视 RGB</span>
                    <span class="v-tag mono">CAM-02</span>
                  </div>
                  <div class="tile-media-box">
                    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                      <rect width="160" height="90" fill="#0C1420" />
                      <polygon points="10,85 150,85 130,55 30,55" fill="#132236" />
                      <circle cx="80" cy="50" r="24" fill="none" stroke="#223B5B" stroke-width="2" stroke-dasharray="4 2" />
                      <circle cx="80" cy="50" r="8" fill="#1A2D46" />
                      <line x1="20" y1="80" :x2="armX" :y2="armY" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" />
                      <circle :cx="armX" :cy="armY" r="4.5" fill="#38bdf8" />
                      <circle :cx="armX" :cy="armY" r="2" fill="#fff" />
                    </svg>
                  </div>
                </div>

                <!-- 头部第一视角 -->
                <div class="widescreen-tile">
                  <div class="tile-header">
                    <span class="v-label">头部第一视角 RGB</span>
                    <span class="v-tag mono text-cyan">CAM-01 主摄</span>
                  </div>
                  <div class="tile-media-box">
                    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                      <rect width="160" height="90" fill="#0E1826" />
                      <polygon points="15,88 145,88 125,58 35,58" fill="#16263B" />
                      <circle cx="80" cy="48" r="28" fill="none" stroke="#294569" stroke-width="1.8" />
                      <circle cx="80" cy="48" r="10" fill="#1E334E" />
                      <circle cx="80" cy="48" r="14" fill="none" stroke="rgba(56,189,248,0.5)" stroke-width="1" />
                      <line x1="80" y1="28" x2="80" y2="38" stroke="rgba(56,189,248,0.6)" stroke-width="1" />
                      <line x1="80" y1="58" x2="80" y2="68" stroke="rgba(56,189,248,0.6)" stroke-width="1" />
                      <line x1="60" y1="48" x2="70" y2="48" stroke="rgba(56,189,248,0.6)" stroke-width="1" />
                      <line x1="90" y1="48" x2="100" y2="48" stroke="rgba(56,189,248,0.6)" stroke-width="1" />
                      <circle :cx="armX" :cy="armY" r="4" fill="#38bdf8" />
                    </svg>
                  </div>
                </div>

                <!-- 右侧视 -->
                <div class="widescreen-tile">
                  <div class="tile-header">
                    <span class="v-label">右侧视 RGB</span>
                    <span class="v-tag mono">CAM-03</span>
                  </div>
                  <div class="tile-media-box">
                    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                      <rect width="160" height="90" fill="#0C1420" />
                      <polygon points="10,85 150,85 130,55 30,55" fill="#132236" />
                      <circle cx="80" cy="50" r="24" fill="none" stroke="#223B5B" stroke-width="2" stroke-dasharray="4 2" />
                      <circle cx="80" cy="50" r="8" fill="#1A2D46" />
                      <line x1="140" y1="80" :x2="armX" :y2="armY" stroke="#60a5fa" stroke-width="2.5" stroke-linecap="round" />
                      <circle :cx="armX" :cy="armY" r="4.5" fill="#60a5fa" />
                      <circle :cx="armX" :cy="armY" r="2" fill="#fff" />
                    </svg>
                  </div>
                </div>
              </div>

              <!-- 第二排：Depth 三路深度伪彩 (TURBO) -->
              <div class="section-title-bar">
                <span class="st-text">Depth 三路</span>
                <span class="st-hint muted">(TURBO 伪彩，近=蓝/远=红，黑=无效)</span>
              </div>

              <div class="video-trio-row">
                <!-- 左手 Depth -->
                <div class="widescreen-tile depth-tile">
                  <div class="tile-header">
                    <span class="v-label">左侧视 Depth</span>
                    <span class="v-tag mono">D-01</span>
                  </div>
                  <div class="tile-media-box">
                    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                      <rect width="160" height="90" fill="#040609" />
                      <ellipse cx="80" cy="54" rx="26" ry="16" fill="#1E40AF" />
                      <ellipse cx="80" cy="54" rx="18" ry="11" fill="#047857" />
                      <ellipse cx="80" cy="54" rx="10" ry="6" fill="#D97706" />
                      <circle cx="72" cy="50" r="1.5" fill="#EF4444" />
                      <circle cx="88" cy="56" r="1.5" fill="#3B82F6" />
                      <circle cx="82" cy="46" r="1.5" fill="#10B981" />
                    </svg>
                  </div>
                </div>

                <!-- 头部 Depth -->
                <div class="widescreen-tile depth-tile">
                  <div class="tile-header">
                    <span class="v-label">头部 Depth</span>
                    <span class="v-tag mono">D-02 主景</span>
                  </div>
                  <div class="tile-media-box">
                    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                      <rect width="160" height="90" fill="#040609" />
                      <polygon points="12,88 148,88 135,48 25,48" fill="#15803D" />
                      <polygon points="25,48 135,48 128,32 32,32" fill="#B91C1C" />
                      <polygon points="32,32 128,32 120,24 40,24" fill="#C2410C" />
                      <rect x="36" y="44" width="88" height="32" rx="3" fill="#22C55E" />
                      <rect x="44" y="62" width="20" height="26" rx="2" fill="#06B6D4" />
                      <rect x="96" y="62" width="20" height="26" rx="2" fill="#06B6D4" />
                      <circle cx="80" cy="56" r="12" fill="#0284C7" />
                    </svg>
                  </div>
                </div>

                <!-- 右手 Depth -->
                <div class="widescreen-tile depth-tile">
                  <div class="tile-header">
                    <span class="v-label">右侧视 Depth</span>
                    <span class="v-tag mono">D-03</span>
                  </div>
                  <div class="tile-media-box">
                    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                      <rect width="160" height="90" fill="#040609" />
                      <ellipse cx="80" cy="54" rx="26" ry="16" fill="#1E40AF" />
                      <ellipse cx="80" cy="54" rx="18" ry="11" fill="#047857" />
                      <ellipse cx="80" cy="54" rx="10" ry="6" fill="#D97706" />
                      <circle cx="76" cy="52" r="1.5" fill="#EF4444" />
                      <circle cx="84" cy="58" r="1.5" fill="#3B82F6" />
                    </svg>
                  </div>
                </div>
              </div>
            </template>

            <!-- 模式二：6 路全 RGB 视频网格 -->
            <template v-else>
              <div class="video-trio-row">
                <div v-for="c in [
                  { id: 'CAM-01', name: '头部第一视角 (主摄)' },
                  { id: 'CAM-02', name: '工件广角 (左侧视)' },
                  { id: 'CAM-03', name: '工件侧视 (右侧视)' },
                ]" :key="c.id" class="widescreen-tile">
                  <div class="tile-header">
                    <span class="v-label">{{ c.name }}</span>
                    <span class="v-tag mono">{{ c.id }}</span>
                  </div>
                  <div class="tile-media-box">
                    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                      <rect width="160" height="90" fill="#0C1522" />
                      <polygon points="15,85 145,85 125,55 35,55" fill="#132338" />
                      <circle cx="80" cy="50" r="22" fill="none" stroke="#223B5B" stroke-width="1.8" />
                      <circle :cx="armX" :cy="armY" r="4.5" fill="#38bdf8" />
                    </svg>
                  </div>
                </div>
              </div>

              <div class="video-trio-row" style="margin-top:8px">
                <div v-for="c in [
                  { id: 'CAM-04', name: '腕部末端 (左)' },
                  { id: 'CAM-05', name: '腕部末端 (右)' },
                  { id: 'CAM-06', name: '工位顶视 (全景)' },
                ]" :key="c.id" class="widescreen-tile">
                  <div class="tile-header">
                    <span class="v-label">{{ c.name }}</span>
                    <span class="v-tag mono">{{ c.id }}</span>
                  </div>
                  <div class="tile-media-box">
                    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                      <rect width="160" height="90" fill="#0A121D" />
                      <polygon points="15,85 145,85 125,55 35,55" fill="#111F32" />
                      <circle cx="80" cy="50" r="22" fill="none" stroke="#1D334E" stroke-width="1.8" />
                      <circle :cx="armX" :cy="armY" r="4" fill="#60a5fa" />
                    </svg>
                  </div>
                </div>
              </div>
            </template>

            <!-- 4. 底部：世界坐标系与手部遥测 -->
            <!-- 【情况 A】：有手部数据 -> 分左、中、右三块显示，与上方三列视频完美对称对齐！ -->
            <div v-if="hasHands" class="bottom-symmetric-trio">
              <!-- 左块：左手持端遥测 (对齐上方左侧视视频列) -->
              <div class="hand-telemetry-card left-card">
                <div class="h-head">
                  <div class="h-sym l">L</div>
                  <span class="h-name">左手持端 (Left)</span>
                  <span class="h-pill">{{ umiLeftHand.state }}</span>
                </div>
                <div class="h-body">
                  <div class="h-row">
                    <span class="hk muted">夹爪开度</span>
                    <span class="hv mono text-cyan">{{ umiLeftHand.openDist }} mm ({{ umiLeftHand.percent }}%)</span>
                  </div>
                  <div class="prog-track">
                    <div class="prog-fill l" :style="{ width: umiLeftHand.percent + '%' }" />
                  </div>
                  <div class="h-row">
                    <span class="hk muted">末端法向力</span>
                    <span class="hv mono text-cyan">{{ umiLeftHand.force }} N</span>
                  </div>
                  <div class="h-imu mono muted">Acc: [{{ umiLeftHand.acc.join(', ') }}] g</div>
                </div>
              </div>

              <!-- 中块：头部 + 空间统一 3D 场景 (对齐上方头部主摄视频列) -->
              <div class="scene-3d-card middle-card">
                <div class="scene-head-bar">
                  <div class="sh-left">
                    <span class="sh-title">世界坐标系 · 3D场景</span>
                  </div>
                  <div class="sh-layer-toggles">
                    <label class="cb-label"><input v-model="showTraj" type="checkbox" class="cb-input" /><span>轨迹</span></label>
                    <label class="cb-label"><input v-model="showPose" type="checkbox" class="cb-input" /><span>位姿</span></label>
                    <label class="cb-label"><input v-model="showGrid" type="checkbox" class="cb-input" /><span>网格</span></label>
                    <label class="cb-label hand-toggle-chip" title="切换为满宽世界坐标系">
                      <input v-model="hasHands" type="checkbox" class="cb-input" />
                      <span class="text-cyan">双手</span>
                    </label>
                  </div>
                </div>

                <div class="scene-canvas-container">
                  <svg viewBox="0 0 320 100" preserveAspectRatio="xMidYMid meet" class="scene-canvas-svg">
                    <g v-if="showGrid" stroke="#182A40" stroke-width="0.75" opacity="0.8">
                      <line v-for="(g, i) in gridLines" :key="i" :x1="g[0][0]" :y1="g[0][1] - 20" :x2="g[1][0]" :y2="g[1][1] - 20" />
                    </g>
                    <polyline v-if="showTraj" :points="allPath" fill="none" stroke="#223E63" stroke-width="1.5" stroke-dasharray="3 3" transform="translate(0, -20)" />
                    <polyline v-if="showTraj" :points="donePath" fill="none" stroke="#38BDF8" stroke-width="2.2" stroke-linejoin="round" transform="translate(0, -20)" />
                    <g v-if="showPose" transform="translate(0, -20)">
                      <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[1][0]" :y2="axis[1][1]" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round" />
                      <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[2][0]" :y2="axis[2][1]" stroke="#10B981" stroke-width="1.8" stroke-linecap="round" />
                      <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[3][0]" :y2="axis[3][1]" stroke="#38BDF8" stroke-width="1.8" stroke-linecap="round" />
                    </g>
                    <g transform="translate(0, -20)">
                      <circle v-if="showArm" :cx="curProj[0]" :cy="curProj[1]" r="4" fill="#FFFFFF" />
                      <circle v-if="showArm" :cx="curProj[0]" :cy="curProj[1]" r="10" fill="#38BDF8" opacity="0.25" />
                    </g>
                  </svg>

                  <div class="scene-legend-footer mono">
                    <span class="muted">TCP: [{{ pos[0].toFixed(2) }}, {{ pos[1].toFixed(2) }}, {{ pos[2].toFixed(2) }}] m</span>
                  </div>
                </div>
              </div>

              <!-- 右块：右手持端遥测 (对齐上方右侧视视频列) -->
              <div class="hand-telemetry-card right-card">
                <div class="h-head">
                  <div class="h-sym r">R</div>
                  <span class="h-name">右手持端 (Right)</span>
                  <span class="h-pill">{{ umiRightHand.state }}</span>
                </div>
                <div class="h-body">
                  <div class="h-row">
                    <span class="hk muted">夹爪开度</span>
                    <span class="hv mono text-amber">{{ umiRightHand.openDist }} mm ({{ umiRightHand.percent }}%)</span>
                  </div>
                  <div class="prog-track">
                    <div class="prog-fill r" :style="{ width: umiRightHand.percent + '%' }" />
                  </div>
                  <div class="h-row">
                    <span class="hk muted">末端法向力</span>
                    <span class="hv mono text-amber">{{ umiRightHand.force }} N</span>
                  </div>
                  <div class="h-imu mono muted">Acc: [{{ umiRightHand.acc.join(', ') }}] g</div>
                </div>
              </div>
            </div>

            <!-- 【情况 B】：没有手部的 -> 世界坐标系满宽通栏显示到底，绝不少一块！ -->
            <div v-else class="scene-3d-deck full-width-deck">
              <div class="scene-head-bar">
                <div class="sh-left">
                  <span class="sh-title">世界坐标系 · 3D空间轨迹跟踪</span>
                  <span class="sh-sub muted">(ISO-9283 空间基准标定)</span>
                </div>

                <div class="sh-layer-toggles">
                  <span class="toggle-lbl muted">显示</span>
                  <label class="cb-label">
                    <input v-model="showTraj" type="checkbox" class="cb-input" />
                    <span>轨迹</span>
                  </label>
                  <label class="cb-label">
                    <input v-model="showPose" type="checkbox" class="cb-input" />
                    <span>位姿轴</span>
                  </label>
                  <label class="cb-label">
                    <input v-model="showArm" type="checkbox" class="cb-input" />
                    <span>末端探头</span>
                  </label>
                  <label class="cb-label">
                    <input v-model="showFrustum" type="checkbox" class="cb-input" />
                    <span>相机视锥</span>
                  </label>
                  <label class="cb-label">
                    <input v-model="showGrid" type="checkbox" class="cb-input" />
                    <span>地面网格</span>
                  </label>
                  <label class="cb-label hand-toggle-chip" title="开启双手遥测，切换为左中右对称布局">
                    <input v-model="hasHands" type="checkbox" class="cb-input" />
                    <span class="text-cyan">手部遥测</span>
                  </label>
                </div>
              </div>

              <!-- 3D 满宽平铺画布 (自适应撑满到底) -->
              <div class="scene-canvas-container full-canvas">
                <svg viewBox="0 0 540 180" preserveAspectRatio="xMidYMid meet" class="scene-canvas-svg">
                  <!-- 地面网格 -->
                  <g v-if="showGrid" stroke="#182A40" stroke-width="0.75" opacity="0.8">
                    <line v-for="(g, i) in gridLinesWide" :key="i" :x1="g[0][0]" :y1="g[0][1] - 20" :x2="g[1][0]" :y2="g[1][1] - 20" />
                  </g>

                  <!-- 轨迹 -->
                  <polyline v-if="showTraj" :points="allPathWide" fill="none" stroke="#223E63" stroke-width="1.5" stroke-dasharray="3 3" transform="translate(0, -20)" />
                  <polyline v-if="showTraj" :points="donePathWide" fill="none" stroke="#38BDF8" stroke-width="2.2" stroke-linejoin="round" transform="translate(0, -20)" />

                  <!-- 坐标轴 -->
                  <g v-if="showPose" transform="translate(0, -20)">
                    <line :x1="axisWide[0][0]" :y1="axisWide[0][1]" :x2="axisWide[1][0]" :y2="axisWide[1][1]" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round" />
                    <line :x1="axisWide[0][0]" :y1="axisWide[0][1]" :x2="axisWide[2][0]" :y2="axisWide[2][1]" stroke="#10B981" stroke-width="1.8" stroke-linecap="round" />
                    <line :x1="axisWide[0][0]" :y1="axisWide[0][1]" :x2="axisWide[3][0]" :y2="axisWide[3][1]" stroke="#38BDF8" stroke-width="1.8" stroke-linecap="round" />
                    <text :x="axisWide[1][0] + 6" :y="axisWide[1][1] + 3" fill="#EF4444" font-size="9" font-family="monospace">X</text>
                    <text :x="axisWide[2][0] - 12" :y="axisWide[2][1] + 3" fill="#10B981" font-size="9" font-family="monospace">Y</text>
                    <text :x="axisWide[3][0] + 6" :y="axisWide[3][1] + 3" fill="#38BDF8" font-size="9" font-family="monospace">Z</text>
                  </g>

                  <!-- 末端光标与视锥 -->
                  <g transform="translate(0, -20)">
                    <circle v-if="showArm" :cx="curProjWide[0]" :cy="curProjWide[1]" r="4" fill="#FFFFFF" />
                    <circle v-if="showArm" :cx="curProjWide[0]" :cy="curProjWide[1]" r="10" fill="#38BDF8" opacity="0.25" />
                    <polygon v-if="showFrustum" :points="`${curProjWide[0]},${curProjWide[1]} ${curProjWide[0]-35},${curProjWide[1]-35} ${curProjWide[0]+35},${curProjWide[1]-35}`" fill="rgba(56,189,248,0.06)" stroke="rgba(56,189,248,0.3)" stroke-width="1" />
                  </g>
                </svg>

                <div class="scene-legend-footer mono">
                  <div class="leg-items">
                    <span class="leg-it"><span class="leg-line traj" />执行轨迹</span>
                    <span class="leg-it"><span class="leg-line x" />轴 X</span>
                    <span class="leg-it"><span class="leg-line y" />轴 Y</span>
                    <span class="leg-it"><span class="leg-line z" />轴 Z</span>
                  </div>
                  <div class="pos-compact-tag">
                    <span>X: <b>{{ pos[0].toFixed(2) }}</b></span>
                    <span>Y: <b>{{ pos[1].toFixed(2) }}</b></span>
                    <span>Z: <b>{{ pos[2].toFixed(2) }}</b> m</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 驾驶舱全屏定位容器：右侧保留 640px 给任务抽屉，协同交互 */
.cockpit-root {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  right: 640px;
  z-index: 1001;
  pointer-events: none;
}

/* 磨砂背景遮罩 */
.cockpit-scrim {
  position: absolute;
  inset: 0;
  background: rgba(8, 12, 20, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  pointer-events: auto;
}

/* 驾驶舱主窗体：黑曜石深色背景 */
.cockpit-deck {
  pointer-events: auto;
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 14px;
  right: 14px;
  min-width: 680px;
  background: #090E17;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #E2E8F0;
  font-family: var(--font-sans);
  transition: all 0.2s ease;
}

.cockpit-deck.deck-fullscreen {
  position: fixed;
  left: 8px;
  right: 8px;
  top: 8px;
  bottom: 8px;
  z-index: 1005;
}

/* 1. 顶部紧凑导航头 */
.deck-topbar {
  height: 42px;
  padding: 0 14px;
  background: #0E1522;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.top-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.brand-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #64748B;
}
.brand-dot.live {
  background: #10B981;
  box-shadow: 0 0 6px #10B981;
}
.brand-title {
  font-size: 13px;
  font-weight: 600;
  color: #F8FAFC;
  white-space: nowrap;
}
.task-id-tag {
  color: #38BDF8;
  font-size: 11px;
  font-weight: 600;
  background: rgba(56, 189, 248, 0.14);
  padding: 1px 5px;
  border-radius: 3px;
}
.task-desc {
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}

.top-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stream-switcher {
  display: flex;
  background: #070B12;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 2px;
}
.switch-btn {
  background: none;
  border: none;
  color: #94A3B8;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
}
.switch-btn.active {
  background: #1E2D44;
  color: #38BDF8;
  font-weight: 600;
}

.icon-action-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #131E2E;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #CBD5E1;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.icon-action-btn:hover {
  background: #1D2D45;
  color: #F8FAFC;
}
.icon-action-btn.close-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #F87171;
}
.svg-ic {
  width: 14px;
  height: 14px;
}

/* 2. 操作与时间控制条 */
.deck-action-bar {
  height: 38px;
  padding: 0 14px;
  background: #0A101A;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.act-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
}
.status-chip.live {
  background: rgba(16, 185, 129, 0.16);
  color: #34D399;
}
.status-chip.paused {
  background: rgba(245, 158, 11, 0.16);
  color: #FBBF24;
}
.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.timer-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 700;
  color: #F8FAFC;
  background: #05080E;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.rec-txt {
  color: #EF4444;
  font-size: 9.5px;
  font-weight: 800;
}
.stream-stat {
  font-size: 11px;
}

.act-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.op-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  background: #142032;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #E2E8F0;
  transition: all 0.15s;
}
.op-btn:hover:not(:disabled) {
  background: #1B2B44;
  color: #38BDF8;
}
.op-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn-ic {
  width: 12px;
  height: 12px;
}
.op-btn.pause {
  background: rgba(245, 158, 11, 0.18);
  border-color: rgba(245, 158, 11, 0.4);
  color: #FBBF24;
}
.op-btn.pause.is-paused {
  background: rgba(16, 185, 129, 0.2);
  border-color: rgba(16, 185, 129, 0.4);
  color: #34D399;
}
.op-btn.stop {
  background: rgba(239, 68, 68, 0.18);
  border-color: rgba(239, 68, 68, 0.4);
  color: #F87171;
}
.op-btn.fail {
  background: rgba(244, 63, 94, 0.12);
  border-color: rgba(244, 63, 94, 0.3);
  color: #FB7185;
}

/* 3. 滚动主体区域 (全宽标准 16:9 横屏) */
.deck-scroll-area {
  flex: 1;
  min-height: 0;
  padding: 10px 14px 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 一行 3 个标准 16:9 宽屏视口 */
.video-trio-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
  flex-shrink: 0;
}

.widescreen-tile {
  background: #05080F;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: border-color 0.15s;
}
.widescreen-tile:hover {
  border-color: rgba(56, 189, 248, 0.4);
}
.tile-header {
  height: 22px;
  padding: 0 8px;
  background: #0B121E;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.v-label {
  font-size: 11px;
  font-weight: 600;
  color: #CBD5E1;
}
.v-tag {
  font-size: 9.5px;
  color: #64748B;
}

/* 严谨 16:9 横屏比例 */
.tile-media-box {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #030508;
  position: relative;
  overflow: hidden;
}
.sim-cam-svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* Depth 分组标题行 */
.section-title-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 2px 0;
  flex-shrink: 0;
}
.st-text {
  font-size: 12px;
  font-weight: 600;
  color: #E2E8F0;
}
.st-hint {
  font-size: 11px;
}

/* ========================================================
   4. 底部：世界坐标系与手部遥测布局
   ======================================================== */

/* 【情况 A】有手部数据：左中右三块严格对称对齐，并自适应撑满到底部 */
.bottom-symmetric-trio {
  flex: 1;
  min-height: 190px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
}

/* 左右手持端遥测卡片 */
.hand-telemetry-card {
  height: 100%;
  background: #070C15;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.hand-telemetry-card.left-card {
  border-left: 2px solid #38BDF8;
}
.hand-telemetry-card.right-card {
  border-left: 2px solid #F59E0B;
}

.h-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.h-sym {
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
.h-sym.l { background: rgba(56, 189, 248, 0.2); color: #38BDF8; }
.h-sym.r { background: rgba(245, 158, 11, 0.2); color: #FBBF24; }
.h-name {
  font-size: 11.5px;
  font-weight: 600;
  color: #E2E8F0;
}
.h-pill {
  margin-left: auto;
  font-size: 9.5px;
  color: #64748B;
  background: #05080E;
  padding: 1px 5px;
  border-radius: 3px;
}

.h-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  gap: 4px;
  margin-top: 4px;
}
.h-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}
.h-row .hv { font-weight: 600; }
.prog-track {
  height: 5px;
  background: #05080E;
  border-radius: 3px;
  overflow: hidden;
}
.prog-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.15s ease-out;
}
.prog-fill.l { background: linear-gradient(90deg, #0284c7, #38bdf8); }
.prog-fill.r { background: linear-gradient(90deg, #d97706, #fbbf24); }
.h-imu {
  font-size: 9px;
  background: #05080E;
  padding: 2px 5px;
  border-radius: 3px;
}

/* 中间 3D 场景卡片 (与两侧手部对称) */
.scene-3d-card.middle-card {
  height: 100%;
  background: #070C15;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.scene-3d-card.middle-card .scene-canvas-container {
  flex: 1;
  min-height: 0;
  height: 100%;
}

/* 【情况 B】没有手部数据：世界坐标系满宽通栏，flex: 1 真正显示到底！ */
.scene-3d-deck.full-width-deck {
  flex: 1;
  min-height: 200px;
  width: 100%;
  background: #070C15;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.scene-head-bar {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  background: #0C1422;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sh-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sh-title {
  font-size: 11.5px;
  font-weight: 600;
  color: #E2E8F0;
}
.sh-sub {
  font-size: 10.5px;
}

.sh-layer-toggles {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.toggle-lbl {
  font-size: 10.5px;
}
.cb-label {
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  color: #CBD5E1;
  font-size: 10.5px;
  user-select: none;
}
.cb-label.hand-toggle-chip {
  background: rgba(56, 189, 248, 0.12);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid rgba(56, 189, 248, 0.25);
  margin-left: 4px;
}
.cb-input {
  accent-color: #38BDF8;
  cursor: pointer;
}

/* 3D 画布容器：弹性充满整个卡片高度，真正做到显示到底！ */
.scene-canvas-container {
  flex: 1;
  min-height: 0;
  width: 100%;
  height: 100%;
  position: relative;
  background: radial-gradient(circle at center, #0B1626 0%, #04080F 100%);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.scene-canvas-container.full-canvas {
  flex: 1;
  min-height: 0;
  height: 100%;
}
.scene-canvas-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.scene-legend-footer {
  position: absolute;
  bottom: 4px;
  left: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  color: #64748B;
  pointer-events: none;
}
.leg-items {
  display: flex;
  align-items: center;
  gap: 12px;
}
.leg-it {
  display: flex;
  align-items: center;
  gap: 4px;
}
.leg-line {
  width: 12px;
  height: 2.5px;
  border-radius: 1px;
}
.leg-line.traj { background: #38BDF8; }
.leg-line.x { background: #EF4444; }
.leg-line.y { background: #10B981; }
.leg-line.z { background: #38BDF8; }

.pos-compact-tag {
  color: #94A3B8;
  display: flex;
  gap: 8px;
}
.pos-compact-tag b {
  color: #E2E8F0;
}

/* 颜色辅助类 */
.text-cyan { color: #38BDF8 !important; }
.text-amber { color: #FBBF24 !important; }

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
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}
.cockpit-anim-enter-from .cockpit-deck {
  transform: translateX(-14px) scale(0.99);
  opacity: 0;
}
.cockpit-anim-leave-to .cockpit-deck {
  transform: translateX(-14px) scale(0.99);
  opacity: 0;
}
</style>
