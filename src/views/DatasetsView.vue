<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import DatasetDrawer from '@/components/datasets/DatasetDrawer.vue'
import DatasetPreviewModal from '@/components/datasets/DatasetPreviewModal.vue'
import { SCEN } from '@/constants'
import { DS_QUERIES, DS_ST, useDatasets, type Dataset } from '@/stores/datasets'
import { useUi } from '@/stores/ui'

const store = useDatasets()
const ui = useUi()
const st = reactive({ q: '', status: 'all', key: 'updated', dir: 'descend' as 'ascend' | 'descend', page: 1 })

function match(d: Dataset, q: string) {
  if (!q) return true
  const hay = [d.id, d.name, d.ver, d.tags.join(' '), d.spec + '寸', SCEN[d.scen].mode, DS_ST[d.status][1], d.quality >= 95 ? '高质量' : ''].join(' ').toLowerCase().replace(/\s寸/g, '寸')
  return q.toLowerCase().replace(/(\d+)\s*(寸|英寸)/g, '$1寸').split(/\s+/).filter(Boolean).every((tk) => hay.includes(tk))
}
const rows = computed(() => {
  const out = store.list.filter((d) => (st.status === 'all' || d.status === st.status) && match(d, st.q))
  const f: Record<string, (d: Dataset) => number | string> = { name: (d) => d.name, count: (d) => d.count, size: (d) => d.size, quality: (d) => d.quality, updated: (d) => (d.updated.startsWith('今天') ? 'z' + d.updated : d.updated) }
  const k = f[st.key], s = st.dir === 'ascend' ? 1 : -1
  return out.slice().sort((a, b) => { const x = k(a), y = k(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh')) * s })
})
watch(() => [st.q, st.status], () => { st.page = 1 })
const sortOf = (k: string) => (st.key === k ? st.dir : null)
const columns = computed(() => [
  { title: '数据集', key: 'name', sorter: true, sortOrder: sortOf('name') },
  { title: '标签', key: 'tags' },
  { title: '条数', key: 'count', align: 'right' as const, sorter: true, sortOrder: sortOf('count') },
  { title: '大小', key: 'size', align: 'right' as const, sorter: true, sortOrder: sortOf('size') },
  { title: '质量分', key: 'quality', align: 'right' as const, sorter: true, sortOrder: sortOf('quality') },
  { title: '状态', key: 'status' },
  { title: '更新', key: 'updated', align: 'right' as const, sorter: true, sortOrder: sortOf('updated') },
  { title: '操作', key: 'action', align: 'center' as const, width: 140, fixed: 'right' },
])
function onChange(p: { current?: number }, _f: unknown, s: { columnKey?: string; order?: 'ascend' | 'descend' | null }) {
  st.page = p.current ?? 1
  if (s?.columnKey) { if (s.order) { st.key = String(s.columnKey); st.dir = s.order } else { st.key = 'updated'; st.dir = 'descend' } }
}
const customRow = (r: Dataset) => ({
  class: 'row-click',
  onClick: (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, .ant-btn, a')) return
    ui.datasetDrawerId = r.id
  },
})
function clear() { st.q = ''; st.status = 'all' }
const previewDs = computed(() => (ui.datasetViewerId ? store.byId(ui.datasetViewerId) ?? null : null))
function openViewer(d: Dataset) { ui.datasetViewerId = d.id }
</script>

<template>
  <PageHead title="数据集管理" desc="检索、版本与导出" />
  <div class="card">
    <div class="toolbar">
      <a-input v-model:value="st.q" class="grow" allow-clear placeholder="自然语言检索，如：20寸 气密性 高质量" aria-label="检索数据集"><template #prefix><AppIcon name="search" /></template></a-input>
      <a-select v-model:value="st.status" style="width:140px" aria-label="状态" :options="[{ value: 'all', label: '全部状态' }, { value: 'published', label: '已发布' }, { value: 'review', label: '待审核' }, { value: 'draft', label: '草稿' }]" />
    </div>
    <div class="toolbar" style="border-bottom:0;padding-bottom:0">
      <span class="muted" style="font-size:12.5px">试试：</span>
      <div class="chips"><button v-for="q in DS_QUERIES" :key="q" type="button" class="chip" :aria-pressed="st.q === q" @click="st.q = q">{{ q }}</button></div>
    </div>
    <a-table row-key="id" :columns="columns" :data-source="rows" :custom-row="customRow" :scroll="{ x: 960 }" @change="onChange as never"
      :pagination="{ current: st.page, pageSize: 6, showSizeChanger: false, showTotal: (n: number) => `共 ${n} 个数据集` }">
      <template #bodyCell="{ column, record }">
        <div v-if="column.key === 'name'" class="cell-main"><span>{{ record.name }} <span class="fmt">{{ record.ver }}</span></span><small>{{ record.id }} · {{ SCEN[record.scen as 'qmd' | 'fhd'].mode }}</small></div>
        <div v-else-if="column.key === 'tags'" class="row wrap" style="gap:4px"><span v-for="t in record.tags.slice(0, 3)" :key="t" class="tag">{{ t }}</span></div>
        <span v-else-if="column.key === 'count'" class="num">{{ record.count.toLocaleString('en-US') }}</span>
        <span v-else-if="column.key === 'size'" class="num">{{ (record.size / 1000).toFixed(2) }} TB</span>
        <span v-else-if="column.key === 'quality'" class="num">{{ record.quality }}</span>
        <StatusBadge v-else-if="column.key === 'status'" :kind="DS_ST[record.status as keyof typeof DS_ST][0]" :text="DS_ST[record.status as keyof typeof DS_ST][1]" />
        <span v-else-if="column.key === 'updated'" class="muted num">{{ record.updated }}</span>
        <div v-else-if="column.key === 'action'" class="row center" style="gap:6px" @click.stop>
          <a-button size="small" type="primary" ghost @click="openViewer(record)">
            <template #icon><AppIcon name="eye" size="sm" /></template>
            查看
          </a-button>
          <a-button size="small" type="text" @click="ui.datasetDrawerId = record.id">详情</a-button>
        </div>
      </template>
      <template #emptyText>
        <EmptyState icon="search" :title="st.q ? `没有找到“${st.q}”相关的数据集` : '没有数据集'" desc="检索词用空格分隔，需要同时命中；试试更短的关键词"><a-button size="small" style="margin-top:6px" @click="clear">清除条件</a-button></EmptyState>
      </template>
    </a-table>
  </div>
  <DatasetDrawer :id="ui.datasetDrawerId" @close="ui.datasetDrawerId = null" />
  <DatasetPreviewModal :ds="previewDs" @close="ui.datasetViewerId = null" />
</template>
