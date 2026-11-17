import { defineStore } from 'pinia'
import { ref } from 'vue'
import { systemApi, getToken, type WhitelistItem } from '@/api'

export const useSystem = defineStore('system', () => {
  const whitelist = ref<WhitelistItem[]>([])
  const loading = ref(false)

  async function fetchWhitelist(): Promise<WhitelistItem[]> {
    if (!getToken()) return []
    loading.value = true
    try {
      const items = await systemApi.getWhitelist()
      whitelist.value = Array.isArray(items) ? items : []
      return whitelist.value
    } finally {
      loading.value = false
    }
  }

  async function addWhitelist(cidr: string, remark?: string): Promise<WhitelistItem> {
    const res = await systemApi.addWhitelist(cidr, remark)
    await fetchWhitelist()
    return res
  }

  async function removeWhitelist(id: number): Promise<void> {
    await systemApi.removeWhitelist(id)
    whitelist.value = whitelist.value.filter((item) => item.id !== id)
  }

  function reset() {
    whitelist.value = []
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('dms:login', () => {
      fetchWhitelist().catch(() => {})
    })
    window.addEventListener('dms:logout', reset)
  }

  if (getToken()) {
    fetchWhitelist().catch((e) => console.warn('[system] 获取白名单失败', e))
  }

  return { whitelist, loading, fetchWhitelist, addWhitelist, removeWhitelist, reset }
})
