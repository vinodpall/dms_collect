<script setup lang="ts">
import { CLIP_ST, type Clip } from '@/stores/annotate'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import type { BadgeKind } from '@/constants'

defineProps<{
  clips: Clip[]
  cur: number | null
  filters: [string, string, number][]
  filter: string
  emptyDesc: string
  loading?: boolean
}>()
const emit = defineEmits<{ pick: [id: number]; 'update:filter': [v: string] }>()
</script>
<template>
  <div class="clist">
    <div class="toolbar" style="padding:10px 10px;flex-direction:column;align-items:stretch;gap:0">
      <slot name="head" />
      <div v-if="filters.length" class="filter-seg" role="group" aria-label="筛选">
        <button
          v-for="f in filters"
          :key="f[0]"
          type="button"
          class="filter-tab"
          :aria-pressed="filter === f[0]"
          @click="emit('update:filter', f[0])"
        >
          <span class="lbl">{{ f[1] }}</span>
          <span class="num-badge">{{ f[2] }}</span>
        </button>
      </div>
    </div>
    <div class="cbody">
      <div v-if="loading && !clips.length" class="muted" style="text-align:center;padding:36px 12px;font-size:12.5px">
        <a-spin size="small" style="margin-right:6px" />加载中…
      </div>
      <template v-else-if="clips.length">
        <button v-for="c in clips" :key="c.numericId" type="button" class="clip" :class="{ cur: cur === c.numericId }" @click="emit('pick', c.numericId)">
          <span class="f" :title="c.file">{{ c.id }} · {{ c.file }}</span>
          <span class="row between">
            <span class="muted" style="font-size:12px">{{ c.sceneName || c.scen || '—' }} · {{ c.dur ? c.dur.toFixed(1) + 's' : '—' }} · {{ c.batch || '—' }}</span>
            <StatusBadge :kind="(CLIP_ST[c.status]?.[0] || 'info') as BadgeKind" :text="c.statusLabel || CLIP_ST[c.status]?.[1] || c.status" />
          </span>
          <slot name="meta" :clip="c" />
          <span v-if="c.status === 'rejected' && c.rejectReason" class="rj">驳回：{{ c.rejectReason }}</span>
        </button>
      </template>
      <EmptyState v-else icon="inbox" title="没有数据" :desc="emptyDesc" />
    </div>
  </div>
</template>
<style scoped>
.clist { display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--line); }
.filter-seg { display: flex; width: 100%; padding: 3px; border-radius: 8px; background: var(--surface-3); gap: 2px; }
.filter-tab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 3px; height: 28px; padding: 0 4px; border: 0; border-radius: 6px; background: none; color: var(--muted); font-size: 12px; cursor: pointer; white-space: nowrap; transition: all .15s ease; }
.filter-tab:hover { color: var(--text); }
.filter-tab[aria-pressed="true"] { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: 0 1px 2px rgba(26,42,77,.12); }
.filter-tab .lbl { font-size: 11.5px; }
.filter-tab .num-badge { font: 600 11px var(--font-mono); opacity: .75; }
.cbody { overflow: auto; flex: 1; max-height: 820px; }
.rj { font-size: 12px; color: var(--crit); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
