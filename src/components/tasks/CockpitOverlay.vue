<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Task } from '@/stores/tasks'
import { traj } from '@/components/annotate/motion'
import { useSession } from '@/stores/session'
import Scene3DView from '@/components/tasks/Scene3DView.vue'

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
  (e: 'rollback'): void
}

const emit = defineEmits<CockpitEmits>()

const session = useSession()

/** 实时质量反馈：超过阈值时变色提醒，并计入时间轴事件 */
const quality = computed(() => {
  const x = props.liveT
  const wob = (k: number) => 0.5 + 0.5 * Math.sin(x * k)
  const fps = x > 14 && x < 15.5 ? 23 : props.task.params.fps - (wob(1.3) > 0.85 ? 1 : 0)
  const sync = +(3 + wob(0.7) * 4 + (x > 6 && x < 7.8 ? 9 : 0)).toFixed(1)
  const base = [
    { k: '帧率', v: fps + ' fps', bad: fps < 25, rule: '≥ 25' },
    { k: '时间同步', v: sync + ' ms', bad: sync > 10, rule: '≤ 10' },
  ]
  if (props.task.mode === 'vr') {
    const drift = +(1.2 + wob(0.9) * 2.4).toFixed(1)
    const lost = x > 10.5 && x < 11.4 ? 0.6 : 0
    return [...base, { k: 'VR 漂移', v: drift + ' cm/s', bad: drift > 5, rule: '≤ 5' }, { k: '追踪丢失', v: lost + ' s', bad: lost > 0.5, rule: '≤ 0.5' }, { k: '力觉', v: (18 + wob(1.1) * 22).toFixed(0) + ' N', bad: false, rule: '≤ 80' }]
  }
  const acc = +(2.5 + wob(1.7) * 5 + (x > 16 && x < 17 ? 6 : 0)).toFixed(1)
  const occl = Math.round(8 + wob(0.5) * 30)
  return [...base, { k: '加速度', v: acc + ' m/s²', bad: acc > 10, rule: '≤ 10' }, { k: '相机遮挡', v: occl + '%', bad: occl > 50, rule: '≤ 50%' }]
})
const qualityBad = computed(() => quality.value.filter((q) => q.bad))
const marks = computed(() => props.task.session?.marks ?? [])
const isDark = computed(() => session.dark)

