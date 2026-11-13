<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { MODE_SLOTS, MODES, OPS, SCEN, TODAY, type DevSlot, type ModeKey, type ScenKey } from '@/constants'
import { DEF_PARAMS, useTasks } from '@/stores/tasks'
import { useSettings } from '@/stores/settings'
import { useDatasets } from '@/stores/datasets'
import { useSession } from '@/stores/session'
import { useDict } from '@/stores/dict'
import { DEV_PARAMS, DV_ST, KITS, cfgText, sizeOf, useDevices, type Device } from '@/stores/devices'
import { toast } from '@/composables/toast'
import type { SceneItem } from '@/api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; done: [id: string] }>()
const tasks = useTasks()
const settings = useSettings()
const dv = useDevices()
const ds = useDatasets()
const session = useSession()
const dict = useDict()

const step = ref(1)
const labels = ['场景与模式', '选择设备', '数据集与参数', '确认与配置下发']

// 动态场景列表（从词条/场景中心获取，并保底）
const sceneList = computed<SceneItem[]>(() => {
  const active = (dict.scenes || []).filter((s) => s.is_active)
  if (active.length > 0) return active
  return [
    {
      id: 1,
      scene_key: 'qmd',
      code: 'VR_QMD',
      name: '轮毂气密性检测',
      short_name: '气密性检测',
      default_mode: 'vr',
      dur_min_s: 10,
      dur_max_s: 40,
      reset_desc: '轮毂工件摆放到位、气密工装复位、压力表归零',
      lang_template: '对轮毂进行气密性检测',
      specs: ['18', '19', '20'],
      is_active: true,
      sort_order: 1,
      created_at: '',
    },
    {
      id: 2,
      scene_key: 'fhd',
      code: 'UMI_FHD',
      name: '防护堵安装',
      short_name: '防护堵安装',
      default_mode: 'umi',
      dur_min_s: 6,
      dur_max_s: 30,
      reset_desc: '防护堵料盒补满、轮毂回到安装工位',
      lang_template: '将防护堵安装到轮毂气阀孔',
      specs: ['18', '19', '20'],
      is_active: true,
      sort_order: 2,
      created_at: '',
    },
  ]
})

const curScene = computed(() => {
  return sceneList.value.find((s) => s.scene_key === w.scen) || sceneList.value[0] || null
})

const blank = () => ({
  scen: 'qmd' as ScenKey,
  mode: 'vr' as ModeKey,
  name: '轮毂气密性检测 · 新批次',
  note: '',
  op: 0,
  devices: [] as string[],
  spec: '19',
  dsMode: 'pick' as 'pick' | 'new',
  datasetId: '',
  dsName: '',
  params: { ...DEF_PARAMS },
  lang: '对轮毂进行气密性检测',
})

const w = reactive(blank())
const err = reactive({ name: '', devices: '', dataset: '' })

// 槽位计算（支持扩展的模式）
const slots = computed<DevSlot[]>(() => {
  return MODE_SLOTS[w.mode] || MODE_SLOTS.vr || []
})

const slotDevs = (s: DevSlot) => dv.ofTypes(s.types)
const picked = computed(() => w.devices.map((id) => dv.byId(id)).filter((d): d is Device => !!d))
const inSlot = (s: DevSlot) => picked.value.filter((d) => s.types.includes(d.type))
const occ = (d: Device) => tasks.occupant(d.id)
const selectable = (d: Device) => d.st === 'online' && !occ(d)
const kits = computed(() => KITS.filter((k) => k.mode === w.mode))
const scenDs = computed(() => ds.list.filter((d) => d.scen === w.scen && d.status !== 'published'))
const allScenDs = computed(() => ds.list.filter((d) => d.scen === w.scen))

function applyKit(id: string) {
  const k = KITS.find((x) => x.id === id)
  if (!k) return
  w.devices = k.devices.filter((d) => {
    const x = dv.byId(d)
    return x && selectable(x)
  })
  err.devices = ''
}

function resetScene(sKey: string) {
  const s = sceneList.value.find((x) => x.scene_key === sKey) || sceneList.value[0]
  if (!s) return
  w.mode = (s.default_mode as ModeKey) || 'vr'
  w.lang = s.lang_template || ''
  w.name = (s.short_name || s.name) + ' · 新批次'
  w.spec = s.specs?.[0] ? `${s.specs[0]}` : '19'
  w.datasetId = (scenDs.value[0] ?? allScenDs.value[0])?.id ?? ''
}

