<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import { NO_PERM } from '@/constants'
import { useAccess, tempPwd, type UserRow } from '@/stores/access'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'

const access = useAccess()
const session = useSession()
const mayEdit = computed(() => session.can('users'))
const dis = computed(() => (mayEdit.value ? undefined : NO_PERM))

/* 筛选与服务端分页 */
const st = reactive({ q: '', role: 'all', s: 'all', page: 1 })
const roleOpts = computed(() => access.roles.map((r) => ({ value: r.key, label: r.name })))
const roleName = (k: string) => access.roleMap[k]?.name ?? '未分配'

async function loadUsers() {
  const roleObj = st.role !== 'all' ? access.roleMap[st.role] : undefined
  try {
    await access.fetchUsers({
      page: st.page,
      size: 10,
      keyword: st.q.trim() || undefined,
      role_id: roleObj?.id,
      is_active: st.s === 'all' ? undefined : st.s === 'on',
    })
  } catch (err: any) {
    toast('加载用户列表失败：' + (err?.message || '网络异常'), { type: 'crit' })
  }
}

let searchTimer: number | undefined
watch(
  () => st.q,
  () => {
    st.page = 1
    clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => loadUsers(), 250)
  }
)
watch(
  () => [st.role, st.s],
  () => {
    st.page = 1
    loadUsers()
  }
)
onBeforeUnmount(() => clearTimeout(searchTimer))

onMounted(async () => {
  await Promise.allSettled([access.fetchRoles(), loadUsers()])
})

/* 新增 / 编辑 */
const ACC_RE = /^[a-z][a-z0-9_.-]{2,23}$/
const defaultRoleKey = () => access.roles.find((r) => !r.all)?.key ?? access.roles[0]?.key ?? ''
const blank = () => ({ id: '', u: '', name: '', role: defaultRoleKey(), dept: '', phone: '', email: '', pwd: tempPwd() })
const md = reactive({ open: false, busy: false, f: blank(), touched: false })
const errs = computed(() => {
  const f = md.f, e: Record<string, string> = {}
  if (!md.f.id) {
    if (!ACC_RE.test(f.u)) e.u = '3–24 位，小写字母开头，可含数字、下划线、点、横线'
    else if (access.byAccount(f.u)) e.u = '该账号已存在'
    if (f.pwd && f.pwd.length < 8) e.pwd = '初始密码至少 8 位'
  }
  if (!f.name.trim()) e.name = '请输入姓名'
  if (!access.roleMap[f.role]) e.role = '请选择角色'
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) e.email = '邮箱格式不正确'
  if (f.phone && !/^[\d\s+-]{6,20}$/.test(f.phone)) e.phone = '电话格式不正确'
  return e
})
function openAdd() {
  Object.assign(md, { open: true, busy: false, touched: false, f: blank() })
}
async function openEdit(u: UserRow) {
  Object.assign(md, {
    open: true,
    busy: true,
    touched: false,
    f: { id: u.id, u: u.u, name: u.name, role: u.role, dept: u.dept, phone: u.phone, email: u.email, pwd: '' },
  })
  try {
    const fresh = await access.fetchUserDetail(u.numericId)
    Object.assign(md.f, {
      name: fresh.name,
      role: fresh.role,
      dept: fresh.dept,
      phone: fresh.phone,
      email: fresh.email,
    })
  } catch {
    /* 使用列表当前记录展示 */
  } finally {
    md.busy = false
  }
}
const selfDemote = computed(() => md.f.id === session.uid && !access.roleMap[md.f.role]?.all && session.isAdmin)

const rp = reactive({ open: false, name: '', u: '', pwd: '', hours: 0, title: '临时密码已生成' })

