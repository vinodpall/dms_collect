<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import SaveBar from '@/components/SaveBar.vue'
import { ACTIONS, NAV_GROUPS, NO_PERM, PAGE_META, type PageKey } from '@/constants'
import { useAccess } from '@/stores/access'
import { useSession } from '@/stores/session'
import { useLogs } from '@/stores/logs'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'

const access = useAccess()
const session = useSession()
const logs = useLogs()
const router = useRouter()
const mayEdit = computed(() => session.can('roles'))
const dis = computed(() => (mayEdit.value ? undefined : NO_PERM))
const audit = (action: string, target: string, summary: string, status?: 'warn') =>
  logs.addLog({ user: session.info.user, role: session.info.name, module: 'system', moduleName: '角色权限', action, target, summary, status })

const cur = ref(access.roles[0]?.key ?? 'admin')
const role = computed(() => access.roleMap[cur.value])
const locked = computed(() => !mayEdit.value || !!role.value?.all)
const members = computed(() => access.users.filter((u) => u.role === cur.value))

/* 编辑草稿 */
const draft = reactive<{ name: string; desc: string; pages: PageKey[]; can: Record<string, 1> }>({ name: '', desc: '', pages: [], can: {} })
function load() {
  const r = role.value
  if (!r) return
  Object.assign(draft, { name: r.name, desc: r.desc, pages: [...r.pages], can: { ...r.can } })
}
watch(cur, load, { immediate: true })
const snap = (x: { name: string; desc: string; pages: PageKey[]; can: Record<string, 1> }) =>
  JSON.stringify([x.name, x.desc, [...x.pages].sort(), Object.keys(x.can).filter((k) => x.can[k]).sort()])
const dirty = computed(() => !!role.value && snap(draft) !== snap(role.value))
async function pick(k: string) {
  if (k === cur.value) return
  if (dirty.value && !(await confirmDlg({ title: '放弃未保存的修改？', msg: '「' + role.value.name + '」的权限修改尚未保存。', ok: '放弃修改', danger: true }))) return
  cur.value = k
}

const hasPage = (p: PageKey) => !!role.value?.all || draft.pages.includes(p)
const hasAct = (k: string) => !!role.value?.all || !!draft.can[k]
function setPage(p: PageKey, on: boolean) {
  if (on) { if (!draft.pages.includes(p)) draft.pages.push(p) }
  else {
    draft.pages = draft.pages.filter((x) => x !== p)
    ACTIONS.filter((a) => a.page === p).forEach((a) => { delete draft.can[a.key] })
  }
}
function setAct(k: string, on: boolean) { if (on) draft.can[k] = 1; else delete draft.can[k] }
function setGroup(items: PageKey[], on: boolean) { items.forEach((p) => setPage(p, on)) }
const groupState = (items: PageKey[]) => { const n = items.filter(hasPage).length; return { all: n === items.length, some: n > 0 && n < items.length } }
const actsOf = (p: PageKey) => ACTIONS.filter((a) => a.page === p)
const pageCount = (r: { all?: boolean; pages: PageKey[] }) => (r.all ? Object.keys(PAGE_META).length : r.pages.length)
const actCount = (r: { all?: boolean; can: Record<string, 1> }) => (r.all ? ACTIONS.length : ACTIONS.filter((a) => r.can[a.key]).length)

async function save() {
  const r = role.value
  if (!r) return
  if (!draft.name.trim()) { toast('请填写角色名称', { type: 'warn' }); return }
  if (access.roles.some((x) => x.key !== r.key && x.name === draft.name.trim())) { toast('已存在同名角色', { type: 'warn' }); return }
  if (!r.all && !draft.pages.length) { toast('至少需要勾选一个可访问页面', { type: 'warn' }); return }
  const p0 = pageCount(r), a0 = actCount(r)
  access.updateRole(r.key, { name: draft.name.trim(), desc: draft.desc.trim(), pages: [...draft.pages], can: { ...draft.can } })
  audit('修改角色权限', r.name, `页面 ${p0} → ${pageCount(r)} 个，操作权限 ${a0} → ${actCount(r)} 项；影响 ${members.value.length} 个账号`)
  toast('「' + r.name + '」的权限已保存，立即对 ' + members.value.length + ' 个账号生效')
}

