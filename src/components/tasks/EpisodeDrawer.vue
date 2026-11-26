<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import SignalGroupChart from './SignalGroupChart.vue'
import EpisodeWorld3D from './EpisodeWorld3D.vue'
import {
  episodesApi,
  type EpisodeDetail,
  type EpisodePreview,
  type EpisodePreviewVideo,
  type EpisodeSignals,
} from '@/api'
import { toast } from '@/composables/toast'

const props = defineProps<{
  episodeId: number | null
}>()

const emit = defineEmits<{
  close: []
}>()

const loading = ref(false)
const detail = ref<EpisodeDetail | null>(null)
const errorMsg = ref('')

const signalsLoading = ref(false)
const signals = ref<EpisodeSignals | null>(null)
const signalsError = ref('')

const refreshingPreview = ref(false)
const camView = ref<'all' | 'fisheye'>('all')
const showWorld3D = ref(true)
const activeSection = ref<'signals' | 'channels' | 'meta'>('signals')
const sideFilter = ref<'all' | 'left' | 'right' | 'other'>('all')

/* 播放同步状态 */
const playing = ref(false)
const currentMs = ref(0)
const speed = ref(1)
const muted = ref(false)
const videoEls = new Map<string, HTMLVideoElement>()
const audioEl = ref<HTMLAudioElement | null>(null)
let rafId: number | null = null
let expiryTimer: ReturnType<typeof setInterval> | null = null
let lastRefreshAt = 0
let pendingRestoreMs: number | null = null
let pendingRestorePlay = false

const preview = computed<EpisodePreview | null>(() => detail.value?.preview ?? null)
const durationMs = computed(() => preview.value?.duration_ms ?? detail.value?.duration_ms ?? 0)

const allVideos = computed<EpisodePreviewVideo[]>(() => preview.value?.videos ?? [])
const hasFisheyeSubset = computed(() => {
  if (allVideos.value.length <= 2) return false
  return allVideos.value.some((v) => /fisheye|鱼眼/i.test(v.camera + ' ' + v.label))
})
const visibleVideos = computed<EpisodePreviewVideo[]>(() => {
  if (camView.value === 'fisheye' && hasFisheyeSubset.value) {
    const fisheyes = allVideos.value.filter((v) => /fisheye|鱼眼/i.test(v.camera + ' ' + v.label))
    return fisheyes.length ? fisheyes : allVideos.value.slice(0, 2)
  }
  return allVideos.value
})

const SOURCE_LABELS: Record<string, string> = {
  vr: 'VR 遥操作',
  umi: 'UMI 手持',
  video: '视频上传',
  lerobot: 'LeRobot 导入',
}

function verdictBadge(v: EpisodeDetail['verdict']): { kind: 'good' | 'warn' | 'crit' | 'muted'; text: string } {
  if (v === 'ok') return { kind: 'good', text: '通过' }
  if (v === 'warn') return { kind: 'warn', text: '警告' }
  if (v === 'fail') return { kind: 'crit', text: '不通过' }
  return { kind: 'muted', text: '未校验' }
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—'
  const totalSec = Math.max(0, ms / 1000)
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec - mins * 60
  if (mins > 0) return `${String(mins).padStart(2, '0')}:${secs.toFixed(1).padStart(4, '0')}`
  return `${secs.toFixed(1)} s`
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.replace('T', ' ').replace(/\+08:00$/, '').slice(0, 19)
}

function setVideoRef(camera: string, el: any) {
  if (el && el instanceof HTMLVideoElement) {
    videoEls.set(camera, el)
    el.playbackRate = speed.value
  } else {
    videoEls.delete(camera)
  }
}

function isBlackFrame(v: EpisodePreviewVideo): boolean {
  const start = v.data_start_ms ?? 0
  const end = v.data_end_ms ?? v.duration_ms ?? durationMs.value
  return currentMs.value < start || currentMs.value > end
}

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

function pauseAllMedia() {
  playing.value = false
  stopLoop()
  videoEls.forEach((el) => {
    if (!el.paused) el.pause()
  })
  if (audioEl.value && !audioEl.value.paused) {
    audioEl.value.pause()
  }
}

