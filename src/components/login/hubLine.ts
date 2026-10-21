/**
 * 登录页主视觉：轮毂产线数据采集场景（three.js · 蓝图线框风格）
 * - U 形滚筒输送线 + 支线，轮毂沿线流转
 * - 场景①：轮毂气密性检测 —— 操作员佩戴 VR + 动捕手套，遥操作两台灵巧手机械臂
 * - 场景②：防护堵安装 —— 操作员手持 UMI 设备安装防护堵
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export type Anchor = 'test' | 'teleop' | 'umi'
export interface HubLineOptions {
  /** 右侧登录区宽度（px），场景居中于剩余区域 */
  reserve: () => number
  onLayout: (pts: Record<Anchor, { x: number; y: number }>) => void
  still?: boolean
}

const BG = 0x081827
const C = {
  frame: 0x0f2c44, frameHi: 0x14405f, roller: 0x0f5a5a, hub: 0x6f93a8, table: 0x10324c, arm: 0x1a4766, skin: 0x203a8a,
  edge: 0x4dd0e1, edgeDim: 0x2b7f99, edgeHub: 0xd8f6ff, roll: 0x3fe0c0, amber: 0xffb74d, ok: 0x4de8b0,
}

/* ---------------- 路径 ---------------- */
type V2 = THREE.Vector2
type Seg = { k: 'l'; a: V2; b: V2 } | { k: 'a'; c: V2; r: number; a0: number; a1: number }
const v2 = (x: number, z: number) => new THREE.Vector2(x, z)
const segLen = (s: Seg) => (s.k === 'l' ? s.a.distanceTo(s.b) : Math.abs(s.a1 - s.a0) * s.r)
function sample(segs: Seg[], s: number): { p: V2; d: V2 } {
  for (const g of segs) {
    const L = segLen(g)
    if (s <= L || g === segs[segs.length - 1]) {
      const t = Math.min(1, Math.max(0, s / L))
      if (g.k === 'l') return { p: g.a.clone().lerp(g.b, t), d: g.b.clone().sub(g.a).normalize() }
      const a = g.a0 + (g.a1 - g.a0) * t, sg = Math.sign(g.a1 - g.a0)
      return { p: v2(g.c.x + g.r * Math.cos(a), g.c.y + g.r * Math.sin(a)), d: v2(-Math.sin(a) * sg, Math.cos(a) * sg) }
    }
    s -= L
  }
  return { p: v2(0, 0), d: v2(1, 0) }
}
const total = (segs: Seg[]) => segs.reduce((n, g) => n + segLen(g), 0)

const R = 1.7, TOP = 0.82, W = 1.0
const MAIN: Seg[] = [
  { k: 'l', a: v2(3.2, R), b: v2(-2.6, R) },
  { k: 'a', c: v2(-2.6, 0), r: R, a0: Math.PI / 2, a1: Math.PI * 1.5 },
  { k: 'l', a: v2(-2.6, -R), b: v2(5.6, -R) },
]
const BRANCH: Seg[] = [{ k: 'l', a: v2(0.6, R + W / 2 + 0.05), b: v2(0.6, R + 3.6) }]

/* ---------------- 合批 ---------------- */
class Batch {
  fills = new Map<number, THREE.BufferGeometry[]>()
  edges = new Map<string, THREE.BufferGeometry[]>()
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, fill: number, edge: number | null = C.edge, op = 0.55, thr = 32) {
    const f = g.clone(); f.deleteAttribute('uv'); if (!f.index) f.setIndex([...Array(f.attributes.position.count).keys()])
    f.applyMatrix4(m); (this.fills.get(fill) ?? this.fills.set(fill, []).get(fill)!).push(f)
    if (edge !== null) { const k = `${edge}|${op}`; const e = new THREE.EdgesGeometry(g, thr).applyMatrix4(m); (this.edges.get(k) ?? this.edges.set(k, []).get(k)!).push(e) }
  }
  build(): THREE.Group {
    const grp = new THREE.Group()
    for (const [c, gs] of this.fills) grp.add(new THREE.Mesh(mergeGeometries(gs), mat(c)))
    for (const [k, gs] of this.edges) { const [c, op] = k.split('|').map(Number); grp.add(new THREE.LineSegments(mergeGeometries(gs), lineMat(c, op))) }
    return grp
  }
}
const matCache = new Map<number, THREE.Material>()
function mat(c: number) {
  if (!matCache.has(c)) matCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3, emissive: c, emissiveIntensity: 0.15, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }))
  return matCache.get(c)!
}
const lineCache = new Map<string, THREE.LineBasicMaterial>()
function lineMat(c: number, op: number) {
  const k = `${c}|${op}`
  if (!lineCache.has(k)) lineCache.set(k, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: op }))
  return lineCache.get(k)!
}
const M = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s))

