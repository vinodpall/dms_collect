<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import DeviceDrawer from '@/components/devices/DeviceDrawer.vue'
import AddDeviceDialog from '@/components/devices/AddDeviceDialog.vue'
import FaultDialog from '@/components/devices/FaultDialog.vue'
import { NO_PERM } from '@/constants'
import { DEV_TYPES, DV_ST, TYPE_LABEL_TO_CODE, useDevices, type DevStatus, type Device } from '@/stores/devices'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'
import type { StationCredentials, StationItem } from '@/api'

const store = useDevices()
const session = useSession()
const mayEdit = computed(() => session.can('devices'))

const activeTab = ref<'devices' | 'stations'>('devices')

/* ================= 设备台账相关 ================= */
const st = reactive({
  s: 'all' as 'all' | DevStatus,
  station: 'all',
  type: 'all',
  cal: 'all' as 'all' | 'yes' | 'no',
  q: '',
  page: 1,
})
const drawerId = ref<string | null>(null)
const faultOpen = ref(false)
const addOpen = ref(false)

const stationFilterOpts = computed(() => [
  { value: 'all', label: '全部工位' },
  ...store.stations.map((s) => ({ value: String(s.id), label: s.name })),
])

const typeFilterOpts = computed(() => {
  if (store.types.length) {
    return [{ value: 'all', label: '全部类型' }, ...store.types.map((t) => ({ value: t.type, label: t.label }))]
  }
  return [
    { value: 'all', label: '全部类型' },
    ...DEV_TYPES.map((label) => ({ value: TYPE_LABEL_TO_CODE[label] || 'other', label })),
  ]
})

const rows = computed(() => {
  const q = st.q.trim().toLowerCase()
  const out = store.list.filter(
    (d) =>
      (st.s === 'all' || d.st === st.s) &&
      (st.station === 'all' || String(d.stationId) === st.station) &&
      (st.type === 'all' || d.typeCode === st.type || d.type === st.type) &&
      (st.cal === 'all' || (st.cal === 'yes') === !!d.calib) &&
      (!q || [d.id, d.name, d.loc, d.type, d.station, d.model, d.serialNo].some((x) => (x || '').toLowerCase().includes(q)))
  )
  return out.slice().sort((a, b) => a.id.localeCompare(b.id, 'zh'))
})

watch(
  () => [st.s, st.station, st.type, st.cal, st.q],
  () => {
    st.page = 1
  }
)

const columns = computed(() => [
  { title: '设备', key: 'name', align: 'center' as const },
  { title: '类型', dataIndex: 'type', key: 'type', align: 'center' as const },
  { title: '所属工位', dataIndex: 'station', key: 'station', align: 'center' as const },
  { title: '位置', key: 'loc', align: 'center' as const },
  { title: '状态', key: 'st', align: 'center' as const },
  { title: '标定', key: 'calib', align: 'center' as const },
  { title: '当前占用', key: 'occ', align: 'center' as const },
  { title: '固件', key: 'fw', align: 'center' as const },
])

function onTableChange(p: { current?: number }) {
  st.page = p?.current ?? 1
}
const customRow = (r: Device) => ({ class: 'row-click', onClick: () => (drawerId.value = r.id) })

/* ================= 工位配置管理 ================= */
const stationSearch = ref('')
const stationStatus = ref<'all' | 'online' | 'offline'>('all')
const stationPage = ref(1)
const stationPageSize = 6

const stationModal = reactive({
  open: false,
  isEdit: false,
  id: 0,
  code: '',
  name: '',
  api_base_url: '',
  api_token: '',
  remark: '',
  reset_mqtt_password: false,
  saving: false,
})

const credModal = reactive<{ open: boolean; stationName: string; creds: StationCredentials | null }>({
  open: false,
  stationName: '',
  creds: null,
})

function formatTime(raw: string | null) {
  if (!raw) return '—'
  return raw.includes('T') ? raw.replace('T', ' ').slice(0, 16) : raw
}

