<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import ClipList from '@/components/annotate/ClipList.vue'
import VideoWall from '@/components/annotate/VideoWall.vue'
import SliceTimeline from '@/components/annotate/SliceTimeline.vue'
import EpisodeWorld3D from '@/components/tasks/EpisodeWorld3D.vue'
import { fmtT } from '@/components/annotate/motion'
import {
  CLIP_ST,
  colorOf,
  newSegId,
  useAnnotate,
  type Clip,
  type ClipStatus,
  type Seg,
} from '@/stores/annotate'
import { usePipeline } from '@/stores/pipeline'
import { useDict } from '@/stores/dict'
import { NO_PERM, type BadgeKind } from '@/constants'
import { episodesApi, type CheckReportOut, type EpisodeSignals } from '@/api'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'
import { clamp } from '@/utils'

const store = useAnnotate()
const dict = useDict()
const pl = usePipeline()
const session = useSession()
const route = useRoute()
const router = useRouter()

const canLabel = computed(() => session.can('annotate'))
const batchFilter = computed(() => (typeof route.query.batch === 'string' ? route.query.batch : ''))

const view = ref<'pool' | 'mine'>('mine')
const poolSceneId = ref<number | 'all'>('all')
const claimN = ref(5)
const busy = ref(false)
const savingDraft = ref(false)
const submitting = ref(false)
const historyOpen = ref(false)

const sceneOpts = computed(() => [
  { value: 'all', label: '全部场景' },
  ...dict.scenes.map((s) => ({ value: s.id, label: s.name })),
])

const FILTERS = computed<[string, string, number][]>(() => {
  const m = store.summary?.mine
  return [
    ['todo', '待标注', m?.todo ?? 0],
    ['rejected', '已驳回', m?.rejected ?? 0],
    ['submitted', '已提交', m?.submitted ?? 0],
    ['approved', '已通过', m?.approved ?? 0],
  ]
})

const poolCount = computed(() => store.summary?.pool ?? 0)
const mineCount = computed(() => {
  const m = store.summary?.mine
  if (!m) return 0
  return m.todo + m.rejected + m.submitted + m.approved
})
const minePending = computed(() => store.summary?.mine_pending ?? 0)

const clip = computed<Clip | undefined>(() => store.byNumericId(store.curId))
const inPool = computed(() => !!clip.value && clip.value.inPool)
const editable = computed(() => canLabel.value && !!clip.value && clip.value.editable)

async function loadList(keepCur = true) {
  const batchObj = batchFilter.value ? pl.batches.find((b) => b.id === batchFilter.value) : undefined
  const params: Parameters<typeof store.fetchItems>[0] = {
    view: view.value,
    status: view.value === 'mine' ? (store.filter as ClipStatus) : undefined,
    scene_id: view.value === 'pool' && poolSceneId.value !== 'all' ? poolSceneId.value : undefined,
    batch_id: batchObj?.numericId,
    keyword: batchFilter.value && !batchObj ? batchFilter.value : undefined,
  }
  try {
    const items = await store.fetchItems(params)
    if (!items.length) {
      store.curId = null
      return
    }
    if (!keepCur || !items.some((c) => c.numericId === store.curId)) {
      await pick(items[0].numericId)
    }
  } catch (err: any) {
    toast(err?.message || '加载标注列表失败', { type: 'warn' })
  }
}

const signals = ref<EpisodeSignals | null>(null)
const signalsLoading = ref(false)
let signalReqSeq = 0

async function pick(id: number) {
  store.curId = id
  t.value = 0
  playing.value = false
  sel.value = null
  signals.value = null
  const seq = ++signalReqSeq
  try {
    const detail = await store.fetchDetail(id)
    if (seq !== signalReqSeq) return
    if (detail && detail.inPool && detail.preview?.has_signals) {
      signalsLoading.value = true
      episodesApi
        .getSignals(detail.episodeId)
        .then((s) => {
          if (seq === signalReqSeq) signals.value = s
        })
        .catch(() => {
          if (seq === signalReqSeq) signals.value = null
        })
        .finally(() => {
          if (seq === signalReqSeq) signalsLoading.value = false
        })
    }
  } catch (err: any) {
    toast(err?.message || '加载条目详情失败', { type: 'warn' })
  }
}

watch([view, () => store.filter, poolSceneId, batchFilter], () => {
  loadList(false)
})

async function doClaim(x?: Clip) {
  busy.value = true
  try {
    const payload = x
      ? { ids: [x.numericId] }
      : { count: claimN.value, scene_id: poolSceneId.value !== 'all' ? poolSceneId.value : undefined }
    const res = await store.claim(payload)
    if (!res.claimed.length) {
      toast('任务池中没有可领取的数据', { type: 'warn' })
      return
    }
    toast(`已领取 ${res.claimed.length} 条，可开始标注`)
    const firstId = res.claimed[0].id
    if (view.value !== 'mine' || store.filter !== 'todo') {
      view.value = 'mine'
      store.filter = 'todo'
    }
    await loadList(false)
    await pick(firstId)
  } catch (err: any) {
    toast(err?.message || '领取失败', { type: 'crit' })
  } finally {
    busy.value = false
  }
}

