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
import { fmtT } from '@/components/annotate/motion'
import {
  CLIP_ST,
  colorOf,
  newSegId,
  useAnnotate,
  type Clip,
  type ClipStatus,
  type Seg,
  type ValidationReport,
} from '@/stores/annotate'
import { usePipeline } from '@/stores/pipeline'
import { useLogs } from '@/stores/logs'
import { NO_PERM, SCEN, type BadgeKind, type ScenKey } from '@/constants'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'
import { clamp } from '@/utils'

const store = useAnnotate()
const pl = usePipeline()
const logs = useLogs()
const session = useSession()
const route = useRoute()
const router = useRouter()

const canLabel = computed(() => session.can('annotate'))
const canReview = computed(() => session.can('review'))

const batchFilter = computed(() => (typeof route.query.batch === 'string' ? route.query.batch : ''))
const FILTERS = computed<[string, string, number][]>(() => {
  const n = (s: ClipStatus[]) => store.clips.filter((c) => s.includes(c.status) && (!batchFilter.value || c.batch === batchFilter.value)).length
  return [
    ['todo', '待标注', n(['todo', 'rejected'])],
    ['submitted', '待审核', n(['submitted'])],
    ['approved', '已通过', n(['approved'])],
    ['all', '全部', n(['todo', 'rejected', 'submitted', 'approved'])],
  ]
})

const MATCH: Record<string, ClipStatus[]> = {
  todo: ['todo', 'rejected'],
  submitted: ['submitted'],
  approved: ['approved'],
  all: ['todo', 'rejected', 'submitted', 'approved'],
}

function matches(c: Clip, f: string) {
  if (batchFilter.value && c.batch !== batchFilter.value) return false
  return MATCH[f]?.includes(c.status) ?? true
}

const vis = computed(() => store.clips.filter((c) => matches(c, store.filter)))
const clip = computed<Clip | undefined>(() => store.byId(store.cur))

function pick(id: string) {
  store.cur = id
  t.value = 0
  playing.value = false
  sel.value = null
}

function ensureCur() {
  if (vis.value.length && !vis.value.some((c) => c.id === store.cur)) pick(vis.value[0].id)
}
watch(vis, ensureCur)
onMounted(ensureCur)

/* 播放控制 */
const t = ref(0)
const playing = ref(false)
const speed = ref(1)
const sel = ref<number | null>(null)
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => {
    if (!playing.value || !clip.value) return
    t.value = Math.min(clip.value.dur, +(t.value + 0.1 * speed.value).toFixed(2))
    if (t.value >= clip.value.dur) playing.value = false
  }, 100)
})

function toggle() {
  if (!clip.value) return
  if (t.value >= clip.value.dur) t.value = 0
  playing.value = !playing.value
}

/* 编辑权限与状态计算 */
const editable = computed(() => canLabel.value && !!clip.value && ['todo', 'rejected'].includes(clip.value.status))
const sorted = computed(() => (clip.value ? clip.value.segs.slice().sort((a, b) => a.s - b.s) : []))
const coverage = computed(() => (clip.value ? Math.min(100, Math.round((sorted.value.reduce((a, s) => a + (s.e - s.s), 0) / clip.value.dur) * 100)) : 0))
const currentSubNames = computed(() => (clip.value ? store.subNames[clip.value.scen] || [] : []))
const missing = computed(() => (clip.value ? currentSubNames.value.filter((n) => !clip.value!.segs.some((s) => s.n === n)) : []))
const nowSeg = computed(() => sorted.value.find((s) => t.value >= s.s && t.value < s.e))
const flagged = computed(() => sorted.value.filter((s) => s.flag))
const nextName = (c: Clip) => currentSubNames.value.find((n) => !c.segs.some((s) => s.n === n)) ?? currentSubNames.value[0] ?? '未命名'

/* 撤销管理 */
const hasUndo = computed(() => (clip.value ? store.canUndo(clip.value.id) : false))
function recordHistory() {
  if (clip.value) store.pushHistory(clip.value.id, clip.value.segs)
}
function undo() {
  const c = clip.value
  if (!c || !editable.value) return
  const prev = store.popHistory(c.id)
  if (prev) {
    c.segs = prev
    sel.value = null
    toast('已撤销上一步操作')
  } else {
    toast('无可撤销的操作记录', { type: 'warn' })
  }
}

