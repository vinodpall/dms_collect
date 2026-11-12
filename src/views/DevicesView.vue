<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import DeviceDrawer from '@/components/devices/DeviceDrawer.vue'
import AddDeviceDialog from '@/components/devices/AddDeviceDialog.vue'
import FaultDialog from '@/components/devices/FaultDialog.vue'
import { NO_PERM } from '@/constants'
import { DEV_TYPES, DV_ST, STATIONS, useDevices, type DevStatus, type Device } from '@/stores/devices'
import { useTasks } from '@/stores/tasks'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'
import { stationsApi, type StationItem } from '@/api'

const store = useDevices()
const session = useSession()
const tasks = useTasks()
const mayEdit = computed(() => session.can('devices'))

// 视图切换：'devices' | 'stations'
const activeTab = ref<'devices' | 'stations'>('devices')

/* ================= 设备台账相关 ================= */
const st = reactive({
  s: 'all' as 'all' | DevStatus,
  station: 'all',
  type: 'all',
  cal: 'all' as 'all' | 'yes' | 'no',
  q: '',
  key: 'id',
  dir: 'ascend' as 'ascend' | 'descend',
})
const drawerId = ref<string | null>(null)
const faultOpen = ref(false)
const addOpen = ref(false)
const chips: ['all' | DevStatus, string][] = [
  ['all', '全部'],
  ['online', '在线'],
  ['offline', '离线'],
  ['maint', '维护中'],
  ['fault', '故障'],
]
const count = (k: 'all' | DevStatus) =>
  k === 'all' ? store.list.length : store.list.filter((d) => d.st === k).length

const rows = computed(() => {
  const q = st.q.toLowerCase()
  const out = store.list.filter(
    (d) =>
      (st.s === 'all' || d.st === st.s) &&
      (st.station === 'all' || d.station === st.station) &&
      (st.type === 'all' || d.type === st.type) &&
      (st.cal === 'all' || (st.cal === 'yes') === !!d.calib) &&
      (!q || (d.id + d.name + d.loc + d.type).toLowerCase().includes(q))
  )
  const k = st.key as keyof Device,
    s = st.dir === 'ascend' ? 1 : -1
  const val = (d: Device) => (k === 'calib' ? d.calib?.at ?? '' : String(d[k]))
  return out.slice().sort((a, b) => val(a).localeCompare(val(b), 'zh') * s)
})

const sortOf = (k: string) => (st.key === k ? st.dir : null)
const columns = computed(() => [
  { title: '设备', key: 'name', sorter: true, sortOrder: sortOf('name') },
  { title: '类型', key: 'type' },
  { title: '所属工位', key: 'station' },
  { title: '位置', key: 'loc' },
  { title: '状态', key: 'st', sorter: true, sortOrder: sortOf('st') },
  { title: '标定', key: 'calib', sorter: true, sortOrder: sortOf('calib') },
  { title: '当前占用', key: 'occ' },
  { title: '固件', key: 'fw' },
])

function onChange(_p: unknown, _f: unknown, s: { columnKey?: string; order?: 'ascend' | 'descend' | null }) {
  if (s?.columnKey) {
    if (s.order) {
      st.key = String(s.columnKey)
      st.dir = s.order
    } else {
      st.key = 'id'
      st.dir = 'ascend'
    }
  }
}
const customRow = (r: Device) => ({ class: 'row-click', onClick: () => (drawerId.value = r.id) })

/* ================= 需求 3：工位配置管理 ================= */
const stations = ref<StationItem[]>([
  {
    id: 1,
    code: 'WS-01',
    name: '工位 1（气密性检测工位）',
    mqtt_username: 'station_ws01',
    api_base_url: 'http://192.168.10.101:9000',
    has_api_token: true,
    client_ver: 'v2.4.1',
    ip: '192.168.10.101',
    is_online: true,
    last_seen_at: '刚刚',
    disk_free_gb: 840,
    remark: '配备 Franka 机械臂、RealSense 多目与气密工装',
    device_count: 6,
    created_at: '2026-10-01',
  },
  {
    id: 2,
    code: 'WS-02',
    name: '工位 2（防护堵安装工位）',
    mqtt_username: 'station_ws02',
    api_base_url: 'http://192.168.10.102:9000',
    has_api_token: true,
    client_ver: 'v2.4.0',
    ip: '192.168.10.102',
    is_online: true,
    last_seen_at: '2分钟前',
    disk_free_gb: 620,
    remark: '配备 UMI 便携双目夹爪与顶置全景相机',
    device_count: 4,
    created_at: '2026-10-03',
  },
])

