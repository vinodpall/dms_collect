<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import ClipList from '@/components/annotate/ClipList.vue'
import VideoWall from '@/components/annotate/VideoWall.vue'
import SliceTimeline from '@/components/annotate/SliceTimeline.vue'
import { fmtT } from '@/components/annotate/motion'
import { CLIP_ST, colorOf, useAnnotate, type Clip, type ClipStatus, type Seg } from '@/stores/annotate'
import { useReview, type VocabItem } from '@/stores/review'
import { usePipeline } from '@/stores/pipeline'
import { useLogs } from '@/stores/logs'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'
import { SCEN, type BadgeKind, type ScenKey } from '@/constants'
import { clamp } from '@/utils'

const store = useAnnotate()
const reviewStore = useReview()
const pl = usePipeline()
const logs = useLogs()
const session = useSession()

const canReview = computed(() => session.can('review') || session.isAdmin)
const activeTab = ref<'review' | 'vocab'>('review')
const shortcutGuideOpen = ref(false)

/* 审核任务池过滤 */
const filter = ref<string>('todo')
const FILTERS = computed<[string, string, number][]>(() => {
  const n = (s: ClipStatus[]) => store.clips.filter((c) => s.includes(c.status)).length
  return [
    ['todo', '待质检', n(['submitted'])],
    ['approved', '已通过', n(['approved'])],
    ['rejected', '已打回', n(['rejected'])],
    ['all', '全部', n(['submitted', 'approved', 'rejected'])],
  ]
})

const MATCH: Record<string, ClipStatus[]> = {
  todo: ['submitted'],
  approved: ['approved'],
  rejected: ['rejected'],
  all: ['submitted', 'approved', 'rejected', 'todo'],
}

const vis = computed(() => store.clips.filter((c) => MATCH[filter.value]?.includes(c.status) ?? true))
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

const sorted = computed(() => (clip.value ? clip.value.segs.slice().sort((a, b) => a.s - b.s) : []))
const coverage = computed(() => (clip.value ? Math.min(100, Math.round((sorted.value.reduce((a, s) => a + (s.e - s.s), 0) / clip.value.dur) * 100)) : 0))
const flagged = computed(() => sorted.value.filter((s) => s.flag))
const currentScore = computed(() => (clip.value ? reviewStore.calculateScore(clip.value.id) : 100))
const currentScoreObj = computed(() => (clip.value ? reviewStore.getScore(clip.value.id) : null))

/* 问题标记功能 */
const issueModal = reactive({
  open: false,
  seg: null as Seg | null,
  kind: 'boundary' as 'boundary' | 'label' | 'missing' | 'redundant' | 'other',
  desc: '',
})

function openTagIssue(seg: Seg) {
  issueModal.seg = seg
  issueModal.desc = seg.flag ?? ''
  issueModal.kind = 'boundary'
  issueModal.open = true
}

function saveIssue() {
  if (!issueModal.seg) return
  const desc = issueModal.desc.trim()
  if (!desc) {
    toast('请填写问题具体说明', { type: 'warn' })
    return
  }
  issueModal.seg.flag = desc
  if (clip.value) {
    reviewStore.addIssue(clip.value.id, {
      segId: issueModal.seg.id,
      kind: issueModal.kind,
      severity: 'warn',
      desc,
    })
    logs.addLog({
      user: session.info.user,
      role: session.info.name,
      module: 'review',
      moduleName: '审核工作台',
      action: '标记问题',
      target: `${clip.value.file} · 切片 [${issueModal.seg.n}]`,
      summary: `审核员标记切片问题：${desc}`,
    })
  }
  issueModal.open = false
  toast('已记录切片质检问题')
}

function removeIssue(seg: Seg) {
  seg.flag = undefined
  if (clip.value) reviewStore.removeIssue(clip.value.id, seg.id)
  toast('已取消问题标记')
}

/* 审核决策流 */
const rejModal = reactive({
  open: false,
  reason: '',
  err: false,
})

function openReject() {
  const f = flagged.value.map((s) => `“${s.n}”${s.flag}`).join('；')
  rejModal.reason = f || (clip.value?.reject?.reason ?? '')
  rejModal.err = false
  rejModal.open = true
}