async function doRelease() {
  const c = clip.value
  if (!c) return
  if (!(await confirmDlg({ title: '放回任务池？', msg: '放回后其他标注员可以领取；已保存的切片草稿会保留。', ok: '放回' }))) return
  busy.value = true
  try {
    await store.release(c.numericId)
    toast('已放回任务池')
    await loadList(false)
  } catch (err: any) {
    toast(err?.message || '放回任务池失败', { type: 'crit' })
  } finally {
    busy.value = false
  }
}

async function refreshPreview() {
  const c = clip.value
  if (!c) return
  try {
    await store.refreshUrls(c.numericId)
    toast('预览地址已刷新')
  } catch (err: any) {
    toast(err?.message || '刷新预览地址失败', { type: 'warn' })
  }
}

/* 播放控制 */
const t = ref(0)
const playing = ref(false)
const speed = ref(1)
const sel = ref<number | null>(null)
let timer: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  timer = setInterval(() => {
    if (!playing.value || !clip.value || !clip.value.dur) return
    t.value = Math.min(clip.value.dur, +(t.value + 0.1 * speed.value).toFixed(2))
    if (t.value >= clip.value.dur) playing.value = false
  }, 100)
  window.addEventListener('keydown', onKey, true)

  if (!dict.items.length) dict.fetchAll().catch(() => {})
  const sum = await store.fetchSummary()
  if (sum && sum.mine_pending === 0 && sum.pool > 0) {
    view.value = 'pool'
  }
  await loadList(false)
})

function toggle() {
  if (!clip.value || !clip.value.dur) return
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  if (t.value >= clip.value.dur) t.value = 0
  playing.value = !playing.value
}

/* 编辑状态计算 */
const sorted = computed(() => (clip.value ? clip.value.segs.slice().sort((a, b) => a.s - b.s) : []))
const coverage = computed(() => {
  if (!clip.value || !clip.value.dur) return 0
  return Math.min(100, Math.round((sorted.value.reduce((a, s) => a + Math.max(0, s.e - s.s), 0) / clip.value.dur) * 100))
})
const nowSeg = computed(() => sorted.value.find((s) => t.value >= s.s && t.value < s.e))
const subOpts = computed(() => {
  if (!clip.value) return []
  const actions = dict.actionsFor(clip.value.scen || undefined)
  const list = actions.length ? actions : dict.actionsFor()
  return list.map((x) => ({
    value: x.name,
    label: x.name + (x.level === 'abnormal' ? '（异常）' : ''),
  }))
})

function nextName(c: Clip) {
  const l = dict.sequenceFor(c.scen)
  const fallback = dict.actionsFor(c.scen || undefined).map((x) => x.name)
  const poolNames = l.length ? l : fallback
  return poolNames.find((n) => !c.segs.some((s) => s.n === n)) ?? poolNames[0] ?? '未命名'
}

function onSegLabelChange(seg: Seg) {
  if (!clip.value) return
  seg.dictItemId = store.resolveDictItemId(seg.n, seg.dictItemId, clip.value.scen)
  changed()
}

/** 规则预切分（调用后端 POST /annotation/items/{id}/presplit） */
async function doPresplit(how: 'seq' | 'force') {
  const c = clip.value
  if (!c || !editable.value) return
  if (c.segs.length && !(await confirmDlg({ title: '覆盖当前切片？', msg: `当前已有 ${c.segs.length} 个切片，预切分会替换它们（可用 Ctrl+Z 撤销）。`, ok: '覆盖' }))) return
  busy.value = true
  try {
    recordHistory()
    const res = await store.presplit(c, how)
    sel.value = c.segs[0]?.id ?? null
    const tip = res.note || `已生成 ${res.segments.length} 个建议切片，微调后请保存草稿`
    toast(tip)
  } catch (err: any) {
    toast(err?.message || '预切分失败', { type: 'warn' })
  } finally {
    busy.value = false
  }
}

/* 撤销管理 */
const hasUndo = computed(() => (clip.value ? store.canUndo(clip.value.numericId) : false))
function recordHistory() {
  if (clip.value) store.pushHistory(clip.value.numericId, clip.value.segs)
}
function undo() {
  const c = clip.value
  if (!c || !editable.value) return
  const prev = store.popHistory(c.numericId)
  if (prev) {
    c.segs = prev
    sel.value = null
    toast('已撤销上一步操作')
  } else {
    toast('无可撤销的操作记录', { type: 'warn' })
  }
}

function changed() {
  recordHistory()
}

