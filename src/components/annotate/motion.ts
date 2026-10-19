import type { ScenKey } from '@/constants'

/** 演示用的确定性“运动数据”：末端轨迹与灵巧手关节角度，随归一化时间 u∈[0,1] 变化 */
export function traj(u: number, scen: ScenKey): [number, number, number] {
  const T = Math.PI * 2
  if (scen === 'qmd') return [0.1 + 0.34 * Math.sin(T * u), 0.26 * Math.sin(T * u * 2), 0.2 + 0.18 * Math.sin(Math.PI * u) + 0.04 * Math.sin(T * u * 5)]
  return [-0.28 + 0.56 * u + 0.04 * Math.sin(T * u * 4), 0.22 * Math.sin(T * u), 0.34 - 0.22 * Math.sin(Math.PI * u)]
}
export const FINGERS = ['拇指', '食指', '中指', '无名指', '小指']
export const JOINTS = ['MCP', 'PIP', 'DIP']
/** 灵巧手关节角度（度），hand: 0 左 / 1 右 */
export function joint(u: number, hand: number, f: number, j: number): number {
  const grasp = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u * 1.5 + hand * 0.08 + f * 0.05) - 1.2)
  return Math.round(Math.max(2, Math.min(88, (22 + j * 9) + grasp * (48 - j * 6))))
}
export const CAM_NAMES: Record<ScenKey, string[]> = {
  qmd: ['第一视角', '第三视角·左', '第三视角·右', '腕部·左', '腕部·右', '俯视'],
  fhd: ['第一视角', '腕部', '第三视角·左', '第三视角·右', '侧视', '俯视'],
}
export const fmtT = (t: number) => String(Math.floor(t / 60)).padStart(2, '0') + ':' + (t % 60).toFixed(1).padStart(4, '0')
