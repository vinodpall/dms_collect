<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import SaveBar from '@/components/SaveBar.vue'
import { NO_PERM } from '@/constants'
import { useSystem } from '@/stores/system'
import { useSession } from '@/stores/session'
import { useSettings, type Cfg } from '@/stores/settings'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'
import type { WhitelistItem } from '@/api'

const sys = useSystem()
const session = useSession()
const settings = useSettings()
const isAdmin = computed(() => session.can('system'))
const dis = computed(() => (isAdmin.value ? undefined : NO_PERM))
const tab = ref('ip')

/* IP 白名单 */
const wl = reactive({ v: '', remark: '', err: '', busy: false })
const wlPage = ref(1)
const wlCols = [
  { title: '序号', key: 'idx', width: 70, align: 'center' as const },
  { title: 'IP 地址 / CIDR 网段', dataIndex: 'cidr', key: 'cidr', width: 190, ellipsis: true, align: 'center' as const },
  { title: '备注', key: 'remark', ellipsis: true, align: 'center' as const },
  { title: '添加时间', key: 'created', width: 165, ellipsis: true, align: 'center' as const },
  { title: '访问策略', key: 'st', width: 110, align: 'center' as const },
  { title: '操作', key: 'act', width: 100, align: 'center' as const },
]
const wlData = computed(() => sys.whitelist.map((item, i) => ({ ...item, idx: i + 1 })))
const IP_RE = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)(\/(3[0-2]|[12]?\d))?$/