function splitOrAdd() {
  const c = clip.value
  if (!c || !editable.value) return

  const seg = c.segs.find((s) => t.value - s.s >= 0.3 && s.e - t.value >= 0.3)
  if (seg) {
    recordHistory()
    const cut = Math.round(t.value * 10) / 10
    const name = nextName(c)
    const n: Seg = {
      id: newSegId(),
      serverId: null,
      dictItemId: store.resolveDictItemId(name, 0, c.scen),
      s: cut,
      e: seg.e,
      n: name,
      source: 'manual',
    }
    seg.e = cut
    c.segs.push(n)
    sel.value = n.id
    toast(`已在 ${cut}s 处切分切片 [${n.n}]`)
    return
  }

  const sortedSegs = c.segs.slice().sort((a, b) => a.s - b.s)
  const nextSeg = sortedSegs.find((s) => s.s > t.value)
  const maxEnd = nextSeg ? nextSeg.s : c.dur
  const curStart = Math.round(t.value * 10) / 10

  if (maxEnd - curStart < 0.3) {
    toast('当前位置可用时长过短（小于 0.3s），无法创建切片', { type: 'warn' })
    return
  }

  const curEnd = Math.round(Math.min(curStart + 2.5, maxEnd) * 10) / 10
  recordHistory()
  const name = nextName(c)
  const newSeg: Seg = {
    id: newSegId(),
    serverId: null,
    dictItemId: store.resolveDictItemId(name, 0, c.scen),
    s: curStart,
    e: curEnd,
    n: name,
    source: 'manual',
  }
  c.segs.push(newSeg)
  sel.value = newSeg.id
  toast(`已在 ${curStart}s 处新增切片 [${newSeg.n}]`)
}

function remove(id?: number) {
  const c = clip.value
  if (!c || !editable.value) return
  let k = id ?? sel.value
  if (k == null) {
    const atHead = c.segs.find((s) => t.value >= s.s && t.value <= s.e)
    if (atHead) k = atHead.id
  }
  if (k == null) {
    toast('请先选中或移动至要删除的切片', { type: 'warn' })
    return
  }
  const seg = c.segs.find((s) => s.id === k)
  recordHistory()
  c.segs.splice(c.segs.findIndex((s) => s.id === k), 1)
  if (sel.value === k) sel.value = null
  toast(`已删除切片 [${seg?.n ?? ''}]`)
}

function mergeWithNext() {
  const c = clip.value
  if (!c || !editable.value) return
  let curSeg = c.segs.find((s) => s.id === sel.value)
  if (!curSeg) curSeg = c.segs.find((s) => t.value >= s.s && t.value <= s.e)
  if (!curSeg) {
    toast('请先选中或移动至要合并的切片', { type: 'warn' })
    return
  }
  const nextSeg = sorted.value.find((s) => s.s >= curSeg!.e - 0.05 && s.id !== curSeg!.id)
  if (!nextSeg) {
    toast('未找到紧邻的下一个切片，无法向下合并', { type: 'warn' })
    return
  }
  recordHistory()
  curSeg.e = nextSeg.e
  c.segs.splice(c.segs.findIndex((s) => s.id === nextSeg.id), 1)
  sel.value = curSeg.id
  toast(`已将 [${nextSeg.n}] 合并入 [${curSeg.n}]`)
}

function bounds(seg: Seg): [number, number] {
  const c = clip.value!
  const o = c.segs.filter((x) => x.id !== seg.id)
  return [
    Math.max(0, ...o.filter((x) => x.e <= seg.s + 0.001).map((x) => x.e)),
    Math.min(c.dur, ...o.filter((x) => x.s >= seg.e - 0.001).map((x) => x.s)),
  ]
}

function setTime(seg: Seg, key: 's' | 'e', v: unknown) {
  const n = Number(v)
  if (v === null || v === '' || Number.isNaN(n)) return
  const [lo, hi] = bounds(seg)
  const s = key === 's' ? n : seg.s
  const e = key === 'e' ? n : seg.e
  if (s < lo - 0.001 || e > hi + 0.001 || e - s < 0.3) {
    toast('时间范围无效：不能与相邻切片重叠，且时长至少 0.3s', { type: 'warn' })
    return
  }
  recordHistory()
  seg[key] = Math.round(n * 10) / 10
}

async function saveDraft() {
  const c = clip.value
  if (!c || !editable.value) return
  savingDraft.value = true
  try {
    await store.saveSegments(c)
    toast('已保存当前标注草稿')
  } catch (err: any) {
    toast(err?.message || '保存草稿失败', { type: 'crit' })
  } finally {
    savingDraft.value = false
  }
}

/* 提交前质量自检（调用后端 POST /annotation/items/{id}/check） */
const valModal = reactive<{
  open: boolean
  loading: boolean
  report: CheckReportOut | null
  note: string
}>({
  open: false,
  loading: false,
  report: null,
  note: '',
})

async function checkAndSubmit() {
  const c = clip.value
  if (!c || !editable.value) return
  valModal.open = true
  valModal.loading = true
  valModal.note = c.submitNote ?? ''
  try {
    valModal.report = await store.check(c)
  } catch (err: any) {
    valModal.open = false
    toast(err?.message || '质量自检失败', { type: 'crit' })
  } finally {
    valModal.loading = false
  }
}

function jumpToIssue(startMs?: number | null) {
  if (startMs != null) t.value = +(startMs / 1000).toFixed(2)
  valModal.open = false
}

async function doSubmitFinal() {
  const c = clip.value
  const rep = valModal.report
  if (!c || !rep || !rep.can_submit) return
  submitting.value = true
  try {
    const res = await store.submit(c, valModal.note.trim(), rep.warn_count > 0)
    valModal.open = false
    toast(res.sampled === false ? '已提交，本条未被抽中审核，免检通过' : '已提交审核')
    await loadList(false)
  } catch (err: any) {
    toast(err?.message || '提交失败', { type: 'crit' })
  } finally {
    submitting.value = false
  }
}

