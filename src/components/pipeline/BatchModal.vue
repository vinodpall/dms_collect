<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BatchTrack from './BatchTrack.vue'
import BatchStateBadge from './BatchStateBadge.vue'
import { useRouter } from 'vue-router'
import { NO_PERM, STAGES, STAGE_HINT } from '@/constants'
import type { PipelineBatchDetail } from '@/api'
import { useSession } from '@/stores/session'
import { formatBytes, mapLogItem, usePipeline, type LogLine } from '@/stores/pipeline'
import { toast } from '@/composables/toast'

const props = defineProps<{ id: number | null; mayEdit: boolean; retrying?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'retry', id: number): void }>()

const pl = usePipeline()
const router = useRouter()
const session = useSession()

const detail = ref<PipelineBatchDetail | null>(null)
const logs = ref<LogLine[]>([])
const logTotal = ref(0)
const loadingDetail = ref(false)
const loadingLogs = ref(false)
const retryingEpId = ref<number | null>(null)

const b = computed(() => (props.id !== null ? pl.batches.find((x) => x.numericId === props.id) ?? null : null))
const isFail = computed(() => !!b.value && (b.value.state === 'failed' || b.value.state === 'partial_failed'))
const toAnn = computed(() => !!b.value && b.value.state === 'wait' && (b.value.stage === 2 || b.value.stage === 3) && session.allowed('annotate'))

function goAnn() {
  if (!b.value) return
  const target = b.value.stage === 3 && session.allowed('review') ? 'review' : 'annotate'
  const code = b.value.id
  emit('close')
  router.push({ name: target, query: { batch: code } })
}

let reqSeq = 0
async function loadModalData(batchId: number) {
  const seq = ++reqSeq
  loadingDetail.value = true
  loadingLogs.value = true
  try {
    const [d, l] = await Promise.all([
      pl.fetchBatchDetail(batchId).catch((err: any) => {
        toast(err?.message || '获取批次详情失败', { type: 'warn' })
        return null
      }),
      pl.fetchBatchLogs(batchId).catch(() => null),
    ])
    if (seq !== reqSeq) return
    detail.value = d
    logs.value = (l?.items || []).map(mapLogItem)
    logTotal.value = l?.total ?? logs.value.length
  } finally {
    if (seq === reqSeq) {
      loadingDetail.value = false
      loadingLogs.value = false
    }
  }
}

async function refreshLogs() {
  if (props.id === null) return
  loadingLogs.value = true
  try {
    const l = await pl.fetchBatchLogs(props.id)
    logs.value = (l?.items || []).map(mapLogItem)
    logTotal.value = l?.total ?? logs.value.length
  } catch (err: any) {
    toast(err?.message || '刷新日志失败', { type: 'warn' })
  } finally {
    loadingLogs.value = false
  }
}

async function retryEpisode(epId: number, fileName: string) {
  if (props.id === null) return
  retryingEpId.value = epId
  try {
    await pl.retryEpisode(epId, props.id)
    toast(`已重新提交 ${fileName}`)
    await loadModalData(props.id)
  } catch (err: any) {
    toast(err?.message || '重试单条数据失败', { type: 'warn' })
  } finally {
    retryingEpId.value = null
  }
}

watch(
  () => props.id,
  (val) => {
    if (val === null) {
      reqSeq++
      detail.value = null
      logs.value = []
      logTotal.value = 0
      return
    }
    loadModalData(val)
  },
  { immediate: true }
)

