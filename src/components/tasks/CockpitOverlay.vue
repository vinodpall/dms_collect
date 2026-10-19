<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Task } from '@/stores/tasks'
import { SCEN } from '@/constants'
import { traj } from '@/components/annotate/motion'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'

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

const session = useSession()
const isDark = computed(() => session.dark)

function handleToggleTheme() {
  session.toggleTheme()
  toast(`已切换为${session.dark ? '深色' : '浅色'}主题`)
}

// 随主题自适应的 3D 画布色彩方案
const gridColor = computed(() => (isDark.value ? '#182A40' : '#CBD5E1'))
const trajPlannedColor = computed(() => (isDark.value ? '#223E63' : '#94A3B8'))
const trajDoneColor = computed(() => (isDark.value ? '#38BDF8' : '#0284C7'))
const zAxisColor = computed(() => (isDark.value ? '#38BDF8' : '#0284C7'))
const cursorFill = computed(() => (isDark.value ? '#FFFFFF' : '#0284C7'))
const cursorGlow = computed(() => (isDark.value ? '#38BDF8' : '#0284C7'))
const frustumFill = computed(() => (isDark.value ? 'rgba(56,189,248,0.06)' : 'rgba(2,132,199,0.08)'))
const frustumStroke = computed(() => (isDark.value ? 'rgba(56,189,248,0.3)' : 'rgba(2,132,199,0.4)'))

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
      <div v-if="open" class="cockpit-root" :class="isDark ? 'theme-dark' : 'theme-light'">
        <!-- 柔和磨砂背景遮罩 -->
        <div class="cockpit-scrim" @click="emit('close')" />

        <!-- 驾驶舱主窗体 (随全局/系统主题动态响应) -->
        <div class="cockpit-deck" :class="[isDark ? 'cockpit-dark' : 'cockpit-light', { 'deck-fullscreen': isFullscreen }]">
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

              <!-- 主题切换 (浅色 / 深色，全站与右侧抽屉实时联动) -->
              <button
                type="button"
                class="icon-action-btn theme-btn"
                :title="isDark ? '当前为深色模式，点击切换为浅色主题' : '当前为浅色模式，点击切换为深色主题'"
                @click="handleToggleTheme"
              >
                <!-- 深色下显示太阳图标提示切浅色 -->
                <svg v-if="isDark" viewBox="0 0 24 24" class="svg-ic">
                  <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2" fill="none" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
                <!-- 浅色下显示月亮图标提示切深色 -->
                <svg v-else viewBox="0 0 24 24" class="svg-ic">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>

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
                    <g v-if="showGrid" :stroke="gridColor" stroke-width="0.75" opacity="0.8">
                      <line v-for="(g, i) in gridLines" :key="i" :x1="g[0][0]" :y1="g[0][1] - 20" :x2="g[1][0]" :y2="g[1][1] - 20" />
                    </g>
                    <polyline v-if="showTraj" :points="allPath" fill="none" :stroke="trajPlannedColor" stroke-width="1.5" stroke-dasharray="3 3" transform="translate(0, -20)" />
                    <polyline v-if="showTraj" :points="donePath" fill="none" :stroke="trajDoneColor" stroke-width="2.2" stroke-linejoin="round" transform="translate(0, -20)" />
                    <g v-if="showPose" transform="translate(0, -20)">
                      <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[1][0]" :y2="axis[1][1]" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round" />
                      <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[2][0]" :y2="axis[2][1]" stroke="#10B981" stroke-width="1.8" stroke-linecap="round" />
                      <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[3][0]" :y2="axis[3][1]" :stroke="zAxisColor" stroke-width="1.8" stroke-linecap="round" />
                    </g>
                    <g transform="translate(0, -20)">
                      <circle v-if="showArm" :cx="curProj[0]" :cy="curProj[1]" r="4" :fill="cursorFill" />
                      <circle v-if="showArm" :cx="curProj[0]" :cy="curProj[1]" r="10" :fill="cursorGlow" opacity="0.25" />
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
                  <g v-if="showGrid" :stroke="gridColor" stroke-width="0.75" opacity="0.8">
                    <line v-for="(g, i) in gridLinesWide" :key="i" :x1="g[0][0]" :y1="g[0][1] - 20" :x2="g[1][0]" :y2="g[1][1] - 20" />
                  </g>

                  <!-- 轨迹 -->
                  <polyline v-if="showTraj" :points="allPathWide" fill="none" :stroke="trajPlannedColor" stroke-width="1.5" stroke-dasharray="3 3" transform="translate(0, -20)" />
                  <polyline v-if="showTraj" :points="donePathWide" fill="none" :stroke="trajDoneColor" stroke-width="2.2" stroke-linejoin="round" transform="translate(0, -20)" />

                  <!-- 坐标轴 -->
                  <g v-if="showPose" transform="translate(0, -20)">
                    <line :x1="axisWide[0][0]" :y1="axisWide[0][1]" :x2="axisWide[1][0]" :y2="axisWide[1][1]" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round" />
                    <line :x1="axisWide[0][0]" :y1="axisWide[0][1]" :x2="axisWide[2][0]" :y2="axisWide[2][1]" stroke="#10B981" stroke-width="1.8" stroke-linecap="round" />
                    <line :x1="axisWide[0][0]" :y1="axisWide[0][1]" :x2="axisWide[3][0]" :y2="axisWide[3][1]" :stroke="zAxisColor" stroke-width="1.8" stroke-linecap="round" />
                    <text :x="axisWide[1][0] + 6" :y="axisWide[1][1] + 3" fill="#EF4444" font-size="9" font-family="monospace">X</text>
                    <text :x="axisWide[2][0] - 12" :y="axisWide[2][1] + 3" fill="#10B981" font-size="9" font-family="monospace">Y</text>
                    <text :x="axisWide[3][0] + 6" :y="axisWide[3][1] + 3" :fill="zAxisColor" font-size="9" font-family="monospace">Z</text>
                  </g>

                  <!-- 末端光标与视锥 -->
                  <g transform="translate(0, -20)">
                    <circle v-if="showArm" :cx="curProjWide[0]" :cy="curProjWide[1]" r="4" :fill="cursorFill" />
                    <circle v-if="showArm" :cx="curProjWide[0]" :cy="curProjWide[1]" r="10" :fill="cursorGlow" opacity="0.25" />
                    <polygon v-if="showFrustum" :points="`${curProjWide[0]},${curProjWide[1]} ${curProjWide[0]-35},${curProjWide[1]-35} ${curProjWide[0]+35},${curProjWide[1]-35}`" :fill="frustumFill" :stroke="frustumStroke" stroke-width="1" />
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
/* ========================================================
   主题变量体系：随 session.dark 实时切换（支持一键浅色/深色）
   ======================================================== */
