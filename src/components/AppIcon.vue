<script setup lang="ts">
import { computed } from 'vue'
import { ICONS } from './icons'
const props = defineProps<{ name: string; size?: 'sm' | 'lg' }>()
const html = computed(() => ICONS[props.name] ?? '')
</script>
<template>
  <svg class="ic" :class="size" viewBox="0 0 24 24" aria-hidden="true" v-html="html" />
</template>
