import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { systemApi, getToken, type SettingItem } from '@/api'

export interface Cfg {
  integrity: number
  sync: number
  drop: number
  naming: string
  coldDays: number
  backup: boolean
  encrypt: boolean
  watermark: boolean
  alertOffline: boolean
  alertStorage: boolean
  alertSync: boolean
  alertDrop: boolean
  whitelistOn: boolean
}

export const useSettings = defineStore('settings', () => {
  const cfg = reactive<Cfg>({
    integrity: 99,
    sync: 10,
    drop: 2,
    naming: '{任务}_{日期}_{序号}_{操作员}',
    coldDays: 30,
    backup: true,
    encrypt: true,
    watermark: true,
    alertOffline: true,
    alertStorage: true,
    alertSync: true,
    alertDrop: true,
    whitelistOn: true,
  })

  const rawSettings = ref<SettingItem[]>([])
  const versions = reactive<Record<string, number>>({})
  const loading = ref(false)

  async function fetchSettings() {
    if (!getToken()) return
    loading.value = true
    try {
      const res = await systemApi.getSettings()
      const items = res?.items || []
      rawSettings.value = items

      const map: Record<string, any> = {}
      for (const it of items) {
        map[it.key] = it.value
        versions[it.key] = it.version
      }

      if (map['quality.integrity'] !== undefined) cfg.integrity = Number(map['quality.integrity'])
      if (map['quality.sync_ms'] !== undefined) cfg.sync = Number(map['quality.sync_ms'])
      if (map['quality.drop_rate'] !== undefined) cfg.drop = Number(map['quality.drop_rate'])
      if (map['naming.template'] !== undefined) cfg.naming = String(map['naming.template'])
      if (map['storage.cold_days'] !== undefined) cfg.coldDays = Number(map['storage.cold_days'])
      if (map['storage.encrypt'] !== undefined) cfg.encrypt = Boolean(map['storage.encrypt'])
      if (map['storage.watermark'] !== undefined) cfg.watermark = Boolean(map['storage.watermark'])
      if (map['security.whitelist_on'] !== undefined) cfg.whitelistOn = Boolean(map['security.whitelist_on'])

      if (typeof map['storage.backup'] === 'object' && map['storage.backup']) {
        cfg.backup = !!map['storage.backup'].enabled
      }
      if (typeof map['alert.switch'] === 'object' && map['alert.switch']) {
        cfg.alertDrop = !!map['alert.switch'].drop
        cfg.alertSync = !!map['alert.switch'].sync
        cfg.alertOffline = !!map['alert.switch'].offline
        cfg.alertStorage = !!map['alert.switch'].storage
      }
    } catch (e) {
      console.warn('[settings] 从后端加载设置失败', e)
    } finally {
      loading.value = false
    }
  }

  async function saveSettings(newCfg?: Partial<Cfg>) {
    if (newCfg) Object.assign(cfg, newCfg)
    if (!getToken()) return

    const payload: Record<string, any> = {
      'quality.integrity': cfg.integrity,
      'quality.sync_ms': cfg.sync,
      'quality.drop_rate': cfg.drop,
      'naming.template': cfg.naming,
      'storage.cold_days': cfg.coldDays,
      'storage.encrypt': cfg.encrypt,
      'storage.watermark': cfg.watermark,
      'security.whitelist_on': cfg.whitelistOn,
      'alert.switch': {
        drop: cfg.alertDrop,
        sync: cfg.alertSync,
        offline: cfg.alertOffline,
        storage: cfg.alertStorage,
      },
    }

    try {
      await systemApi.updateSettings(payload)
      // 更新成功后刷新版本
      await fetchSettings()
    } catch (e) {
      console.warn('[settings] 保存设置至后端失败', e)
    }
  }

  function nameFile(code: string, date: string, seq: number, opc: string) {
    return (
      cfg.naming
        .replace('{任务}', code)
        .replace('{日期}', date)
        .replace('{序号}', String(seq).padStart(3, '0'))
        .replace('{操作员}', opc) + '.bag'
    )
  }

  if (getToken()) {
    fetchSettings()
  }

  return { cfg, rawSettings, loading, nameFile, fetchSettings, saveSettings }
})
