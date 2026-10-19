import { defineStore } from 'pinia'
import { reactive } from 'vue'

export interface Cfg {
  integrity: number; sync: number; drop: number; naming: string; coldDays: number
  backup: boolean; encrypt: boolean; watermark: boolean
  alertOffline: boolean; alertStorage: boolean; alertSync: boolean; alertDrop: boolean; whitelistOn: boolean
}
export const useSettings = defineStore('settings', () => {
  const cfg = reactive<Cfg>({
    integrity: 99, sync: 10, drop: 2, naming: '{任务}_{日期}_{序号}_{操作员}', coldDays: 30,
    backup: true, encrypt: true, watermark: true,
    alertOffline: true, alertStorage: true, alertSync: true, alertDrop: true, whitelistOn: true,
  })
  function nameFile(code: string, date: string, seq: number, opc: string) {
    return cfg.naming.replace('{任务}', code).replace('{日期}', date).replace('{序号}', String(seq).padStart(3, '0')).replace('{操作员}', opc) + '.bag'
  }
  return { cfg, nameFile }
})
