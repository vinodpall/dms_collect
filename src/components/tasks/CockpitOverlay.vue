<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import type { Task } from '@/stores/tasks'
import { SCEN } from '@/constants'
import { traj } from '@/components/annotate/motion'

interface CockpitProps {
  task: Task;
  open: boolean;
  liveT: number;
  mayEdit: boolean;
  dis?: string;
}

const props = defineProps<CockpitProps>()

interface CockpitEmits {
  (e: 'close'): void;
  (e: 'pause'): void;
  (e: 'resume'): void;
  (e: 'end'): void;
  (e: 'flag'): void;
  (e: 'note'): void;
  (e: 'fail'): void;
}

const emit = defineEmits<CockpitEmits>()

const isFullscreen = ref(false)

const isVr = computed(() => props.task.scen === 'qmd')
const isUmi = computed(() => props.task.scen === 'fhd')
const scenMeta = computed(() => SCEN[props.task.scen])

/* 归一化时间 [0, 1] */
const u = computed(() => (props.liveT % 20) / 20)

/* 当前末端世界坐标 [x, y, z] */
const pos = computed(() => traj(u.value, props.task.scen))

/* VR 模式下的 6 路工业相机 */
const vrCams = computed(() => [
  { id: 'CAM-01', name: '第一视角 (头显RGB)', role: '主摄', i: 0 },
  { id: 'CAM-02', name: '第二视角·左 (工件广角)', role: '侧视', i: 1 },
  { id: 'CAM-03', name: '第三视角·右 (工件侧视)', role: '侧视', i: 2 },
  { id: 'CAM-04', name: '腕部·左 (机械手末端)', role: '近景', i: 3 },
  { id: 'CAM-05', name: '腕部·右 (机械手末端)', role: '近景', i: 4 },
  { id: 'CAM-06', name: '俯视全景 (工位顶视)', role: '全景', i: 5 },
])

/* UMI 模式下的 4 路工业相机 */
const umiCams = computed(() => [
  { id: 'CAM-01', name: '第一视角 (双目操作)', role: '主摄', i: 0 },
  { id: 'CAM-02', name: '腕部相机 (手持追踪)', role: '近景', i: 1 },
  { id: 'CAM-03', name: '侧视对准 (装配工装)', role: '侧视', i: 2 },
  { id: 'CAM-04', name: '台面俯视 (全景监控)', role: '全景', i: 3 },
])

/* 模拟各视角工业操作运动轨迹 */
function getCamMotion(i: number) {
  const a = (i * 54 + 25) * (Math.PI / 180)
  const [x, y, z] = pos.value
  const px = +(80 + (x * Math.cos(a) - y * Math.sin(a)) * 74 + (i % 2 ? -5 : 5)).toFixed(1)
  const py = +(54 - z * 66 + (x * Math.sin(a) + y * Math.cos(a)) * 14).toFixed(1)
  const bx = [14, 146, 12, 80, 80, 144][i % 6]
  const by = [82, 82, 82, 10, 10, 82][i % 6]
  const shade = ['#15253A', '#192B42', '#142337', '#1C314C', '#17283E', '#132134'][i % 6]
  return { px, py, bx, by, shade }
}

/* 3D 世界坐标系等轴测投影 (320 x 220 视口几何适配) */
const K = 150
const proj = (x: number, y: number, z: number): [number, number] => [
  160 + (x - y) * K * 0.55,
  130 + (x + y) * K * 0.30 - z * K * 0.68,
]
const N = 60
const pts = computed(() => Array.from({ length: N + 1 }, (_, i) => proj(...traj(i / N, props.task.scen))))
const donePath = computed(() => pts.value.slice(0, Math.max(1, Math.round(u.value * N) + 1)).map((p) => p.join(',')).join(' '))
const allPath = computed(() => pts.value.map((p) => p.join(',')).join(' '))
const curProj = computed(() => proj(...pos.value))
const axis = computed(() => [proj(0, 0, 0), proj(0.42, 0, 0), proj(0, 0.42, 0), proj(0, 0, 0.42)])
const gridLines = computed(() => {
  const out: [[number, number], [number, number]][] = []
  for (let i = -3; i <= 3; i++) {
    out.push([proj(-0.42, i * 0.14, 0), proj(0.42, i * 0.14, 0)])
    out.push([proj(i * 0.14, -0.42, 0), proj(i * 0.14, 0.42, 0)])
  }
  return out
})

