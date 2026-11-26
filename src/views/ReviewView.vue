<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import ClipList from '@/components/annotate/ClipList.vue'
import VideoWall from '@/components/annotate/VideoWall.vue'
import SliceTimeline from '@/components/annotate/SliceTimeline.vue'
import { fmtT } from '@/components/annotate/motion'
import { CLIP_ST, colorOf, useAnnotate, type Clip, type Seg } from '@/stores/annotate'
import {
  DIM_SCORE_DEFS,
  ISSUE_KIND,
  REASON_OPTS,
  SEV,
  VERDICT,
  useReview,
  type IssueKind,
  type IssueSev,
  type Verdict,
} from '@/stores/review'
import { useDict } from '@/stores/dict'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'
import type { BadgeKind } from '@/constants'
import { clamp } from '@/utils'

const annStore = useAnnotate()
const rv = useReview()
const dict = useDict()
const session = useSession()
const router = useRouter()

const canReview = computed(() => session.can('review'))
const activeTab = ref<'review' | 'stats'>('review')
const shortcutGuideOpen = ref(false)
const busy = ref(false)

/* 待审池 / 我的审核 / 已审 */
const view = ref<'pool' | 'mine' | 'done'>('mine')
const claimN = ref(5)
const clip = computed<Clip | undefined>(() => rv.byNumericId(rv.curId))
const inPool = computed(() => !!clip.value && clip.value.status === 'submitted' && !clip.value.reviewerId)
const reviewable = computed(() => canReview.value && !!clip.value && clip.value.reviewable)

const poolCount = computed(() => rv.summary?.pool ?? 0)
const mineCount = computed(() => rv.summary?.mine ?? 0)
const doneCount = computed(() => rv.summary?.done_total ?? 0)

function dueText(c: Clip) {
  if (!c.dueAt) return ''
  const diffH = Math.round((new Date(c.dueAt).getTime() - Date.now()) / 3600000)
  if (c.overdue || diffH <= 0) return '已超时'
  return diffH < 24 ? `${diffH} 小时内` : `${Math.ceil(diffH / 24)} 天内`
}

async function loadList(keepCur = true) {
  try {
    const list = await rv.fetchItems({ view: view.value })
    if (!list.length) {
      rv.curId = null
      return
    }
    if (!keepCur || !list.some((c) => c.numericId === rv.curId)) {
      await pick(list[0].numericId)
    }
  } catch (err: any) {
    toast(err?.message || '加载审核列表失败', { type: 'warn' })
  }
}

async function pick(id: number) {
  rv.curId = id
  t.value = 0
  playing.value = false
  sel.value = null
  try {
    const detail = await rv.fetchDetail(id)
    if (detail && detail.reviewable && !orig.value[detail.numericId]) {
      orig.value[detail.numericId] = cloneSegs(detail.segs)
    }
  } catch (err: any) {
    toast(err?.message || '加载审核详情失败', { type: 'warn' })
  }
}

watch(view, () => loadList(false))
watch(activeTab, (tab) => {
  if (tab === 'stats') {
    rv.fetchStats(rv.statsRange).catch(() => {})
    rv.fetchSampleRatio().catch(() => {})
  }
})

