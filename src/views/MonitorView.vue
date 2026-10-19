<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
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
const cams = [
  { name: '第一视角', note: 'D405 · 640×480', kind: 'fp' },
  { name: '第三视角', note: 'D435 · 1280×720', kind: 'tp' },
  { name: '腕部视角', note: 'D435 · 1280×720', kind: 'wrist' },
] as const

function toggleFault() {
  mon.fault = !mon.fault
  if (mon.fault) {
    alerts.add({ level: 'crit', title: '第一视角相机掉帧率 6.8%', desc: '远超 ' + cfg.drop + '% 阈值，当前采集数据将被标记', time: '刚刚', route: 'monitor' })
    toast('已触发掉帧告警', { type: 'warn' })
  } else toast('相机已恢复正常')
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => mon.tick(), 1000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>
<template>
  <PageHead title="实时监控" desc="多模态通道状态、同步误差与采集画面 · 每秒刷新">
    <a-button :disabled="!mayEdit" :title="mayEdit ? undefined : NO_PERM" @click="toggleFault">
      <AppIcon name="bolt" /><span>{{ mon.fault ? '恢复正常' : '模拟相机掉帧' }}</span>
    </a-button>
    <a-button @click="mon.paused = !mon.paused">
      <AppIcon :name="mon.paused ? 'play' : 'pause'" /><span>{{ mon.paused ? '继续刷新' : '暂停刷新' }}</span>
    </a-button>
  </PageHead>
  <div v-if="mon.fault" class="callout warn">
    <AppIcon name="alert" /><span>第一视角相机掉帧率升至 <b>6.8%</b>，当前采集的数据会被标记为不合格。请检查 USB 线缆或重启相机。</span>
  </div>
  <div class="grid g3"><ChannelCard v-for="c in CHANNELS" :key="c.id" :ch="c" /></div>
  <div class="grid g-main">
    <div class="card">
      <div class="card-head">
        <div><h2>时间同步误差</h2><div class="sub">各通道相对时间戳偏差，目标 ≤ {{ cfg.sync }} ms</div></div>
        <div><StatusBadge :kind="last > cfg.sync ? 'crit' : 'good'" :text="`当前 ${last} ms`" /></div>
      </div>
      <div class="card-body"><SyncChart :vals="mon.sync" :min="0" :max="20" :th="cfg.sync" label="同步误差折线图" /></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div><h2>通道告警</h2><div class="sub">{{ openCount ? openCount + ' 条未确认' : '无未确认告警' }}</div></div>
      </div>
      <div class="card-body"><AlertList /></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><div><h2>采集画面预览</h2><div class="sub">示意画面，实际接入后显示 RealSense 彩色流</div></div></div>
    <div class="card-body">
      <div class="grid g3">
        <div v-for="c in cams" :key="c.kind">
          <div class="cam">
            <CameraScene :kind="c.kind" />
            <div class="ov"><span class="rec" :class="{ off: mon.paused }">{{ mon.paused ? '已暂停' : '● REC' }}</span><span>{{ c.name }}</span></div>
            <div class="note">{{ c.note }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