/** 单个网格并带描边（可动部件用） */
function part(g: THREE.BufferGeometry, fill: number, edge = C.edge, op = 0.6, thr = 32) {
  const m = new THREE.Mesh(g, mat(fill))
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, thr), lineMat(edge, op)))
  return m
}

/* ---------------- 输送线 ---------------- */
function ribbon(pts: THREE.Vector3[], h: number) {
  const pos: number[] = [], idx: number[] = []
  pts.forEach((p, i) => { pos.push(p.x, p.y, p.z, p.x, p.y + h, p.z); if (i) { const a = i * 2 - 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) } })
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
  return g
}
function conveyor(b: Batch, segs: Seg[], lines: THREE.Group) {
  const L = total(segs)
  const roller = new THREE.CylinderGeometry(0.055, 0.055, W - 0.06, 14)
  for (let s = 0.1; s < L - 0.05; s += 0.19) {
    const { p, d } = sample(segs, s)
    const n = v2(-d.y, d.x)
    b.add(roller, M(p.x, TOP - 0.055, p.y, Math.atan2(-n.y, n.x), 0, Math.PI / 2), C.roller, C.roll, 0.5, 40)
  }
  // 侧挡板（带上下描边）
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = []
    for (let s = 0; s <= L + 1e-6; s += 0.1) { const { p, d } = sample(segs, Math.min(s, L)); pts.push(new THREE.Vector3(p.x - d.y * side * (W / 2 + 0.02), TOP - 0.13, p.y + d.x * side * (W / 2 + 0.02))) }
    b.add(ribbon(pts, 0.19), new THREE.Matrix4(), C.frameHi, null)
    const fp = pts.map((q) => { const o = q.clone(); return o })
    const strip = ribbon(fp.map((q) => { const { p } = { p: q }; return p.clone().setY(TOP - 0.085) }), 0.035)
    const uv: number[] = []; let acc = 0
    fp.forEach((q, i) => { if (i) acc += q.distanceTo(fp[i - 1]); uv.push(acc, 0, acc, 1) })
    strip.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    // 外移 1 cm 避免与挡板 z-fighting
    const pos = strip.attributes.position as THREE.BufferAttribute
    for (let k = 0; k < pos.count; k++) { const i = k >> 1, { d } = sample(segs, Math.min(i * 0.1, L)); pos.setX(k, pos.getX(k) - d.y * side * 0.012); pos.setZ(k, pos.getZ(k) + d.x * side * 0.012) }
    lines.add(new THREE.Mesh(strip, FLOW))
    for (const dy of [0, 0.19]) lines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((q) => q.clone().setY(q.y + dy))), lineMat(C.edge, dy ? 0.95 : 0.5)))
  }
  // 支腿 + 横撑
  const leg = new THREE.BoxGeometry(0.07, TOP - 0.13, 0.07)
  const bar = new THREE.BoxGeometry(W, 0.05, 0.05)
  for (let s = 0.25; s < L; s += 1.45) {
    const { p, d } = sample(segs, s), ang = Math.atan2(-d.x, -d.y) // 横撑沿法向
    for (const side of [-1, 1]) b.add(leg, M(p.x - d.y * side * W / 2, (TOP - 0.13) / 2, p.y + d.x * side * W / 2), C.frame, C.edgeDim, 0.7)
    b.add(bar, M(p.x, 0.24, p.y, ang + Math.PI / 2), C.frame, C.edgeDim, 0.6)
  }
}

/* ---------------- 轮毂 ---------------- */
const hubLathe = new THREE.LatheGeometry([[0.27, 0], [0.36, 0.015], [0.36, 0.05], [0.31, 0.07], [0.31, 0.2], [0.36, 0.22], [0.36, 0.26], [0.27, 0.27]].map(([x, y]) => new THREE.Vector2(x, y)), 36)
function hub(): THREE.Group {
  const g = new THREE.Group()
  g.add(part(hubLathe, C.hub, C.edgeHub, 0.85, 40))
  const face = new THREE.CylinderGeometry(0.29, 0.29, 0.02, 36)
  const f = part(face, 0x5c7f94, C.edgeHub, 0.6, 40); f.position.y = 0.2; g.add(f)
  const c = part(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 18), C.hub, C.edgeHub, 0.9, 40); c.position.y = 0.23; g.add(c)
  for (let i = 0; i < 5; i++) {
    const s = part(new THREE.BoxGeometry(0.05, 0.035, 0.2), C.hub, C.edgeHub, 0.8)
    const a = (i / 5) * Math.PI * 2; s.position.set(Math.sin(a) * 0.17, 0.225, Math.cos(a) * 0.17); s.rotation.y = a; g.add(s)
  }
  return g
}

