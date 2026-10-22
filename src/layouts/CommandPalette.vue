<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { NAV_GROUPS, PAGE_META } from '@/constants'
import { useSession } from '@/stores/session'
import { useTasks } from '@/stores/tasks'
import { useDatasets } from '@/stores/datasets'
import { useUi } from '@/stores/ui'

interface Item { t: string; k: string; icon: string; kw: string; run: () => void }
const router = useRouter()
const session = useSession()
const tasks = useTasks()
const datasets = useDatasets()
const ui = useUi()
const q = ref('')
const act = ref(0)
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()

const items = computed<Item[]>(() => {
  const out: Item[] = []
  NAV_GROUPS.forEach((g) => g.items.filter((i) => session.allowed(i)).forEach((id) => out.push({ t: PAGE_META[id].title, k: '页面', icon: PAGE_META[id].icon, kw: PAGE_META[id].title + ' ' + id, run: () => router.push({ name: id }) })))
  if (session.allowed('tasks')) tasks.list.slice(0, 8).forEach((t) => out.push({ t: t.id + ' · ' + t.name, k: '采集任务', icon: 'task', kw: t.id + t.name, run: () => { router.push({ name: 'tasks' }); setTimeout(() => (ui.taskDrawerId = t.id), 300) } }))
  if (session.allowed('datasets')) datasets.list.forEach((d) => out.push({ t: d.name + ' ' + d.ver, k: '数据集', icon: 'db', kw: d.name + d.tags.join(''), run: () => { router.push({ name: 'datasets' }); setTimeout(() => (ui.datasetDrawerId = d.id), 300) } }))
  if (session.allowed('tasks') && session.can('tasks')) out.push({ t: '新建采集任务', k: '操作', icon: 'plus', kw: '新建 创建 任务', run: () => { router.push({ name: 'tasks' }); setTimeout(() => (ui.wizardOpen = true), 300) } })
  return out
})
const shown = computed(() => {
  const s = q.value.trim().toLowerCase()
  return s ? items.value.filter((it) => (it.t + ' ' + it.kw).toLowerCase().includes(s)) : items.value
})
watch(() => ui.paletteOpen, async (v) => { if (v) { q.value = ''; act.value = 0; await nextTick(); input.value?.focus() } })
watch(q, () => { act.value = 0 })
watch(act, async () => { await nextTick(); list.value?.querySelector('.act')?.scrollIntoView({ block: 'nearest' }) })

function run(i: number) { const it = shown.value[i]; if (!it) return; ui.paletteOpen = false; it.run() }
function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); act.value = Math.min(shown.value.length - 1, act.value + 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); act.value = Math.max(0, act.value - 1) }
  else if (e.key === 'Enter') { e.preventDefault(); run(act.value) }
  else if (e.key === 'Escape') { e.preventDefault(); ui.paletteOpen = false }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.paletteOpen" class="layer modal palette" style="align-items:flex-start" @mousedown.self="ui.paletteOpen = false">
      <div class="cmd" role="dialog" aria-modal="true" aria-label="全局搜索">
        <div class="cmd-in">
          <AppIcon name="search" />
          <input ref="input" v-model="q" type="text" placeholder="搜索页面、任务编号、数据集…" autocomplete="off" aria-label="全局搜索" @keydown="onKey" />
          <kbd>Esc</kbd>
        </div>
        <div ref="list" class="cmd-list" role="listbox">
          <div v-if="!shown.length" class="empty" style="padding:32px 12px">没有找到“{{ q }}”相关内容</div>
          <template v-for="(it, i) in shown" :key="it.k + it.t">
            <div v-if="i === 0 || shown[i - 1].k !== it.k" class="cmd-sec">{{ it.k }}</div>
            <button type="button" class="cmd-item" :class="{ act: i === act }" role="option" :aria-selected="i === act" @click="run(i)" @mousemove="act = i">
              <AppIcon :name="it.icon" /><span>{{ it.t }}</span><small>{{ it.k }}</small>
            </button>
          </template>
        </div>
        <div class="cmd-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></div>
      </div>
    </div>
  </Teleport>
</template>