async function doClaim(x?: Clip) {
  busy.value = true
  try {
    const payload = x ? { ids: [x.numericId] } : { count: claimN.value }
    const res = await rv.claim(payload)
    if (!res.claimed.length) {
      toast('待审池中没有可领取的数据（自动跳过本人标注）', { type: 'warn' })
      return
    }
    toast(`已领取 ${res.claimed.length} 条待审数据`)
    const firstId = res.claimed[0].id
    if (view.value !== 'mine') view.value = 'mine'
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
  if (!(await confirmDlg({ title: '放回待审池？', msg: '放回后其他审核员可以领取审核。', ok: '放回' }))) return
  busy.value = true
  try {
    await rv.release(c.numericId)
    delete orig.value[c.numericId]
    toast('已放回待审池')
    await loadList(false)
  } catch (err: any) {
    toast(err?.message || '放回待审池失败', { type: 'crit' })
  } finally {
    busy.value = false
  }
}

async function refreshPreview() {
  const c = clip.value
  if (!c) return
  try {
    const preview = await annStore.refreshUrls(c.numericId)
    c.preview = preview
    if (preview.duration_ms > 0) {
      c.durationMs = preview.duration_ms
      c.dur = +(preview.duration_ms / 1000).toFixed(2)
    }
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
  const sum = await rv.fetchSummary()
  if (sum && sum.mine === 0 && sum.pool > 0) {
    view.value = 'pool'
  }
  await loadList(false)
})

function toggle() {
  if (!clip.value || !clip.value.dur) return
  if (t.value >= clip.value.dur) t.value = 0
  playing.value = !playing.value
}

const sorted = computed(() => (clip.value ? clip.value.segs.slice().sort((a, b) => a.s - b.s) : []))
const coverage = computed(() => {
  if (!clip.value || !clip.value.dur) return 0
  return Math.min(100, Math.round((sorted.value.reduce((a, s) => a + Math.max(0, s.e - s.s), 0) / clip.value.dur) * 100))
})

const openIssues = computed(() => (clip.value ? clip.value.issues.filter((x) => x.open) : []))
const issueOf = (seg: Seg) =>
  openIssues.value.find((x) => x.segment_id != null && (x.segment_id === seg.serverId || x.segment_id === seg.id))
const fatalN = computed(() => openIssues.value.filter((x) => x.severity === 'fatal').length)

/* 审核员直接修正切片对比 */
const orig = ref<Record<number, Seg[]>>({})
const cloneSegs = (l: Seg[]) => l.map((x) => ({ ...x }))

const edits = computed<string[]>(() => {
  const c = clip.value
  const o = c ? orig.value[c.numericId] : undefined
  if (!c || !o) return []
  const out: string[] = []
  for (const a of o) {
    const b = c.segs.find((x) => x.id === a.id)
    if (!b) { out.push(`删除「${a.n}」`); continue }
    if (b.n !== a.n) out.push(`「${a.n}」改为「${b.n}」`)
    if (b.s !== a.s || b.e !== a.e) out.push(`「${b.n}」区间 ${a.s.toFixed(1)}–${a.e.toFixed(1)}s → ${b.s.toFixed(1)}–${b.e.toFixed(1)}s`)
  }
  for (const b of c.segs) if (!o.some((a) => a.id === b.id)) out.push(`新增「${b.n}」${b.s.toFixed(1)}–${b.e.toFixed(1)}s`)
  return out
})

function revertEdits() {
  const c = clip.value
  const o = c ? orig.value[c.numericId] : undefined
  if (!c || !o) return
  c.segs = cloneSegs(o)
  toast('已撤销全部修改')
}

const subOpts = computed(() => {
  if (!clip.value) return []
  const actions = dict.actionsFor(clip.value.scen || undefined)
  const list = actions.length ? actions : dict.actionsFor()
  return list.map((x) => ({ value: x.name, label: x.name }))
})

function onSegLabelChange(seg: Seg) {
  if (!clip.value) return
  seg.dictItemId = annStore.resolveDictItemId(seg.n, seg.dictItemId, clip.value.scen)
}

function bounds(seg: Seg): [number, number] {
  const i = sorted.value.findIndex((x) => x.id === seg.id)
  return [i > 0 ? sorted.value[i - 1].e : 0, i < sorted.value.length - 1 ? sorted.value[i + 1].s : clip.value?.dur ?? 0]
}

function setTime(seg: Seg, key: 's' | 'e', v: unknown) {
  const n = Number(v)
  if (v === null || v === '' || Number.isNaN(n)) return
  const [lo, hi] = bounds(seg)
  const s = key === 's' ? n : seg.s
  const e = key === 'e' ? n : seg.e
  if (s < lo - 0.001 || e > hi + 0.001 || e - s < 0.3) return toast('时间范围无效：不能与相邻切片重叠，且时长至少 0.3s', { type: 'warn' })
  seg[key] = +n.toFixed(1)
}

function delSeg(seg: Seg) {
  const c = clip.value
  if (!c) return
  c.segs = c.segs.filter((x) => x.id !== seg.id)
  if (sel.value === seg.id) sel.value = null
}

/* 问题标记（对接 POST/DELETE /review/items/{id}/issues） */
const KIND_OPTS = (Object.keys(ISSUE_KIND) as IssueKind[]).map((k) => ({ value: k, label: ISSUE_KIND[k] }))
const issueModal = reactive({
  open: false,
  saving: false,
  seg: null as Seg | null,
  kind: 'boundary' as IssueKind,
  severity: 'normal' as IssueSev,
  desc: '',
})

function openTagIssue(seg: Seg) {
  const old = issueOf(seg)
  Object.assign(issueModal, {
    open: true,
    saving: false,
    seg,
    kind: old?.issue_type ?? 'boundary',
    severity: old?.severity ?? 'normal',
    desc: old?.description ?? '',
  })
}

async function saveIssue() {
  const c = clip.value
  const seg = issueModal.seg
  if (!c || !seg) return
  const desc = issueModal.desc.trim()
  if (!desc) return toast('请填写问题说明', { type: 'warn' })
  issueModal.saving = true
  try {
    await rv.addIssue(c.numericId, {
      segment_id: seg.serverId ?? null,
      at_ms: Math.round(seg.s * 1000),
      issue_type: issueModal.kind,
      severity: issueModal.severity,
      description: desc,
    })
    issueModal.open = false
    toast('已记录问题')
  } catch (err: any) {
    toast(err?.message || '标记问题失败', { type: 'crit' })
  } finally {
    issueModal.saving = false
  }
}

async function removeIssue(seg: Seg) {
  const c = clip.value
  const iss = issueOf(seg)
  if (!c || !iss) return
  busy.value = true
  try {
    await rv.removeIssue(c.numericId, iss.id)
    toast('已取消问题标记')
  } catch (err: any) {
    toast(err?.message || '删除问题标记失败', { type: 'crit' })
  } finally {
    busy.value = false
  }
}

/* 四种审核结论（对接 POST /review/items/{id}/decide） */
const dec = reactive({
  open: false,
  saving: false,
  v: 'approve' as Verdict,
  reasons: [] as IssueKind[],
  text: '',
  enableScore: false,
  scores: { time: 5, action: 5, obj: 5, semantic: 5, outcome: 5, consistency: 5 } as Record<string, number>,
})

function openDecision(v: Verdict) {
  if (!reviewable.value) return
  if (v === 'approve' && edits.value.length) v = 'approve_modified'
  if (v === 'approve' && fatalN.value) return toast('存在致命问题，请先直接修正切片或驳回', { type: 'warn' })
  const flagged = openIssues.value.map((x) => x.description).join('；')
  const defaultReasons = Array.from(new Set(openIssues.value.map((x) => x.issue_type)))
  Object.assign(dec, {
    open: true,
    saving: false,
    v,
    reasons: v === 'reject' || v === 'redo' ? defaultReasons : [],
    text: v === 'reject' || v === 'redo' ? flagged : '',
    enableScore: false,
    scores: { time: 5, action: 5, obj: 5, semantic: 5, outcome: 5, consistency: 5 },
  })
}

async function confirmDecision() {
  const c = clip.value
  if (!c) return
  const text = dec.text.trim()
  if (dec.v === 'reject' && !dec.reasons.length) return toast('驳回时请至少选择一项原因', { type: 'warn' })
  if (dec.reasons.includes('other') && !text) return toast('选择「其他原因」时请填写补充说明', { type: 'warn' })

  dec.saving = true
  try {
    await rv.decide(c.numericId, {
      version: c.version,
      decision: dec.v,
      segments: dec.v === 'approve_modified' ? annStore.segsToPayload(c.segs, c.scen) : undefined,
      reasons: dec.v === 'reject' || dec.v === 'redo' ? dec.reasons : undefined,
      comment: text || undefined,
      dim_scores: dec.enableScore ? { ...dec.scores } : undefined,
    })
    delete orig.value[c.numericId]
    dec.open = false
    toast(
      {
        approve: '已通过，数据进入后续流程',
        approve_modified: '已修改并通过',
        reject: `已驳回给 ${c.owner || '标注员'} 修改`,
        redo: '已退回重做，数据回到标注任务池',
      }[dec.v]
    )
    await loadList(false)
  } catch (err: any) {
    toast(err?.message || '提交审核决定失败', { type: 'crit' })
  } finally {
    dec.saving = false
  }
}

/* 抽检比例保存 */
const savingRatio = ref(false)
async function saveSampleRatio() {
  savingRatio.value = true
  try {
    await rv.updateSampleRatio(rv.sampleRate)
    toast(`抽检比例已更新为 ${rv.sampleRate}%`)
  } catch (err: any) {
    toast(err?.message || '更新抽检比例失败', { type: 'crit' })
  } finally {
    savingRatio.value = false
  }
}

/* 快捷键 */
function onKey(e: KeyboardEvent) {
  if (issueModal.open || dec.open || shortcutGuideOpen.value || activeTab.value !== 'review') return
  const el = e.target as HTMLElement
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.closest?.('.ant-select') || el?.closest?.('.ant-input') || el?.closest?.('.ant-rate') || el?.isContentEditable) return
  const k = e.key.toLowerCase()
  const code = e.code
  if (code === 'Space') { e.preventDefault(); toggle(); return }
  if (code === 'ArrowLeft' && clip.value) { e.preventDefault(); t.value = clamp(+(t.value - (e.shiftKey ? 2 : 0.1)).toFixed(2), 0, clip.value.dur); return }
  if (code === 'ArrowRight' && clip.value) { e.preventDefault(); t.value = clamp(+(t.value + (e.shiftKey ? 2 : 0.1)).toFixed(2), 0, clip.value.dur); return }
  if ((k === 't' || k === 'f') && !e.ctrlKey && !e.metaKey && !e.altKey && reviewable.value) {
    e.preventDefault()
    const seg = sorted.value.find((s) => s.id === sel.value) ?? sorted.value.find((s) => t.value >= s.s && t.value <= s.e)
    if (seg) openTagIssue(seg)
    else toast('请先选中或移动至要标记问题的切片', { type: 'warn' })
    return
  }
  if (k === 'escape') sel.value = null
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  if (timer) clearInterval(timer)
})