/* 切片编辑操作 */
function changed() {
  recordHistory()
}

function split() {
  const c = clip.value
  if (!c || !editable.value) return
  const seg = c.segs.find((s) => t.value - s.s >= 0.3 && s.e - t.value >= 0.3)
  if (!seg) {
    toast('播放头需位于某个切片内部（距边缘至少 0.3s）才能切分', { type: 'warn' })
    return
  }
  recordHistory()
  const cut = Math.round(t.value * 10) / 10
  const n: Seg = { id: newSegId(), s: cut, e: seg.e, n: nextName(c) }
  seg.e = cut
  c.segs.push(n)
  sel.value = n.id
  toast(`在 ${cut}s 处切分出新切片 [${n.n}]`)
}

function remove(id?: number) {
  const c = clip.value, k = id ?? sel.value
  if (!c || !editable.value || k == null) return
  const seg = c.segs.find((s) => s.id === k)
  recordHistory()
  c.segs.splice(c.segs.findIndex((s) => s.id === k), 1)
  if (sel.value === k) sel.value = null
  toast(`已删除切片 [${seg?.n ?? ''}]`)
}

function mergeWithNext() {
  const c = clip.value
  if (!c || !editable.value || sel.value == null) {
    toast('请先选择要合并的切片', { type: 'warn' })
    return
  }
  const curSeg = c.segs.find((s) => s.id === sel.value)
  if (!curSeg) return
  const nextSeg = sorted.value.find((s) => s.s >= curSeg.e - 0.05 && s.id !== curSeg.id)
  if (!nextSeg) {
    toast('未找到紧邻的下一个切片，无法合并', { type: 'warn' })
    return
  }
  recordHistory()
  curSeg.e = nextSeg.e
  c.segs.splice(c.segs.findIndex((s) => s.id === nextSeg.id), 1)
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
  const s = key === 's' ? n : seg.s, e = key === 'e' ? n : seg.e
  if (s < lo - 0.001 || e > hi + 0.001 || e - s < 0.3) {
    toast('时间范围无效：不能与相邻切片重叠，且时长至少 0.3s', { type: 'warn' })
    return
  }
  recordHistory()
  seg[key] = Math.round(n * 10) / 10
}

function saveDraft() {
  const c = clip.value
  if (!c) return
  logs.addLog({
    user: session.info.user,
    role: session.info.name,
    module: 'annotate',
    moduleName: '标注工作台',
    action: '保存草稿',
    target: `${c.file} (${c.id})`,
    summary: `手动保存标注草稿：共 ${c.segs.length} 个切片，覆盖率 ${coverage.value}%`,
  })
  toast('已保存当前标注草稿')
}

/* 提交前质量自检与拦截 */
const valModal = reactive<{
  open: boolean
  report: ValidationReport | null
  submitting: boolean
}>({
  open: false,
  report: null,
  submitting: false,
})

function checkAndSubmit() {
  const c = clip.value
  if (!c || !editable.value) return
  valModal.report = store.validateClip(c)
  valModal.open = true
}

function jumpToTime(time?: number, segId?: number) {
  if (time != null) t.value = time
  if (segId != null) sel.value = segId
  valModal.open = false
}

function doSubmitFinal() {
  const c = clip.value
  if (!c) return
  valModal.open = false
  run(c, () => store.submit(c), '已通过质量自检并提交审核')
  logs.addLog({
    user: session.info.user,
    role: session.info.name,
    module: 'annotate',
    moduleName: '标注工作台',
    action: '提交审核',
    target: `${c.file} · 批次 ${c.batch}`,
    summary: `提交审核：包含 ${c.segs.length} 个切片，质量自检得分 ${valModal.report?.score ?? 100} 分`,
  })
}

function advance(was: Clip[]) {
  const i = was.findIndex((c) => c.id === store.cur)
  const rest = vis.value
  if (rest.some((c) => c.id === store.cur)) return
  const nxt = was.slice(i + 1).find((c) => rest.some((r) => r.id === c.id)) ?? rest[0]
  if (nxt) pick(nxt.id)
}