/* UMI 模式下的左右手数据 */
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
    state: percent < 30 ? '闭合夹紧' : percent > 80 ? '完全展开' : '动作执行中',
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
    <Transition name="cockpit-fade">
      <div v-if="open" class="cockpit-overlay-mask">
        <!-- 透明背景防击穿遮罩（无任何暗色蒙层） -->
        <div class="cockpit-backdrop" @click="emit('close')" />

        <!-- 独立驾驶舱工作台：左侧全高铺满锚定，告别悬空截断 -->
        <div class="cockpit-window" :class="{ 'is-fullscreen': isFullscreen }">
          <!-- 1. 顶部 HUD 状态栏 -->
          <header class="hud-header">
            <div class="hud-brand-group">
              <div class="hud-logo-box">
                <AppIcon name="robot" size="sm" style="color:var(--accent)" />
              </div>
              <div class="hud-title-col">
                <div class="hud-main-title">
                  <span>数采作业驾驶舱</span>
                  <span class="hud-mode-pill" :class="isVr ? 'vr' : 'umi'">
                    {{ isVr ? 'VR 遥操作 · 6目' : 'UMI 手持双臂' }}
                  </span>
                </div>
                <div class="hud-sub-info">
                  <span class="mono">{{ task.id }}</span>
                  <span class="sep-dot">·</span>
                  <span>{{ scenMeta.name }}</span>
                </div>
              </div>
            </div>

            <!-- 中间状态指示与录制计时 -->
            <div class="hud-center-status">
              <div class="status-pill" :class="task.status === 'running' ? 'running' : 'paused'">
                <span class="pulse-dot" />
                <span>{{ task.status === 'running' ? 'LIVE 实时作业中' : 'PAUSED 采集暂停' }}</span>
              </div>
              <div class="rec-timer-box">
                <span class="rec-dot">REC</span>
                <span class="mono timer-val">{{ timeStr }}</span>
              </div>
            </div>

            <!-- 右侧指标与操作按钮 -->
            <div class="hud-right-group">
              <div class="metrics-bar">
                <div class="m-item"><span class="k">采样率</span><span class="v mono">30 FPS</span></div>
                <div class="m-item"><span class="k">同步误差</span><span class="v mono">1.2 ms</span></div>
                <div class="m-item"><span class="k">传输延迟</span><span class="v mono">18 ms</span></div>
              </div>

              <div class="window-actions">
                <button
                  type="button"
                  class="win-btn"
                  :title="isFullscreen ? '还原视窗' : '全屏视窗'"
                  @click="isFullscreen = !isFullscreen"
                >
                  <AppIcon name="grid" size="sm" />
                </button>
                <button
                  type="button"
                  class="win-btn close"
                  title="收起驾驶舱"
                  @click="emit('close')"
                >
                  <AppIcon name="x" size="sm" />
                  <span>收起</span>
                </button>
              </div>
            </div>
          </header>

          <!-- 2. 中间主体视口区（双区协同架构：左侧多目视频墙 + 右侧空间遥测舱） -->
          <main class="hud-main-viewport">
            <!-- ========== 模式 1: VR 遥操作 (左侧 3列×2行 6路视频 + 右侧整列 3D世界坐标系) ========== -->
            <div v-if="isVr" class="cockpit-split-layout">
              <!-- 左区：6 路工业相机矩阵墙 (3 列 × 2 行，每路 16:9 舒展视野，无挤压) -->
              <div class="video-matrix-grid vr-matrix">
                <div v-for="c in vrCams" :key="c.id" class="monitor-tile">
                  <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="monitor-svg">
                    <rect width="160" height="90" :fill="getCamMotion(c.i).shade" />
                    <rect y="68" width="160" height="22" fill="#1e3450" opacity="0.8" />
                    <circle cx="80" cy="54" r="18" fill="none" stroke="#335680" stroke-width="2.5" />
                    <circle cx="80" cy="54" r="6" fill="#203754" />
                    <path :d="`M${getCamMotion(c.i).bx} ${getCamMotion(c.i).by} L${(getCamMotion(c.i).bx + getCamMotion(c.i).px) / 2} ${Math.min(getCamMotion(c.i).by, getCamMotion(c.i).py) - 8} L${getCamMotion(c.i).px} ${getCamMotion(c.i).py}`" stroke="#5291d4" stroke-width="3" fill="none" stroke-linecap="round" />
                    <circle :cx="getCamMotion(c.i).px" :cy="getCamMotion(c.i).py" r="4.5" fill="#60a5fa" />
                    <circle :cx="getCamMotion(c.i).px" :cy="getCamMotion(c.i).py" r="2" fill="#fff" />
                    <!-- 工业标尺四角 HUD 瞄准线 -->
                    <path d="M4 12V4H12 M148 4H156V12 M4 78V86H12 M148 86H156V78" stroke="rgba(56,189,248,0.35)" stroke-width="1.2" fill="none" />
                  </svg>

                  <!-- 顶部浮层 OSD 信息栏 (左：相机编号及视角，右：LIVE 脉冲) -->
                  <div class="monitor-osd-top">
                    <div class="cam-osd-badge">
                      <span class="cam-id-tag">{{ c.id }}</span>
                      <span class="cam-name-text">{{ c.name }}</span>
                    </div>
                    <span class="live-pill">
                      <span class="pulse-emerald" />
                      LIVE
                    </span>
                  </div>

                  <!-- 底部浮层 OSD 信息栏 (左：码率分辨率，右：相机角色) -->
                  <div class="monitor-osd-bottom">
                    <span class="res-tag mono">1080P@30</span>
                    <span class="role-tag">{{ c.role }}</span>
                  </div>
                </div>
              </div>

              <!-- 右区：世界坐标系 · 3D 空间轨迹遥测舱 (全高通栏展示，彻底告别扁条状挤压) -->
              <div class="spatial-telemetry-deck">
                <div class="deck-topbar">
                  <div class="deck-brand">
                    <span class="deck-tag">3D FRAME</span>
                    <span class="deck-title">世界坐标系 · 3D空间轨迹</span>
                  </div>
                  <div class="deck-status-pill">
                    <span class="pulse-emerald" />
                    <span>ISO-9283 标定</span>
                  </div>
                </div>

                <!-- 3D 空间立体投影画布 (舒展比例，X/Y/Z轴纵深完整呈现) -->
                <div class="spatial-canvas-box">
                  <svg viewBox="0 0 320 220" preserveAspectRatio="xMidYMid meet" class="spatial-svg">
                    <!-- 3D 网格地平面 -->
                    <g stroke="#234266" stroke-width="0.8" opacity="0.85">
                      <line v-for="(g, i) in gridLines" :key="i" :x1="g[0][0]" :y1="g[0][1]" :x2="g[1][0]" :y2="g[1][1]" />
                    </g>
                    <!-- 规划虚线轨迹 -->
                    <polyline :points="allPath" fill="none" stroke="#2c5282" stroke-width="1.8" stroke-dasharray="4 3" />
                    <!-- 实时执行发光轨迹 -->
                    <polyline :points="donePath" fill="none" stroke="#38bdf8" stroke-width="2.8" stroke-linejoin="round" />
                    <!-- 三维坐标轴向 (红X、绿Y、蓝Z) -->
                    <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[1][0]" :y2="axis[1][1]" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" />
                    <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[2][0]" :y2="axis[2][1]" stroke="#22c55e" stroke-width="2.2" stroke-linecap="round" />
                    <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[3][0]" :y2="axis[3][1]" stroke="#3b82f6" stroke-width="2.2" stroke-linecap="round" />
                    <text :x="axis[1][0] + 6" :y="axis[1][1] + 4" fill="#ef4444" font-size="11" font-weight="700">X</text>
                    <text :x="axis[2][0] - 14" :y="axis[2][1] + 4" fill="#22c55e" font-size="11" font-weight="700">Y</text>
                    <text :x="axis[3][0] + 6" :y="axis[3][1] + 2" fill="#3b82f6" font-size="11" font-weight="700">Z</text>
                    <!-- 当前末端探头光标与光环 -->
                    <circle :cx="curProj[0]" :cy="curProj[1]" r="12" fill="#38bdf8" opacity="0.25" />
                    <circle :cx="curProj[0]" :cy="curProj[1]" r="4.5" fill="#ffffff" />
                    <!-- 四角标尺线 -->
                    <path d="M6 14V6H14 M306 6H314V14 M6 206V214H14 M306 214H314V206" stroke="rgba(56,189,248,0.3)" stroke-width="1.2" fill="none" />
                  </svg>

                  <!-- 画布浮层水印 -->
                  <div class="canvas-watermark mono">World Base Frame (WBF)</div>
                </div>

                <!-- 底部 6-DoF 实时位姿与指标遥测卡 -->
                <div class="spatial-telemetry-panel">
                  <div class="coords-row">
                    <div class="coord-item">
                      <span class="axis-tag red">X</span>
                      <span class="coord-val mono">{{ pos[0] >= 0 ? '+' : '' }}{{ pos[0].toFixed(3) }}</span>
                      <span class="unit">m</span>
                    </div>
                    <div class="coord-item">
                      <span class="axis-tag green">Y</span>
                      <span class="coord-val mono">{{ pos[1] >= 0 ? '+' : '' }}{{ pos[1].toFixed(3) }}</span>
                      <span class="unit">m</span>
                    </div>
                    <div class="coord-item">
                      <span class="axis-tag blue">Z</span>
                      <span class="coord-val mono">{{ pos[2] >= 0 ? '+' : '' }}{{ pos[2].toFixed(3) }}</span>
                      <span class="unit">m</span>
                    </div>
                  </div>

                  <div class="telemetry-sub-stats">
                    <div class="stat-pill">
                      <span class="stat-k">轨迹拟合</span>
                      <span class="stat-v mono text-good">99.6%</span>
                    </div>
                    <div class="stat-pill">
                      <span class="stat-k">空间偏差</span>
                      <span class="stat-v mono text-good">&lt; 0.5 mm</span>
                    </div>
                    <div class="stat-pill">
                      <span class="stat-k">姿态角</span>
                      <span class="stat-v mono">R:1.4° P:-0.8° Y:42°</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- ========== 模式 2: UMI 手持双臂模式 (左侧 2列×2行 4路视频 + 右侧 3D世界坐标系 + 2个手部数据舱) ========== -->
            <div v-else-if="isUmi" class="cockpit-split-layout">
              <!-- 左区：4 路工业相机 (2 列 × 2 行，尺寸更大，细节更丰富) -->
              <div class="video-matrix-grid umi-matrix">
                <div v-for="c in umiCams" :key="c.id" class="monitor-tile">
                  <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" class="monitor-svg">
                    <rect width="160" height="90" :fill="getCamMotion(c.i).shade" />
                    <rect y="68" width="160" height="22" fill="#1e3450" opacity="0.8" />
                    <circle cx="80" cy="54" r="16" fill="none" stroke="#335680" stroke-width="2.5" />
                    <path :d="`M${getCamMotion(c.i).bx} ${getCamMotion(c.i).by} L${(getCamMotion(c.i).bx + getCamMotion(c.i).px) / 2} ${Math.min(getCamMotion(c.i).by, getCamMotion(c.i).py) - 8} L${getCamMotion(c.i).px} ${getCamMotion(c.i).py}`" stroke="#5291d4" stroke-width="3" fill="none" stroke-linecap="round" />
                    <circle :cx="getCamMotion(c.i).px" :cy="getCamMotion(c.i).py" r="4.5" fill="#38bdf8" />
                    <path d="M4 12V4H12 M148 4H156V12 M4 78V86H12 M148 86H156V78" stroke="rgba(56,189,248,0.35)" stroke-width="1.2" fill="none" />
                  </svg>

                  <div class="monitor-osd-top">
                    <div class="cam-osd-badge">
                      <span class="cam-id-tag">{{ c.id }}</span>
                      <span class="cam-name-text">{{ c.name }}</span>
                    </div>
                    <span class="live-pill">
                      <span class="pulse-emerald" />
                      LIVE
                    </span>
                  </div>

                  <div class="monitor-osd-bottom">
                    <span class="res-tag mono">1080P@30</span>
                    <span class="role-tag">{{ c.role }}</span>
                  </div>
                </div>
              </div>

              <!-- 右区：上部 3D 空间轨迹 + 下部 左右手数据舱 -->
              <div class="umi-telemetry-col">
                <!-- 上部：3D 世界坐标系 -->
                <div class="spatial-telemetry-deck umi-top-deck">
                  <div class="deck-topbar">
                    <div class="deck-brand">
                      <span class="deck-tag">3D FRAME</span>
                      <span class="deck-title">世界坐标系 · UMI双臂空间轨迹</span>
                    </div>
                    <div class="deck-status-pill">
                      <span class="pulse-emerald" />
                      <span>双臂空间跟踪</span>
                    </div>
                  </div>

                  <div class="spatial-canvas-box compact">
                    <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid meet" class="spatial-svg">
                      <g stroke="#234266" stroke-width="0.8" opacity="0.85">
                        <line v-for="(g, i) in gridLines" :key="i" :x1="g[0][0]" :y1="g[0][1]" :x2="g[1][0]" :y2="g[1][1]" />
                      </g>
                      <polyline :points="allPath" fill="none" stroke="#2c5282" stroke-width="1.8" stroke-dasharray="4 3" />
                      <polyline :points="donePath" fill="none" stroke="#38bdf8" stroke-width="2.8" stroke-linejoin="round" />
                      <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[1][0]" :y2="axis[1][1]" stroke="#ef4444" stroke-width="2.2" />
                      <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[2][0]" :y2="axis[2][1]" stroke="#22c55e" stroke-width="2.2" />
                      <line :x1="axis[0][0]" :y1="axis[0][1]" :x2="axis[3][0]" :y2="axis[3][1]" stroke="#3b82f6" stroke-width="2.2" />
                      <circle :cx="curProj[0]" :cy="curProj[1]" r="4.5" fill="#ffffff" />
                    </svg>
                  </div>

                  <div class="coords-compact-row mono">
                    <span>X: <b class="red">{{ pos[0].toFixed(2) }}</b></span>
                    <span>Y: <b class="green">{{ pos[1].toFixed(2) }}</b></span>
                    <span>Z: <b class="blue">{{ pos[2].toFixed(2) }}</b> m</span>
                    <span class="fit-val">拟合: 99.4%</span>
                  </div>
                </div>

                <!-- 下部：左右手数据舱 (并排对齐) -->
                <div class="dual-hands-deck">
                  <!-- 左手 (Left Hand) -->
                  <div class="hand-data-card">
                    <div class="hand-header">
                      <div class="hand-id-box l">
                        <span class="hand-sym">L</span>
                        <span class="hand-title">左手持端 (Left)</span>
                      </div>
                      <span class="hand-state-pill">{{ umiLeftHand.state }}</span>
                    </div>
                    <div class="hand-body">
                      <div class="hand-row">
                        <span class="hk">夹爪行程开合</span>
                        <span class="hv mono">{{ umiLeftHand.openDist }} mm ({{ umiLeftHand.percent }}%)</span>
                      </div>
                      <div class="prog-track">
                        <div class="prog-fill l" :style="{ width: umiLeftHand.percent + '%' }" />
                      </div>
                      <div class="hand-row">
                        <span class="hk">力控反馈</span>
                        <span class="hv mono highlight">{{ umiLeftHand.force }} N</span>
                      </div>
                      <div class="imu-pill mono">
                        <span>Acc: [{{ umiLeftHand.acc.join(', ') }}] g</span>
                      </div>
                    </div>
                  </div>

                  <!-- 右手 (Right Hand) -->
                  <div class="hand-data-card">
                    <div class="hand-header">
                      <div class="hand-id-box r">
                        <span class="hand-sym">R</span>
                        <span class="hand-title">右手持端 (Right)</span>
                      </div>
                      <span class="hand-state-pill">{{ umiRightHand.state }}</span>
                    </div>
                    <div class="hand-body">
                      <div class="hand-row">
                        <span class="hk">夹爪行程开合</span>
                        <span class="hv mono">{{ umiRightHand.openDist }} mm ({{ umiRightHand.percent }}%)</span>
                      </div>
                      <div class="prog-track">
                        <div class="prog-fill r" :style="{ width: umiRightHand.percent + '%' }" />
                      </div>
                      <div class="hand-row">
                        <span class="hk">力控反馈</span>
                        <span class="hv mono highlight">{{ umiRightHand.force }} N</span>
                      </div>
                      <div class="imu-pill mono">
                        <span>Acc: [{{ umiRightHand.acc.join(', ') }}] g</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>

          <!-- 3. 底部采集控制台：底色与右侧完全一致，参数与 5 个按钮紧凑排布 -->
          <footer class="hud-footer-console">
            <!-- 左侧采集参数行 -->
            <div class="params-spec-line">
              <div class="params-badge">
                <AppIcon name="gear" size="sm" style="color:var(--muted)" />
                <span class="p-title">采集参数</span>
              </div>
              <div class="params-pills">
                <span class="pill mono">30fps</span>
                <span class="sep">|</span>
                <span class="pill mono">1080p</span>
                <span class="sep">|</span>
                <span class="pill mono">12GB/h</span>
                <span class="sep">|</span>
                <span class="pill mono highlight">剩余 800GB</span>
              </div>
            </div>

            <!-- 右侧 5 个操作控制按钮 -->
            <div class="action-buttons-group">
              <button
                type="button"
                class="act-btn pause"
                :class="{ 'is-paused': task.status === 'paused' }"
                :disabled="!mayEdit"
                :title="dis"
                @click="task.status === 'running' ? emit('pause') : emit('resume')"
              >
                <AppIcon :name="task.status === 'paused' ? 'play' : 'pause'" size="sm" />
                <span>{{ task.status === 'paused' ? '继续采集' : '暂停' }}</span>
              </button>

              <button
                type="button"
                class="act-btn stop"
                :disabled="!mayEdit"
                :title="dis"
                @click="emit('end')"
              >
                <AppIcon name="stop" size="sm" />
                <span>停止</span>
              </button>

              <button
                type="button"
                class="act-btn flag"
                :disabled="!mayEdit"
                :title="dis"
                @click="emit('flag')"
              >
                <span class="btn-emoji">🚩</span>
                <span>标记</span>
              </button>

              <button
                type="button"
                class="act-btn note"
                :disabled="!mayEdit"
                :title="dis"
                @click="emit('note')"
              >
                <span class="btn-emoji">💾</span>
                <span>备注</span>
              </button>

              <button
                type="button"
                class="act-btn fail"
                :disabled="!mayEdit"
                :title="dis"
                @click="emit('fail')"
              >
                <span class="btn-emoji">❌</span>
                <span>失败</span>
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 遮罩整体容器：精确定位于屏幕左侧区域，z-index 高于页面内容，右侧保留 640px 抽屉位置，绝不越界！ */
.cockpit-overlay-mask {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  right: 640px;
  z-index: 1001;
  pointer-events: none;
}