function doReject() {
  const c = clip.value
  if (!c) return
  rejModal.reason = rejModal.reason.trim()
  if (rejModal.reason.length < 5) {
    rejModal.err = true
    return
  }
  rejModal.open = false
  store.reject(c, rejModal.reason, session.info.user)
  logs.addLog({
    user: session.info.user,
    role: session.info.name,
    module: 'review',
    moduleName: '审核工作台',
    action: '打回重标',
    target: `${c.file} · 批次 ${c.batch}`,
    status: 'warn',
    summary: `审核打回：${rejModal.reason}`,
  })
  toast('已将数据打回给标注员重新标注')
}

function approve() {
  const c = clip.value
  if (!c) return
  if (flagged.value.length) {
    toast('当前存在已标记问题的切片，请先解决或打回修改', { type: 'warn' })
    return
  }
  store.approve(c)
  logs.addLog({
    user: session.info.user,
    role: session.info.name,
    module: 'review',
    moduleName: '审核工作台',
    action: '审核通过',
    target: `${c.file} · 批次 ${c.batch}`,
    summary: `审核通过：综合评分 ${currentScore.value} 分，流转至格式转换`,
  })
  toast('已审核通过，数据已归档流转')
}

/* 快捷键监听 */
function onKey(e: KeyboardEvent) {
  if (issueModal.open || rejModal.open || vocabModal.open || shortcutGuideOpen.value) return
  const el = e.target as HTMLElement, tag = el?.tagName
  if (
    tag === 'INPUT' ||
    tag === 'SELECT' ||
    tag === 'TEXTAREA' ||
    el?.closest?.('.ant-select') ||
    el?.closest?.('.ant-input') ||
    el?.closest?.('.ant-rate') ||
    el?.isContentEditable
  ) {
    return
  }

  const k = e.key.toLowerCase()
  const code = e.code

  // 空格：播放 / 暂停
  if (code === 'Space' || k === ' ' || k === 'spacebar') {
    e.preventDefault()
    toggle()
    return
  }

  // 左方向键：后退 0.1s（Shift 2.0s）
  if ((k === 'arrowleft' || code === 'ArrowLeft') && clip.value) {
    e.preventDefault()
    const delta = e.shiftKey ? 2.0 : 0.1
    t.value = clamp(+(t.value - delta).toFixed(2), 0, clip.value.dur)
    return
  }

  // 右方向键：前进 0.1s（Shift 2.0s）
  if ((k === 'arrowright' || code === 'ArrowRight') && clip.value) {
    e.preventDefault()
    const delta = e.shiftKey ? 2.0 : 0.1
    t.value = clamp(+(t.value + delta).toFixed(2), 0, clip.value.dur)
    return
  }

  // T 或 F 键：标记问题
  if ((k === 't' || k === 'f' || code === 'KeyT' || code === 'KeyF') && !e.ctrlKey && !e.metaKey && !e.altKey && clip.value) {
    e.preventDefault()
    let seg = sorted.value.find((s) => s.id === sel.value)
    if (!seg) seg = sorted.value.find((s) => t.value >= s.s && t.value <= s.e)
    if (seg) openTagIssue(seg)
    else toast('请先选中或移动至要标记问题的切片', { type: 'warn' })
    return
  }

  // Delete / Backspace：取消当前切片的问题标记
  if ((k === 'delete' || k === 'backspace' || code === 'KeyD') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    let seg = sorted.value.find((s) => s.id === sel.value)
    if (!seg) seg = sorted.value.find((s) => t.value >= s.s && t.value <= s.e)
    if (seg && seg.flag) {
      e.preventDefault()
      removeIssue(seg)
      return
    }
  }

  // Esc：取消选中
  if (k === 'escape' || code === 'Escape') {
    sel.value = null
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  if (timer) clearInterval(timer)
})

/* 字典管理部分 */
const vocabFilter = ref<'all' | 'action' | 'object'>('all')
const vocabSearch = ref('')
const filteredVocab = computed(() => {
  return reviewStore.vocabList.filter((item) => {
    if (vocabFilter.value !== 'all' && item.category !== vocabFilter.value) return false
    if (vocabSearch.value) {
      const q = vocabSearch.value.toLowerCase()
      const matchName = item.name.toLowerCase().includes(q)
      const matchCode = item.code.toLowerCase().includes(q)
      const matchAliases = item.aliases.some((a) => a.toLowerCase().includes(q))
      if (!matchName && !matchCode && !matchAliases) return false
    }
    return true
  })
})