function batchNote(id: string, before: number | undefined) {
  const b = pl.batches.find((x) => x.id === id)
  if (!b || b.stage === before) return ''
  return b.stage === 3
    ? '；批次 ' + id + ' 标注已全部提交，进入标注校验'
    : b.stage === 2
      ? '；批次 ' + id + ' 退回手动标注'
      : b.stage === 4
        ? '；批次 ' + id + ' 全部通过，进入格式转换（自动）'
        : ''
}

function run(c: Clip, fn: () => void, msg: string) {
  const was = vis.value.slice(), before = pl.batches.find((b) => b.id === c.batch)?.stage
  fn()
  toast(msg + batchNote(c.batch, before))
  advance(was)
}

async function withdraw() {
  const c = clip.value
  if (!c) return
  const ok = await confirmDlg({ title: '撤回提交？', msg: '撤回后可继续修改标注，修改完成后需重新进行自检并提交审核。', ok: '确认撤回' })
  if (!ok) return
  const before = pl.batches.find((b) => b.id === c.batch)?.stage
  c.status = 'todo'
  store.cur = c.id
  const bt = pl.batches.find((b) => b.id === c.batch)
  if (bt && bt.stage === 3) { bt.stage = 2; bt.state = 'wait' }
  logs.addLog({
    user: session.info.user,
    role: session.info.name,
    module: 'annotate',
    moduleName: '标注工作台',
    action: '撤回提交',
    target: `${c.file} (${c.id})`,
    summary: `标注员撤回了已提交的数据 ${c.file}，恢复为待标注状态`,
  })
  toast('已撤回，可继续修改' + batchNote(c.batch, before))
}

/* 键盘快捷键监听 */
function onKey(e: KeyboardEvent) {
  if (document.querySelector('.ant-modal-wrap, .ant-drawer-open')) return
  const el = e.target as HTMLElement, tag = el?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.closest?.('.ant-select') || el?.isContentEditable) return

  // Ctrl+Z: 撤销
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    undo()
    return
  }

  // Ctrl+S: 保存草稿
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    saveDraft()
    return
  }

  if (e.ctrlKey || e.metaKey || e.altKey) return

  const k = e.key.toLowerCase()
  if (k === ' ' && tag !== 'BUTTON') {
    e.preventDefault()
    toggle()
  } else if (k === 'a' || k === 's') {
    e.preventDefault()
    split()
  } else if (k === 'd' || k === 'delete' || k === 'backspace') {
    e.preventDefault()
    remove()
  } else if (k === 'm') {
    e.preventDefault()
    mergeWithNext()
  } else if (k === 'arrowleft' && clip.value) {
    e.preventDefault()
    const delta = e.shiftKey ? 2.0 : 0.1
    t.value = clamp(t.value - delta, 0, clip.value.dur)
  } else if (k === 'arrowright' && clip.value) {
    e.preventDefault()
    const delta = e.shiftKey ? 2.0 : 0.1
    t.value = clamp(t.value + delta, 0, clip.value.dur)
  } else if (k === 'escape') {
    sel.value = null
  }
}

onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  if (timer) clearInterval(timer)
})

/* 快捷键指南弹窗 */
const shortcutGuideOpen = ref(false)

/* 子任务字典管理弹窗 */
const subModal = reactive({
  open: false,
  scen: 'qmd' as ScenKey,
  editingName: null as string | null,
  form: { name: '', desc: '', required: false },
})

function openSubModal() {
  subModal.scen = clip.value?.scen ?? 'qmd'
  subModal.editingName = null
  subModal.form = { name: '', desc: '', required: false }
  subModal.open = true
}

function handleSaveSubtask() {
  const name = subModal.form.name.trim()
  if (!name) {
    toast('请输入子任务名称', { type: 'warn' })
    return
  }
  if (subModal.editingName) {
    store.updateSubName(subModal.scen, subModal.editingName, name, subModal.form.desc, subModal.form.required)
    toast(`已更新子任务 [${name}]`)
  } else {
    const ok = store.addSubName(subModal.scen, name, subModal.form.desc, subModal.form.required)
    if (!ok) {
      toast('该子任务名称已存在或无效', { type: 'warn' })
      return
    }
    toast(`已添加子任务 [${name}]`)
  }
  subModal.editingName = null
  subModal.form = { name: '', desc: '', required: false }
}