/* 左侧背景遮罩：完全透明！零暗度遮罩！绝不遮暗任何元素 */
.cockpit-backdrop {
  position: absolute;
  inset: 0;
  background: transparent;
  pointer-events: auto;
}

/* 独立驾驶舱工作台：左侧全高铺满锚定（top: 16px; bottom: 16px; left: 16px; right: 16px），彻底告别悬空截断和背景表格半漏 */
.cockpit-window {
  pointer-events: auto;
  position: absolute;
  top: 16px;
  bottom: 16px;
  left: 16px;
  right: 16px;
  min-width: 760px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(15, 30, 55, 0.14), 0 2px 8px rgba(15, 30, 55, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text);
  font-family: var(--font-sans);
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 全屏视窗状态 */
.cockpit-window.is-fullscreen {
  position: fixed;
  left: 12px;
  right: 12px;
  top: 12px;
  bottom: 12px;
  z-index: 1005;
}

/* 1. 顶部 HUD Header */
.hud-header {
  height: 48px;
  padding: 0 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}

.hud-brand-group {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hud-logo-box {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  background: var(--accent-soft);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hud-title-col {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.hud-main-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.hud-mode-pill {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 4px;
  font-weight: 500;
}
.hud-mode-pill.vr {
  background: var(--accent-soft);
  color: var(--accent-text);
  border: 1px solid rgba(21, 101, 192, 0.2);
}
.hud-mode-pill.umi {
  background: var(--warn-soft);
  color: var(--warn);
  border: 1px solid rgba(232, 163, 23, 0.25);
}
.hud-sub-info {
  font-size: 11px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
}
.sep-dot {
  opacity: 0.4;
}

/* 中间作业状态与录制计时 */
.hud-center-status {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}
.status-pill.running {
  background: var(--good-soft);
  color: var(--good);
  border: 1px solid rgba(34, 160, 107, 0.3);
}
.status-pill.paused {
  background: var(--warn-soft);
  color: var(--warn);
  border: 1px solid rgba(232, 163, 23, 0.3);
}
.pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
  animation: pulseDot 1.5s ease-in-out infinite;
}
@keyframes pulseDot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.8); }
}

