<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import DatasetDrawer from '@/components/datasets/DatasetDrawer.vue'
import DatasetPreviewModal from '@/components/datasets/DatasetPreviewModal.vue'
import { SCEN } from '@/constants'
import { DS_ST, useDatasets, type Dataset } from '@/stores/datasets'
import { useUi } from '@/stores/ui'
import { toast } from '@/composables/toast'

const store = useDatasets()
const ui = useUi()
const st = reactive({
  q: '',
  status: 'all',
  key: 'updated',
  dir: 'descend' as 'ascend' | 'descend',
  page: 1,
})

function match(d: Dataset, q: string) {
  if (!q) return true
  const scenName = SCEN[d.scen]?.name || d.scen
  const scenMode = SCEN[d.scen]?.mode || ''
  const statusLabel = DS_ST[d.status]?.[1] || d.status
  const hay = [
    d.id,
    d.name,
    d.ver,
    d.tags.join(' '),
    d.spec + '寸',
    scenName,
    scenMode,
    statusLabel,
    d.quality >= 95 ? '高质量' : '',
    d.status === 'raw' ? '原始数据 raw bag' : '',
  ]
    .join(' ')
    .toLowerCase()
    .replace(/\s寸/g, '寸')

  return q
    .toLowerCase()
    .replace(/(\d+)\s*(寸|英寸)/g, '$1寸')
    .split(/\s+/)
    .filter(Boolean)
    .every((tk) => hay.includes(tk))
}

const rows = computed(() => {
  const out = store.list.filter((d) => (st.status === 'all' || d.status === st.status) && match(d, st.q))
  const f: Record<string, (d: Dataset) => number | string> = {
    name: (d) => d.name,
    count: (d) => d.count,
    size: (d) => d.size,
    quality: (d) => d.quality,
    updated: (d) => (d.updated.startsWith('今天') ? 'z' + d.updated : d.updated),
  }
  const k = f[st.key],
    s = st.dir === 'ascend' ? 1 : -1
  return out.slice().sort((a, b) => {
    const x = k(a),
      y = k(b)
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh')) * s
  })
})

watch(
  () => [st.q, st.status],
  () => {
    st.page = 1
  }
)

const columns = computed(() => [
  { title: '数据集', key: 'name', width: 230, ellipsis: true, align: 'center' as const },
  { title: '标签', key: 'tags', width: 175, ellipsis: true, align: 'center' as const },
  { title: '条数 / 片段', key: 'count', width: 115, align: 'center' as const },
  { title: '体量大小', key: 'size', width: 105, align: 'center' as const },
  { title: '完整率 / 质检状态', key: 'quality', width: 145, align: 'center' as const },
  { title: '状态', key: 'status', width: 130, align: 'center' as const },
  { title: '更新时间', key: 'updated', width: 125, ellipsis: true, align: 'center' as const },
  { title: '操作', key: 'action', width: 115, align: 'center' as const },
])

function onChange(p: { current?: number }) {
  st.page = p.current ?? 1
}

const customRow = (r: Dataset) => ({
  class: 'row-click',
  onClick: (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, .ant-btn, a')) return
    ui.datasetDrawerId = r.id
  },
})

function clear() {
  st.q = ''
  st.status = 'all'
}

const previewDs = computed(() => (ui.datasetViewerId ? store.byId(ui.datasetViewerId) ?? null : null))
function openViewer(d: Dataset) {
  ui.datasetViewerId = d.id
}

function handleDownloadRaw(d: Dataset) {
  toast(`开始下载原始数据包：${d.name} (${(d.size / 1000).toFixed(2)} TB)`)
}
</script>

