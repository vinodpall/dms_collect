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

const DEFAULT_CFG: Cfg = {
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
}

export const useSettings = defineStore('settings', () => {
  const cfg = reactive<Cfg>({ ...DEFAULT_CFG })
  const rawSettings = ref<SettingItem[]>([])
  const versions = reactive<Record<string, number>>({})
  const loading = ref(false)
  const loaded = ref(false)

  function applyItems(items: SettingItem[]) {
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
    } else if (map['storage.backup'] !== undefined) {
      cfg.backup = Boolean(map['storage.backup'])
    }

    if (typeof map['alert.switch'] === 'object' && map['alert.switch']) {
      cfg.alertDrop = !!map['alert.switch'].drop
      cfg.alertSync = !!map['alert.switch'].sync
      cfg.alertOffline = !!map['alert.switch'].offline
      cfg.alertStorage = !!map['alert.switch'].storage
    }
    loaded.value = true
  }

  async function fetchSettings() {
    if (!getToken()) return
    loading.value = true
    try {
      const res = await systemApi.getSettings()
      const items = res?.items || []
      applyItems(items)
    } finally {
      loading.value = false
    }
  }

  async function saveSettings(newCfg?: Partial<Cfg>) {
    if (!getToken()) return
    const next: Cfg = { ...cfg, ...(newCfg || {}) }

    const payload: Record<string, any> = {}
    if (newCfg === undefined || 'integrity' in newCfg) payload['quality.integrity'] = next.integrity
    if (newCfg === undefined || 'sync' in newCfg) payload['quality.sync_ms'] = next.sync
    if (newCfg === undefined || 'drop' in newCfg) payload['quality.drop_rate'] = next.drop
    if (newCfg === undefined || 'naming' in newCfg) payload['naming.template'] = next.naming
    if (newCfg === undefined || 'coldDays' in newCfg) payload['storage.cold_days'] = next.coldDays
    if (newCfg === undefined || 'encrypt' in newCfg) payload['storage.encrypt'] = next.encrypt
    if (newCfg === undefined || 'watermark' in newCfg) payload['storage.watermark'] = next.watermark
    if (newCfg === undefined || 'whitelistOn' in newCfg) payload['security.whitelist_on'] = next.whitelistOn
    if (
      newCfg === undefined ||
      'alertDrop' in newCfg ||
      'alertSync' in newCfg ||
      'alertOffline' in newCfg ||
      'alertStorage' in newCfg
    ) {
      payload['alert.switch'] = {
        drop: next.alertDrop,
        sync: next.alertSync,
        offline: next.alertOffline,
        storage: next.alertStorage,
      }
    }

    const versionPayload: Record<string, number> = {}
    for (const k of Object.keys(payload)) {
      if (versions[k] !== undefined) versionPayload[k] = versions[k]
    }

    const res = await systemApi.updateSettings(
      payload,
      Object.keys(versionPayload).length ? versionPayload : undefined
    )
    if (res?.items?.length) {
      applyItems(res.items)
    } else {
      await fetchSettings()
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

  function reset() {
    Object.assign(cfg, DEFAULT_CFG)
    rawSettings.value = []
    Object.keys(versions).forEach((k) => delete versions[k])
    loaded.value = false
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('dms:login', () => {
      fetchSettings().catch(() => {})
    })
    window.addEventListener('dms:logout', reset)
  }

  if (getToken()) {
    fetchSettings().catch((e) => console.warn('[settings] 加载系统设置失败', e))
  }

  return { cfg, rawSettings, versions, loading, loaded, nameFile, fetchSettings, saveSettings, reset }
})