.rec-timer-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: var(--surface-2);
  border-radius: 5px;
  border: 1px solid var(--line);
}
.rec-dot {
  font-size: 10px;
  color: var(--crit);
  font-weight: 700;
  letter-spacing: 0.5px;
}
.timer-val {
  font-size: 12px;
  color: var(--text);
  font-weight: 600;
}

/* 右侧指标与视窗控制 */
.hud-right-group {
  display: flex;
  align-items: center;
  gap: 12px;
}
.metrics-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface-2);
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid var(--line);
}
.m-item {
  display: flex;
  gap: 5px;
  font-size: 11px;
}
.m-item .k {
  color: var(--muted);
}
.m-item .v {
  color: var(--accent);
  font-weight: 600;
}

.window-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.win-btn {
  height: 28px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  color: var(--text);
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s;
}
.win-btn:hover {
  background: var(--surface-3);
  border-color: var(--accent);
  color: var(--accent);
}

/* 2. 中间主体视口区：全高弹性自适应，绝不留白，双区协同 */
.hud-main-viewport {
  flex: 1;
  min-height: 0;
  padding: 12px 14px;
  background: var(--bg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 双区协同分栏：左侧视频矩阵 + 右侧空间遥测舱 */
.cockpit-split-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  height: 100%;
}

/* 左区视频监视墙 */
.video-matrix-grid {
  flex: 1.6;
  min-width: 0;
  height: 100%;
}

/* VR 模式：3 列 × 2 行，告别 4 列拥挤，单路视频视野增加 33% */
.video-matrix-grid.vr-matrix {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

/* UMI 模式：2 列 × 2 行 */
.video-matrix-grid.umi-matrix {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

/* 工业视频视口单元（一体化黑曜石监控窗体，告别多层嵌套白框） */
.monitor-tile {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: linear-gradient(150deg, #132236 0%, #0d1726 100%);
  border: 1px solid rgba(56, 189, 248, 0.22);
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(15, 23, 42, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}
.monitor-tile:hover {
  border-color: rgba(56, 189, 248, 0.55);
  box-shadow: inset 0 0 16px rgba(56, 189, 248, 0.15), 0 4px 12px rgba(15, 23, 42, 0.12);
}
.monitor-svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* 视频上方悬浮 OSD */
.monitor-osd-top {
  position: absolute;
  top: 6px;
  left: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
  z-index: 2;
}
.cam-osd-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(11, 19, 34, 0.78);
  backdrop-filter: blur(4px);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.cam-id-tag {
  color: #38bdf8;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
}
.cam-name-text {
  color: #f1f5f9;
  font-size: 11px;
  font-weight: 600;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.live-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(11, 19, 34, 0.78);
  backdrop-filter: blur(4px);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #10b981;
  font-size: 10px;
  font-weight: 700;
}
.pulse-emerald {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
  animation: pulseDot 1.5s ease-in-out infinite;
}

/* 视频下方悬浮 OSD */
.monitor-osd-bottom {
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
.res-tag {
  background: rgba(11, 19, 34, 0.7);
  backdrop-filter: blur(4px);
  padding: 1px 5px;
  border-radius: 3px;
  color: #94a3b8;
  font-size: 9.5px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.role-tag {
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(4px);
  padding: 1px 6px;
  border-radius: 3px;
  color: #cbd5e1;
  font-size: 10px;
  font-weight: 500;
  border: 1px solid rgba(56, 189, 248, 0.2);
}

/* 右区：世界坐标系 · 3D 空间轨迹遥测舱 (全高通栏展示) */
.spatial-telemetry-deck {
  flex: 1;
  min-width: 320px;
  max-width: 440px;
  height: 100%;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.deck-topbar {
  height: 34px;
  padding: 0 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.deck-brand {
  display: flex;
  align-items: center;
  gap: 6px;
}
.deck-tag {
  background: rgba(56, 189, 248, 0.15);
  color: #0284c7;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: var(--font-mono);
  border: 1px solid rgba(2, 132, 199, 0.2);
}
.deck-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.deck-status-pill {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--good);
  background: var(--good-soft);
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 500;
}

/* 3D 空间投影主画布 */
.spatial-canvas-box {
  flex: 1;
  min-height: 160px;
  position: relative;
  background: linear-gradient(150deg, #101c2e 0%, #0a1320 100%);
  border-bottom: 1px solid var(--line);
  overflow: hidden;
}
.spatial-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.canvas-watermark {
  position: absolute;
  bottom: 6px;
  right: 8px;
  font-size: 9.5px;
  color: rgba(148, 163, 184, 0.4);
  pointer-events: none;
}

/* 底部 6-DoF 实时位姿与指标遥测卡 */
.spatial-telemetry-panel {
  padding: 10px 12px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.coords-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.coord-item {
  display: flex;
  align-items: center;
  gap: 5px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 4px 6px;
}
.axis-tag {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}
.axis-tag.red { background: #ef4444; }
.axis-tag.green { background: #22c55e; }
.axis-tag.blue { background: #3b82f6; }

.coord-val {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.unit {
  font-size: 9.5px;
  color: var(--muted);
  margin-left: auto;
}

.telemetry-sub-stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px dashed var(--line);
}
.stat-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
}
.stat-k {
  color: var(--muted);
}
.stat-v {
  font-weight: 600;
  color: var(--text);
}
.stat-v.text-good {
  color: var(--good);
}

/* UMI 模式右侧列 */
.umi-telemetry-col {
  flex: 1;
  min-width: 340px;
  max-width: 460px;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.umi-top-deck {
  flex: 1.1;
  min-height: 0;
}
.spatial-canvas-box.compact {
  flex: 1;
  min-height: 120px;
}
.coords-compact-row {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 6px 10px;
  background: var(--surface);
  font-size: 11px;
  color: var(--text);
}
.coords-compact-row .red { color: #ef4444; }
.coords-compact-row .green { color: #22c55e; }
.coords-compact-row .blue { color: #3b82f6; }
.coords-compact-row .fit-val { color: var(--good); font-weight: 600; }

.dual-hands-deck {
  flex: 0.9;
  min-height: 140px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.hand-data-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
}
.hand-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hand-id-box {
  display: flex;
  align-items: center;
  gap: 5px;
}
.hand-sym {
  width: 17px;
  height: 17px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
}
.hand-id-box.l .hand-sym { background: var(--accent-soft); color: var(--accent-text); }
.hand-id-box.r .hand-sym { background: var(--warn-soft); color: var(--warn); }
.hand-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text);
}
.hand-state-pill {
  font-size: 9.5px;
  color: var(--muted);
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 3px;
}
.hand-body {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.hand-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10.5px;
}
.hand-row .hk { color: var(--muted); }
.hand-row .hv { font-weight: 600; color: var(--text); }
.hand-row .hv.highlight { color: var(--accent); }
.prog-track {
  height: 5px;
  background: var(--line);
  border-radius: 3px;
  overflow: hidden;
}
.prog-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.15s ease-out;
}
.prog-fill.l { background: linear-gradient(90deg, #1565c0, #38bdf8); }
.prog-fill.r { background: linear-gradient(90deg, #e8a317, #f59e0b); }
.imu-pill {
  font-size: 9px;
  color: var(--muted);
  background: var(--surface-2);
  padding: 2px 5px;
  border-radius: 3px;
  border: 1px solid var(--line);
}

/* 3. 底部采集控制台：底色与右侧完全一致，参数与 5 个按钮紧凑排布 */
.hud-footer-console {
  height: 48px;
  padding: 0 16px;
  background: var(--surface);
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}

.params-spec-line {
  display: flex;
  align-items: center;
  gap: 10px;
}
.params-badge {
  display: flex;
  align-items: center;
  gap: 6px;
}
.p-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}
.params-pills {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
  background: var(--surface-2);
  padding: 3px 10px;
  border-radius: 5px;
  border: 1px solid var(--line);
}
.params-pills .sep {
  opacity: 0.35;
}
.params-pills .highlight {
  color: var(--accent);
  font-weight: 600;
}

.action-buttons-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.act-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--line);
  transition: all 0.15s;
  background: var(--surface);
  color: var(--text);
}
.act-btn:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--line-strong);
}
.act-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.act-btn.pause {
  background: var(--warn-soft);
  color: var(--warn);
  border-color: rgba(232, 163, 23, 0.35);
}
.act-btn.pause.is-paused {
  background: var(--good-soft);
  color: var(--good);
  border-color: rgba(34, 160, 107, 0.4);
}
.act-btn.pause:hover:not(:disabled) {
  opacity: 0.85;
}
.act-btn.stop {
  background: var(--surface-2);
  color: var(--text);
}
.act-btn.flag {
  background: var(--accent-soft);
  color: var(--accent-text);
  border-color: rgba(21, 101, 192, 0.25);
}
.act-btn.note {
  background: var(--surface-2);
  color: var(--text);
}
.act-btn.fail {
  background: var(--crit-soft);
  color: var(--crit);
  border-color: rgba(217, 45, 32, 0.25);
}
.btn-emoji {
  font-size: 13px;
  line-height: 1;
}

/* 动效过渡 */
.cockpit-fade-enter-active,
.cockpit-fade-leave-active {
  transition: opacity 0.2s ease;
}
.cockpit-fade-enter-from,
.cockpit-fade-leave-to {
  opacity: 0;
}
.cockpit-fade-enter-active .cockpit-window,
.cockpit-fade-leave-active .cockpit-window {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}
.cockpit-fade-enter-from .cockpit-window {
  transform: translateX(-16px) scale(0.99);
  opacity: 0;
}
.cockpit-fade-leave-to .cockpit-window {
  transform: translateX(-16px) scale(0.99);
  opacity: 0;
}
</style>