/* 新增 / 删除角色 */
const md = reactive({ open: false, name: '', desc: '', from: '', touched: false })
const nameErr = computed(() => (!md.name.trim() ? '请输入角色名称' : access.roles.some((r) => r.name === md.name.trim()) ? '已存在同名角色' : ''))
function openAdd() { Object.assign(md, { open: true, name: '', desc: '', from: '', touched: false }) }
async function addRole() {
  md.touched = true
  if (nameErr.value) return
  if (dirty.value && !(await confirmDlg({ title: '放弃未保存的修改？', msg: '「' + role.value.name + '」的权限修改尚未保存。', ok: '放弃修改', danger: true }))) return
  const k = access.addRole({ name: md.name.trim(), desc: md.desc.trim(), from: md.from || undefined })
  audit('新增角色', md.name.trim(), md.from ? '复制自「' + access.roleMap[md.from].name + '」' : '空白角色')
  md.open = false; cur.value = k
  toast('已创建角色，请勾选它可以访问的页面和操作')
}
async function delRole() {
  const r = role.value
  if (!r || r.builtin) return
  if (members.value.length) { toast('仍有 ' + members.value.length + ' 个账号属于该角色，请先在用户管理中调整', { type: 'warn' }); return }
  if (!(await confirmDlg({ title: '删除角色「' + r.name + '」？', msg: '删除后不可恢复。', ok: '删除', danger: true }))) return
  access.removeRole(r.key)
  audit('删除角色', r.name, '角色已删除', 'warn')
  cur.value = access.roles[0].key
  toast('已删除角色')
}
</script>

<template>
  <PageHead title="角色权限" desc="为每个角色配置可访问的页面与可执行的操作，保存后对该角色下的所有账号立即生效">
    <a-button :disabled="!session.allowed('users')" @click="router.push({ name: 'users' })"><AppIcon name="users" />用户管理</a-button>
    <a-button type="primary" :disabled="!mayEdit" :title="dis" @click="openAdd"><AppIcon name="plus" />新增角色</a-button>
  </PageHead>
  <div v-if="!mayEdit" class="callout info" style="margin-bottom:16px"><AppIcon name="lock" /><span>当前角色只有查看权限，如需调整请联系系统管理员。</span></div>

  <div class="r-wrap">
    <div class="card r-list">
      <div class="card-head"><div><h2>角色</h2><div class="sub">{{ access.roles.length }} 个角色</div></div></div>
      <button v-for="r in access.roles" :key="r.key" type="button" class="r-item" :aria-current="r.key === cur ? 'true' : undefined" @click="pick(r.key)">
        <span class="r-av" :class="{ adm: r.all }">{{ r.init || r.name.slice(0, 1) }}</span>
        <span class="r-main"><b>{{ r.name }}<StatusBadge v-if="r.builtin" kind="" text="内置" plain /></b><small>{{ access.memberCount(r.key) }} 个账号 · {{ pageCount(r) }} 个页面 · {{ actCount(r) }} 项操作</small></span>
      </button>
    </div>

    <div v-if="role" class="r-detail">
      <div class="card">
        <div class="card-head">
          <div><h2>基本信息</h2><div class="sub">{{ role.all ? '系统管理员拥有全部权限，不可修改权限范围' : role.builtin ? '内置角色可调整权限，不可删除' : '自定义角色' }}</div></div>
          <a-button v-if="!role.builtin" danger :disabled="!mayEdit" :title="dis" @click="delRole"><AppIcon name="trash" size="sm" />删除角色</a-button>
        </div>
        <div class="card-body r-basic">
          <label>角色名称<a-input v-model:value="draft.name" :disabled="!mayEdit" :maxlength="20" /></label>
          <label>角色说明<a-input v-model:value="draft.desc" :disabled="!mayEdit" :maxlength="60" placeholder="简要说明该角色的职责" /></label>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>页面与操作权限</h2><div class="sub">未勾选页面时，该页面不会出现在菜单中；操作权限需先开放对应页面</div></div></div>
        <div class="r-matrix">
          <div v-for="g in NAV_GROUPS" :key="g.g" class="r-group">
            <div class="r-gh"><a-checkbox :checked="groupState(g.items).all" :indeterminate="groupState(g.items).some" :disabled="locked" @change="(e: any) => setGroup(g.items, e.target.checked)">{{ g.g }}</a-checkbox></div>
            <div v-for="p in g.items" :key="p" class="r-row" :class="{ off: !hasPage(p) }">
              <a-checkbox :checked="hasPage(p)" :disabled="locked" @change="(e: any) => setPage(p, e.target.checked)"><AppIcon :name="PAGE_META[p].icon" size="sm" />{{ PAGE_META[p].title }}</a-checkbox>
              <div class="r-acts">
                <template v-if="actsOf(p).length">
                  <a-checkbox v-for="a in actsOf(p)" :key="a.key" :checked="hasAct(a.key)" :disabled="locked || !hasPage(p)" @change="(e: any) => setAct(a.key, e.target.checked)">{{ a.label }}</a-checkbox>
                </template>
                <span v-else class="faint">仅查看</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>角色成员</h2><div class="sub">{{ members.length }} 个账号；调整成员请前往用户管理</div></div></div>
        <div class="card-body">
          <div v-if="members.length" class="r-mem"><span v-for="u in members" :key="u.id" class="r-chip" :class="{ off: !u.on }"><i>{{ u.name.slice(0, 1) }}</i>{{ u.name }}<small class="mono">{{ u.u }}</small><em v-if="!u.on">已停用</em></span></div>
          <p v-else class="muted" style="margin:0">暂无账号属于该角色</p>
        </div>
      </div>
    </div>
  </div>
  <SaveBar v-if="dirty && mayEdit" :msg="'「' + role.name + '」有未保存的权限修改'" @save="save" @reset="load" />

  <a-modal v-model:open="md.open" title="新增角色" ok-text="创建" cancel-text="取消" width="460px" @ok="addRole">
    <a-form layout="vertical" style="margin-top:12px">
      <a-form-item label="角色名称" required :validate-status="md.touched && nameErr ? 'error' : ''" :help="md.touched && nameErr ? nameErr : undefined"><a-input v-model:value="md.name" :maxlength="20" placeholder="如 数据分析员" /></a-form-item>
      <a-form-item label="角色说明"><a-input v-model:value="md.desc" :maxlength="60" /></a-form-item>
      <a-form-item label="复制权限自" extra="可选；不复制则只开放数据看板，用户与权限相关权限不会被复制">
        <a-select v-model:value="md.from" :options="[{ value: '', label: '不复制（空白角色）' }, ...access.roles.filter((r) => !r.all).map((r) => ({ value: r.key, label: r.name }))]" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style scoped>
