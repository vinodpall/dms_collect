<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import {
  ApiError,
  DirectUploadError,
  importsApi,
  uploadFileDirect,
  type DatasetOption,
  type ImportJobDetail,
  type ImportStatus,
  type LocalRecordingItem,
  type LocalRecordingsResult,
} from '@/api'
import { useDict } from '@/stores/dict'
import { useSession } from '@/stores/session'
import { confirmDlg } from '@/composables/confirm'
import { toast } from '@/composables/toast'

export type ImportMode = 'video' | 'umi_upload' | 'umi_server'

const props = defineProps<{
  open: boolean
  initialMode?: ImportMode
  jobId?: number | null
}>()

const emit = defineEmits<{
  close: []
  changed: []
  openEpisode: [episodeId: number]
}>()

const dict = useDict()
const session = useSession()
const mayOperate = computed(() => session.can('tasks'))

const mode = ref<ImportMode>('video')
const sceneId = ref<number | undefined>(undefined)
const datasetMode = ref<'existing' | 'new'>('existing')
const datasetId = ref<number | undefined>(undefined)
const datasetName = ref('')
const datasetOpts = ref<DatasetOption[]>([])
const datasetLoading = ref(false)

/* 本地待上传文件 */
interface LocalFileItem {
  name: string
  size: number
  file: File
  status: 'pending' | 'uploading' | 'done' | 'error'
  loaded: number
  error?: string
  uploadUrl?: string
}
const pickedFiles = ref<LocalFileItem[]>([])
const dirInputRef = ref<HTMLInputElement | null>(null)
const videoInputRef = ref<HTMLInputElement | null>(null)
const skippedFiles = ref<string[]>([])

/* 服务器目录录制 */
const localRecLoading = ref(false)
const localRec = ref<LocalRecordingsResult | null>(null)
const localRecFilter = ref<'all' | 'ready'>('all')
const selectedDirs = ref<string[]>([])

/* 当前导入任务详情 */
const job = ref<ImportJobDetail | null>(null)
const jobLoading = ref(false)
const submitting = ref(false)
const uploading = ref(false)
const confirming = ref(false)
const abandoning = ref(false)
const keepWarn = ref(true)
const errorBanner = ref('')

let pollTimer: ReturnType<typeof setInterval> | null = null
let uploadAbort: AbortController | null = null

const MAX_FILES = 2000
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024 // 5 GB
const MAX_RECORDINGS = 20

const sceneOpts = computed(() =>
  (dict.scenes || []).map((s) => ({
    value: s.id,
    label: s.name || s.short_name || s.scene_key,
  })),
)

const serverImportEnabled = computed(() => localRec.value?.enabled !== false)

const visibleLocalRecordings = computed<LocalRecordingItem[]>(() => {
  const items = localRec.value?.items ?? []
  if (localRecFilter.value === 'ready') return items.filter((i) => i.state === 'ready')
  return items
})

const totalUploadBytes = computed(() => pickedFiles.value.reduce((s, f) => s + f.size, 0))
const uploadedBytes = computed(() => pickedFiles.value.reduce((s, f) => s + f.loaded, 0))
const uploadPercent = computed(() => {
  if (!totalUploadBytes.value) return 0
  return Math.min(100, Math.round((uploadedBytes.value / totalUploadBytes.value) * 100))
})

const STATUS_BADGE: Record<ImportStatus, ['good' | 'warn' | 'crit' | 'accent' | 'muted', string]> = {
  uploading: ['accent', '上传中'],
  validating: ['accent', '校验中'],
  validated: ['warn', '待确认'],
  confirmed: ['good', '已入库'],
  failed: ['crit', '失败'],
  canceled: ['muted', '已放弃'],
}

const REC_STATE_BADGE: Record<LocalRecordingItem['state'], ['good' | 'warn' | 'crit' | 'accent' | 'muted', string]> = {
  ready: ['good', '可导入'],
  copying: ['warn', '拷贝中'],
  incomplete: ['crit', '不完整'],
  importing: ['accent', '导入中'],
  imported: ['muted', '已入库'],
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtDurMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  return `${(ms / 1000).toFixed(1)} s`
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.replace('T', ' ').replace(/\+08:00$/, '').slice(0, 19)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startPolling(id: number) {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const latest = await importsApi.get(id)
      job.value = latest
      if (latest.status !== 'validating') {
        stopPolling()
        emit('changed')
      }
    } catch {
      /* 下轮重试 */
    }
  }, 2000)
}

async function fetchDatasetOptions() {
  datasetLoading.value = true
  try {
    const opts = await importsApi.getDatasetOptions(sceneId.value ? { scene_id: sceneId.value } : undefined)
    datasetOpts.value = Array.isArray(opts) ? opts : []
    if (datasetMode.value === 'existing') {
      if (!datasetOpts.value.some((d) => d.id === datasetId.value)) {
        datasetId.value = datasetOpts.value[0]?.id
      }
    }
  } catch {
    datasetOpts.value = []
    datasetId.value = undefined
  } finally {
    datasetLoading.value = false
  }
}