const stationSearch = ref('')
const stationModal = reactive({
  open: false,
  isEdit: false,
  id: 0,
  code: '',
  name: '',
  api_base_url: '',
  api_token: '',
  remark: '',
  saving: false,
})

async function fetchStations() {
  try {
    const res = await stationsApi.list()
    if (Array.isArray(res) && res.length > 0) {
      stations.value = res
    }
  } catch (e) {
    console.warn('获取工位失败，使用内置数据:', e)
  }
}

onMounted(() => {
  fetchStations()
})

const filteredStations = computed(() => {
  const q = stationSearch.value.trim().toLowerCase()
  if (!q) return stations.value
  return stations.value.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      (s.ip && s.ip.includes(q)) ||
      (s.remark && s.remark.toLowerCase().includes(q))
  )
})

function openAddStation() {
  Object.assign(stationModal, {
    open: true,
    isEdit: false,
    id: 0,
    code: 'WS-0' + (stations.value.length + 1),
    name: '',
    api_base_url: 'http://192.168.10.10' + (stations.value.length + 1) + ':9000',
    api_token: '',
    remark: '',
    saving: false,
  })
}

function openEditStation(s: StationItem) {
  Object.assign(stationModal, {
    open: true,
    isEdit: true,
    id: s.id,
    code: s.code,
    name: s.name,
    api_base_url: s.api_base_url || '',
    api_token: '',
    remark: s.remark || '',
    saving: false,
  })
}

async function saveStation() {
  if (!stationModal.name.trim() || !stationModal.code.trim()) {
    return toast('请填写工位名称与工位代码', { type: 'warn' })
  }
  stationModal.saving = true
  try {
    if (stationModal.isEdit) {
      await stationsApi.update(stationModal.id, {
        name: stationModal.name.trim(),
        api_base_url: stationModal.api_base_url.trim() || null,
        api_token: stationModal.api_token ? stationModal.api_token.trim() : null,
        remark: stationModal.remark.trim() || null,
      })
      const found = stations.value.find((s) => s.id === stationModal.id)
      if (found) {
        found.name = stationModal.name.trim()
        found.api_base_url = stationModal.api_base_url.trim() || null
        found.remark = stationModal.remark.trim() || null
      }
      toast('工位「' + stationModal.name + '」已更新')
    } else {
      const res = await stationsApi.create({
        code: stationModal.code.trim().toUpperCase(),
        name: stationModal.name.trim(),
        api_base_url: stationModal.api_base_url.trim() || null,
        api_token: stationModal.api_token ? stationModal.api_token.trim() : null,
        remark: stationModal.remark.trim() || null,
      })
      if (res && res.station) {
        stations.value.push(res.station)
      } else {
        stations.value.push({
          id: Date.now(),
          code: stationModal.code.trim().toUpperCase(),
          name: stationModal.name.trim(),
          mqtt_username: 'station_' + stationModal.code.trim().toLowerCase(),
          api_base_url: stationModal.api_base_url.trim() || null,
          has_api_token: !!stationModal.api_token,
          client_ver: 'v2.4.1',
          ip: '192.168.10.' + (100 + stations.value.length),
          is_online: true,
          last_seen_at: '刚刚',
          disk_free_gb: 500,
          remark: stationModal.remark.trim() || null,
          device_count: 0,
          created_at: new Date().toISOString().slice(0, 10),
        })
      }
      toast('工位「' + stationModal.name + '」已创建')
    }
    stationModal.open = false
  } catch (err: any) {
    toast('保存失败: ' + (err?.message || '网络异常'), { type: 'crit' })
  } finally {
    stationModal.saving = false
  }
}
</script>