/* ---------------- 机械臂（灵巧手） ---------------- */
interface Arm { root: THREE.Group; yaw: THREE.Group; sh: THREE.Group; el: THREE.Group; wr: THREE.Group; fingers: THREE.Group[]; tip: THREE.Object3D }
function arm(): Arm {
  const root = new THREE.Group()
  const base = part(new THREE.CylinderGeometry(0.15, 0.17, 0.1, 24), C.arm, C.edge, 0.8, 40); base.position.y = 0.05; root.add(base)
  const yaw = new THREE.Group(); yaw.position.y = 0.1; root.add(yaw)
  const col = part(new THREE.CylinderGeometry(0.1, 0.11, 0.24, 20), C.arm, C.edge, 0.7, 40); col.position.y = 0.12; yaw.add(col)
  const sh = new THREE.Group(); sh.position.y = 0.28; yaw.add(sh)
  const j1 = part(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 20), C.frameHi, C.edge, 0.8, 40); j1.rotation.z = Math.PI / 2; sh.add(j1)
  const up = part(new THREE.BoxGeometry(0.1, 0.56, 0.1), C.arm, C.edge, 0.75); up.position.y = 0.28; sh.add(up)
  const el = new THREE.Group(); el.position.y = 0.56; sh.add(el)
  const j2 = part(new THREE.CylinderGeometry(0.075, 0.075, 0.17, 20), C.frameHi, C.edge, 0.8, 40); j2.rotation.z = Math.PI / 2; el.add(j2)
  const fo = part(new THREE.BoxGeometry(0.08, 0.46, 0.08), C.arm, C.edge, 0.75); fo.position.y = 0.23; el.add(fo)
  const wr = new THREE.Group(); wr.position.y = 0.46; el.add(wr)
  const wj = part(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 16), C.frameHi, C.edge, 0.9, 40); wj.position.y = 0.04; wr.add(wj)
  const palm = part(new THREE.BoxGeometry(0.15, 0.15, 0.05), 0x2a5f86, C.edge, 0.9); palm.position.y = 0.155; wr.add(palm)
  const fingers: THREE.Group[] = []
  const seg = new THREE.BoxGeometry(0.028, 0.07, 0.03)
  for (let i = 0; i < 5; i++) {
    const thumb = i === 4
    const f = new THREE.Group()
    if (thumb) { f.position.set(0.085, 0.13, 0.02); f.rotation.z = -0.9 } else f.position.set(-0.054 + i * 0.036, 0.23, 0)
    let parent: THREE.Object3D = f
    for (let k = 0; k < 2; k++) { const s = part(seg, 0x2f6c96, C.edge, 0.9); s.position.y = 0.035; parent.add(s); const n = new THREE.Group(); n.position.y = 0.07; parent.add(n); parent = n }
    wr.add(f); fingers.push(f)
  }
  const tip = new THREE.Object3D(); tip.position.y = 0.26; wr.add(tip)
  return { root, yaw, sh, el, wr, fingers, tip }
}

