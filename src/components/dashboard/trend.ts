import { pad, rng } from '@/utils'

export type Range = 'today' | '7d' | '30d'
export interface TrendData { labels: string[]; vr: number[]; um: number[]; unit: string; all: { vr: number[]; um: number[] } }

export function trendData(range: Range): TrendData {
  const r = rng(30), vr: number[] = [], um: number[] = []
  for (let i = 0; i < 30; i++) { vr.push(Math.round(38 + r() * 30 + i * 0.4)); um.push(Math.round(32 + r() * 26 + i * 0.3)) }
  vr[27] = 52; um[27] = 50; vr[28] = 60; um[28] = 54; vr[29] = 70; um[29] = 58
  const base = new Date(2026, 9, 13), labels: string[] = []
  for (let i = 29; i >= 0; i--) { const d = new Date(base); d.setDate(base.getDate() - i); labels.push(pad(d.getMonth() + 1) + '-' + pad(d.getDate())) }
  if (range === 'today') {
    return { labels: ['08', '09', '10', '11', '12', '13', '14', '15', '16'].map((h) => h + ':00'), vr: [8, 11, 10, 5, 4, 10, 11, 8, 3], um: [7, 9, 8, 4, 5, 9, 8, 6, 2], unit: '条 / 小时', all: { vr, um } }
  }
  const n = range === '7d' ? 7 : 30
  return { labels: labels.slice(30 - n), vr: vr.slice(30 - n), um: um.slice(30 - n), unit: '条 / 天', all: { vr, um } }
}

export function niceMax(max: number) {
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => Math.ceil(max / s) <= 5) || 500
  return { top: Math.max(step, Math.ceil(max / step) * step), step }
}
