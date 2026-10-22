<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import SaveBar from '@/components/SaveBar.vue'
import { NO_PERM, TODAY } from '@/constants'
import { useSystem } from '@/stores/system'
import { useSession } from '@/stores/session'
import { useSettings, type Cfg } from '@/stores/settings'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'

const sys = useSystem()
const session = useSession()
const settings = useSettings()
const isAdmin = computed(() => session.can('system'))
const dis = computed(() => (isAdmin.value ? undefined : NO_PERM))
const tab = ref('ip')

/* IP 白名单 */
const wl = reactive({ v: '', err: '' })
const IP_RE = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)(\/(3[0-2]|[12]?\d))?$/
function addIp() {
  const v = wl.v.trim()
  wl.err = ''
  if (!IP_RE.test(v)) { wl.err = '格式不正确，请输入 IPv4 或 CIDR'; return }
  if (sys.whitelist.includes(v)) { wl.err = '该地址已在白名单中'; return }
  sys.whitelist.push(v); wl.v = ''; toast('已添加 ' + v)
}
async function delIp(i: number) {
  const ok = await confirmDlg({ title: '移除 ' + sys.whitelist[i] + '？', msg: '该网段内的设备将无法再访问平台。', ok: '移除', danger: true })
  if (ok) { sys.whitelist.splice(i, 1); toast('已移除') }
}
function toggleWl(v: boolean) { settings.cfg.whitelistOn = v; toast(v ? '已启用 IP 白名单' : '已关闭 IP 白名单', v ? {} : { type: 'warn' }) }

/* 审计日志 */
const au = reactive({ k: 'all', page: 1 })
const kinds = computed(() => ['all', ...Array.from(new Set(sys.audit.map((a) => a.k)))])
const auRows = computed(() => sys.audit.filter((a) => au.k === 'all' || a.k === au.k))
watch(() => au.k, () => { au.page = 1 })

/* 系统设置 */
const draft = reactive<Cfg>({ ...settings.cfg })
const cfgDirty = computed(() => JSON.stringify(draft) !== JSON.stringify(settings.cfg))
const bad = computed(() => ({
  integrity: !(draft.integrity >= 90 && draft.integrity <= 100),
  sync: !(draft.sync >= 1 && draft.sync <= 100),
  drop: !(draft.drop >= 0.5 && draft.drop <= 20),
  naming: !(draft.naming.includes('{任务}') && draft.naming.includes('{序号}')),
}))
const anyBad = computed(() => Object.values(bad.value).some(Boolean))
const preview = computed(() => draft.naming.replace('{任务}', 'VR_QMD').replace('{日期}', TODAY).replace('{序号}', '001').replace('{操作员}', 'ZJ') + '.bag')
function saveCfg() { if (anyBad.value) { toast('请先修正标红的字段', { type: 'warn' }); return } Object.assign(settings.cfg, draft); toast('系统设置已保存') }
function resetCfg() { Object.assign(draft, settings.cfg) }
const alertSw = [['alertOffline', '设备离线'], ['alertDrop', '通道掉帧'], ['alertSync', '同步误差超限'], ['alertStorage', '存储容量预警']] as const
const auditCols = [{ title: '时间', key: 't', width: 130 }, { title: '用户', key: 'u', width: 90 }, { title: '类型', key: 'k', width: 90 }, { title: '操作', key: 'd' }, { title: '来源 IP', key: 'ip', width: 150 }]
</script>

<template>
  <PageHead title="系统管理" desc="IP 白名单、审计日志与系统参数" />
  <div v-if="!isAdmin" class="callout info"><AppIcon name="lock" /><span>当前角色只有查看权限，修改请联系系统管理员。</span></div>
  <a-tabs v-model:active-key="tab"><a-tab-pane key="ip" tab="IP 白名单" /><a-tab-pane key="audit" tab="审计日志" /><a-tab-pane key="cfg" tab="系统设置" /></a-tabs>

  <div v-if="tab === 'ip'" class="card">
    <div class="card-head"><div><h2>IP 白名单</h2><div class="sub">仅白名单内的地址可以访问平台</div></div><div class="row"><span class="muted">启用</span><a-switch :checked="settings.cfg.whitelistOn" :disabled="!isAdmin" aria-label="启用白名单" @change="toggleWl as never" /></div></div>
    <div class="card-body" style="display:flex;flex-direction:column;gap:16px">
      <a-form layout="vertical"><a-form-item label="添加地址" extra="支持单个 IPv4 或 CIDR 网段" :validate-status="wl.err ? 'error' : ''" :help="wl.err">
        <div class="row"><a-input v-model:value="wl.v" class="mono" placeholder="如 10.20.1.0/24 或 192.168.1.8" :disabled="!isAdmin" @press-enter="addIp" /><a-button type="primary" :disabled="!isAdmin" :title="dis" @click="addIp">添加</a-button></div>
      </a-form-item></a-form>
      <div v-if="sys.whitelist.length" class="list-i"><div v-for="(x, i) in sys.whitelist" :key="x" class="li"><span class="mono grow">{{ x }}</span><a-button size="small" type="text" :disabled="!isAdmin" :title="dis" @click="delIp(i)"><AppIcon name="trash" size="sm" />移除</a-button></div></div>
      <EmptyState v-else icon="shield" title="白名单为空" desc="启用状态下将拒绝所有访问" />
    </div>
  </div>

  <div v-else-if="tab === 'audit'" class="card">
    <div class="toolbar"><div class="chips"><button v-for="k in kinds" :key="k" type="button" class="chip" :aria-pressed="au.k === k" @click="au.k = k">{{ k === 'all' ? '全部' : k }}</button></div></div>
    <a-table row-key="t" :columns="auditCols" :data-source="auRows.map((r, i) => ({ ...r, i }))" :scroll="{ x: 620 }" :pagination="{ current: au.page, pageSize: 10, showSizeChanger: false, showTotal: (n: number) => `共 ${n} 条记录，保留 180 天` }" @change="(p: { current?: number }) => (au.page = p.current ?? 1)">
      <template #bodyCell="{ column, record }">
        <span v-if="column.key === 't'" class="num muted">{{ record.t }}</span>
        <StatusBadge v-else-if="column.key === 'k'" kind="" :text="record.k" plain />
        <span v-else-if="column.key === 'ip'" class="mono muted">{{ record.ip }}</span>
      </template>
    </a-table>
  </div>

  <template v-else>
    <div class="grid g2">
      <div class="card">
        <div class="card-head"><div><h2>质检阈值</h2><div class="sub">方案书各处表述不一，默认取较严格值</div></div></div>
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
