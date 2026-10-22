<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import VideoWall from '@/components/annotate/VideoWall.vue'
import SliceTimeline from '@/components/annotate/SliceTimeline.vue'
import { fmtT } from '@/components/annotate/motion'
import { colorOf } from '@/stores/annotate'
import { SCEN } from '@/constants'
import { DS_ST, getDatasetSamples, type Dataset, type DatasetSample } from '@/stores/datasets'
import { clamp } from '@/utils'

const props = defineProps<{ ds: Dataset | null }>()
const emit = defineEmits<{ close: [] }>()

const samples = computed<DatasetSample[]>(() => (props.ds ? getDatasetSamples(props.ds) : []))
const curId = ref<string>('')
const curSample = computed<DatasetSample | undefined>(() => samples.value.find((s) => s.id === curId.value) ?? samples.value[0])

watch(
  () => props.ds,
  (d) => {
    if (d && samples.value.length) {
      curId.value = samples.value[0].id
      t.value = 0
      playing.value = false
      selSeg.value = null
    }
  },
  { immediate: true },
)

function pickSample(id: string) {
  curId.value = id
  t.value = 0
  playing.value = false
  selSeg.value = null
}

/* 播放控制 */
const t = ref(0)
const playing = ref(false)
const speed = ref(1)
const selSeg = ref<number | null>(null)
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => {
    if (!playing.value || !curSample.value) return
    t.value = Math.min(curSample.value.dur, +(t.value + 0.1 * speed.value).toFixed(2))
    if (t.value >= curSample.value.dur) playing.value = false
  }, 100)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

function togglePlay() {
  if (!curSample.value) return
  if (t.value >= curSample.value.dur) t.value = 0
  playing.value = !playing.value
}

function seekTo(val: number) {
  if (!curSample.value) return
  t.value = clamp(Math.round(val * 10) / 10, 0, curSample.value.dur)
}

function stepTime(delta: number) {
  if (!curSample.value) return
  seekTo(t.value + delta)
}

/* 当前子任务切片计算 */
const sortedSegs = computed(() => (curSample.value ? curSample.value.segs.slice().sort((a, b) => a.s - b.s) : []))
const nowSeg = computed(() => sortedSegs.value.find((s) => t.value >= s.s && t.value < s.e))
const isVr = computed(() => (curSample.value ? SCEN[curSample.value.scen].mode.includes('VR') : false))

/* 键盘快捷键 */
function onKey(e: KeyboardEvent) {
  if (!props.ds) return
  const el = e.target as HTMLElement
  if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.closest?.('.ant-select')) return
  const k = e.key.toLowerCase()
  if (k === ' ' && el?.tagName !== 'BUTTON') {
    e.preventDefault()
    togglePlay()
  } else if (k === 'arrowleft') {
    e.preventDefault()
    stepTime(e.shiftKey ? -0.1 : -0.5)
  } else if (k === 'arrowright') {
    e.preventDefault()
    stepTime(e.shiftKey ? 0.1 : 0.5)
  }
}

onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <a-modal
    :open="!!ds"
    :width="1220"
    centered
    :footer="null"
    destroy-on-close
    :body-style="{ padding: '16px 22px 20px', maxHeight: '88vh', overflowY: 'auto' }"
    @cancel="emit('close')"
    @update:open="(v: boolean) => { if (!v) emit('close') }"
  >
    <template #title>
      <div v-if="ds" class="modal-header-row">
        <div class="row" style="gap: 10px; align-items: center">
          <span class="mono badge-id">{{ ds.id }}</span>
          <span class="head-title">{{ ds.name }}</span>
          <span class="fmt">{{ ds.ver }}</span>
          <StatusBadge :kind="DS_ST[ds.status][0]" :text="DS_ST[ds.status][1]" />
          <span class="tag q-tag">质量分 {{ ds.quality }}</span>
        </div>
      </div>
    </template>

    <div v-if="ds && curSample" class="preview-layout">
      <!-- 顶部信息摘要条 -->
      <div class="meta-strip">
        <div class="meta-item"><span class="k">场景类型</span><span class="v">{{ SCEN[ds.scen].name }}</span></div>
        <div class="meta-item"><span class="k">采集方式</span><span class="v">{{ SCEN[ds.scen].mode }}</span></div>
        <div class="meta-item"><span class="k">轮毂规格</span><span class="v">{{ ds.spec === 'mix' ? '混合规格' : ds.spec + ' 寸' }}</span></div>
        <div class="meta-item"><span class="k">总样本量</span><span class="v num">{{ ds.count.toLocaleString() }} 条</span></div>
        <div class="meta-item"><span class="k">总数据量</span><span class="v num">{{ (ds.size / 1000).toFixed(2) }} TB</span></div>
        <div class="meta-item"><span class="k">通道架构</span><span class="v">6路工业视觉 · 六维力 · 50Hz关节位姿</span></div>
      </div>

      <div class="preview-body">
        <!-- 左侧：样本列表 -->
        <aside class="sample-sidebar">
          <div class="sidebar-header">
            <span class="title">样本序列 ({{ samples.length }})</span>
            <small class="muted">可切换查看多条实采视频</small>
          </div>
          <div class="sample-list">
            <button
              v-for="s in samples"
              :key="s.id"
              type="button"
              class="sample-card"
              :class="{ active: curSample.id === s.id }"
              @click="pickSample(s.id)"
            >
              <div class="sc-top">
                <span class="sc-name">{{ s.sampleName }}</span>
                <span class="sc-q tag">分值 {{ s.qualityScore }}</span>
              </div>
              <div class="sc-file mono">{{ s.file }}</div>
              <div class="sc-foot muted">
                <span>{{ s.dur }}s · {{ s.segs.length }}个子任务</span>
                <span>{{ s.operator }}</span>
              </div>
            </button>
          </div>
        </aside>

        <!-- 右侧：视频画面、时间轴、标注内容 -->
        <section class="viewer-main">
          <!-- 样本标题栏 -->
          <div class="viewer-head">
            <div class="sample-desc-bar">
              <span class="lead-pill">{{ curSample.sampleName }}</span>
              <span class="mono file-name">{{ curSample.file }}</span>
              <span class="muted" style="font-size:12px">批次 {{ curSample.batch }} · 采集员: {{ curSample.operator }}</span>
            </div>
          </div>

          <!-- 多视角视频墙与世界坐标轨迹 -->
          <div class="wall-wrapper">
            <VideoWall :clip="curSample" :t="t" :playing="playing" />
          </div>

          <!-- 播放控制条 -->
          <div class="control-bar">
            <div class="row" style="gap: 8px; align-items: center">
              <a-button type="primary" size="small" @click="togglePlay">
                <AppIcon :name="playing ? 'pause' : 'play'" />
                {{ playing ? '暂停' : '播放' }}
              </a-button>
              <a-button size="small" @click="stepTime(-0.5)" title="后退 0.5s"><AppIcon name="left" size="sm" /></a-button>
              <a-button size="small" @click="stepTime(0.5)" title="前进 0.5s"><AppIcon name="right" size="sm" /></a-button>
              <span class="mono time-disp">{{ fmtT(t) }} / {{ fmtT(curSample.dur) }}</span>
              <a-select
                v-model:value="speed"
                size="small"
                style="width: 76px"
                aria-label="播放倍速"
                :options="[{ value: 0.5, label: '0.5×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }]"
              />
            </div>

            <div class="row" style="gap: 8px; align-items: center">
              <span
                v-if="nowSeg"
                class="active-seg-pill"
                :style="{ background: colorOf(curSample.scen, nowSeg.n) }"
              >
                当前阶段：{{ nowSeg.n }} ({{ nowSeg.s.toFixed(1) }}s ~ {{ nowSeg.e.toFixed(1) }}s)
              </span>
              <span v-else class="muted" style="font-size:12px">暂无阶段</span>
            </div>
          </div>

          <!-- 切片时间轴（只读模式） -->
          <div class="timeline-box">
            <SliceTimeline
              v-model:t="t"
              :clip="curSample"
              :selected="selSeg"
              :editable="false"
              @select="selSeg = $event"
            />
            <div class="timeline-hint">
              <span class="muted"><AppIcon name="info" size="sm" /> 提示：点击时间轴标尺或任一切片，可直接跳转视频播放头</span>
              <span class="grow" />
              <span class="tag-coverage">标注覆盖率 100% · {{ sortedSegs.length }} 个子任务阶段</span>
            </div>
          </div>

          <!-- 子任务标注详细内容表 -->
          <div class="annotation-section">
            <div class="sec-title-row">
              <span class="sec-title"><AppIcon name="tag" size="sm" /> 子任务标注内容列表</span>
              <span class="muted" style="font-size:12px">已完成三级标签标准化对齐与双人审核</span>
            </div>

            <table class="stbl" aria-label="子任务标注明细">
              <thead>
                <tr>
                  <th style="width: 32px">#</th>
                  <th style="width: 140px">子任务名称</th>
                  <th style="width: 100px">起始时间 (s)</th>
                  <th style="width: 100px">结束时间 (s)</th>
                  <th style="width: 90px">阶段时长</th>
                  <th>动作阶段描述与特征</th>
                  <th style="width: 90px; text-align: center">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(s, idx) in sortedSegs"
                  :key="s.id"
                  :class="{ sel: selSeg === s.id || (nowSeg && nowSeg.id === s.id) }"
                  @click="selSeg = s.id; seekTo(s.s)"
                >
                  <td class="muted num">{{ idx + 1 }}</td>
                  <td>
                    <div class="row" style="gap: 6px; align-items: center">
                      <i class="dot" :style="{ background: colorOf(curSample.scen, s.n) }" />
                      <b>{{ s.n }}</b>
                    </div>
                  </td>
                  <td class="num">{{ s.s.toFixed(1) }}</td>
                  <td class="num">{{ s.e.toFixed(1) }}</td>
                  <td class="num muted">{{ (s.e - s.s).toFixed(1) }} s</td>
                  <td class="muted desc-cell">
                    <span v-if="s.n === '取件上台'">机械臂移动到进料工位，夹爪稳定抓取轮毂并对中平移至测试机台</span>
                    <span v-else-if="s.n === '夹紧密封'">气动卡盘四向锁紧，端面环状密封圈受压贴合，力传感器反馈正常</span>
                    <span v-else-if="s.n === '充气保压'">快速注气充压至 0.6MPa，进行 5 秒微压差保压泄漏判定</span>
                    <span v-else-if="s.n === '读数判定'">PLC 与气密检测仪表通信回传气密差值，结果合格</span>
                    <span v-else-if="s.n === '取下放回'">卡盘泄压松开，机械臂抓取测试合格轮毂运送至下一道输送线</span>
                    <span v-else-if="s.n === '取防护堵'">手爪从料盘快速拾取橡胶防护堵，视觉识别对齐端部导向槽</span>
                    <span v-else-if="s.n === '对准孔位'">手腕相机局部高精纠偏，柔性接触轮毂轮辋防护孔位</span>
                    <span v-else-if="s.n === '压入到位'">恒力推进压入防护堵，微行程感应开关到位触发行程锁定</span>
                    <span v-else-if="s.n === '检查'">旋转复核装配平整度，确认无翘边与脱落隐患</span>
                    <span v-else>多模态传感器数据采集完整，满足模型微调标准</span>
                  </td>
                  <td style="text-align: center" @click.stop>
                    <a-button size="small" type="link" @click="seekTo(s.s); selSeg = s.id">
                      <AppIcon name="play" size="sm" />定位
                    </a-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 传感器通道与数据来源卡片 -->
          <div class="provenance-grid">
            <div class="prov-card">
              <div class="p-title"><AppIcon name="camera" size="sm" /> 视觉同步流</div>
              <div class="p-desc">6路工业相机（第一视角/双侧第三视角/双腕部/俯视），1080P@30fps，硬件时间戳同步 ≤ 2ms</div>
            </div>
            <div class="prov-card">
              <div class="p-title"><AppIcon name="robot" size="sm" /> 机械臂与末端六维力</div>
              <div class="p-desc">笛卡尔坐标末端位姿 (x,y,z) 50Hz 采样，ATI 六维力/力矩传感器 100Hz 实时同步</div>
            </div>
            <div v-if="isVr" class="prov-card">
              <div class="p-title"><AppIcon name="activity" size="sm" /> 灵巧手与遥操作位姿</div>
              <div class="p-desc">双灵巧手 15 关节自由度真实角度，触觉阵列阻抗反馈与 VR 头显位姿同步解算</div>
            </div>
            <div class="prov-card">
              <div class="p-title"><AppIcon name="shield" size="sm" /> 质检与数据来源</div>
              <div class="p-desc">采集人: {{ curSample.operator }} · 标注: 林悦 · 审核: 陈静 (已通过) · 规范: DMS-v2.0</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </a-modal>