function syncAudio(ms: number, shouldPlay: boolean) {
  const audio = preview.value?.audio
  const el = audioEl.value
  if (!audio || !el) return
  el.playbackRate = speed.value
  el.muted = muted.value
  const targetSec = (ms - (audio.offset_ms || 0)) / 1000
  if (targetSec < 0 || targetSec >= (audio.duration_ms || durationMs.value) / 1000) {
    if (!el.paused) el.pause()
    return
  }
  if (Math.abs(el.currentTime - targetSec) > 0.12) {
    try {
      el.currentTime = targetSec
    } catch {
      /* ignore */
    }
  }
  if (shouldPlay && !muted.value) {
    if (el.paused) el.play().catch(() => {})
  } else if (!el.paused) {
    el.pause()
  }
}

function seekTo(ms: number) {
  const clamped = Math.max(0, Math.min(durationMs.value || 0, Math.round(ms)))
  currentMs.value = clamped
  visibleVideos.value.forEach((v) => {
    const el = videoEls.get(v.camera)
    if (!el) return
    const targetSec = Math.max(0, (clamped - (v.offset_ms || 0)) / 1000)
    try {
      el.currentTime = targetSec
    } catch {
      /* ignore */
    }
  })
  syncAudio(clamped, playing.value)
}

function stepMs(delta: number) {
  seekTo(currentMs.value + delta)
}

function tickSync() {
  if (!playing.value) return
  const vids = visibleVideos.value
  const masterMeta = vids[0]
  const masterEl = masterMeta ? videoEls.get(masterMeta.camera) : undefined
  if (masterEl && masterMeta) {
    const tMs = Math.max(0, Math.min(durationMs.value, masterEl.currentTime * 1000 + (masterMeta.offset_ms || 0)))
    currentMs.value = tMs
    // 校准从路视频（超过 100ms 拉回主路时刻）
    for (let i = 1; i < vids.length; i++) {
      const v = vids[i]
      const el = videoEls.get(v.camera)
      if (!el) continue
      const expectedSec = Math.max(0, (tMs - (v.offset_ms || 0)) / 1000)
      if (Math.abs(el.currentTime - expectedSec) > 0.1) {
        try {
          el.currentTime = expectedSec
        } catch {
          /* ignore */
        }
      }
      if (el.paused && !masterEl.paused && expectedSec < (el.duration || Infinity)) {
        el.play().catch(() => {})
      }
    }
    syncAudio(tMs, true)
    if (masterEl.ended || (durationMs.value > 0 && tMs >= durationMs.value - 20)) {
      pauseAllMedia()
      currentMs.value = durationMs.value
      return
    }
  }
  rafId = requestAnimationFrame(tickSync)
}

async function togglePlay() {
  if (!visibleVideos.value.length) return
  if (playing.value) {
    pauseAllMedia()
    return
  }
  if (durationMs.value > 0 && currentMs.value >= durationMs.value - 50) {
    seekTo(0)
  }
  playing.value = true
  const vids = visibleVideos.value
  for (const v of vids) {
    const el = videoEls.get(v.camera)
    if (!el) continue
    el.playbackRate = speed.value
    const targetSec = Math.max(0, (currentMs.value - (v.offset_ms || 0)) / 1000)
    if (Math.abs(el.currentTime - targetSec) > 0.1) {
      try {
        el.currentTime = targetSec
      } catch {
        /* ignore */
      }
    }
    el.play().catch(() => {})
  }
  syncAudio(currentMs.value, true)
  stopLoop()
  rafId = requestAnimationFrame(tickSync)
}

function setSpeed(val: number) {
  speed.value = val
  videoEls.forEach((el) => {
    el.playbackRate = val
  })
  if (audioEl.value) audioEl.value.playbackRate = val
}

function toggleMute() {
  muted.value = !muted.value
  syncAudio(currentMs.value, playing.value)
}

