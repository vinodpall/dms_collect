<script setup lang="ts">
defineProps<{ kind?: string; text: string; plain?: boolean }>()
</script>
<template><span class="badge" :class="[kind, { plain }]">{{ text }}</span></template>
