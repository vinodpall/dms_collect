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
import { CLIP_ST, colorOf, newSegId, SUB_NAMES, useAnnotate, type Clip, type ClipStatus, type Seg } from '@/stores/annotate'
import { usePipeline } from '@/stores/pipeline'
import { NO_PERM, SCEN, type BadgeKind } from '@/constants'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'
import { clamp } from '@/utils'

const store = useAnnotate()
const pl = usePipeline()
const session = useSession()
const route = useRoute()
const router = useRouter()

/* 两种工作模式：手动标注（标注员）/ 标注校验（审核员），管理员两者皆可 */
const canLabel = computed(() => session.can('annotate'))
const canReview = computed(() => session.can('review'))
const modes = computed(() => [['label', '手动标注', store.labelTodo()], ['review', '标注校验', store.reviewTodo()]] as const)
const mode = ref<'label' | 'review'>(canLabel.value || !canReview.value ? 'label' : 'review')
watch(() => session.role, () => { mode.value = canLabel.value || !canReview.value ? 'label' : 'review' })
const showTabs = computed(() => canLabel.value && canReview.value)

const batchFilter = computed(() => (typeof route.query.batch === 'string' ? route.query.batch : ''))
const FILTERS = computed<[string, string, number][]>(() => {
  const n = (s: ClipStatus[]) => store.clips.filter((c) => s.includes(c.status) && (!batchFilter.value || c.batch === batchFilter.value)).length
  return mode.value === 'label'
    ? [['todo', '待标注', n(['todo', 'rejected'])], ['done', '已提交', n(['submitted', 'approved'])], ['all', '全部', n(['todo', 'rejected', 'submitted', 'approved'])]]
    : [['todo', '待审核', n(['submitted'])], ['approved', '已通过', n(['approved'])], ['rejected', '被打回', n(['rejected'])], ['all', '全部', n(['todo', 'rejected', 'submitted', 'approved'])]]
})
const MATCH: Record<string, ClipStatus[]> = { todo: ['todo', 'rejected'], done: ['submitted', 'approved'], all: ['todo', 'rejected', 'submitted', 'approved'], approved: ['approved'], rejected: ['rejected'] }
function matches(c: Clip, f: string) {
  if (batchFilter.value && c.batch !== batchFilter.value) return false
  if (mode.value === 'review' && f === 'todo') return c.status === 'submitted'
  return MATCH[f].includes(c.status)
}
watch(mode, () => { store.filter = 'todo' })
const vis = computed(() => store.clips.filter((c) => matches(c, store.filter)))
const clip = computed<Clip | undefined>(() => store.byId(store.cur))

function pick(id: string) { store.cur = id; t.value = 0; playing.value = false; sel.value = null }
function ensureCur() { if (vis.value.length && !vis.value.some((c) => c.id === store.cur)) pick(vis.value[0].id) }
watch([vis, mode], ensureCur)
onMounted(ensureCur)

/* 播放 */
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
function toggle() { if (!clip.value) return; if (t.value >= clip.value.dur) t.value = 0; playing.value = !playing.value }

/* 编辑权限与规则 */
const editable = computed(() => mode.value === 'label' && canLabel.value && !!clip.value && ['todo', 'rejected'].includes(clip.value.status))
const sorted = computed(() => (clip.value ? clip.value.segs.slice().sort((a, b) => a.s - b.s) : []))
const coverage = computed(() => (clip.value ? Math.min(100, Math.round((sorted.value.reduce((a, s) => a + (s.e - s.s), 0) / clip.value.dur) * 100)) : 0))
const missing = computed(() => (clip.value ? SUB_NAMES[clip.value.scen].filter((n) => !clip.value!.segs.some((s) => s.n === n)) : []))
const nowSeg = computed(() => sorted.value.find((s) => t.value >= s.s && t.value < s.e))
const flagged = computed(() => sorted.value.filter((s) => s.flag))
const nextName = (c: Clip) => SUB_NAMES[c.scen].find((n) => !c.segs.some((s) => s.n === n)) ?? SUB_NAMES[c.scen][0]

