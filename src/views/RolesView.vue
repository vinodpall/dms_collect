<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import SaveBar from '@/components/SaveBar.vue'
import EmptyState from '@/components/EmptyState.vue'
import { NAV_GROUPS, NO_PERM, PAGE_META, type PageKey } from '@/constants'
import { useAccess } from '@/stores/access'
import { useSession } from '@/stores/session'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'

const access = useAccess()
const session = useSession()
const mayEdit = computed(() => session.can('roles'))
const dis = computed(() => (mayEdit.value ? undefined : NO_PERM))

const cur = ref(access.roles[0]?.key ?? '')
const role = computed(() => access.roleMap[cur.value])
const locked = computed(() => !mayEdit.value || !!role.value?.all)
const savingPerms = ref(false)

/* 权限草稿（仅跟踪页面与操作勾选） */
const draft = reactive<{ pages: PageKey[]; can: Record<string, 1> }>({ pages: [], can: {} })
const baseSnap = ref('')
const snap = (x: { pages: PageKey[]; can: Record<string, 1> }) =>
  JSON.stringify([[...x.pages].sort(), Object.keys(x.can).filter((k) => x.can[k]).sort()])

function load() {
  const r = role.value
  if (!r) {
    draft.pages = []
    draft.can = {}
    baseSnap.value = ''
    return
  }
  draft.pages = [...r.pages]
  draft.can = { ...r.can }
  baseSnap.value = snap(r)
}
watch(
  () => access.roles,
  (list) => {
    if (list.length && !access.roleMap[cur.value]) {
      cur.value = list[0].key
    }
  },
  { immediate: true }
)
watch(
  () => [cur.value, role.value ? snap(role.value) : ''] as const,
  ([nextCur, nextBase], prev) => {
    const prevCur = prev?.[0]
    if (nextCur !== prevCur || snap(draft) === baseSnap.value) {
      load()
    }
    baseSnap.value = nextBase
    // 列表加载时已通过并发拉取获取权限详情；仅在该角色详情缺失时补拉，避免点击切换重复请求
    if (nextCur && nextCur !== prevCur && role.value?.id && !role.value.detailLoaded) {
      access.fetchRoleDetail(role.value.id).catch(() => {})
    }
  },
  { immediate: true }
)

const dirty = computed(() => !!role.value && !role.value.all && snap(draft) !== snap(role.value))

async function pick(k: string) {
  if (k === cur.value) return
  if (dirty.value && role.value && !(await confirmDlg({ title: '放弃未保存的修改？', msg: '「' + role.value.name + '」的权限修改尚未保存。', ok: '放弃修改', danger: true }))) return
  cur.value = k
}

const hasPage = (p: PageKey) => !!role.value?.all || draft.pages.includes(p)
const hasAct = (k: string) => !!role.value?.all || !!draft.can[k]
function actsOf(p: PageKey) {
  return access.actionCatalog.filter((a) => a.page === p)
}
function setPage(p: PageKey, on: boolean) {
  if (on) {
    if (!draft.pages.includes(p)) draft.pages.push(p)
  } else {
    draft.pages = draft.pages.filter((x) => x !== p)
    actsOf(p).forEach((a) => { delete draft.can[a.key] })
  }
}
function setAct(k: string, on: boolean) {
  if (on) draft.can[k] = 1
  else delete draft.can[k]
}
function setGroup(items: PageKey[], on: boolean) {
  items.forEach((p) => setPage(p, on))
}
const groupState = (items: PageKey[]) => {
  const n = items.filter(hasPage).length
  return { all: n === items.length, some: n > 0 && n < items.length }
}

