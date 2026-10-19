<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useAlerts } from '@/stores/alerts'
import { useSession } from '@/stores/session'
import { NO_PERM } from '@/constants'
import { toast } from '@/composables/toast'

const alerts = useAlerts()
const session = useSession()
const list = computed(() => alerts.list.filter((a) => a.route === 'monitor'))
function ack(id: string) { alerts.ack(id); toast('已确认告警') }
</script>
<template>
  <div v-if="list.length" class="list-i">
    <div v-for="a in list" :key="a.id" class="li">
      <span class="alert-ico" :class="a.level"><AppIcon name="alert" size="sm" /></span>
      <span class="grow">
        <span class="tt" style="display: block; white-space: normal">{{ a.title }}</span>
        <span class="ss">{{ a.desc }} · {{ a.time }}</span>
      </span>
      <StatusBadge v-if="a.ack" text="已确认" />
      <a-button v-else size="small" :disabled="!session.can('monitor')" :title="session.can('monitor') ? undefined : NO_PERM" @click="ack(a.id)">确认</a-button>
    </div>
  </div>
  <EmptyState v-else icon="check" title="一切正常" desc="所有通道都在阈值范围内" />
</template>