watch(
  () => props.open,
  (v) => {
    if (!v) return
    step.value = 1
    Object.assign(w, blank())
    err.name = err.devices = err.dataset = ''
    const firstKey = sceneList.value[0]?.scene_key || 'qmd'
    w.scen = firstKey
    resetScene(firstKey)
    applyKit(kits.value[0]?.id ?? '')
  }
)

watch(
  () => w.scen,
  (newKey) => {
    resetScene(newKey)
  }
)

watch(
  () => w.mode,
  () => {
    applyKit(kits.value[0]?.id ?? '')
    if (!kits.value.length) w.devices = []
  }
)

function toggle(d: Device, s: DevSlot) {
  if (!selectable(d)) return
  if (w.devices.includes(d.id)) {
    w.devices = w.devices.filter((x) => x !== d.id)
    return
  }
  const cur = inSlot(s)
  if (cur.length >= s.max) {
    w.devices = w.devices.filter((x) => x !== (s.max === 1 ? cur[0].id : cur[cur.length - 1].id))
  }
  w.devices = [...w.devices, d.id]
  err.devices = ''
}

/** 槽位校验：数量、双臂同工位 */
const slotErr = (s: DevSlot) => {
  const n = inSlot(s).length
  if (n < s.min) return '至少选择 ' + s.min + ' 台'
  if (s.key === 'arm' && n === 2 && new Set(inSlot(s).map((d) => d.station)).size > 1) {
    return '双臂协同需选择同一工位的两台机械臂'
  }
  return ''
}

const uncal = computed(() => picked.value.filter((d) => !d.calib))
const rows = computed(() =>
  picked.value.map((d) => ({
    ...d,
    p: DEV_PARAMS[d.type] ?? DEV_PARAMS['其他'],
    cfgT: cfgText(d.type, d.cfg),
  }))
)
const sizeGb = computed(() => picked.value.reduce((a, d) => a + sizeOf(d), 0))
const videoMismatch = computed(
  () => new Set(picked.value.filter((d) => d.type === '相机').map((d) => cfgText(d.type, d.cfg))).size > 1
)
const perHour = computed(() => (sizeGb.value * 3600) / 20)
const dsLabel = computed(() =>
  w.dsMode === 'new'
    ? w.dsName.trim() + '（新建）'
    : (ds.byId(w.datasetId)?.name ?? '—') + ' · ' + w.datasetId
)
const preview = computed(() => {
  const code = curScene.value?.code || 'VR_QMD'
  return settings.nameFile(code, TODAY, 1, OPS[w.op].c)
})

/* ================= 需求 4：数采 YAML 配置动态组装与下发 ================= */
const generatedYaml = computed(() => {
  const s = curScene.value
  const op = OPS[w.op]
  const devLines = picked.value
    .map((d) => {
      const p = DEV_PARAMS[d.type] || DEV_PARAMS['其他']
      return `    - id: "${d.id}"\n      name: "${d.name}"\n      type: "${d.type}"\n      station: "${d.station}"\n      channel: "${p.ch}"\n      config: "${cfgText(d.type, d.cfg)}"`
    })
    .join('\n')

  return `# ========================================================
# DMS Robot Data Collection Configuration
# Target: Edge Station Collector & Algorithm Preprocessing
# ========================================================
meta:
  task_name: "${w.name}"
  scene_code: "${s?.code || 'UNKNOWN'}"
  scene_name: "${s?.name || '未知场景'}"
  mode: "${w.mode}"
  operator: "${op.n} (${op.c})"
  target_dataset: "${w.dsMode === 'new' ? w.dsName : w.datasetId}"
  workpiece_spec: "${w.spec ? w.spec + '寸' : '标准规格'}"
  language_instruction: "${w.lang || ''}"
  expected_duration_sec: [${s?.dur_min_s || 10}, ${s?.dur_max_s || 40}]

reset_policy:
  checklist: "${s?.reset_desc || '默认工装复位规范'}"
  auto_retry_on_fail: ${w.params.autoRetry}

sync_parameters:
  target_sync_tolerance_ms: 10
  time_source: "ptp_hardware_clock"
  bag_chunk_size_mb: 256

devices:
${devLines || '    # (未选定设备)'}
`
})