function changed() { /* 修改后即时保存（演示：数据已在内存中更新） */ }
function split() {
  const c = clip.value
  if (!c || !editable.value) return
  const seg = c.segs.find((s) => t.value - s.s >= 0.3 && s.e - t.value >= 0.3)
  if (!seg) { toast('播放头需位于某个切片内部（距边缘至少 0.3s）才能切分', { type: 'warn' }); return }
  const cut = Math.round(t.value * 10) / 10
  const n: Seg = { id: newSegId(), s: cut, e: seg.e, n: nextName(c) }
  seg.e = cut
  c.segs.push(n); sel.value = n.id
}
function remove(id?: number) {
  const c = clip.value, k = id ?? sel.value
  if (!c || !editable.value || k == null) return
  c.segs.splice(c.segs.findIndex((s) => s.id === k), 1)
  if (sel.value === k) sel.value = null
}
function bounds(seg: Seg): [number, number] {
  const c = clip.value!
  const o = c.segs.filter((x) => x.id !== seg.id)
  return [Math.max(0, ...o.filter((x) => x.e <= seg.s + 0.001).map((x) => x.e)), Math.min(c.dur, ...o.filter((x) => x.s >= seg.e - 0.001).map((x) => x.s))]
}
function setTime(seg: Seg, key: 's' | 'e', v: unknown) {
  const n = Number(v)
  if (v === null || v === '' || Number.isNaN(n)) return
  const [lo, hi] = bounds(seg)
  const s = key === 's' ? n : seg.s, e = key === 'e' ? n : seg.e
  if (s < lo - 0.001 || e > hi + 0.001 || e - s < 0.3) { toast('时间范围无效：不能与相邻切片重叠，且时长至少 0.3s', { type: 'warn' }); return }
  seg[key] = Math.round(n * 10) / 10
}

/* 提交 / 审核 */
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
  return b.stage === 3 ? '；批次 ' + id + ' 标注已全部提交，进入标注校验' : b.stage === 2 ? '；批次 ' + id + ' 退回手动标注' : b.stage === 4 ? '；批次 ' + id + ' 全部通过，进入格式转换（自动）' : ''
}
function run(c: Clip, fn: () => void, msg: string) {
  const was = vis.value.slice(), before = pl.batches.find((b) => b.id === c.batch)?.stage
  fn()
  toast(msg + batchNote(c.batch, before))
  advance(was)
}
function submit() {
  const c = clip.value
  if (!c || !editable.value) return
  if (!c.segs.length) { toast('请先在时间轴上创建至少一个子任务切片', { type: 'warn' }); return }
  run(c, () => store.submit(c), '已提交审核')
}
async function withdraw() {
  const c = clip.value
  if (!c) return
  const ok = await confirmDlg({ title: '撤回提交？', msg: '撤回后可继续修改标注，修改完成后需重新提交审核。', ok: '撤回' })
  if (!ok) return
  const before = pl.batches.find((b) => b.id === c.batch)?.stage
  c.status = 'todo'
  store.cur = c.id
  // 回到手动标注阶段
  const bt = pl.batches.find((b) => b.id === c.batch)
  if (bt && bt.stage === 3) { bt.stage = 2; bt.state = 'wait' }
  toast('已撤回，可继续修改' + batchNote(c.batch, before))
}
const rej = reactive({ open: false, reason: '', err: false })
function openReject() {
  const f = flagged.value.map((s) => '“' + s.n + '”' + s.flag).join('；')
  Object.assign(rej, { open: true, reason: f, err: false })
}
function doReject() {
  const c = clip.value
  if (!c) return
  rej.reason = rej.reason.trim()
  rej.err = rej.reason.length < 5
  if (rej.err) return
  rej.open = false
  run(c, () => store.reject(c, rej.reason, session.info.user), '已打回给标注员')
}
function approve() {
  const c = clip.value
  if (!c) return
  if (flagged.value.length) { toast('存在已标记问题的切片，请先“打回”或取消标记', { type: 'warn' }); return }
  run(c, () => store.approve(c), '审核通过')
}
function toggleFlag(s: Seg) { s.flag = s.flag ? undefined : '需修改' }

/* 键盘 */
function onKey(e: KeyboardEvent) {
  if (document.querySelector('.ant-modal-wrap, .ant-drawer-open') || e.ctrlKey || e.metaKey || e.altKey) return
  const el = e.target as HTMLElement, tag = el?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.closest?.('.ant-select')) return
  const k = e.key.toLowerCase()
  if (k === ' ' && tag !== 'BUTTON') { e.preventDefault(); toggle() }
  else if (k === 's') split()
  else if (k === 'delete' || k === 'backspace') remove()
  else if (k === 'arrowleft' && clip.value) { e.preventDefault(); t.value = clamp(t.value - (e.shiftKey ? 0.1 : 0.5), 0, clip.value.dur) }
  else if (k === 'arrowright' && clip.value) { e.preventDefault(); t.value = clamp(t.value + (e.shiftKey ? 0.1 : 0.5), 0, clip.value.dur) }
  else if (k === 'escape') sel.value = null
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); if (timer) clearInterval(timer) })

