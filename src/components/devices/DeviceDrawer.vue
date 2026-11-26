<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import FaultDialog from './FaultDialog.vue'
import { NO_PERM } from '@/constants'
import { cfgText, DV_ST, useDevices } from '@/stores/devices'
import { confirmDlg } from '@/composables/confirm'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'

const props = defineProps<{ id: string | null }>()
const emit = defineEmits<{ close: [] }>()
const store = useDevices()
const session = useSession()
const d = computed(() => (props.id ? store.byId(props.id) : undefined))
const mayEdit = computed(() => session.can('devices'))
const dis = computed(() => (mayEdit.value ? undefined : NO_PERM))
const faultOpen = ref(false)
const busy = ref(false)
const loadingEvents = ref(false)

const occ = computed(() => d.value?.occupiedTaskCode || '')
const typeInfo = computed(() => (d.value ? store.typeMeta(d.value.typeCode || d.value.type) : null))

const allEvents = computed(() => (d.value ? store.eventsByDevice[d.value.numericId] || [] : []))
const maintEvents = computed(() => allEvents.value.filter((e) => e.event_type !== 'fault'))
const faultEvents = computed(() => allEvents.value.filter((e) => e.event_type === 'fault'))

async function refreshDetailAndEvents() {
  if (!d.value) return
  loadingEvents.value = true
  try {
    await Promise.allSettled([
      store.fetchDeviceDetail(d.value.numericId),
      store.fetchDeviceEvents(d.value.numericId),
    ])
  } finally {
    loadingEvents.value = false
  }
}

watch(
  () => props.id,
  async (val) => {
    if (val && d.value) {
      await refreshDetailAndEvents()
    }
  },
  { immediate: true }
)

function fmtTime(raw: string) {
  return raw ? raw.replace('T', ' ').slice(0, 16) : '—'
}