function onVideoLoadedMetadata(camera: string) {
  const el = videoEls.get(camera)
  const meta = visibleVideos.value.find((v) => v.camera === camera)
  if (!el || !meta) return
  el.playbackRate = speed.value
  const targetMs = pendingRestoreMs ?? currentMs.value
  if (targetMs > 0) {
    const targetSec = Math.max(0, (targetMs - (meta.offset_ms || 0)) / 1000)
    try {
      el.currentTime = targetSec
    } catch {
      /* ignore */
    }
  }
  if (pendingRestorePlay) {
    el.play().catch(() => {})
  }
}

async function refreshPreview(silent = false) {
  if (!props.episodeId || refreshingPreview.value) return
  const now = Date.now()
  if (silent && now - lastRefreshAt < 15000) return
  lastRefreshAt = now
  refreshingPreview.value = true
  const savedMs = currentMs.value
  const wasPlaying = playing.value
  pauseAllMedia()
  try {
    const nextPreview = await episodesApi.getPreview(props.episodeId)
    if (detail.value) {
      pendingRestoreMs = savedMs
      pendingRestorePlay = wasPlaying
      detail.value = { ...detail.value, preview: nextPreview }
      await nextTick()
      seekTo(savedMs)
      if (wasPlaying) {
        await togglePlay()
      }
      setTimeout(() => {
        pendingRestoreMs = null
        pendingRestorePlay = false
      }, 1500)
    }
    if (!silent) toast('播放地址已刷新')
  } catch (err: any) {
    if (!silent) toast(err?.message || '刷新播放地址失败', { type: 'warn' })
  } finally {
    refreshingPreview.value = false
  }
}

function onMediaError() {
  // 签名过期或 403 时自动刷新一次地址
  refreshPreview(true)
}

function checkExpiry() {
  const exp = preview.value?.expires_at
  if (!exp || !props.episodeId) return
  const expMs = Date.parse(exp)
  if (!Number.isFinite(expMs)) return
  if (expMs - Date.now() < 10 * 60 * 1000) {
    refreshPreview(true)
  }
}

