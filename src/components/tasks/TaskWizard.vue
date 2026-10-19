<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { OPS, SCEN, TODAY, type ScenKey } from '@/constants'
import { useTasks } from '@/stores/tasks'
import { useSettings } from '@/stores/settings'
import { DEV_PARAMS, DV_ST, useDevices } from '@/stores/devices'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; done: [id: string] }>()
const tasks = useTasks()
const settings = useSettings()
const dv = useDevices()

const step = ref(1)
const defName = (s: ScenKey) => SCEN[s].short + ' · 新批次'
const w = reactive({ scen: 'qmd' as ScenKey, name: defName('qmd'), note: '', op: 0, devices: [] as string[] })
const err = reactive({ name: false, devices: false })
const sceneDevs = computed(() => dv.forScene(w.scen))
const picked = computed(() => w.devices.map((id) => dv.byId(id)!).filter(Boolean))

function pickDefault() { w.devices = sceneDevs.value.filter((d) => d.st === 'online').map((d) => d.id) }
watch(() => props.open, (v) => { if (v) { step.value = 1; Object.assign(w, { scen: 'qmd', name: defName('qmd'), note: '', op: 0 }); pickDefault(); err.name = err.devices = false } })
watch(() => w.scen, (s, old) => { if (w.name === defName(old)) w.name = defName(s); pickDefault(); err.devices = false })

const labels = ['场景与设备', '采集参数', '确认创建']
const rows = computed(() => picked.value.map((d) => ({ ...d, p: DEV_PARAMS[d.type] ?? DEV_PARAMS['其他'] })))
const sizeGb = computed(() => rows.value.reduce((a, r) => a + r.p.gb, 0))
const unhealthy = computed(() => picked.value.filter((d) => d.st !== 'online'))
const preview = computed(() => settings.nameFile(SCEN[w.scen].code, TODAY, 1, OPS[w.op].c))
const cols = [
  { title: '设备', key: 'name' }, { title: '数据通道', key: 'ch' }, { title: '采样率', key: 'rate', width: 90 }, { title: '单条体量', key: 'gb', width: 100, align: 'right' as const }, { title: '状态', key: 'st', width: 90 },
]

function toggle(id: string, on: boolean) { w.devices = on ? [...w.devices, id] : w.devices.filter((x) => x !== id); err.devices = false }
function validate() {
  err.name = err.devices = false
  if (step.value === 1) {
    w.name = w.name.trim()
    err.name = !w.name; err.devices = !w.devices.length
    return !err.name && !err.devices
  }
  return true
}
function next() { if (validate()) step.value++ }
function create(status: 'ready' | 'draft') {
  if (status === 'draft') w.name = w.name.trim() || '未命名任务'
  else if (!validate()) { step.value = 1; return }
  const t = tasks.create({ scen: w.scen, name: w.name, note: w.note.trim(), op: w.op, devices: w.devices }, status)
  emit('close'); emit('done', t.id)
}
</script>

