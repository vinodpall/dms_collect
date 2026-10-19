<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import BrandMark from '@/components/BrandMark.vue'
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLES } from '@/constants'
import { useSession } from '@/stores/session'

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
const FEATURES = ['采集任务', '实时监控', '处理流水线', '标注与校验', '数据集管理', '设备与存储']
</script>

<template>
  <div class="entry login">
    <section class="login-hero">
      <div class="ent-brand"><BrandMark /><div><b>数采管理平台</b><span>DMS · DATA COLLECTION</span></div></div>
      <svg class="hero-art" viewBox="0 0 520 420" aria-hidden="true" fill="none">
        <defs>
          <linearGradient id="ga" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6DB2FF" /><stop offset="1" stop-color="#4FE3C1" /></linearGradient>
          <radialGradient id="gb"><stop offset="0" stop-color="#4FA3FF" stop-opacity=".5" /><stop offset="1" stop-color="#4FA3FF" stop-opacity="0" /></radialGradient>
        </defs>
        <ellipse cx="270" cy="330" rx="210" ry="48" fill="url(#gb)" />
        <ellipse cx="270" cy="330" rx="170" ry="34" stroke="#4FA3FF" stroke-opacity=".5" />
        <ellipse cx="270" cy="330" rx="120" ry="22" stroke="#4FE3C1" stroke-opacity=".5" stroke-dasharray="4 6" />
        <g stroke="url(#ga)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">
          <rect x="196" y="298" width="148" height="30" rx="8" fill="#0F2D55" />
          <path d="M270 298V248" /><circle cx="270" cy="236" r="14" fill="#0F2D55" />
          <path d="M270 222L218 160" /><circle cx="214" cy="154" r="11" fill="#0F2D55" />
          <path d="M214 143L300 84" /><circle cx="306" cy="80" r="10" fill="#0F2D55" />
          <path d="M310 70l30-16M310 90l34-4" /><path d="M340 54v-12M344 86v12" />
        </g>
        <g fill="#4FE3C1"><circle cx="420" cy="120" r="3" /><circle cx="120" cy="230" r="3" /><circle cx="460" cy="250" r="2.5" /><circle cx="90" cy="120" r="2.5" /></g>
        <g stroke="#4FA3FF" stroke-opacity=".45" stroke-dasharray="3 5"><path d="M342 54L420 120L460 250" /><path d="M214 154L120 230L90 120" /></g>
      </svg>
      <div class="hero-copy">
        <h1>具身数据采集<br /><em>从采集到入库全流程管理</em></h1>
        <p>覆盖采集任务编排、实时监控、数据标准化、手动标注与审核、数据集发布，让每一条具身数据都可追溯。</p>
      </div>
      <div class="hero-mods"><span v-for="(m, i) in FEATURES" :key="m" :style="{ '--c': ['#2F8BFF', '#19B5A5', '#5B7CFA', '#A667F0', '#F08A3C', '#4FE3C1'][i] }"><i />{{ m }}</span></div>
    </section>

    <section class="login-side">
      <button type="button" class="icon-btn login-theme" aria-label="切换深色模式" @click="session.toggleTheme()"><AppIcon :name="session.dark ? 'sun' : 'moon'" /></button>
      <form class="login-card" novalidate @submit.prevent="submit">
        <h2>欢迎登录</h2>
        <p class="sub">使用平台账号登录数采管理平台</p>
        <div v-if="err" class="login-err" :class="{ shake }" role="alert"><AppIcon name="alert" size="sm" />{{ err }}</div>
        <a-form layout="vertical">
          <a-form-item label="账号" :validate-status="uErr ? 'error' : ''" :help="uErr">
            <a-input v-model:value="f.u" size="large" placeholder="请输入账号" autocomplete="username" aria-label="账号" @blur="touched.u = true">
              <template #prefix><AppIcon name="user" size="sm" /></template>
            </a-input>
          </a-form-item>
          <a-form-item label="密码" :validate-status="pErr ? 'error' : ''" :help="pErr">
            <a-input v-model:value="f.p" size="large" :type="showPwd ? 'text' : 'password'" placeholder="请输入密码" autocomplete="current-password" aria-label="密码" @blur="touched.p = true" @press-enter="submit">
              <template #prefix><AppIcon name="lock" size="sm" /></template>
              <template #suffix><button type="button" class="icon-btn" style="width:26px;height:26px" :aria-label="showPwd ? '隐藏密码' : '显示密码'" @click="showPwd = !showPwd"><AppIcon :name="showPwd ? 'eyeoff' : 'eye'" size="sm" /></button></template>
            </a-input>
          </a-form-item>
        </a-form>
        <div class="login-row"><a-checkbox v-model:checked="f.remember">记住登录状态</a-checkbox><span>忘记密码请联系管理员</span></div>
        <a-button type="primary" html-type="submit" class="go" :loading="loading">登 录</a-button>
        <div class="demo-box">
          <small>演示账号（密码均为 {{ DEMO_PASSWORD }}），点击自动填入</small>
          <div><button v-for="a in DEMO_ACCOUNTS" :key="a.u" type="button" class="demo-chip" @click="fill(a.u)">{{ a.u }} · {{ ROLES[a.role].name }}</button></div>
        </div>
      </form>
      <div class="login-foot"><template v-if="PORTAL_URL"><a :href="PORTAL_URL">← 返回训练场入口</a>　·　</template>© 2026 帝蛮神（上海）科技有限公司</div>
    </section>
  </div>
</template>