async function loadEpisode(id: number) {
  pauseAllMedia()
  loading.value = true
  errorMsg.value = ''
  detail.value = null
  signals.value = null
  signalsError.value = ''
  currentMs.value = 0
  camView.value = 'all'
  sideFilter.value = 'all'
  activeSection.value = 'signals'
  try {
    const data = await episodesApi.get(id)
    detail.value = data
    lastRefreshAt = Date.now()
    if (data.preview?.has_signals) {
      signalsLoading.value = true
      episodesApi
        .getSignals(id)
        .then((sig) => {
          signals.value = sig
        })
        .catch((err: any) => {
          signalsError.value = err?.message || '曲线数据加载失败'
        })
        .finally(() => {
          signalsLoading.value = false
        })
    } else {
      activeSection.value = 'channels'
    }
  } catch (err: any) {
    errorMsg.value = err?.message || '加载数据详情失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.episodeId,
  (id) => {
    if (expiryTimer) {
      clearInterval(expiryTimer)
      expiryTimer = null
    }
    if (id !== null) {
      loadEpisode(id)
      expiryTimer = setInterval(checkExpiry, 60000)
    } else {
      pauseAllMedia()
      detail.value = null
      signals.value = null
    }
  },
  { immediate: true },
)

watch(camView, async () => {
  const savedMs = currentMs.value
  const wasPlaying = playing.value
  pauseAllMedia()
  await nextTick()
  seekTo(savedMs)
  if (wasPlaying) togglePlay()
})

onBeforeUnmount(() => {
  pauseAllMedia()
  if (expiryTimer) clearInterval(expiryTimer)
})

const filteredGroups = computed(() => {
  const groups = signals.value?.groups ?? []
  if (sideFilter.value === 'all') return groups
  return groups.filter((g) => {
    if (sideFilter.value === 'left') return g.key.startsWith('left.') || g.label.includes('左手')
    if (sideFilter.value === 'right') return g.key.startsWith('right.') || g.label.includes('右手')
    return !g.key.startsWith('left.') && !g.key.startsWith('right.') && !g.label.includes('左手') && !g.label.includes('右手')
  })
})

const hasSideGroups = computed(() => {
  const groups = signals.value?.groups ?? []
  return groups.some((g) => g.key.startsWith('left.') || g.key.startsWith('right.'))
})

const metaDevices = computed<any[]>(() => {
  const devs = detail.value?.meta?.devices
  return Array.isArray(devs) ? devs : []
})

const channelCols = [
  { title: '通道名', dataIndex: 'name', key: 'name', align: 'center' as const, ellipsis: true },
  { title: '类型', dataIndex: 'type', key: 'type', width: 100, align: 'center' as const },
  { title: '手别', dataIndex: 'side', key: 'side', width: 80, align: 'center' as const },
  { title: '频率 (Hz)', dataIndex: 'rate', key: 'rate', width: 100, align: 'center' as const },
  { title: '帧数 / 点数', dataIndex: 'frames', key: 'frames', width: 110, align: 'center' as const },
]
</script>

<template>
  <a-drawer
    :open="episodeId !== null"
    placement="right"
    :width="'min(1180px, 94vw)'"
    :destroy-on-close="true"
    @close="emit('close')"
  >
    <template #title>
      <div class="ep-head-title">
        <span class="mono ep-id">#{{ episodeId }}</span>
        <span class="ep-fname" :title="detail?.file_name">{{ detail?.file_name || '数据详情' }}</span>
        <StatusBadge v-if="detail" :kind="verdictBadge(detail.verdict).kind" :text="verdictBadge(detail.verdict).text" />
        <span v-if="detail" class="tag">{{ SOURCE_LABELS[detail.source] || detail.source }}</span>
      </div>
    </template>
    <template #extra>
      <a-button v-if="preview" size="small" :loading="refreshingPreview" @click="refreshPreview(false)">
        <AppIcon name="refresh" size="sm" />刷新播放地址
      </a-button>
    </template>

    <a-spin :spinning="loading">
      <EmptyState v-if="errorMsg" icon="alert" title="加载失败" :desc="errorMsg">
        <a-button size="small" style="margin-top:8px" @click="episodeId && loadEpisode(episodeId)">重试</a-button>
      </EmptyState>

      <template v-else-if="detail">
        <!-- 基础元信息摘要条 -->
        <div class="ep-meta-grid">
          <div class="ep-meta-item">
            <span class="muted">场景</span>
            <b class="cell-ellipsis" :title="detail.scene_name || '—'">{{ detail.scene_name || '—' }}</b>
          </div>
          <div class="ep-meta-item">
            <span class="muted">所属数据集</span>
            <b class="cell-ellipsis" :title="detail.dataset_name || '—'">{{ detail.dataset_name || '—' }}</b>
          </div>
          <div class="ep-meta-item">
            <span class="muted">时长 / 帧数</span>
            <b class="mono">{{ fmtDuration(detail.duration_ms) }} · {{ detail.frame_count ?? '—' }} 帧</b>
          </div>
          <div class="ep-meta-item">
            <span class="muted">原始体量</span>
            <b class="mono">{{ fmtBytes(detail.size_bytes) }}</b>
          </div>
          <div class="ep-meta-item">
            <span class="muted">录制时间</span>
            <b class="mono">{{ fmtTime(detail.recorded_at) }}</b>
          </div>
          <div class="ep-meta-item">
            <span class="muted">入库状态 / 质量分</span>
            <b>{{ detail.ingest_state || '—' }} · {{ detail.quality_score ?? '未校验' }}</b>
          </div>
        </div>

        <!-- 多路同步视频区 -->
        <div class="ep-player-box">
          <div class="ep-player-bar">
            <div class="row" style="gap:8px;align-items:center">
              <b>多视角同步回放</b>
              <span v-if="preview" class="muted" style="font-size:12px">
                共 {{ allVideos.length }} 路视频{{ preview.audio ? ' · 含音频' : '' }}
              </span>
            </div>
            <div class="row" style="gap:8px;align-items:center">
              <div v-if="hasFisheyeSubset" class="seg" role="group" aria-label="画面模式">
                <button type="button" :aria-pressed="camView === 'all'" @click="camView = 'all'">全部画面 ({{ allVideos.length }}路)</button>
                <button type="button" :aria-pressed="camView === 'fisheye'" @click="camView = 'fisheye'">仅鱼眼 (省带宽)</button>
              </div>
              <a-button v-if="preview?.has_signals" size="small" :type="showWorld3D ? 'primary' : 'default'" @click="showWorld3D = !showWorld3D">
                {{ showWorld3D ? '隐藏世界坐标系' : '显示世界坐标系' }}
              </a-button>
            </div>
          </div>

          <EmptyState
            v-if="!preview || !allVideos.length"
            icon="camera"
            title="暂无可播放预览"
            desc="该数据条目尚未生成预览视频，请等待转码完成"
          />

          <template v-else>
            <div class="ep-stage-split" :class="{ 'with-3d': showWorld3D && preview.has_signals }">
              <div
                class="ep-video-grid"
                :class="{
                  single: visibleVideos.length === 1,
                  dual: visibleVideos.length === 2,
                  multi: visibleVideos.length >= 3,
                }"
              >
                <div v-for="v in visibleVideos" :key="v.camera" class="ep-video-tile">
                  <div class="ep-video-label">
                    <span>{{ v.label || v.camera }}</span>
                    <span class="mono muted">{{ v.width }}×{{ v.height }} · {{ v.fps }}fps</span>
                  </div>
                  <div class="ep-video-stage">
                    <video
                      :ref="(el) => setVideoRef(v.camera, el)"
                      :src="v.url"
                      muted
                      playsinline
                      preload="metadata"
                      @loadedmetadata="onVideoLoadedMetadata(v.camera)"
                      @error="onMediaError"
                    />
                    <div v-if="isBlackFrame(v)" class="ep-black-tip">无画面区间</div>
                  </div>
                </div>
              </div>
              <EpisodeWorld3D
                v-if="showWorld3D && preview.has_signals"
                :signals="signals"
                :current-ms="currentMs"
                :loading="signalsLoading"
              />
            </div>

            <!-- 独立同步音频轨道 -->
            <audio
              v-if="preview.audio"
              ref="audioEl"
              :src="preview.audio.url"
              preload="metadata"
              @error="onMediaError"
            />

            <!-- 统一播控栏 -->
            <div class="ep-transport">
              <a-button type="primary" size="small" @click="togglePlay">
                <AppIcon :name="playing ? 'pause' : 'play'" size="sm" />{{ playing ? '暂停' : '播放' }}
              </a-button>
              <a-button size="small" title="后退 1 秒" @click="stepMs(-1000)">-1s</a-button>
              <a-button size="small" title="前进 1 秒" @click="stepMs(1000)">+1s</a-button>
              <span class="mono ep-time">{{ fmtDuration(currentMs) }} / {{ fmtDuration(durationMs) }}</span>
              <div class="ep-slider-wrap">
                <a-slider
                  :value="currentMs"
                  :min="0"
                  :max="Math.max(durationMs, 1)"
                  :step="20"
                  :tooltip-open="false"
                  @change="(val: any) => seekTo(Number(val))"
                />
              </div>
              <a-select
                :value="speed"
                size="small"
                style="width:74px"
                :options="[
                  { value: 0.5, label: '0.5x' },
                  { value: 1, label: '1.0x' },
                  { value: 1.5, label: '1.5x' },
                  { value: 2, label: '2.0x' },
                ]"
                @change="(v: any) => setSpeed(Number(v))"
              />
              <a-tooltip
                v-if="preview.audio"
                :title="preview.audio.offset_estimated ? '含独立音频（偏移为估计值，可能存在数十毫秒误差）' : '开关音频'"
              >
                <a-button size="small" @click="toggleMute">
                  {{ muted ? '静音' : '有声' }}
                </a-button>
              </a-tooltip>
            </div>
          </template>
        </div>

        <!-- 下方 Tab：传感器曲线 / 通道清单 / 设备与校验元数据 -->
        <div class="ep-tabs-bar">
          <div class="cyber-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class="cyber-tab-item"
              :class="{ active: activeSection === 'signals' }"
              @click="activeSection = 'signals'"
            >
              <AppIcon name="activity" size="sm" />
              <span>时序曲线</span>
            </button>
            <button
              type="button"
              role="tab"
              class="cyber-tab-item"
              :class="{ active: activeSection === 'channels' }"
              @click="activeSection = 'channels'"
            >
              <AppIcon name="layers" size="sm" />
              <span>通道清单</span>
            </button>
            <button
              type="button"
              role="tab"
              class="cyber-tab-item"
              :class="{ active: activeSection === 'meta' }"
              @click="activeSection = 'meta'"
            >
              <AppIcon name="cpu" size="sm" />
              <span>设备与校验</span>
            </button>
          </div>

          <div v-if="activeSection === 'signals' && signals && hasSideGroups" class="seg" role="group">
            <button type="button" :aria-pressed="sideFilter === 'all'" @click="sideFilter = 'all'">全部 ({{ signals.groups.length }})</button>
            <button type="button" :aria-pressed="sideFilter === 'left'" @click="sideFilter = 'left'">左手</button>
            <button type="button" :aria-pressed="sideFilter === 'right'" @click="sideFilter = 'right'">右手</button>
          </div>
        </div>

        <!-- 曲线区 -->
        <div v-if="activeSection === 'signals'" class="ep-section">
          <a-spin :spinning="signalsLoading">
            <EmptyState
              v-if="signalsError"
              icon="alert"
              title="曲线加载失败"
              :desc="signalsError"
            />
            <EmptyState
              v-else-if="!preview?.has_signals || !signals?.groups?.length"
              icon="activity"
              title="无时序曲线数据"
              desc="该条目未包含传感器/轨迹曲线（例如纯视频导入数据）"
            />
            <template v-else>
              <div class="ep-sig-hint muted">
                采样率 {{ signals.rate_hz }} Hz · 共 {{ signals.count }} 个采样点 · 点击任意曲线位置可同步跳转视频画面
              </div>
              <div class="ep-sig-grid">
                <SignalGroupChart
                  v-for="g in filteredGroups"
                  :key="g.key"
                  :group="g"
                  :t="signals.t"
                  :duration-ms="signals.duration_ms || durationMs"
                  :rate-hz="signals.rate_hz || 50"
                  :current-ms="currentMs"
                  @seek="seekTo"
                />
              </div>
            </template>
          </a-spin>
        </div>

        <!-- 通道清单 -->
        <div v-else-if="activeSection === 'channels'" class="ep-section">
          <a-table
            size="small"
            row-key="name"
            :columns="channelCols"
            :data-source="detail.channels || []"
            :pagination="{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: false, showTotal: (n: number) => `共 ${n} 条` }"
          >
            <template #bodyCell="{ column, record }">
              <span v-if="column.key === 'name'" class="mono cell-ellipsis" :title="record.name">{{ record.name }}</span>
              <span v-else-if="column.key === 'side'">{{ record.side === 'left' ? '左手' : record.side === 'right' ? '右手' : (record.side || '—') }}</span>
              <span v-else-if="column.key === 'rate'" class="mono">{{ record.rate ?? '—' }}</span>
              <span v-else-if="column.key === 'frames'" class="mono">{{ record.frames ?? '—' }}</span>
            </template>
            <template #emptyText><EmptyState icon="inbox" title="暂无通道信息" /></template>
          </a-table>
        </div>

        <!-- 设备与校验元数据 -->
        <div v-else class="ep-section">
          <div class="ep-kv-grid">
            <div class="ep-kv"><span>完整度 (integrity)</span><b class="mono">{{ detail.integrity ?? '—' }}</b></div>
            <div class="ep-kv"><span>同步误差 (sync_err_ms)</span><b class="mono">{{ detail.sync_err_ms !== null && detail.sync_err_ms !== undefined ? `${detail.sync_err_ms} ms` : '—' }}</b></div>
            <div class="ep-kv"><span>最大丢帧间隔 (drop_max_ms)</span><b class="mono">{{ detail.drop_max_ms !== null && detail.drop_max_ms !== undefined ? `${detail.drop_max_ms} ms` : '—' }}</b></div>
            <div class="ep-kv"><span>存储层级</span><b class="mono">{{ detail.storage_tier || '—' }}</b></div>
            <div class="ep-kv"><span>采集员</span><b>{{ detail.operator_name || '—' }}</b></div>
            <div class="ep-kv"><span>入库时间</span><b class="mono">{{ fmtTime(detail.created_at) }}</b></div>
          </div>

          <div v-if="metaDevices.length" style="margin-top:14px">
            <div style="font-weight:600;margin-bottom:8px;font-size:13px">采集设备元数据</div>
            <div class="ep-dev-grid">
              <div v-for="(d, idx) in metaDevices" :key="idx" class="ep-dev-card">
                <div class="row" style="justify-content:space-between;margin-bottom:6px">
                  <b>{{ d.side === 'left' ? '左手设备' : d.side === 'right' ? '右手设备' : (d.side || `设备 ${idx + 1}`) }}</b>
                  <span v-if="d.role" class="tag">{{ d.role }}</span>
                </div>
                <div class="muted" style="font-size:12px;display:grid;gap:4px">
                  <div>序列号：<span class="mono">{{ d.sn || d.serial || '—' }}</span></div>
                  <div>固件版本：<span class="mono">{{ d.firmware || d.fw_version || '—' }}</span></div>
                  <div v-if="d.max_gripper_mm !== undefined || d.gripper_max_mm !== undefined">
                    夹爪最大开度：<span class="mono">{{ d.max_gripper_mm ?? d.gripper_max_mm }} mm</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </a-spin>
  </a-drawer>