.cockpit-root.theme-light,
.cockpit-deck.cockpit-light {
  --cp-bg: #FFFFFF;
  --cp-scrim: rgba(15, 23, 42, 0.32);
  --cp-border: #E2E8F0;
  --cp-border-subtle: #EEF2F6;
  --cp-shadow: 0 20px 48px rgba(15, 23, 42, 0.14), 0 1px 3px rgba(15, 23, 42, 0.08);
  --cp-text: #0F172A;
  --cp-text-muted: #64748B;
  --cp-text-faint: #94A3B8;
  --cp-topbar-bg: #F8FAFC;
  --cp-action-bg: #FFFFFF;
  --cp-surface-card: #FFFFFF;
  --cp-surface-subtle: #F8FAFC;
  --cp-hover-border: #93C5FD;
  --cp-accent: #0284C7;
  --cp-accent-soft: rgba(2, 132, 199, 0.09);
  --cp-btn-bg: #FFFFFF;
  --cp-btn-hover: #F1F5F9;
  --cp-btn-border: #CBD5E1;
  --cp-btn-text: #334155;
  --cp-icon-btn-bg: #F1F5F9;
  --cp-icon-btn-hover: #E2E8F0;
  --cp-icon-btn-border: #CBD5E1;
  --cp-icon-btn-color: #475569;
  --cp-switcher-bg: #F1F5F9;
  --cp-switcher-active-bg: #FFFFFF;
  --cp-switcher-active-text: #0284C7;
  --cp-switcher-active-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  --cp-canvas-bg: radial-gradient(circle at center, #F8FAFC 0%, #EEF2F6 100%);
  --cp-prog-track: #E2E8F0;
  --cp-pill-bg: #F1F5F9;
  --cp-pill-text: #475569;
  --cp-timer-bg: #F1F5F9;
  --cp-timer-border: #E2E8F0;
  --cp-btn-pause-bg: #FEF3C7;
  --cp-btn-pause-border: #FCD34D;
  --cp-btn-pause-text: #B45309;
  --cp-btn-paused-bg: #DCFCE7;
  --cp-btn-paused-border: #86EFAC;
  --cp-btn-paused-text: #15803D;
  --cp-btn-stop-bg: #FEE2E2;
  --cp-btn-stop-border: #FCA5A5;
  --cp-btn-stop-text: #B91C1C;
  --cp-btn-fail-bg: #FFE4E6;
  --cp-btn-fail-border: #FECDD3;
  --cp-btn-fail-text: #E11D48;
}

.cockpit-root.theme-dark,
.cockpit-deck.cockpit-dark {
  --cp-bg: #090E17;
  --cp-scrim: rgba(8, 12, 20, 0.45);
  --cp-border: rgba(255, 255, 255, 0.1);
  --cp-border-subtle: rgba(255, 255, 255, 0.06);
  --cp-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);
  --cp-text: #E2E8F0;
  --cp-text-muted: #94A3B8;
  --cp-text-faint: #64748B;
  --cp-topbar-bg: #0E1522;
  --cp-action-bg: #0A101A;
  --cp-surface-card: #070C15;
  --cp-surface-subtle: #0B121E;
  --cp-hover-border: rgba(56, 189, 248, 0.4);
  --cp-accent: #38BDF8;
  --cp-accent-soft: rgba(56, 189, 248, 0.14);
  --cp-btn-bg: #142032;
  --cp-btn-hover: #1B2B44;
  --cp-btn-border: rgba(255, 255, 255, 0.1);
  --cp-btn-text: #E2E8F0;
  --cp-icon-btn-bg: #131E2E;
  --cp-icon-btn-hover: #1D2D45;
  --cp-icon-btn-border: rgba(255, 255, 255, 0.08);
  --cp-icon-btn-color: #CBD5E1;
  --cp-switcher-bg: #070B12;
  --cp-switcher-active-bg: #1E2D44;
  --cp-switcher-active-text: #38BDF8;
  --cp-switcher-active-shadow: none;
  --cp-canvas-bg: radial-gradient(circle at center, #0B1626 0%, #04080F 100%);
  --cp-prog-track: #05080E;
  --cp-pill-bg: #05080E;
  --cp-pill-text: #64748B;
  --cp-timer-bg: #05080E;
  --cp-timer-border: rgba(255, 255, 255, 0.08);
  --cp-btn-pause-bg: rgba(245, 158, 11, 0.18);
  --cp-btn-pause-border: rgba(245, 158, 11, 0.4);
  --cp-btn-pause-text: #FBBF24;
  --cp-btn-paused-bg: rgba(16, 185, 129, 0.2);
  --cp-btn-paused-border: rgba(16, 185, 129, 0.4);
  --cp-btn-paused-text: #34D399;
  --cp-btn-stop-bg: rgba(239, 68, 68, 0.18);
  --cp-btn-stop-border: rgba(239, 68, 68, 0.4);
  --cp-btn-stop-text: #F87171;
  --cp-btn-fail-bg: rgba(244, 63, 94, 0.12);
  --cp-btn-fail-border: rgba(244, 63, 94, 0.3);
  --cp-btn-fail-text: #FB7185;
}

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
  background: var(--cp-scrim);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  pointer-events: auto;
  transition: background 0.2s ease;
}