async function addIp() {
  const v = wl.v.trim()
  wl.err = ''
  if (!IP_RE.test(v)) { wl.err = '格式不正确，请输入 IPv4 或 CIDR'; return }
  if (sys.whitelist.some((item) => item.cidr === v)) { wl.err = '该地址已在白名单中'; return }
  wl.busy = true
  try {
    await sys.addWhitelist(v, wl.remark.trim() || undefined)
    wl.v = ''
    wl.remark = ''
    toast('已添加 ' + v)
  } catch (err: any) {
    toast('添加失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    wl.busy = false
  }
}

async function delIp(item: WhitelistItem) {
  const ok = await confirmDlg({ title: '移除 ' + item.cidr + '？', msg: '该网段内的设备将无法再访问平台。', ok: '移除', danger: true })
  if (!ok) return
  try {
    await sys.removeWhitelist(item.id)
    toast('已移除 ' + item.cidr)
  } catch (err: any) {
    toast('移除失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  }
}

async function toggleWl(v: boolean) {
  try {
    await settings.saveSettings({ whitelistOn: v })
    toast(v ? '已启用 IP 白名单' : '已关闭 IP 白名单', v ? {} : { type: 'warn' })
  } catch (err: any) {
    toast('切换白名单开关失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  }
}

/* 系统设置（同步真实 fetchSettings 并防止未保存状态假阳性） */
const draft = reactive<Cfg>({ ...settings.cfg })
const syncedSnap = ref(JSON.stringify(settings.cfg))

watch(
  () => JSON.stringify(settings.cfg),
  (nextSnap) => {
    if (JSON.stringify(draft) === syncedSnap.value || !settings.loaded) {
      Object.assign(draft, settings.cfg)
    }
    syncedSnap.value = nextSnap
  }
)

const cfgDirty = computed(() => JSON.stringify(draft) !== JSON.stringify(settings.cfg))
const bad = computed(() => ({
  integrity: !(draft.integrity >= 90 && draft.integrity <= 100),
  sync: !(draft.sync >= 1 && draft.sync <= 100),
  drop: !(draft.drop >= 0.5 && draft.drop <= 20),
  naming: !(draft.naming.includes('{任务}') && draft.naming.includes('{序号}')),
}))
const anyBad = computed(() => Object.values(bad.value).some(Boolean))
const todayStr = (() => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
})()
const preview = computed(() =>
  draft.naming.replace('{任务}', 'VR_QMD').replace('{日期}', todayStr).replace('{序号}', '001').replace('{操作员}', 'ZJ') + '.bag'
)

async function saveCfg() {
  if (anyBad.value) { toast('请先修正标红的字段', { type: 'warn' }); return }
  try {
    await settings.saveSettings({ ...draft })
    Object.assign(draft, settings.cfg)
    syncedSnap.value = JSON.stringify(settings.cfg)
    toast('系统设置已保存')
  } catch (err: any) {
    toast('保存系统设置失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  }
}

function resetCfg() {
  Object.assign(draft, settings.cfg)
  syncedSnap.value = JSON.stringify(settings.cfg)
}

const alertSw = [['alertOffline', '设备离线'], ['alertDrop', '通道掉帧'], ['alertSync', '同步误差超限'], ['alertStorage', '存储容量预警']] as const

onMounted(async () => {
  await Promise.allSettled([sys.fetchWhitelist(), settings.fetchSettings()])
})
</script>

<template>
  <PageHead title="系统管理" desc="IP 白名单与系统参数配置">
    <template #desc>
      <div style="margin-top:10px">
        <div class="cyber-tabs" role="tablist" aria-label="系统管理视图切换">
          <button
            type="button"
            role="tab"
            class="cyber-tab-item"
            :class="{ active: tab === 'ip' }"
            :aria-selected="tab === 'ip'"
            @click="tab = 'ip'"
          >
            <AppIcon name="shield" size="sm" />
            <span>IP 白名单</span>
          </button>
          <button
            type="button"
            role="tab"
            class="cyber-tab-item"
            :class="{ active: tab === 'cfg' }"
            :aria-selected="tab === 'cfg'"
            @click="tab = 'cfg'"
          >
            <AppIcon name="settings" size="sm" />
            <span>系统设置</span>
          </button>
        </div>
      </div>
    </template>
  </PageHead>
  <div v-if="!isAdmin" class="callout info"><AppIcon name="lock" /><span>当前角色只有查看权限，修改请联系系统管理员。</span></div>

  <div v-if="tab === 'ip'" class="card">
    <div class="card-head"><div><h2>IP 白名单</h2><div class="sub">仅白名单内的地址可以访问平台</div></div><div class="row"><span class="muted">启用</span><a-switch :checked="settings.cfg.whitelistOn" :disabled="!isAdmin" aria-label="启用白名单" @change="toggleWl as never" /></div></div>
    <div class="card-body" style="display:flex;flex-direction:column;gap:16px">
      <a-form layout="vertical">
        <a-form-item label="添加地址" extra="支持单个 IPv4 或 CIDR 网段" :validate-status="wl.err ? 'error' : ''" :help="wl.err">
          <div class="row">
            <a-input v-model:value="wl.v" class="mono grow" placeholder="如 10.20.1.0/24 或 192.168.1.8" :disabled="!isAdmin" @press-enter="addIp" />
            <a-input v-model:value="wl.remark" style="width:220px" placeholder="备注说明（可选）" :disabled="!isAdmin" @press-enter="addIp" />
            <a-button type="primary" :loading="wl.busy" :disabled="!isAdmin" :title="dis" @click="addIp">添加</a-button>
          </div>
        </a-form-item>
      </a-form>
      <div v-if="sys.whitelist.length">
        <a-table
          :data-source="wlData"
          :columns="wlCols"
          :loading="sys.loading"
          row-key="id"
          size="middle"
          :pagination="{
            current: wlPage,
            pageSize: 8,
            showSizeChanger: false,
            hideOnSinglePage: false,
            showTotal: (total: number) => `共 ${total} 条白名单`,
            onChange: (p: number) => { wlPage = p },
          }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'idx'">
              <span class="num muted">{{ record.idx }}</span>
            </template>
            <template v-else-if="column.key === 'cidr'">
              <span class="mono font-bold cell-ellipsis" :title="record.cidr">{{ record.cidr }}</span>
            </template>
            <template v-else-if="column.key === 'remark'">
              <span class="muted cell-ellipsis" :title="record.remark || ''">{{ record.remark || '—' }}</span>
            </template>
            <template v-else-if="column.key === 'created'">
              <span class="num muted cell-ellipsis">{{ record.created_at ? record.created_at.replace('T', ' ').slice(0, 16) : '—' }}</span>
            </template>
            <template v-else-if="column.key === 'st'">
              <span class="tag good">允许访问</span>
            </template>
            <template v-else-if="column.key === 'act'">
              <div class="act-links">
                <a-button size="small" type="link" danger :disabled="!isAdmin" :title="dis" @click="delIp(record as WhitelistItem)">移除</a-button>
              </div>
            </template>
          </template>
        </a-table>
      </div>
      <EmptyState v-else icon="shield" :title="sys.loading ? '正在加载白名单…' : '白名单为空'" desc="启用状态下将按白名单策略校验访问来源" />
    </div>
  </div>

  <template v-else>
    <div class="grid g2">
      <div class="card">
        <div class="card-head"><div><h2>质检阈值</h2><div class="sub">用于采集校验与实时告警阈值判定</div></div></div>
        <div class="card-body"><a-form layout="vertical">
          <a-form-item label="数据完整率下限（%）" extra="低于该值的数据会被隔离" :validate-status="bad.integrity ? 'error' : ''" :help="bad.integrity ? '请输入 90–100' : ''"><a-input-number v-model:value="draft.integrity" :step="0.1" :disabled="!isAdmin" style="width:100%" /></a-form-item>
          <a-form-item label="时间同步误差上限（ms）" extra="多模态通道之间的时间戳偏差" :validate-status="bad.sync ? 'error' : ''" :help="bad.sync ? '请输入 1–100' : ''"><a-input-number v-model:value="draft.sync" :step="0.5" :disabled="!isAdmin" style="width:100%" /></a-form-item>
          <a-form-item label="相机掉帧率告警（%）" :validate-status="bad.drop ? 'error' : ''" :help="bad.drop ? '请输入 0.5–20' : ''"><a-input-number v-model:value="draft.drop" :step="0.5" :disabled="!isAdmin" style="width:100%" /></a-form-item>
        </a-form></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>文件命名</h2><div class="sub">可用变量：{任务} {日期} {序号} {操作员}</div></div></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:16px">
          <a-form layout="vertical"><a-form-item label="命名模板" :validate-status="bad.naming ? 'error' : ''" :help="bad.naming ? '模板至少包含 {任务} 和 {序号}' : ''"><a-input v-model:value="draft.naming" class="mono" :disabled="!isAdmin" /></a-form-item></a-form>
          <div class="field"><span class="label">预览</span><div class="mono" style="padding:10px 12px;border-radius:8px;background:var(--surface-3);overflow-wrap:anywhere">{{ preview }}</div></div>
        </div>
      </div>
    </div>
    <div class="card"><div class="card-head"><div><h2>告警通知</h2></div></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:14px"><div v-for="s in alertSw" :key="s[0]" class="row between"><b>{{ s[1] }}</b><a-switch v-model:checked="draft[s[0]]" :disabled="!isAdmin" :aria-label="s[1]" /></div></div>
    </div>
    <SaveBar v-if="cfgDirty && isAdmin" msg="系统设置有未保存的修改" @save="saveCfg" @reset="resetCfg" />
  </template>
</template>