/* ---------------- 人物（全息材质） ---------------- */
const uTime = { value: 0 }
function holoMat(base: number, rim: number, op = 0.9) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: true,
    uniforms: { uBase: { value: new THREE.Color(base) }, uRim: { value: new THREE.Color(rim) }, uOp: { value: op }, uTime },
    vertexShader: 'varying vec3 vN; varying float vY; void main(){ vec4 w = modelMatrix*vec4(position,1.); vY = w.y; vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform vec3 uBase; uniform vec3 uRim; uniform float uOp; uniform float uTime; varying vec3 vN; varying float vY;
      void main(){ float f = pow(1.-abs(normalize(vN).z), 2.0);
        float sl = .8 + .2*step(.5, fract(vY*46. - uTime*1.5));
        float sw = smoothstep(.05, 0., abs(fract(vY*.4 - uTime*.3) - .5) - .45);
        gl_FragColor = vec4(mix(uBase, uRim, f)*sl + uRim*sw*.7, uOp*(.6+.4*f)); }`,
  })
}
/** 导轨流光：沿 uv.x（路径长度）流动 */
function flowMat(color: number, speed = 1.1, period = 2.4) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uC: { value: new THREE.Color(color) }, uTime, uS: { value: speed }, uP: { value: period } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform vec3 uC; uniform float uTime; uniform float uS; uniform float uP; varying vec2 vUv;
      void main(){ float k = fract(vUv.x/uP - uTime*uS/uP); float a = .18 + pow(smoothstep(0.,.85,k)*smoothstep(1.,.85,k), 1.4)*1.5; gl_FragColor = vec4(uC*a, 1.); }`,
  })
}
const FLOW = flowMat(0x4dd0e1)
const SKIN = holoMat(0x223a86, 0x7fa8ff)
const SUIT = holoMat(0x1c2f6e, 0x6d8dff)
const GLOW = new THREE.MeshBasicMaterial({ color: 0x9ff7ff })
const AMBER = new THREE.MeshBasicMaterial({ color: C.amber })
interface Person { root: THREE.Group; arms: { sh: THREE.Group; el: THREE.Group; hand: THREE.Group }[]; head: THREE.Group }
function person(): Person {
  const root = new THREE.Group()
  const cap = (r: number, l: number, m: THREE.Material) => new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 8, 18), m)
  for (const sx of [-0.095, 0.095]) {
    const th = cap(0.08, 0.32, SUIT); th.position.set(sx, 0.66, 0); root.add(th)
    const sh = cap(0.062, 0.32, SUIT); sh.position.set(sx, 0.25, 0); root.add(sh)
    const ft = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.07, 0.24, 2, 0.03), SUIT); ft.position.set(sx, 0.035, 0.04); root.add(ft)
  }
  const torso = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.16, 0], [0.17, 0.08], [0.15, 0.22], [0.19, 0.42], [0.22, 0.52], [0.12, 0.6], [0, 0.6]].map(([x, y]) => v2(x, y)), 28), SUIT)
  torso.position.y = 0.84; torso.scale.z = 0.68; root.add(torso)
  const neck = cap(0.045, 0.06, SKIN); neck.position.y = 1.47; root.add(neck)
  const head = new THREE.Group(); head.position.y = 1.6; root.add(head)
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18), SKIN))
  const hm = holoMat(0x9fc8e0, 0xd8eefa, 0.7)
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), hm); helmet.position.y = 0.025; head.add(helmet)
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 32), hm); brim.position.set(0, 0.025, 0.015); head.add(brim)
  const arms: Person['arms'] = []
  for (const sx of [-0.23, 0.23]) {
    const sh = new THREE.Group(); sh.position.set(sx, 1.33, 0); root.add(sh)
    const u = cap(0.058, 0.24, SUIT); u.position.y = -0.16; sh.add(u)
    const el = new THREE.Group(); el.position.y = -0.32; sh.add(el)
    const f = cap(0.05, 0.22, SKIN); f.position.y = -0.14; el.add(f)
    const hand = new THREE.Group(); hand.position.y = -0.3; el.add(hand)
    hand.add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), SKIN))
    arms.push({ sh, el, hand })
  }
  return { root, arms, head }
}
/** 动捕手套标记点 */
function gloveMarkers(hand: THREE.Group) {
  for (let i = 0; i < 5; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), GLOW); const a = -0.9 + i * 0.45; d.position.set(Math.sin(a) * 0.065, -0.03 - Math.cos(a) * 0.03, 0.03); hand.add(d) }
}
/** UMI 手持采集夹爪 */
function umiDevice(): { g: THREE.Group; jaws: THREE.Mesh[] } {
  const g = new THREE.Group()
  const handle = part(new THREE.BoxGeometry(0.05, 0.16, 0.06), 0x1f4f72, C.edge, 0.9); handle.position.set(0, 0.0, 0); g.add(handle)
  const body = part(new THREE.BoxGeometry(0.14, 0.07, 0.16), 0x245a80, C.edge, 0.95); body.position.set(0, -0.09, 0.06); g.add(body)
  const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 16), GLOW); cam.rotation.x = Math.PI / 2; cam.position.set(0, -0.06, 0.15); g.add(cam)
  const jaws: THREE.Mesh[] = []
  for (const sx of [-0.045, 0.045]) { const j = part(new THREE.BoxGeometry(0.02, 0.04, 0.13), 0x2f6c96, C.edge, 0.95); j.position.set(sx, -0.11, 0.2); g.add(j); jaws.push(j) }
  return { g, jaws }
}

function dotTex() {
  const c = document.createElement('canvas'); c.width = c.height = 32
  const x = c.getContext('2d')!, g = x.createRadialGradient(16, 16, 0, 16, 16, 16)
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(160,247,255,.9)'); g.addColorStop(1, 'rgba(77,208,225,0)')
  x.fillStyle = g; x.fillRect(0, 0, 32, 32)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}