/* 驾驶舱主窗体：黑曜石深色 / 现代浅色随主题切换 */
.cockpit-deck {
  pointer-events: auto;
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 14px;
  right: 14px;
  min-width: 680px;
  background: var(--cp-bg);
  border: 1px solid var(--cp-border);
  border-radius: 8px;
  box-shadow: var(--cp-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--cp-text);
  font-family: var(--font-sans);
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
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
  background: var(--cp-topbar-bg);
  border-bottom: 1px solid var(--cp-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  transition: background 0.2s ease, border-color 0.2s ease;
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
.cockpit-light .brand-dot.live {
  background: #16A34A;
  box-shadow: 0 0 6px rgba(22, 163, 74, 0.4);
}
.brand-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--cp-text);
  white-space: nowrap;
}
.task-id-tag {
  color: var(--cp-accent);
  font-size: 11px;
  font-weight: 600;
  background: var(--cp-accent-soft);
  padding: 1px 5px;
  border-radius: 3px;
}
.task-desc {
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
  color: var(--cp-text-muted);
}

.top-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stream-switcher {
  display: flex;
  background: var(--cp-switcher-bg);
  border: 1px solid var(--cp-border);
  border-radius: 4px;
  padding: 2px;
}
.switch-btn {
  background: none;
  border: none;
  color: var(--cp-text-muted);
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
}
.switch-btn.active {
  background: var(--cp-switcher-active-bg);
  color: var(--cp-switcher-active-text);
  font-weight: 600;
  box-shadow: var(--cp-switcher-active-shadow);
}