const isFullscreen = ref(false)

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
const showHandTraj = ref(true)
const followHead = ref(false)

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
          <!-- 1. 顶部集成控制条 (合二为一：左侧实时状态与时码，右侧操作按钮与窗口控制) -->
          <header class="deck-topbar">
            <!-- 左侧：状态与时码 -->
            <div class="topbar-left">
              <div class="status-chip" :class="task.status === 'running' ? 'live' : 'paused'">
                <span class="chip-dot" />
                <span>{{ task.status === 'running' ? 'LIVE 采集中' : 'PAUSED 已暂停' }}</span>
              </div>
              <div class="timer-chip mono">
                <span class="rec-txt">REC</span>
                <span>{{ timeStr }}</span>
              </div>
              <span class="stream-stat muted mono">{{ task.params.fps }} FPS · {{ task.params.res.toUpperCase() }} · {{ task.params.codec }} · 第 {{ (task.session?.eps ?? 0) + 1 }} 条</span>
            </div>

            <!-- 右侧：控制按钮与窗口操作 -->
            <div class="topbar-right">
              <div class="act-buttons">
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
                  :disabled="!mayEdit || !marks.length"
                  :title="marks.length ? '回退到标记「' + marks[marks.length - 1].label + '」，丢弃之后采集的数据' : '先打一个事件标记，才能回退'"
                  @click="emit('rollback')"
                >
                  <svg viewBox="0 0 24 24" class="btn-ic"><path d="M9 14L4 9l5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" /><path d="M4 9h10a6 6 0 010 12h-3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" /></svg>
                  <span>回退</span>
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

              <!-- 分隔线 -->
              <span class="top-divider" />

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
                title="收起操作预览"
                @click="emit('close')"
              >
                <svg viewBox="0 0 24 24" class="svg-ic"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" /></svg>
              </button>
            </div>
          </header>

          <!-- 实时质量反馈 -->
          <div class="q-strip" :class="{ bad: qualityBad.length }">
            <span class="q-title">{{ qualityBad.length ? '质量预警' : '实时质量' }}</span>
            <span v-for="q in quality" :key="q.k" class="q-i" :class="{ bad: q.bad }" :title="'阈值 ' + q.rule">{{ q.k }} <b class="mono">{{ q.v }}</b></span>
            <span class="q-grow" />
            <span v-if="qualityBad.length" class="q-msg">{{ qualityBad.map((q) => q.k).join('、') }}超出阈值，可点“标记”记录或“标记失败”重录</span>
            <span v-else-if="marks.length" class="q-msg muted">最近标记：{{ marks[marks.length - 1].label }}（第 {{ marks[marks.length - 1].ep + 1 }} 条）</span>
          </div>

          <!-- 2. 主体视口区域 -->
          <div class="deck-scroll-area">
            <!-- 第一排：RGB 三路彩色宽屏视频 -->
            <div class="video-trio-row">
              <!-- 左侧视 -->
              <div class="widescreen-tile">
                <div class="tile-header">
                  <span class="v-label">左侧视 RGB</span>
                  <span class="v-tag mono">CAM-02 · 1080P</span>
                </div>
                <div class="tile-media-box">
                  <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                    <rect width="160" height="90" fill="#161E31" />
                    <polygon points="8,85 152,85 132,54 28,54" fill="#202e4c" />
                    <circle cx="80" cy="50" r="24" fill="none" stroke="#354B78" stroke-width="1.8" stroke-dasharray="4 2" />
                    <circle cx="80" cy="50" r="8" fill="#293B5F" />
                    <line x1="20" y1="80" :x2="armX" :y2="armY" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round" />
                    <circle :cx="armX" :cy="armY" r="4.5" fill="#38bdf8" />
                    <circle :cx="armX" :cy="armY" r="1.8" fill="#fff" />
                    <path d="M 12 12 L 6 12 L 6 18 M 148 12 L 154 12 L 154 18 M 12 78 L 6 78 L 6 72 M 148 78 L 154 78 L 154 72" stroke="rgba(56,189,248,0.35)" stroke-width="1.2" fill="none" />
                    <text x="8" y="20" fill="rgba(56,189,248,0.7)" font-size="6.5" font-family="monospace">● L-EYE 30FPS</text>
                  </svg>
                </div>
              </div>

              <!-- 头部第一视角 (主摄) -->
              <div class="widescreen-tile main-cam-tile">
                <div class="tile-header">
                  <span class="v-label">头部第一视角 RGB</span>
                  <span class="v-tag mono text-cyan">CAM-01 · 主摄</span>
                </div>
                <div class="tile-media-box">
                  <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                    <rect width="160" height="90" fill="#192339" />
                    <polygon points="12,88 148,88 126,56 34,56" fill="#243352" />
                    <circle cx="80" cy="48" r="28" fill="none" stroke="#3e5689" stroke-width="1.8" />
                    <circle cx="80" cy="48" r="10" fill="#2F4269" />
                    <circle cx="80" cy="48" r="14" fill="none" stroke="rgba(56,189,248,0.55)" stroke-width="1" />
                    <line x1="80" y1="28" x2="80" y2="38" stroke="rgba(56,189,248,0.65)" stroke-width="1" />
                    <line x1="80" y1="58" x2="80" y2="68" stroke="rgba(56,189,248,0.65)" stroke-width="1" />
                    <line x1="58" y1="48" x2="68" y2="48" stroke="rgba(56,189,248,0.65)" stroke-width="1" />
                    <line x1="92" y1="48" x2="102" y2="48" stroke="rgba(56,189,248,0.65)" stroke-width="1" />
                    <circle :cx="armX" :cy="armY" r="4.5" fill="#38bdf8" />
                    <circle :cx="armX" :cy="armY" r="1.8" fill="#fff" />
                    <path d="M 12 12 L 6 12 L 6 18 M 148 12 L 154 12 L 154 18 M 12 78 L 6 78 L 6 72 M 148 78 L 154 78 L 154 72" stroke="rgba(56,189,248,0.5)" stroke-width="1.2" fill="none" />
                    <text x="8" y="20" fill="rgba(56,189,248,0.85)" font-size="6.5" font-family="monospace">● EGO 1080P</text>
                  </svg>
                </div>
              </div>

              <!-- 右侧视 -->
              <div class="widescreen-tile">
                <div class="tile-header">
                  <span class="v-label">右侧视 RGB</span>
                  <span class="v-tag mono">CAM-03 · 1080P</span>
                </div>
                <div class="tile-media-box">
                  <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                    <rect width="160" height="90" fill="#161E31" />
                    <polygon points="8,85 152,85 132,54 28,54" fill="#202e4c" />
                    <circle cx="80" cy="50" r="24" fill="none" stroke="#354B78" stroke-width="1.8" stroke-dasharray="4 2" />
                    <circle cx="80" cy="50" r="8" fill="#293B5F" />
                    <line x1="140" y1="80" :x2="armX" :y2="armY" stroke="#60a5fa" stroke-width="2.6" stroke-linecap="round" />
                    <circle :cx="armX" :cy="armY" r="4.5" fill="#60a5fa" />
                    <circle :cx="armX" :cy="armY" r="1.8" fill="#fff" />
                    <path d="M 12 12 L 6 12 L 6 18 M 148 12 L 154 12 L 154 18 M 12 78 L 6 78 L 6 72 M 148 78 L 154 78 L 154 72" stroke="rgba(96,165,250,0.35)" stroke-width="1.2" fill="none" />
                    <text x="8" y="20" fill="rgba(96,165,250,0.7)" font-size="6.5" font-family="monospace">● R-EYE 30FPS</text>
                  </svg>
                </div>
              </div>
            </div>

            <!-- 第二排：Depth 三路深度伪彩视频 (直接排布紧随第一排，不占冗余标题高度) -->
            <div class="video-trio-row depth-trio-row">
              <!-- 左侧视 Depth -->
              <div class="widescreen-tile depth-tile">
                <div class="tile-header">
                  <span class="v-label">左侧视 Depth</span>
                  <span class="v-tag mono">D-01 · 深度伪彩</span>
                </div>
                <div class="tile-media-box">
                  <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                    <rect width="160" height="90" fill="#040609" />
                    <polygon points="10,85 150,85 130,55 30,55" fill="#17263D" />
                    <ellipse cx="80" cy="54" rx="28" ry="17" fill="#1E40AF" />
                    <ellipse cx="80" cy="54" rx="20" ry="12" fill="#047857" />
                    <ellipse cx="80" cy="54" rx="12" ry="7" fill="#D97706" />
                    <line x1="20" y1="80" :x2="armX" :y2="armY" stroke="#0284C7" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 1.5" />
                    <circle :cx="armX" :cy="armY" r="4.5" fill="#EF4444" />
                    <circle :cx="armX" :cy="armY" r="2" fill="#FDE047" />
                    <circle cx="72" cy="50" r="1.5" fill="#EF4444" />
                    <circle cx="88" cy="56" r="1.5" fill="#3B82F6" />
                    <circle cx="82" cy="46" r="1.5" fill="#10B981" />
                    <text x="8" y="15" fill="rgba(147,197,253,0.7)" font-size="6.5" font-family="monospace">● D-01 TURBO</text>
                  </svg>
                </div>
              </div>

              <!-- 头部 Depth -->
              <div class="widescreen-tile depth-tile">
                <div class="tile-header">
                  <span class="v-label">头部 Depth</span>
                  <span class="v-tag mono text-cyan">D-02 · 主景深度</span>
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
                    <circle :cx="armX" :cy="armY" r="4.5" fill="#EF4444" />
                    <circle :cx="armX" :cy="armY" r="1.8" fill="#FFF" />
                    <text x="8" y="15" fill="rgba(56,189,248,0.75)" font-size="6.5" font-family="monospace">● D-02 主景</text>
                  </svg>
                </div>
              </div>

              <!-- 右侧视 Depth -->
              <div class="widescreen-tile depth-tile">
                <div class="tile-header">
                  <span class="v-label">右侧视 Depth</span>
                  <span class="v-tag mono">D-03 · 深度伪彩</span>
                </div>
                <div class="tile-media-box">
                  <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="sim-cam-svg">
                    <rect width="160" height="90" fill="#040609" />
                    <polygon points="10,85 150,85 130,55 30,55" fill="#17263D" />
                    <ellipse cx="80" cy="54" rx="28" ry="17" fill="#1E40AF" />
                    <ellipse cx="80" cy="54" rx="20" ry="12" fill="#047857" />
                    <ellipse cx="80" cy="54" rx="12" ry="7" fill="#D97706" />
                    <line x1="140" y1="80" :x2="armX" :y2="armY" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 1.5" />
                    <circle :cx="armX" :cy="armY" r="4.5" fill="#EF4444" />
                    <circle :cx="armX" :cy="armY" r="2" fill="#FDE047" />
                    <circle cx="76" cy="52" r="1.5" fill="#EF4444" />
                    <circle cx="84" cy="58" r="1.5" fill="#3B82F6" />
                    <text x="8" y="15" fill="rgba(147,197,253,0.7)" font-size="6.5" font-family="monospace">● D-03 TURBO</text>
                  </svg>
                </div>
              </div>
            </div>

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
                  <Scene3DView
                    :task="task"
                    :live-t="liveT"
                    :is-dark="isDark"
                    :has-hands="hasHands"
                    :show-traj="showTraj"
                    :show-pose="showPose"
                    :show-arm="showArm"
                    :show-frustum="showFrustum"
                    :show-grid="showGrid"
                    :show-hand-traj="showHandTraj"
                    :follow="followHead"
                  />
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
                  <span class="sh-title">头部 + 双手 统一 3D 场景 · 世界坐标系</span>
                  <span class="sh-sub muted">(支持鼠标旋转/平移/缩放)</span>
                </div>

                <div class="sh-layer-toggles">
                  <span class="toggle-lbl muted">图层</span>
                  <label class="cb-label">
                    <input v-model="showTraj" type="checkbox" class="cb-input" />
                    <span>头部轨迹</span>
                  </label>
                  <label class="cb-label">
                    <input v-model="showPose" type="checkbox" class="cb-input" />
                    <span>位姿轴</span>
                  </label>
                  <label class="cb-label">
                    <input v-model="showFrustum" type="checkbox" class="cb-input" />
                    <span>相机视锥</span>
                  </label>
                  <label class="cb-label">
                    <input v-model="showGrid" type="checkbox" class="cb-input" />
                    <span>地面网格</span>
                  </label>
                  <label class="cb-label">
                    <input v-model="showHandTraj" type="checkbox" class="cb-input" />
                    <span>手部轨迹</span>
                  </label>
                  <label class="cb-label">
                    <input v-model="followHead" type="checkbox" class="cb-input" />
                    <span>跟随视角</span>
                  </label>
                  <label class="cb-label hand-toggle-chip" title="开启双手遥测卡片，切换为三等分对称对齐">
                    <input v-model="hasHands" type="checkbox" class="cb-input" />
                    <span class="text-cyan">双手遥测</span>
                  </label>
                </div>
              </div>

              <!-- 3D 满宽平铺画布 (自适应撑满到底，支持鼠标旋转/平移/缩放) -->
              <div class="scene-canvas-container full-canvas">
                <Scene3DView
                  :task="task"
                  :live-t="liveT"
                  :is-dark="isDark"
                  :has-hands="hasHands"
                  :show-traj="showTraj"
                  :show-pose="showPose"
                  :show-arm="showArm"
                  :show-frustum="showFrustum"
                  :show-grid="showGrid"
                  :show-hand-traj="showHandTraj"
                  :follow="followHead"
                />
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
  --cp-scrim: rgba(26,33,61, 0.32);
  --cp-border: #E2E8F0;
  --cp-border-subtle: #EEF2F6;
  --cp-shadow: 0 20px 48px rgba(26,33,61, 0.14), 0 1px 3px rgba(26,33,61, 0.08);
  --cp-text: #1A213D;
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
  --cp-btn-text: #4c5271;
  --cp-icon-btn-bg: #F1F5F9;
  --cp-icon-btn-hover: #E2E8F0;
  --cp-icon-btn-border: #CBD5E1;
  --cp-icon-btn-color: #686989;
  --cp-switcher-bg: #F1F5F9;
  --cp-switcher-active-bg: #FFFFFF;
  --cp-switcher-active-text: #0284C7;
  --cp-switcher-active-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  --cp-canvas-bg: radial-gradient(circle at center, #F8FAFC 0%, #EEF2F6 100%);
  --cp-prog-track: #E2E8F0;
  --cp-pill-bg: #F1F5F9;
  --cp-pill-text: #686989;
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
  --cp-bg: #0f1f35;
  --cp-scrim: rgba(9,18,33, 0.55);
  --cp-border: #2B4A6D;
  --cp-border-subtle: rgba(46,211,230, 0.10);
  --cp-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(46,211,230, 0.12);
  --cp-text: #F3F8FC;
  --cp-text-muted: #B6CADC;
  --cp-text-faint: #8EA6BE;
  --cp-topbar-bg: #132640;
  --cp-action-bg: #10233b;
  --cp-surface-card: #162A45;
  --cp-surface-subtle: #1B3352;
  --cp-hover-border: rgba(46,211,230, 0.45);
  --cp-accent: #26C6DA;
  --cp-accent-soft: rgba(38, 198, 218, 0.14);
  --cp-btn-bg: #1B3352;
  --cp-btn-hover: #243f63;
  --cp-btn-border: #2B4A6D;
  --cp-btn-text: #F3F8FC;
  --cp-icon-btn-bg: #1B3352;
  --cp-icon-btn-hover: #243f63;
  --cp-icon-btn-border: #2B4A6D;
  --cp-icon-btn-color: #D0E2EE;
  --cp-switcher-bg: #0d1c31;
  --cp-switcher-active-bg: #243f63;
  --cp-switcher-active-text: #26C6DA;
  --cp-switcher-active-shadow: none;
  --cp-canvas-bg: radial-gradient(circle at center, #173558 0%, #0C182B 100%);
  --cp-prog-track: #0d1c31;
  --cp-pill-bg: #0d1c31;
  --cp-pill-text: #8EA6BE;
  --cp-timer-bg: #0d1c31;
  --cp-timer-border: #2B4A6D;
  --cp-btn-pause-bg: rgba(245, 158, 11, 0.18);
  --cp-btn-pause-border: rgba(245, 158, 11, 0.4);
  --cp-btn-pause-text: #FFC15C;
  --cp-btn-paused-bg: rgba(16, 185, 129, 0.2);
  --cp-btn-paused-border: rgba(16, 185, 129, 0.4);
  --cp-btn-paused-text: #45E3A8;
  --cp-btn-stop-bg: rgba(239, 68, 68, 0.18);
  --cp-btn-stop-border: rgba(239, 68, 68, 0.4);
  --cp-btn-stop-text: #FF7A7A;
  --cp-btn-fail-bg: rgba(244, 63, 94, 0.12);
  --cp-btn-fail-border: rgba(244, 63, 94, 0.3);
  --cp-btn-fail-text: #FF7A7A;
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

/* 1. 顶部集成控制条 (合二为一：左侧实时状态与时码，右侧操作按钮与窗口控制) */
.deck-topbar {
  height: 40px;
  padding: 0 12px;
  background: var(--cp-topbar-bg);
  border-bottom: 1px solid var(--cp-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.topbar-left {
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
  color: #FFC15C;
}
.cockpit-light .status-chip.paused {
  background: #FEF3C7;
  color: #B45309;
}
.chip-dot {
  width: 6.5px;
  height: 6.5px;
  border-radius: 50%;
  background: currentColor;
  display: inline-block;
  flex-shrink: 0;
  transition: background 0.3s ease;
}
.status-chip.live .chip-dot {
  background: #10B981;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
  animation: smoothBreath 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.status-chip.paused .chip-dot {
  background: #F59E0B;
  box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
  animation: smoothBreathAmber 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes smoothBreath {
  0% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
    opacity: 1;
  }
  50% {
    box-shadow: 0 0 0 5px rgba(16, 185, 129, 0);
    opacity: 0.75;
  }
  100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
    opacity: 1;
  }
}

@keyframes smoothBreathAmber {
  0% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
    opacity: 1;
  }
  50% {
    box-shadow: 0 0 0 5px rgba(245, 158, 11, 0);
    opacity: 0.75;
  }
  100% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
    opacity: 1;
  }
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

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.act-buttons {
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

.top-divider {
  width: 1px;
  height: 16px;
  background: var(--cp-border);
  margin: 0 2px;
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
.icon-action-btn.close-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #EF4444;
}
.svg-ic {
  width: 14px;
  height: 14px;
}

/* 2. 滚动主体区域 (全宽标准 16:9 横屏视口) */
.deck-scroll-area {
  flex: 1;
  min-height: 0;
  padding: 8px 12px 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 一行 3 个标准宽屏视口 */
.video-trio-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
  flex-shrink: 0;
}

.widescreen-tile {
  background: var(--cp-surface-card);
  border: 1px solid var(--cp-border);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.widescreen-tile:hover {
  border-color: var(--cp-hover-border);
}
.tile-header {
  height: 23px;
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

/* 16:9 标准宽屏比例 */
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

.widescreen-tile.depth-tile {
  background: #0c111f;
  border-color: rgba(46,211,230, 0.18);
}
.cockpit-light .widescreen-tile.depth-tile {
  background: #F8FAFC;
  border-color: #E2E8F0;
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
  border-left: 2px solid #2ED3E6;
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
.cockpit-dark .h-sym.l { background: rgba(46,211,230, 0.2); color: #2ED3E6; }
.h-sym.r { background: rgba(245, 158, 11, 0.15); color: #D97706; }
.cockpit-dark .h-sym.r { background: rgba(245, 158, 11, 0.2); color: #FFC15C; }
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
.prog-fill.l { background: linear-gradient(90deg, #0284c7, #2ED3E6); }
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
  accent-color: #2ED3E6;
}
.cb-label.hand-toggle-chip {
  background: rgba(2, 132, 199, 0.08);
  border: 1px solid rgba(2, 132, 199, 0.25);
  padding: 1px 6px;
  border-radius: 3px;
}
.cockpit-dark .cb-label.hand-toggle-chip {
  background: rgba(46,211,230, 0.08);
  border: 1px solid rgba(46,211,230, 0.25);
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
.cockpit-dark .leg-line.traj { background: #2ED3E6; }
.leg-line.x { background: #EF4444; }
.leg-line.y { background: #10B981; }
.leg-line.z { background: #0284C7; }
.cockpit-dark .leg-line.z { background: #2ED3E6; }

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
.cockpit-dark .text-cyan { color: #2ED3E6 !important; }
.text-amber { color: #D97706 !important; }
.cockpit-dark .text-amber { color: #FFC15C !important; }

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
.q-strip { display: flex; align-items: center; gap: 14px; padding: 6px 16px; font-size: 12px; border-bottom: 1px solid rgba(148,163,184,.16); background: rgba(16,185,129,.06); flex-wrap: wrap; }
.q-strip.bad { background: rgba(245,158,11,.1); }
.q-title { font-weight: 600; color: #10b981; }
.q-strip.bad .q-title { color: #f59e0b; }
.q-i { color: #94a3b8; }
.q-i b { color: #e2e8f0; font-weight: 500; margin-left: 2px; }
.q-i.bad b, .q-i.bad { color: #f59e0b; }
.q-grow { flex: 1; }
.q-msg { color: #f59e0b; }
.q-msg.muted { color: #94a3b8; }
</style>