async function withdraw() {
  const c = clip.value
  if (!c) return
  const ok = await confirmDlg({ title: '撤回提交？', msg: '撤回后可继续修改标注，修改完成后需重新自检并提交审核。', ok: '确认撤回' })
  if (!ok) return
  busy.value = true
  try {
    await store.withdraw(c.numericId)
    toast('已撤回，可继续修改')
    store.filter = 'todo'
    await loadList(false)
    await pick(c.numericId)
  } catch (err: any) {
    toast(err?.message || '撤回失败', { type: 'crit' })
  } finally {
    busy.value = false
  }
}

async function openHistory() {
  historyOpen.value = true
  try {
    await store.fetchHistory()
  } catch (err: any) {
    toast(err?.message || '加载提交历史失败', { type: 'warn' })
  }
}

/* 快捷键 */
const shortcutGuideOpen = ref(false)
function onKey(e: KeyboardEvent) {
  if (valModal.open || shortcutGuideOpen.value || historyOpen.value) return
  const el = e.target as HTMLElement | null
  const tag = el?.tagName
  const isReadonlyInput = tag === 'INPUT' && (el as HTMLInputElement).readOnly
  const inOpenSelect = !!el?.closest?.('.ant-select-open')
  if (
    inOpenSelect ||
    (tag === 'INPUT' && !isReadonlyInput) ||
    tag === 'SELECT' ||
    tag === 'TEXTAREA' ||
    el?.closest?.('.ant-input') ||
    el?.closest?.('.ant-input-number') ||
    el?.isContentEditable
  ) return

  const k = e.key.toLowerCase()
  const code = e.code

  if (code === 'Space') {
    e.preventDefault()
    if (!e.repeat) toggle()
    return
  }
  if ((e.ctrlKey || e.metaKey) && (k === 'z' || code === 'KeyZ')) {
    e.preventDefault()
    undo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && (k === 's' || code === 'KeyS')) {
    e.preventDefault()
    saveDraft()
    return
  }
  if ((k === 'a' || code === 'KeyA') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!editable.value) return
    e.preventDefault()
    if (!e.repeat) splitOrAdd()
    return
  }
  if ((k === 'd' || code === 'KeyD' || k === 'delete' || k === 'backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!editable.value) return
    e.preventDefault()
    if (!e.repeat) remove()
    return
  }
  if ((k === 'm' || code === 'KeyM') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!editable.value) return
    e.preventDefault()
    if (!e.repeat) mergeWithNext()
    return
  }
  if ((k === 'arrowleft' || code === 'ArrowLeft') && clip.value) {
    e.preventDefault()
    t.value = clamp(+(t.value - (e.shiftKey ? 2.0 : 0.1)).toFixed(2), 0, clip.value.dur)
    return
  }
  if ((k === 'arrowright' || code === 'ArrowRight') && clip.value) {
    e.preventDefault()
    t.value = clamp(+(t.value + (e.shiftKey ? 2.0 : 0.1)).toFixed(2), 0, clip.value.dur)
    return
  }
  if (k === 'escape' || code === 'Escape') sel.value = null
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  if (timer) clearInterval(timer)
})

function clearBatch() { router.replace({ name: 'annotate' }) }
</script>

