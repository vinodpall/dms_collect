/**
 * 登录页主视觉：轮毂产线 · 具身数据采集（three.js）
 * - U 形滚筒输送线 + 支线，金属轮毂沿线流转，导轨流光
 * - 场景①：轮毂气密性检测 —— VR + 动捕手套遥操作两台灵巧手协作臂
 * - 场景②：防护堵安装 —— 手持 UMI 设备安装防护堵，末端轨迹实时记录
 * - 数据流粒子、上传光柱、全息人物、反射与软阴影、鼠标视差
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export type Anchor = 'test' | 'teleop' | 'umi'
export interface HubLineOptions {
  /** 右侧登录区宽度（px），场景居中于剩余区域 */
  reserve: () => number
  onLayout: (pts: Record<Anchor, { x: number; y: number }>) => void
  still?: boolean
}

const BG = 0x06121f
const CYAN = 0x4dd0e1, CYAN_HI = 0x9ff7ff, AMBER = 0xffb74d, OK = 0x4de8b0

/* ---------------- 路径 ---------------- */
type V2 = THREE.Vector2
type Seg = { k: 'l'; a: V2; b: V2 } | { k: 'a'; c: V2; r: number; a0: number; a1: number }
const v2 = (x: number, z: number) => new THREE.Vector2(x, z)
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const segLen = (s: Seg) => (s.k === 'l' ? s.a.distanceTo(s.b) : Math.abs(s.a1 - s.a0) * s.r)
const total = (segs: Seg[]) => segs.reduce((n, g) => n + segLen(g), 0)
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

const R = 1.7, TOP = 0.82, W = 1.0
const MAIN: Seg[] = [
  { k: 'l', a: v2(3.2, R), b: v2(-2.6, R) },
  { k: 'a', c: v2(-2.6, 0), r: R, a0: Math.PI / 2, a1: Math.PI * 1.5 },
  { k: 'l', a: v2(-2.6, -R), b: v2(5.4, -R) },
]
const BRANCH: Seg[] = [{ k: 'l', a: v2(0.6, R + W / 2 + 0.06), b: v2(0.6, R + 3.4) }]

/* ---------------- 材质 ---------------- */
const std = (color: number, metalness: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra })
const MAT = {
  frame: std(0x1a2c3d, 0.75, 0.38),
  frameDk: std(0x101c28, 0.7, 0.45),
  roller: std(0x8a9cab, 0.9, 0.38),
  hub: std(0xb8c6d2, 1, 0.28),
  hubDk: std(0x8796a3, 1, 0.3),
  bench: std(0x13263a, 0.55, 0.3),
  benchTop: std(0x0c1b2a, 0.3, 0.18),
  cobot: std(0xd9e1e8, 0.2, 0.35),
  cobotDk: std(0x2a3642, 0.6, 0.35),
  hand: std(0x3a4652, 0.5, 0.4),
  glow: new THREE.MeshBasicMaterial({ color: CYAN_HI }),
  glowC: new THREE.MeshBasicMaterial({ color: CYAN }),
  amber: new THREE.MeshBasicMaterial({ color: AMBER }),
  helmet: std(0xf2f6f8, 0.1, 0.25),
  visor: new THREE.MeshBasicMaterial({ color: 0x7ff3ff }),
}
const uTime = { value: 0 }
/** 全息材质：菲涅尔边缘 + 扫描线 */
function holo(base: number, rim: number, op = 0.85) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: true,
    uniforms: { uBase: { value: new THREE.Color(base) }, uRim: { value: new THREE.Color(rim) }, uOp: { value: op }, uTime },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vY = w.y; vec4 mv = viewMatrix*w; vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uBase; uniform vec3 uRim; uniform float uOp; uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ float f = pow(1.-abs(dot(normalize(vN), normalize(vV))), 2.2);
        float sl = .82 + .18*step(.5, fract(vY*42. - uTime*1.5));
        float sweep = smoothstep(.06, 0., abs(fract(vY*.35 - uTime*.25) - .5) - .44);
        vec3 c = mix(uBase, uRim, f) * sl + uRim * sweep * .6;
        gl_FragColor = vec4(c, uOp*(.55+.45*f)); }`,
  })
}
/** 流光材质：沿 uv.x（路径长度）流动的光脉冲 */
function flowMat(color: number, speed = 1.2, period = 2.2) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uC: { value: new THREE.Color(color) }, uTime, uS: { value: speed }, uP: { value: period } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform vec3 uC; uniform float uTime; uniform float uS; uniform float uP; varying vec2 vUv;
      void main(){ float k = fract(vUv.x/uP - uTime*uS/uP); float a = .28 + pow(smoothstep(.0,.85,k)*smoothstep(1.,.85,k), 1.5)*1.6; gl_FragColor = vec4(uC*a, 1.); }`,
  })
}

