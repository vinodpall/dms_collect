<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import ExportDialog from './ExportDialog.vue'
import { NO_PERM, SCEN } from '@/constants'
import { DS_ST, useDatasets, type Dataset } from '@/stores/datasets'
import { useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { toast } from '@/composables/toast'
import { confirmDlg } from '@/composables/confirm'
import { fmt } from '@/utils'

const props = defineProps<{ id: string | null }>()
const emit = defineEmits<{ close: [] }>()
const store = useDatasets()
const session = useSession()
const ui = useUi()
const d = computed<Dataset | undefined>(() => (props.id ? store.byId(props.id) : undefined))
const tab = ref('info')
const exporting = ref<Dataset | null>(null)
watch(() => props.id, () => { tab.value = 'info' })
const mayPub = computed(() => session.can('datasets'))
const dis = computed(() => (mayPub.value ? undefined : NO_PERM))

const versions = computed(() => {
  if (!d.value) return []
  const m = parseInt(d.value.ver.slice(1).split('.')[0], 10), n = parseInt(d.value.ver.split('.')[1], 10)
  const out: [string, string, string][] = []
  for (let i = n; i >= 0 && out.length < 4; i--) out.push(['v' + m + '.' + i, i === n ? d.value.updated : '10-0' + (1 + i) + ' 10:00', i === n ? '当前版本' : i === 0 ? '首次发布' : '新增采集批次与标签修订'])
  return out
})

async function act(a: string) {
  const x = d.value
  if (!x) return
  if (a === 'sub') { x.status = 'review'; toast('已提交审核') }
  else if (a === 'pub') {
    const ok = await confirmDlg({ title: '发布 ' + x.name + ' ' + x.ver + '？', msg: '发布后数据集会对算法团队可见，已发布的版本不可修改，只能撤回后再发布新版本。', ok: '确认发布' })
    if (!ok) return
    x.status = 'published'; x.updated = '刚刚'; toast('已发布 ' + x.id + ' ' + x.ver)
  } else if (a === 'un') {
    const ok = await confirmDlg({ title: '撤回发布？', msg: '撤回后算法团队将无法再下载该版本。', ok: '撤回', danger: true })
    if (!ok) return
    x.status = 'review'; toast('已撤回，状态为待审核')
  }
}
</script>

<template>
  <a-drawer :open="!!d" :width="640" :closable="false" :body-style="{ padding: '20px 24px 28px' }" :header-style="{ padding: '18px 24px 0', borderBottom: 0 }" destroy-on-close @close="emit('close')">
    <template #title>
      <div v-if="d" style="display:flex;flex-direction:column;gap:12px;width:100%">
        <div class="row between"><div class="row"><span class="mono">{{ d.id }}</span><StatusBadge :kind="DS_ST[d.status][0]" :text="DS_ST[d.status][1]" /></div><button type="button" class="icon-btn" aria-label="关闭" @click="emit('close')"><AppIcon name="x" /></button></div>
        <h2 style="font-size:20px;font-weight:600">{{ d.name }} <span class="fmt">{{ d.ver }}</span></h2>
        <a-tabs v-model:active-key="tab" :tab-bar-style="{ marginBottom: 0 }"><a-tab-pane key="info" tab="概览" /><a-tab-pane key="ver" tab="版本" /></a-tabs>
      </div>
    </template>

    <div v-if="d" style="display:flex;flex-direction:column;gap:20px">
      <template v-if="tab === 'info'">
        <div class="grid g3" style="gap:12px"><div v-for="x in [['条数', fmt(d.count)], ['体量', (d.size / 1000).toFixed(2) + ' TB'], ['质量分', d.quality]]" :key="x[0]" class="card" style="padding:14px"><div class="muted" style="font-size:12.5px">{{ x[0] }}</div><div class="num" style="font-size:22px;font-weight:600">{{ x[1] }}</div></div></div>
        <div class="card" style="padding:12px 14px;background:var(--surface-2);display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <div style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px"><AppIcon name="eye" size="sm" /> 视频画面与时序标注</div>
            <div class="muted" style="font-size:12px;margin-top:2px">查看 6 路工业视觉同步画面、世界坐标轨迹、灵巧手姿态与完整子任务切片</div>
          </div>
          <a-button size="small" type="primary" ghost @click="ui.datasetViewerId = d.id">查看样本画面</a-button>
        </div>
        <dl class="kv">
          <dt>场景</dt><dd>{{ SCEN[d.scen].name }}</dd><dt>采集方式</dt><dd>{{ SCEN[d.scen].mode }}</dd><dt>轮毂规格</dt><dd>{{ d.spec === 'mix' ? '18 / 19 / 20 寸混合' : d.spec + ' 寸' }}</dd><dt>负责人</dt><dd>{{ d.owner }}</dd>
          <dt>标签</dt><dd class="row wrap" style="gap:6px"><span v-for="t in d.tags" :key="t" class="tag">{{ t }}</span></dd><dt>多模态通道</dt><dd>3 路视觉 · 六维力 · 关节 · VR 位姿</dd><dt>数据来源</dt><dd>采集批次 B-1008 ~ B-1012 · 经清洗、标注、审核后入集</dd>
        </dl>
      </template>
      <div v-else-if="tab === 'ver'" class="list-i">
        <div v-for="v in versions" :key="v[0]" class="li"><span class="fmt">{{ v[0] }}</span><span class="grow"><span class="tt" style="display:block;white-space:normal">{{ v[2] }}</span><span class="ss">{{ v[1] }}</span></span></div>
      </div>
    </div>

    <template #footer>
      <div v-if="d" style="display:flex;gap:10px;justify-content:flex-end">
        <a-button type="primary" ghost @click="ui.datasetViewerId = d.id"><AppIcon name="eye" size="sm" />查看视频与标注</a-button>
        <a-button @click="exporting = d"><AppIcon name="download" size="sm" />导出</a-button>
        <a-button v-if="d.status === 'draft'" type="primary" :disabled="!mayPub" :title="dis" @click="act('sub')">提交审核</a-button>
        <a-button v-else-if="d.status === 'review'" type="primary" :disabled="!mayPub" :title="dis" @click="act('pub')">审核通过并发布</a-button>
        <a-button v-else :disabled="!mayPub" :title="dis" @click="act('un')">撤回发布</a-button>
      </div>
    </template>
  </a-drawer>
  <ExportDialog :ds="exporting" @close="exporting = null" />
</template>
