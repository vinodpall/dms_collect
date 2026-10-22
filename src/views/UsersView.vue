<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import { NO_PERM } from '@/constants'
import { useAccess, tempPwd, type UserRow } from '@/stores/access'
import { useSession } from '@/stores/session'
import { useLogs } from '@/stores/logs'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'

const access = useAccess()
const session = useSession()
const logs = useLogs()
const mayEdit = computed(() => session.can('users'))
const dis = computed(() => (mayEdit.value ? undefined : NO_PERM))
const audit = (action: string, target: string, summary: string, status?: 'warn') =>
  logs.addLog({ user: session.info.user, role: session.info.name, module: 'system', moduleName: '用户管理', action, target, summary, status })

/* 筛选 */
const st = reactive({ q: '', role: 'all', s: 'all' })
const rows = computed(() => access.users.filter((u) => {
  const q = st.q.trim().toLowerCase()
  if (q && ![u.name, u.u, u.dept, u.email, u.phone].some((x) => x.toLowerCase().includes(q))) return false
  if (st.role !== 'all' && u.role !== st.role) return false
  return st.s === 'all' || (st.s === 'on' ? u.on : !u.on)
}))
const roleOpts = computed(() => access.roles.map((r) => ({ value: r.key, label: r.name })))
const roleName = (k: string) => access.roleMap[k]?.name ?? '未分配'
const kpi = computed(() => ({
  all: access.users.length,
  on: access.users.filter((u) => u.on).length,
  off: access.users.filter((u) => !u.on).length,
  tmp: access.users.filter((u) => u.mustReset).length,
}))

/* 新增 / 编辑 */
const ACC_RE = /^[a-z][a-z0-9_.-]{2,23}$/
const blank = () => ({ id: '', u: '', name: '', role: 'op', dept: '', phone: '', email: '', pwd: tempPwd() })
const md = reactive({ open: false, busy: false, f: blank(), touched: false })
const errs = computed(() => {
  const f = md.f, e: Record<string, string> = {}
  if (!md.f.id) {
    if (!ACC_RE.test(f.u)) e.u = '3–24 位，小写字母开头，可含数字、下划线、点、横线'
    else if (access.byAccount(f.u)) e.u = '该账号已存在'
    if (f.pwd.length < 8) e.pwd = '初始密码至少 8 位'
  }
  if (!f.name.trim()) e.name = '请输入姓名'
  if (!access.roleMap[f.role]) e.role = '请选择角色'
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) e.email = '邮箱格式不正确'
  if (f.phone && !/^[\d\s+-]{6,20}$/.test(f.phone)) e.phone = '电话格式不正确'
  return e
})
function openAdd() { Object.assign(md, { open: true, busy: false, touched: false, f: blank() }) }
function openEdit(u: UserRow) { Object.assign(md, { open: true, busy: false, touched: false, f: { id: u.id, u: u.u, name: u.name, role: u.role, dept: u.dept, phone: u.phone, email: u.email, pwd: '' } }) }
const selfDemote = computed(() => md.f.id === session.uid && !access.roleMap[md.f.role]?.all && session.isAdmin)
async function save() {
  md.touched = true
  if (Object.keys(errs.value).length) return
  const f = md.f
  const d = { name: f.name.trim(), role: f.role, dept: f.dept.trim(), phone: f.phone.trim(), email: f.email.trim() }
  if (f.id) {
    const old = access.byId(f.id)!
    if (access.roleMap[old.role]?.all && !access.roleMap[f.role]?.all && old.on && access.activeAdmins <= 1) { toast('至少需要保留一名启用中的系统管理员', { type: 'warn' }); return }
    if (selfDemote.value && !(await confirmDlg({ title: '调整自己的角色？', msg: '保存后你将失去系统管理员权限，可能无法再进入本页面。', ok: '仍要保存', danger: true }))) return
    const before = roleName(old.role)
    access.updateUser(f.id, d)
    audit('编辑用户', `${d.name}（${old.u}）`, before !== roleName(d.role) ? `角色：${before} → ${roleName(d.role)}` : '更新用户资料')
    toast('已保存 ' + d.name)
  } else {
    md.busy = true
    await access.addUser({ ...d, u: f.u.trim() }, f.pwd)
    md.busy = false
    audit('新增用户', `${d.name}（${f.u}）`, '角色：' + roleName(d.role))
    toast('已创建账号 ' + f.u + '，首次登录后请提醒其修改密码')
  }
  md.open = false
}
function copy(t: string) { navigator.clipboard?.writeText(t).then(() => toast('已复制'), () => toast('复制失败，请手动选择复制', { type: 'warn' })) }