function startEditSubtask(n: string) {
  subModal.editingName = n
  const meta = store.subtaskMeta[subModal.scen]?.[n]
  subModal.form = { name: n, desc: meta?.desc ?? '', required: !!meta?.required }
}

async function handleDeleteSubtask(n: string) {
  const inUse = store.clips.filter((c) => c.scen === subModal.scen && c.segs.some((s) => s.n === n)).length
  const msg = inUse
    ? `当前已有 ${inUse} 个标注片段使用了该子任务，删除后历史片段仍会保留此名称，但下拉列表中将不再显示。确定删除？`
    : `确定删除子任务 [${n}]？`
  const ok = await confirmDlg({ title: '确认删除子任务', msg, ok: '删除', danger: true })
  if (ok) {
    store.deleteSubName(subModal.scen, n)
    toast(`已删除子任务 [${n}]`)
  }
}

const isVr = computed(() => (clip.value ? SCEN[clip.value.scen].mode.includes('VR') : false))
function clearBatch() { router.replace({ name: 'annotate' }) }
</script>

<template>
  <PageHead title="标注工作台" desc="时序多视角视频切片标注；支持丰富键盘快捷键、子任务字典实时维护与提交前质量自检拦截">
    <div class="row" style="gap:8px">
      <a-button @click="openSubModal"><AppIcon name="tag" size="sm" />子任务字典管理</a-button>
      <a-button @click="shortcutGuideOpen = true"><AppIcon name="kbd" size="sm" />快捷键指南</a-button>
      <span class="muted" style="margin-left:8px">待标注 {{ store.labelTodo() }} 条 · 待审核 {{ store.reviewTodo() }} 条</span>
    </div>
  </PageHead>

  <div v-if="batchFilter" class="callout info" style="margin-bottom:12px">
    <AppIcon name="filter" />
    <span>仅显示批次 <b class="mono">{{ batchFilter }}</b> 的数据</span>
    <a-button size="small" type="link" @click="clearBatch">清除</a-button>
  </div>

  <div class="card ann2">
    <ClipList v-model:filter="store.filter" :clips="vis" :cur="clip?.id ?? null" :filters="FILTERS" empty-desc="暂无待处理标注数据" @pick="pick" />

    <div class="work">
      <EmptyState v-if="!clip || !vis.length" icon="inbox" title="请选择一条数据" desc="请从左侧列表选择待标注视频" />
      <template v-else>
        <div class="row between" style="gap:12px;align-items:flex-start">
          <div style="min-width:0">
            <div class="row" style="gap:8px">
              <span class="mono ell">{{ clip.file }}</span>
              <StatusBadge :kind="CLIP_ST[clip.status][0] as BadgeKind" :text="CLIP_ST[clip.status][1]" />
            </div>
            <div class="muted" style="font-size:12.5px;margin-top:2px">
              {{ SCEN[clip.scen].name }} · {{ SCEN[clip.scen].mode }} · {{ clip.dur }} 秒 · 批次 {{ clip.batch }}
              <template v-if="isVr"> · 含左右手灵巧手关节数据</template>
            </div>
          </div>
          <div class="row" style="gap:6px">
            <a-button size="small" :disabled="!hasUndo" @click="undo">
              <AppIcon name="undo" size="sm" />撤销 <kbd>Ctrl+Z</kbd>
            </a-button>
            <a-button size="small" @click="saveDraft">
              <AppIcon name="save" size="sm" />保存草稿 <kbd>Ctrl+S</kbd>
            </a-button>
          </div>
        </div>

        <div v-if="clip.reject && clip.status === 'rejected'" class="callout warn" role="alert">
          <AppIcon name="alert" />
          <span><b>审核打回：</b>{{ clip.reject.reason }}<span class="muted"> —— {{ clip.reject.by }} · {{ clip.reject.t }}</span></span>
        </div>

        <VideoWall :clip="clip" :t="t" :playing="playing" />

        <div class="row" style="gap:10px;flex-wrap:wrap">
          <a-button type="primary" @click="toggle">
            <AppIcon :name="playing ? 'pause' : 'play'" />{{ playing ? '暂停' : '播放' }}
          </a-button>
          <span class="mono num">{{ fmtT(t) }} / {{ fmtT(clip.dur) }}</span>
          <a-select v-model:value="speed" size="small" style="width:76px" aria-label="播放速度" :options="[{ value: 0.5, label: '0.5×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }]" />
          <span v-if="nowSeg" class="tag" :style="{ background: colorOf(clip.scen, nowSeg.n), color: '#fff' }">
            当前：{{ nowSeg.n }}
          </span>
          <span class="grow" />
          <template v-if="editable">
            <a-button size="small" @click="split"><AppIcon name="more" size="sm" />切分切片 <kbd>A</kbd></a-button>
            <a-button size="small" :disabled="sel === null" @click="mergeWithNext"><AppIcon name="layers" size="sm" />向下合并 <kbd>M</kbd></a-button>
            <a-button size="small" danger :disabled="sel === null" @click="remove()"><AppIcon name="trash" size="sm" />删除切片 <kbd>D</kbd></a-button>
          </template>
        </div>

        <SliceTimeline v-model:t="t" :clip="clip" :selected="sel" :editable="editable" @select="sel = $event" @changed="changed" />

        <div class="muted hint-row">
          <template v-if="editable">
            <span>💡 提示：在时间轴空白处拖拽创建新切片；拖拽端点调整起止边界；支持键盘快捷键高效精修</span>
          </template>
          <template v-else>
            <span>只读模式：当前数据处于【{{ CLIP_ST[clip.status][1] }}】状态，如需修改请点击下方“撤回提交”</span>
          </template>
          <span class="grow" />
          <span>覆盖率 <b>{{ coverage }}%</b><template v-if="missing.length"> · 待标注项：{{ missing.join('、') }}</template></span>
        </div>

        <div class="row between" style="margin-top:6px">
          <span style="font-weight:600;font-size:13.5px">子任务切片明细 ({{ sorted.length }})</span>
          <a-button size="small" type="link" @click="openSubModal"><AppIcon name="settings" size="sm" />管理场景子任务标签</a-button>
        </div>

        <table class="stbl" aria-label="子任务切片列表">
          <thead>
            <tr>
              <th style="width:26px" />
              <th>子任务名称</th>
              <th style="width:130px">开始时间 (s)</th>
              <th style="width:130px">结束时间 (s)</th>
              <th style="width:80px">有效时长</th>
              <th style="width:130px">操作</th>
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
                  :options="currentSubNames.map((n) => ({ value: n }))"
                  @change="changed"
                />
                <span v-else>{{ s.n }}</span>
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
              <td colspan="6" class="muted" style="text-align:center;padding:24px">
                暂无切片数据{{ editable ? '，可在时间轴上拖拽或按 A/S 键切分' : '' }}
              </td>
            </tr>
          </tbody>
        </table>

        <div class="actbar">
          <span class="muted grow" style="font-size:12px">
            <kbd>Space</kbd> 播放　<kbd>←</kbd><kbd>→</kbd> 0.1s　<kbd>Shift+←/→</kbd> 2s　<kbd>A</kbd> 切分　<kbd>M</kbd> 合并　<kbd>D</kbd> 删除　<kbd>Ctrl+Z</kbd> 撤销
          </span>
          <template v-if="clip.status === 'submitted'">
            <span class="muted" style="font-size:12.5px;margin-right:8px">已提交审核员审核，等待质检结果</span>
            <a-button :disabled="!canLabel" @click="withdraw">撤回提交</a-button>
          </template>
          <template v-else-if="clip.status === 'approved'">
            <span style="color:var(--good-solid);font-weight:600;display:flex;align-items:center;gap:4px">
              <AppIcon name="check" size="sm" />已通过审核并归档入库
            </span>
          </template>
          <template v-else>
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
    </div>
  </div>

  <!-- 提交前质量自检与拦截弹窗 -->
  <a-modal
    v-model:open="valModal.open"
    title="标注数据质量自检报告"
    width="680px"
    centered
    :mask-closable="false"
  >
    <div v-if="valModal.report" class="val-report">
      <div
        class="val-banner"
        :class="{
          fatal: valModal.report.hasFatal,
          warn: !valModal.report.hasFatal && valModal.report.issues.length > 0,
          pass: !valModal.report.hasFatal && valModal.report.issues.length === 0,
        }"
      >
        <div class="row" style="gap:12px;align-items:center">
          <div class="val-score-badge">
            <span class="val-score-num">{{ valModal.report.score }}</span>
            <span class="val-score-lbl">质量评分</span>
          </div>
          <div>
            <div style="font-size:16px;font-weight:600">
              <template v-if="valModal.report.hasFatal">❌ 存在阻断性问题，请修正后提交</template>
              <template v-else-if="valModal.report.issues.length > 0">⚠️ 发现 {{ valModal.report.issues.length }} 项质检预警，建议确认后提交</template>
              <template v-else>✅ 质量自检完美通过，符合平台入库规范</template>
            </div>
            <div class="muted" style="font-size:12.5px;margin-top:4px">
              有效标注时长 {{ valModal.report.validDuration }}s · 覆盖率 {{ valModal.report.coverage }}% · 共 {{ valModal.report.totalSegs }} 个切片
            </div>
          </div>
        </div>
      </div>

      <div class="val-grid">
        <div class="val-stat">
          <span class="num">{{ valModal.report.coverage }}%</span>
          <span class="lbl">标注覆盖率</span>
        </div>
        <div class="val-stat">
          <span class="num">{{ valModal.report.totalSegs }}</span>
          <span class="lbl">子任务切片数</span>
        </div>
        <div class="val-stat">
          <span class="num" :style="{ color: valModal.report.hasFatal ? 'var(--crit-solid)' : 'inherit' }">
            {{ valModal.report.issues.filter((i) => i.severity === 'fatal').length }}
          </span>
          <span class="lbl">阻断错误数</span>
        </div>
        <div class="val-stat">
          <span class="num" :style="{ color: 'var(--warn-solid)' }">
            {{ valModal.report.issues.filter((i) => i.severity === 'warn').length }}
          </span>
          <span class="lbl">优化预警数</span>
        </div>
      </div>

      <div style="margin-top:16px">
        <div style="font-weight:600;margin-bottom:8px">质检规则自查清单</div>
        <div class="val-issues-list">
          <div
            v-for="iss in valModal.report.issues"
            :key="iss.id"
            class="val-issue-item"
            :class="iss.severity"
          >
            <div class="row between" style="gap:8px">
              <div class="row" style="gap:6px">
                <span class="val-tag" :class="iss.severity">
                  {{ iss.severity === 'fatal' ? '阻断' : iss.severity === 'warn' ? '警告' : '提示' }}
                </span>
                <b>{{ iss.rule }}</b>
              </div>
              <a-button
                v-if="iss.time != null || iss.segId != null"
                size="small"
                type="link"
                @click="jumpToTime(iss.time, iss.segId)"
              >
                定位切片 ↗
              </a-button>
            </div>
            <div class="desc">{{ iss.desc }}</div>
          </div>
          <div v-if="!valModal.report.issues.length" class="val-issue-item pass">
            <div class="row" style="gap:8px">
              <span class="val-tag pass">通过</span>
              <span>时间连续性、非空检测、微小时长、场景核心动作完整度均达到最优标准</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="row between" style="width:100%">
        <span class="muted" style="font-size:12px">
          {{ valModal.report?.hasFatal ? '阻断问题必须修正后才可提交' : '提交后将由审核员陈静进行 6 维度质检评分' }}
        </span>
        <div class="row" style="gap:8px">
          <a-button @click="valModal.open = false">返回修改</a-button>
          <a-button
            type="primary"
            :disabled="valModal.report?.hasFatal"
            :danger="!valModal.report?.hasFatal && (valModal.report?.issues.length ?? 0) > 0"
            @click="doSubmitFinal"
          >
            {{ valModal.report?.hasFatal ? '存在阻断错误' : (valModal.report?.issues.length ?? 0) > 0 ? '忽略警告并提交' : '确认提交审核' }}
          </a-button>
        </div>
      </div>
    </template>
  </a-modal>

  <!-- 子任务字典管理弹窗 -->
  <a-modal
    v-model:open="subModal.open"
    title="标注子任务字典管理"
    width="680px"
    centered
    :footer="null"
  >
    <div style="margin-bottom:14px">
      <a-radio-group v-model:value="subModal.scen" button-style="solid" size="small">
        <a-radio-button value="qmd">{{ SCEN.qmd.short }} (VR)</a-radio-button>
        <a-radio-button value="fhd">{{ SCEN.fhd.short }} (UMI)</a-radio-button>
      </a-radio-group>
    </div>

    <div class="card" style="padding:12px;background:var(--surface-2);margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:8px">
        {{ subModal.editingName ? '✏️ 编辑子任务: ' + subModal.editingName : '➕ 添加新子任务' }}
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <a-input
          v-model:value="subModal.form.name"
          placeholder="子任务名称 (如: 锁紧气门嘴)"
          style="width:180px"
          size="small"
        />
        <a-input
          v-model:value="subModal.form.desc"
          placeholder="动作标准规范与操作说明"
          style="flex:1;min-width:180px"
          size="small"
        />
        <a-checkbox v-model:checked="subModal.form.required">核心必选</a-checkbox>
        <a-button type="primary" size="small" @click="handleSaveSubtask">
          {{ subModal.editingName ? '保存修改' : '确认添加' }}
        </a-button>
        <a-button v-if="subModal.editingName" size="small" @click="subModal.editingName = null; subModal.form = { name: '', desc: '', required: false }">
          取消编辑
        </a-button>
      </div>
    </div>

    <table class="stbl" aria-label="子任务定义表">
      <thead>
        <tr>
          <th style="width:30px">颜色</th>
          <th style="width:110px">子任务名称</th>
          <th>标准操作说明</th>
          <th style="width:75px">属性</th>
          <th style="width:90px">当前使用</th>
          <th style="width:100px">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="n in store.subNames[subModal.scen]" :key="n">
          <td><i class="dot" :style="{ background: colorOf(subModal.scen, n) }" /></td>
          <td><b>{{ n }}</b></td>
          <td class="muted" style="font-size:12px">
            {{ store.subtaskMeta[subModal.scen]?.[n]?.desc || '暂无说明' }}
          </td>
          <td>
            <a-tag v-if="store.subtaskMeta[subModal.scen]?.[n]?.required" color="red">必选</a-tag>
            <a-tag v-else color="default">可选</a-tag>
          </td>
          <td class="num muted">
            {{ store.clips.filter((c) => c.scen === subModal.scen && c.segs.some((s) => s.n === n)).length }} 片段
          </td>
          <td>
            <div class="row" style="gap:4px">
              <a-button size="small" type="link" @click="startEditSubtask(n)">编辑</a-button>
              <a-button size="small" type="link" danger @click="handleDeleteSubtask(n)">删除</a-button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="row between" style="margin-top:14px">
      <span class="muted" style="font-size:12px">添加或编辑后实时同步至当前标注切片下拉菜单</span>
      <a-button size="small" @click="store.resetSubNames(subModal.scen); toast('已重置为场景初始默认子任务')">恢复场景默认</a-button>
    </div>
  </a-modal>

  <!-- 快捷键指南弹窗 -->
  <a-modal v-model:open="shortcutGuideOpen" title="键盘操作快捷键指南" width="560px" centered :footer="null">
    <div class="kbd-guide-grid">
      <div class="kbd-row"><div class="keys"><kbd>Space</kbd></div><div class="desc">播放 / 暂停视频与时空轨迹播放</div></div>
      <div class="kbd-row"><div class="keys"><kbd>←</kbd> <kbd>→</kbd></div><div class="desc">微调步进（向左 / 向右前进或后退 0.1 秒，逐帧对准）</div></div>
      <div class="kbd-row"><div class="keys"><kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd></div><div class="desc">快速进退（向左 / 向右跨越 2.0 秒）</div></div>
      <div class="kbd-row"><div class="keys"><kbd>A</kbd> 或 <kbd>S</kbd></div><div class="desc">在当前播放头位置切分现有切片或新增切片</div></div>
      <div class="kbd-row"><div class="keys"><kbd>M</kbd></div><div class="desc">将当前选中的切片与相邻下一切片合并</div></div>
      <div class="kbd-row"><div class="keys"><kbd>D</kbd> 或 <kbd>Del</kbd></div><div class="desc">删除当前选中的切片</div></div>
      <div class="kbd-row"><div class="keys"><kbd>Ctrl</kbd> + <kbd>Z</kbd></div><div class="desc">撤销上一步切片操作（支持连续多步撤销）</div></div>
      <div class="kbd-row"><div class="keys"><kbd>Ctrl</kbd> + <kbd>S</kbd></div><div class="desc">即时保存标注草稿至缓存</div></div>
      <div class="kbd-row"><div class="keys"><kbd>Esc</kbd></div><div class="desc">取消选中当前切片</div></div>
    </div>
  </a-modal>