/* ---------------- 几何工具 ---------------- */
/** 沿路径扫掠闭合截面 (u: 法向偏移, v: 高度)，uv.x = 路径长度 */
function sweep(segs: Seg[], prof: [number, number][], step = 0.06) {
  const L = total(segs), n = Math.ceil(L / step)
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  for (let e = 0; e < prof.length; e++) {
    const a = prof[e], b = prof[(e + 1) % prof.length], base = pos.length / 3
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * L, { p, d } = sample(segs, s), nx = -d.y, nz = d.x
      for (const q of [a, b]) { pos.push(p.x + nx * q[0], q[1], p.y + nz * q[0]); uv.push(s, 0) }
      if (i) { const k = base + i * 2 - 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3) }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals()
  return g
}
const rect = (u0: number, u1: number, y0: number, y1: number): [number, number][] => [[u0, y0], [u1, y0], [u1, y1], [u0, y1]]
function at<T extends THREE.Object3D>(o: T, p: THREE.Vector3, r?: THREE.Euler) { o.position.copy(p); if (r) o.rotation.copy(r); return o }
function mesh(g: THREE.BufferGeometry, m: THREE.Material, shadow = true) { const o = new THREE.Mesh(g, m); o.castShadow = shadow; o.receiveShadow = true; return o }
function instanced(g: THREE.BufferGeometry, m: THREE.Material, mats: THREE.Matrix4[]) {
  const o = new THREE.InstancedMesh(g, m, mats.length); mats.forEach((x, i) => o.setMatrixAt(i, x)); o.castShadow = true; o.receiveShadow = true; return o
}
const M4 = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), v3(1, 1, 1))

/* ---------------- 输送线 ---------------- */
function conveyor(segs: Seg[]) {
  const g = new THREE.Group(), L = total(segs)
  for (const sd of [-1, 1]) {
    const u0 = sd * (W / 2), u1 = sd * (W / 2 + 0.07)
    g.add(mesh(sweep(segs, rect(Math.min(u0, u1), Math.max(u0, u1), TOP - 0.16, TOP + 0.05)), MAT.frame))
    const o = sd * (W / 2 + 0.072)
    g.add(mesh(sweep(segs, rect(Math.min(o, o + sd * 0.004), Math.max(o, o + sd * 0.004), TOP - 0.085, TOP - 0.05)), flowMat(CYAN, 1.1), false))
  }
  g.add(mesh(sweep(segs, rect(-W / 2, W / 2, TOP - 0.2, TOP - 0.17)), MAT.frameDk))
  const rollers: THREE.Matrix4[] = []
  for (let s = 0.08; s < L - 0.04; s += 0.16) {
    const { p, d } = sample(segs, s), n = v2(-d.y, d.x)
    rollers.push(M4(p.x, TOP - 0.05, p.y, Math.atan2(-n.y, n.x), 0, Math.PI / 2))
  }
  g.add(instanced(new THREE.CylinderGeometry(0.05, 0.05, W - 0.02, 20), MAT.roller, rollers))
  const legs: THREE.Matrix4[] = [], bars: THREE.Matrix4[] = [], feet: THREE.Matrix4[] = []
  for (let s = 0.3; s < L; s += 1.5) {
    const { p, d } = sample(segs, s)
    for (const sd of [-1, 1]) { const x = p.x - d.y * sd * (W / 2 - 0.02), z = p.y + d.x * sd * (W / 2 - 0.02); legs.push(M4(x, (TOP - 0.18) / 2, z)); feet.push(M4(x, 0.012, z)) }
    bars.push(M4(p.x, 0.26, p.y, Math.atan2(-d.x, -d.y) + Math.PI / 2))
  }
  g.add(instanced(new THREE.BoxGeometry(0.07, TOP - 0.18, 0.07), MAT.frame, legs))
  g.add(instanced(new THREE.BoxGeometry(W - 0.04, 0.05, 0.05), MAT.frame, bars))
  g.add(instanced(new THREE.BoxGeometry(0.14, 0.024, 0.14), MAT.frameDk, feet))
  return g
}

/* ---------------- 轮毂 ---------------- */
let hubGeo: { rim: THREE.BufferGeometry; face: THREE.BufferGeometry; cap: THREE.BufferGeometry; ring: THREE.BufferGeometry } | null = null
function hub(): THREE.Group {
  if (!hubGeo) {
    const rim = new THREE.LatheGeometry([[0.29, 0], [0.37, 0.012], [0.375, 0.04], [0.33, 0.06], [0.322, 0.2], [0.37, 0.22], [0.375, 0.255], [0.29, 0.27], [0.3, 0.135]].map(([x, y]) => v2(x, y)), 64)
    const sh = new THREE.Shape(); sh.absarc(0, 0, 0.325, 0, Math.PI * 2, false)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2, h = new THREE.Path()
      h.absarc(0, 0, 0.27, a - 0.43, a + 0.43, false); h.absarc(0, 0, 0.115, a + 0.3, a - 0.3, true); sh.holes.push(h)
    }
    const face = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 40 })
    face.rotateX(-Math.PI / 2)
    hubGeo = { rim, face, cap: new THREE.CylinderGeometry(0.07, 0.08, 0.05, 32), ring: new THREE.TorusGeometry(0.075, 0.008, 8, 40).rotateX(Math.PI / 2) }
  }
  const g = new THREE.Group()
  g.add(mesh(hubGeo.rim, MAT.hub)); const f = mesh(hubGeo.face, MAT.hub); f.position.y = 0.17; g.add(f)
  const c = mesh(hubGeo.cap, MAT.hubDk); c.position.y = 0.245; g.add(c)
  const r = new THREE.Mesh(hubGeo.ring, MAT.glowC); r.position.y = 0.272; g.add(r)
  return g
}