async function calibrate() {
  const x = d.value
  const info = typeInfo.value
  if (!x || !info) return
  const items = info.calibItems
  const ok = await confirmDlg({
    title: (x.calib ? '重新标定 ' : '标定 ') + x.name + '？',
    msg: '标定内容：' + items.join('、') + '。标定完成后将在设备上持久化保存，仅在移位或维修后需重新标定。',
    ok: '完成标定',
  })
  if (!ok) return
  busy.value = true
  try {
    await store.calibrate(x)
    await store.fetchDeviceEvents(x.numericId).catch(() => {})
    toast(x.name + ' 标定完成')
  } catch (err: any) {
    toast('标定失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    busy.value = false
  }
}

async function act(a: 'maint' | 'up') {
  const x = d.value
  if (!x) return
  busy.value = true
  try {
    if (a === 'maint') {
      await store.setStatus(x, 'maint')
      toast(x.name + ' 已转入维护，维修完成后建议重新标定')
    } else {
      await store.setStatus(x, 'online')
      toast(x.name + ' 已恢复上线')
    }
  } catch (err: any) {
    toast('状态流转失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <a-drawer
    :open="!!d"
    :width="640"
    :closable="false"
    :body-style="{ padding: '20px 24px 28px' }"
    :header-style="{ padding: '18px 24px 14px' }"
    destroy-on-close
    @close="emit('close')"
  >
    <template #title>
      <div v-if="d" style="display:flex;flex-direction:column;gap:12px;width:100%">
        <div class="row between">
          <div class="row"><span class="mono">{{ d.id }}</span><StatusBadge :kind="DV_ST[d.st][0]" :text="DV_ST[d.st][1]" /></div>
          <button type="button" class="icon-btn" aria-label="关闭" @click="emit('close')"><AppIcon name="x" /></button>
        </div>
        <h2 style="font-size:20px;font-weight:600;margin:0">{{ d.name }}</h2>
      </div>
    </template>
    <div v-if="d && typeInfo" style="display:flex;flex-direction:column;gap:20px">
      <dl class="kv">
        <dt>设备类型</dt><dd>{{ d.type }}</dd>
        <dt>所属工位</dt><dd>{{ d.station || '—' }}</dd>
        <dt>安装位置</dt><dd>{{ d.loc || '—' }}</dd>
        <dt>品牌型号</dt><dd>{{ [d.vendor, d.model].filter(Boolean).join(' · ') || '—' }}</dd>
        <dt>序列号</dt><dd class="mono">{{ d.serialNo || '—' }}</dd>
        <dt>固件信息</dt><dd class="mono">{{ [d.fw, d.fwType, d.fwModel].filter(Boolean).join(' · ') || '—' }}</dd>
        <dt>网络地址</dt><dd class="mono">{{ d.connIp ? (d.connPort != null ? `${d.connIp}:${d.connPort}` : d.connIp) : '—' }}</dd>
        <dt>连接凭据</dt><dd class="mono">{{ d.connUsername || d.connPassword ? `${d.connUsername || '—'} / ${d.connPassword ? '******' : '未设置'}` : '—' }}</dd>
        <dt>采集参数</dt><dd class="mono">{{ cfgText(d.type, d.cfg) }}</dd>
        <dt>当前占用</dt><dd>{{ occ ? '采集任务 ' + occ : '空闲' }}</dd>
        <dt>更新时间</dt><dd class="mono">{{ d.updatedAt || '—' }}</dd>
      </dl>

      <div>
        <h3 style="font-size:15px;font-weight:600;margin-bottom:10px">标定状态</h3>
        <div v-if="d.calib" class="callout info" style="flex-direction:column;align-items:flex-start;gap:4px">
          <span><b>已标定</b><template v-if="d.calib.at"> · {{ d.calib.at }}</template><template v-if="d.calib.by && d.calib.by !== '—'"> · {{ d.calib.by }}</template></span>
          <span class="muted" style="font-size:12.5px">{{ d.calib.items.join('、') }}</span>
        </div>
        <div v-else class="callout warn"><AppIcon name="alert" /><span>尚未标定，采集前自检会被拦截。标定内容：{{ typeInfo.calibItems.join('、') }}</span></div>
      </div>

      <div>
        <h3 style="font-size:15px;font-weight:600;margin-bottom:10px">维护与标定记录</h3>
        <div v-if="loadingEvents" class="muted" style="font-size:12.5px">加载设备事件记录中…</div>
        <div v-else-if="maintEvents.length" class="list-i">
          <div v-for="e in maintEvents" :key="e.id" class="li" style="align-items:flex-start">
            <span class="mono muted" style="width:110px;flex:none;font-size:12px">{{ fmtTime(e.created_at) }}</span>
            <span class="grow">
              <span class="tt" style="display:block">{{ e.title }}</span>
              <span v-if="e.description" class="ss">{{ e.description }}</span>
            </span>
            <span class="muted">{{ e.operator_name || '—' }}</span>
          </div>
        </div>
        <div v-else class="muted" style="font-size:12.5px">暂无维护与标定记录</div>
      </div>

      <div>
        <h3 style="font-size:15px;font-weight:600;margin-bottom:10px">故障记录</h3>
        <div v-if="loadingEvents" class="muted" style="font-size:12.5px">加载故障记录中…</div>
        <div v-else-if="faultEvents.length" class="list-i">
          <div v-for="f in faultEvents" :key="f.id" class="li" style="align-items:flex-start">
            <span class="alert-ico crit"><AppIcon name="alert" size="sm" /></span>
            <span class="grow">
              <span class="tt" style="display:block;white-space:normal">{{ f.description || f.title }}</span>
              <span class="ss">{{ fmtTime(f.created_at) }} · {{ f.event_level === 'severe' ? '严重' : '一般' }} · {{ f.operator_name || '—' }}</span>
            </span>
          </div>
        </div>
        <div v-else class="muted" style="font-size:12.5px">暂无故障记录</div>
      </div>
    </div>

    <template #footer>
      <div v-if="d" style="display:flex;gap:10px;justify-content:flex-end">
        <a-button :disabled="!mayEdit || busy" :title="dis" @click="faultOpen = true">登记故障</a-button>
        <template v-if="d.st === 'online'">
          <a-button :disabled="!mayEdit || busy" :title="dis" @click="act('maint')">转入维护</a-button>
          <a-button type="primary" :loading="busy" :disabled="!mayEdit || !!occ" :title="occ ? '设备正在采集中，结束后再标定' : dis" @click="calibrate">{{ d.calib ? '重新标定' : '执行标定' }}</a-button>
        </template>
        <a-button v-else type="primary" :loading="busy" :disabled="!mayEdit" :title="dis" @click="act('up')">恢复上线</a-button>
      </div>
    </template>
  </a-drawer>

  <FaultDialog :open="faultOpen" :dev-id="props.id" @close="faultOpen = false" @done="refreshDetailAndEvents" />
</template>