<template>
  <PageHead title="标注工作台" desc="从任务池领取数据后，按子任务切分时间区间；提交前自动自检">
    <div class="row" style="gap:8px">
      <span class="muted" style="margin-right:4px">任务池 {{ poolCount }} 条 · 我的待处理 {{ minePending }} 条</span>
      <a-button @click="openHistory"><AppIcon name="clock" size="sm" />提交历史</a-button>
      <a-button @click="router.push({ name: 'dict' })"><AppIcon name="layers" size="sm" />标注字典 <span class="mono muted" style="margin-left:4px">{{ dict.version }}</span></a-button>
      <a-button @click="shortcutGuideOpen = true"><AppIcon name="kbd" size="sm" />快捷键</a-button>
    </div>
  </PageHead>

  <div v-if="batchFilter" class="callout info" style="margin-bottom:12px">
    <AppIcon name="filter" />
    <span>仅显示批次 <b class="mono">{{ batchFilter }}</b> 的数据</span>
    <a-button size="small" type="link" @click="clearBatch">清除</a-button>
  </div>

  <div class="card ann2">
    <ClipList
      v-model:filter="store.filter"
      :clips="store.clips"
      :cur="clip?.numericId ?? null"
      :filters="view === 'mine' ? FILTERS : []"
      :loading="store.loadingList"
      :empty-desc="view === 'pool' ? '任务池已清空' : '没有该状态的数据，可去任务池领取'"
      @pick="pick"
    >
      <template #head>
        <div class="vseg" role="tablist" aria-label="任务视图">
          <button type="button" role="tab" :aria-selected="view === 'pool'" @click="view = 'pool'">任务池 <span class="num">{{ poolCount }}</span></button>
          <button type="button" role="tab" :aria-selected="view === 'mine'" @click="view = 'mine'">我的任务 <span class="num">{{ mineCount }}</span></button>
        </div>
        <div v-if="view === 'pool'" class="claim">
          <a-select v-model:value="poolSceneId" size="small" style="width:106px" aria-label="场景" :options="sceneOpts" />
          <a-input-number v-model:value="claimN" size="small" :min="1" :max="10" style="width:56px" aria-label="领取条数" />
          <span class="ct">条</span><span class="grow" />
          <a-button size="small" type="primary" :loading="busy" :disabled="!store.clips.length || !canLabel" @click="doClaim()">批量领取</a-button>
        </div>
      </template>
    </ClipList>

    <div class="work">
      <EmptyState v-if="!clip" icon="inbox" title="请选择一条数据" desc="请从左侧列表选择待标注视频" />
      <template v-else>
        <div class="row between" style="gap:12px;align-items:flex-start">
          <div style="min-width:0">
            <div class="row" style="gap:8px">
              <span class="mono ell">{{ clip.id }} · {{ clip.file }}</span>
              <StatusBadge :kind="(CLIP_ST[clip.status]?.[0] || 'info') as BadgeKind" :text="clip.statusLabel" />
              <span v-if="clip.prio === 'urgent'" class="tag crit" style="font-size:11px">加急</span>
            </div>
            <div class="muted" style="font-size:12.5px;margin-top:2px">
              {{ clip.sceneName || clip.scen || '未分配场景' }} · {{ clip.dur ? clip.dur.toFixed(1) + ' 秒' : '—' }} · 批次 {{ clip.batch || '—' }}
              <template v-if="clip.checkScore != null"> · 自检 {{ clip.checkScore }} 分</template>
            </div>
          </div>
          <div v-if="inPool" class="row" style="gap:8px;flex:none">
            <a-button type="primary" :loading="busy" :disabled="!canLabel" @click="doClaim(clip)">领取此条</a-button>
          </div>
          <div v-else-if="editable" class="row" style="gap:6px;flex:none">
            <a-button size="small" :disabled="!hasUndo" @click="undo">
              <AppIcon name="undo" size="sm" />撤销 <kbd>Ctrl+Z</kbd>
            </a-button>
            <a-button size="small" :loading="savingDraft" @click="saveDraft">
              <AppIcon name="save" size="sm" />保存草稿 <kbd>Ctrl+S</kbd>
            </a-button>
          </div>
        </div>

        <div v-if="!inPool && clip.owner && !editable && ['todo', 'rejected'].includes(clip.status)" class="callout">
          <AppIcon name="user" /><span>由 {{ clip.owner }} 领取，当前只读</span>
        </div>
        <div v-if="clip.rejectReason && (clip.status === 'rejected' || inPool)" class="callout warn" role="alert">
          <AppIcon name="alert" />
          <span><b>审核驳回：</b>{{ clip.rejectReason }}</span>
        </div>

        <!-- 任务池：顶部播放工具栏（预留更多下方空间给 3D 坐标系） -->
        <div v-if="inPool" class="pool-playbar">
          <a-button size="small" type="primary" :disabled="!clip.dur" @click="toggle">
            <AppIcon :name="playing ? 'pause' : 'play'" size="sm" />{{ playing ? '暂停' : '播放' }}
          </a-button>
          <span class="mono num" style="font-size:12.5px;white-space:nowrap">{{ fmtT(t) }} / {{ fmtT(clip.dur) }}</span>
          <div style="flex:1;min-width:140px">
            <a-slider
              :value="t"
              :min="0"
              :max="Math.max(clip.dur, 0.1)"
              :step="0.1"
              :tooltip-open="false"
              @change="(v: any) => { t = Number(v) }"
            />
          </div>
          <a-select v-model:value="speed" size="small" style="width:72px" aria-label="播放速度" :options="[{ value: 0.5, label: '0.5×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }]" />
        </div>

        <VideoWall :clip="clip" :t="t" :playing="playing" :speed="speed" :loading="store.loadingDetail" @refresh="refreshPreview" />

        <!-- 任务池：仅观看模式（世界坐标系 3D 轨迹，不显示切片相关功能与底部悬浮栏） -->
        <template v-if="inPool">
          <EpisodeWorld3D class="pool-world3d" :signals="signals" :current-ms="t * 1000" :loading="signalsLoading" />
        </template>

        <!-- 我的任务：完整切片标注工作区 -->
        <template v-else>
          <div class="mine-toolbar">
            <a-button size="small" type="primary" :disabled="!clip.dur" @click="toggle">
              <AppIcon :name="playing ? 'pause' : 'play'" size="sm" />{{ playing ? '暂停' : '播放' }}
            </a-button>
            <span class="mono num" style="font-size:12.5px;white-space:nowrap">{{ fmtT(t) }} / {{ fmtT(clip.dur) }}</span>
            <a-select v-model:value="speed" size="small" style="width:72px" aria-label="播放速度" :options="[{ value: 0.5, label: '0.5×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }]" />
            <span v-if="nowSeg" class="tag" :style="{ background: colorOf(clip.scen, nowSeg.n), color: '#fff' }">
              {{ nowSeg.n }}
            </span>
            <span class="grow" />
            <template v-if="editable">
              <a-dropdown :trigger="['click']">
                <a-button size="small" :loading="busy"><AppIcon name="bolt" size="sm" />规则预切分</a-button>
                <template #overlay>
                  <a-menu @click="({ key }: { key: string }) => doPresplit(key as 'seq' | 'force')">
                    <a-menu-item key="seq">按子任务标准顺序均分</a-menu-item>
                    <a-menu-item key="force">按夹爪力觉突变点切分</a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
              <a-button size="small" @click="splitOrAdd"><AppIcon name="more" size="sm" />切分/新增 <kbd>A</kbd></a-button>
              <a-button size="small" :disabled="sel === null" @click="mergeWithNext"><AppIcon name="layers" size="sm" />合并 <kbd>M</kbd></a-button>
              <a-button size="small" danger :disabled="sel === null" @click="remove()"><AppIcon name="trash" size="sm" />删除 <kbd>D</kbd></a-button>
            </template>
          </div>

          <SliceTimeline v-model:t="t" :clip="clip" :selected="sel" :editable="editable" @select="sel = $event" @changed="changed" />

          <div class="row between" style="margin-top:2px">
            <span style="font-weight:600;font-size:13px">子任务切片 ({{ sorted.length }})</span>
            <span class="muted" style="font-size:12px">覆盖率 <b>{{ coverage }}%</b></span>
          </div>

          <table class="stbl" aria-label="子任务切片列表">
            <thead>
              <tr>
                <th style="width:26px" />
                <th>子任务名称</th>
                <th style="width:120px">开始时间 (s)</th>
                <th style="width:120px">结束时间 (s)</th>
                <th style="width:76px">时长</th>
                <th style="width:120px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in sorted" :key="s.id" :class="{ sel: sel === s.id, flag: !!s.flag }" @click="sel = s.id">
                <td><i class="dot" :style="{ background: colorOf(clip.scen, s.n) }" /></td>
                <td>
                  <a-select
                    v-if="editable"
                    v-model:value="s.n"
                    size="small"
                    style="width:100%"
                    aria-label="子任务名称"
                    :options="subOpts"
                    @change="onSegLabelChange(s)"
                  />
                  <span v-else>{{ s.n }}</span>
                  <div v-if="s.flag" class="tag crit" style="font-size:11px;margin-top:4px;display:inline-block">审核意见：{{ s.flag }}</div>
                </td>
                <td>
                  <a-input-number
                    v-if="editable"
                    :value="s.s"
                    size="small"
                    :min="0"
                    :max="clip.dur"
                    :step="0.1"
                    style="width:100%"
                    aria-label="开始时间"
                    @change="(v: unknown) => setTime(s, 's', v)"
                  />
                  <span v-else class="num">{{ s.s.toFixed(1) }}</span>
                </td>
                <td>
                  <a-input-number
                    v-if="editable"
                    :value="s.e"
                    size="small"
                    :min="0"
                    :max="clip.dur"
                    :step="0.1"
                    style="width:100%"
                    aria-label="结束时间"
                    @change="(v: unknown) => setTime(s, 'e', v)"
                  />
                  <span v-else class="num">{{ s.e.toFixed(1) }}</span>
                </td>
                <td class="num muted">{{ (s.e - s.s).toFixed(1) }} s</td>
                <td @click.stop>
                  <div class="row" style="gap:6px">
                    <a-button size="small" type="text" @click="t = s.s">定位</a-button>
                    <a-button v-if="editable" size="small" type="text" danger @click="remove(s.id)">删除</a-button>
                  </div>
                </td>
              </tr>
              <tr v-if="!sorted.length">
                <td colspan="6" class="muted" style="text-align:center;padding:20px">暂无切片</td>
              </tr>
            </tbody>
          </table>

          <div class="actbar">
            <template v-if="clip.status === 'submitted'">
              <span class="muted" style="font-size:12.5px">已提交审核，等待质检</span>
              <a-button :loading="busy" :disabled="!canLabel" @click="withdraw">撤回提交</a-button>
            </template>
            <template v-else-if="clip.status === 'approved'">
              <span style="color:var(--good-solid);font-weight:600;display:flex;align-items:center;gap:4px">
                <AppIcon name="check" size="sm" />{{ clip.statusLabel || '已通过审核' }}
              </span>
            </template>
            <template v-else-if="editable">
              <a-button v-if="clip.status === 'todo'" :loading="busy" @click="doRelease">放回任务池</a-button>
              <a-button
                type="primary"
                :disabled="!canLabel || !clip.segs.length"
                :title="canLabel ? (clip.segs.length ? undefined : '请先创建至少一个子任务切片') : NO_PERM"
                @click="checkAndSubmit"
              >
                <AppIcon name="check" size="sm" />质量自检并提交审核
              </a-button>
            </template>
          </div>
        </template>
      </template>
    </div>
  </div>

  <!-- 提交前质量自检弹窗（对接 POST /annotation/items/{id}/check & /submit） -->
  <a-modal v-model:open="valModal.open" title="标注数据质量自检报告" width="680px" centered :mask-closable="false">
    <a-spin :spinning="valModal.loading">
      <div v-if="valModal.report" class="val-report">
        <div
          class="val-banner"
          :class="{
            fatal: !valModal.report.can_submit,
            warn: valModal.report.can_submit && valModal.report.warn_count > 0,
            pass: valModal.report.can_submit && valModal.report.warn_count === 0,
          }"
        >
          <div class="row" style="gap:12px;align-items:center">
            <div class="val-score-badge">
              <span class="val-score-num">{{ valModal.report.score }}</span>
              <span class="val-score-lbl">质量评分</span>
            </div>
            <div>
              <div style="font-size:16px;font-weight:600">
                <template v-if="!valModal.report.can_submit">存在 {{ valModal.report.block_count }} 项必须修改的问题，请修正后提交</template>
                <template v-else-if="valModal.report.warn_count > 0">发现 {{ valModal.report.warn_count }} 项警告，确认无误后可提交</template>
                <template v-else>质量自检通过，符合平台入库规范</template>
              </div>
              <div class="muted" style="font-size:12.5px;margin-top:4px">
                有效标注 {{ (valModal.report.labeled_ms / 1000).toFixed(1) }}s · 覆盖率 {{ valModal.report.coverage ?? 0 }}% · 共 {{ valModal.report.segment_count }} 个切片
              </div>
            </div>
          </div>
        </div>

        <div class="val-grid">
          <div class="val-stat"><span class="num">{{ valModal.report.coverage ?? 0 }}%</span><span class="lbl">标注覆盖率</span></div>
          <div class="val-stat"><span class="num">{{ valModal.report.segment_count }}</span><span class="lbl">子任务切片数</span></div>
          <div class="val-stat"><span class="num" :style="{ color: valModal.report.block_count ? 'var(--crit-solid)' : 'inherit' }">{{ valModal.report.block_count }}</span><span class="lbl">阻断错误数</span></div>
          <div class="val-stat"><span class="num" :style="{ color: 'var(--warn-solid)' }">{{ valModal.report.warn_count }}</span><span class="lbl">优化预警数</span></div>
        </div>

        <div style="margin-top:16px">
          <div style="font-weight:600;margin-bottom:8px">质检规则自查清单</div>
          <div class="val-issues-list">
            <div v-for="(iss, idx) in valModal.report.issues" :key="idx" class="val-issue-item" :class="iss.severity === 'block' ? 'fatal' : iss.severity">
              <div class="row between" style="gap:8px">
                <div class="row" style="gap:6px">
                  <span class="val-tag" :class="iss.severity === 'block' ? 'fatal' : iss.severity">
                    {{ iss.severity === 'block' ? '阻断' : iss.severity === 'warn' ? '警告' : '提示' }}
                  </span>
                  <b>{{ iss.rule }}</b>
                </div>
                <a-button v-if="iss.start_ms != null" size="small" type="link" @click="jumpToIssue(iss.start_ms)">定位时间 ↗</a-button>
              </div>
              <div class="desc">{{ iss.message }}</div>
            </div>
            <div v-if="!valModal.report.issues.length" class="val-issue-item pass">
              <div class="row" style="gap:8px"><span class="val-tag pass">通过</span><span>全部质检规则通过</span></div>
            </div>
          </div>
        </div>

        <div v-if="valModal.report.can_submit" style="margin-top:14px">
          <div style="font-size:12.5px;color:var(--muted);margin-bottom:6px">给审核员的补充说明（可选）</div>
          <a-textarea v-model:value="valModal.note" :rows="2" :maxlength="500" show-count placeholder="如有特殊动作或遮挡情况，可在此说明" />
        </div>
      </div>
    </a-spin>
    <template #footer>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <a-button @click="valModal.open = false">返回修改</a-button>
        <a-button
          v-if="valModal.report?.can_submit"
          type="primary"
          :loading="submitting"
          @click="doSubmitFinal"
        >
          {{ valModal.report.warn_count > 0 ? '忽略警告并提交审核' : '确认提交审核' }}
        </a-button>
      </div>
    </template>
  </a-modal>

  <!-- 提交历史抽屉（对接 GET /annotation/history） -->
  <a-drawer v-model:open="historyOpen" title="我的提交历史" :width="620" placement="right" destroy-on-close>
    <a-spin :spinning="store.loadingHistory">
      <div v-if="store.history.length" style="display:flex;flex-direction:column;gap:10px">
        <div v-for="h in store.history" :key="h.id" class="hist-item">
          <div class="row between">
            <span class="mono" style="font-weight:600">{{ h.code }} · {{ h.file_name || '—' }}</span>
            <StatusBadge :kind="(CLIP_ST[h.status]?.[0] || 'info') as BadgeKind" :text="h.status_label" />
          </div>
          <div class="muted" style="font-size:12px;margin-top:4px">
            {{ h.scene_name || '—' }} · 批次 {{ h.batch_code || '—' }} · 提交 {{ h.submit_times }} 次
            <template v-if="h.my_submitted_at"> · 最近提交 {{ h.my_submitted_at.replace('T', ' ').slice(0, 16) }}</template>
          </div>
          <div v-if="h.last_decision_label" style="font-size:12px;margin-top:4px">
            最新审核结论：<b>{{ h.last_decision_label }}</b>
            <span v-if="h.reject_reason" style="color:var(--crit)"> · {{ h.reject_reason }}</span>
          </div>
        </div>
      </div>
      <EmptyState v-else icon="inbox" title="暂无提交历史" desc="提交标注后会在此记录" />
    </a-spin>
  </a-drawer>

  <!-- 快捷键弹窗 -->
  <a-modal v-model:open="shortcutGuideOpen" title="标注快捷键" width="480px" centered :footer="null">
    <div class="kbd-guide-grid">
      <div class="kbd-row"><div class="keys"><kbd>Space</kbd></div><div class="desc">播放 / 暂停</div></div>
      <div class="kbd-row"><div class="keys"><kbd>←</kbd> <kbd>→</kbd></div><div class="desc">后退 / 前进 0.1 秒（Shift 2 秒）</div></div>
      <div class="kbd-row"><div class="keys"><kbd>A</kbd></div><div class="desc">在当前播放头切分或新增切片</div></div>
      <div class="kbd-row"><div class="keys"><kbd>M</kbd></div><div class="desc">与紧邻下一个切片向下合并</div></div>
      <div class="kbd-row"><div class="keys"><kbd>D</kbd> / <kbd>Del</kbd></div><div class="desc">删除选中或当前播放头所在切片</div></div>
      <div class="kbd-row"><div class="keys"><kbd>Ctrl+Z</kbd></div><div class="desc">撤销上一步编辑</div></div>
      <div class="kbd-row"><div class="keys"><kbd>Ctrl+S</kbd></div><div class="desc">保存草稿到后端</div></div>
    </div>
  </a-modal>
