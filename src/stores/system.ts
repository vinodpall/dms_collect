import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import type { RoleKey } from '@/constants'
import { pad, rng } from '@/utils'

export interface UserRow { n: string; r: RoleKey; e: string; last: string; on: boolean }
export interface AuditRow { t: string; u: string; k: string; d: string; ip: string }
export const PERMS: { label: string; roles: RoleKey[] }[] = [
  { label: '创建 / 执行采集任务', roles: ['op'] }, { label: '查看实时监控', roles: ['op', 'mt'] }, { label: '重试处理批次', roles: ['ann', 'rev'] },
  { label: '手动标注', roles: ['ann'] }, { label: '标注审核（通过 / 打回）', roles: ['rev'] }, { label: '发布数据集', roles: ['rev'] }, { label: '导出数据集', roles: ['rev'] },
  { label: '设备台账维护', roles: ['mt'] }, { label: '用户与权限管理', roles: [] }, { label: '修改存储策略', roles: [] },
]

function auditRows(): AuditRow[] {
  const r = rng(808)
  const acts: [string, string][] = [['登录', '登录系统'], ['任务', '创建采集任务'], ['导出', '导出数据集'], ['权限', '修改角色权限'], ['配置', '修改质检阈值'], ['数据', '删除草稿任务'], ['发布', '发布数据集']]
  const who = ['周工', '张杰', '林悦', '赵工', '李明']
  const out: AuditRow[] = []
  for (let i = 0; i < 42; i++) {
    const a = acts[Math.floor(r() * acts.length)]
    out.push({ t: '10-13 ' + pad(16 - Math.floor(i / 6)) + ':' + pad(Math.floor(r() * 60)), u: who[Math.floor(r() * who.length)], k: a[0], d: a[1], ip: '10.20.' + Math.floor(r() * 4) + '.' + (10 + Math.floor(r() * 80)) })
  }
  return out
}

export const useSystem = defineStore('system', () => {
  const users = ref<UserRow[]>([
    { n: '周工', r: 'admin', e: 'zhou@dms.local', last: '今天 08:41', on: true },
    { n: '张杰', r: 'op', e: 'zhangjie@dms.local', last: '今天 09:02', on: true },
    { n: '李明', r: 'op', e: 'liming@dms.local', last: '昨天 17:30', on: true },
    { n: '林悦', r: 'ann', e: 'linyue@dms.local', last: '今天 10:15', on: true },
    { n: '陈静', r: 'rev', e: 'chenjing@dms.local', last: '今天 10:40', on: true },
    { n: '赵工', r: 'mt', e: 'zhao@dms.local', last: '今天 08:55', on: true },
    { n: '陈浩', r: 'op', e: 'chenhao@dms.local', last: '10-09 16:20', on: false },
  ])
  const matrix = reactive<Record<number, Record<RoleKey, boolean>>>(
    Object.fromEntries(PERMS.map((p, i) => [i, { admin: true, op: p.roles.includes('op'), ann: p.roles.includes('ann'), rev: p.roles.includes('rev'), mt: p.roles.includes('mt') }])),
  )
  const whitelist = ref<string[]>(['10.20.0.0/16', '192.168.8.0/24', '172.16.3.21'])
  const audit = ref<AuditRow[]>(auditRows())
  return { users, matrix, whitelist, audit }
})