const maxReason = computed(() => Math.max(1, ...(rv.stats?.reasons || []).map((r) => r.count)))
const maxVerdict = computed(() => Math.max(1, ...(rv.stats?.decisions || []).map((r) => r.count)))
</script>

<template>
  <PageHead title="审核工作台" desc="从待审池领取后审核：小问题直接修正切片后通过，大问题标记后驳回或退回重做">
    <div class="row" style="gap:8px;align-items:center">
      <div class="seg" role="tablist">
        <button type="button" role="tab" :aria-selected="activeTab === 'review'" @click="activeTab = 'review'"><span>审核</span></button>
        <button type="button" role="tab" :aria-selected="activeTab === 'stats'" @click="activeTab = 'stats'"><span>质量统计</span></button>
      </div>
      <a-button size="small" @click="router.push({ name: 'dict' })"><AppIcon name="layers" size="sm" />标注字典 <span class="mono muted" style="margin-left:4px">{{ dict.version }}</span></a-button>
      <a-button v-if="activeTab === 'review'" size="small" @click="shortcutGuideOpen = true"><AppIcon name="kbd" size="sm" />快捷键</a-button>
    </div>
  </PageHead>

  <template v-if="activeTab === 'review'">
    <div class="card ann2">
      <ClipList
        filter=""
        :clips="rv.items"
        :cur="clip?.numericId ?? null"
        :filters="[]"
        :loading="rv.loadingList"
        :empty-desc="view === 'pool' ? '待审池为空' : view === 'mine' ? '没有待审数据，可去待审池领取' : '暂无已审数据'"
        @pick="pick"
      >
        <template #head>
          <div class="vseg" role="tablist" aria-label="审核视图">
            <button type="button" role="tab" :aria-selected="view === 'pool'" @click="view = 'pool'">待审池 <span class="num">{{ poolCount }}</span></button>
            <button type="button" role="tab" :aria-selected="view === 'mine'" @click="view = 'mine'">我的审核 <span class="num">{{ mineCount }}</span></button>
            <button type="button" role="tab" :aria-selected="view === 'done'" @click="view = 'done'">已审 <span class="num">{{ doneCount }}</span></button>
          </div>
          <div v-if="view === 'pool'" class="claim">
            <span class="ct">每次领取</span>
            <a-input-number v-model:value="claimN" size="small" :min="1" :max="10" style="width:60px" aria-label="领取条数" />
            <span class="ct">条</span><span class="grow" />
            <a-button size="small" type="primary" :loading="busy" :disabled="!rv.items.length || !canReview" title="按加急优先、时限从近到远领取" @click="doClaim()">批量领取</a-button>
          </div>
        </template>
        <template #meta="{ clip: c }">
          <span v-if="c.status === 'submitted'" class="row" style="gap:6px;font-size:11.5px">
            <span class="tag" :class="c.prio === 'urgent' ? 'crit' : ''" style="font-size:11px">{{ c.prio === 'urgent' ? '加急' : '普通' }}</span>
            <span class="muted">{{ dueText(c) }} · 标注 {{ c.owner ?? '-' }}</span>
          </span>
          <span v-else-if="c.decisionLabel" class="muted" style="font-size:11.5px">
            结论：{{ c.decisionLabel }}<template v-if="c.decidedAt"> · {{ c.decidedAt.replace('T', ' ').slice(5, 16) }}</template>
          </span>
        </template>
      </ClipList>

      <div class="work">
        <EmptyState v-if="!clip" icon="inbox" title="请选择一条数据" desc="从待审池领取后开始审核" />
        <template v-else>
          <div class="row between" style="gap:12px;align-items:flex-start">
            <div style="min-width:0">
              <div class="row" style="gap:8px">
                <span class="mono ell">{{ clip.id }} · {{ clip.file }}</span>
                <StatusBadge :kind="(CLIP_ST[clip.status]?.[0] || 'info') as BadgeKind" :text="clip.statusLabel" />
                <span v-if="clip.status === 'submitted'" class="tag" :class="clip.prio === 'urgent' || clip.overdue ? 'crit' : ''">{{ clip.prio === 'urgent' ? '加急' : '普通' }}<template v-if="dueText(clip)"> · {{ dueText(clip) }}</template></span>
              </div>
              <div class="muted" style="font-size:12.5px;margin-top:2px">
                {{ clip.sceneName || clip.scen || '未分配场景' }} · {{ clip.dur ? clip.dur.toFixed(1) + ' 秒' : '—' }} · 批次 {{ clip.batch || '—' }} · 标注员 {{ clip.owner ?? '-' }}
              </div>
            </div>
            <a-button v-if="reviewable" size="small" :loading="busy" @click="doRelease">放回待审池</a-button>
          </div>

          <div v-if="inPool" class="callout info">
            <AppIcon name="inbox" /><span class="grow">该数据在待审池中，领取后才能审核</span>
            <a-button size="small" type="primary" :loading="busy" :disabled="!canReview" @click="doClaim(clip)">领取此条</a-button>
          </div>
          <div v-else-if="clip.status === 'submitted' && !reviewable && clip.reviewer" class="callout">
            <AppIcon name="user" /><span>已由 {{ clip.reviewer }} 领取审核，当前只读</span>
          </div>
          <div v-if="clip.submitNote" class="callout"><AppIcon name="info" /><span><b>标注员说明：</b>{{ clip.submitNote }}</span></div>
          <div v-if="clip.rejectReason && clip.status === 'rejected'" class="callout warn" role="alert">
            <AppIcon name="alert" /><span><b>驳回原因：</b>{{ clip.rejectReason }}</span>
          </div>

          <VideoWall :clip="clip" :t="t" :playing="playing" :speed="speed" :loading="rv.loadingDetail" @refresh="refreshPreview" />

          <div class="row" style="gap:10px;flex-wrap:wrap">
            <a-button type="primary" :disabled="!clip.dur" @click="toggle"><AppIcon :name="playing ? 'pause' : 'play'" />{{ playing ? '暂停' : '播放' }}</a-button>
            <span class="mono num">{{ fmtT(t) }} / {{ fmtT(clip.dur) }}</span>
            <a-select v-model:value="speed" size="small" style="width:76px" aria-label="播放速度" :options="[{ value: 0.5, label: '0.5×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }]" />
            <span class="grow" />
            <span class="muted" style="font-size:12.5px">覆盖率 {{ coverage }}% · 切片 {{ sorted.length }} 个 · 问题 {{ openIssues.length }} 个</span>
          </div>

          <SliceTimeline v-model:t="t" :clip="clip" :selected="sel" :editable="reviewable" @select="sel = $event" />

          <div v-if="reviewable" class="callout" :class="edits.length ? 'info' : ''">
            <AppIcon :name="edits.length ? 'pencil' : 'info'" />
            <span class="grow" v-if="!edits.length">小问题可直接在时间轴拖动边界，或在下表修改子任务、起止时间、删除切片；修改后点「修改后通过」即可</span>
            <span class="grow" v-else><b>已修正 {{ edits.length }} 处：</b>{{ edits.slice(0, 3).join('；') }}{{ edits.length > 3 ? ' 等' : '' }}</span>
            <a-button v-if="edits.length" size="small" @click="revertEdits">撤销全部修改</a-button>
          </div>

          <div style="font-weight:600;font-size:13.5px;margin-top:4px">逐段核对 ({{ sorted.length }})</div>
          <table class="stbl" aria-label="切片明细与问题标记">
            <thead>
              <tr><th style="width:26px" /><th>子任务</th><th style="width:120px">开始 (s)</th><th style="width:120px">结束 (s)</th><th style="width:70px">时长</th><th style="width:220px">问题</th><th style="width:150px">操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in sorted" :key="s.id" :class="{ sel: sel === s.id, flag: !!issueOf(s) }" @click="sel = s.id">
                <td><i class="dot" :style="{ background: colorOf(clip.scen, s.n) }" /></td>
                <td>
                  <a-select v-if="reviewable" v-model:value="s.n" size="small" style="width:100%" aria-label="子任务" :options="subOpts" @click.stop @change="onSegLabelChange(s)" />
                  <b v-else>{{ s.n }}</b>
                  <span v-if="!dict.isValid(s.n)" class="tag crit" style="font-size:10.5px;margin-left:4px">非字典</span>
                </td>
                <td @click.stop><a-input-number v-if="reviewable" :value="s.s" size="small" :min="0" :max="clip.dur" :step="0.1" style="width:100%" aria-label="开始时间" @change="(v: unknown) => setTime(s, 's', v)" /><span v-else class="num">{{ s.s.toFixed(1) }}</span></td>
                <td @click.stop><a-input-number v-if="reviewable" :value="s.e" size="small" :min="0" :max="clip.dur" :step="0.1" style="width:100%" aria-label="结束时间" @change="(v: unknown) => setTime(s, 'e', v)" /><span v-else class="num">{{ s.e.toFixed(1) }}</span></td>
                <td class="num muted">{{ (s.e - s.s).toFixed(1) }} s</td>
                <td>
                  <template v-if="issueOf(s)">
                    <span class="tag" :class="SEV[issueOf(s)!.severity]?.[0] || 'warn'" style="font-size:11px">{{ issueOf(s)!.severity_label }}</span>
                    <span style="font-size:12px;margin-left:4px">{{ issueOf(s)!.issue_type_label }}：{{ issueOf(s)!.description }}</span>
                  </template>
                  <span v-else class="muted" style="font-size:12px">—</span>
                </td>
                <td @click.stop>
                  <div class="row" style="gap:2px">
                    <a-button size="small" type="text" @click="t = s.s">定位</a-button>
                    <template v-if="reviewable">
                      <a-button v-if="!issueOf(s)" size="small" type="text" @click="openTagIssue(s)">标记</a-button>
                      <a-button v-else size="small" type="text" @click="removeIssue(s)">取消标记</a-button>
                      <a-button size="small" type="text" danger @click="delSeg(s)">删除</a-button>
                    </template>
                  </div>
                </td>
              </tr>
              <tr v-if="!sorted.length"><td colspan="7" class="muted" style="text-align:center;padding:20px">没有切片</td></tr>
            </tbody>
          </table>

          <div class="actbar">
            <span class="muted grow" style="font-size:12px"><kbd>Space</kbd> 播放　<kbd>←</kbd><kbd>→</kbd> 0.1s　<kbd>T</kbd> 标记问题</span>
            <template v-if="reviewable">
              <a-button danger @click="openDecision('redo')">退回重做</a-button>
              <a-button danger @click="openDecision('reject')">驳回</a-button>
              <a-button
                type="primary"
                :disabled="fatalN > 0 && !edits.length"
                :title="fatalN && !edits.length ? '存在致命问题，请直接修正切片或驳回' : undefined"
                @click="openDecision('approve')"
              >
                <AppIcon name="check" size="sm" />{{ edits.length ? '修改后通过' : '通过' }}
              </a-button>
            </template>
            <a-button v-else-if="inPool" type="primary" :loading="busy" :disabled="!canReview" @click="doClaim(clip)">领取此条</a-button>
            <span v-else-if="clip.status === 'approved'" style="color:var(--good-solid);font-weight:600;display:flex;align-items:center;gap:4px"><AppIcon name="check" size="sm" />{{ clip.statusLabel || '已通过并归档' }}</span>
            <span v-else-if="clip.status === 'rejected'" class="muted" style="font-size:12px">已驳回给标注员修改</span>
          </div>
        </template>
      </div>
    </div>
  </template>

  <!-- TAB 2: 质量统计（对接 GET /review/stats & GET/PUT /review/settings/sample-ratio） -->
  <template v-else>
    <div class="row between" style="margin-bottom:12px">
      <div class="seg" role="group" aria-label="统计周期">
        <button type="button" :aria-pressed="rv.statsRange === 'today'" @click="rv.fetchStats('today')">今天</button>
        <button type="button" :aria-pressed="rv.statsRange === '7d'" @click="rv.fetchStats('7d')">近 7 天</button>
        <button type="button" :aria-pressed="rv.statsRange === '30d'" @click="rv.fetchStats('30d')">近 30 天</button>
      </div>
      <a-button size="small" :loading="rv.loadingStats" @click="rv.fetchStats(rv.statsRange)"><AppIcon name="refresh" size="sm" />刷新统计</a-button>
    </div>

    <a-spin :spinning="rv.loadingStats">
      <div class="grid g4" style="margin-bottom:16px">
        <div class="card kpi"><span class="k">今日审核</span><span class="v">{{ rv.stats?.today_count ?? 0 }}<small>条</small></span><span class="d">周期累计 {{ rv.stats?.total ?? 0 }} 条 · 免检 {{ rv.stats?.exempt_count ?? 0 }} 条</span></div>
        <div class="card kpi"><span class="k">通过率</span><span class="v">{{ rv.stats?.pass_rate != null ? Math.round(rv.stats.pass_rate) : '—' }}<small v-if="rv.stats?.pass_rate != null">%</small></span><span class="d">含修改后通过</span></div>
        <div class="card kpi"><span class="k">驳回率</span><span class="v">{{ rv.stats?.reject_rate != null ? Math.round(rv.stats.reject_rate) : '—' }}<small v-if="rv.stats?.reject_rate != null">%</small></span><span class="d">含退回重做</span></div>
        <div class="card kpi"><span class="k">修改后通过</span><span class="v">{{ rv.stats?.modified_rate != null ? Math.round(rv.stats.modified_rate) : '—' }}<small v-if="rv.stats?.modified_rate != null">%</small></span><span class="d">平均审核耗时 {{ rv.stats?.avg_duration_s != null ? rv.stats.avg_duration_s + 's' : '—' }}</span></div>
      </div>

      <div class="stat-grid">
        <div class="card pad">
          <b>审核结论分布</b>
          <div v-for="x in rv.stats?.decisions || []" :key="x.key" class="bar-row">
            <span class="bl">{{ x.label }}</span>
            <span class="bt"><i :class="VERDICT[x.key as Verdict]?.[0] || 'info'" :style="{ width: (x.count / maxVerdict) * 100 + '%' }" /></span>
            <span class="num">{{ x.count }}</span>
          </div>
          <div v-if="!rv.stats?.decisions?.length" class="muted" style="margin-top:10px">暂无记录</div>
        </div>

        <div class="card pad">
          <b>常见驳回原因</b>
          <div v-for="r in (rv.stats?.reasons || []).slice(0, 6)" :key="r.key" class="bar-row">
            <span class="bl wide" :title="r.label">{{ r.label }}</span>
            <span class="bt"><i class="warn" :style="{ width: (r.count / maxReason) * 100 + '%' }" /></span>
            <span class="num">{{ r.count }}</span>
          </div>
          <div v-if="!rv.stats?.reasons?.length" class="muted" style="margin-top:10px">暂无驳回记录</div>
        </div>

        <div class="card pad">
          <b>抽检比例配置</b>
          <div class="muted" style="font-size:12px;margin:4px 0 10px;line-height:1.6">标注员提交后按比例随机抽中进入待审池，0% 全部免检，100% 为全检</div>
          <div class="row" style="gap:8px">
            <a-input-number v-model:value="rv.sampleRate" :min="0" :max="100" :step="10" addon-after="%" style="width:130px" :disabled="!canReview" aria-label="抽检比例" />
            <a-button type="primary" size="small" :loading="savingRatio" :disabled="!canReview" @click="saveSampleRatio">保存</a-button>
          </div>
        </div>
      </div>

      <div v-if="rv.stats?.annotators?.length || rv.stats?.reviewers?.length" class="stat-grid-2" style="margin-top:16px">
        <div class="card pad">
          <b>标注员质量统计</b>
          <table class="stbl" style="margin-top:8px">
            <thead><tr><th>标注员</th><th>被审</th><th>通过</th><th>驳回</th><th>通过率</th><th>均分</th></tr></thead>
            <tbody>
              <tr v-for="a in rv.stats?.annotators || []" :key="a.user_id">
                <td>{{ a.name || `#${a.user_id}` }}</td>
                <td class="num">{{ a.reviewed }}</td>
                <td class="num">{{ a.passed }}</td>
                <td class="num">{{ a.rejected }}</td>
                <td class="num">{{ a.pass_rate != null ? Math.round(a.pass_rate) + '%' : '—' }}</td>
                <td class="num">{{ a.avg_score != null ? a.avg_score.toFixed(1) : '—' }}</td>
              </tr>
              <tr v-if="!rv.stats?.annotators?.length"><td colspan="6" class="muted" style="text-align:center">暂无数据</td></tr>
            </tbody>
          </table>
        </div>
        <div class="card pad">
          <b>审核员工作量统计</b>
          <table class="stbl" style="margin-top:8px">
            <thead><tr><th>审核员</th><th>审核条数</th><th>平均耗时</th></tr></thead>
            <tbody>
              <tr v-for="r in rv.stats?.reviewers || []" :key="r.user_id">
                <td>{{ r.name || `#${r.user_id}` }}</td>
                <td class="num">{{ r.reviewed }}</td>
                <td class="num">{{ r.avg_duration_s != null ? r.avg_duration_s + ' s' : '—' }}</td>
              </tr>
              <tr v-if="!rv.stats?.reviewers?.length"><td colspan="3" class="muted" style="text-align:center">暂无数据</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </a-spin>
  </template>

  <!-- 标记问题弹窗 -->
  <a-modal v-model:open="issueModal.open" title="标记问题" centered ok-text="确认标记" cancel-text="取消" :confirm-loading="issueModal.saving" @ok="saveIssue">
    <a-form layout="vertical">
      <a-form-item label="切片"><a-input :value="issueModal.seg ? `${issueModal.seg.n} (${issueModal.seg.s}s ~ ${issueModal.seg.e}s)` : ''" disabled /></a-form-item>
      <div class="row" style="gap:12px">
        <a-form-item label="问题类型" style="flex:1"><a-select v-model:value="issueModal.kind" :options="KIND_OPTS" /></a-form-item>
        <a-form-item label="严重度" style="flex:1">
          <a-radio-group v-model:value="issueModal.severity" button-style="solid">
            <a-radio-button value="fatal">致命</a-radio-button>
            <a-radio-button value="normal">一般</a-radio-button>
            <a-radio-button value="suggest">建议</a-radio-button>
          </a-radio-group>
        </a-form-item>
      </div>
      <a-form-item label="说明" required><a-textarea v-model:value="issueModal.desc" :rows="3" placeholder="如：结束时间偏早，需覆盖至开始充气前" :maxlength="200" show-count /></a-form-item>
      <div class="muted" style="font-size:12px">致命：数据不可用（标签错、漏关键动作）；一般：需修改；建议：不影响通过</div>
    </a-form>
  </a-modal>

  <!-- 审核决定弹窗 -->
  <a-modal
    v-model:open="dec.open"
    :title="VERDICT[dec.v][1]"
    centered
    :ok-text="'确认' + VERDICT[dec.v][1]"
    cancel-text="取消"
    :confirm-loading="dec.saving"
    :ok-button-props="{ danger: dec.v === 'reject' || dec.v === 'redo' }"
    @ok="confirmDecision"
  >
    <div class="callout" :class="VERDICT[dec.v][0]" style="margin-bottom:12px"><span>{{ VERDICT[dec.v][2] }}</span></div>
    <div v-if="dec.v === 'approve_modified'" style="margin-bottom:10px;font-size:12.5px">
      <div style="font-weight:600;margin-bottom:4px">本次修正（{{ edits.length }} 处）</div>
      <ul style="margin:0;padding-left:18px;color:var(--muted);line-height:1.7"><li v-for="x in edits" :key="x">{{ x }}</li></ul>
    </div>
    <template v-if="dec.v === 'reject' || dec.v === 'redo'">
      <div style="font-weight:600;margin-bottom:6px">原因（可多选）</div>
      <a-checkbox-group v-model:value="dec.reasons" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
        <a-checkbox v-for="r in REASON_OPTS" :key="r.value" :value="r.value">{{ r.label }}</a-checkbox>
      </a-checkbox-group>
    </template>
    <a-textarea v-model:value="dec.text" :rows="3" :maxlength="500" show-count style="margin-bottom:12px" :placeholder="dec.v === 'approve' || dec.v === 'approve_modified' ? '补充说明（可选）' : '补充说明修改要求'" />

    <div style="margin-top:8px">
      <a-checkbox v-model:checked="dec.enableScore">附带 6 维质量评分（1–5 分，可选）</a-checkbox>
      <div v-if="dec.enableScore" class="score-grid">
        <div v-for="dim in DIM_SCORE_DEFS" :key="dim.key" class="score-item">
          <span class="muted" style="font-size:12px">{{ dim.label }}</span>
          <a-rate v-model:value="dec.scores[dim.key]" :count="5" style="font-size:14px" />
        </div>
      </div>
    </div>
  </a-modal>

  <a-modal v-model:open="shortcutGuideOpen" title="审核快捷键" width="480px" centered :footer="null">
    <div class="kbd-guide-grid">
      <div class="kbd-row"><div class="keys"><kbd>Space</kbd></div><div class="desc">播放 / 暂停</div></div>
      <div class="kbd-row"><div class="keys"><kbd>←</kbd> <kbd>→</kbd></div><div class="desc">后退 / 前进 0.1 秒（Shift 2 秒）</div></div>
      <div class="kbd-row"><div class="keys"><kbd>T</kbd></div><div class="desc">对选中或播放头所在切片标记问题</div></div>
      <div class="kbd-row"><div class="keys"><kbd>Esc</kbd></div><div class="desc">取消选中</div></div>
    </div>
  </a-modal>