/* ---------------- 协作臂（灵巧手） ---------------- */
interface Arm { root: THREE.Group; yaw: THREE.Group; sh: THREE.Group; el: THREE.Group; wr: THREE.Group; fingers: THREE.Group[]; tip: THREE.Object3D }
function jointRing(r: number) { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 8, 48), MAT.glowC); return t }
function arm(): Arm {
  const root = new THREE.Group()
  root.add(at(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.08, 40), MAT.cobotDk), v3(0, 0.04, 0)))
  const yaw = new THREE.Group(); yaw.position.y = 0.08; root.add(yaw)
  const col = mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.26, 40), MAT.cobot); col.position.y = 0.13; yaw.add(col)
  const r0 = jointRing(0.112); r0.rotation.x = Math.PI / 2; r0.position.y = 0.03; yaw.add(r0)
  const sh = new THREE.Group(); sh.position.y = 0.3; yaw.add(sh)
  const j1 = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 40), MAT.cobot); j1.rotation.z = Math.PI / 2; sh.add(j1)
  const c1 = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.226, 32), MAT.cobotDk); c1.rotation.z = Math.PI / 2; sh.add(c1)
  const r1 = jointRing(0.1); r1.rotation.y = Math.PI / 2; r1.position.x = 0.11; sh.add(r1)
  const up = mesh(new THREE.CapsuleGeometry(0.07, 0.5, 8, 24), MAT.cobot); up.position.y = 0.3; sh.add(up)
  const el = new THREE.Group(); el.position.y = 0.6; sh.add(el)
  const j2 = mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.19, 36), MAT.cobot); j2.rotation.z = Math.PI / 2; el.add(j2)
  const c2 = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.196, 32), MAT.cobotDk); c2.rotation.z = Math.PI / 2; el.add(c2)
  const r2 = jointRing(0.085); r2.rotation.y = Math.PI / 2; r2.position.x = -0.095; el.add(r2)
  const fo = mesh(new THREE.CapsuleGeometry(0.055, 0.42, 8, 24), MAT.cobot); fo.position.y = 0.25; el.add(fo)
  const wr = new THREE.Group(); wr.position.y = 0.5; el.add(wr)
  const wj = mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.1, 32), MAT.cobotDk); wj.position.y = 0.03; wr.add(wj)
  const r3 = jointRing(0.06); r3.rotation.x = Math.PI / 2; r3.position.y = 0.07; wr.add(r3)
  const palm = mesh(new RoundedBoxGeometry(0.15, 0.15, 0.055, 3, 0.02), MAT.hand); palm.position.y = 0.16; wr.add(palm)
  const fingers: THREE.Group[] = []
  const seg = new THREE.CapsuleGeometry(0.014, 0.05, 4, 10)
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Group()
    if (i === 4) { f.position.set(0.08, 0.13, 0.02); f.rotation.z = -0.9 } else f.position.set(-0.054 + i * 0.036, 0.235, 0)
    let parent: THREE.Object3D = f
    for (let k = 0; k < 3; k++) { const s = mesh(seg, k ? MAT.hand : MAT.cobotDk); s.position.y = 0.03; parent.add(s); const n = new THREE.Group(); n.position.y = 0.06; parent.add(n); parent = n }
    wr.add(f); fingers.push(f)
  }
  const tip = new THREE.Object3D(); tip.position.y = 0.28; wr.add(tip)
  return { root, yaw, sh, el, wr, fingers, tip }
}

/* ---------------- 人物（全息） ---------------- */
const SUIT = holo(0x1a2d6e, 0x7aa2ff), SKIN = holo(0x24408e, 0x9fc0ff)
interface Person { root: THREE.Group; arms: { sh: THREE.Group; el: THREE.Group; hand: THREE.Group }[]; head: THREE.Group }
function person(): Person {
  const root = new THREE.Group()
  const cap = (r: number, l: number, m: THREE.Material) => mesh(new THREE.CapsuleGeometry(r, l, 8, 18), m)
  for (const sx of [-0.095, 0.095]) {
    const th = cap(0.08, 0.32, SUIT); th.position.set(sx, 0.66, 0); root.add(th)
    const sh = cap(0.062, 0.32, SUIT); sh.position.set(sx, 0.25, 0); root.add(sh)
    const ft = mesh(new RoundedBoxGeometry(0.11, 0.07, 0.24, 2, 0.03), SUIT); ft.position.set(sx, 0.035, 0.04); root.add(ft)
  }
  const torso = mesh(new THREE.LatheGeometry([[0, 0], [0.16, 0.0], [0.17, 0.08], [0.15, 0.22], [0.19, 0.42], [0.22, 0.52], [0.12, 0.6], [0, 0.6]].map(([x, y]) => v2(x, y)), 28), SUIT)
  torso.position.y = 0.84; torso.scale.z = 0.68; root.add(torso)
  const neck = cap(0.045, 0.06, SKIN); neck.position.y = 1.47; root.add(neck)
  const head = new THREE.Group(); head.position.y = 1.6; root.add(head)
  head.add(mesh(new THREE.SphereGeometry(0.105, 24, 18), SKIN))
  const helmet = mesh(new THREE.SphereGeometry(0.125, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.helmet); helmet.position.y = 0.025; head.add(helmet)
  const brim = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 32), MAT.helmet); brim.position.set(0, 0.025, 0.015); head.add(brim)
  const arms: Person['arms'] = []
  for (const sx of [-0.23, 0.23]) {
    const sh = new THREE.Group(); sh.position.set(sx, 1.33, 0); root.add(sh)
    const u = cap(0.058, 0.24, SUIT); u.position.y = -0.16; sh.add(u)
    const el = new THREE.Group(); el.position.y = -0.32; sh.add(el)
    const f = cap(0.05, 0.22, SKIN); f.position.y = -0.14; el.add(f)
    const hand = new THREE.Group(); hand.position.y = -0.3; el.add(hand)
    hand.add(mesh(new THREE.SphereGeometry(0.055, 16, 12), SKIN))
    arms.push({ sh, el, hand })
  }
  return { root, arms, head }
}