.icon-action-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--cp-icon-btn-bg);
  border: 1px solid var(--cp-icon-btn-border);
  color: var(--cp-icon-btn-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.icon-action-btn:hover {
  background: var(--cp-icon-btn-hover);
  color: var(--cp-text);
}
.icon-action-btn.theme-btn:hover {
  color: var(--cp-accent);
}
.icon-action-btn.close-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #EF4444;
}
.svg-ic {
  width: 14px;
  height: 14px;
}

/* 2. 操作与时间控制条 */
.deck-action-bar {
  height: 38px;
  padding: 0 14px;
  background: var(--cp-action-bg);
  border-bottom: 1px solid var(--cp-border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  transition: background 0.2s ease, border-color 0.2s ease;
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
.cockpit-light .status-chip.live {
  background: #DCFCE7;
  color: #15803D;
}
.status-chip.paused {
  background: rgba(245, 158, 11, 0.16);
  color: #FBBF24;
}
.cockpit-light .status-chip.paused {
  background: #FEF3C7;
  color: #B45309;
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
  color: var(--cp-text);
  background: var(--cp-timer-bg);
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--cp-timer-border);
}
.rec-txt {
  color: #EF4444;
  font-size: 9.5px;
  font-weight: 800;
}
.stream-stat {
  font-size: 11px;
  color: var(--cp-text-faint);
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
  background: var(--cp-btn-bg);
  border: 1px solid var(--cp-btn-border);
  color: var(--cp-btn-text);
  transition: all 0.15s;
}
.op-btn:hover:not(:disabled) {
  background: var(--cp-btn-hover);
  color: var(--cp-accent);
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
  background: var(--cp-btn-pause-bg);
  border-color: var(--cp-btn-pause-border);
  color: var(--cp-btn-pause-text);
}
.op-btn.pause.is-paused {
  background: var(--cp-btn-paused-bg);
  border-color: var(--cp-btn-paused-border);
  color: var(--cp-btn-paused-text);
}
.op-btn.stop {
  background: var(--cp-btn-stop-bg);
  border-color: var(--cp-btn-stop-border);
  color: var(--cp-btn-stop-text);
}
.op-btn.fail {
  background: var(--cp-btn-fail-bg);
  border-color: var(--cp-btn-fail-border);
  color: var(--cp-btn-fail-text);
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
  background: var(--cp-surface-card);
  border: 1px solid var(--cp-border);
  border-radius: 5px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.widescreen-tile:hover {
  border-color: var(--cp-hover-border);
}
.tile-header {
  height: 22px;
  padding: 0 8px;
  background: var(--cp-surface-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--cp-border-subtle);
}
.v-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--cp-text);
}
.v-tag {
  font-size: 9.5px;
  color: var(--cp-text-faint);
}

