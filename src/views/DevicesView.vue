<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import DeviceDrawer from '@/components/devices/DeviceDrawer.vue'
import AddDeviceDialog from '@/components/devices/AddDeviceDialog.vue'
import FaultDialog from '@/components/devices/FaultDialog.vue'
import { NO_PERM, SCEN, type ScenKey } from '@/constants'
import { DV_ST, useDevices, type DevStatus, type Device } from '@/stores/devices'
import { useSession } from '@/stores/session'

const store = useDevices()
const session = useSession()
const mayEdit = computed(() => session.can('devices'))
const st = reactive({ s: 'all' as 'all' | DevStatus, scen: 'all' as 'all' | ScenKey | 'none', q: '', key: 'id', dir: 'ascend' as 'ascend' | 'descend' })
const drawerId = ref<string | null>(null)
const faultOpen = ref(false)
const addOpen = ref(false)
const chips: ['all' | DevStatus, string][] = [['all', '全部'], ['online', '在线'], ['offline', '离线'], ['maint', '维护中'], ['fault', '故障']]
const count = (k: 'all' | DevStatus) => (k === 'all' ? store.list.length : store.list.filter((d) => d.st === k).length)
const rows = computed(() => {
  const q = st.q.toLowerCase()
  const out = store.list.filter((d) => (st.s === 'all' || d.st === st.s) && (st.scen === 'all' || (st.scen === 'none' ? !d.scen : d.scen === st.scen)) && (!q || (d.id + d.name + d.loc + d.type).toLowerCase().includes(q)))
  const k = st.key as keyof Device, s = st.dir === 'ascend' ? 1 : -1
  return out.slice().sort((a, b) => String(a[k]).localeCompare(String(b[k]), 'zh') * s)
})
const sortOf = (k: string) => (st.key === k ? st.dir : null)
const columns = computed(() => [
  { title: '设备', key: 'name', sorter: true, sortOrder: sortOf('name') }, { title: '类型', key: 'type' }, { title: '所属场景', key: 'scen' }, { title: '位置', key: 'loc' },
  { title: '状态', key: 'st', sorter: true, sortOrder: sortOf('st') }, { title: '上次校准', key: 'cal', sorter: true, sortOrder: sortOf('cal') }, { title: '下次校准', key: 'next' }, { title: '固件', key: 'fw' },
])
function onChange(_p: unknown, _f: unknown, s: { columnKey?: string; order?: 'ascend' | 'descend' | null }) {
  if (s?.columnKey) { if (s.order) { st.key = String(s.columnKey); st.dir = s.order } else { st.key = 'id'; st.dir = 'ascend' } }
}
const customRow = (r: Device) => ({ class: 'row-click', onClick: () => (drawerId.value = r.id) })
</script>

<template>
  <PageHead title="设备管理" desc="设备台账、校准周期与故障登记">
    <a-button type="primary" :disabled="!session.isAdmin" :title="session.isAdmin ? undefined : '仅系统管理员可新增设备'" @click="addOpen = true"><AppIcon name="plus" />新增设备</a-button>
    <a-button :disabled="!mayEdit" :title="mayEdit ? undefined : NO_PERM" @click="faultOpen = true"><AppIcon name="wrench" />登记故障</a-button>
  </PageHead>
  <div class="card">
    <div class="toolbar"><a-input v-model:value="st.q" class="grow" allow-clear placeholder="搜索设备名称、编号、位置" aria-label="搜索设备"><template #prefix><AppIcon name="search" /></template></a-input>
      <a-select v-model:value="st.scen" style="width:170px" aria-label="按场景筛选" :options="[{ value: 'all', label: '全部场景' }, { value: 'qmd', label: SCEN.qmd.name }, { value: 'fhd', label: SCEN.fhd.name }, { value: 'none', label: '未分配' }]" /></div>
    <div class="toolbar" style="border-bottom:0;padding-bottom:0"><div class="chips"><button v-for="c in chips" :key="c[0]" type="button" class="chip" :aria-pressed="st.s === c[0]" @click="st.s = c[0]">{{ c[1] }} <span class="n num">{{ count(c[0]) }}</span></button></div></div>
    <a-table row-key="id" :columns="columns" :data-source="rows" :custom-row="customRow" :scroll="{ x: 820 }" :pagination="{ pageSize: 20, hideOnSinglePage: true, showTotal: (n: number) => `共 ${n} 台设备` }" @change="onChange as never">
      <template #bodyCell="{ column, record }">
        <div v-if="column.key === 'name'" class="cell-main"><span>{{ record.name }}</span><small class="mono">{{ record.id }}</small></div>
        <span v-else-if="column.key === 'scen'"><span v-if="record.scen" class="tag">{{ SCEN[record.scen as ScenKey].short }}</span><span v-else class="muted">未分配</span></span>
        <StatusBadge v-else-if="column.key === 'st'" :kind="DV_ST[record.st as DevStatus][0]" :text="DV_ST[record.st as DevStatus][1]" />
        <span v-else-if="column.key === 'cal' || column.key === 'next'" class="num">{{ record[column.key as string] }}</span>
        <span v-else-if="column.key === 'fw'" class="mono muted">{{ record.fw }}</span>
      </template>
      <template #emptyText><EmptyState icon="search" title="没有符合条件的设备" desc="换个关键词或状态试试" /></template>
    </a-table>
    <div class="tbl-foot"><span>共 {{ rows.length }} 台设备</span></div>
  </div>
  <AddDeviceDialog :open="addOpen" @close="addOpen = false" @done="(id: string) => (drawerId = id)" />
  <DeviceDrawer :id="drawerId" @close="drawerId = null" />
  <FaultDialog :open="faultOpen" :dev-id="null" @close="faultOpen = false" @done="() => {}" />
</template>
