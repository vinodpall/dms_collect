<script setup lang="ts">
defineProps<{ msg?: string }>()
defineEmits<{ save: []; reset: [] }>()
</script>
<template>
  <div class="savebar">
    <span>{{ msg ?? '有未保存的修改' }}</span>
    <button type="button" class="btn ghost sm" @click="$emit('reset')">撤销</button>
    <a-button type="primary" size="small" @click="$emit('save')">保存修改</a-button>
  </div>
</template>