/* ---------------- 装饰 ---------------- */
function dotTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const x = c.getContext('2d')!, g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(170,250,255,.85)'); g.addColorStop(1, 'rgba(77,208,225,0)')
  x.fillStyle = g; x.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}
const DOT = dotTex()
function beam(h: number, r: number, color: number) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uC: { value: new THREE.Color(color) }, uTime },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 uC; uniform float uTime; varying vec2 vUv; void main(){ float a = pow(1.-vUv.y, 2.2)*.55; a += smoothstep(.04,0.,abs(fract(vUv.y*2.-uTime*.5)-.5)-.44)*(1.-vUv.y)*.5; gl_FragColor = vec4(uC*a, 1.); }',
  })
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32, 1, true), m); o.position.y = h / 2; return o
}
function ring(r0: number, r1: number, color: number, op = 0.8, seg = 96, theta = Math.PI * 2) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, seg, 1, 0, theta), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }))
  m.rotation.x = -Math.PI / 2; return m
}
function dashedRing(r: number, n: number, color: number, op = 0.8) {
  const g = new THREE.Group()
  for (let i = 0; i < n; i++) { const s = ring(r, r + 0.03, color, op, 8, (Math.PI * 2 / n) * 0.55); s.rotation.z = (i / n) * Math.PI * 2; g.add(s) }
  return g
}