const vocabModal = reactive<{
  open: boolean
  isEdit: boolean
  id: string
  form: {
    code: string
    name: string
    category: 'action' | 'object'
    scen: ScenKey | 'common'
    aliasesStr: string
    desc: string
    status: 'active' | 'inactive'
  }
}>({
  open: false,
  isEdit: false,
  id: '',
  form: {
    code: '',
    name: '',
    category: 'action',
    scen: 'common',
    aliasesStr: '',
    desc: '',
    status: 'active',
  },
})

function openAddVocab() {
  vocabModal.isEdit = false
  vocabModal.id = ''
  vocabModal.form = {
    code: '',
    name: '',
    category: 'action',
    scen: 'common',
    aliasesStr: '',
    desc: '',
    status: 'active',
  }
  vocabModal.open = true
}

function openEditVocab(item: VocabItem) {
  vocabModal.isEdit = true
  vocabModal.id = item.id
  vocabModal.form = {
    code: item.code,
    name: item.name,
    category: item.category as 'action' | 'object',
    scen: item.scen,
    aliasesStr: item.aliases.join('、'),
    desc: item.desc,
    status: item.status,
  }
  vocabModal.open = true
}

function saveVocab() {
  const f = vocabModal.form
  if (!f.code.trim() || !f.name.trim()) {
    toast('请完整填写词条编码与名称', { type: 'warn' })
    return
  }
  const aliases = f.aliasesStr
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (vocabModal.isEdit) {
    reviewStore.updateVocab(
      vocabModal.id,
      {
        code: f.code.trim().toUpperCase(),
        name: f.name.trim(),
        category: f.category,
        scen: f.scen,
        aliases,
        desc: f.desc.trim(),
        status: f.status,
      },
      session.info.user,
    )
    toast('已更新字典词条')
  } else {
    reviewStore.addVocab(
      {
        code: f.code.trim().toUpperCase(),
        name: f.name.trim(),
        category: f.category,
        scen: f.scen,
        aliases,
        desc: f.desc.trim(),
        status: f.status,
        updatedBy: session.info.user,
      },
      session.info.user,
    )
    toast('已新增字典词条')
  }
  vocabModal.open = false
}

async function handleDeleteVocab(item: VocabItem) {
  const ok = await confirmDlg({
    title: '确认删除字典词条？',
    msg: `确定删除语义词条 [${item.name} (${item.code})] 吗？删除后将影响下游自动比对。`,
    ok: '确认删除',
    danger: true,
  })
  if (ok) {
    reviewStore.deleteVocab(item.id, session.info.user)
    toast(`已删除词条 [${item.name}]`)
  }
}
</script>

