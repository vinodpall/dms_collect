<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
defineProps<{ icon: string; title: string; desc?: string }>()
</script>
<template>
  <div class="empty">
    <div class="ico"><AppIcon :name="icon" size="lg" /></div>
    <b>{{ title }}</b>
    <span v-if="desc">{{ desc }}</span>
    <slot />
  </div>
</template>