</template>

<style scoped>
.ann2 { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 640px; }
.work { padding: 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 480px; }
.stbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.stbl th { text-align: left; font-weight: 500; color: var(--muted); padding: 8px; border-bottom: 1px solid var(--line); background: var(--surface-2); }
.stbl td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.stbl tr.sel td { background: var(--accent-soft); }
.stbl tr.flag td { background: var(--crit-soft); }
.dot { display: block; width: 10px; height: 10px; border-radius: 3px; }
.vseg { display: flex; gap: 2px; padding: 3px; border-radius: 8px; background: var(--surface-3); margin-bottom: 8px; }
.vseg button { flex: 1 1 0; min-width: 0; height: 28px; padding: 0 4px; border: 0; border-radius: 6px; background: none; color: var(--muted); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.vseg button[aria-selected="true"] { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: 0 1px 2px rgba(26,42,77,.12); }
.claim { display: flex; gap: 6px; align-items: center; width: 100%; min-width: 0; }
.claim :deep(.ant-btn), .claim :deep(.ant-input-number), .claim :deep(.ant-select-selector) { height: 28px !important; }
.claim :deep(.ant-input-number-input) { height: 26px; }
.claim :deep(.ant-select-selection-item) { line-height: 26px !important; }
.claim .grow { flex: 1; min-width: 0; }
.claim .ct { font-size: 12px; color: var(--muted); white-space: nowrap; }
.stat-grid { display: grid; grid-template-columns: 1fr 1.3fr 1fr; gap: 16px; align-items: start; }
.stat-grid-2 { display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; align-items: start; }
.pad { padding: 14px 16px; }
.bar-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 12.5px; }
.bar-row .bl { width: 84px; color: var(--muted); flex: none; }
.bar-row .bl.wide { width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-row .bt { flex: 1; height: 8px; border-radius: 4px; background: var(--surface-3); overflow: hidden; }
.bar-row .bt i { display: block; height: 100%; border-radius: 4px; background: var(--accent); }
.bar-row .bt i.good { background: var(--good-solid); }
.bar-row .bt i.warn { background: var(--warn-solid); }
.bar-row .bt i.crit { background: var(--crit-solid); }
.actbar { position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px; padding: 12px 0 2px; margin-top: 4px; border-top: 1px solid var(--line); background: var(--surface); flex-wrap: wrap; }
kbd { font: 11px var(--font-mono); padding: 1px 5px; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--surface-2); }
.score-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 16px; margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: var(--surface-2); }
.score-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.kbd-guide-grid { display: flex; flex-direction: column; gap: 10px; }
.kbd-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 6px; background: var(--surface-2); }
.kbd-row .keys { display: flex; gap: 4px; align-items: center; }
.kbd-row .desc { font-size: 13px; color: var(--text); }
@media (max-width: 900px) { .ann2, .stat-grid, .stat-grid-2 { grid-template-columns: 1fr; } }
</style>