<template>
  <PageHead title="审核工作台" desc="质检审核员专用工作台：覆盖 6 维度质检评分卡、时序切片问题标记及具身语义标准字典管理">
    <div class="row" style="gap:8px;align-items:center">
      <div class="seg" role="tablist">
        <button type="button" role="tab" :aria-selected="activeTab === 'review'" @click="activeTab = 'review'">
          <AppIcon name="check" size="sm" /><span>待审质检任务</span>
        </button>
        <button type="button" role="tab" :aria-selected="activeTab === 'vocab'" @click="activeTab = 'vocab'">
          <AppIcon name="tag" size="sm" /><span>标准语义字典管理</span>
        </button>
      </div>
      <a-button v-if="activeTab === 'review'" size="small" @click="shortcutGuideOpen = true">
        <AppIcon name="kbd" size="sm" />快捷键
      </a-button>
    </div>
  </PageHead>

  <!-- 选项卡 1：待审质检任务 -->
  <template v-if="activeTab === 'review'">
    <div class="card ann2">
      <ClipList v-model:filter="filter" :clips="vis" :cur="clip?.id ?? null" :filters="FILTERS" empty-desc="暂无待质检任务" @pick="pick" />

      <div class="work">
        <EmptyState v-if="!clip || !vis.length" icon="inbox" title="请选择一条待审核数据" desc="左侧列表汇聚了标注员已提交等待质检的任务" />
        <template v-else>
          <div class="row between" style="gap:12px;align-items:flex-start">
            <div style="min-width:0">
              <div class="row" style="gap:8px">
                <span class="mono ell">{{ clip.file }}</span>
                <StatusBadge :kind="CLIP_ST[clip.status][0] as BadgeKind" :text="CLIP_ST[clip.status][1]" />
                <span class="score-pill" :class="{ good: currentScore >= 85, warn: currentScore < 85 }">
                  综合质检分: {{ currentScore }}分
                </span>
              </div>
              <div class="muted" style="font-size:12.5px;margin-top:2px">
                {{ SCEN[clip.scen].name }} · {{ SCEN[clip.scen].mode }} · {{ clip.dur }} 秒 · 批次 {{ clip.batch }}
              </div>
            </div>
            <div class="row" style="gap:6px">
              <a-button danger :disabled="!canReview || clip.status !== 'submitted'" @click="openReject">
                打回重标
              </a-button>
              <a-button type="primary" :disabled="!canReview || clip.status !== 'submitted'" @click="approve">
                <AppIcon name="check" size="sm" />审核通过
              </a-button>
            </div>
          </div>

          <div v-if="clip.reject && clip.status === 'rejected'" class="callout warn" role="alert">
            <AppIcon name="alert" />
            <span><b>已打回原因：</b>{{ clip.reject.reason }}<span class="muted"> —— {{ clip.reject.by }} · {{ clip.reject.t }}</span></span>
          </div>

          <VideoWall :clip="clip" :t="t" :playing="playing" />

          <div class="row" style="gap:10px;flex-wrap:wrap">
            <a-button type="primary" @click="toggle">
              <AppIcon :name="playing ? 'pause' : 'play'" />{{ playing ? '暂停' : '播放' }}
            </a-button>
            <span class="mono num">{{ fmtT(t) }} / {{ fmtT(clip.dur) }}</span>
            <a-select v-model:value="speed" size="small" style="width:76px" aria-label="播放速度" :options="[{ value: 0.5, label: '0.5×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }]" />
            <span class="grow" />
            <span class="muted" style="font-size:12.5px">覆盖率 {{ coverage }}% · 切片 {{ sorted.length }} 个</span>
          </div>

          <SliceTimeline v-model:t="t" :clip="clip" :selected="sel" :editable="false" @select="sel = $event" />

          <!-- 6维度质检评分卡 -->
          <div class="card score-card" v-if="currentScoreObj">
            <div class="row between" style="margin-bottom:8px">
              <div class="row" style="gap:6px">
                <AppIcon name="shield" size="sm" />
                <b style="font-size:13.5px">6 维度审核评分卡</b>
                <span class="muted" style="font-size:12px">（每项满分 5 星，自动换算综合得分）</span>
              </div>
              <span class="num" style="font-weight:700;color:var(--accent);font-size:16px">{{ currentScore }} / 100 分</span>
            </div>

            <div class="dim-grid">
              <div class="dim-item">
                <span class="lbl">1. 时间准确性</span>
                <a-rate v-model:value="currentScoreObj.timeAccuracy" :disabled="clip.status !== 'submitted'" />
                <span class="dim-hint">切片起止时间是否贴合动作</span>
              </div>
              <div class="dim-item">
                <span class="lbl">2. 动作合理性</span>
                <a-rate v-model:value="currentScoreObj.actionRationality" :disabled="clip.status !== 'submitted'" />
                <span class="dim-hint">动作归类切分粒度是否恰当</span>
              </div>
              <div class="dim-item">
                <span class="lbl">3. 物体完整性</span>
                <a-rate v-model:value="currentScoreObj.objectCompleteness" :disabled="clip.status !== 'submitted'" />
                <span class="dim-hint">操作对象及工具是否完整覆盖</span>
              </div>
              <div class="dim-item">
                <span class="lbl">4. 语义清晰度</span>
                <a-rate v-model:value="currentScoreObj.semanticClarity" :disabled="clip.status !== 'submitted'" />
                <span class="dim-hint">任务标签命名是否清晰明确</span>
              </div>
              <div class="dim-item">
                <span class="lbl">5. 结果准确性</span>
                <a-rate v-model:value="currentScoreObj.outcomeAccuracy" :disabled="clip.status !== 'submitted'" />
                <span class="dim-hint">气密合格/安装卡扣判定正确</span>
              </div>
              <div class="dim-item">
                <span class="lbl">6. 标注一致性</span>
                <a-rate v-model:value="currentScoreObj.consistency" :disabled="clip.status !== 'submitted'" />
                <span class="dim-hint">前后切片与标准规范的一致度</span>
              </div>
            </div>
          </div>

          <!-- 切片质检明细表 -->
          <div style="font-weight:600;font-size:13.5px;margin-top:4px">切片质检与问题标记 ({{ sorted.length }})</div>
          <table class="stbl" aria-label="切片明细与问题标记">
            <thead>
              <tr>
                <th style="width:26px" />
                <th>子任务名称</th>
                <th style="width:110px">时间区间</th>
                <th style="width:80px">时长</th>
                <th>质检说明 / 标记问题</th>
                <th style="width:130px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in sorted" :key="s.id" :class="{ sel: sel === s.id, flag: !!s.flag }" @click="sel = s.id">
                <td><i class="dot" :style="{ background: colorOf(clip.scen, s.n) }" /></td>
                <td><b>{{ s.n }}</b></td>
                <td class="num muted">{{ s.s.toFixed(1) }}s ~ {{ s.e.toFixed(1) }}s</td>
                <td class="num muted">{{ (s.e - s.s).toFixed(1) }}s</td>
                <td>
                  <span v-if="s.flag" class="tag crit" style="font-size:12px;margin-right:6px">⚠️ {{ s.flag }}</span>
                  <span v-else class="muted" style="font-size:12px">正常通过</span>
                </td>
                <td @click.stop>
                  <div class="row" style="gap:6px">
                    <a-button size="small" type="text" @click="t = s.s">定位</a-button>
                    <template v-if="clip.status === 'submitted'">
                      <a-button v-if="!s.flag" size="small" danger @click="openTagIssue(s)">标记问题</a-button>
                      <a-button v-else size="small" @click="removeIssue(s)">取消标记</a-button>
                    </template>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="actbar">
            <span class="muted grow" style="font-size:12px">
              <kbd>Space</kbd> 播放　<kbd>←</kbd><kbd>→</kbd> 0.1s　<kbd>Shift+←/→</kbd> 2s　<kbd>T</kbd> 标记问题　<kbd>Esc</kbd> 取消选择
            </span>
            <template v-if="clip.status === 'submitted'">
              <a-button danger :disabled="!canReview" @click="openReject">打回重标</a-button>
              <a-button type="primary" :disabled="!canReview" @click="approve"><AppIcon name="check" size="sm" />审核通过</a-button>
            </template>
            <template v-else-if="clip.status === 'approved'">
              <span style="color:var(--good-solid);font-weight:600;display:flex;align-items:center;gap:4px">
                <AppIcon name="check" size="sm" />已通过审核并归档
              </span>
            </template>
            <template v-else>
              <span class="muted" style="font-size:12px">已打回给标注员重新标注</span>
            </template>
          </div>
        </template>
      </div>
    </div>
  </template>

  <!-- 选项卡 2：标准语义字典管理 -->
  <template v-else>
    <div class="card" style="padding:16px">
      <div class="row between" style="margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div class="row" style="gap:10px">
          <a-radio-group v-model:value="vocabFilter" button-style="solid" size="small">
            <a-radio-button value="all">全部词条</a-radio-button>
            <a-radio-button value="action">动作字典</a-radio-button>
            <a-radio-button value="object">物体与工件字典</a-radio-button>
          </a-radio-group>
          <a-input v-model:value="vocabSearch" placeholder="搜索词条名称 / 编码 / 别名" style="width:220px" size="small" allow-clear />
        </div>
        <a-button type="primary" size="small" @click="openAddVocab">
          <AppIcon name="plus" size="sm" />新增语义词条
        </a-button>
      </div>

      <table class="stbl" aria-label="标准字典词条表">
        <thead>
          <tr>
            <th style="width:110px">标准编码</th>
            <th style="width:130px">标准名称</th>
            <th style="width:90px">词条分类</th>
            <th style="width:110px">适用场景</th>
            <th style="width:160px">别名 / 同义词</th>
            <th>规范定义与动作释义</th>
            <th style="width:75px">状态</th>
            <th style="width:120px">更新人/时间</th>
            <th style="width:110px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredVocab" :key="item.id">
            <td class="mono"><b>{{ item.code }}</b></td>
            <td><b>{{ item.name }}</b></td>
            <td>
              <a-tag :color="item.category === 'action' ? 'blue' : 'green'">
                {{ item.category === 'action' ? '动作' : '物体' }}
              </a-tag>
            </td>
            <td>
              <span class="muted" style="font-size:12px">
                {{ item.scen === 'common' ? '通用场景' : SCEN[item.scen]?.short }}
              </span>
            </td>
            <td>
              <div class="row" style="gap:4px;flex-wrap:wrap">
                <span v-for="a in item.aliases" :key="a" class="tag" style="font-size:11px">{{ a }}</span>
                <span v-if="!item.aliases.length" class="muted">-</span>
              </div>
            </td>
            <td class="muted" style="font-size:12.5px">{{ item.desc }}</td>
            <td>
              <a-switch
                :checked="item.status === 'active'"
                size="small"
                @change="reviewStore.toggleVocabStatus(item.id, session.info.user); toast(`已${item.status === 'active' ? '停用' : '启用'}词条`)"
              />
            </td>
            <td class="muted" style="font-size:11.5px">
              {{ item.updatedBy }}<br />{{ item.updatedAt }}
            </td>
            <td>
              <div class="row" style="gap:4px">
                <a-button size="small" type="link" @click="openEditVocab(item)">编辑</a-button>
                <a-button size="small" type="link" danger @click="handleDeleteVocab(item)">删除</a-button>
              </div>
            </td>
          </tr>
          <tr v-if="!filteredVocab.length">
            <td colspan="9" class="muted" style="text-align:center;padding:24px">未找到匹配的字典词条</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>

  <!-- 标记问题弹窗 -->
  <a-modal v-model:open="issueModal.open" title="标记切片质检问题" centered ok-text="确认标记" cancel-text="取消" @ok="saveIssue">
    <a-form layout="vertical">
      <a-form-item label="切片名称">
        <a-input :value="issueModal.seg ? `${issueModal.seg.n} (${issueModal.seg.s}s ~ ${issueModal.seg.e}s)` : ''" disabled />
      </a-form-item>
      <a-form-item label="问题类型">
        <a-select v-model:value="issueModal.kind">
          <a-select-option value="boundary">边界不准（开始偏早/结束偏晚/时间未贴合）</a-select-option>
          <a-select-option value="label">标签选错（与实际动作不符）</a-select-option>
          <a-select-option value="missing">遗漏动作（关键步骤未切出）</a-select-option>
          <a-select-option value="redundant">冗余切片（误触或重复创建）</a-select-option>
          <a-select-option value="other">其他问题</a-select-option>
        </a-select>
      </a-form-item>
      <a-form-item label="详细批注说明" required>
        <a-textarea v-model:value="issueModal.desc" :rows="3" placeholder="如：结束时间偏早，需覆盖至开始充气前" :maxlength="100" show-count />
      </a-form-item>
    </a-form>
  </a-modal>

  <!-- 打回原因弹窗 -->
  <a-modal v-model:open="rejModal.open" title="打回标注任务" centered ok-text="确认打回" cancel-text="取消" :ok-button-props="{ danger: true }" @ok="doReject">
    <a-form layout="vertical">
      <a-form-item label="打回修改说明" :validate-status="rejModal.err ? 'error' : ''" :help="rejModal.err ? '请至少填写 5 个字说明修改要求' : '打回后将通知标注员并在其列表中高亮问题切片'">
        <a-textarea v-model:value="rejModal.reason" :rows="4" :maxlength="150" show-count placeholder="请详细说明被打回的原因与修改指导" />
      </a-form-item>
    </a-form>
  </a-modal>

  <!-- 新增/编辑字典词条弹窗 -->
  <a-modal v-model:open="vocabModal.open" :title="vocabModal.isEdit ? '编辑语义字典词条' : '新增语义字典词条'" centered ok-text="保存" cancel-text="取消" @ok="saveVocab">
    <a-form layout="vertical">
      <div class="row" style="gap:12px">
        <a-form-item label="词条编码 (英文字母/大写)" required style="flex:1">
          <a-input v-model:value="vocabModal.form.code" placeholder="如: CLAMP" />
        </a-form-item>
        <a-form-item label="标准名称" required style="flex:1">
          <a-input v-model:value="vocabModal.form.name" placeholder="如: 夹紧密封" />
        </a-form-item>
      </div>
      <div class="row" style="gap:12px">
        <a-form-item label="词条类型" style="flex:1">
          <a-select v-model:value="vocabModal.form.category">
            <a-select-option value="action">操作动作 (Action)</a-select-option>
            <a-select-option value="object">物体/工具 (Object)</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="适用场景" style="flex:1">
          <a-select v-model:value="vocabModal.form.scen">
            <a-select-option value="common">通用场景</a-select-option>
            <a-select-option value="qmd">轮毂气密性检测 (VR)</a-select-option>
            <a-select-option value="fhd">防护堵安装 (UMI)</a-select-option>
          </a-select>
        </a-form-item>
      </div>
      <a-form-item label="别名 / 同义词 (用逗号或顿号分隔)">
        <a-input v-model:value="vocabModal.form.aliasesStr" placeholder="如: 夹紧、闭合气缸、Seal" />
      </a-form-item>
      <a-form-item label="规范释义与定义说明">
        <a-textarea v-model:value="vocabModal.form.desc" :rows="3" placeholder="清晰描述该动作或物体的标准定义及边界特征" />
      </a-form-item>
    </a-form>
  </a-modal>

  <!-- 快捷键指南弹窗 -->
  <a-modal v-model:open="shortcutGuideOpen" title="审核工作台快捷键指南" width="560px" centered :footer="null">
    <div class="kbd-guide-grid">
      <div class="kbd-row"><div class="keys"><kbd>Space</kbd></div><div class="desc">播放 / 暂停视频与时空轨迹播放</div></div>
      <div class="kbd-row"><div class="keys"><kbd>←</kbd> <kbd>→</kbd></div><div class="desc">微调步进（向左 / 向右前进或后退 0.1 秒，逐帧对齐）</div></div>
      <div class="kbd-row"><div class="keys"><kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd></div><div class="desc">快速进退（向左 / 向右跨越 2.0 秒）</div></div>
      <div class="kbd-row"><div class="keys"><kbd>T</kbd> 或 <kbd>F</kbd></div><div class="desc">对当前选中的切片（或播放头所在切片）标记质检问题</div></div>
      <div class="kbd-row"><div class="keys"><kbd>Del</kbd> 或 <kbd>Backspace</kbd></div><div class="desc">取消当前切片的问题标记</div></div>
      <div class="kbd-row"><div class="keys"><kbd>Esc</kbd></div><div class="desc">取消选中当前切片</div></div>
    </div>
  </a-modal>