onMounted(async () => {
  try {
    await store.fetchAll()
  } catch (err: any) {
    toast('加载设备与工位数据失败：' + (err?.message || '网络异常'), { type: 'crit' })
  }
})

const filteredStations = computed(() => {
  const q = stationSearch.value.trim().toLowerCase()
  return store.stations.filter((s) => {
    if (stationStatus.value === 'online' && !s.is_online) return false
    if (stationStatus.value === 'offline' && s.is_online) return false
    if (!q) return true
    return (
      s.name.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      (s.ip && s.ip.includes(q)) ||
      (s.remark && s.remark.toLowerCase().includes(q))
    )
  })
})

watch(
  () => [stationSearch.value, stationStatus.value],
  () => {
    stationPage.value = 1
  }
)

const paginatedStations = computed(() => {
  const start = (stationPage.value - 1) * stationPageSize
  return filteredStations.value.slice(start, start + stationPageSize)
})

function openAddStation() {
  Object.assign(stationModal, {
    open: true,
    isEdit: false,
    id: 0,
    code: '',
    name: '',
    api_base_url: '',
    api_token: '',
    remark: '',
    reset_mqtt_password: false,
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
    reset_mqtt_password: false,
    saving: false,
  })
}

function copyText(txt: string) {
  navigator.clipboard?.writeText(txt).then(
    () => toast('已复制'),
    () => toast('复制失败，请手动复制', { type: 'warn' })
  )
}