async function save() {
  md.touched = true
  if (Object.keys(errs.value).length) return
  const f = md.f
  const d = { name: f.name.trim(), role: f.role, dept: f.dept.trim(), phone: f.phone.trim(), email: f.email.trim() }
  md.busy = true
  try {
    if (f.id) {
      const old = access.byId(f.id)!
      if (access.roleMap[old.role]?.all && !access.roleMap[f.role]?.all && old.on && access.activeAdmins <= 1) {
        toast('至少需要保留一名启用中的系统管理员', { type: 'warn' })
        return
      }
      if (selfDemote.value && !(await confirmDlg({ title: '调整自己的角色？', msg: '保存后你将失去系统管理员权限，可能无法再进入本页面。', ok: '仍要保存', danger: true }))) return
      await access.updateUser(f.id, d)
      if (f.id === session.uid) {
        await session.fetchMe()
      }
      toast('已保存 ' + d.name)
      md.open = false
      await loadUsers()
    } else {
      const { user, initialPassword } = await access.addUser({ ...d, u: f.u.trim() }, f.pwd)
      toast('已创建账号 ' + user.u + '，首次登录后请提醒其修改密码')
      md.open = false
      if (initialPassword) {
        Object.assign(rp, {
          open: true,
          title: '账号已创建，请记下初始密码',
          name: user.name,
          u: user.u,
          pwd: initialPassword,
          hours: 0,
        })
      }
      st.page = 1
      await loadUsers()
    }
  } catch (err: any) {
    toast('保存失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    md.busy = false
  }
}
function copy(t: string) {
  navigator.clipboard?.writeText(t).then(
    () => toast('已复制'),
    () => toast('复制失败，请手动选择复制', { type: 'warn' })
  )
}

/* 启停 / 重置密码 / 删除 */
async function toggle(u: UserRow, on: boolean) {
  if (u.id === session.uid) { toast('不能停用当前登录的账号', { type: 'warn' }); return }
  if (!on && access.roleMap[u.role]?.all && access.activeAdmins <= 1) { toast('至少需要保留一名启用中的系统管理员', { type: 'warn' }); return }
  if (!on && !(await confirmDlg({ title: '停用 ' + u.name + '？', msg: '停用后该账号将无法登录，已登录的会话会立即失效。', ok: '停用', danger: true }))) return
  try {
    await access.setOn(u.id, on)
    toast(on ? '已启用 ' + u.name : '已停用 ' + u.name, on ? {} : { type: 'warn' })
  } catch (err: any) {
    toast('状态调整失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  }
}

async function resetPwd(u: UserRow) {
  if (!(await confirmDlg({ title: '重置 ' + u.name + ' 的密码？', msg: '将生成一个临时密码，原密码立即失效；对方登录后会被提醒修改密码。', ok: '重置' }))) return
  try {
    const res = await access.resetUserPassword(u.id)
    Object.assign(rp, {
      open: true,
      title: '临时密码已生成',
      name: u.name,
      u: u.u,
      pwd: res.temp_password,
      hours: res.expires_in_hours || 0,
    })
  } catch (err: any) {
    toast('重置密码失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  }
}

async function remove(u: UserRow) {
  if (u.id === session.uid) { toast('不能删除当前登录的账号', { type: 'warn' }); return }
  if (access.roleMap[u.role]?.all && u.on && access.activeAdmins <= 1) { toast('至少需要保留一名启用中的系统管理员', { type: 'warn' }); return }
  if (!(await confirmDlg({ title: '删除用户 ' + u.name + '？', msg: '删除后不可恢复，历史操作日志仍会保留。若只是暂时不用，建议改为停用。', ok: '删除', danger: true }))) return
  try {
    await access.removeUser(u.id)
    toast('已删除 ' + u.name)
    if (access.users.length === 0 && st.page > 1) st.page -= 1
    await loadUsers()
  } catch (err: any) {
    toast('删除失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  }
}

const columns = [
  { title: '用户', key: 'user', width: 130, ellipsis: true, align: 'center' as const },
  { title: '账号', key: 'account', width: 120, ellipsis: true, align: 'center' as const },
  { title: '角色', key: 'role', width: 120, ellipsis: true, align: 'center' as const },
  { title: '部门', key: 'dept', width: 110, ellipsis: true, align: 'center' as const },
  { title: '联系电话', key: 'phone', width: 130, ellipsis: true, align: 'center' as const },
  { title: '邮箱', key: 'email', width: 170, ellipsis: true, align: 'center' as const },
  { title: '最近登录', key: 'last', width: 145, ellipsis: true, align: 'center' as const },
  { title: '状态', key: 'on', width: 115, align: 'center' as const },
  { title: '操作', key: 'act', width: 170, align: 'center' as const },
]
</script>

<template>
  <PageHead title="用户管理" desc="管理平台账号、所属角色与登录状态；角色可访问的页面和操作在「角色权限」中配置">
    <a-button type="primary" :disabled="!mayEdit" :title="dis" @click="openAdd"><AppIcon name="plus" />新增用户</a-button>
  </PageHead>
  <div v-if="!mayEdit" class="callout info"><AppIcon name="lock" /><span>当前角色只有查看权限，如需调整请联系系统管理员。</span></div>

  <div class="card">
    <div class="toolbar">
      <a-input v-model:value="st.q" class="grow" allow-clear placeholder="搜索姓名、账号、部门、邮箱" aria-label="搜索用户"><template #prefix><AppIcon name="search" /></template></a-input>
      <a-select v-model:value="st.role" style="width:150px" aria-label="按角色筛选" :options="[{ value: 'all', label: '全部角色' }, ...roleOpts]" />
      <a-select
        v-model:value="st.s"
        style="width:130px"
        aria-label="按状态筛选"
        :options="[
          { value: 'all', label: '全部状态' },
          { value: 'on', label: '启用' },
          { value: 'off', label: '停用' },
        ]"
      />
    </div>
    <a-table
      row-key="id"
      size="middle"
      :columns="columns"
      :data-source="access.users"
      :loading="access.loadingUsers"
      :scroll="{ x: 1120 }"
      :pagination="{
        current: st.page,
        pageSize: 10,
        total: access.userTotal,
        showSizeChanger: false,
        hideOnSinglePage: false,
        showTotal: (n: number) => `共 ${n} 个账号`,
        onChange: (p: number) => { st.page = p; loadUsers() },
      }"
    >
      <template #bodyCell="{ column, record }">
        <span v-if="column.key === 'user'" class="u-name" :title="record.name">
          <span class="cell-ellipsis">{{ record.name }}</span><em v-if="record.id === session.uid" class="u-me">当前</em>
        </span>
        <span v-else-if="column.key === 'account'" class="mono cell-ellipsis" :title="record.u">{{ record.u }}</span>
        <StatusBadge v-else-if="column.key === 'role'" :kind="access.roleMap[record.role]?.all ? 'info' : ''" :text="roleName(record.role)" />
        <span v-else-if="column.key === 'dept'" class="muted cell-ellipsis" :title="record.dept || ''">{{ record.dept || '—' }}</span>
        <span v-else-if="column.key === 'phone'" class="mono muted cell-ellipsis" :title="record.phone || ''">{{ record.phone || '—' }}</span>
        <span v-else-if="column.key === 'email'" class="mono muted cell-ellipsis" :title="record.email || ''">{{ record.email || '—' }}</span>
        <span v-else-if="column.key === 'last'" class="muted cell-ellipsis" :title="record.last || ''">{{ record.last || '—' }}</span>
        <div v-else-if="column.key === 'on'" class="u-status-cell">
          <a-switch size="small" :checked="record.on" :disabled="!mayEdit || record.id === session.uid" :aria-label="'启用 ' + record.name" @change="(v: boolean) => toggle(record as UserRow, v)" />
          <span :class="record.on ? '' : 'muted'">{{ record.on ? '启用' : '停用' }}</span>
          <span class="u-status-flag">
            <a-tooltip v-if="record.mustReset" title="尚未修改初始密码"><AppIcon name="clock" size="sm" style="color:var(--warn)" /></a-tooltip>
          </span>
        </div>
        <div v-else-if="column.key === 'act'" class="act-links">
          <a-button size="small" type="link" :disabled="!mayEdit" :title="dis" @click="openEdit(record as UserRow)">编辑</a-button>
          <a-button size="small" type="link" :disabled="!mayEdit" :title="dis" @click="resetPwd(record as UserRow)">重置密码</a-button>
          <a-button size="small" type="link" danger :disabled="!mayEdit || record.id === session.uid" :title="dis" @click="remove(record as UserRow)">删除</a-button>
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
      <a-form-item v-if="!md.f.id" label="初始密码" :validate-status="md.touched && errs.pwd ? 'error' : ''" :help="md.touched && errs.pwd ? errs.pwd : '留空将由后端生成初始密码；请通过安全渠道告知对方'">
        <div class="row"><a-input v-model:value="md.f.pwd" class="mono grow" autocomplete="new-password" /><a-button @click="md.f.pwd = tempPwd()"><AppIcon name="refresh" size="sm" />重新生成</a-button><a-button @click="copy(md.f.pwd)"><AppIcon name="copy" size="sm" /></a-button></div>
      </a-form-item>
      <p v-if="md.f.role && access.roleMap[md.f.role]" class="u-hint"><AppIcon name="shield" size="sm" />{{ access.roleMap[md.f.role].name }}：{{ access.roleMap[md.f.role].desc || '未设置角色说明' }}</p>
    </a-form>
  </a-modal>

  <a-modal v-model:open="rp.open" :title="rp.title" ok-text="我已记下" :cancel-button-props="{ style: { display: 'none' } }" width="440px" @ok="rp.open = false">
    <p class="muted" style="margin:8px 0 14px">
      {{ rp.name }}（<span class="mono">{{ rp.u }}</span>）的{{ rp.hours ? '临时密码' : '初始密码' }}如下<template v-if="rp.hours">（{{ rp.hours }} 小时内有效）</template>，关闭后将不再显示：
    </p>
    <div class="row"><code class="u-pwd grow">{{ rp.pwd }}</code><a-button @click="copy(rp.pwd)"><AppIcon name="copy" size="sm" />复制</a-button></div>
  </a-modal>
</template>

<style scoped>
.u-name { display: inline-flex; align-items: center; justify-content: center; max-width: 100%; }
.u-me { flex: none; font-style: normal; margin-left: 6px; padding: 0 6px; border-radius: 3px; font-size: 11px; background: var(--accent-soft); color: var(--accent-text); }
.u-status-cell { display: inline-flex; align-items: center; justify-content: center; gap: 8px; white-space: nowrap; }
.u-status-flag { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; flex: none; }
.u-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 16px; }
.u-form { margin-top: 12px; }
.u-hint { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--muted); font-size: 12.5px; }
.u-pwd { padding: 9px 12px; border-radius: 4px; border: 1px dashed rgba(46,211,230,.45); background: var(--well, rgba(12,27,45,.55)); font: 600 16px var(--mono, monospace); letter-spacing: 2px; color: var(--accent-text); }
</style>