</template>

<style scoped>
.ann2 { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 640px; }
.work { padding: 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.pool-playbar, .mine-toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface-2); flex-wrap: wrap; }
.pool-playbar :deep(.ant-slider) { margin: 4px 6px; }
.pool-world3d { flex: 1; min-height: 360px; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 480px; }
.stbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.stbl th { text-align: left; font-weight: 500; color: var(--muted); padding: 8px; border-bottom: 1px solid var(--line); background: var(--surface-2); }
.stbl td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.stbl tr.sel td { background: var(--accent-soft); }
.stbl tr.flag td { background: var(--crit-soft); }
.dot { display: block; width: 10px; height: 10px; border-radius: 3px; }
.vseg { display: flex; gap: 2px; padding: 3px; border-radius: 8px; background: var(--surface-3); margin-bottom: 8px; }
.vseg button { flex: 1 1 0; min-width: 0; height: 28px; padding: 0 4px; border: 0; border-radius: 6px; background: none; color: var(--muted); font-size: 12.5px; cursor: pointer; }
.vseg button[aria-selected="true"] { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: 0 1px 2px rgba(26,42,77,.12); }
.claim { display: flex; gap: 6px; align-items: center; width: 100%; min-width: 0; }
.claim :deep(.ant-btn), .claim :deep(.ant-input-number), .claim :deep(.ant-select-selector) { height: 28px !important; }
.claim :deep(.ant-input-number-input) { height: 26px; }
.claim :deep(.ant-select-selection-item) { line-height: 26px !important; }
.claim .grow { flex: 1; min-width: 0; }
.claim .ct { font-size: 12px; color: var(--muted); white-space: nowrap; }
.actbar { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding-top: 12px; margin-top: auto; border-top: 1px solid var(--line); flex-wrap: wrap; }
kbd { font: 11px var(--font-mono); padding: 1px 5px; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--surface-2); }
.val-banner { padding: 14px 16px; border-radius: 10px; border: 1px solid var(--line); }
.val-banner.pass { background: rgba(34,197,94,.08); border-color: rgba(34,197,94,.3); }
.val-banner.warn { background: rgba(245,158,11,.08); border-color: rgba(245,158,11,.35); }
.val-banner.fatal { background: rgba(239,68,68,.08); border-color: rgba(239,68,68,.35); }
.val-score-badge { width: 58px; height: 58px; border-radius: 10px; background: var(--surface); border: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; flex: none; }
.val-score-num { font: 700 22px var(--font-mono); line-height: 1; }
.val-score-lbl { font-size: 10.5px; color: var(--muted); margin-top: 2px; }
.val-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
.val-stat { padding: 10px; border-radius: 8px; background: var(--surface-2); border: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; gap: 2px; }
.val-stat .num { font: 700 18px var(--font-mono); }
.val-stat .lbl { font-size: 11.5px; color: var(--muted); }
.val-issues-list { display: flex; flex-direction: column; gap: 8px; max-height: 240px; overflow: auto; }
.val-issue-item { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface-2); }
.val-issue-item .desc { font-size: 12.5px; color: var(--muted); margin-top: 4px; }
.val-tag { font-size: 11px; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
.val-tag.fatal { background: var(--crit-soft); color: var(--crit); }
.val-tag.warn { background: var(--warn-soft); color: var(--warn); }
.val-tag.info { background: var(--accent-soft); color: var(--accent-text); }
.val-tag.pass { background: var(--good-soft); color: var(--good); }
.hist-item { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface-2); }
.kbd-guide-grid { display: flex; flex-direction: column; gap: 10px; }
.kbd-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 6px; background: var(--surface-2); }
.kbd-row .keys { display: flex; gap: 4px; align-items: center; }
.kbd-row .desc { font-size: 13px; color: var(--text); }
@media (max-width: 900px) { .ann2 { grid-template-columns: 1fr; } }
</style>
