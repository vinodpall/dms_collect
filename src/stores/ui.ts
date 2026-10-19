import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 跨页面的界面状态：全局搜索、移动端导航、需要从别处唤起的抽屉和向导 */
export const useUi = defineStore('ui', () => {
  const paletteOpen = ref(false)
  const navOpen = ref(false)
  const taskDrawerId = ref<string | null>(null)
  const wizardOpen = ref(false)
  const datasetDrawerId = ref<string | null>(null)
  const datasetViewerId = ref<string | null>(null)
  return { paletteOpen, navOpen, taskDrawerId, wizardOpen, datasetDrawerId, datasetViewerId }
})
