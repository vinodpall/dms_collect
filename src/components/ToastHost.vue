<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { dismissToast, toasts } from '@/composables/toast'
</script>
<template>
  <div class="toasts" role="status" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
      <AppIcon :name="t.type ? 'alert' : 'check'" />
      <span>{{ t.msg }}</span>
      <button v-if="t.action" type="button" @click="t.onAction?.(); dismissToast(t.id)">{{ t.action }}</button>
    </div>
  </div>
</template>