</template>

<style scoped>
.modal-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.badge-id {
  font-size: 13px;
  background: var(--surface-3);
  padding: 2px 7px;
  border-radius: 4px;
}
.head-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
}
.q-tag {
  background: rgba(44, 143, 123, 0.12);
  color: #2c8f7b;
  border: 1px solid rgba(44, 143, 123, 0.3);
  font-weight: 500;
}

.preview-layout {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.meta-strip {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 8px 14px;
  background: var(--surface-2);
  border-radius: 6px;
  border: 1px solid var(--line);
  flex-wrap: wrap;
}
.meta-item {
  display: flex;
  gap: 6px;
  font-size: 12.5px;
}
.meta-item .k {
  color: var(--muted);
}
.meta-item .v {
  font-weight: 500;
  color: var(--text);
}

.preview-body {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

/* 侧边栏 */
.sample-sidebar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--surface-2);
  border-radius: 8px;
  border: 1px solid var(--line);
  padding: 12px;
}
.sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 8px;
}
.sidebar-header .title {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--text);
}
.sample-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 560px;
  overflow-y: auto;
}
.sample-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 10px;
  border-radius: 6px;
  background: var(--surface);
  border: 1px solid var(--line);
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}
.sample-card:hover {
  border-color: var(--accent);
  background: var(--surface-3);
}
.sample-card.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 0 0 1px var(--accent) inset;
}
.sc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sc-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}
.sc-q {
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-3);
  color: var(--muted);
}
.sc-file {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-foot {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  margin-top: 2px;
}

/* 主内容区 */
.viewer-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.viewer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sample-desc-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.lead-pill {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--text);
}
.file-name {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--muted);
}

