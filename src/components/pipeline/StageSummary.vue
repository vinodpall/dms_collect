<script setup lang="ts">
import { STAGES } from '@/constants'
import { fmt } from '@/utils'
import { usePipeline } from '@/stores/pipeline'

const props = defineProps<{ stage: number | null }>()
const emit = defineEmits<{ (e: 'update:stage', v: number | null): void }>()
const pl = usePipeline()
const bad = (i: number) => pl.batches.some((b) => b.stage === i && b.state === 'failed')
const toggle = (i: number) => emit('update:stage', props.stage === i ? null : i)
</script>
<template>
  <div class="card"><div class="card-body">
    <div class="pipe">
      <button v-for="(s, i) in STAGES" :key="s" type="button" class="pipe-stage" :class="{ fail: bad(i) }" :aria-pressed="stage === i"
        :style="stage === i ? 'box-shadow:inset 0 -3px 0 var(--accent)' : ''" @click="toggle(i)">
        <div class="n">{{ fmt(pl.countAtStage(i)) }}</div><div class="l">{{ s }}</div>
      </button>
    </div>
    <div v-if="stage !== null" style="margin-top: 10px"><button type="button" class="btn ghost sm" @click="emit('update:stage', null)">清除阶段筛选</button></div>
  </div></div>
</template>
