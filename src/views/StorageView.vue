<script setup lang="ts">
import { computed, reactive } from 'vue'
import PageHead from '@/components/PageHead.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import SaveBar from '@/components/SaveBar.vue'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { toast } from '@/composables/toast'

const session = useSession()
const settings = useSettings()
const mayEdit = computed(() => session.role === 'admin')
const PARTS = [
  { k: '原始数据区', cap: 12, used: 5.4, c: 'var(--chart-1)' }, { k: '清洗数据区', cap: 6, used: 2.4, c: '#2C8F7B' },
  { k: '标注数据区', cap: 4, used: 1.5, c: '#B86E1A' }, { k: '发布数据集', cap: 4, used: 1.9, c: '#8A5CC2' }, { k: '备份区', cap: 4, used: 0.4, c: '#6B7A8E' },
]
const totCap = PARTS.reduce((a, p) => a + p.cap, 0)
const totUsed = PARTS.reduce((a, p) => a + p.used, 0)
const daysLeft = Math.floor(((PARTS[0].cap - PARTS[0].used) * 1000) / 150)

const draft = reactive({ coldDays: settings.cfg.coldDays, backup: settings.cfg.backup, encrypt: settings.cfg.encrypt, watermark: settings.cfg.watermark })
const daysOk = computed(() => Number.isInteger(draft.coldDays) && draft.coldDays >= 7 && draft.coldDays <= 365)
const dirty = computed(() => draft.coldDays !== settings.cfg.coldDays || draft.backup !== settings.cfg.backup || draft.encrypt !== settings.cfg.encrypt || draft.watermark !== settings.cfg.watermark)
function save() { if (!daysOk.value) { toast('请先修正标红的字段', { type: 'warn' }); return } Object.assign(settings.cfg, draft); toast('存储策略已保存') }
function reset() { Object.assign(draft, { coldDays: settings.cfg.coldDays, backup: settings.cfg.backup, encrypt: settings.cfg.encrypt, watermark: settings.cfg.watermark }) }
const switches = [['backup', '自动备份', '每日 02:00 增量备份到备份区'], ['encrypt', '传输与存储加密', 'AES-256，密钥由系统管理员持有'], ['watermark', '导出数据水印', '导出文件嵌入用户与时间信息']] as const
</script>

<template>
  <PageHead title="存储管理" desc="分区容量、增长预测与数据生命周期策略" />
  <div class="grid g4">
    <div class="card kpi" style="cursor:default"><span class="k">总容量</span><span class="v">{{ totCap }}<small>TB</small></span><span class="d">5 个分区，方案书 20TB 级起步</span></div>
    <div class="card kpi" style="cursor:default"><span class="k">已使用</span><span class="v">{{ totUsed.toFixed(1) }}<small>TB</small></span><span class="d">{{ Math.round(totUsed / totCap * 100) }}% 总体使用率</span></div>
    <div class="card kpi" style="cursor:default"><span class="k">日均新增</span><span class="v">≈150<small>GB</small></span><span class="d">约 100 条 × 1GB，含衍生数据</span></div>
    <div class="card kpi" style="cursor:default"><span class="k">原始区预计写满</span><span class="v">{{ daysLeft }}<small>天</small></span><span class="d"><span class="dot-s warn" />低于 60 天将提示扩容</span></div>
  </div>

  <div class="card">
    <div class="card-head"><div><h2>分区使用情况</h2><div class="sub">条形内部填充表示已使用</div></div></div>
    <div class="card-body" style="display:flex;flex-direction:column;gap:18px">
      <div class="stack" aria-label="分区容量占比"><div v-for="p in PARTS" :key="p.k" :style="{ flex: p.cap }" :title="`${p.k} ${p.used} / ${p.cap} TB`"><i :style="{ width: p.used / p.cap * 100 + '%', background: p.c }" /></div></div>
      <div class="grid g3" style="gap:14px 20px">
        <div v-for="p in PARTS" :key="p.k">
          <div class="row between"><span class="row"><i :style="{ width: '10px', height: '10px', borderRadius: '3px', background: p.c, display: 'inline-block' }" /><b>{{ p.k }}</b></span><span class="num muted">{{ p.used }} / {{ p.cap }} TB</span></div>
          <a-progress :percent="p.used / p.cap * 100" :show-info="false" :stroke-color="p.used / p.cap > 0.8 ? 'var(--warn-solid)' : undefined" style="margin-top:8px" />
        </div>
      </div>
    </div>
  </div>

  <div class="grid g-main">
    <div class="card">
      <div class="card-head"><div><h2>冷热分层</h2><div class="sub">按最近访问时间自动迁移</div></div></div>
      <a-table :pagination="false" row-key="t" :data-source="[{ t: 'hot' }, { t: 'warm' }, { t: 'cold' }]" :columns="[{ title: '层级', key: 'lv', width: 80 }, { title: '介质', key: 'media' }, { title: '规则', key: 'rule' }, { title: '占用', key: 'size', align: 'right' }]">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'lv'"><StatusBadge :kind="record.t === 'hot' ? 'info' : record.t === 'warm' ? 'warn' : ''" :text="record.t === 'hot' ? '热' : record.t === 'warm' ? '温' : '冷'" /></template>
          <template v-else-if="column.key === 'media'">{{ record.t === 'hot' ? 'NVMe SSD' : record.t === 'warm' ? 'SAS 阵列' : '大容量 HDD / 对象存储' }}</template>
          <template v-else-if="column.key === 'rule'"><template v-if="record.t === 'hot'">最近 7 天采集或正在处理</template><template v-else-if="record.t === 'warm'">7 天 ~ <b>{{ draft.coldDays }}</b> 天内</template><template v-else>超过 <b>{{ draft.coldDays }}</b> 天</template></template>
          <span v-else class="num">{{ record.t === 'hot' ? '2.1' : record.t === 'warm' ? '5.3' : '4.2' }} TB</span>
        </template>
      </a-table>
    </div>
    <div class="card">
      <div class="card-head"><div><h2>生命周期策略</h2><div class="sub">修改后需保存才会生效</div></div></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:16px">
        <a-form layout="vertical"><a-form-item label="冷数据迁移阈值（天）" extra="范围 7–365 天" :validate-status="daysOk ? '' : 'error'" :help="daysOk ? '' : '请输入 7–365 之间的整数'"><a-input-number v-model:value="draft.coldDays" :min="0" :max="999" :disabled="!mayEdit" style="width:100%" /></a-form-item></a-form>
        <div v-for="s in switches" :key="s[0]" class="row between"><div><b>{{ s[1] }}</b><div class="muted" style="font-size:12.5px">{{ s[2] }}</div></div><a-switch v-model:checked="draft[s[0]]" :disabled="!mayEdit" :aria-label="s[1]" /></div>
        <div v-if="!mayEdit" class="callout info"><AppIcon name="lock" /><span>仅系统管理员可修改存储策略</span></div>
      </div>
    </div>
  </div>
  <SaveBar v-if="dirty && mayEdit" msg="有未保存的存储策略修改" @save="save" @reset="reset" />
</template>