async function fetchLocalRecordings() {
  localRecLoading.value = true
  try {
    const res = await importsApi.getLocalRecordings()
    localRec.value = res
    if (!res.enabled && mode.value === 'umi_server') {
      mode.value = 'umi_upload'
    }
    const readySet = new Set(res.items.filter((i) => i.state === 'ready').map((i) => i.dir))
    selectedDirs.value = selectedDirs.value.filter((d) => readySet.has(d))
  } catch (err: any) {
    toast(err?.message || '获取服务器目录录制失败', { type: 'warn' })
  } finally {
    localRecLoading.value = false
  }
}

async function loadJob(id: number) {
  stopPolling()
  jobLoading.value = true
  errorBanner.value = ''
  try {
    const data = await importsApi.get(id)
    job.value = data
    keepWarn.value = true
    if (data.status === 'validating') {
      startPolling(data.id)
    }
  } catch (err: any) {
    errorBanner.value = err?.message || '获取导入任务详情失败'
  } finally {
    jobLoading.value = false
  }
}

function resetCreateState() {
  stopPolling()
  uploadAbort?.abort()
  uploadAbort = null
  job.value = null
  pickedFiles.value = []
  skippedFiles.value = []
  selectedDirs.value = []
  datasetName.value = ''
  datasetMode.value = 'existing'
  errorBanner.value = ''
  keepWarn.value = true
  uploading.value = false
  submitting.value = false
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      stopPolling()
      uploadAbort?.abort()
      return
    }
    if (!dict.scenes.length) {
      await dict.fetchAll()
    }
    if (props.jobId) {
      resetCreateState()
      await loadJob(props.jobId)
      return
    }
    resetCreateState()
    mode.value = props.initialMode || 'video'
    if (!sceneId.value || !dict.scenes.some((s) => s.id === sceneId.value)) {
      sceneId.value = dict.scenes[0]?.id
    }
    await Promise.all([fetchDatasetOptions(), fetchLocalRecordings()])
  },
  { immediate: true },
)

watch(sceneId, () => {
  if (props.open && !job.value) {
    fetchDatasetOptions()
  }
})

watch(mode, () => {
  errorBanner.value = ''
  pickedFiles.value = []
  skippedFiles.value = []
  selectedDirs.value = []
  if (mode.value === 'umi_server' && props.open) {
    fetchLocalRecordings()
  }
})

onBeforeUnmount(() => {
  stopPolling()
  uploadAbort?.abort()
})

function onPickVideoFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const list = Array.from(input.files || [])
  input.value = ''
  errorBanner.value = ''
  const existing = new Set(pickedFiles.value.map((f) => f.name))
  for (const file of list) {
    if (!/\.(mp4|mov|mkv)$/i.test(file.name)) {
      toast(`${file.name} 格式不支持，仅支持 mp4 / mov / mkv`, { type: 'warn' })
      continue
    }
    if (file.size > MAX_FILE_SIZE) {
      toast(`${file.name} 超过 5 GB 限制`, { type: 'warn' })
      continue
    }
    if (existing.has(file.name)) continue
    if (pickedFiles.value.length >= MAX_FILES) {
      toast(`单次最多选择 ${MAX_FILES} 个文件`, { type: 'warn' })
      break
    }
    existing.add(file.name)
    pickedFiles.value.push({ name: file.name, size: file.size, file, status: 'pending', loaded: 0 })
  }
}

function onPickUmiDir(e: Event) {
  const input = e.target as HTMLInputElement
  const list = Array.from(input.files || [])
  input.value = ''
  errorBanner.value = ''
  const next: LocalFileItem[] = []
  const seen = new Set<string>()
  for (const file of list) {
    const rel = (file as any).webkitRelativePath || file.name
    if (seen.has(rel)) continue
    if (file.size > MAX_FILE_SIZE) {
      toast(`${rel} 超过 5 GB 限制`, { type: 'warn' })
      return
    }
    if (next.length >= MAX_FILES) {
      toast(`单次最多导入 ${MAX_FILES} 个文件`, { type: 'warn' })
      break
    }
    seen.add(rel)
    next.push({ name: rel, size: file.size, file, status: 'pending', loaded: 0 })
  }
  pickedFiles.value = next
  const hasMeta = next.some((f) => /(^|\/)meta_info\.json$/i.test(f.name))
  if (next.length && !hasMeta) {
    errorBanner.value = '所选目录中未检测到 meta_info.json，请选择 UMI 设备目录或其上一级录制目录'
  }
}

function toggleRecordingDir(dir: string, checked: boolean) {
  if (checked) {
    if (selectedDirs.value.length >= MAX_RECORDINGS) {
      toast(`单次最多选择 ${MAX_RECORDINGS} 条录制`, { type: 'warn' })
      return
    }
    if (!selectedDirs.value.includes(dir)) selectedDirs.value = [...selectedDirs.value, dir]
  } else {
    selectedDirs.value = selectedDirs.value.filter((d) => d !== dir)
  }
}

