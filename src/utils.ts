export const pad = (n: number) => String(n).padStart(2, '0')
export const fmt = (n: number) => Number(n).toLocaleString('en-US')
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
/** 可复现的伪随机数（mulberry32），保证示例数据每次刷新一致 */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function lsGet(k: string): string | null {
  try { return localStorage.getItem(k) } catch { return null }
}
export function lsSet(k: string, v: string) {
  try { localStorage.setItem(k, v) } catch { /* 隐私模式 */ }
}