.wall-wrapper {
  border-radius: 8px;
  overflow: hidden;
  background: #131c2d;
}

.control-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  flex-wrap: wrap;
  gap: 8px;
}
.time-disp {
  font-size: 13px;
  font-weight: 600;
  padding: 0 4px;
  color: var(--text);
}
.active-seg-pill {
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 12px;
  color: #fff;
  display: inline-flex;
  align-items: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

.timeline-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.timeline-hint {
  display: flex;
  align-items: center;
  font-size: 12px;
}
.tag-coverage {
  font-size: 12px;
  font-weight: 500;
  color: var(--accent);
}

.annotation-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.sec-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sec-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.stbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}
.stbl th {
  text-align: left;
  font-weight: 500;
  color: var(--muted);
  padding: 7px 10px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
}
.stbl td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}
.stbl tr:hover td {
  background: var(--surface-2);
}
.stbl tr.sel td {
  background: var(--accent-soft);
}
.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.desc-cell {
  font-size: 12px;
  line-height: 1.4;
}

.provenance-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 6px;
}
.prov-card {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.p-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 5px;
}
.p-desc {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.4;
}

@media (max-width: 960px) {
  .preview-body {
    grid-template-columns: 1fr;
  }
  .provenance-grid {
    grid-template-columns: 1fr;
  }
}
</style>
