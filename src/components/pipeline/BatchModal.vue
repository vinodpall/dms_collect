<script setup lang="ts">
import { computed } from 'vue'
import BatchTrack from './BatchTrack.vue'
import BatchStateBadge from './BatchStateBadge.vue'
import { useRouter } from 'vue-router'
import { NO_PERM, SCEN, STAGES, STAGE_HINT } from '@/constants'
import { useSession } from '@/stores/session'
import { usePipeline } from '@/stores/pipeline'

const props = defineProps<{ id: string | null; mayEdit: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'retry', id: string): void }>()
const pl = usePipeline()
const router = useRouter()
const session = useSession()
const toAnn = computed(() => !!b.value && b.value.state === 'wait' && (b.value.stage === 2 || b.value.stage === 3) && session.allowed('annotate'))
function goAnn() { emit('close'); router.push({ name: 'annotate', query: { batch: b.value!.id } }) }
const b = computed(() => pl.batches.find((x) => x.id === props.id) ?? null)
const log = computed(() => (b.value ? pl.batchLog(b.value) : []))
</script>
<template>
  <a-modal :open="!!b" :title="b ? '批次 ' + b.id : ''" :width="720" centered :footer="null" @cancel="emit('close')">
    <template v-if="b">
      <div style="display: flex; flex-direction: column; gap: 16px">
        <dl class="kv">
          <dt>来源任务</dt><dd class="mono">{{ b.task }} · {{ SCEN[b.scen].name }}</dd>
          <dt>规模</dt><dd>{{ b.count }} 条 · {{ b.size }} GB</dd>
          <dt>当前阶段</dt><dd>{{ STAGES[b.stage] }} <BatchStateBadge :b="b" /> <span class="muted" style="font-size:12.5px">{{ STAGE_HINT[b.stage] }}</span></dd>
        </dl>
        <BatchTrack :b="b" />
        <div class="logbox" tabindex="0" aria-label="处理日志"><template v-for="(l, i) in log" :key="i"><span class="t">{{ l.t }}</span> <span v-if="l.lv" :class="l.lv === 'ERROR' ? 'e' : 'w'">{{ l.lv }}</span> {{ l.msg }}{{ i < log.length - 1 ? '\n' : '' }}</template></div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px">
        <button type="button" class="btn" @click="emit('close')">关闭</button>
        <button v-if="toAnn" type="button" class="btn primary" @click="goAnn">{{ b.stage === 2 ? '去标注' : '去审核' }}</button>
        <button v-if="b.state === 'failed'" type="button" class="btn primary" :disabled="!mayEdit" :title="mayEdit ? undefined : NO_PERM" @click="emit('retry', b.id)">重试此批次</button>
      </div>
    </template>
  </a-modal>
</template>