async function savePerms() {
  const r = role.value
  if (!r || r.all) return
  if (!draft.pages.length) {
    toast('至少需要勾选一个可访问页面', { type: 'warn' })
    return
  }
  savingPerms.value = true
  try {
    await access.updateRole(r.key, { pages: [...draft.pages], can: { ...draft.can } })
    load()
    if (session.role === r.key) {
      await session.fetchMe()
    }
    toast('「' + r.name + '」的权限已保存并立即生效')
  } catch (err: any) {
    toast('保存权限失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    savingPerms.value = false
  }
}

/* 编辑角色名称与说明弹窗 */
const infoMd = reactive({ open: false, name: '', desc: '', touched: false, busy: false })
const infoNameErr = computed(() =>
  !infoMd.name.trim()
    ? '请输入角色名称'
    : access.roles.some((x) => x.key !== cur.value && x.name === infoMd.name.trim())
      ? '已存在同名角色'
      : ''
)
function openEditInfo() {
  const r = role.value
  if (!r) return
  Object.assign(infoMd, { open: true, name: r.name, desc: r.desc, touched: false, busy: false })
}
async function saveInfo() {
  const r = role.value
  if (!r) return
  infoMd.touched = true
  if (infoNameErr.value) return
  infoMd.busy = true
  try {
    await access.updateRole(r.key, { name: infoMd.name.trim(), desc: infoMd.desc.trim() })
    if (session.role === r.key) {
      await session.fetchMe()
    }
    infoMd.open = false
    toast('角色信息已更新')
  } catch (err: any) {
    toast('更新角色失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    infoMd.busy = false
  }
}

/* 新增 / 删除角色 */
const md = reactive({ open: false, name: '', desc: '', from: '', touched: false, busy: false })
const nameErr = computed(() =>
  !md.name.trim()
    ? '请输入角色名称'
    : access.roles.some((r) => r.name === md.name.trim())
      ? '已存在同名角色'
      : ''
)
function openAdd() {
  Object.assign(md, { open: true, name: '', desc: '', from: '', touched: false, busy: false })
}
async function addRole() {
  md.touched = true
  if (nameErr.value) return
  if (dirty.value && role.value && !(await confirmDlg({ title: '放弃未保存的修改？', msg: '「' + role.value.name + '」的权限修改尚未保存。', ok: '放弃修改', danger: true }))) return
  md.busy = true
  try {
    const k = await access.addRole({ name: md.name.trim(), desc: md.desc.trim(), from: md.from || undefined })
    md.open = false
    cur.value = k
    toast('已创建角色，请勾选它可以访问的页面和操作')
  } catch (err: any) {
    toast('创建角色失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  } finally {
    md.busy = false
  }
}
async function delRole() {
  const r = role.value
  if (!r || r.builtin) return
  const totalMembers = Math.max(r.memberCount, r.members.length)
  if (totalMembers) {
    toast('仍有 ' + totalMembers + ' 个账号属于该角色，请先在用户管理中调整', { type: 'warn' })
    return
  }
  if (!(await confirmDlg({ title: '删除角色「' + r.name + '」？', msg: '删除后不可恢复。', ok: '删除', danger: true }))) return
  try {
    await access.removeRole(r.key)
    cur.value = access.roles[0]?.key ?? ''
    toast('已删除角色')
  } catch (err: any) {
    toast('删除角色失败：' + (err?.message || '请稍后重试'), { type: 'crit' })
  }
}

onMounted(async () => {
  try {
    if (!access.roles.length || access.roles.some((r) => !r.detailLoaded)) {
      await access.fetchRoles()
    }
    if (!cur.value && access.roles.length) cur.value = access.roles[0].key
  } catch (err: any) {
    toast('加载角色列表失败：' + (err?.message || '网络异常'), { type: 'crit' })
  }
})
</script>

<template>
  <PageHead title="角色权限" desc="为每个角色配置可访问的页面与可执行的操作，保存后对该角色下的所有账号立即生效">
    <a-button type="primary" :disabled="!mayEdit" :title="dis" @click="openAdd"><AppIcon name="plus" />新增角色</a-button>
  </PageHead>
  <div v-if="!mayEdit" class="callout info" style="flex:none"><AppIcon name="lock" /><span>当前角色只有查看权限，如需调整请联系系统管理员。</span></div>

  <div v-if="access.roles.length" class="r-wrap r-page-body">
    <div class="card r-list">
      <div class="card-head r-list-head"><div><h2>角色列表</h2></div></div>
      <div class="r-list-body">
        <button
          v-for="r in access.roles"
          :key="r.key"
          type="button"
          class="r-item"
          :aria-current="r.key === cur ? 'true' : undefined"
          @click="pick(r.key)"
        >
          <div class="r-main">
            <b>{{ r.name }}<StatusBadge v-if="r.builtin" kind="" text="内置" plain /></b>
            <a-tooltip v-if="r.desc" :title="r.desc" placement="right">
              <span class="r-desc">{{ r.desc }}</span>
            </a-tooltip>
            <span v-else class="r-desc empty">暂无角色说明</span>
          </div>
        </button>
      </div>
    </div>

    <div v-if="role" class="card r-perm-card">
      <div class="card-head r-perm-head">
        <div class="r-head-left">
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <h2>{{ role.name }}</h2>
            <StatusBadge v-if="role.builtin" kind="" text="内置" plain />
          </div>
          <div class="sub">{{ role.all ? '系统管理员拥有全部权限，不可修改权限范围' : '未勾选页面时，该页面不会出现在菜单中；操作权限需先开放对应页面' }}</div>
        </div>
        <div class="r-head-right">
          <a-button size="small" :disabled="!mayEdit" :title="dis" @click="openEditInfo"><AppIcon name="pencil" size="sm" />编辑信息</a-button>
          <a-button v-if="!role.builtin" size="small" danger :disabled="!mayEdit" :title="dis" @click="delRole"><AppIcon name="trash" size="sm" />删除角色</a-button>
        </div>
      </div>

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

      <div v-if="dirty && mayEdit" class="r-save-wrap">
        <SaveBar :msg="'「' + role.name + '」有未保存的权限修改'" @save="savePerms" @reset="load" />
      </div>
    </div>
  </div>
  <div v-else class="card">
    <EmptyState icon="shield" :title="access.loadingRoles ? '正在加载角色权限…' : '暂无角色数据'" :desc="access.loadingRoles ? '正在从服务器获取角色与权限配置' : '请检查网络或新增角色'" />
  </div>

  <!-- 编辑角色名称与说明 -->
  <a-modal v-model:open="infoMd.open" title="编辑角色信息" ok-text="保存" cancel-text="取消" :confirm-loading="infoMd.busy" width="460px" centered @ok="saveInfo">
    <a-form layout="vertical" style="margin-top:12px">
      <a-form-item label="角色名称" required :validate-status="infoMd.touched && infoNameErr ? 'error' : ''" :help="infoMd.touched && infoNameErr ? infoNameErr : undefined">
        <a-input v-model:value="infoMd.name" :maxlength="20" placeholder="请输入角色名称" />
      </a-form-item>
      <a-form-item label="角色说明" style="margin-bottom:0">
        <a-textarea v-model:value="infoMd.desc" :rows="3" :maxlength="120" placeholder="简要说明该角色的职责与权限范围" />
      </a-form-item>
    </a-form>
  </a-modal>

  <!-- 新增角色 -->
  <a-modal v-model:open="md.open" title="新增角色" ok-text="创建" cancel-text="取消" :confirm-loading="md.busy" width="460px" centered @ok="addRole">
    <a-form layout="vertical" style="margin-top:12px">
      <a-form-item label="角色名称" required :validate-status="md.touched && nameErr ? 'error' : ''" :help="md.touched && nameErr ? nameErr : undefined"><a-input v-model:value="md.name" :maxlength="20" placeholder="如 数据分析员" /></a-form-item>
      <a-form-item label="角色说明"><a-textarea v-model:value="md.desc" :rows="2" :maxlength="120" placeholder="简要说明该角色的职责" /></a-form-item>
      <a-form-item label="复制权限自" extra="可选；不复制则只开放数据看板，用户与权限相关权限不会被复制" style="margin-bottom:0">
        <a-select v-model:value="md.from" :options="[{ value: '', label: '不复制（空白角色）' }, ...access.roles.filter((r) => !r.all).map((r) => ({ value: r.key, label: r.name }))]" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style>
@media (min-width: 1101px) {
  .cl-content > .page:has(.r-page-body) {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
}
</style>

<style scoped>
.r-wrap {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
}
.r-list,
.r-perm-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.r-list-head {
  flex: none;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.r-list-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 0;
}
.r-item {
  display: block;
  width: calc(100% - 16px);
  margin: 2px 8px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.r-item:hover { background: rgba(46,211,230,.06); }
.r-item[aria-current] { background: rgba(38,198,218,.14); border-color: rgba(46,211,230,.45); }
.r-main {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  gap: 4px;
}
.r-main b {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.r-desc {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}
.r-desc.empty {
  color: var(--faint);
}
.r-perm-head {
  flex: none;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}
.r-head-left {
  min-width: 0;
  flex: 1;
}
.r-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.r-matrix {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 20px 16px;
}
.r-save-wrap {
  flex: none;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
  background: rgba(16, 33, 55, 0.92);
}
.r-save-wrap :deep(.savebar) {
  position: static;
  box-shadow: none;
  padding: 8px 14px;
}
.r-group + .r-group { margin-top: 6px; }
.r-gh { padding: 10px 0 8px; border-bottom: 1px solid var(--line); font-weight: 600; }
.r-gh :deep(.ant-checkbox-wrapper) { color: var(--accent-text); font-weight: 600; }
.r-row { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 12px; align-items: center; padding: 9px 0 9px 22px; border-bottom: 1px dashed var(--row-line, rgba(43,74,109,.75)); }
.r-row :deep(.ant-checkbox-wrapper) { align-items: center; }
.r-row > :deep(.ant-checkbox-wrapper span:last-child) { display: inline-flex; align-items: center; gap: 6px; }
.r-row.off > :deep(.ant-checkbox-wrapper) { color: var(--muted); }
.r-acts { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; }
.faint { color: var(--faint); font-size: 12.5px; }
@media (max-width: 1100px) {
  .r-wrap { grid-template-columns: 1fr; height: auto; }
  .r-list, .r-perm-card { height: auto; max-height: none; }
  .r-list-body, .r-matrix { max-height: 460px; }
}
</style>
