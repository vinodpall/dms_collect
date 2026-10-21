<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import BrandMark from '@/components/BrandMark.vue'
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLES } from '@/constants'
import { useSession } from '@/stores/session'
import type { Anchor } from '@/components/login/hubLine'
import '@/styles/login.css'

const session = useSession()
const router = useRouter()
const route = useRoute()
const f = reactive({ u: '', p: '', remember: true })
const touched = reactive({ u: false, p: false })
const err = ref('')
const shake = ref(false)
const loading = ref(false)
const showPwd = ref(false)
const uErr = computed(() => (touched.u && !f.u.trim() ? '请输入账号' : ''))
const pErr = computed(() => (touched.p && !f.p ? '请输入密码' : ''))

async function submit() {
  touched.u = touched.p = true
  err.value = ''
  if (!f.u.trim() || !f.p) return
  loading.value = true
  const e = await session.login(f.u, f.p, f.remember)
  loading.value = false
  if (e) { err.value = e; shake.value = false; requestAnimationFrame(() => { shake.value = true }); return }
  const r = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  router.replace(r && r.startsWith('/') ? r : { name: 'dashboard' })
}
function fill(u: string) { f.u = u; f.p = DEMO_PASSWORD; err.value = ''; touched.u = touched.p = false }
document.title = '登录 · 数采管理平台'
const PORTAL_URL = (import.meta.env.VITE_PORTAL_URL as string | undefined) ?? ''

/* ---------- 主视觉 ---------- */
const canvas = ref<HTMLCanvasElement>()
const root = ref<HTMLElement>()
const pos = ref<Record<Anchor, { x: number; y: number }> | null>(null)
const failed = ref(false)
let api: { dispose(): void } | null = null
const wide = ref(true)

/** 场景卡片：锚点 → 卡片位置（相对锚点偏移） */
const CARDS = [
  { key: 'test' as Anchor, no: '01', title: '轮毂气密性检测', tag: 'VR 遥操作 · 双臂灵巧手', desc: '操作员佩戴 VR 设备和动捕手套，远程操控两台配备灵巧手的机械臂，对轮毂进行高精度气密性检测。', dx: -340, dy: -235, side: 'r' },
  { key: 'umi' as Anchor, no: '02', title: '防护堵安装', tag: 'UMI 手持采集', desc: '操作员通过手持 UMI 设备，对轮毂进行快速、精准的防护堵安装作业。', dx: 140, dy: 70, side: 'l' },
]
const CARD_W = 300
const cardStyle = (c: (typeof CARDS)[number]) => {
  const a = pos.value?.[c.key]; if (!a) return { opacity: 0 }
  return { left: `${a.x + c.dx}px`, top: `${a.y + c.dy}px`, width: `${CARD_W}px` }
}
/** 引线：锚点 → 卡片近侧中点 */
const leader = (c: (typeof CARDS)[number]) => {
  const a = pos.value?.[c.key]; if (!a) return ''
  const ex = c.side === 'r' ? a.x + c.dx + CARD_W : a.x + c.dx, ey = a.y + c.dy + 34
  const mx = c.side === 'r' ? ex + 24 : ex - 24
  return `M${a.x} ${a.y} L${mx} ${ey} L${ex} ${ey}`
}

/* 实时数据（演示） */
const pressure = ref(0.352), leak = ref(0.018), plugs = ref(3), clock = ref(0)
let timer = 0
const recTime = computed(() => { const s = 2 * 3600 + 14 * 60 + clock.value; return [s / 3600, (s / 60) % 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':') })

onMounted(async () => {
  const mq = window.matchMedia('(max-width: 960px)')
  wide.value = !mq.matches
  timer = window.setInterval(() => {
    clock.value++
    pressure.value = +(0.35 + Math.random() * 0.006).toFixed(3)
    leak.value = +(0.015 + Math.random() * 0.008).toFixed(3)
    plugs.value = Math.floor(((Date.now() / 1000) % 7.5) / 7.5 * 6)
  }, 1000)
  if (!canvas.value) return
  try {
    const { createHubLine } = await import('@/components/login/hubLine')
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    api = createHubLine(canvas.value, {
      reserve: () => (root.value && root.value.clientWidth > 960 ? Math.min(560, root.value.clientWidth * 0.36) : 0),
      onLayout: (p) => { pos.value = p; wide.value = (root.value?.clientWidth ?? 0) > 960 },
      still,
    })
  } catch (e) { console.warn('[login] 3D 场景初始化失败', e); failed.value = true }
})
onBeforeUnmount(() => { api?.dispose(); clearInterval(timer) })
</script>