const isVr = computed(() => (clip.value ? SCEN[clip.value.scen].mode.includes('VR') : false))
const emptyDesc = computed(() => (mode.value === 'label' ? '批次进入“手动标注”阶段后，数据会出现在这里' : '标注员提交后，数据会出现在这里等待审核'))
function clearBatch() { router.replace({ name: 'annotate' }) }
</script>

<template>
  <PageHead title="标注与校验" desc="手动标注到子任务级；标注提交后由审核员审核，可通过或打回">
    <div v-if="showTabs" class="seg" role="tablist" aria-label="工作模式">
      <button v-for="m in modes" :key="m[0]" type="button" role="tab" :aria-selected="mode === m[0]" @click="mode = m[0]">{{ m[1] }} <span class="num muted">{{ m[2] }}</span></button>
    </div>
    <span v-else class="muted">{{ mode === 'label' ? '待标注 ' + store.labelTodo() + ' 条' : '待审核 ' + store.reviewTodo() + ' 条' }}</span>
  </PageHead>

  <div v-if="batchFilter" class="callout info" style="margin-bottom:12px"><AppIcon name="filter" /><span>仅显示批次 <b class="mono">{{ batchFilter }}</b> 的数据</span><a-button size="small" type="link" @click="clearBatch">清除</a-button></div>

  <div class="card ann2">
    <ClipList v-model:filter="store.filter" :clips="vis" :cur="clip?.id ?? null" :filters="FILTERS" :empty-desc="emptyDesc" @pick="pick" />

    <div class="work">
      <EmptyState v-if="!clip || !vis.length" icon="inbox" title="请选择一条数据" :desc="emptyDesc" />
      <template v-else>
        <div class="row between" style="gap:12px;align-items:flex-start">
          <div style="min-width:0">
            <div class="row" style="gap:8px"><span class="mono ell">{{ clip.file }}</span><StatusBadge :kind="CLIP_ST[clip.status][0] as BadgeKind" :text="CLIP_ST[clip.status][1]" /></div>
            <div class="muted" style="font-size:12.5px;margin-top:2px">{{ SCEN[clip.scen].name }} · {{ SCEN[clip.scen].mode }} · {{ clip.dur }} 秒 · 批次 {{ clip.batch }}<template v-if="isVr"> · 含左右手灵巧手关节数据</template></div>
          </div>
        </div>
        <div v-if="clip.reject && clip.status === 'rejected'" class="callout warn" role="alert"><AppIcon name="alert" /><span><b>被打回：</b>{{ clip.reject.reason }}<span class="muted"> —— {{ clip.reject.by }} · {{ clip.reject.t }}</span></span></div>

        <VideoWall :clip="clip" :t="t" :playing="playing" />

        <div class="row" style="gap:10px;flex-wrap:wrap">
          <a-button type="primary" @click="toggle"><AppIcon :name="playing ? 'pause' : 'play'" />{{ playing ? '暂停' : '播放' }}</a-button>
          <span class="mono num">{{ fmtT(t) }} / {{ fmtT(clip.dur) }}</span>
          <a-select v-model:value="speed" size="small" style="width:76px" aria-label="播放速度" :options="[{ value: 0.5, label: '0.5×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }]" />
          <span v-if="nowSeg" class="tag" :style="{ background: colorOf(clip.scen, nowSeg.n), color: '#fff' }">当前：{{ nowSeg.n }}</span>
          <span class="grow" />
          <template v-if="editable">
            <a-button size="small" @click="split"><AppIcon name="more" size="sm" />在播放头处切分 <kbd>S</kbd></a-button>
            <a-button size="small" danger :disabled="sel === null" @click="remove()"><AppIcon name="trash" size="sm" />删除切片 <kbd>Del</kbd></a-button>
          </template>
        </div>

        <SliceTimeline v-model:t="t" :clip="clip" :selected="sel" :editable="editable" @select="sel = $event" @changed="changed" />
        <div class="muted hint-row">
          <template v-if="editable"><span>在空白处按住拖动 = 新建切片；拖动切片 = 移动；拖动两端 = 调整边界；点击标尺 / 空白 = 定位</span></template>
          <template v-else><span>只读：{{ mode === 'review' ? '审核模式下不能修改标注，有问题请标记后打回' : '已提交的数据不能修改，如需修改请先撤回' }}</span></template>
          <span class="grow" /><span>覆盖 {{ coverage }}%<template v-if="missing.length"> · 未使用：{{ missing.join('、') }}</template></span>
        </div>

        <table class="stbl" aria-label="子任务切片">
          <thead><tr><th style="width:22px" /><th>子任务</th><th style="width:116px">开始 (s)</th><th style="width:116px">结束 (s)</th><th style="width:70px">时长</th><th :style="{ width: mode === 'review' ? '240px' : '110px' }">{{ mode === 'review' ? '审核' : '操作' }}</th></tr></thead>
          <tbody>
            <tr v-for="s in sorted" :key="s.id" :class="{ sel: sel === s.id, flag: !!s.flag }" @click="sel = s.id">
              <td><i class="dot" :style="{ background: colorOf(clip.scen, s.n) }" /></td>
              <td><a-select v-if="editable" v-model:value="s.n" size="small" style="width:100%" aria-label="子任务名称" :options="SUB_NAMES[clip.scen].map((n) => ({ value: n }))" /><span v-else>{{ s.n }}</span></td>
              <td><a-input-number v-if="editable" :value="s.s" size="small" :min="0" :max="clip.dur" :step="0.1" style="width:100%" aria-label="开始时间" @change="(v: unknown) => setTime(s, 's', v)" /><span v-else class="num">{{ s.s.toFixed(1) }}</span></td>
              <td><a-input-number v-if="editable" :value="s.e" size="small" :min="0" :max="clip.dur" :step="0.1" style="width:100%" aria-label="结束时间" @change="(v: unknown) => setTime(s, 'e', v)" /><span v-else class="num">{{ s.e.toFixed(1) }}</span></td>
              <td class="num muted">{{ (s.e - s.s).toFixed(1) }} s</td>
              <td @click.stop>
                <template v-if="mode === 'review'">
                  <div class="row" style="gap:6px">
                    <a-button size="small" :type="s.flag ? 'primary' : 'default'" :danger="!!s.flag" :disabled="!canReview || clip.status !== 'submitted'" @click="toggleFlag(s)">{{ s.flag ? '取消标记' : '标记问题' }}</a-button>
                    <a-input v-if="s.flag" v-model:value="s.flag" size="small" placeholder="问题说明" :maxlength="30" aria-label="问题说明" />
                  </div>
                </template>
                <div v-else class="row" style="gap:4px"><a-button size="small" type="text" @click="t = s.s">定位</a-button><a-button v-if="editable" size="small" type="text" danger @click="remove(s.id)">删除</a-button></div>
              </td>
            </tr>
            <tr v-if="!sorted.length"><td colspan="6" class="muted" style="text-align:center;padding:18px">暂无切片{{ editable ? '，请在时间轴上拖动创建' : '' }}</td></tr>
          </tbody>
        </table>

        <div class="actbar">
          <span class="muted grow" style="font-size:12.5px"><kbd>Space</kbd> 播放　<kbd>←</kbd><kbd>→</kbd> 步进 0.5s（Shift 0.1s）<template v-if="editable">　<kbd>S</kbd> 切分　<kbd>Del</kbd> 删除</template></span>
          <template v-if="mode === 'label'">
            <a-button v-if="clip.status === 'submitted'" :disabled="!canLabel" :title="canLabel ? undefined : NO_PERM" @click="withdraw">撤回提交</a-button>
            <a-button v-else-if="clip.status === 'approved'" disabled>已通过审核</a-button>
            <a-button v-else type="primary" :disabled="!canLabel || !clip.segs.length" :title="canLabel ? (clip.segs.length ? undefined : '请先创建至少一个子任务切片') : NO_PERM" @click="submit">提交审核</a-button>
          </template>
          <template v-else>
            <template v-if="clip.status === 'submitted'">
              <a-button danger :disabled="!canReview" :title="canReview ? undefined : NO_PERM" @click="openReject">打回</a-button>
              <a-button type="primary" :disabled="!canReview" :title="canReview ? undefined : NO_PERM" @click="approve"><AppIcon name="check" size="sm" />通过</a-button>
            </template>
            <a-button v-else disabled>{{ clip.status === 'approved' ? '已通过' : '已打回，等待标注员修改' }}</a-button>
          </template>
        </div>
      </template>
    </div>
  </div>

  <a-modal v-model:open="rej.open" title="打回标注" centered ok-text="确认打回" cancel-text="取消" :ok-button-props="{ danger: true }" @ok="doReject">
    <a-form layout="vertical">
      <a-form-item label="打回原因" :validate-status="rej.err ? 'error' : ''" :help="rej.err ? '请至少填写 5 个字，说明需要修改的地方' : '会通知标注员，并在其列表中显示；已标记的切片也会高亮'"><a-textarea v-model:value="rej.reason" :rows="3" :maxlength="120" show-count placeholder="如：“夹紧密封”结束时间偏早" /></a-form-item>
    </a-form>
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
@media (max-width: 900px) { .ann2 { grid-template-columns: 1fr; } }
</style>