<template>
  <a-modal :open="open" title="新建采集任务" :width="800" :footer="null" centered destroy-on-close @cancel="emit('close')">
    <div class="steps" style="margin:4px 0 20px">
      <div v-for="(s, i) in labels" :key="s" class="step" :class="i + 1 < step ? 'done' : i + 1 === step ? 'cur' : ''">
        <span class="n"><AppIcon v-if="i + 1 < step" name="check" size="sm" /><template v-else>{{ i + 1 }}</template></span><span class="t">{{ s }}</span><span class="bar" />
      </div>
    </div>

    <div v-if="step === 1" style="display:flex;flex-direction:column;gap:16px">
      <div class="field"><span class="label">采集场景</span>
        <div class="grid g2" style="gap:12px">
          <label v-for="(s, k) in SCEN" :key="k" class="fmtcard"><input v-model="w.scen" type="radio" name="scen" :value="k" /><span><b>{{ s.name }}</b><br /><span class="muted" style="font-size:12.5px">{{ s.mode }}{{ k === 'qmd' ? ' · 追求精度与多模态对齐' : ' · 追求低延迟与快速节拍' }}</span></span></label>
        </div>
      </div>
      <div class="field">
        <div class="row between"><span class="label">选择采集设备 <span class="muted" style="font-weight:400">（{{ SCEN[w.scen].name }}场景下共 {{ sceneDevs.length }} 台，已选 {{ w.devices.length }} 台）</span></span>
          <span><a-button type="link" size="small" @click="w.devices = sceneDevs.map((d) => d.id)">全选</a-button><a-button type="link" size="small" @click="pickDefault">仅在线</a-button><a-button type="link" size="small" @click="w.devices = []">清空</a-button></span></div>
        <div class="devpick" :class="{ bad: err.devices }" role="group" aria-label="场景设备">
          <label v-for="d in sceneDevs" :key="d.id" class="dp" :class="{ on: w.devices.includes(d.id) }">
            <a-checkbox :checked="w.devices.includes(d.id)" @change="(e: any) => toggle(d.id, e.target.checked)" />
            <span class="grow"><b>{{ d.name }}</b><small class="muted">{{ d.type }} · {{ d.loc }}</small></span>
            <StatusBadge :kind="DV_ST[d.st][0]" :text="DV_ST[d.st][1]" />
          </label>
          <div v-if="!sceneDevs.length" class="muted" style="padding:14px">该场景下还没有设备，请管理员先在“设备管理”中新增并分配。</div>
        </div>
        <span v-if="err.devices" class="ferr">请至少勾选一台设备</span>
      </div>
      <a-form layout="vertical">
        <a-form-item label="任务名称" :validate-status="err.name ? 'error' : ''" :help="err.name ? '请填写任务名称' : ''"><a-input v-model:value="w.name" :maxlength="40" /></a-form-item>
        <a-form-item label="备注信息"><a-textarea v-model:value="w.note" :rows="2" :maxlength="100" show-count placeholder="选填，如工件批次、采集注意事项等" /></a-form-item>
      </a-form>
    </div>

    <div v-else-if="step === 2" style="display:flex;flex-direction:column;gap:16px">
      <a-form layout="vertical"><a-form-item label="操作员" style="max-width:320px"><a-select v-model:value="w.op" :options="OPS.map((o, i) => ({ value: i, label: o.n + '（' + o.c + '）' }))" /></a-form-item></a-form>
      <div class="field"><span class="label">所选设备的数据信息</span>
        <a-table :columns="cols" :data-source="rows" row-key="id" size="small" :pagination="false" :scroll="{ x: 620 }">
          <template #bodyCell="{ column, record }">
            <div v-if="column.key === 'name'" class="cell-main"><span>{{ record.name }}</span><small class="muted">{{ record.type }} · {{ record.id }}</small></div>
            <span v-else-if="column.key === 'ch'">{{ record.p.ch }}</span>
            <span v-else-if="column.key === 'rate'" class="num">{{ record.p.rate }}</span>
            <span v-else-if="column.key === 'gb'" class="num">{{ record.p.gb.toFixed(2) }} GB</span>
            <StatusBadge v-else-if="column.key === 'st'" :kind="DV_ST[record.st as 'online'][0]" :text="DV_ST[record.st as 'online'][1]" />
          </template>
        </a-table>
      </div>
      <div v-if="unhealthy.length" class="callout warn"><AppIcon name="alert" /><span>{{ unhealthy.map((d) => d.name).join('、') }} 当前不在线，创建后可在“设备巡检 → 自检设备”中复查。</span></div>
      <dl class="kv"><dt>参与设备</dt><dd>{{ rows.length }} 台</dd><dt>单条时长</dt><dd>10–30 秒</dd><dt>单条体量</dt><dd>约 {{ sizeGb.toFixed(2) }} GB / 条（按所选设备估算，以实际为准）</dd></dl>
    </div>

    <div v-else style="display:flex;flex-direction:column;gap:16px">
      <dl class="kv"><dt>任务名称</dt><dd>{{ w.name }}</dd><dt>采集场景</dt><dd>{{ SCEN[w.scen].name }} · {{ SCEN[w.scen].mode }}</dd><dt>操作员</dt><dd>{{ OPS[w.op].n }}</dd><dt>备注</dt><dd>{{ w.note.trim() || '—' }}</dd>
        <dt>采集设备</dt><dd><span v-for="d in picked" :key="d.id" class="tag" style="margin:0 6px 6px 0">{{ d.name }}</span></dd></dl>
      <div class="field"><span class="label">数据文件命名预览</span><div class="mono" style="padding:10px 12px;border-radius:8px;background:var(--surface-3)">{{ preview }}</div><span class="hint">命名规则：{{ settings.cfg.naming }}，可在系统设置中修改</span></div>
    </div>

    <div class="wz-foot">
      <span class="l">第 {{ step }} / 3 步</span>
      <a-button type="text" @click="create('draft')">存为草稿</a-button>
      <a-button v-if="step > 1" @click="step--">上一步</a-button>
      <a-button v-if="step < 3" type="primary" @click="next">下一步</a-button>
      <a-button v-else type="primary" @click="create('ready')">创建任务</a-button>
    </div>
  </a-modal>
</template>

<style scoped>
.wz-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin: 22px -24px -20px; padding: 14px 24px; border-top: 1px solid var(--line); }
.wz-foot .l { margin-right: auto; color: var(--muted); font-size: 13px; }
.devpick { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 6px; }
.devpick.bad { outline: 1px solid var(--crit); outline-offset: 4px; border-radius: 8px; }
.dp { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); cursor: pointer; }
.dp.on { border-color: var(--accent); background: var(--accent-soft); }
.dp b { display: block; font-weight: 500; font-size: 13.5px; }
.dp small { display: block; font-size: 12px; }
.ferr { color: var(--crit); font-size: 12.5px; }
@media (max-width: 640px) { .devpick { grid-template-columns: 1fr; } }
</style>
