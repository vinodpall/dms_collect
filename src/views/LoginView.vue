<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import BrandMark from '@/components/BrandMark.vue'
import { DEMO_PASSWORD } from '@/constants'
import { useSession } from '@/stores/session'
import '@/styles/login.css'

const session = useSession()
const router = useRouter()
const route = useRoute()
const f = reactive({ u: 'admin', p: DEMO_PASSWORD, remember: true }) // 演示环境默认填充管理员账号
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
document.title = '登录 · 数采管理平台'

/* ---------- 主视觉 ---------- */
const canvas = ref<HTMLCanvasElement>()
const root = ref<HTMLElement>()
const failed = ref(false)
let api: { dispose(): void } | null = null

onMounted(async () => {
  if (!canvas.value) return
  try {
    const { createHubLine } = await import('@/components/login/hubLine')
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    api = createHubLine(canvas.value, {
      reserve: () => (root.value && root.value.clientWidth > 960 ? Math.min(560, root.value.clientWidth * 0.36) : 0),
      onLayout: () => {},
      still,
    })
  } catch (e) { console.warn('[login] 3D 场景初始化失败', e); failed.value = true }
})
onBeforeUnmount(() => { api?.dispose() })
</script>

<template>
  <div ref="root" class="lg">
    <canvas ref="canvas" class="lg-canvas" aria-hidden="true" />
    <div class="lg-fx" aria-hidden="true" />

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
      </form>
    </section>
  </div>
</template>