<template>
  <PageHead
    title="设备与工位管理"
    desc="统一管理硬件设备台账、网络通信参数与物理数采工位（可跨任务灵活调配）"
  >
    <template v-if="activeTab === 'devices'">
      <a-button
        type="primary"
        :disabled="!session.isAdmin"
        :title="session.isAdmin ? undefined : '仅系统管理员可新增设备'"
        @click="addOpen = true"
      >
        <AppIcon name="plus" />新增设备
      </a-button>
      <a-button :disabled="!mayEdit" :title="mayEdit ? undefined : NO_PERM" @click="faultOpen = true">
        <AppIcon name="wrench" />登记故障
      </a-button>
    </template>
    <template v-else>
      <a-button
        type="primary"
        :disabled="!session.isAdmin"
        :title="session.isAdmin ? undefined : '仅系统管理员可配置工位'"
        @click="openAddStation"
      >
        <AppIcon name="plus" />新增采集工位
      </a-button>
    </template>
  </PageHead>

  <!-- 顶部主页签 -->
  <div class="main-tabs-bar">
    <a-radio-group v-model:value="activeTab" button-style="solid">
      <a-radio-button value="devices">
        <AppIcon name="cpu" size="sm" style="margin-right:6px" />
        设备台账管理 ({{ store.list.length }})
      </a-radio-button>
      <a-radio-button value="stations">
        <AppIcon name="layers" size="sm" style="margin-right:6px" />
        采集工位配置 ({{ stations.length }})
      </a-radio-button>
    </a-radio-group>
  </div>

  <!-- TAB 1: 设备台账 -->
  <template v-if="activeTab === 'devices'">
    <div class="card">
      <div class="toolbar">
        <a-input
          v-model:value="st.q"
          class="grow"
          allow-clear
          placeholder="搜索设备名称、编号、位置"
          aria-label="搜索设备"
        >
          <template #prefix><AppIcon name="search" /></template>
        </a-input>
        <a-select
          v-model:value="st.station"
          style="width:140px"
          aria-label="按工位筛选"
          :options="[{ value: 'all', label: '全部工位' }, ...STATIONS.map((x) => ({ value: x }))]"
        />
        <a-select
          v-model:value="st.type"
          style="width:130px"
          aria-label="按类型筛选"
          :options="[{ value: 'all', label: '全部类型' }, ...DEV_TYPES.map((x) => ({ value: x }))]"
        />
        <a-select
          v-model:value="st.cal"
          style="width:120px"
          aria-label="按标定筛选"
          :options="[
            { value: 'all', label: '标定状态' },
            { value: 'yes', label: '已标定' },
            { value: 'no', label: '未标定' },
          ]"
        />
      </div>
      <div class="toolbar" style="border-bottom:0;padding-bottom:0">
        <div class="chips">
          <button
            v-for="c in chips"
            :key="c[0]"
            type="button"
            class="chip"
            :aria-pressed="st.s === c[0]"
            @click="st.s = c[0]"
          >
            {{ c[1] }} <span class="n num">{{ count(c[0]) }}</span>
          </button>
        </div>
      </div>
      <a-table
        row-key="id"
        :columns="columns"
        :data-source="rows"
        :custom-row="customRow"
        :scroll="{ x: 820 }"
        :pagination="{ pageSize: 20, hideOnSinglePage: true, showTotal: (n: number) => `共 ${n} 台设备` }"
        @change="onChange as never"
      >
        <template #bodyCell="{ column, record }">
          <div v-if="column.key === 'name'" class="cell-main">
            <span>{{ record.name }}</span><small class="mono">{{ record.id }}</small>
          </div>
          <span v-else-if="column.key === 'station'">{{ record.station }}</span>
          <StatusBadge
            v-else-if="column.key === 'calib'"
            :kind="record.calib ? 'good' : 'warn'"
            :text="record.calib ? '已标定 · ' + record.calib.at : '未标定'"
          />
          <span v-else-if="column.key === 'occ'" :class="tasks.occupant(record.id) ? 'mono' : 'muted'">
            {{ tasks.occupant(record.id) ?? '空闲' }}
          </span>
          <StatusBadge
            v-else-if="column.key === 'st'"
            :kind="DV_ST[record.st as DevStatus][0]"
            :text="DV_ST[record.st as DevStatus][1]"
          />
          <span v-else-if="column.key === 'fw'" class="mono muted">{{ record.fw }}</span>
        </template>
        <template #emptyText>
          <EmptyState icon="search" title="没有符合条件的设备" desc="换个关键词或状态试试" />
        </template>
      </a-table>
      <div class="tbl-foot">
        <span>共 {{ rows.length }} 台设备</span>
      </div>
    </div>
  </template>

  <!-- TAB 2: 采集工位配置（需求 3） -->
  <template v-else-if="activeTab === 'stations'">
    <div class="card">
      <div class="toolbar">
        <a-input
          v-model:value="stationSearch"
          class="grow"
          allow-clear
          placeholder="搜索工位名称、编号代码、IP 或备注"
        >
          <template #prefix><AppIcon name="search" /></template>
        </a-input>
      </div>

      <div class="stations-grid">
        <div v-for="stn in filteredStations" :key="stn.id" class="station-card">
          <div class="stn-header">
            <div>
              <div class="row center" style="gap:8px">
                <h3 class="stn-name">{{ stn.name }}</h3>
                <span class="mono tag">{{ stn.code }}</span>
              </div>
              <small class="muted">MQTT: {{ stn.mqtt_username }} · IP: {{ stn.ip || '—' }}</small>
            </div>
            <div class="row center" style="gap:8px">
              <StatusBadge
                :kind="stn.is_online ? 'good' : 'crit'"
                :text="stn.is_online ? '在线就绪' : '离线断连'"
              />
              <a-button
                size="small"
                type="link"
                :disabled="!session.isAdmin"
                @click="openEditStation(stn)"
              >
                配置
              </a-button>
            </div>
          </div>

          <div class="stn-body">
            <div class="stn-stat-row">
              <div class="stn-stat">
                <span class="muted">挂载设备</span>
                <b>{{ stn.device_count }} 台</b>
              </div>
              <div class="stn-stat">
                <span class="muted">客户端版本</span>
                <span class="mono">{{ stn.client_ver || 'v2.4.1' }}</span>
              </div>
              <div class="stn-stat">
                <span class="muted">本地存储</span>
                <b>{{ stn.disk_free_gb || 0 }} GB 剩余</b>
              </div>
              <div class="stn-stat">
                <span class="muted">最近心跳</span>
                <span>{{ stn.last_seen_at || '刚刚' }}</span>
              </div>
            </div>

            <div class="stn-endpoint">
              <span class="muted">边缘 API:</span>
              <span class="mono url">{{ stn.api_base_url || '未配置 Base URL' }}</span>
              <span v-if="stn.has_api_token" class="tag good" style="font-size:11px">Token 鉴权已开启</span>
            </div>

            <div v-if="stn.remark" class="stn-desc">
              {{ stn.remark }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>

  <!-- 对话框与抽屉 -->
  <AddDeviceDialog :open="addOpen" @close="addOpen = false" @done="(id: string) => (drawerId = id)" />
  <DeviceDrawer :id="drawerId" @close="drawerId = null" />
  <FaultDialog :open="faultOpen" :dev-id="null" @close="faultOpen = false" @done="() => {}" />

  <!-- 工位配置弹窗 -->
  <a-modal
    v-model:open="stationModal.open"
    :title="stationModal.isEdit ? '编辑工位配置' : '新增采集工位'"
    centered
    :confirm-loading="stationModal.saving"
    ok-text="保存工位"
    cancel-text="取消"
    @ok="saveStation"
  >
    <a-form layout="vertical">
      <div class="row" style="gap:12px">
        <a-form-item label="工位代码" required style="flex:1" extra="大写字母数字，如 WS-03">
          <a-input
            v-model:value="stationModal.code"
            :disabled="stationModal.isEdit"
            placeholder="如 WS-03"
          />
        </a-form-item>
        <a-form-item label="工位名称" required style="flex:1">
          <a-input v-model:value="stationModal.name" placeholder="如 工位 3（双臂遥操）" />
        </a-form-item>
      </div>

      <a-form-item label="边缘端 API Base URL" extra="边缘采集站的 HTTP 服务地址，用于下发 YAML 配置与下发自检">
        <a-input v-model:value="stationModal.api_base_url" placeholder="如 http://192.168.10.103:9000" />
      </a-form-item>

      <a-form-item label="API 访问令牌 (Token)" extra="留空则保持原密钥不变">
        <a-input-password v-model:value="stationModal.api_token" placeholder="输入工位边缘端通信鉴权 Token" />
      </a-form-item>

      <a-form-item label="工位说明与配置备注">
        <a-textarea
          v-model:value="stationModal.remark"
          :rows="2"
          placeholder="如 配备双臂协作机械臂与多目深度视觉套件"
        />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style scoped>
.main-tabs-bar {
  margin-bottom: 16px;
}
.stations-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 16px;
  padding: 16px;
}
.station-card {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.stn-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.stn-name {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.stn-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.stn-stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  background: var(--surface);
  padding: 10px;
  border-radius: 6px;
  border: 1px solid var(--line);
}
.stn-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.stn-stat span {
  font-size: 11px;
}
.stn-endpoint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  background: var(--surface-3);
  padding: 6px 10px;
  border-radius: 6px;
}
.stn-endpoint .url {
  color: var(--accent);
  font-size: 12px;
  word-break: break-all;
}
.stn-desc {
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.4;
}
@media (max-width: 640px) {
  .stations-grid {
    grid-template-columns: 1fr;
  }
  .stn-stat-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