<template>
  <div ref="root" class="lg">
    <canvas ref="canvas" class="lg-canvas" aria-hidden="true" />
    <div class="lg-fx" aria-hidden="true" />

    <!-- 场景标注 -->
    <template v-if="wide && pos && !failed">
      <svg class="lg-leaders" aria-hidden="true">
        <g v-for="c in CARDS" :key="c.key">
          <path :d="leader(c)" />
          <circle :cx="pos[c.key].x" :cy="pos[c.key].y" r="4" />
          <circle class="ping" :cx="pos[c.key].x" :cy="pos[c.key].y" r="4" />
        </g>
      </svg>
      <article v-for="c in CARDS" :key="c.key" class="lg-scene" :style="cardStyle(c)">
        <header><b>{{ c.no }}</b><h3>{{ c.title }}</h3><span class="rec"><i />采集中</span></header>
        <p>{{ c.desc }}</p>
        <footer v-if="c.key === 'test'">
          <span>{{ c.tag }}</span><span>保压 <em>{{ pressure.toFixed(3) }}</em> MPa</span><span>泄漏率 <em>{{ leak.toFixed(3) }}</em>%</span>
        </footer>
        <footer v-else>
          <span>{{ c.tag }}</span><span>防护堵 <em>{{ plugs }}</em>/5</span><span>录制 <em>{{ recTime }}</em></span>
        </footer>
      </article>
    </template>

    <header class="lg-brand">
      <BrandMark />
      <div><h1>数采管理平台</h1><p>EMBODIED DATA COLLECTION</p></div>
    </header>

    <div class="lg-caption">
      <h2>轮毂产线 · 具身数据采集示范站</h2>
      <p>VR 遥操作与 UMI 手持采集并行，人手动作、机器人状态与多路视频同步录制，从采集到入库全流程可追溯。</p>
    </div>

    <section class="lg-side">
      <form class="lg-card" novalidate @submit.prevent="submit">
        <span class="cn tl" /><span class="cn tr" /><span class="cn bl" /><span class="cn br" />
        <div class="lg-card-head">
          <h2>账号登录</h2>
          <p class="sub">欢迎登录数采管理平台</p>
        </div>
        <div v-if="err" class="lg-err" :class="{ shake }" role="alert"><AppIcon name="alert" size="sm" />{{ err }}</div>
        <label class="lg-field">
          <span class="lg-box" :class="{ bad: uErr }"><AppIcon name="user" size="sm" /><input v-model="f.u" placeholder="账号" aria-label="账号" autocomplete="username" :aria-invalid="!!uErr" @blur="touched.u = true" /></span>
          <small v-if="uErr" class="lg-help">{{ uErr }}</small>
        </label>
        <label class="lg-field">
          <span class="lg-box" :class="{ bad: pErr }">
            <AppIcon name="lock" size="sm" />
            <input v-model="f.p" :type="showPwd ? 'text' : 'password'" placeholder="密码" aria-label="密码" autocomplete="current-password" :aria-invalid="!!pErr" @blur="touched.p = true" />
            <button type="button" class="lg-eye" :aria-label="showPwd ? '隐藏密码' : '显示密码'" @click="showPwd = !showPwd"><AppIcon :name="showPwd ? 'eyeoff' : 'eye'" size="sm" /></button>
          </span>
          <small v-if="pErr" class="lg-help">{{ pErr }}</small>
        </label>
        <div class="lg-row"><label class="lg-check"><input v-model="f.remember" type="checkbox" />记住登录</label><span>忘记密码请联系管理员</span></div>
        <button type="submit" class="lg-go" :disabled="loading">{{ loading ? '验证中…' : '登 录' }}</button>
        <div class="lg-demo">
          <small>演示账号（密码均为 {{ DEMO_PASSWORD }}），点击自动填入</small>
          <div><button v-for="a in DEMO_ACCOUNTS" :key="a.u" type="button" @click="fill(a.u)">{{ a.u }} · {{ ROLES[a.role].name }}</button></div>
        </div>
      </form>
      <div class="lg-foot"><template v-if="PORTAL_URL"><a :href="PORTAL_URL">← 返回训练场入口</a>　·　</template>© 2026 帝蛮神（上海）科技有限公司</div>
    </section>
  </div>
</template>