</template>

<style scoped>
.ep-head-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 72vw;
}
.ep-id {
  color: var(--accent-text);
  font-size: 13px;
}
.ep-fname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ep-meta-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.ep-meta-item {
  background: rgba(15, 31, 53, 0.72);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  min-width: 0;
}
.ep-meta-item b {
  font-size: 13px;
  color: var(--text);
}
.ep-player-box {
  background: rgba(13, 27, 46, 0.8);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 14px;
}
.ep-player-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.ep-stage-split {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  align-items: stretch;
}
.ep-stage-split.with-3d {
  grid-template-columns: minmax(0, 1.8fr) minmax(300px, 1fr);
}
@media (max-width: 960px) {
  .ep-stage-split.with-3d {
    grid-template-columns: 1fr;
  }
}
.ep-video-grid {
  display: grid;
  gap: 10px;
}
.ep-video-grid.single {
  grid-template-columns: 1fr;
  max-width: 720px;
  margin: 0 auto;
}
.ep-video-grid.dual {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.ep-video-grid.multi {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.ep-video-tile {
  border: 1px solid rgba(46, 211, 230, 0.18);
  border-radius: 6px;
  overflow: hidden;
  background: #07101c;
}
.ep-video-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  font-size: 12px;
  background: rgba(22, 42, 69, 0.85);
  border-bottom: 1px solid rgba(46, 211, 230, 0.14);
}
.ep-video-stage {
  position: relative;
  aspect-ratio: 4 / 3;
  background: #000;
}
.ep-video-stage video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.ep-black-tip {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  background: rgba(8, 16, 30, 0.82);
  border: 1px solid rgba(255, 193, 92, 0.5);
  color: var(--warn);
}
.ep-transport {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  flex-wrap: wrap;
}
.ep-time {
  font-size: 12px;
  color: var(--accent-text);
  min-width: 112px;
  text-align: center;
}
.ep-slider-wrap {
  flex: 1;
  min-width: 160px;
  padding: 0 6px;
}
.ep-tabs-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.ep-sig-hint {
  font-size: 12px;
  margin-bottom: 10px;
}
.ep-sig-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.ep-kv-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.ep-kv {
  background: rgba(15, 31, 53, 0.72);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.ep-kv span {
  color: var(--muted);
}
.ep-dev-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.ep-dev-card {
  background: rgba(15, 31, 53, 0.72);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px 12px;
}
@media (max-width: 900px) {
  .ep-video-grid.multi,
  .ep-sig-grid,
  .ep-meta-grid,
  .ep-kv-grid {
    grid-template-columns: 1fr;
  }
}
</style>