async function saveStation() {
  if (!stationModal.name.trim() || !stationModal.code.trim()) {
    return toast('请填写工位名称与工位代码', { type: 'warn' })
  }
  stationModal.saving = true
  try {
    if (stationModal.isEdit) {
      const res = await store.updateStation(stationModal.id, {
        name: stationModal.name.trim(),
        api_base_url: stationModal.api_base_url.trim() || null,
        api_token: stationModal.api_token ? stationModal.api_token.trim() : null,
        remark: stationModal.remark.trim() || null,
        reset_mqtt_password: stationModal.reset_mqtt_password || undefined,
      })
      toast('工位「' + stationModal.name.trim() + '」已更新')
      stationModal.open = false
      if (res?.credentials && (res.credentials.mqtt_password || res.credentials.api_token)) {
        Object.assign(credModal, { open: true, stationName: stationModal.name.trim(), creds: res.credentials })
      }
    } else {
      const res = await store.createStation({
        code: stationModal.code.trim().toUpperCase(),
        name: stationModal.name.trim(),
        api_base_url: stationModal.api_base_url.trim() || null,
        api_token: stationModal.api_token ? stationModal.api_token.trim() : null,
        remark: stationModal.remark.trim() || null,
      })
      toast('工位「' + stationModal.name.trim() + '」已创建')
      stationModal.open = false
      if (res?.credentials) {
        Object.assign(credModal, { open: true, stationName: res.station?.name || stationModal.name.trim(), creds: res.credentials })
      }
    }
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
    <template #desc>
      <div style="margin-top:10px">
        <div class="cyber-tabs">
          <button
            type="button"
            class="cyber-tab-item"
            :class="{ active: activeTab === 'devices' }"
            @click="activeTab = 'devices'"
          >
            <AppIcon name="cpu" size="sm" />
            <span>设备台账管理</span>
          </button>
          <button
            type="button"
            class="cyber-tab-item"
            :class="{ active: activeTab === 'stations' }"
            @click="activeTab = 'stations'"
          >
            <AppIcon name="layers" size="sm" />
            <span>采集工位配置</span>
          </button>
        </div>
      </div>
    </template>

    <template v-if="activeTab === 'devices'">
      <a-button
        type="primary"
        :disabled="!mayEdit"
        :title="mayEdit ? undefined : NO_PERM"
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
        :disabled="!mayEdit"
        :title="mayEdit ? undefined : NO_PERM"
        @click="openAddStation"
      >
        <AppIcon name="plus" />新增采集工位
      </a-button>
    </template>
  </PageHead>

  <!-- TAB 1: 设备台账 -->
  <template v-if="activeTab === 'devices'">
    <div class="card">
      <div class="toolbar">
        <a-input
          v-model:value="st.q"
          class="grow"
          allow-clear
          placeholder="搜索设备名称、编号、位置、序列号"
          aria-label="搜索设备"
        >
          <template #prefix><AppIcon name="search" /></template>
        </a-input>
        <a-select
          v-model:value="st.station"
          style="width:150px"
          aria-label="按工位筛选"
          :options="stationFilterOpts"
        />
        <a-select
          v-model:value="st.type"
          style="width:130px"
          aria-label="按类型筛选"
          :options="typeFilterOpts"
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
        <a-select
          v-model:value="st.s"
          style="width:130px"
          aria-label="按状态筛选"
          :options="[
            { value: 'all', label: '全部状态' },
            { value: 'online', label: '在线' },
            { value: 'offline', label: '离线' },
            { value: 'maint', label: '维护中' },
            { value: 'fault', label: '故障' },
          ]"
        />
      </div>
      <a-table
        row-key="id"
        :columns="columns"
        :data-source="rows"
        :loading="store.loading"
        :custom-row="customRow"
        :scroll="{ x: 820 }"
        :pagination="{ current: st.page, pageSize: 20, showSizeChanger: false, hideOnSinglePage: false, showTotal: (n: number) => `共 ${n} 台设备` }"
        @change="onTableChange as never"
      >
        <template #bodyCell="{ column, record }">
          <div v-if="column.key === 'name'" class="cell-main">
            <span>{{ record.name }}</span><small class="mono">{{ record.id }}</small>
          </div>
          <span v-else-if="column.key === 'station'">{{ record.station || '—' }}</span>
          <span v-else-if="column.key === 'loc'" class="muted">{{ record.loc || '—' }}</span>
          <StatusBadge
            v-else-if="column.key === 'calib'"
            :kind="record.calib ? 'good' : 'warn'"
            :text="record.calib ? (record.calib.at ? '已标定 · ' + record.calib.at.slice(5, 10) : '已标定') : '未标定'"
          />
          <span v-else-if="column.key === 'occ'" :class="record.occupiedTaskCode ? 'mono' : 'muted'">
            {{ record.occupiedTaskCode || '空闲' }}
          </span>
          <StatusBadge
            v-else-if="column.key === 'st'"
            :kind="DV_ST[record.st as DevStatus][0]"
            :text="DV_ST[record.st as DevStatus][1]"
          />
          <span v-else-if="column.key === 'fw'" class="mono muted">{{ record.fw || '—' }}</span>
        </template>
        <template #emptyText>
          <EmptyState icon="cpu" title="没有符合条件的设备" desc="请检查后端设备台账或调整筛选条件" />
        </template>
      </a-table>
    </div>
  </template>

  <!-- TAB 2: 采集工位配置 -->
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
        <a-select
          v-model:value="stationStatus"
          style="width:140px"
          aria-label="按工位状态筛选"
          :options="[
            { value: 'all', label: '全部状态' },
            { value: 'online', label: '在线就绪' },
            { value: 'offline', label: '离线断连' },
          ]"
        />
      </div>

      <div v-if="paginatedStations.length" class="stations-grid">
        <div v-for="stn in paginatedStations" :key="stn.id" class="station-card">
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
                :disabled="!mayEdit"
                :title="mayEdit ? undefined : NO_PERM"
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
                <span class="mono">{{ stn.client_ver || '—' }}</span>
              </div>
              <div class="stn-stat">
                <span class="muted">本地存储</span>
                <b>{{ stn.disk_free_gb !== null && stn.disk_free_gb !== undefined ? stn.disk_free_gb + ' GB 剩余' : '—' }}</b>
              </div>
              <div class="stn-stat">
                <span class="muted">最近心跳</span>
                <span>{{ formatTime(stn.last_seen_at) }}</span>
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
      <EmptyState v-else icon="layers" :title="store.loadingStations ? '正在加载工位…' : '暂无采集工位'" desc="点击右上角「新增采集工位」或调整筛选条件" style="padding:32px 16px" />

      <div class="grid-pager">
        <a-pagination
          v-model:current="stationPage"
          :page-size="stationPageSize"
          :total="filteredStations.length"
          :show-size-changer="false"
          :hide-on-single-page="false"
          :show-total="(n: number) => `共 ${n} 个工位`"
        />
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
    :width="660"
    centered
    :confirm-loading="stationModal.saving"
    ok-text="保存工位"
    cancel-text="取消"
    @ok="saveStation"
  >
    <a-form layout="vertical">
      <div class="form-row-2">
        <a-form-item required>
          <template #label>
            <span>工位代码</span>
            <small class="hint-text">如 WS-03</small>
          </template>
          <a-input
            v-model:value="stationModal.code"
            :disabled="stationModal.isEdit"
            placeholder="如 WS-03"
          />
        </a-form-item>
        <a-form-item label="工位名称" required>
          <a-input v-model:value="stationModal.name" placeholder="如 工位 3（双臂遥操）" />
        </a-form-item>
      </div>

      <a-form-item label="边缘端 API Base URL" extra="边缘采集站的 HTTP 服务地址，用于下发配置与自检">
        <a-input v-model:value="stationModal.api_base_url" placeholder="如 http://192.168.10.101:9000" />
      </a-form-item>

      <a-form-item label="API 访问令牌 (Token)" extra="留空则保持原密钥不变">
        <a-input-password v-model:value="stationModal.api_token" placeholder="输入工位边缘端通信鉴权 Token" />
      </a-form-item>

      <a-form-item v-if="stationModal.isEdit">
        <a-checkbox v-model:checked="stationModal.reset_mqtt_password">同时重置该工位的 MQTT 连接密码</a-checkbox>
      </a-form-item>

      <a-form-item label="工位说明与配置备注" style="margin-bottom:0">
        <a-textarea
          v-model:value="stationModal.remark"
          :rows="2"
          placeholder="如 配备双臂协作机械臂与多目深度视觉套件"
        />
      </a-form-item>
    </a-form>
  </a-modal>

  <!-- 工位认证凭据提示弹窗 -->
  <a-modal
    v-model:open="credModal.open"
    :title="`工位「${credModal.stationName}」连接凭据`"
    ok-text="我已保存"
    :cancel-button-props="{ style: { display: 'none' } }"
    width="480px"
    centered
    @ok="credModal.open = false"
  >
    <p class="muted" style="margin:6px 0 12px">请记录以下凭据并配置到工位边缘客户端，关闭后密钥将不再明文显示：</p>
    <div v-if="credModal.creds" style="display:flex;flex-direction:column;gap:10px">
      <div class="row between"><span class="muted">MQTT 用户名</span><span class="mono">{{ credModal.creds.mqtt_username }}</span></div>
      <div v-if="credModal.creds.mqtt_password" class="row between">
        <span class="muted">MQTT 密码</span>
        <div class="row" style="gap:6px"><code class="mono">{{ credModal.creds.mqtt_password }}</code><a-button size="small" @click="copyText(credModal.creds!.mqtt_password!)">复制</a-button></div>
      </div>
      <div v-if="credModal.creds.api_token" class="row between">
        <span class="muted">API Token</span>
        <div class="row" style="gap:6px"><code class="mono">{{ credModal.creds.api_token }}</code><a-button size="small" @click="copyText(credModal.creds!.api_token!)">复制</a-button></div>
      </div>
    </div>
  </a-modal>
</template>

<style scoped>
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
.hint-text {
  font-size: 11.5px;
  color: var(--muted, #B6CADC);
  margin-left: 6px;
  font-weight: 400;
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
