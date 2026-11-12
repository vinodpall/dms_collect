<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import ChannelCard from '@/components/monitor/ChannelCard.vue'
import SyncChart from '@/components/monitor/SyncChart.vue'
import AlertList from '@/components/monitor/AlertList.vue'
import CameraScene from '@/components/monitor/CameraScene.vue'
import { CHANNELS, useMonitor } from '@/stores/monitor'
import { useAlerts } from '@/stores/alerts'
import { useSettings } from '@/stores/settings'
import { useSession } from '@/stores/session'
import { NO_PERM } from '@/constants'
import { toast } from '@/composables/toast'

const mon = useMonitor()
const alerts = useAlerts()
const { cfg } = useSettings()
const session = useSession()
const mayEdit = computed(() => session.can('monitor'))
const last = computed(() => mon.sync[mon.sync.length - 1])
const openCount = computed(() => alerts.list.filter((a) => a.route === 'monitor' && !a.ack).length)

// 布局模式切换：'auto' | 'grid22' | 'pip' | 'single'
const layoutMode = ref<'auto' | 'grid22' | 'pip' | 'single'>('auto')

// SDK 多模态数据流动态插槽配置（根据 SDK 能取到的数据动态渲染）
const sdkStreams = reactive([
  {
    id: 'stream_fp',
    name: '主视角 · 第一人称 (FPV)',
    type: 'video' as const,
    device: 'RealSense D405 (RGB-D)',
    res: '1280×720',
    fps: 30,
    bitrate: '14.2 Mbps',
    latency: '12 ms',
    kind: 'fp' as const,
    active: true,
  },
  {
    id: 'stream_tp',
    name: '全景视角 · 第三人称 (Third-Person)',
    type: 'video' as const,
    device: 'RealSense D435',
    res: '1920×1080',
    fps: 30,
    bitrate: '18.6 Mbps',
    latency: '15 ms',
    kind: 'tp' as const,
    active: true,
  },
  {
    id: 'stream_wrist',
    name: '末端手眼 · 腕部视角 (Wrist Cam)',
    type: 'video' as const,
    device: 'RealSense D435',
    res: '1280×720',
    fps: 30,
    bitrate: '12.8 Mbps',
    latency: '11 ms',
    kind: 'wrist' as const,
    active: true,
  },
  {
    id: 'stream_ft',
    name: '六维力觉动力学流 (6-DoF F/T)',
    type: 'scalar' as const,
    device: 'Robotiq FT-300 Sensor',
    sampleRate: '1000 Hz',
    channels: ['Fx', 'Fy', 'Fz', 'Tx', 'Ty', 'Tz'],
    active: true,
  },
  {
    id: 'stream_pose',
    name: '末端空间位姿与关节角 (Kinematics)',
    type: 'pose' as const,
    device: 'Franka Emika Research 3',
    sampleRate: '500 Hz',
    active: true,
  },
])

// 选中的单路特写通道
const focusedStreamId = ref('stream_fp')

// 动力学模拟实时数值
const forceValues = reactive({
  fx: 2.4,
  fy: -1.2,
  fz: 14.8,
  tx: 0.12,
  ty: 0.35,
  tz: -0.08,
})

const poseValues = reactive({
  x: 0.452,
  y: -0.128,
  z: 0.315,
  roll: 12.4,
  pitch: -5.1,
  yaw: 88.2,
  gripper: 42,
})

function toggleFault() {
  mon.fault = !mon.fault
  if (mon.fault) {
    alerts.add({
      level: 'crit',
      title: '第一视角相机掉帧率 6.8%',
      desc: '远超 ' + cfg.drop + '% 阈值，当前采集数据将被标记',
      time: '刚刚',
      route: 'monitor',
    })
    toast('已触发掉帧告警', { type: 'warn' })
  } else toast('相机已恢复正常')
}

