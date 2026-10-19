<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import BatchStateBadge from './BatchStateBadge.vue'
import { SCEN, STAGES, STAGE_HINT, STAGE_MANUAL } from '@/constants'
import type { Batch } from '@/stores/pipeline'

defineProps<{ rows: Batch[] }>()
const emit = defineEmits<{ (e: 'open', id: string): void }>()
</script>
<template>
  <div class="board">
    <div v-for="(s, i) in STAGES" :key="s" class="col">
      <div class="col-h"><span :title="STAGE_HINT[i]">{{ s }}<span class="tag" :class="{ man: STAGE_MANUAL.includes(i) }" style="margin-left:6px;font-weight:400">{{ i === 0 ? '归档' : STAGE_MANUAL.includes(i) ? '人工' : '自动' }}</span></span><span class="c">{{ rows.filter((b) => b.stage === i).length }}</span></div>
      <div class="col-b">
        <template v-if="rows.some((b) => b.stage === i)">
          <button v-for="b in rows.filter((x) => x.stage === i)" :key="b.id" type="button" class="bcard" :class="{ fail: b.state === 'failed' }" @click="emit('open', b.id)">
            <div class="row between"><span class="id">{{ b.id }}</span><AppIcon v-if="b.state === 'failed'" name="alert" size="sm" /></div>
            <div class="muted" style="margin: 4px 0 8px">{{ SCEN[b.scen].short }} · {{ b.count }} 条</div>
            <div v-if="b.state === 'running'" class="progress" role="progressbar" :aria-valuenow="Math.round(b.pct)" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: Math.min(100, Math.max(0, b.pct)) + '%' }"></i></div>
            <div v-else><BatchStateBadge :b="b" /></div>
          </button>
        </template>
        <div v-else class="muted" style="text-align: center; padding: 18px 0; font-size: 12.5px">暂无批次</div>
      </div>
    </div>
  </div>
</template>