/* 启停 / 重置密码 / 删除 */
async function toggle(u: UserRow, on: boolean) {
  if (u.id === session.uid) { toast('不能停用当前登录的账号', { type: 'warn' }); return }
  if (!on && access.roleMap[u.role]?.all && access.activeAdmins <= 1) { toast('至少需要保留一名启用中的系统管理员', { type: 'warn' }); return }
  if (!on && !(await confirmDlg({ title: '停用 ' + u.name + '？', msg: '停用后该账号将无法登录，已登录的会话会立即失效。', ok: '停用', danger: true }))) return
  access.setOn(u.id, on)
  audit(on ? '启用用户' : '停用用户', `${u.name}（${u.u}）`, on ? '账号已启用' : '账号已停用', on ? undefined : 'warn')
  toast(on ? '已启用 ' + u.name : '已停用 ' + u.name, on ? {} : { type: 'warn' })
}
const rp = reactive({ open: false, name: '', u: '', pwd: '' })
async function resetPwd(u: UserRow) {
  if (!(await confirmDlg({ title: '重置 ' + u.name + ' 的密码？', msg: '将生成一个临时密码，原密码立即失效；对方登录后会被提醒修改密码。', ok: '重置' }))) return
  const p = tempPwd()
  await access.setPwd(u.id, p, true)
  audit('重置密码', `${u.name}（${u.u}）`, '已生成临时密码', 'warn')
  Object.assign(rp, { open: true, name: u.name, u: u.u, pwd: p })
}
async function remove(u: UserRow) {
  if (u.id === session.uid) { toast('不能删除当前登录的账号', { type: 'warn' }); return }
  if (access.roleMap[u.role]?.all && u.on && access.activeAdmins <= 1) { toast('至少需要保留一名启用中的系统管理员', { type: 'warn' }); return }
  if (!(await confirmDlg({ title: '删除用户 ' + u.name + '？', msg: '删除后不可恢复，历史操作日志仍会保留。若只是暂时不用，建议改为停用。', ok: '删除', danger: true }))) return
  access.removeUser(u.id)
  audit('删除用户', `${u.name}（${u.u}）`, '账号已删除', 'warn')
  toast('已删除 ' + u.name)
}

const columns = [
  { title: '用户', key: 'user', width: 220 },
  { title: '角色', key: 'role', width: 130 },
  { title: '部门', dataIndex: 'dept', key: 'dept', width: 130 },
  { title: '联系电话', key: 'phone', width: 150 },
  { title: '最近登录', key: 'last', width: 120 },
  { title: '状态', key: 'on', width: 110 },
  { title: '操作', key: 'act', width: 230, fixed: 'right' as const },
]
</script>

