<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import type { EpisodePreview, EpisodePreviewVideo } from '@/api'
import type { Clip } from '@/stores/annotate'

const props = defineProps<{
  clip: Clip
  t: number
  playing: boolean
  speed?: number
  loading?: boolean
}>()
const emit = defineEmits<{ refresh: [] }>()

const camView = ref<'all' | 'fisheye'>('all')
const videoEls = new Map<string, HTMLVideoElement>()
const mediaError = ref(false)

const preview = computed<EpisodePreview | null>(() => props.clip.preview ?? null)
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

const gridCols = computed(() => {
  const n = visibleVideos.value.length
  if (n <= 1) return 1
  if (n <= 2) return 2
  if (n <= 4) return 2
  return 3
})

function setVideoRef(camera: string, el: any) {
  if (el && el instanceof HTMLVideoElement) {
    videoEls.set(camera, el)
    el.playbackRate = props.speed || 1
    syncOne(camera, el, true)
  } else {
    videoEls.delete(camera)
  }
}

function isBlackFrame(v: EpisodePreviewVideo): boolean {
  const ms = props.t * 1000
  const start = v.data_start_ms ?? 0
  const end = v.data_end_ms ?? v.duration_ms ?? props.clip.durationMs
  return ms < start || ms > end
}

function syncOne(camera: string, el: HTMLVideoElement, forceSeek = false) {
  const v = allVideos.value.find((x) => x.camera === camera)
  if (!v) return
  const targetSec = Math.max(0, props.t - (v.offset_ms || 0) / 1000)
  const maxSec = (v.duration_ms || props.clip.durationMs || 0) / 1000
  const clamped = maxSec > 0 ? Math.min(targetSec, maxSec) : targetSec
  el.playbackRate = props.speed || 1

  const drift = Math.abs(el.currentTime - clamped)
  if (forceSeek || (!props.playing && drift > 0.04) || (props.playing && drift > 0.35)) {
    try {
      if (el.readyState >= 1) el.currentTime = clamped
    } catch {
      /* ignore */
    }
  }
  if (props.playing && !isBlackFrame(v)) {
    if (el.paused) el.play().catch(() => {})
  } else if (!el.paused) {
    el.pause()
  }
}

function syncAll(forceSeek = false) {
  videoEls.forEach((el, camera) => syncOne(camera, el, forceSeek))
}

watch(() => props.t, () => syncAll(false))
watch(() => props.playing, () => syncAll(true))
watch(() => props.speed, () => {
  videoEls.forEach((el) => { el.playbackRate = props.speed || 1 })
})
watch(
  () => props.clip.numericId,
  () => {
    mediaError.value = false
    camView.value = 'all'
  }
)

onBeforeUnmount(() => {
  videoEls.forEach((el) => { if (!el.paused) el.pause() })
  videoEls.clear()
})
</script>

<template>
  <div class="vwall-wrap">
    <div v-if="allVideos.length" class="vwall-bar">
      <span class="muted" style="font-size:12px">
        共 {{ allVideos.length }} 路同步预览视频
        <template v-if="preview?.expires_at"> · 链接有效至 {{ preview.expires_at.replace('T', ' ').slice(11, 16) }}</template>
      </span>
      <div class="row" style="gap:6px">
        <div v-if="hasFisheyeSubset" class="vseg-mini">
          <button type="button" :class="{ active: camView === 'all' }" @click="camView = 'all'">全部 ({{ allVideos.length }})</button>
          <button type="button" :class="{ active: camView === 'fisheye' }" @click="camView = 'fisheye'">仅鱼眼</button>
        </div>
        <a-button size="small" type="text" @click="mediaError = false; emit('refresh')">
          <AppIcon name="refresh" size="sm" />刷新预览
        </a-button>
      </div>
    </div>

    <div v-if="loading && !allVideos.length" class="vwall-empty">
      <a-spin />
      <span class="muted">正在加载多路预览视频…</span>
    </div>

    <div v-else-if="visibleVideos.length" class="wall" :style="{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }">
      <div v-for="v in visibleVideos" :key="v.camera + '@' + v.url" class="cam wtile">
        <video
          :ref="(el) => setVideoRef(v.camera, el)"
          :src="v.url"
          class="vdo"
          muted
          playsinline
          preload="metadata"
          @loadedmetadata="syncAll(true)"
          @error="mediaError = true"
        />
        <div v-if="isBlackFrame(v)" class="black-mask">该视角当前时刻无画面</div>
        <span class="wname">{{ v.label || v.camera }}</span>
        <span class="wmeta mono">{{ v.width }}×{{ v.height }} · {{ Math.round(v.fps) }}fps</span>
      </div>
    </div>

    <div v-else class="vwall-empty">
      <AppIcon name="video" />
      <span>当前条目暂无可播放的预览视频</span>
      <a-button size="small" @click="emit('refresh')"><AppIcon name="refresh" size="sm" />尝试刷新预览地址</a-button>
    </div>

    <div v-if="mediaError" class="callout warn" style="margin-top:8px">
      <AppIcon name="alert" />
      <span class="grow">部分视频加载失败，可能是预览签名已过期。</span>
      <a-button size="small" @click="mediaError = false; emit('refresh')">刷新预览地址</a-button>
    </div>
  </div>
</template>

<style scoped>
.vwall-wrap { display: flex; flex-direction: column; gap: 6px; }
.vwall-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.vseg-mini { display: inline-flex; padding: 2px; border-radius: 6px; background: var(--surface-3); gap: 2px; }
.vseg-mini button { border: 0; background: none; color: var(--muted); font-size: 11.5px; padding: 2px 8px; border-radius: 4px; cursor: pointer; }
.vseg-mini button.active { background: var(--surface); color: var(--text); font-weight: 600; }
.wall { display: grid; gap: 8px; }
.wtile { position: relative; border-radius: 8px; overflow: hidden; background: #091322; border: 1px solid var(--line); }
.wtile.cam { aspect-ratio: 16 / 9; }
.vdo { width: 100%; height: 100%; object-fit: contain; display: block; background: #000; }
.black-mask { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(5, 10, 20, 0.86); color: var(--muted); font-size: 12px; pointer-events: none; }
.wname { position: absolute; left: 6px; top: 6px; padding: 1px 7px; border-radius: 4px; background: rgba(10, 18, 32, 0.78); color: #DCE8F6; font-size: 11px; }
.wmeta { position: absolute; right: 6px; bottom: 6px; padding: 1px 6px; border-radius: 4px; background: rgba(10, 18, 32, 0.72); color: #9FB6D2; font-size: 10.5px; }
.vwall-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 220px; border-radius: 8px; background: #0B1628; border: 1px dashed var(--line-strong); color: var(--muted); font-size: 13px; }
@media (max-width: 900px) { .wall { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }
@media (max-width: 600px) { .wall { grid-template-columns: 1fr !important; } }
</style>