</template>

<style scoped>
.ann2 { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 640px; }
.work { padding: 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 480px; }
.stbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.stbl th { text-align: left; font-weight: 500; color: var(--muted); padding: 8px 8px; border-bottom: 1px solid var(--line); background: var(--surface-2); }
.stbl td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.stbl tr.sel td { background: var(--accent-soft); }
.stbl tr.flag td { background: var(--crit-soft); }
.dot { display: block; width: 10px; height: 10px; border-radius: 3px; }

.score-card { padding: 12px 14px; background: var(--surface-2); border: 1px solid var(--line); }
.dim-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.dim-item { background: var(--surface); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px; }
.dim-item .lbl { font-size: 12.5px; font-weight: 600; }
.dim-item .dim-hint { font-size: 11px; color: var(--muted); }

.score-pill { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 12px; }
.score-pill.good { background: var(--good-soft); color: var(--good-solid); }
.score-pill.warn { background: var(--warn-soft); color: var(--warn-solid); }

.actbar { position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px; padding: 12px 0 2px; margin-top: 4px; border-top: 1px solid var(--line); background: var(--surface); flex-wrap: wrap; }
kbd { font: 11px var(--font-mono); padding: 1px 5px; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--surface-2); }

.kbd-guide-grid { display: flex; flex-direction: column; gap: 10px; }
.kbd-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 6px; background: var(--surface-2); }
.kbd-row .keys { display: flex; gap: 4px; align-items: center; }
.kbd-row .desc { font-size: 13px; color: var(--text); }

@media (max-width: 900px) { .ann2 { grid-template-columns: 1fr; } .dim-grid { grid-template-columns: 1fr; } }
</style>