const canCreate = computed(() => {
  if (!mayOperate.value || submitting.value) return false
  if (!sceneId.value) return false
  if (datasetMode.value === 'existing' && !datasetId.value) return false
  if (datasetMode.value === 'new' && !datasetName.value.trim()) return false
  if (mode.value === 'umi_server') return selectedDirs.value.length > 0
  if (mode.value === 'umi_upload') {
    return pickedFiles.value.length > 0 && pickedFiles.value.some((f) => /(^|\/)meta_info\.json$/i.test(f.name))
  }
  return pickedFiles.value.length > 0
})

async function runUploadPool(jobIdVal: number, targets: LocalFileItem[]) {
  uploading.value = true
  uploadAbort = new AbortController()
  const signal = uploadAbort.signal
  const queue = targets.filter((t) => t.status !== 'done' && t.uploadUrl)
  let cursor = 0
  const CONCURRENCY = 3

  async function worker() {
    while (cursor < queue.length) {
      if (signal.aborted) return
      const item = queue[cursor++]
      item.status = 'uploading'
      item.error = undefined
      try {
        await uploadFileDirect(
          item.uploadUrl!,
          item.file,
          (loaded) => {
            item.loaded = loaded
          },
          signal,
        )
        item.status = 'done'
        item.loaded = item.size
      } catch (err: any) {
        if (err instanceof DirectUploadError && err.status === 403 && !signal.aborted) {
          // 签名过期自动刷新一次
          try {
            const refreshed = await importsApi.refreshUploadUrls(jobIdVal, [item.name])
            const newTarget = refreshed.uploads?.find((u) => u.name === item.name)
            if (newTarget?.upload_url) {
              item.uploadUrl = newTarget.upload_url
              await uploadFileDirect(
                item.uploadUrl,
                item.file,
                (loaded) => {
                  item.loaded = loaded
                },
                signal,
              )
              item.status = 'done'
              item.loaded = item.size
              continue
            }
          } catch (retryErr: any) {
            item.status = 'error'
            item.error = retryErr?.message || '刷新上传地址后重试失败'
            continue
          }
        }
        item.status = 'error'
        item.error = err?.message || '上传失败'
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()))
  uploading.value = false
}

async function triggerValidate(jobIdVal: number) {
  submitting.value = true
  errorBanner.value = ''
  try {
    const res = await importsApi.validate(jobIdVal)
    job.value = res
    emit('changed')
    if (res.status === 'validating') {
      startPolling(res.id)
    }
  } catch (err: any) {
    if (err instanceof ApiError && err.code === 40901 && Array.isArray(err.data?.missing)) {
      const missing: string[] = err.data.missing
      const missingSet = new Set(missing)
      pickedFiles.value.forEach((f) => {
        if (missingSet.has(f.name)) {
          f.status = 'error'
          f.loaded = 0
          f.error = '存储中缺少此文件，请补传'
        }
      })
      errorBanner.value = `${err.message}（缺失 ${missing.length} 个文件：${missing.slice(0, 5).join('、')}${missing.length > 5 ? '…' : ''}）`
    } else {
      errorBanner.value = err?.message || '提交校验失败'
    }
  } finally {
    submitting.value = false
  }
}

async function retryFailedUploads() {
  if (!job.value) return
  const failed = pickedFiles.value.filter((f) => f.status !== 'done')
  if (!failed.length) {
    await triggerValidate(job.value.id)
    return
  }
  errorBanner.value = ''
  try {
    const refreshed = await importsApi.refreshUploadUrls(
      job.value.id,
      failed.map((f) => f.name),
    )
    const urlMap = new Map((refreshed.uploads || []).map((u) => [u.name, u.upload_url]))
    failed.forEach((f) => {
      const u = urlMap.get(f.name)
      if (u) f.uploadUrl = u
      f.status = 'pending'
      f.loaded = 0
      f.error = undefined
    })
    await runUploadPool(job.value.id, failed)
    const stillFailed = pickedFiles.value.filter((f) => f.status === 'error')
    if (!stillFailed.length) {
      await triggerValidate(job.value.id)
    } else {
      errorBanner.value = `仍有 ${stillFailed.length} 个文件上传失败，请重试`
    }
  } catch (err: any) {
    errorBanner.value = err?.message || '刷新上传地址失败'
  }
}

async function submitCreate() {
  if (!canCreate.value || !sceneId.value) return
  errorBanner.value = ''
  submitting.value = true
  try {
    const basePayload: any = {
      kind: mode.value === 'video' ? 'video' : 'umi',
      scene_id: sceneId.value,
    }
    if (datasetMode.value === 'existing') {
      basePayload.dataset_id = datasetId.value
    } else {
      basePayload.dataset_name = datasetName.value.trim()
    }

    if (mode.value === 'umi_server') {
      basePayload.recordings = selectedDirs.value
      const created = await importsApi.create(basePayload)
      job.value = created
      emit('changed')
      toast('已提交服务器目录导入，正在后台校验与转码')
      if (created.status === 'validating') {
        startPolling(created.id)
      }
      return
    }

    // 浏览器上传（video 或 umi_upload）
    basePayload.files = pickedFiles.value.map((f) => ({ name: f.name, size: f.size }))
    const created = await importsApi.create(basePayload)
    job.value = created
    skippedFiles.value = created.skipped || []
    emit('changed')

    const urlMap = new Map((created.uploads || []).map((u) => [u.name, u.upload_url]))
    const toUpload: LocalFileItem[] = []
    pickedFiles.value.forEach((f) => {
      const url = urlMap.get(f.name)
      if (url) {
        f.uploadUrl = url
        f.status = 'pending'
        f.loaded = 0
        toUpload.push(f)
      } else {
        // 已被后端 skipped 过滤掉的隐藏/系统文件
        f.status = 'done'
        f.loaded = f.size
      }
    })

    submitting.value = false
    await runUploadPool(created.id, toUpload)
    const failed = toUpload.filter((f) => f.status !== 'done')
    if (failed.length) {
      errorBanner.value = `${failed.length} 个文件上传失败，可点击“重试失败文件”补传`
      return
    }
    await triggerValidate(created.id)
  } catch (err: any) {
    if (err instanceof ApiError && err.code === 40901 && Array.isArray(err.data?.blocked)) {
      const lines = err.data.blocked.map((b: any) => `${b.dir}（${b.state}）：${(b.messages || []).join('；') || '当前不可导入'}`)
      errorBanner.value = `${err.message}：${lines.join(' | ')}`
      fetchLocalRecordings()
    } else if (err instanceof ApiError && err.code === 40001 && Array.isArray(err.data?.missing)) {
      errorBanner.value = `${err.message}：目录不存在（${err.data.missing.join('、')}）`
      fetchLocalRecordings()
    } else {
      errorBanner.value = err?.message || '新建导入任务失败'
    }
  } finally {
    submitting.value = false
  }
}

async function doConfirm() {
  if (!job.value) return
  confirming.value = true
  errorBanner.value = ''
  try {
    const res = await importsApi.confirm(job.value.id, keepWarn.value)
    job.value = res
    emit('changed')
    toast(`已确认入库，共入库 ${res.episode_count} 条数据`)
  } catch (err: any) {
    errorBanner.value = err?.message || '确认入库失败'
  } finally {
    confirming.value = false
  }
}

async function doAbandon() {
  if (!job.value) return
  const ok = await confirmDlg({
    title: '放弃此次导入？',
    msg:
      job.value.origin === 'server'
        ? '放弃后本次导入记录将置为已放弃，已生成的临时预览会被清理，服务器原始目录文件不受影响。'
        : '放弃后已上传的文件和临时预览将一并删除且无法恢复，确认继续吗？',
    ok: '确认放弃',
    danger: true,
  })
  if (!ok) return
  abandoning.value = true
  uploadAbort?.abort()
  stopPolling()
  errorBanner.value = ''
  try {
    const res = await importsApi.abandon(job.value.id)
    job.value = res
    emit('changed')
    toast('已放弃此次导入')
  } catch (err: any) {
    errorBanner.value = err?.message || '放弃导入失败'
  } finally {
    abandoning.value = false
  }
}

function jumpEpisode(epId: number) {
  emit('close')
  emit('openEpisode', epId)
}

function openExistingJob(id: number) {
  resetCreateState()
  loadJob(id)
}

const recCols = [
  { title: '选择', key: 'pick', width: 56, align: 'center' as const },
  { title: '录制目录', key: 'dir', width: 165, align: 'center' as const, ellipsis: true },
  { title: '状态', key: 'state', width: 92, align: 'center' as const },
  { title: '设备 / 轨迹', key: 'devices', width: 145, align: 'center' as const, ellipsis: true },
  { title: '时长', key: 'duration', width: 78, align: 'center' as const },
  { title: '体量 / 文件', key: 'size', width: 118, align: 'center' as const },
  { title: '说明 / 跳转', key: 'info', align: 'center' as const, ellipsis: true },
]

const itemCols = [
  { title: '封面', key: 'thumb', width: 72, align: 'center' as const },
  { title: '名称', key: 'name', width: 175, align: 'center' as const, ellipsis: true },
  { title: '结论', key: 'verdict', width: 82, align: 'center' as const },
  { title: '时长 / 规格', key: 'spec', width: 165, align: 'center' as const, ellipsis: true },
  { title: '说明', key: 'messages', align: 'center' as const, ellipsis: true },
  { title: '操作', key: 'act', width: 96, align: 'center' as const },
]
</script>

<template>
  <a-drawer
    :open="open"
    placement="right"
    :width="'min(860px, 94vw)'"
    :destroy-on-close="true"
    @close="emit('close')"
  >
    <template #title>
      <div class="row" style="gap:8px;align-items:center">
        <span>{{ job ? `导入任务 #${job.id}` : '导入数据' }}</span>
        <StatusBadge v-if="job" :kind="STATUS_BADGE[job.status][0]" :text="STATUS_BADGE[job.status][1]" />
        <span v-if="job" class="tag">{{ job.kind === 'umi' ? (job.origin === 'server' ? 'UMI 服务器目录' : 'UMI 目录上传') : '视频上传' }}</span>
      </div>
    </template>

    <a-spin :spinning="jobLoading">
      <a-alert
        v-if="errorBanner"
        type="error"
        show-icon
        closable
        :message="errorBanner"
        style="margin-bottom:12px"
        @close="errorBanner = ''"
      />

      <!-- 阶段一：新建导入 -->
      <template v-if="!job">
        <div class="imp-mode-bar">
          <div class="cyber-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class="cyber-tab-item"
              :class="{ active: mode === 'video' }"
              @click="mode = 'video'"
            >
              <AppIcon name="camera" size="sm" />
              <span>视频上传</span>
            </button>
            <button
              type="button"
              role="tab"
              class="cyber-tab-item"
              :class="{ active: mode === 'umi_upload' }"
              @click="mode = 'umi_upload'"
            >
              <AppIcon name="layers" size="sm" />
              <span>UMI 目录上传</span>
            </button>
            <button
              v-if="serverImportEnabled"
              type="button"
              role="tab"
              class="cyber-tab-item"
              :class="{ active: mode === 'umi_server' }"
              @click="mode = 'umi_server'"
            >
              <AppIcon name="drive" size="sm" />
              <span>服务器目录导入</span>
            </button>
          </div>
        </div>

        <a-form layout="vertical" class="imp-form">
          <div class="imp-row">
            <a-form-item label="所属场景" required style="flex:1">
              <a-select
                v-model:value="sceneId"
                :options="sceneOpts"
                placeholder="请选择场景"
                show-search
                option-filter-prop="label"
              />
            </a-form-item>
            <a-form-item label="目标数据集" required style="flex:1.5">
              <div class="row" style="gap:8px;margin-bottom:6px">
                <a-radio-group v-model:value="datasetMode" size="small" button-style="solid">
                  <a-radio-button value="existing">已有数据集</a-radio-button>
                  <a-radio-button value="new">新建草稿数据集</a-radio-button>
                </a-radio-group>
              </div>
              <a-select
                v-if="datasetMode === 'existing'"
                v-model:value="datasetId"
                :loading="datasetLoading"
                placeholder="选择该场景下的已有数据集"
                show-search
                option-filter-prop="label"
                :options="datasetOpts.map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` }))"
              />
              <a-input
                v-else
                v-model:value="datasetName"
                placeholder="输入新草稿数据集名称（如：11 月 UMI 实采）"
                :maxlength="80"
              />
            </a-form-item>
          </div>

          <!-- 模式 A：视频上传 -->
          <template v-if="mode === 'video'">
            <a-form-item label="选择视频文件（支持 mp4 / mov / mkv，单文件 ≤ 5 GB，最多 2000 个）" required>
              <input
                ref="videoInputRef"
                type="file"
                multiple
                accept=".mp4,.mov,.mkv"
                style="display:none"
                @change="onPickVideoFiles"
              />
              <div class="imp-drop" @click="videoInputRef?.click()">
                <AppIcon name="download" />
                <div>点击选择视频文件（可多选，浏览器直传对象存储）</div>
                <small class="muted">已选 {{ pickedFiles.length }} 个文件 · 合计 {{ fmtBytes(totalUploadBytes) }}</small>
              </div>
              <div v-if="pickedFiles.length" class="imp-file-list">
                <div v-for="(f, idx) in pickedFiles" :key="f.name" class="imp-file-row">
                  <span class="mono cell-ellipsis" :title="f.name">{{ f.name }}</span>
                  <span class="mono muted">{{ fmtBytes(f.size) }}</span>
                  <a style="color:var(--crit)" @click="pickedFiles.splice(idx, 1)">移除</a>
                </div>
              </div>
            </a-form-item>
          </template>

          <!-- 模式 B：UMI 原始目录上传 -->
          <template v-else-if="mode === 'umi_upload'">
            <a-form-item label="选择 UMI 原始录制目录（请勿打包成 zip，目录中需包含 meta_info.json）" required>
              <input
                ref="dirInputRef"
                type="file"
                webkitdirectory
                directory
                multiple
                style="display:none"
                @change="onPickUmiDir"
              />
              <div class="imp-drop" @click="dirInputRef?.click()">
                <AppIcon name="layers" />
                <div>点击选择 UMI 设备目录或其上一级录制目录</div>
                <small class="muted">
                  已选 {{ pickedFiles.length }} 个文件 · 合计 {{ fmtBytes(totalUploadBytes) }}（将保留相对路径直传）
                </small>
              </div>
              <div v-if="pickedFiles.length" class="imp-file-list">
                <div v-for="f in pickedFiles.slice(0, 40)" :key="f.name" class="imp-file-row">
                  <span class="mono cell-ellipsis" :title="f.name">{{ f.name }}</span>
                  <span class="mono muted">{{ fmtBytes(f.size) }}</span>
                </div>
                <div v-if="pickedFiles.length > 40" class="muted" style="font-size:12px;padding:4px 8px">
                  … 其余 {{ pickedFiles.length - 40 }} 个文件已略去预览
                </div>
              </div>
            </a-form-item>
          </template>

          <!-- 模式 C：服务器目录导入（仅 UMI） -->
          <template v-else>
            <div class="imp-rec-bar">
              <div class="row" style="gap:8px;align-items:center">
                <b>服务器目录中的 UMI 录制</b>
                <span v-if="localRec" class="muted" style="font-size:12px">
                  共 {{ localRec.total }} 条 · 文件静默 {{ localRec.stable_seconds }} 秒后视为拷贝完成 · 单次最多选 20 条
                </span>
              </div>
              <div class="row" style="gap:8px">
                <a-radio-group v-model:value="localRecFilter" size="small">
                  <a-radio-button value="all">全部</a-radio-button>
                  <a-radio-button value="ready">仅可导入</a-radio-button>
                </a-radio-group>
                <a-button size="small" :loading="localRecLoading" @click="fetchLocalRecordings">
                  <AppIcon name="refresh" size="sm" />刷新目录
                </a-button>
              </div>
            </div>

            <a-table
              size="small"
              row-key="dir"
              :loading="localRecLoading"
              :columns="recCols"
              :data-source="visibleLocalRecordings"
              :pagination="{ pageSize: 8, showSizeChanger: false, hideOnSinglePage: false, showTotal: (n: number) => `共 ${n} 条` }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'pick'">
                  <a-checkbox
                    :disabled="record.state !== 'ready'"
                    :checked="selectedDirs.includes(record.dir)"
                    @change="(e: any) => toggleRecordingDir(record.dir, e.target.checked)"
                  />
                </template>
                <template v-else-if="column.key === 'dir'">
                  <div class="cell-main">
                    <span class="mono" :title="record.dir">{{ record.dir }}</span>
                    <small class="muted">{{ fmtTime(record.recorded_at) }}</small>
                  </div>
                </template>
                <template v-else-if="column.key === 'state'">
                  <StatusBadge
                    :kind="REC_STATE_BADGE[record.state as LocalRecordingItem['state']][0]"
                    :text="record.state_label || REC_STATE_BADGE[record.state as LocalRecordingItem['state']][1]"
                  />
                </template>
                <template v-else-if="column.key === 'devices'">
                  <span
                    class="cell-ellipsis"
                    :title="record.devices?.map((d: any) => `${d.side === 'left' ? '左' : d.side === 'right' ? '右' : d.side}:${d.sn || d.dir}`).join(' / ')"
                  >
                    {{ record.devices?.length || 0 }} 台{{ record.has_trajectory ? ' · 含轨迹' : '' }}
                  </span>
                </template>
                <template v-else-if="column.key === 'duration'">
                  <span class="mono">{{ record.duration_s !== null && record.duration_s !== undefined ? `${record.duration_s.toFixed(1)} s` : '—' }}</span>
                </template>
                <template v-else-if="column.key === 'size'">
                  <span class="mono muted">{{ fmtBytes(record.size_bytes) }} / {{ record.file_count }}</span>
                </template>
                <template v-else-if="column.key === 'info'">
                  <template v-if="record.state === 'importing' && record.import_job_id">
                    <a @click="openExistingJob(record.import_job_id)">查看导入 #{{ record.import_job_id }}</a>
                  </template>
                  <template v-else-if="record.state === 'imported' && record.episode_ids?.length">
                    <a @click="jumpEpisode(record.episode_ids[0])">查看数据 #{{ record.episode_ids[0] }}</a>
                  </template>
                  <template v-else-if="record.state === 'copying'">
                    <span class="muted">文件拷贝中，请稍后刷新</span>
                  </template>
                  <template v-else-if="record.messages?.length">
                    <span class="cell-ellipsis" style="color:var(--crit)" :title="record.messages.join('；')">
                      {{ record.messages.join('；') }}
                    </span>
                  </template>
                  <span v-else class="muted">可勾选导入</span>
                </template>
              </template>
              <template #emptyText>
                <EmptyState icon="drive" title="服务器目录暂无录制" desc="将 UMI 存储卡内容拷贝至服务器指定目录后点击刷新" />
              </template>
            </a-table>
          </template>
        </a-form>

        <div class="imp-footer">
          <span v-if="mode === 'umi_server'" class="muted" style="font-size:12px">
            已勾选 {{ selectedDirs.length }} 条录制（校验含六路视频转码，无需浏览器上传）
          </span>
          <span v-else class="muted" style="font-size:12px">
            文件将由浏览器直传对象存储，完成后自动进入后台校验
          </span>
          <div class="row" style="gap:8px">
            <a-button @click="emit('close')">取消</a-button>
            <a-button type="primary" :loading="submitting" :disabled="!canCreate" @click="submitCreate">
              {{ mode === 'umi_server' ? '提交校验' : '开始上传并校验' }}
            </a-button>
          </div>
        </div>
      </template>

      <!-- 阶段二：任务进度 / 校验结果 / 确认入库 / 已完成 -->
      <template v-else>
        <!-- 顶部基础信息 -->
        <div class="imp-job-meta">
          <div><span class="muted">文件数</span><b class="mono">{{ job.file_count }}</b></div>
          <div><span class="muted">总大小</span><b class="mono">{{ fmtBytes(job.size_bytes) }}</b></div>
          <div><span class="muted">来源</span><b>{{ job.origin === 'server' ? '服务器目录' : '浏览器上传' }}</b></div>
          <div><span class="muted">已入库条目</span><b class="mono">{{ job.episode_count }}</b></div>
        </div>

        <a-alert
          v-if="skippedFiles.length"
          type="info"
          show-icon
          style="margin-bottom:12px"
          :message="`已自动忽略 ${skippedFiles.length} 个系统/隐藏文件（如 .DS_Store / Thumbs.db）`"
        />

        <!-- uploading：直传进度 -->
        <div v-if="job.status === 'uploading'" class="imp-stage-card">
          <div class="row" style="justify-content:space-between;margin-bottom:8px">
            <b>文件直传进度</b>
            <span class="mono muted">{{ fmtBytes(uploadedBytes) }} / {{ fmtBytes(totalUploadBytes) }}</span>
          </div>
          <a-progress :percent="uploadPercent" status="active" />
          <div v-if="pickedFiles.length" class="imp-file-list" style="margin-top:10px">
            <div v-for="f in pickedFiles" :key="f.name" class="imp-file-row">
              <span class="mono cell-ellipsis" :title="f.name">{{ f.name }}</span>
              <span class="mono muted">{{ fmtBytes(f.loaded) }} / {{ fmtBytes(f.size) }}</span>
              <StatusBadge
                :kind="f.status === 'done' ? 'good' : f.status === 'error' ? 'crit' : f.status === 'uploading' ? 'accent' : 'muted'"
                :text="f.status === 'done' ? '已上传' : f.status === 'error' ? (f.error || '失败') : f.status === 'uploading' ? '上传中' : '等待中'"
              />
            </div>
          </div>
          <a-alert
            v-else
            type="warning"
            show-icon
            style="margin-top:10px"
            message="页面刷新后浏览器无法保留原文件对象，如需继续请重新发起导入，或点击下方放弃此记录。"
          />
          <div class="imp-footer" style="margin-top:14px">
            <a-button danger :loading="abandoning" :disabled="uploading || !mayOperate" @click="doAbandon">放弃导入</a-button>
            <div class="row" style="gap:8px">
              <a-button
                v-if="pickedFiles.length"
                type="primary"
                :loading="uploading || submitting"
                :disabled="!mayOperate"
                @click="retryFailedUploads"
              >
                {{ pickedFiles.some((f) => f.status !== 'done') ? '重试失败文件并校验' : '提交校验' }}
              </a-button>
            </div>
          </div>
        </div>

        <!-- validating：后台轮询校验中 -->
        <div v-else-if="job.status === 'validating'" class="imp-stage-card">
          <div class="row" style="justify-content:space-between;margin-bottom:8px">
            <b>正在后台校验与转码（每 2 秒自动更新）</b>
            <span class="mono" style="color:var(--accent-text)">{{ job.progress }}%</span>
          </div>
          <a-progress :percent="job.progress" status="active" />
          <div class="muted" style="font-size:12.5px;margin-top:6px">
            当前阶段：{{ job.progress_text || '排队处理中…' }}
          </div>
          <div class="imp-footer" style="margin-top:14px">
            <a-button danger :loading="abandoning" :disabled="!mayOperate" @click="doAbandon">放弃导入</a-button>
            <a-button @click="emit('close')">后台运行，稍后在“导入记录”查看</a-button>
          </div>
        </div>

        <!-- validated / confirmed / failed / canceled -->
        <template v-else>
          <a-alert
            v-if="job.status === 'failed'"
            type="error"
            show-icon
            style="margin-bottom:12px"
            :message="job.error_msg || '校验失败或没有可入库的数据条目'"
          />
          <a-alert
            v-else-if="job.status === 'confirmed'"
            type="success"
            show-icon
            style="margin-bottom:12px"
            :message="`已确认入库，共写入 ${job.episode_count} 条数据条目，可在下方直接点击“查看回放”或在“采集历史”中查看。`"
          />
          <a-alert
            v-else-if="job.status === 'canceled'"
            type="warning"
            show-icon
            style="margin-bottom:12px"
            message="该导入任务已放弃。"
          />

          <!-- Summary 汇总 -->
          <div v-if="job.summary" class="imp-summary">
            <span>总计 <b>{{ job.summary.total }}</b> 条</span>
            <span style="color:var(--good)">通过 <b>{{ job.summary.ok }}</b></span>
            <span style="color:var(--warn)">警告 <b>{{ job.summary.warn }}</b></span>
            <span style="color:var(--crit)">不通过 <b>{{ job.summary.fail }}</b></span>
          </div>

          <!-- 四项固定校验结论 -->
          <div v-if="job.checks?.length" class="imp-checks">
            <div v-for="c in job.checks" :key="c.key" class="imp-check-row">
              <StatusBadge
                :kind="c.status === 'ok' ? 'good' : c.status === 'warn' ? 'warn' : 'crit'"
                :text="c.status === 'ok' ? '通过' : c.status === 'warn' ? '警告' : '不通过'"
              />
              <b>{{ c.label }}</b>
              <span class="muted">{{ c.detail }}</span>
            </div>
          </div>

          <a-alert
            v-if="job.ignored?.length"
            type="info"
            show-icon
            style="margin-bottom:12px"
            :message="`有 ${job.ignored.length} 个未归属任何条目的文件将被忽略（${job.ignored.slice(0, 5).join('、')}${job.ignored.length > 5 ? '…' : ''}）`"
          />

          <!-- 逐条校验明细表 -->
          <a-table
            v-if="job.items?.length"
            size="small"
            row-key="index"
            :columns="itemCols"
            :data-source="job.items"
            :pagination="{ pageSize: 8, showSizeChanger: false, hideOnSinglePage: false, showTotal: (n: number) => `共 ${n} 条` }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'thumb'">
                <img v-if="record.thumb_url" :src="record.thumb_url" alt="" class="imp-thumb" />
                <span v-else class="muted">—</span>
              </template>
              <template v-else-if="column.key === 'name'">
                <span class="mono cell-ellipsis" :title="record.name">{{ record.name }}</span>
              </template>
              <template v-else-if="column.key === 'verdict'">
                <StatusBadge
                  :kind="record.verdict === 'ok' ? 'good' : record.verdict === 'warn' ? 'warn' : 'crit'"
                  :text="record.verdict === 'ok' ? '通过' : record.verdict === 'warn' ? '警告' : '不通过'"
                />
              </template>
              <template v-else-if="column.key === 'spec'">
                <span class="mono muted cell-ellipsis">
                  {{ fmtDurMs(record.duration_ms) }}
                  <template v-if="record.video"> · {{ record.video.width }}×{{ record.video.height }} {{ record.video.fps }}fps</template>
                  <template v-if="record.camera_count"> · {{ record.camera_count }}路</template>
                </span>
              </template>
              <template v-else-if="column.key === 'messages'">
                <span
                  v-if="record.messages?.length"
                  class="cell-ellipsis"
                  :style="{ color: record.verdict === 'fail' ? 'var(--crit)' : 'var(--warn)' }"
                  :title="record.messages.join('；')"
                >
                  {{ record.messages.join('；') }}
                </span>
                <span v-else-if="record.duplicate_of" style="color:var(--crit)">与条目 #{{ record.duplicate_of }} 重复</span>
                <span v-else class="muted">{{ record.has_trajectory ? '含轨迹位姿' : '—' }}</span>
              </template>
              <template v-else-if="column.key === 'act'">
                <a v-if="record.episode_id" @click="jumpEpisode(record.episode_id)">查看回放</a>
                <span v-else class="muted">—</span>
              </template>
            </template>
          </a-table>

          <!-- 底部操作栏 -->
          <div class="imp-footer" style="margin-top:14px">
            <div>
              <a-checkbox v-if="job.status === 'validated' && (job.summary?.warn || 0) > 0" v-model:checked="keepWarn">
                同时入库带警告（warn）的数据
              </a-checkbox>
            </div>
            <div class="row" style="gap:8px">
              <a-button
                v-if="job.status === 'validated' || job.status === 'failed'"
                danger
                :loading="abandoning"
                :disabled="!mayOperate"
                @click="doAbandon"
              >
                放弃导入
              </a-button>
              <a-button
                v-if="job.status === 'failed'"
                type="primary"
                :loading="submitting"
                :disabled="!mayOperate"
                @click="triggerValidate(job.id)"
              >
                重新校验
              </a-button>
              <a-button
                v-if="job.status === 'validated'"
                type="primary"
                :loading="confirming"
                :disabled="!mayOperate"
                @click="doConfirm"
              >
                确认入库
              </a-button>
              <a-button v-if="job.status === 'confirmed' || job.status === 'canceled'" type="primary" @click="emit('close')">
                完成
              </a-button>
            </div>
          </div>
        </template>
      </template>
    </a-spin>
  </a-drawer>
</template>

<style scoped>
.imp-mode-bar {
  margin-bottom: 14px;
}
.imp-row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.imp-drop {
  border: 1px dashed rgba(46, 211, 230, 0.42);
  border-radius: 6px;
  background: rgba(15, 31, 53, 0.65);
  padding: 20px 16px;
  text-align: center;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transition: border-color 0.15s, background 0.15s;
}
.imp-drop:hover {
  border-color: var(--cyan);
  background: rgba(38, 198, 218, 0.08);
}
.imp-file-list {
  margin-top: 8px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(13, 27, 46, 0.7);
}
.imp-file-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 6px 10px;
  font-size: 12.5px;
  border-bottom: 1px solid rgba(43, 74, 109, 0.45);
}
.imp-file-row:last-child {
  border-bottom: none;
}
.imp-rec-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.imp-job-meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.imp-job-meta > div {
  background: rgba(15, 31, 53, 0.72);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
}
.imp-job-meta b {
  font-size: 14px;
  color: var(--text);
}
.imp-stage-card {
  background: rgba(15, 31, 53, 0.72);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 14px;
}
.imp-summary {
  display: flex;
  gap: 18px;
  align-items: center;
  padding: 10px 14px;
  border-radius: 6px;
  background: rgba(15, 31, 53, 0.72);
  border: 1px solid var(--line);
  margin-bottom: 12px;
  font-size: 13px;
}
.imp-checks {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 6px;
  background: rgba(15, 31, 53, 0.72);
  border: 1px solid var(--line);
  margin-bottom: 12px;
  font-size: 13px;
}
.imp-check-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.imp-thumb {
  width: 56px;
  height: 36px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--line);
  display: block;
  margin: 0 auto;
}
.imp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  flex-wrap: wrap;
}
</style>