/* 严谨 16:9 横屏比例 */
.tile-media-box {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #030508;
  position: relative;
  overflow: hidden;
}
.cockpit-light .tile-media-box {
  border-top: 1px solid var(--cp-border-subtle);
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
  color: var(--cp-text);
}
.st-hint {
  font-size: 11px;
  color: var(--cp-text-faint);
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
  background: var(--cp-surface-card);
  border: 1px solid var(--cp-border);
  border-radius: 5px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.hand-telemetry-card.left-card {
  border-left: 2px solid #0284C7;
}
.cockpit-dark .hand-telemetry-card.left-card {
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
.h-sym.l { background: rgba(2, 132, 199, 0.15); color: #0284C7; }
.cockpit-dark .h-sym.l { background: rgba(56, 189, 248, 0.2); color: #38BDF8; }
.h-sym.r { background: rgba(245, 158, 11, 0.15); color: #D97706; }
.cockpit-dark .h-sym.r { background: rgba(245, 158, 11, 0.2); color: #FBBF24; }
.h-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--cp-text);
}
.h-pill {
  margin-left: auto;
  font-size: 9.5px;
  color: var(--cp-pill-text);
  background: var(--cp-pill-bg);
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
.h-row .hk {
  color: var(--cp-text-muted);
}
.h-row .hv {
  font-weight: 600;
}
.prog-track {
  height: 5px;
  background: var(--cp-prog-track);
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
  background: var(--cp-pill-bg);
  color: var(--cp-text-faint);
  padding: 2px 5px;
  border-radius: 3px;
}

/* 中间 3D 场景卡片 (与两侧手部对称) */
.scene-3d-card.middle-card {
  height: 100%;
  background: var(--cp-surface-card);
  border: 1px solid var(--cp-border);
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
  background: var(--cp-surface-card);
  border: 1px solid var(--cp-border);
  border-radius: 5px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.scene-head-bar {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  background: var(--cp-surface-subtle);
  border-bottom: 1px solid var(--cp-border-subtle);
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
  color: var(--cp-text);
}
.sh-sub {
  font-size: 10.5px;
  color: var(--cp-text-faint);
}

.sh-layer-toggles {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.toggle-lbl {
  font-size: 10.5px;
  color: var(--cp-text-faint);
}
.cb-label {
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--cp-text-muted);
  font-size: 10.5px;
  cursor: pointer;
  user-select: none;
}
.cb-input {
  accent-color: #0284C7;
  cursor: pointer;
}
.cockpit-dark .cb-input {
  accent-color: #38BDF8;
}
.cb-label.hand-toggle-chip {
  background: rgba(2, 132, 199, 0.08);
  border: 1px solid rgba(2, 132, 199, 0.25);
  padding: 1px 6px;
  border-radius: 3px;
}
.cockpit-dark .cb-label.hand-toggle-chip {
  background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.25);
}

/* 3D 画布容器：弹性充满整个卡片高度，真正做到显示到底！ */
.scene-canvas-container {
  flex: 1;
  min-height: 0;
  width: 100%;
  height: 100%;
  position: relative;
  background: var(--cp-canvas-bg);
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
  color: var(--cp-text-muted);
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
.leg-line.traj { background: #0284C7; }
.cockpit-dark .leg-line.traj { background: #38BDF8; }
.leg-line.x { background: #EF4444; }
.leg-line.y { background: #10B981; }
.leg-line.z { background: #0284C7; }
.cockpit-dark .leg-line.z { background: #38BDF8; }

.pos-compact-tag {
  color: var(--cp-text-muted);
  display: flex;
  gap: 8px;
}
.pos-compact-tag b {
  color: var(--cp-text);
}

/* 颜色辅助类 */
.text-cyan { color: #0284C7 !important; }
.cockpit-dark .text-cyan { color: #38BDF8 !important; }
.text-amber { color: #D97706 !important; }
.cockpit-dark .text-amber { color: #FBBF24 !important; }

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
