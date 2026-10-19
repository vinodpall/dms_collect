import { reactive } from 'vue'

export interface ToastItem { id: number; msg: string; type: '' | 'warn' | 'crit'; action?: string; onAction?: () => void }
export const toasts = reactive<ToastItem[]>([])
let seq = 0
export function toast(msg: string, o: { type?: 'warn' | 'crit'; action?: string; onAction?: () => void; ms?: number } = {}) {
  const item: ToastItem = { id: ++seq, msg, type: o.type ?? '', action: o.action, onAction: o.onAction }
  toasts.push(item)
  const kill = () => { const i = toasts.findIndex((t) => t.id === item.id); if (i >= 0) toasts.splice(i, 1) }
  setTimeout(kill, o.ms ?? 4200)
  return kill
}
export function dismissToast(id: number) {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}
