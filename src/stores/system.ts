import { defineStore } from 'pinia'
import { ref } from 'vue'
import { pad, rng } from '@/utils'

export interface AuditRow { t: string; u: string; k: string; d: string; ip: string }
function auditRows(): AuditRow[] {
  const r = rng(808)
  const acts: [string, string][] = [['登录', '登录系统'], ['任务', '创建采集任务'], ['导出', '导出数据集'], ['配置', '修改存储策略'], ['配置', '修改质检阈值'], ['数据', '删除草稿任务'], ['发布', '发布数据集']]
  const who = ['周工', '张杰', '林悦', '赵工', '李明']
  const out: AuditRow[] = []
  for (let i = 0; i < 42; i++) {
    const a = acts[Math.floor(r() * acts.length)]
    out.push({ t: '10-13 ' + pad(16 - Math.floor(i / 6)) + ':' + pad(Math.floor(r() * 60)), u: who[Math.floor(r() * who.length)], k: a[0], d: a[1], ip: '10.20.' + Math.floor(r() * 4) + '.' + (10 + Math.floor(r() * 80)) })
  }
  return out
}

export const useSystem = defineStore('system', () => {
  const whitelist = ref<string[]>(['10.20.0.0/16', '192.168.8.0/24', '172.16.3.21'])
  const audit = ref<AuditRow[]>(auditRows())
  return { whitelist, audit }
})