<template>
  <PageHead title="数据集管理" desc="统一管理原始数采数据包 (Raw Bag) 与清洗发布版本、质检指标与算法端导出" />
  <div class="card">
    <div class="toolbar">
      <a-input
        v-model:value="st.q"
        class="grow"
        allow-clear
        placeholder="自然语言检索，如：原始数据、20寸 气密性、高质量"
        aria-label="检索数据集"
      >
        <template #prefix><AppIcon name="search" /></template>
      </a-input>
      <!-- 需求 7：增加原始数据筛选 -->
      <a-select
        v-model:value="st.status"
        style="width:170px"
        aria-label="状态"
        :options="[
          { value: 'all', label: '全部数据状态' },
          { value: 'raw', label: '原始数据包 (Raw)' },
          { value: 'published', label: '已发布标准集' },
          { value: 'review', label: '待审核校验' },
          { value: 'draft', label: '草稿' },
        ]"
      />
    </div>
    <a-table
      row-key="id"
      size="middle"
      :columns="columns"
      :data-source="rows"
      :custom-row="customRow"
      :pagination="{
        current: st.page,
        pageSize: 8,
        showSizeChanger: false,
        hideOnSinglePage: false,
        showTotal: (n: number) => `共 ${n} 个数据集`,
      }"
      @change="onChange as never"
    >
      <template #bodyCell="{ column, record }">
        <div v-if="column.key === 'name'" class="cell-main">
          <span :title="`${record.name} ${record.ver}`">
            {{ record.name }}
            <span class="fmt">{{ record.ver }}</span>
          </span>
          <small :title="`${record.id} · ${SCEN[record.scen]?.mode || '多模态采集'}`">{{ record.id }} · {{ SCEN[record.scen]?.mode || '多模态采集' }}</small>
        </div>
        <div v-else-if="column.key === 'tags'" class="cell-inline-tags" :title="record.tags.join('、')">
          <span v-for="t in record.tags.slice(0, 3)" :key="t" class="tag" :class="{ info: t.includes('原始') }">
            {{ t }}
          </span>
        </div>
        <span v-else-if="column.key === 'count'" class="num">{{ record.count.toLocaleString('en-US') }} 条</span>
        <span v-else-if="column.key === 'size'" class="num">{{ (record.size / 1000).toFixed(2) }} TB</span>
        
        <!-- 优化质量分为质检状态/完整率 -->
        <span v-else-if="column.key === 'quality'" class="num">
          <template v-if="record.status === 'raw'">
            <span class="tag info" style="font-size:11px">原始封存</span>
          </template>
          <template v-else-if="record.status === 'draft'">
            <span class="muted" style="font-size:12px">待质检</span>
          </template>
          <template v-else>
            <b :style="{ color: record.quality >= 95 ? 'var(--good)' : 'var(--warn)' }">{{ record.quality }}%</b>
            <small class="muted" style="margin-left:2px">合格</small>
          </template>
        </span>

        <StatusBadge
          v-else-if="column.key === 'status'"
          :kind="DS_ST[record.status as keyof typeof DS_ST]?.[0] || ''"
          :text="DS_ST[record.status as keyof typeof DS_ST]?.[1] || record.status"
        />
        <span v-else-if="column.key === 'updated'" class="muted num cell-ellipsis" :title="record.updated">{{ record.updated }}</span>
        <div v-else-if="column.key === 'action'" class="act-links" @click.stop>
          <a-button v-if="record.status === 'raw'" size="small" type="link" @click="handleDownloadRaw(record)">下载</a-button>
          <a-button v-else size="small" type="link" @click="openViewer(record)">查看</a-button>
          <a-button size="small" type="link" @click="ui.datasetDrawerId = record.id">详情</a-button>
        </div>
      </template>
      <template #emptyText>
        <EmptyState
          icon="search"
          :title="st.q ? `没有找到“${st.q}”相关的数据集` : '没有数据集'"
          desc="检索词用空格分隔，需要同时命中；试试更短的关键词"
        >
          <a-button size="small" style="margin-top:6px" @click="clear">清除条件</a-button>
        </EmptyState>
      </template>
    </a-table>
  </div>
  <DatasetDrawer :id="ui.datasetDrawerId" @close="ui.datasetDrawerId = null" />
  <DatasetPreviewModal :ds="previewDs" @close="ui.datasetViewerId = null" />
</template>