<template>
  <PageHead title="用户管理" desc="管理平台账号、所属角色与登录状态；角色可访问的页面和操作在「角色权限」中配置">
    <a-button type="primary" :disabled="!mayEdit" :title="dis" @click="openAdd"><AppIcon name="plus" />新增用户</a-button>
  </PageHead>
  <div v-if="!mayEdit" class="callout info"><AppIcon name="lock" /><span>当前角色只有查看权限，如需调整请联系系统管理员。</span></div>

  <div class="grid g4" style="margin-bottom:16px">
    <div class="card kpi u-kpi"><div class="k">账号总数</div><div class="v">{{ kpi.all }}</div></div>
    <div class="card kpi u-kpi"><div class="k">启用中</div><div class="v" style="color:var(--good)">{{ kpi.on }}</div></div>
    <div class="card kpi u-kpi"><div class="k">已停用</div><div class="v" style="color:var(--faint)">{{ kpi.off }}</div></div>
    <div class="card kpi u-kpi"><div class="k">待修改临时密码</div><div class="v" style="color:var(--warn)">{{ kpi.tmp }}</div></div>
  </div>

  <div class="card">
    <div class="toolbar">
      <a-input v-model:value="st.q" class="grow" allow-clear placeholder="搜索姓名、账号、部门、邮箱" aria-label="搜索用户"><template #prefix><AppIcon name="search" /></template></a-input>
      <a-select v-model:value="st.role" style="width:150px" aria-label="按角色筛选" :options="[{ value: 'all', label: '全部角色' }, ...roleOpts]" />
      <div class="chips"><button v-for="c in [['all', '全部'], ['on', '启用'], ['off', '停用']]" :key="c[0]" type="button" class="chip" :aria-pressed="st.s === c[0]" @click="st.s = c[0]">{{ c[1] }}</button></div>
    </div>
    <a-table row-key="id" :columns="columns" :data-source="rows" :scroll="{ x: 1100 }" :pagination="{ pageSize: 10, hideOnSinglePage: true, showTotal: (n: number) => `共 ${n} 个账号` }">
      <template #bodyCell="{ column, record }">
        <div v-if="column.key === 'user'" class="u-cell">
          <span class="u-av" :class="{ off: !record.on }">{{ record.name.slice(0, 1) }}</span>
          <div class="cell-main"><span>{{ record.name }}<em v-if="record.id === session.uid" class="u-me">当前</em></span><small class="mono">{{ record.u }} · {{ record.email || '—' }}</small></div>
        </div>
        <StatusBadge v-else-if="column.key === 'role'" :kind="access.roleMap[record.role]?.all ? 'info' : ''" :text="roleName(record.role)" />
        <span v-else-if="column.key === 'phone'" class="mono muted">{{ record.phone || '—' }}</span>
        <span v-else-if="column.key === 'last'" class="muted">{{ record.last }}</span>
        <div v-else-if="column.key === 'on'" class="row" style="gap:8px">
          <a-switch size="small" :checked="record.on" :disabled="!mayEdit || record.id === session.uid" :aria-label="'启用 ' + record.name" @change="(v: boolean) => toggle(record as UserRow, v)" />
          <span :class="record.on ? '' : 'muted'">{{ record.on ? '启用' : '停用' }}</span>
          <a-tooltip v-if="record.mustReset" title="使用临时密码，尚未修改"><AppIcon name="clock" size="sm" style="color:var(--warn)" /></a-tooltip>
        </div>
        <div v-else-if="column.key === 'act'" class="row" style="gap:2px">
          <a-button size="small" type="text" :disabled="!mayEdit" :title="dis" @click="openEdit(record as UserRow)"><AppIcon name="pencil" size="sm" />编辑</a-button>
          <a-button size="small" type="text" :disabled="!mayEdit" :title="dis" @click="resetPwd(record as UserRow)"><AppIcon name="lock" size="sm" />重置密码</a-button>
          <a-button size="small" type="text" danger :disabled="!mayEdit || record.id === session.uid" :title="dis" @click="remove(record as UserRow)"><AppIcon name="trash" size="sm" />删除</a-button>
        </div>
      </template>
      <template #emptyText><EmptyState icon="users" title="没有匹配的用户" desc="调整搜索词或筛选条件后再试" /></template>
    </a-table>
  </div>

  <a-modal v-model:open="md.open" :title="md.f.id ? '编辑用户' : '新增用户'" :ok-text="md.f.id ? '保存' : '创建'" cancel-text="取消" :confirm-loading="md.busy" width="560px" @ok="save">
    <a-form layout="vertical" class="u-form">
      <div class="u-grid">
        <a-form-item label="登录账号" required :validate-status="md.touched && errs.u ? 'error' : ''" :help="md.touched && errs.u ? errs.u : (md.f.id ? '账号创建后不可修改' : undefined)">
          <a-input v-model:value="md.f.u" class="mono" :disabled="!!md.f.id" placeholder="如 wangfang" autocomplete="off" />
        </a-form-item>
        <a-form-item label="姓名" required :validate-status="md.touched && errs.name ? 'error' : ''" :help="md.touched && errs.name ? errs.name : undefined"><a-input v-model:value="md.f.name" placeholder="真实姓名" /></a-form-item>
        <a-form-item label="角色" required :validate-status="md.touched && errs.role ? 'error' : ''" :help="selfDemote ? '注意：你正在取消自己的管理员角色' : (md.touched && errs.role ? errs.role : undefined)">
          <a-select v-model:value="md.f.role" :options="roleOpts" />
        </a-form-item>
        <a-form-item label="部门"><a-input v-model:value="md.f.dept" placeholder="如 采集一组" /></a-form-item>
        <a-form-item label="联系电话" :validate-status="md.touched && errs.phone ? 'error' : ''" :help="md.touched && errs.phone ? errs.phone : undefined"><a-input v-model:value="md.f.phone" class="mono" /></a-form-item>
        <a-form-item label="邮箱" :validate-status="md.touched && errs.email ? 'error' : ''" :help="md.touched && errs.email ? errs.email : undefined"><a-input v-model:value="md.f.email" class="mono" /></a-form-item>
      </div>
      <a-form-item v-if="!md.f.id" label="初始密码" required :validate-status="md.touched && errs.pwd ? 'error' : ''" :help="md.touched && errs.pwd ? errs.pwd : '已随机生成，可修改；请通过安全渠道告知对方，首次登录后会提示修改'">
        <div class="row"><a-input v-model:value="md.f.pwd" class="mono grow" autocomplete="new-password" /><a-button @click="md.f.pwd = tempPwd()"><AppIcon name="refresh" size="sm" />重新生成</a-button><a-button @click="copy(md.f.pwd)"><AppIcon name="copy" size="sm" /></a-button></div>
      </a-form-item>
      <p v-if="md.f.role && access.roleMap[md.f.role]" class="u-hint"><AppIcon name="shield" size="sm" />{{ access.roleMap[md.f.role].name }}：{{ access.roleMap[md.f.role].desc || '自定义角色' }}</p>
    </a-form>
  </a-modal>

  <a-modal v-model:open="rp.open" title="临时密码已生成" ok-text="我已记下" :cancel-button-props="{ style: { display: 'none' } }" width="440px" @ok="rp.open = false">
    <p class="muted" style="margin:8px 0 14px">{{ rp.name }}（<span class="mono">{{ rp.u }}</span>）的临时密码如下，关闭后将不再显示：</p>
    <div class="row"><code class="u-pwd grow">{{ rp.pwd }}</code><a-button @click="copy(rp.pwd)"><AppIcon name="copy" size="sm" />复制</a-button></div>
  </a-modal>
</template>

<style scoped>
.u-kpi { cursor: default; }
.u-cell { display: flex; align-items: center; gap: 10px; }
.u-av { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 600; color: var(--on-accent); background: linear-gradient(135deg, #2ED3E6, #3B8BFF); }
.u-av.off { background: var(--surface-3); color: var(--faint); }
.u-me { font-style: normal; margin-left: 6px; padding: 0 6px; border-radius: 3px; font-size: 11px; background: var(--accent-soft); color: var(--accent-text); }
.u-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 16px; }
.u-form { margin-top: 12px; }
.u-hint { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--muted); font-size: 12.5px; }
.u-pwd { padding: 9px 12px; border-radius: 4px; border: 1px dashed rgba(46,211,230,.45); background: var(--well, rgba(12,27,45,.55)); font: 600 16px var(--mono, monospace); letter-spacing: 2px; color: var(--accent-text); }
</style>