/* ---------------- 场景 ---------------- */
export function createHubLine(canvas: HTMLCanvasElement, opt: HubLineOptions) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(new THREE.Color(BG).convertSRGBToLinear(), 1) // 经 OutputPass 再做一次 sRGB 编码，这里预先线性化
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0x9fdcff, 0x06121f, 0.7))
  const sun = new THREE.DirectionalLight(0xbfeaff, 1.1); sun.position.set(-4, 10, 6); scene.add(sun)
  const fill = new THREE.DirectionalLight(0x4dd0e1, 0.6); fill.position.set(8, 3, -6); scene.add(fill)

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100)
  const target = new THREE.Vector3(1.6, 0.6, 0.6)
  const dir = new THREE.Vector3(0.62, 0.78, 1).normalize()
  cam.position.copy(target).addScaledVector(dir, 30); cam.lookAt(target); cam.updateMatrixWorld()

  /* 平台 + 网格 */
  const b = new Batch(), lines = new THREE.Group()
  b.add(new THREE.BoxGeometry(14.6, 0.16, 10.8), M(2, -0.08, 0.8), 0x061524, C.edge, 0.5)
  const grid = new THREE.GridHelper(14.6, 29, C.edgeDim, C.edgeDim)
  ;(grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.14
  grid.scale.z = 10.8 / 14.6; grid.position.set(2, 0.002, 0.8); scene.add(grid)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShaderMaterial({
    uniforms: { uBase: { value: new THREE.Color(BG).convertSRGBToLinear() }, uLine: { value: new THREE.Color(C.edge) }, uC: { value: v2(2, 0.8) }, uTime },
    vertexShader: 'varying vec2 vP; void main(){ vec4 w = modelMatrix*vec4(position,1.); vP = w.xz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform vec3 uBase; uniform vec3 uLine; uniform vec2 uC; uniform float uTime; varying vec2 vP;
      float grid(vec2 p, float s){ vec2 q = p/s; vec2 g = abs(fract(q-.5)-.5)/fwidth(q); return 1.-min(min(g.x,g.y),1.); }
      void main(){ float d = length((vP-uC)*vec2(.75,1.)); float fade = smoothstep(15., 6., d);
        float wave = smoothstep(.3, 0., abs(d - 6. - mod(uTime*1.4, 10.)))*fade;
        gl_FragColor = vec4(uBase + uLine*(grid(vP,.5)*.02 + grid(vP,2.)*.06 + wave*.018)*fade, 1.); }`,
  }))
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.17; scene.add(floor)
  // 作业区地标线
  const zone = (x0: number, z0: number, x1: number, z1: number, c: number) => {
    const g = new THREE.BufferGeometry().setFromPoints([v3(x0, 0.01, z0), v3(x1, 0.01, z0), v3(x1, 0.01, z1), v3(x0, 0.01, z1), v3(x0, 0.01, z0)])
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: c, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.8 })); l.computeLineDistances(); scene.add(l)
  }
  const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  zone(2.4, -R - 2.6, 8.9, -R - 0.65, C.edge)
  zone(-0.6, R + 1.2, 3.6, R + 4.2, C.amber)

  conveyor(b, MAIN, lines)
  conveyor(b, BRANCH, lines)

  /* 气密检测工位：工作台 + 检测腔 */
  const TX = 4.3, TZ = -R - 1.55
  b.add(new THREE.BoxGeometry(3.0, 0.08, 1.15), M(TX, 0.78, TZ), C.table, C.edge, 0.8)
  for (const [dx, dz] of [[-1.4, -0.5], [1.4, -0.5], [-1.4, 0.5], [1.4, 0.5]]) b.add(new THREE.BoxGeometry(0.07, 0.74, 0.07), M(TX + dx, 0.37, TZ + dz), C.frame, C.edgeDim, 0.7)
  b.add(new THREE.BoxGeometry(2.9, 0.05, 1.05), M(TX, 0.2, TZ), C.frame, C.edgeDim, 0.5)
  b.add(new THREE.CylinderGeometry(0.46, 0.5, 0.08, 36), M(TX, 0.86, TZ + 0.08), 0x153a57, C.edge, 0.9, 40)
  // 控制柜
  b.add(new THREE.BoxGeometry(0.5, 1.3, 0.45), M(TX + 2.0, 0.65, TZ - 0.15), C.table, C.edge, 0.7)
  // 遥操作站：圆形平台
  const OX = 7.4, OZ = -R - 1.45
  b.add(new THREE.CylinderGeometry(0.62, 0.66, 0.06, 40), M(OX, 0.03, OZ), 0x0f3550, C.edge, 0.9, 40)
  // UMI 工位小桌
  b.add(new THREE.BoxGeometry(0.9, 0.06, 0.7), M(2.75, 0.72, R + 3.35), C.table, C.edge, 0.8)
  for (const [dx, dz] of [[-0.4, -0.3], [0.4, -0.3], [-0.4, 0.3], [0.4, 0.3]]) b.add(new THREE.BoxGeometry(0.05, 0.7, 0.05), M(2.75 + dx, 0.35, R + 3.35 + dz), C.frame, C.edgeDim, 0.7)
  b.add(new THREE.BoxGeometry(0.24, 0.16, 0.24), M(2.6, 0.83, R + 3.3, 0.3), 0x184463, C.edge, 0.7) // 防护堵料盒
  // 左侧上料位小桌
  b.add(new THREE.BoxGeometry(0.8, 0.06, 0.8), M(-3.2, 0.72, R + 1.5), C.table, C.edge, 0.7)
  for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) b.add(new THREE.BoxGeometry(0.05, 0.7, 0.05), M(-3.2 + dx, 0.35, R + 1.5 + dz), C.frame, C.edgeDim, 0.7)

  scene.add(b.build(), lines)

  /* 检测腔内轮毂 + 脉冲环 */
  const testHub = hub(); testHub.position.set(TX, 0.9, TZ + 0.08); scene.add(testHub)
  const rings: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.43, 48), new THREE.MeshBasicMaterial({ color: C.ok, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }))
    r.rotation.x = -Math.PI / 2; r.position.set(TX, 0.93, TZ + 0.08); scene.add(r); rings.push(r)
  }
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.5, 48, 1, true), holoMat(0x0a2a3a, 0x7ff3ff, 0.28)); glass.position.set(TX, 1.15, TZ + 0.08); scene.add(glass)
  const scan = new THREE.Mesh(new THREE.TorusGeometry(0.475, 0.006, 6, 72), GLOW); scan.rotation.x = Math.PI / 2; scan.position.set(TX, 1.0, TZ + 0.08); scene.add(scan)
  const ring = (r0: number, r1: number, c: number, op: number, theta = Math.PI * 2) => { const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 72, 1, 0, theta), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); m.rotation.x = -Math.PI / 2; return m }
  const padRing = ring(0.5, 0.52, 0x9ff7ff, 0.9); padRing.position.set(OX, 0.065, OZ); scene.add(padRing)
  const dash = new THREE.Group(); dash.position.set(OX, 0.02, OZ); scene.add(dash)
  for (let i = 0; i < 26; i++) { const sgm = ring(0.78, 0.81, C.edge, 0.75, (Math.PI * 2 / 26) * 0.55); sgm.rotation.z = (i / 26) * Math.PI * 2; dash.add(sgm) }
  const beamM = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uC: { value: new THREE.Color(C.edge) }, uTime },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 uC; uniform float uTime; varying vec2 vUv; void main(){ float a = pow(1.-vUv.y, 2.)*.5 + smoothstep(.04,0.,abs(fract(vUv.y*2.-uTime*.5)-.5)-.44)*(1.-vUv.y)*.6; gl_FragColor = vec4(uC*a, 1.); }' })
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 24, 1, true), beamM); beam.position.set(TX + 2.0, 1.3 + 1.3, TZ - 0.15); scene.add(beam)
  // 两台灵巧手机械臂
  const arms = [arm(), arm()]
  arms[0].root.position.set(TX - 0.95, 0.82, TZ - 0.25)
  arms[1].root.position.set(TX + 0.95, 0.82, TZ - 0.25)
  for (const a of arms) scene.add(a.root)

  /* 遥操作员：VR + 动捕手套 */
  const op = person(); op.root.position.set(OX, 0.06, OZ); op.root.rotation.y = -Math.PI / 2 - 0.15; scene.add(op.root)
  const vr = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.1), holoMat(0x0e1a3a, 0x9ff7ff, 1)); vr.position.set(0, 0.0, 0.11); op.head.add(vr)
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.02, 0.005), GLOW); visor.position.set(0, 0.0, 0.163); op.head.add(visor)
  for (const a of op.arms) gloveMarkers(a.hand)

  /* UMI 操作员 */
  const BX = 0.6, BZ = R + 2.35
  const branchHub = hub(); branchHub.position.set(BX, TOP, BZ); scene.add(branchHub)
  const plugs: THREE.Mesh[] = []
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 5
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12), AMBER); p.position.set(Math.sin(a) * 0.2, 0.25, Math.cos(a) * 0.2); p.visible = false
    branchHub.add(p); plugs.push(p)
  }
  const um = person(); um.root.position.set(BX + 1.05, 0, BZ + 0.15); um.root.rotation.y = -Math.PI / 2 + 0.25; scene.add(um.root)
  const umi = umiDevice(); um.arms[1].hand.add(umi.g); umi.g.rotation.x = Math.PI; umi.g.position.y = -0.02
  // 上料工人（静态）
  const wk = person(); wk.root.position.set(-3.9, 0, R + 1.0); wk.root.rotation.y = Math.PI * 0.75; scene.add(wk.root)
  wk.arms.forEach((a) => { a.sh.rotation.x = -0.7; a.el.rotation.x = -0.6 })

  /* 流转轮毂 */
  const LM = total(MAIN), N = 6
  const flow = Array.from({ length: N }, () => { const h = hub(); scene.add(h); return h })

  /* 数据流粒子：手套 → 机械臂；UMI → 上方 */
  const PN = 40
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(PN * 3), 3))
  const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ map: dotTex(), color: 0x9ff7ff, size: 7, sizeAttenuation: false, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }))
  scene.add(pts)
  const DN = 140, dust = new Float32Array(DN * 3), seed = Array.from({ length: DN }, () => [Math.random() * 14 - 5, Math.random() * 3.5, Math.random() * 10 - 4, 0.08 + Math.random() * 0.2])
  const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3))
  scene.add(new THREE.Points(dGeo, new THREE.PointsMaterial({ map: dotTex(), color: 0x7fdcff, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })))
  const TRN = 60, trail = new Float32Array(TRN * 3), trailC = new Float32Array(TRN * 3)
  const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(trail, 3)); trailGeo.setAttribute('color', new THREE.BufferAttribute(trailC, 3))
  scene.add(new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })))
  let trailInit = false
  const curves: THREE.QuadraticBezierCurve3[] = []
  const tmp = new THREE.Vector3()

  /* 后期：泛光 */
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, cam))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.35, 0.62)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  /* 布局：正交视锥适配场景，居中到左侧可用区域 */
  const BOX = new THREE.Box3(new THREE.Vector3(-5.3, -0.16, -4.6), new THREE.Vector3(9.3, 1.6, 6.2))
  const anchorsW: Record<Anchor, THREE.Vector3> = { test: v3(TX, 1.7, TZ), teleop: v3(OX, 2.0, OZ), umi: v3(BX + 0.5, 1.5, BZ) }
  function layout() {
    const w = canvas.clientWidth, h = canvas.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false); composer.setSize(w, h)
    const res = opt.reserve(), aw = Math.max(320, w - res), ah = h - 90
    const fw = aw * (res ? 0.99 : 1.02), fh = ah * 0.94
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (let i = 0; i < 8; i++) {
      tmp.set(i & 1 ? BOX.max.x : BOX.min.x, i & 2 ? BOX.max.y : BOX.min.y, i & 4 ? BOX.max.z : BOX.min.z).applyMatrix4(cam.matrixWorldInverse)
      x0 = Math.min(x0, tmp.x); x1 = Math.max(x1, tmp.x); y0 = Math.min(y0, tmp.y); y1 = Math.max(y1, tmp.y)
    }
    const k = Math.max((x1 - x0) / fw, (y1 - y0) / fh) // 世界单位 / 像素
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, sx = aw * 0.5, sy = 50 + ah / 2
    cam.left = cx - sx * k; cam.right = cx + (w - sx) * k; cam.top = cy + sy * k; cam.bottom = cy - (h - sy) * k
    cam.updateProjectionMatrix()
    const out = {} as Record<Anchor, { x: number; y: number }>
    for (const key of Object.keys(anchorsW) as Anchor[]) { tmp.copy(anchorsW[key]).project(cam); out[key] = { x: (tmp.x + 1) / 2 * w, y: (1 - tmp.y) / 2 * h } }
    opt.onLayout(out)
  }

  /* 动画 */
  const ease = (x: number) => x * x * (3 - 2 * x)
  function update(t: number) {
    uTime.value = t
    scan.position.y = 0.95 + (Math.sin(t * 1.4) * 0.5 + 0.5) * 0.4
    dash.rotation.y = t * 0.25; padRing.scale.setScalar(1 + Math.sin(t * 2) * 0.03)
    for (let i = 0; i < DN; i++) { const q = seed[i]; dust[i * 3] = q[0] + Math.sin(t * 0.3 + i) * 0.15; dust[i * 3 + 1] = (q[1] + t * q[3]) % 3.5; dust[i * 3 + 2] = q[2] }
    dGeo.attributes.position.needsUpdate = true
    // 流转轮毂（两端缩放淡入淡出）
    flow.forEach((h, i) => {
      const s = (t * 0.42 + (i * LM) / N) % LM
      const { p } = sample(MAIN, s)
      const e = Math.min(1, s / 0.6, (LM - s) / 0.6)
      h.position.set(p.x, TOP, p.y); h.scale.setScalar(Math.max(0.001, ease(Math.max(0, e)))); h.rotation.y = s * 0.3
    })
    // 遥操作：人手与机械臂同相
    const ph = t * 1.25
    arms.forEach((a, i) => {
      const q = ph + i * 0.9, side = i ? -1 : 1
      a.yaw.rotation.y = side * (Math.PI / 2 - 0.32) + Math.sin(q * 0.5) * 0.1
      a.sh.rotation.x = 0.62 + Math.sin(q) * 0.1
      a.el.rotation.x = 1.15 + Math.sin(q * 0.8 + 1) * 0.14
      a.wr.rotation.x = 0.95 + Math.sin(q * 1.3) * 0.15
      a.fingers.forEach((f, k) => { const c = 0.35 + Math.sin(q * 1.6 + k * 0.4) * 0.3; f.rotation.x = c; (f.children[1] as THREE.Object3D).rotation.x = c * 0.8 })
      const o = op.arms[i]
      o.sh.rotation.x = -1.05 - Math.sin(q) * 0.12; o.sh.rotation.z = (i ? -1 : 1) * 0.12
      o.el.rotation.x = -0.55 - Math.sin(q * 0.8 + 1) * 0.15
    })
    op.head.rotation.y = Math.sin(t * 0.6) * 0.12
    // 气密检测脉冲
    rings.forEach((r, i) => { const k = ((t * 0.5 + i / 3) % 1); r.scale.setScalar(1 + k * 0.9); (r.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.75 })
    // UMI：靠近-安装-复位循环
    const cyc = (t % 7.5) / 7.5, n = Math.floor(cyc * 6)
    plugs.forEach((p, i) => { p.visible = i < n })
    const ua = um.arms[1]
    ua.sh.rotation.x = -1.15 - Math.sin(t * 2.4) * 0.08; ua.el.rotation.x = -0.35 + Math.sin(t * 2.4) * 0.12; ua.sh.rotation.z = 0.15
    um.arms[0].sh.rotation.x = -0.5; um.arms[0].el.rotation.x = -0.9
    umi.jaws.forEach((j, i) => { j.position.x = (i ? 1 : -1) * (0.03 + Math.abs(Math.sin(t * 2.4)) * 0.025) })
    // 数据流
    scene.updateMatrixWorld()
    umi.g.localToWorld(tmp.set(0, -0.11, 0.26))
    if (!trailInit) { for (let i = 0; i < TRN; i++) trail.set([tmp.x, tmp.y, tmp.z], i * 3); trailInit = true }
    trail.copyWithin(3, 0, (TRN - 1) * 3); trail[0] = tmp.x; trail[1] = tmp.y; trail[2] = tmp.z
    for (let i = 0; i < TRN; i++) { const k = 1 - i / TRN; trailC[i * 3] = k; trailC[i * 3 + 1] = 0.72 * k; trailC[i * 3 + 2] = 0.3 * k }
    trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true
    if (!curves.length) {
      for (let i = 0; i < 2; i++) {
        const a = op.arms[i].hand.getWorldPosition(new THREE.Vector3()), z = arms[i].tip.getWorldPosition(new THREE.Vector3())
        curves.push(new THREE.QuadraticBezierCurve3(a, a.clone().lerp(z, 0.5).setY(Math.max(a.y, z.y) + 1.1), z))
      }
      const u = umi.g.getWorldPosition(new THREE.Vector3())
      curves.push(new THREE.QuadraticBezierCurve3(u, u.clone().add(v3(0.5, 0.9, 0.2)), u.clone().add(v3(0.9, 2.2, 0.4))))
    }
    const arr = pGeo.attributes.position.array as Float32Array
    for (let i = 0; i < PN; i++) {
      const c = curves[i % 3], k = ((t * (i % 3 === 2 ? 0.35 : 0.45)) + (Math.floor(i / 3) / Math.ceil(PN / 3))) % 1
      c.getPoint(k, tmp); arr[i * 3] = tmp.x; arr[i * 3 + 1] = tmp.y; arr[i * 3 + 2] = tmp.z
    }
    pGeo.attributes.position.needsUpdate = true
  }

  let raf = 0, t0 = performance.now(), visible = true
  const loop = () => { raf = requestAnimationFrame(loop); if (!visible) return; update((performance.now() - t0) / 1000); composer.render() }
  const ro = new ResizeObserver(() => { layout(); if (opt.still) { update(3.2); composer.render() } })
  ro.observe(canvas)
  const onVis = () => { visible = !document.hidden }
  document.addEventListener('visibilitychange', onVis)
  layout()
  if (opt.still) { update(3.2); composer.render() } else loop()

  return {
    relayout: layout,
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis)
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.() })
      composer.dispose(); renderer.dispose()
    },
  }
}