.r-wrap { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start; }
.r-list { padding-bottom: 8px; position: sticky; top: 0; }
.r-item { display: flex; align-items: center; gap: 12px; width: calc(100% - 16px); margin: 2px 8px; padding: 10px 12px; border: 1px solid transparent; border-radius: 4px; background: none; color: var(--text); text-align: left; cursor: pointer; }
.r-item:hover { background: rgba(46,211,230,.06); }
.r-item[aria-current] { background: rgba(38,198,218,.14); border-color: rgba(46,211,230,.45); }
.r-av { flex: none; width: 34px; height: 34px; border-radius: 4px; display: grid; place-items: center; font-weight: 600; color: var(--accent-text); background: rgba(46,211,230,.12); border: 1px solid rgba(46,211,230,.3); }
.r-av.adm { color: var(--on-accent); background: linear-gradient(135deg, #2ED3E6, #3B8BFF); border: 0; }
.r-main { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.r-main b { font-weight: 600; display: flex; align-items: center; gap: 6px; }
.r-main small { color: var(--muted); font-size: 12px; }
.r-detail { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.r-basic { display: grid; grid-template-columns: 1fr 2fr; gap: 16px; }
.r-basic label { display: flex; flex-direction: column; gap: 6px; color: var(--muted); font-size: 13px; }
.r-matrix { padding: 0 20px 12px; }
.r-group + .r-group { margin-top: 6px; }
.r-gh { padding: 10px 0 8px; border-bottom: 1px solid var(--line); font-weight: 600; }
.r-gh :deep(.ant-checkbox-wrapper) { color: var(--accent-text); font-weight: 600; }
.r-row { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 12px; align-items: center; padding: 9px 0 9px 22px; border-bottom: 1px dashed var(--row-line, rgba(43,74,109,.75)); }
.r-row :deep(.ant-checkbox-wrapper) { align-items: center; }
.r-row > :deep(.ant-checkbox-wrapper span:last-child) { display: inline-flex; align-items: center; gap: 6px; }
.r-row.off > :deep(.ant-checkbox-wrapper) { color: var(--muted); }
.r-acts { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; }
.faint { color: var(--faint); font-size: 12.5px; }
.r-mem { display: flex; flex-wrap: wrap; gap: 8px; }
.r-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 4px; border-radius: 16px; border: 1px solid var(--line); background: rgba(13,28,49,.5); font-size: 13px; }
.r-chip i { font-style: normal; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; color: var(--on-accent); background: linear-gradient(135deg, #2ED3E6, #3B8BFF); }
.r-chip small { color: var(--faint); }
.r-chip em { font-style: normal; font-size: 11px; color: var(--faint); }
.r-chip.off { opacity: .6; }
@media (max-width: 1100px) { .r-wrap { grid-template-columns: 1fr; } .r-list { position: static; } }
</style>
