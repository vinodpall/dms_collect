import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { PageKey } from '@/constants'

export interface AlertItem { id: string; level: 'info' | 'warn' | 'crit'; title: string; desc: string; time: string; route: PageKey; ack: boolean; read: boolean }

export const useAlerts = defineStore('alerts', () => {
  const list = ref<AlertItem[]>([
    { id: 'a3', level: 'warn', title: 'PICO VR 一体机 #3 已离线', desc: '最近一次心跳在 16:00', time: '16:12', route: 'devices', ack: false, read: false },
    { id: 'a1', level: 'warn', title: '第一视角相机 D405 掉帧率 2.4%', desc: '超过 2% 告警阈值，已持续 3 分钟', time: '16:07', route: 'monitor', ack: false, read: false },
    { id: 'a2', level: 'crit', title: '批次 B-1013-04 数据标准化失败', desc: 'bag 转 lsdataset 出错：相机话题时间戳不连续，需要重试', time: '14:58', route: 'pipeline', ack: false, read: false },
    { id: 'a4', level: 'info', title: '原始数据区预计 44 天后写满', desc: '按每日约 100 条、单条约 1GB 估算', time: '08:00', route: 'storage', ack: true, read: true },
  ])
  const unread = computed(() => list.value.filter((a) => !a.read).length)
  const open = computed(() => list.value.filter((a) => !a.ack))
  function add(a: Omit<AlertItem, 'id' | 'ack' | 'read'>) {
    list.value.unshift({ id: 'a' + Date.now(), ack: false, read: false, ...a })
  }
  function ack(id: string) {
    const a = list.value.find((x) => x.id === id)
    if (a) { a.ack = true; a.read = true }
  }
  function unack(id: string) {
    const a = list.value.find((x) => x.id === id)
    if (a) a.ack = false
  }
  /** 确认该页面第一条未确认告警（原型重试批次时的行为） */
  function ackFirst(route: PageKey) {
    const a = list.value.find((x) => x.route === route && !x.ack)
    if (a) { a.ack = true; a.read = true }
  }
  function readAll() { list.value.forEach((a) => (a.read = true)) }
  const openCount = (route: PageKey) => list.value.filter((a) => a.route === route && !a.ack).length
  return { list, unread, open, add, ack, unack, ackFirst, readAll, openCount }
})