/* ---------------- 场景 ---------------- */
export function createHubLine(canvas: HTMLCanvasElement, opt: HubLineOptions) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.setClearColor(new THREE.Color(BG).convertSRGBToLinear(), 1) // OutputPass 会再做一次 sRGB 编码
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = env; scene.environmentIntensity = 0.32
  scene.add(new THREE.HemisphereLight(0x8fd8ff, 0x050d18, 0.35))
  const key = new THREE.DirectionalLight(0xdff4ff, 1.5); key.position.set(-5, 12, 7); key.target.position.set(1.5, 0, 0.5)
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 8, bottom: -8, near: 1, far: 30 })
  scene.add(key, key.target)
  const rim = new THREE.DirectionalLight(0x4dd0e1, 1.4); rim.position.set(9, 4, -8); scene.add(rim)
  const TX = 4.2, TZ = -R - 1.6, OX = 7.3, OZ = -R - 1.55, BX = 0.6, BZ = R + 2.3
  const pl1 = new THREE.PointLight(0x4dd0e1, 2.6, 4.5, 1.6); pl1.position.set(TX, 1.9, TZ + 0.1); scene.add(pl1)
  const pl2 = new THREE.PointLight(0xffc27a, 2.2, 4, 1.6); pl2.position.set(BX + 0.6, 1.7, BZ); scene.add(pl2)

  /* 地面：渐隐网格 + 波纹 */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShaderMaterial({
    uniforms: { uBase: { value: new THREE.Color(BG) }, uLine: { value: new THREE.Color(CYAN) }, uC: { value: v2(1.8, 0.6) }, uTime },
    vertexShader: 'varying vec2 vP; void main(){ vec4 w = modelMatrix*vec4(position,1.); vP = w.xz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform vec3 uBase; uniform vec3 uLine; uniform vec2 uC; uniform float uTime; varying vec2 vP;
      float grid(vec2 p, float s, float w){ vec2 q = p/s; vec2 g = abs(fract(q-.5)-.5)/fwidth(q); return 1.-min(min(g.x,g.y)/w,1.); }
      void main(){ vec2 e = (vP-uC)*vec2(.78,1.); float d = length(e);
        float fade = smoothstep(13.5, 4., d);
        float wave = smoothstep(.25, 0., abs(d - mod(uTime*1.6, 18.)))*fade;
        vec3 c = uBase + uLine*(grid(vP,.5,1.)*.025 + grid(vP,2.5,1.2)*.07)*fade + uLine*.05*smoothstep(10.,0.,d) + uLine*wave*.08;
        gl_FragColor = vec4(c, 1.); }`,
  }))
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.2; scene.add(floor)

  /* 平台：圆角厚板 + 发光包边 */
  const PW = 14.2, PD = 9.9, PCX = 1.9, PCZ = 0.45, PR = 0.9
  const ps = new THREE.Shape()
  ps.moveTo(-PW / 2 + PR, -PD / 2); ps.lineTo(PW / 2 - PR, -PD / 2); ps.quadraticCurveTo(PW / 2, -PD / 2, PW / 2, -PD / 2 + PR)
  ps.lineTo(PW / 2, PD / 2 - PR); ps.quadraticCurveTo(PW / 2, PD / 2, PW / 2 - PR, PD / 2); ps.lineTo(-PW / 2 + PR, PD / 2)
  ps.quadraticCurveTo(-PW / 2, PD / 2, -PW / 2, PD / 2 - PR); ps.lineTo(-PW / 2, -PD / 2 + PR); ps.quadraticCurveTo(-PW / 2, -PD / 2, -PW / 2 + PR, -PD / 2)
  const slab = new THREE.ExtrudeGeometry(ps, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 16 })
  slab.rotateX(Math.PI / 2)
  const plat = mesh(slab, std(0x0a1a2c, 0.75, 0.5), false); plat.position.set(PCX, 0, PCZ); scene.add(plat)
  const edgePts = ps.getSpacedPoints(240).map((p) => v3(p.x + PCX, 0.032, p.y + PCZ))
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edgePts), new THREE.LineBasicMaterial({ color: CYAN_HI, transparent: true, opacity: 0.9 })))
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edgePts.map((p) => p.clone().setY(-0.19))), new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.35 })))
  const pgrid = new THREE.GridHelper(PW - 1, Math.round((PW - 1) / 0.5), CYAN, CYAN)
  Object.assign(pgrid.material, { transparent: true, opacity: 0.06, depthWrite: false }); pgrid.scale.z = (PD - 1) / (PW - 1); pgrid.position.set(PCX, 0.006, PCZ); scene.add(pgrid)
  // 工位地标：发光圆角框
  const pad = (x0: number, z0: number, x1: number, z1: number, c: number) => {
    const s = new THREE.Shape(), r = 0.25
    s.moveTo(x0 + r, z0); s.lineTo(x1 - r, z0); s.quadraticCurveTo(x1, z0, x1, z0 + r); s.lineTo(x1, z1 - r); s.quadraticCurveTo(x1, z1, x1 - r, z1)
    s.lineTo(x0 + r, z1); s.quadraticCurveTo(x0, z1, x0, z1 - r); s.lineTo(x0, z0 + r); s.quadraticCurveTo(x0, z0, x0 + r, z0)
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(s.getSpacedPoints(160).map((p) => v3(p.x, 0.014, p.y))), new THREE.LineDashedMaterial({ color: c, dashSize: 0.16, gapSize: 0.1, transparent: true, opacity: 0.85 }))
    l.computeLineDistances(); scene.add(l)
    const f = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.045, depthWrite: false }))
    f.rotation.x = Math.PI / 2; f.position.y = 0.01; (f.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide; scene.add(f)
  }
  pad(2.45, -R - 2.75, 8.55, -R - 0.7, CYAN)
  pad(-0.5, R + 1.0, 3.6, R + 3.45, AMBER)

  scene.add(conveyor(MAIN), conveyor(BRANCH))

  /* 气密检测工位 */
  const bench = new THREE.Group(); bench.position.set(TX, 0, TZ); scene.add(bench)
  bench.add(at(mesh(new RoundedBoxGeometry(3.0, 0.08, 1.2, 2, 0.03), MAT.benchTop), v3(0, 0.8, 0)))
  bench.add(at(mesh(new THREE.BoxGeometry(2.86, 0.5, 1.06), MAT.bench), v3(0, 0.51, 0)))
  bench.add(at(mesh(new THREE.BoxGeometry(2.9, 0.004, 0.02), MAT.glowC, false), v3(0, 0.62, 0.535)))
  for (const dx of [-1.38, 1.38]) for (const dz of [-0.48, 0.48]) bench.add(at(mesh(new THREE.BoxGeometry(0.08, 0.27, 0.08), MAT.frame), v3(dx, 0.135, dz)))
  // 检测腔：底座 + 玻璃罩 + 扫描环
  bench.add(at(mesh(new THREE.CylinderGeometry(0.5, 0.54, 0.07, 64), MAT.cobotDk), v3(0, 0.875, 0.1)))
  bench.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.01, 8, 80), MAT.glowC), v3(0, 0.91, 0.1), new THREE.Euler(Math.PI / 2, 0, 0)))
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.55, 64, 1, true), holo(0x0a2a3a, 0x7ff3ff, 0.32)); glass.position.set(0, 1.19, 0.1); bench.add(glass)
  const scan = new THREE.Mesh(new THREE.TorusGeometry(0.505, 0.006, 6, 80), MAT.glow); scan.rotation.x = Math.PI / 2; scan.position.set(0, 1.0, 0.1); bench.add(scan)
  const testHub = hub(); testHub.position.set(0, 0.91, 0.1); bench.add(testHub)
  const pulses = [0, 1, 2].map(() => { const r = ring(0.55, 0.57, OK, 0); r.position.set(0, 0.92, 0.1); bench.add(r); return r })
  // 控制柜
  const cab = mesh(new RoundedBoxGeometry(0.5, 1.4, 0.5, 2, 0.03), MAT.bench); cab.position.set(2.05, 0.7, -0.15); bench.add(cab)
  for (let i = 0; i < 4; i++) bench.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.004), i === 1 ? MAT.amber : MAT.glowC), v3(2.05, 1.15 - i * 0.12, 0.103)))
  const arms = [arm(), arm()]
  arms[0].root.position.set(TX - 0.92, 0.84, TZ - 0.28); arms[1].root.position.set(TX + 0.92, 0.84, TZ - 0.28)
  arms.forEach((a) => scene.add(a.root))

  /* 遥操作站 */
  const tp = new THREE.Group(); tp.position.set(OX, 0, OZ); scene.add(tp)
  tp.add(at(mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.06, 64), MAT.cobotDk), v3(0, 0.03, 0)))
  const tr1 = ring(0.62, 0.64, CYAN_HI, 0.9); tr1.position.y = 0.065; tp.add(tr1)
  const tr2 = dashedRing(0.8, 28, CYAN, 0.7); tr2.position.y = 0.02; tp.add(tr2)
  const tr3 = ring(0.4, 0.42, CYAN, 0.5); tr3.position.y = 0.065; tp.add(tr3)
  const op = person(); op.root.position.set(OX, 0.06, OZ); op.root.rotation.y = -Math.PI / 2 - 0.2; scene.add(op.root)
  const vr = mesh(new RoundedBoxGeometry(0.2, 0.09, 0.1, 2, 0.03), MAT.cobotDk); vr.position.set(0, 0, 0.09); op.head.add(vr)
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.022, 0.004), MAT.visor); visor.position.set(0, 0, 0.142); op.head.add(visor)
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 6, 32), MAT.cobotDk); strap.rotation.x = Math.PI / 2; op.head.add(strap)
  for (const a of op.arms) for (let i = 0; i < 6; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), MAT.glow), t = -1 + i * 0.4
    d.position.set(Math.sin(t) * 0.06, -0.02 - Math.cos(t) * 0.035, 0.03); a.hand.add(d)
  }

  /* UMI 工位 */
  const branchHub = hub(); branchHub.position.set(BX, TOP, BZ); scene.add(branchHub)
  const plugs = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 5, p = mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.05, 16), MAT.amber, false)
    p.position.set(Math.sin(a) * 0.19, 0.25, Math.cos(a) * 0.19); p.visible = false; branchHub.add(p); return p
  })
  const bt = new THREE.Group(); bt.position.set(2.95, 0, R + 2.05); bt.rotation.y = Math.PI / 2; scene.add(bt)
  bt.add(at(mesh(new RoundedBoxGeometry(1.0, 0.06, 0.75, 2, 0.02), MAT.benchTop), v3(0, 0.74, 0)))
  for (const dx of [-0.44, 0.44]) for (const dz of [-0.3, 0.3]) bt.add(at(mesh(new THREE.BoxGeometry(0.05, 0.72, 0.05), MAT.frame), v3(dx, 0.36, dz)))
  for (let i = 0; i < 3; i++) { const bx = mesh(new RoundedBoxGeometry(0.22, 0.12, 0.2, 2, 0.02), MAT.bench); bx.position.set(-0.28 + i * 0.27, 0.83, 0.12); bt.add(bx); const lid = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.004, 0.14), MAT.amber); lid.position.set(-0.28 + i * 0.27, 0.892, 0.12); bt.add(lid) }
  const um = person(); um.root.position.set(BX + 1.05, 0, BZ + 0.1); um.root.rotation.y = -Math.PI / 2 + 0.2; scene.add(um.root)
  const umi = new THREE.Group(); um.arms[1].hand.add(umi); umi.rotation.x = Math.PI; umi.position.y = -0.02
  umi.add(mesh(new RoundedBoxGeometry(0.05, 0.15, 0.06, 2, 0.015), MAT.cobotDk))
  umi.add(at(mesh(new RoundedBoxGeometry(0.14, 0.07, 0.16, 2, 0.02), MAT.cobot), v3(0, -0.09, 0.06)))
  umi.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 20), MAT.glow), v3(0, -0.06, 0.145), new THREE.Euler(Math.PI / 2, 0, 0)))
  const jaws = [-1, 1].map((sd) => { const j = mesh(new RoundedBoxGeometry(0.02, 0.045, 0.13, 1, 0.006), MAT.hand); j.position.set(sd * 0.045, -0.11, 0.2); umi.add(j); return j })
  const umiTip = new THREE.Object3D(); umiTip.position.set(0, -0.11, 0.26); umi.add(umiTip)
  // 末端轨迹
  const TRN = 70, trail = new Float32Array(TRN * 3), trailC = new Float32Array(TRN * 3)
  const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(trail, 3)); trailGeo.setAttribute('color', new THREE.BufferAttribute(trailC, 3))
  scene.add(new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })))
  // 上料工人
  const wk = person(); wk.root.position.set(-3.95, 0, R + 1.05); wk.root.rotation.y = Math.PI * 0.72; scene.add(wk.root)
  wk.arms.forEach((a) => { a.sh.rotation.x = -0.75; a.el.rotation.x = -0.6 })

  /* 上传光柱 */
  const b1 = beam(3.2, 0.06, CYAN); b1.position.set(TX + 2.05, 1.4 + 1.6, TZ - 0.15); scene.add(b1)

  /* 流转轮毂 */
  const LM = total(MAIN), N = 7
  const flow = Array.from({ length: N }, () => { const h = hub(); scene.add(h); return h })

  /* 数据流粒子 + 环境浮尘 */
  const PN = 54, pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(PN * 3), 3))
  scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ map: DOT, color: CYAN_HI, size: 0.11, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })))
  const DN = 160, dust = new Float32Array(DN * 3), dustSeed = Array.from({ length: DN }, () => [Math.random() * 14 - 5, Math.random() * 4, Math.random() * 10 - 4.2, 0.1 + Math.random() * 0.25])
  const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3))
  scene.add(new THREE.Points(dGeo, new THREE.PointsMaterial({ map: DOT, color: 0x7fdcff, size: 0.05, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })))
  let curves: THREE.QuadraticBezierCurve3[] = []
  const tmp = new THREE.Vector3()

  /* 相机 + 后期 */
  const cam = new THREE.PerspectiveCamera(26, 1, 0.5, 200)
  const target = v3(1.7, 0.5, 0.55), dir0 = v3(0.66, 0.7, 1).normalize()
  let dist = 26
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, cam))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 0.86)
  composer.addPass(bloom); composer.addPass(new OutputPass())

  const BOX = new THREE.Box3(v3(PCX - PW / 2, -0.2, PCZ - PD / 2), v3(PCX + PW / 2, 1.9, PCZ + PD / 2))
  const anchorsW: Record<Anchor, THREE.Vector3> = { test: v3(TX, 1.55, TZ + 0.1), teleop: v3(OX, 1.9, OZ), umi: v3(BX + 0.2, 1.25, BZ) }
  const par = { x: 0, y: 0, tx: 0, ty: 0 }
  let W0 = 0, H0 = 0, offX = 0, offY = 0
  function place() {
    const d = dir0.clone().applyAxisAngle(v3(0, 1, 0), par.x * 0.07)
    d.y += par.y * 0.04; d.normalize()
    cam.position.copy(target).addScaledVector(d, dist); cam.lookAt(target); cam.updateMatrixWorld()
  }
  function layout() {
    const w = canvas.clientWidth, h = canvas.clientHeight
    if (!w || !h) return
    W0 = w; H0 = h
    renderer.setSize(w, h, false); composer.setSize(w, h); cam.aspect = w / h; cam.clearViewOffset()
    const res = opt.reserve(), aw = Math.max(320, w - res), ah = h - 40
    const fw = aw * (res ? 1.0 : 1.05), fh = ah * 0.96
    let cx = 0, cy = 0
    for (let it = 0; it < 5; it++) {
      place(); cam.updateProjectionMatrix()
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      for (let i = 0; i < 8; i++) {
        tmp.set(i & 1 ? BOX.max.x : BOX.min.x, i & 2 ? BOX.max.y : BOX.min.y, i & 4 ? BOX.max.z : BOX.min.z).project(cam)
        x0 = Math.min(x0, tmp.x); x1 = Math.max(x1, tmp.x); y0 = Math.min(y0, tmp.y); y1 = Math.max(y1, tmp.y)
      }
      const pw = (x1 - x0) / 2 * w, ph = (y1 - y0) / 2 * h
      dist *= Math.max(pw / fw, ph / fh)
      cx = (x0 + x1) / 4 * w; cy = (y0 + y1) / 4 * h // 相对屏幕中心（px，y 向上）
    }
    offX = w / 2 + cx - aw / 2; offY = -cy
    cam.setViewOffset(w, h, offX, offY, w, h)
    emit(true)
  }
  let last = ''
  function emit(force = false) {
    const out = {} as Record<Anchor, { x: number; y: number }>
    for (const k of Object.keys(anchorsW) as Anchor[]) { tmp.copy(anchorsW[k]).project(cam); out[k] = { x: Math.round((tmp.x + 1) / 2 * W0), y: Math.round((1 - tmp.y) / 2 * H0) } }
    const sig = JSON.stringify(out); if (force || sig !== last) { last = sig; opt.onLayout(out) }
  }
  const onMove = (e: PointerEvent) => { par.tx = (e.clientX / window.innerWidth - 0.5) * 2; par.ty = (e.clientY / window.innerHeight - 0.5) * 2 }
  if (!opt.still) window.addEventListener('pointermove', onMove, { passive: true })

  /* 动画 */
  const ease = (x: number) => x * x * (3 - 2 * x)
  let trailInit = false
  function update(t: number) {
    uTime.value = t
    flow.forEach((h, i) => {
      const s = (t * 0.4 + (i * LM) / N) % LM, { p } = sample(MAIN, s)
      const e = Math.max(0, Math.min(1, s / 0.6, (LM - s) / 0.6))
      h.position.set(p.x, TOP, p.y); h.scale.setScalar(Math.max(0.001, ease(e))); h.rotation.y = s * 0.25
    })
    const ph = t * 1.2
    arms.forEach((a, i) => {
      const q = ph + i * 0.9, sd = i ? -1 : 1
      a.yaw.rotation.y = sd * (Math.PI / 2 - 0.32) + Math.sin(q * 0.5) * 0.1
      a.sh.rotation.x = 0.9 + Math.sin(q) * 0.08
      a.el.rotation.x = 0.95 + Math.sin(q * 0.8 + 1) * 0.1
      a.wr.rotation.x = 0.75 + Math.sin(q * 1.3) * 0.15
      a.fingers.forEach((f, k) => { const c = 0.3 + Math.sin(q * 1.6 + k * 0.4) * 0.28; f.rotation.x = c; (f.children[1] as THREE.Object3D).rotation.x = c; ((f.children[1] as THREE.Object3D).children[1] as THREE.Object3D).rotation.x = c * 0.8 })
      const o = op.arms[i]
      o.sh.rotation.x = -1.05 - Math.sin(q) * 0.12; o.sh.rotation.z = (i ? -1 : 1) * 0.14
      o.el.rotation.x = -0.55 - Math.sin(q * 0.8 + 1) * 0.14
    })
    op.head.rotation.y = Math.sin(t * 0.6) * 0.12
    scan.position.y = 0.97 + (Math.sin(t * 1.4) * 0.5 + 0.5) * 0.42
    pulses.forEach((r, i) => { const k = (t * 0.45 + i / 3) % 1; r.scale.setScalar(1 + k * 0.8); (r.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.7 })
    tr2.rotation.y = t * 0.25; tr1.scale.setScalar(1 + Math.sin(t * 2) * 0.02)
    const cyc = (t % 7.5) / 7.5, n = Math.floor(cyc * 6)
    plugs.forEach((p, i) => { p.visible = i < n })
    const ua = um.arms[1], w = t * 2.4
    ua.sh.rotation.x = -1.15 - Math.sin(w) * 0.1; ua.sh.rotation.z = 0.15 + Math.sin(w * 0.5) * 0.08; ua.el.rotation.x = -0.35 + Math.sin(w) * 0.14
    um.arms[0].sh.rotation.x = -0.5; um.arms[0].el.rotation.x = -0.9
    jaws.forEach((j, i) => { j.position.x = (i ? 1 : -1) * (0.03 + Math.abs(Math.sin(w)) * 0.022) })
    for (let i = 0; i < DN; i++) { const s = dustSeed[i]; dust[i * 3] = s[0] + Math.sin(t * 0.3 + i) * 0.15; dust[i * 3 + 1] = (s[1] + t * s[3]) % 4; dust[i * 3 + 2] = s[2] }
    dGeo.attributes.position.needsUpdate = true
    scene.updateMatrixWorld()
    // UMI 末端轨迹
    umiTip.getWorldPosition(tmp)
    if (!trailInit) { for (let i = 0; i < TRN; i++) trail.set([tmp.x, tmp.y, tmp.z], i * 3); trailInit = true }
    trail.copyWithin(3, 0, (TRN - 1) * 3); trail[0] = tmp.x; trail[1] = tmp.y; trail[2] = tmp.z
    for (let i = 0; i < TRN; i++) { const k = 1 - i / TRN; trailC[i * 3] = k; trailC[i * 3 + 1] = 0.72 * k; trailC[i * 3 + 2] = 0.3 * k }
    trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true
    // 数据流
    if (!curves.length) {
      curves = [0, 1].map((i) => {
        const a = op.arms[i].hand.getWorldPosition(new THREE.Vector3()), z = arms[i].tip.getWorldPosition(new THREE.Vector3())
        return new THREE.QuadraticBezierCurve3(a, a.clone().lerp(z, 0.5).setY(Math.max(a.y, z.y) + 1.0), z)
      })
    }
    const arr = pGeo.attributes.position.array as Float32Array
    for (let i = 0; i < PN; i++) { const c = curves[i % 2], k = (t * 0.42 + Math.floor(i / 2) / (PN / 2)) % 1; c.getPoint(k, tmp); arr.set([tmp.x, tmp.y, tmp.z], i * 3) }
    pGeo.attributes.position.needsUpdate = true
  }

  let raf = 0, visible = true
  const t0 = performance.now()
  const frame = (t: number) => {
    par.x += (par.tx - par.x) * 0.04; par.y += (par.ty - par.y) * 0.04
    place(); update(t); composer.render(); emit()
  }
  const loop = () => { raf = requestAnimationFrame(loop); if (visible) frame((performance.now() - t0) / 1000) }
  const ro = new ResizeObserver(() => { layout(); if (opt.still) frame(3.2) })
  ro.observe(canvas)
  const onVis = () => { visible = !document.hidden }
  document.addEventListener('visibilitychange', onVis)
  layout()
  if (opt.still) frame(3.2); else loop()

  return {
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pointermove', onMove)
      scene.traverse((o) => { (o as THREE.Mesh).geometry?.dispose?.() })
      env.dispose(); pmrem.dispose(); composer.dispose(); renderer.dispose()
    },
  }
}