// 动态时间戳
const streamTime = ref('14:32:01.420')
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => {
    mon.tick()
    // 刷新动力学微抖动
    if (!mon.paused) {
      forceValues.fx = +(2.4 + (Math.random() - 0.5) * 0.8).toFixed(2)
      forceValues.fy = +(-1.2 + (Math.random() - 0.5) * 0.6).toFixed(2)
      forceValues.fz = +(14.8 + (Math.random() - 0.5) * 1.5).toFixed(2)
      poseValues.x = +(0.452 + (Math.random() - 0.5) * 0.004).toFixed(3)
      poseValues.y = +(-0.128 + (Math.random() - 0.5) * 0.003).toFixed(3)
      poseValues.z = +(0.315 + (Math.random() - 0.5) * 0.004).toFixed(3)
      const now = new Date()
      const p = (n: number) => String(n).padStart(2, '0')
      const ms = String(now.getMilliseconds()).padStart(3, '0')
      streamTime.value = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}.${ms}`
    }
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <PageHead title="实时监控中心" desc="SDK 多模态数据流动态接入、硬件时序同步与传感器自适应视窗">
    <div class="row center" style="gap:8px">
      <!-- 布局切换控制器 -->
      <a-radio-group v-model:value="layoutMode" size="small" button-style="solid">
        <a-radio-button value="auto">自适应混合</a-radio-button>
        <a-radio-button value="grid22">四宫格</a-radio-button>
        <a-radio-button value="pip">画中画</a-radio-button>
        <a-radio-button value="single">单路特写</a-radio-button>
      </a-radio-group>

      <a-button :disabled="!mayEdit" :title="mayEdit ? undefined : NO_PERM" @click="toggleFault">
        <AppIcon name="bolt" /><span>{{ mon.fault ? '恢复正常' : '模拟相机掉帧' }}</span>
      </a-button>
      <a-button @click="mon.paused = !mon.paused">
        <AppIcon :name="mon.paused ? 'play' : 'pause'" /><span>{{ mon.paused ? '继续刷新' : '暂停刷新' }}</span>
      </a-button>
    </div>
  </PageHead>

  <div v-if="mon.fault" class="callout warn" style="margin-bottom:16px">
    <AppIcon name="alert" />
    <span>第一视角相机掉帧率升至 <b>6.8%</b>，远超容限阈值，当前采集批次将被标记为异常。请排查 USB 3.0 带宽或重启相机节点。</span>
  </div>

  <!-- 多通道数据概览卡片 -->
  <div class="grid g3" style="margin-bottom:16px">
    <ChannelCard v-for="c in CHANNELS" :key="c.id" :ch="c" />
  </div>

  <!-- 主屏监控区域：赛博多模态自适应动态视窗 -->
  <div class="cyber-monitor-card">
    <!-- 视窗顶部 HUD 工具栏 -->
    <div class="hud-topbar">
      <div class="row center" style="gap:12px">
        <div class="rec-badge" :class="{ paused: mon.paused }">
          <span class="dot" />
          <span>{{ mon.paused ? 'MONITOR PAUSED' : 'LIVE STREAMING' }}</span>
        </div>
        <span class="mono hud-clock">{{ streamTime }}</span>
        <span class="tag info" style="font-size:11px">PTP 时钟已对齐</span>
      </div>
      <div class="row center" style="gap:14px;font-size:12px">
        <span class="muted">SDK 活跃数据流: <b style="color:var(--text)">{{ sdkStreams.filter(s => s.active).length }} 路</b></span>
        <span class="muted">端到端同步抖动: <b :style="{ color: last > cfg.sync ? 'var(--crit)' : 'var(--good)' }">{{ last }} ms</b></span>
      </div>
    </div>

    <!-- 动态视窗排版主体 -->
    <div class="hud-screen-container" :class="'layout-' + layoutMode">
      <!-- 视频通道 1：主视角 -->
      <div
        v-if="layoutMode !== 'single' || focusedStreamId === 'stream_fp'"
        class="stream-viewport"
        :class="{ focused: focusedStreamId === 'stream_fp' }"
        @click="focusedStreamId = 'stream_fp'"
      >
        <div class="vp-overlay">
          <div class="vp-header">
            <span class="vp-title">CAM_01 · 第一人称 (FPV)</span>
            <span class="mono vp-tag">1280×720 @ 30fps</span>
          </div>
          <!-- 赛博瞄准准星 HUD -->
          <div class="cyber-crosshair">
            <div class="ch-center" />
            <div class="ch-h" />
            <div class="ch-v" />
            <span class="corner tl" /><span class="corner tr" /><span class="corner bl" /><span class="corner br" />
          </div>
          <div class="vp-footer">
            <span class="mono">RealSense D405 · 14.2 Mbps</span>
            <span class="mono" :class="mon.fault ? 'text-crit' : 'text-good'">
              {{ mon.fault ? 'DROP: 6.8% ⚠' : 'LATENCY: 12ms' }}
            </span>
          </div>
        </div>
        <div class="cam-scene-wrap">
          <CameraScene kind="fp" />
        </div>
      </div>

      <!-- 视频通道 2：第三人称全景 -->
      <div
        v-if="layoutMode !== 'single' || focusedStreamId === 'stream_tp'"
        class="stream-viewport"
        :class="{ focused: focusedStreamId === 'stream_tp' }"
        @click="focusedStreamId = 'stream_tp'"
      >
        <div class="vp-overlay">
          <div class="vp-header">
            <span class="vp-title">CAM_02 · 全景第三人称 (Overview)</span>
            <span class="mono vp-tag">1920×1080 @ 30fps</span>
          </div>
          <div class="cyber-crosshair mini">
            <div class="ch-center" />
            <span class="corner tl" /><span class="corner tr" /><span class="corner bl" /><span class="corner br" />
          </div>
          <div class="vp-footer">
            <span class="mono">RealSense D435 · 18.6 Mbps</span>
            <span class="mono text-good">LATENCY: 15ms</span>
          </div>
        </div>
        <div class="cam-scene-wrap">
          <CameraScene kind="tp" />
        </div>
      </div>

      <!-- 视频通道 3：末端手眼腕部视角 -->
      <div
        v-if="layoutMode !== 'single' || focusedStreamId === 'stream_wrist'"
        class="stream-viewport"
        :class="{ focused: focusedStreamId === 'stream_wrist' }"
        @click="focusedStreamId = 'stream_wrist'"
      >
        <div class="vp-overlay">
          <div class="vp-header">
            <span class="vp-title">CAM_03 · 腕部手眼 (Wrist)</span>
            <span class="mono vp-tag">1280×720 @ 30fps</span>
          </div>
          <div class="cyber-crosshair mini">
            <div class="ch-center" />
            <span class="corner tl" /><span class="corner tr" /><span class="corner bl" /><span class="corner br" />
          </div>
          <div class="vp-footer">
            <span class="mono">RealSense D435 · 12.8 Mbps</span>
            <span class="mono text-good">LATENCY: 11ms</span>
          </div>
        </div>
        <div class="cam-scene-wrap">
          <CameraScene kind="wrist" />
        </div>
      </div>

      <!-- 动态插槽 4：六维力觉与动力学时序插槽 (根据 SDK 是否接入传感器自适应展示) -->
      <div v-if="layoutMode !== 'single' || focusedStreamId === 'stream_ft'" class="stream-viewport sensor-slot">
        <div class="sensor-card">
          <div class="sc-head">
            <div class="row center" style="gap:6px">
              <AppIcon name="activity" size="sm" />
              <b>六维力传感器动力学流 (FT Sensor)</b>
            </div>
            <span class="mono tag" style="font-size:11px">1000 Hz · 实时</span>
          </div>
          <div class="sc-content">
            <!-- 力向量实时柱状/数值 HUD -->
            <div class="force-grid">
              <div class="force-axis">
                <span class="ax-label">Fx (N)</span>
                <div class="ax-bar-bg"><div class="ax-bar-val" :style="{ width: Math.abs(forceValues.fx * 10) + '%' }" /></div>
                <span class="mono ax-num">{{ forceValues.fx }}</span>
              </div>
              <div class="force-axis">
                <span class="ax-label">Fy (N)</span>
                <div class="ax-bar-bg"><div class="ax-bar-val" :style="{ width: Math.abs(forceValues.fy * 10) + '%' }" /></div>
                <span class="mono ax-num">{{ forceValues.fy }}</span>
              </div>
              <div class="force-axis highlight">
                <span class="ax-label">Fz (N)</span>
                <div class="ax-bar-bg"><div class="ax-bar-val main" :style="{ width: (forceValues.fz * 3.5) + '%' }" /></div>
                <span class="mono ax-num">{{ forceValues.fz }}</span>
              </div>
            </div>

            <!-- 力矩时序小波形模拟 -->
            <div class="torque-row">
              <div class="t-pill"><span class="t-lbl">Tx</span><span class="mono">{{ forceValues.tx }} N·m</span></div>
              <div class="t-pill"><span class="t-lbl">Ty</span><span class="mono">{{ forceValues.ty }} N·m</span></div>
              <div class="t-pill"><span class="t-lbl">Tz</span><span class="mono">{{ forceValues.tz }} N·m</span></div>
            </div>
          </div>
        </div>

        <!-- 空间位姿与机械臂末端坐标 (Kinematics Slot) -->
        <div class="sensor-card" style="margin-top:8px">
          <div class="sc-head">
            <div class="row center" style="gap:6px">
              <AppIcon name="cpu" size="sm" />
              <b>末端空间位姿 6-DoF (Pose)</b>
            </div>
            <span class="mono tag good" style="font-size:11px">500 Hz</span>
          </div>
          <div class="sc-content">
            <div class="pose-grid">
              <div class="pose-item"><span class="p-k">X (m)</span><span class="mono p-v">{{ poseValues.x }}</span></div>
              <div class="pose-item"><span class="p-k">Y (m)</span><span class="mono p-v">{{ poseValues.y }}</span></div>
              <div class="pose-item"><span class="p-k">Z (m)</span><span class="mono p-v">{{ poseValues.z }}</span></div>
              <div class="pose-item"><span class="p-k">Roll</span><span class="mono p-v">{{ poseValues.roll }}°</span></div>
              <div class="pose-item"><span class="p-k">Pitch</span><span class="mono p-v">{{ poseValues.pitch }}°</span></div>
              <div class="pose-item"><span class="p-k">Yaw</span><span class="mono p-v">{{ poseValues.yaw }}°</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 下方辅助监控分析：时间同步折线与通道告警流水 -->
  <div class="grid g-main" style="margin-top:16px">
    <div class="card">
      <div class="card-head">
        <div>
          <h2>多模态时间戳同步误差</h2>
          <div class="sub">多目视频、IMU、六维力觉与关节角时间戳对齐，目标 ≤ {{ cfg.sync }} ms</div>
        </div>
        <div>
          <StatusBadge :kind="last > cfg.sync ? 'crit' : 'good'" :text="`当前偏差 ${last} ms`" />
        </div>
      </div>
      <div class="card-body">
        <SyncChart :vals="mon.sync" :min="0" :max="20" :th="cfg.sync" label="同步误差折线图" />
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <h2>实时通道告警与事件</h2>
          <div class="sub">{{ openCount ? openCount + ' 条未确认告警' : '所有传感器流运转正常' }}</div>
        </div>
      </div>
      <div class="card-body">
        <AlertList />
      </div>
    </div>
  </div>
</template>

<style scoped>
.cyber-monitor-card {
  background: #090e1a;
  border: 1px solid rgba(22, 119, 255, 0.25);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 0 20px rgba(22, 119, 255, 0.05);
}

.hud-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: rgba(16, 27, 51, 0.85);
  border-bottom: 1px solid rgba(22, 119, 255, 0.2);
  backdrop-filter: blur(8px);
}

.rec-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #10b981;
}
.rec-badge .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
  animation: pulse-dot 1.4s infinite ease-in-out;
}
.rec-badge.paused {
  color: var(--warn);
}
.rec-badge.paused .dot {
  background: var(--warn);
  box-shadow: 0 0 8px var(--warn);
  animation: none;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.3; transform: scale(0.85); }
}

.hud-clock {
  font-size: 13px;
  color: #38bdf8;
  letter-spacing: 1px;
}

/* 视窗布局容器 */
.hud-screen-container {
  display: grid;
  gap: 12px;
  padding: 12px;
  background: #060a12;
  min-height: 440px;
}

/* 自适应混合布局 (默认) */
.hud-screen-container.layout-auto {
  grid-template-columns: repeat(2, 1fr);
}

/* 四宫格 2x2 */
.hud-screen-container.layout-grid22 {
  grid-template-columns: repeat(2, 1fr);
}

/* 画中画 (主屏放大 + 辅屏) */
.hud-screen-container.layout-pip {
  grid-template-columns: 2fr 1fr;
}

/* 单屏专注 */
.hud-screen-container.layout-single {
  grid-template-columns: 1fr;
}

/* 通用视窗插槽卡片 */
.stream-viewport {
  position: relative;
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow: hidden;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  transition: all 0.2s ease;
  cursor: pointer;
}
.stream-viewport:hover {
  border-color: rgba(22, 119, 255, 0.6);
  box-shadow: 0 0 16px rgba(22, 119, 255, 0.15);
}
.stream-viewport.focused {
  border-color: var(--accent);
}

.cam-scene-wrap {
  width: 100%;
  height: 100%;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.vp-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 10px 12px;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(6,10,18,0.7) 0%, transparent 25%, transparent 75%, rgba(6,10,18,0.85) 100%);
}

.vp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.vp-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #f1f5f9;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
}
.vp-tag {
  font-size: 11px;
  color: #38bdf8;
  background: rgba(14, 165, 233, 0.15);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(56, 189, 248, 0.3);
}

.vp-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #94a3b8;
}

.text-good { color: #10b981; }
.text-crit { color: #ef4444; font-weight: 700; }

/* 赛博准星动效 */
.cyber-crosshair {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90px;
  height: 90px;
  opacity: 0.4;
  pointer-events: none;
}
.cyber-crosshair.mini {
  width: 60px;
  height: 60px;
}
.ch-center {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 6px;
  transform: translate(-50%, -50%);
  border: 1px solid #38bdf8;
  border-radius: 50%;
}
.corner {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1px solid #38bdf8;
}
.corner.tl { top: 0; left: 0; border-right: none; border-bottom: none; }
.corner.tr { top: 0; right: 0; border-left: none; border-bottom: none; }
.corner.bl { bottom: 0; left: 0; border-right: none; border-top: none; }
.corner.br { bottom: 0; right: 0; border-left: none; border-top: none; }

/* 传感器动力学插槽 (Sensor Slot) */
.sensor-slot {
  background: #090e1a;
  padding: 10px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
}

.sensor-card {
  background: #111827;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 10px 12px;
}
.sc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  margin-bottom: 8px;
  color: #e2e8f0;
}
.sc-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 六维力条形图 */
.force-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.force-axis {
  display: grid;
  grid-template-columns: 50px 1fr 60px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.ax-label {
  color: #94a3b8;
  font-size: 11px;
}
.ax-bar-bg {
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}
.ax-bar-val {
  height: 100%;
  background: #38bdf8;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.ax-bar-val.main {
  background: #10b981;
}
.ax-num {
  text-align: right;
  font-size: 11.5px;
  color: #f8fafc;
}

.torque-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 4px;
}
.t-pill {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 11px;
  display: flex;
  justify-content: space-between;
}
.t-lbl { color: #64748b; }

/* 空间位姿栅格 */
.pose-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.pose-item {
  background: rgba(255, 255, 255, 0.03);
  padding: 4px 8px;
  border-radius: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
}
.p-k { color: #64748b; font-size: 11px; }
.p-v { color: #38bdf8; font-weight: 500; }

@media (max-width: 768px) {
  .hud-screen-container.layout-auto,
  .hud-screen-container.layout-grid22,
  .hud-screen-container.layout-pip {
    grid-template-columns: 1fr;
  }
}
</style>