const isPushing = ref(false)
const pushDone = ref(false)

async function pushYamlToStation() {
  isPushing.value = true
  // 模拟下发至算法端 / 边缘工位采集节点
  await new Promise((r) => setTimeout(r, 900))
  isPushing.value = false
  pushDone.value = true
  toast('已成功下发至算法边缘节点 (Config Hash: ' + Math.random().toString(16).slice(2, 10).toUpperCase() + ')')
}

function copyYaml() {
  navigator.clipboard?.writeText(generatedYaml.value)
  toast('YAML 配置已复制到剪贴板')
}

function downloadYaml() {
  const blob = new Blob([generatedYaml.value], { type: 'text/yaml;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `task_config_${curScene.value?.code || 'DMS'}_${TODAY}.yaml`
  a.click()
  URL.revokeObjectURL(url)
  toast('已下载 YAML 配置文件')
}

function validate() {
  err.name = err.devices = err.dataset = ''
  if (step.value === 1) {
    w.name = w.name.trim()
    err.name = w.name ? '' : '请填写任务名称'
  }
  if (step.value === 2) err.devices = slots.value.map(slotErr).find(Boolean) ?? ''
  if (step.value === 3)
    err.dataset =
      w.dsMode === 'new'
        ? w.dsName.trim()
          ? ''
          : '请填写新数据集名称'
        : w.datasetId
        ? ''
        : '请选择目标数据集'
  return !err.name && !err.devices && !err.dataset
}

function next() {
  if (validate()) step.value++
}

function create(status: 'ready' | 'draft') {
  if (status === 'draft') w.name = w.name.trim() || '未命名任务'
  else
    for (const s of [1, 2, 3]) {
      step.value = s
      if (!validate()) return
    }
  let datasetId = w.datasetId
  if (w.dsMode === 'new' && w.dsName.trim()) {
    datasetId = ds.create(w.dsName.trim(), w.scen, session.info.user).id
  }
  const t = tasks.create(
    {
      scen: w.scen,
      mode: w.mode,
      name: w.name,
      note: w.note.trim(),
      op: w.op,
      devices: w.devices,
      datasetId,
      params: w.params,
      lang: w.lang.trim(),
    },
    status
  )
  emit('close')
  emit('done', t.id)
}
</script>

<template>
  <a-modal
    :open="open"
    title="新建采集任务"
    :width="920"
    :footer="null"
    centered
    destroy-on-close
    @cancel="emit('close')"
  >
    <div class="steps" style="margin:4px 0 20px">
      <div
        v-for="(s, i) in labels"
        :key="s"
        class="step"
        :class="i + 1 < step ? 'done' : i + 1 === step ? 'cur' : ''"
      >
        <span class="n">
          <AppIcon v-if="i + 1 < step" name="check" size="sm" />
          <template v-else>{{ i + 1 }}</template>
        </span>
        <span class="t">{{ s }}</span>
        <span class="bar" />
      </div>
    </div>

    <!-- 1 场景与模式（需求 1 & 需求 2：场景动态可配置与联动、模式注册表） -->
    <div v-if="step === 1" class="wz-body">
      <div class="field">
        <span class="label">采集场景 (动态配置)</span>
        <div class="grid g2" style="gap:12px">
          <label v-for="s in sceneList" :key="s.scene_key" class="fmtcard" :class="{ active: w.scen === s.scene_key }">
            <input v-model="w.scen" type="radio" name="scen" :value="s.scene_key" />
            <span>
              <div class="row between" style="margin-bottom:2px">
                <b>{{ s.name }}</b>
                <span class="tag mono" style="font-size:11px">{{ s.code }}</span>
              </div>
              <span class="muted" style="font-size:12.5px">
                推荐 {{ MODES[s.default_mode]?.name || s.default_mode.toUpperCase() }} · 单条 {{ s.dur_min_s }}–{{ s.dur_max_s }} 秒
              </span>
            </span>
          </label>
        </div>
      </div>

      <div class="field">
        <span class="label">采集模式</span>
        <div class="grid g2" style="gap:12px">
          <label v-for="(m, k) in MODES" :key="k" class="fmtcard" :class="{ active: w.mode === k }">
            <input v-model="w.mode" type="radio" name="mode" :value="k" />
            <span>
              <b>{{ m.name }}</b>
              <span v-if="curScene?.default_mode === k" class="tag" style="margin-left:6px">推荐</span>
              <br />
              <span class="muted" style="font-size:12.5px">{{ m.desc }}</span>
            </span>
          </label>
        </div>
      </div>

      <!-- 场景规格联动与复位规范 -->
      <div v-if="curScene" class="scene-context-box">
        <div class="row between" style="margin-bottom:6px">
          <span class="sec-title"><AppIcon name="info" size="sm" style="margin-right:4px" />当前场景参数要求</span>
          <span class="muted" style="font-size:12px">基准节拍：{{ curScene.dur_min_s }} ~ {{ curScene.dur_max_s }} 秒</span>
        </div>
        <div class="row wrap" style="gap:16px;font-size:13px">
          <div v-if="curScene.specs && curScene.specs.length" style="display:flex;align-items:center;gap:8px">
            <span class="muted">工件规格:</span>
            <div class="seg-mini">
              <button
                v-for="sp in curScene.specs"
                :key="sp"
                type="button"
                :class="{ on: w.spec === sp }"
                @click="w.spec = sp"
              >
                {{ sp }}寸
              </button>
            </div>
          </div>
          <div style="flex:1">
            <span class="muted">复位规范: </span>
            <span>{{ curScene.reset_desc || '按标准工装就位' }}</span>
          </div>
        </div>
      </div>

      <a-form layout="vertical">
        <div class="two">
          <a-form-item label="任务名称" :validate-status="err.name ? 'error' : ''" :help="err.name">
            <a-input v-model:value="w.name" :maxlength="40" />
          </a-form-item>
          <a-form-item label="操作员">
            <a-select v-model:value="w.op" :options="OPS.map((o, i) => ({ value: i, label: o.n + '（' + o.c + '）' }))" />
          </a-form-item>
        </div>
        <a-form-item label="备注信息" style="margin-bottom:0">
          <a-textarea v-model:value="w.note" :rows="2" :maxlength="100" show-count placeholder="选填，如工件批次、采集注意事项等" />
        </a-form-item>
      </a-form>
    </div>

    <!-- 2 选择设备 -->
    <div v-else-if="step === 2" class="wz-body">
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <span class="label" style="margin:0">工位套装</span>
        <button v-for="k in kits" :key="k.id" type="button" class="chip" @click="applyKit(k.id)">
          <AppIcon name="layers" size="sm" />{{ k.name }}
        </button>
        <span class="muted" style="font-size:12.5px">一键带出常用组合，再按需增减；被占用或不在线的设备会自动跳过</span>
      </div>
      <div v-for="s in slots" :key="s.key" class="slot">
        <div class="row between slot-h">
          <span><b>{{ s.label }}</b><span class="muted"> · {{ s.hint }}</span></span>
          <span class="num" :class="slotErr(s) ? 'bad' : 'muted'">
            {{ inSlot(s).length }} / {{ s.min === s.max ? s.max : (s.min ? s.min + '–' : '0–') + s.max }}
            <template v-if="slotErr(s)"> · {{ slotErr(s) }}</template>
          </span>
        </div>
        <div class="devpick">
          <button
            v-for="d in slotDevs(s)"
            :key="d.id"
            type="button"
            class="dp"
            :class="{ on: w.devices.includes(d.id), off: !selectable(d) }"
            :disabled="!selectable(d) && !w.devices.includes(d.id)"
            @click="toggle(d, s)"
          >
            <span class="ck"><AppIcon v-if="w.devices.includes(d.id)" name="check" size="sm" /></span>
            <span class="grow">
              <b>{{ d.name }}</b>
              <small class="muted">{{ d.station }} · {{ d.id }}<template v-if="!d.calib"> · <span style="color:var(--warn)">未标定</span></template></small>
            </span>
            <StatusBadge v-if="occ(d)" kind="info" :text="'占用 ' + occ(d)" />
            <StatusBadge v-else :kind="DV_ST[d.st][0]" :text="DV_ST[d.st][1]" />
          </button>
          <div v-if="!slotDevs(s).length" class="muted" style="padding:10px">设备台账中还没有此类设备</div>
        </div>
      </div>
      <span v-if="err.devices" class="ferr">{{ err.devices }}</span>
      <div v-if="uncal.length" class="callout warn">
        <AppIcon name="alert" />
        <span>{{ uncal.map((d) => d.name).join('、') }} 尚未标定，自检时会被拦截。请先在“设备管理”完成一次性标定。</span>
      </div>
    </div>

    <!-- 3 数据集与参数 -->
    <div v-else-if="step === 3" class="wz-body">
      <div class="field">
        <span class="label">目标数据集</span>
        <div class="seg" role="group" style="margin-bottom:8px">
          <button type="button" :aria-pressed="w.dsMode === 'pick'" @click="w.dsMode = 'pick'">选择已有</button>
          <button type="button" :aria-pressed="w.dsMode === 'new'" @click="w.dsMode = 'new'">新建数据集</button>
        </div>
        <a-select
          v-if="w.dsMode === 'pick'"
          v-model:value="w.datasetId"
          :status="err.dataset ? 'error' : ''"
          :options="allScenDs.map((d) => ({ value: d.id, label: d.name + ' · ' + d.ver + '（' + d.id + '）' + (d.status === 'published' ? ' · 已发布，新数据进入下一版本' : '') }))"
        />
        <a-input v-else v-model:value="w.dsName" :status="err.dataset ? 'error' : ''" :maxlength="40" :placeholder="(curScene?.name || '新场景') + ' · 新规格'" />
        <span v-if="err.dataset" class="ferr">{{ err.dataset }}</span>
      </div>
      <div class="field">
        <span class="label">采集参数 <span class="muted" style="font-weight:400">来自设备配置，如需调整请到「设备管理」</span></span>
        <div class="card">
          <a-table
            :data-source="rows"
            row-key="id"
            size="small"
            :pagination="false"
            :columns="[{ title: '设备', key: 'name' }, { title: '数据通道', key: 'ch' }, { title: '参数', key: 'cfg', width: 190 }]"
          >
            <template #bodyCell="{ column, record }">
              <div v-if="column.key === 'name'" class="cell-main">
                <span>{{ record.name }}</span>
                <small class="muted">{{ record.type }} · {{ record.station }}</small>
              </div>
              <span v-else-if="column.key === 'ch'" class="muted">{{ record.p.ch }}</span>
              <span v-else-if="column.key === 'cfg'" class="num">{{ record.cfgT }}</span>
            </template>
          </a-table>
        </div>
        <div v-if="videoMismatch" class="callout warn" style="margin-top:8px">
          <AppIcon name="alert" />
          <span>所选相机的视频参数不一致，可能影响多路画面对齐，建议在设备管理中统一</span>
        </div>
      </div>
      <a-form layout="vertical">
        <a-checkbox v-model:checked="w.params.autoRetry" style="margin-bottom:14px">入库失败自动重试 3 次</a-checkbox>
        <a-form-item label="任务语义/语言指令" extra="算法端模型提示词描述" style="margin-bottom:0">
          <a-input v-model:value="w.lang" :maxlength="80" />
        </a-form-item>
      </a-form>
      <dl class="kv">
        <dt>单条体量</dt><dd>约 {{ sizeGb.toFixed(2) }} GB / 条（按 20 秒估算）</dd>
        <dt>码率</dt><dd>约 {{ perHour.toFixed(0) }} GB / 小时</dd>
      </dl>
    </div>

    <!-- 4 确认与配置下发（需求 4：支持算法端 YAML 配置生成与下发） -->
    <div v-else class="wz-body">
      <dl class="kv">
        <dt>任务名称</dt><dd>{{ w.name }}</dd>
        <dt>场景 / 模式</dt><dd>{{ curScene?.name }} · {{ MODES[w.mode]?.name || w.mode }}</dd>
        <dt>工件规格</dt><dd><span class="tag good">{{ w.spec }}寸</span></dd>
        <dt>操作员</dt><dd>{{ OPS[w.op].n }}</dd>
        <dt>目标数据集</dt><dd>{{ dsLabel }}</dd>
        <dt>单条体量</dt><dd>约 {{ sizeGb.toFixed(2) }} GB / 条</dd>
        <dt>语言指令</dt><dd>{{ w.lang || '—' }}</dd>
        <dt>复位规范</dt><dd class="muted">{{ curScene?.reset_desc || '—' }}</dd>
        <dt>备注</dt><dd>{{ w.note.trim() || '—' }}</dd>
      </dl>

      <!-- 数采标准化 YAML 预览与分发卡片 -->
      <div class="yaml-card">
        <div class="row between yaml-head">
          <div class="row center" style="gap:8px">
            <AppIcon name="file" size="sm" />
            <b>数采 YAML 配置文件 (算法与采集站标准配置)</b>
            <span v-if="pushDone" class="tag good" style="font-size:11px">● 算法端已同步就绪</span>
          </div>
          <div class="row center" style="gap:8px">
            <a-button size="small" @click="copyYaml">复制 YAML</a-button>
            <a-button size="small" @click="downloadYaml">下载 .yaml</a-button>
            <a-button
              size="small"
              type="primary"
              :loading="isPushing"
              @click="pushYamlToStation"
            >
              <AppIcon name="send" size="sm" style="margin-right:4px" />
              下发至算法边缘端
            </a-button>
          </div>
        </div>
        <pre class="yaml-code">{{ generatedYaml }}</pre>
      </div>

      <div class="field">
        <span class="label">数据文件命名预览</span>
        <div class="mono" style="padding:10px 12px;border-radius:8px;background:var(--surface-3)">{{ preview }}</div>
        <span class="hint">创建后进入“设备自检”，每次开始采集前都需要自检</span>
      </div>
    </div>

    <div class="wz-foot">
      <span class="l">第 {{ step }} / 4 步</span>
      <a-button type="text" @click="create('draft')">存为草稿</a-button>
      <a-button v-if="step > 1" @click="step--">上一步</a-button>
      <a-button v-if="step < 4" type="primary" @click="next">下一步</a-button>
      <a-button v-else type="primary" @click="create('ready')">创建任务</a-button>
    </div>
  </a-modal>
</template>

<style scoped>
.wz-body { display: flex; flex-direction: column; gap: 13px; max-height: 70vh; overflow-y: auto; padding-right: 4px; }
.wz-body :deep(.fmtcard) { padding: 11px 14px; }
.wz-body :deep(.ant-form-item) { margin-bottom: 14px !important; }
.wz-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin: 18px -24px -20px; padding: 14px 24px; border-top: 1px solid var(--line); }
.wz-foot .l { margin-right: auto; color: var(--muted); font-size: 13px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.slot { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--surface-2); }
.slot-h { font-size: 13px; margin-bottom: 8px; gap: 10px; }
.slot-h .bad { color: var(--crit); }
.devpick { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.dp { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); cursor: pointer; text-align: left; color: inherit; font: inherit; }
.dp.on { border-color: var(--accent); background: var(--accent-soft); }
.dp.off:not(.on) { opacity: .5; cursor: not-allowed; }
.dp .ck { width: 16px; height: 16px; flex: none; border: 1px solid var(--line-strong, var(--line)); border-radius: 4px; display: grid; place-items: center; color: var(--accent); }
.dp.on .ck { border-color: var(--accent); }
.dp b { display: block; font-weight: 500; font-size: 13px; }
.dp small { display: block; font-size: 11.5px; }
.ferr { color: var(--crit); font-size: 12.5px; }
.seg { display: inline-flex; padding: 3px; border-radius: 8px; background: var(--surface-3); gap: 2px; }
.seg button { border: 0; background: none; color: var(--muted); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12.5px; }
.seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); font-weight: 600; }

.scene-context-box {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 14px;
}
.sec-title {
  display: inline-flex;
  align-items: center;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
}
.seg-mini {
  display: inline-flex;
  gap: 4px;
}
.seg-mini button {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.seg-mini button.on {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

/* YAML Card */
.yaml-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-2);
  overflow: hidden;
}
.yaml-head {
  padding: 8px 12px;
  background: var(--surface-3);
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.yaml-code {
  margin: 0;
  padding: 12px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.5;
  color: #38bdf8;
  background: #090d16;
  max-height: 200px;
  overflow: auto;
  border-radius: 0 0 8px 8px;
}

@media (max-width: 640px) { .devpick, .two, .three { grid-template-columns: 1fr; } }
</style>
