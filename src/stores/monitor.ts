import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { rng } from '@/utils'

export interface Channel { id: string; name: string; dev: string; unit: string; base: number; jit: number; drop: number }
export const CHANNELS: Channel[] = [
  { id: 'c1', name: '第一视角相机', dev: 'RealSense D405', unit: 'fps', base: 30, jit: 0.4, drop: 0.3 },
  { id: 'c2', name: '第三视角相机', dev: 'RealSense D435', unit: 'fps', base: 30, jit: 0.3, drop: 0.2 },
  { id: 'c3', name: '腕部相机', dev: 'RealSense D435', unit: 'fps', base: 30, jit: 0.4, drop: 0.5 },
  { id: 'c4', name: '六维力传感器', dev: '腕部力觉', unit: 'Hz', base: 1000, jit: 6, drop: 0.1 },
  { id: 'c5', name: '关节编码器', dev: '7DOF 机械臂', unit: 'Hz', base: 1000, jit: 5, drop: 0.1 },
  { id: 'c6', name: 'VR 位姿 / 手套', dev: 'PICO + 动捕手套', unit: 'Hz', base: 90, jit: 1.2, drop: 0.2 },
]

/** 监控数据。对接后端后由 WebSocket 推送替换 tick()。 */
export const useMonitor = defineStore('monitor', () => {
  const paused = ref(false)
  const fault = ref(false)
  const r = rng(99)
  const hist = reactive<Record<string, number[]>>({})
  CHANNELS.forEach((c) => { hist[c.id] = Array.from({ length: 40 }, () => c.base + (r() - 0.5) * c.jit * 2) })
  const sync = ref<number[]>(Array.from({ length: 60 }, () => +(4.5 + r() * 3.5 + (r() < 0.04 ? 5 : 0)).toFixed(1)))
  function dropRate(c: Channel) { return c.id === 'c1' ? (fault.value ? 6.8 : 2.4) : c.drop }
  function tick() {
    if (paused.value) return
    CHANNELS.forEach((c) => {
      const h = hist[c.id]
      h.push(c.base + (Math.random() - 0.5) * c.jit * 2 - (c.id === 'c1' && fault.value ? Math.random() * 3 : 0))
      h.shift()
    })
    sync.value.push(+(4.5 + Math.random() * 3.5 + (fault.value ? 3 : 0) + (Math.random() < 0.04 ? 5 : 0)).toFixed(1))
    sync.value.shift()
  }
  return { paused, fault, hist, sync, dropRate, tick }
})