</template>

<style scoped>
.ann2 { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 620px; }
.work { padding: 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 520px; }
.hint-row { display: flex; gap: 12px; font-size: 12.5px; flex-wrap: wrap; }
.stbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.stbl th { text-align: left; font-weight: 500; color: var(--muted); padding: 8px 8px; border-bottom: 1px solid var(--line); background: var(--surface-2); }
.stbl td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.stbl tr.sel td { background: var(--accent-soft); }
.stbl tr.flag td { background: var(--crit-soft); }
.dot { display: block; width: 10px; height: 10px; border-radius: 3px; }
.actbar { position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px; padding: 12px 0 2px; margin-top: 4px; border-top: 1px solid var(--line); background: var(--surface); flex-wrap: wrap; }
kbd { font: 11px var(--font-mono); padding: 1px 5px; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--surface-2); }

.val-banner { padding: 14px 16px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--line); }
.val-banner.pass { background: var(--good-soft); border-color: var(--good-solid); }
.val-banner.warn { background: var(--warn-soft); border-color: var(--warn-solid); }
.val-banner.fatal { background: var(--crit-soft); border-color: var(--crit-solid); }
.val-score-badge { width: 56px; height: 56px; border-radius: 8px; background: var(--surface); display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: var(--shadow-sm); }
.val-score-num { font: 700 20px/1.1 var(--font-mono); color: var(--accent); }
.val-score-lbl { font-size: 10.5px; color: var(--muted); }
.val-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.val-stat { background: var(--surface-2); border-radius: 6px; padding: 10px; text-align: center; }
.val-stat .num { display: block; font: 700 18px var(--font-mono); margin-bottom: 2px; }
.val-stat .lbl { font-size: 11.5px; color: var(--muted); }
.val-issues-list { display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto; padding-right: 4px; }
.val-issue-item { padding: 10px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); font-size: 13px; }
.val-issue-item.fatal { border-left: 4px solid var(--crit-solid); }
.val-issue-item.warn { border-left: 4px solid var(--warn-solid); }
.val-issue-item.info { border-left: 4px solid var(--accent); }
.val-issue-item.pass { border-left: 4px solid var(--good-solid); }
.val-issue-item .desc { font-size: 12px; color: var(--muted); margin-top: 4px; line-height: 1.5; }
.val-tag { font-size: 11px; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
.val-tag.fatal { background: var(--crit-soft); color: var(--crit-solid); }
.val-tag.warn { background: var(--warn-soft); color: var(--warn-solid); }
.val-tag.info { background: var(--accent-soft); color: var(--accent); }
.val-tag.pass { background: var(--good-soft); color: var(--good-solid); }

.kbd-guide-grid { display: flex; flex-direction: column; gap: 10px; }
.kbd-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 6px; background: var(--surface-2); }
.kbd-row .keys { display: flex; gap: 4px; align-items: center; }
.kbd-row .desc { font-size: 13px; color: var(--text); }

@media (max-width: 900px) { .ann2 { grid-template-columns: 1fr; } }
</style>