defineExpose({ reload: () => { if (props.id !== null) loadModalData(props.id) } })
</script>
<template>
  <a-drawer
    :open="props.id !== null && !!b"
    placement="right"
    :width="660"
    :closable="false"
    destroy-on-close
    @close="emit('close')"
  >
    <template #title>
      <div v-if="b" style="display:flex;flex-direction:column;gap:8px;width:100%">
        <div class="row between">
          <span class="mono" style="font-size:16px;font-weight:700">批次 {{ b.id }}</span>
          <button type="button" class="icon-btn" aria-label="关闭" @click="emit('close')">
            <AppIcon name="x" />
          </button>
        </div>
        <div class="row" style="gap:8px">
          <BatchStateBadge :b="b" />
          <span style="font-size:13px;color:var(--muted)">{{ b.stageName || STAGES[b.stage] }} · {{ STAGE_HINT[b.stage] }}</span>
        </div>
      </div>
    </template>
    <template v-if="b">
      <div style="display: flex; flex-direction: column; gap: 16px">
        <dl class="kv">
          <dt>来源</dt>
          <dd class="mono">{{ b.task }}<template v-if="b.sceneName"> · {{ b.sceneName }}</template></dd>
          <dt>数据集</dt>
          <dd>{{ b.datasetName || `#${b.datasetId}` }}</dd>
          <dt>规模</dt>
          <dd>{{ b.count }} 条 · {{ b.sizeText }}<template v-if="b.failedCount > 0">（失败 {{ b.failedCount }} 条）</template></dd>
          <dt>当前阶段</dt>
          <dd>{{ b.stageName || STAGES[b.stage] }} · 进度 {{ b.pct }}%<template v-if="b.retryTimes > 0"> · 已重试 {{ b.retryTimes }} 次</template></dd>
          <template v-if="b.updatedAt || b.createdAt">
            <dt>更新时间</dt>
            <dd class="mono">{{ b.updatedAt || b.createdAt }}</dd>
          </template>
          <template v-if="b.errorMsg">
            <dt>失败摘要</dt>
            <dd style="color: var(--crit)">{{ b.errorMsg }}</dd>
          </template>
        </dl>

        <div>
          <div style="font-size:12.5px;color:var(--muted);margin-bottom:8px">阶段流水线跟踪</div>
          <BatchTrack :b="b" />
          <div v-if="detail?.stages?.length" class="stage-dist">
            <div v-for="st in detail.stages" :key="st.stage" class="stage-dist-item" :class="{ fail: st.failed > 0 }">
              <div class="stage-dist-name">{{ st.name }}</div>
              <div class="stage-dist-nums">
                <span v-if="st.done > 0" class="good">过 {{ st.done }}</span>
                <span v-if="st.running > 0" class="info">跑 {{ st.running }}</span>
                <span v-if="st.waiting > 0" class="warn">等 {{ st.waiting }}</span>
                <span v-if="st.failed > 0" class="crit">败 {{ st.failed }}</span>
                <span v-if="!st.done && !st.running && !st.waiting && !st.failed" class="muted">0</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="detail?.failed_episodes?.length">
          <div class="row between" style="margin-bottom:8px">
            <span style="font-size:12.5px;color:var(--crit);font-weight:600">失败条目（{{ detail.failed_episodes.length }} 条，可逐条重试）</span>
          </div>
          <div class="fail-ep-list">
            <div v-for="ep in detail.failed_episodes" :key="ep.id" class="fail-ep-item">
              <div style="min-width:0;flex:1">
                <div class="mono" style="font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="ep.file_name">{{ ep.file_name }}</div>
                <div class="muted" style="font-size:12px;margin-top:2px">
                  {{ ep.stage_name || (ep.stage != null ? STAGES[ep.stage] : '-') }} · {{ formatBytes(ep.size_bytes) }}
                  <span v-if="ep.error" style="color:var(--crit)"> · {{ ep.error }}</span>
                </div>
              </div>
              <button
                type="button"
                class="btn sm"
                :disabled="!mayEdit || retryingEpId === ep.id"
                :title="mayEdit ? undefined : NO_PERM"
                @click="retryEpisode(ep.id, ep.file_name)"
              >{{ retryingEpId === ep.id ? '重试中…' : '重试' }}</button>
            </div>
          </div>
        </div>

        <div>
          <div class="row between" style="margin-bottom:8px">
            <span style="font-size:12.5px;color:var(--muted)">处理日志输出<template v-if="logTotal > 0">（共 {{ logTotal }} 条）</template></span>
            <button type="button" class="btn ghost sm" :disabled="loadingLogs" @click="refreshLogs">
              <AppIcon name="refresh" size="sm" />{{ loadingLogs ? '刷新中…' : '刷新日志' }}
            </button>
          </div>
          <div class="logbox" tabindex="0" aria-label="处理日志">
            <template v-if="loadingLogs && !logs.length">加载日志中…</template>
            <template v-else-if="logs.length">
              <template v-for="(l, i) in logs" :key="i"><span class="t">{{ l.t }}</span> <span v-if="l.lv" :class="l.lv === 'ERROR' ? 'e' : 'w'">{{ l.lv }}</span><template v-if="l.fileName"> [{{ l.fileName }}]</template> {{ l.msg }}{{ i < logs.length - 1 ? '\n' : '' }}</template>
            </template>
            <template v-else>暂无处理日志</template>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div v-if="b" style="display: flex; justify-content: flex-end; gap: 8px">
        <button type="button" class="btn" @click="emit('close')">关闭</button>
        <button v-if="toAnn" type="button" class="btn primary" @click="goAnn">{{ b.stage === 2 ? '去标注' : '去审核' }}</button>
        <button
          v-if="isFail"
          type="button"
          class="btn primary"
          :disabled="!mayEdit || retrying || loadingDetail"
          :title="mayEdit ? undefined : NO_PERM"
          @click="emit('retry', b.numericId)"
        >{{ retrying ? '提交中…' : '重试失败条目' }}</button>
      </div>
    </template>
  </a-drawer>
</template>
<style scoped>
.stage-dist {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}
.stage-dist-item {
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-soft, rgba(255, 255, 255, 0.02));
  text-align: center;
}
.stage-dist-item.fail {
  border-color: rgba(239, 68, 68, 0.45);
}
.stage-dist-name {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stage-dist-nums {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.stage-dist-nums .good { color: var(--good); }
.stage-dist-nums .info { color: var(--accent); }
.stage-dist-nums .warn { color: var(--warn); }
.stage-dist-nums .crit { color: var(--crit); }
.fail-ep-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow: auto;
}
.fail-ep-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.06);
}
</style>
