import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CASES, ISLE_TOP, SLOW_POS } from '../scenes'
import { clayMesh, tint, type Part } from './sdf'

// 群岛：九座小岛加乌龟的小岛，以及岛上的树、屋、石头、路灯、灯塔和小船。
// 形状全部在这里用代码生成：岛是按轮廓起伏的地形，树冠和石头是捏出来的，房子是圆角的积木。

const sm = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
// 可重复的随机数和平滑噪声
export const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647)
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
const noise = (x: number, y: number) => {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  return (hash(xi, yi) * (1 - ux) + hash(xi + 1, yi) * ux) * (1 - uy) + (hash(xi, yi + 1) * (1 - ux) + hash(xi + 1, yi + 1) * ux) * uy
}

// ---------- 小岛的轮廓 ----------
export type Isle = { x: number; z: number; s: number; seed: number; lobes: [number, number, number][] }
function makeIsle(x: number, z: number, s: number, seed: number): Isle {
  const r = rng(seed * 7919 + 13)
  const lobes: [number, number, number][] = [[0, 0, 0.9 * s]]
  const n = 7
  const a0 = r() * 6.28
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.5
    const d = (0.56 + r() * 0.18) * s
    lobes.push([Math.cos(a) * d, Math.sin(a) * d, (0.4 + r() * 0.13) * s])
  }
  return { x, z, s, seed, lobes }
}
export const SLOW_S = 0.94
export const ISLES: Isle[] = [...CASES.map((c, i) => makeIsle(c.pos[0], c.pos[1], 1, i + 1)), makeIsle(SLOW_POS[0], SLOW_POS[1], SLOW_S, 11)]
// 到岸线的距离：正数在水里，负数在岛上（x、z 相对岛心）
export function isleD(it: Isle, x: number, z: number) {
  let v = 1e9
  const k = 0.22 * it.s
  for (const [cx, cz, cr] of it.lobes) {
    const d = Math.hypot(x - cx, z - cz) - cr
    const h = Math.max(k - Math.abs(v - d), 0) / k
    v = Math.min(v, d) - h * h * k * 0.25
  }
  return v
}
// 全场任意一点到最近岸线的距离
export function shoreD(x: number, z: number) {
  let v = 1e9
  for (const it of ISLES) {
    const dx = x - it.x
    const dz = z - it.z
    if (Math.abs(dx) > 2.6 || Math.abs(dz) > 2.6) {
      v = Math.min(v, Math.hypot(dx, dz) - 1.5 * it.s)
      continue
    }
    v = Math.min(v, isleD(it, dx, dz))
  }
  return v
}
// 岛面的高度：水边一圈缓缓的沙滩，往里一道圆滚滚的台阶，上面是平的草地
export function isleH(it: Isle, x: number, z: number) {
  const d = isleD(it, x, z)
  const top = ISLE_TOP * (it.s < 1 ? 0.84 : 1)
  if (d > 0) return -0.07 * sm(0, 0.14, d)
  const inn = -d
  const wob = (noise(x * 3.1 + it.seed * 9, z * 3.1) - 0.5) * 0.05
  return 0.075 * sm(0, 0.15, inn) + (top - 0.075) * sm(0.15 + wob, 0.26 + wob, inn)
}
const colors = { sand: new THREE.Color('#e6d5b0'), wet: new THREE.Color('#b59d74'), g1: new THREE.Color('#8d9f66'), g2: new THREE.Color('#6b8556'), g3: new THREE.Color('#a9b47c'), earth: new THREE.Color('#8a7a50') }

export type Spot = { x: number; z: number; r: number } // 布景脚下要压暗的地方
export function isleGeo(it: Isle, spots: Spot[] = []) {
  const cell = 0.05
  const R = 1.8 * it.s
  const n = Math.ceil((2 * R) / cell)
  const idx = new Int32Array((n + 1) * (n + 1)).fill(-1)
  const pos: number[] = []
  const nor: number[] = []
  const col: number[] = []
  const top = ISLE_TOP * (it.s < 1 ? 0.84 : 1)
  const c = new THREE.Color()
  const nv = new THREE.Vector3()
  const at = (i: number, j: number) => {
    const key = j * (n + 1) + i
    if (idx[key] >= 0) return idx[key]
    const x = -R + i * cell
    const z = -R + j * cell
    const y = isleH(it, x, z)
    const e = 0.012
    nv.set(isleH(it, x - e, z) - isleH(it, x + e, z), 2 * e, isleH(it, x, z - e) - isleH(it, x, z + e)).normalize()
    // 颜色：水线附近是湿沙，往上是干沙；台阶的坡面露一点土；顶上是深浅不匀的草
    const n1 = noise(x * 2.4 + it.seed * 3, z * 2.4)
    const n2 = noise(x * 7 + 5, z * 7 + it.seed)
    c.copy(colors.wet).lerp(colors.sand, sm(0.0, 0.05, y))
    const grass = sm(0.085 + (n2 - 0.5) * 0.03, 0.115 + (n2 - 0.5) * 0.03, y)
    const gc = new THREE.Color().copy(colors.g1).lerp(colors.g2, sm(0.35, 0.7, n1)).lerp(colors.g3, sm(0.62, 0.9, n2) * 0.55)
    gc.lerp(colors.earth, sm(0.93, 0.7, nv.y) * sm(top - 0.02, 0.1, y) * 0.7)
    c.lerp(gc, grass)
    // 台阶根部和布景脚下的一圈暗（接触阴影）
    let dk = 1 - 0.2 * sm(0.03, 0.0, Math.abs(y - 0.08)) * sm(0.99, 0.9, nv.y)
    for (const s of spots) dk *= 1 - 0.38 * sm(s.r, s.r * 0.25, Math.hypot(x - s.x, z - s.z))
    c.multiplyScalar(dk)
    idx[key] = pos.length / 3
    pos.push(x, y, z)
    nor.push(nv.x, nv.y, nv.z)
    col.push(c.r, c.g, c.b)
    return idx[key]
  }
  const index: number[] = []
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = -R + (i + 0.5) * cell
      const z = -R + (j + 0.5) * cell
      if (isleD(it, x, z) > 0.17) continue
      const a = at(i, j)
      const b = at(i + 1, j)
      const d = at(i, j + 1)
      const e = at(i + 1, j + 1)
      index.push(a, d, b, b, d, e)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(index)
  return g
}

// ---------- 布景零件 ----------
const cache = new Map<string, THREE.BufferGeometry>()
const once = (k: string, f: () => THREE.BufferGeometry) => {
  let g = cache.get(k)
  if (!g) cache.set(k, (g = f()))
  return g
}
const shadeY = (y0: number, y1: number, lo = 0.72) => (p: THREE.Vector3, c: THREE.Color) => void c.multiplyScalar(lo + (1 - lo) * sm(y0, y1, p.y))
// 把几个带顶点颜色的几何体并成一个（各自先摆到位）
export function merge(items: { g: THREE.BufferGeometry; p?: [number, number, number]; r?: [number, number, number]; s?: number | [number, number, number] }[]) {
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const gs = items.map(({ g, p = [0, 0, 0], r = [0, 0, 0], s = 1 }) => {
    const o = g.clone()
    for (const k of Object.keys(o.attributes)) if (!['position', 'normal', 'color'].includes(k)) o.deleteAttribute(k)
    if (!o.index) o.setIndex([...Array(o.attributes.position.count).keys()])
    const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s)
    return o.applyMatrix4(m.compose(new THREE.Vector3(...p), q.setFromEuler(new THREE.Euler(...r)), sc))
  })
  const out = mergeGeometries(gs)!
  gs.forEach((g) => g.dispose())
  return out
}

const TREE = { green: ['#8ea86a', '#4f7450'], deep: ['#5c8a6c', '#2b5446'], pink: ['#e3b7ad', '#b98580'], gold: ['#e2b65a', '#b5843a'] } as const
export function treeGeo(kind: keyof typeof TREE) {
  return once('tree' + kind, () => {
    const r = rng(kind.length * 31 + 7)
    const [hi, lo] = TREE[kind]
    // 树冠：一个圆润的主体，旁边三团、顶上一团，融得很开，轮廓干净
    const parts: Part[] = [{ t: 'e', p: [0, 0.8, 0], r: [0.3, 0.28, 0.3], c: lo }]
    const a0 = r() * 6.283
    for (let i = 0; i < 3; i++) {
      const a = a0 + (i / 3) * 6.283 + (r() - 0.5) * 0.5
      parts.push({ t: 'e', p: [Math.cos(a) * 0.17, 0.7 + r() * 0.1, Math.sin(a) * 0.17], r: [0.2, 0.19, 0.2], c: lo })
    }
    parts.push({ t: 'e', p: [0.04, 1.0, 0.03], r: [0.19, 0.17, 0.19], c: lo })
    const top = new THREE.Color(hi)
    const leaf = clayMesh(parts, 0.045, 0.11, { paint: (p, n, c) => void c.lerp(top, Math.min(1, Math.max(0, sm(0.6, 1.08, p.y + n.y * 0.12) * 0.85 + (noise(p.x * 9, p.z * 9 + p.y * 7) - 0.5) * 0.3))), ao: 0.9 })
    const trunk = clayMesh(
      [
        { t: 'c', a: [0, 0.02, 0], b: [0.015, 0.6, 0], r: 0.042, r2: 0.032, c: '#6e4a34' },
        { t: 'e', p: [0, 0.02, 0], r: [0.075, 0.035, 0.075], c: '#624230' },
      ],
      0.034,
      0.05,
    )
    return merge([{ g: leaf }, { g: trunk }])
  })
}
export const bushGeo = () =>
  once('bush', () => {
    const top = new THREE.Color('#93a96c')
    const b = clayMesh(
      [
        { t: 'e', p: [0, 0.13, 0], r: [0.2, 0.15, 0.2], c: '#4f7450' },
        { t: 'e', p: [0.16, 0.1, -0.04], r: [0.14, 0.11, 0.14], c: '#4f7450' },
        { t: 'e', p: [-0.15, 0.1, 0.03], r: [0.15, 0.12, 0.14], c: '#4f7450' },
        { t: 'e', p: [0.02, 0.09, -0.15], r: [0.13, 0.1, 0.13], c: '#4f7450' },
      ],
      0.04,
      0.05,
      { paint: (p, n, c) => void c.lerp(top, sm(0.05, 0.27, p.y + n.y * 0.06) * 0.8) },
    )
    const r = rng(5)
    const berry = tint(new THREE.SphereGeometry(0.018, 8, 6), '#c9512f')
    const items = [{ g: b }] as Parameters<typeof merge>[0]
    for (let i = 0; i < 6; i++) {
      const a = r() * 6.28
      const e = 0.5 + r() * 0.6
      items.push({ g: berry, p: [Math.cos(a) * Math.cos(e) * 0.2, 0.13 + Math.sin(e) * 0.13, Math.sin(a) * Math.cos(e) * 0.2] })
    }
    return merge(items)
  })
export const pineGeo = () =>
  once('pine', () => {
    const items: Parameters<typeof merge>[0] = [{ g: tint(new THREE.CylinderGeometry(0.06, 0.085, 0.6, 10), '#8f573a', shadeY(-0.3, 0.3)), p: [0, 0.3, 0] }]
    for (let i = 0; i < 5; i++) {
      const y0 = 0.42 + i * 0.26
      const r = 0.4 - i * 0.068
      const pts = [[0.001, 0.4], [r * 0.25, 0.3], [r * 0.62, 0.12], [r, -0.03], [r * 0.95, -0.075], [r * 0.5, -0.04], [0.001, -0.03]].map(([x, y]) => new THREE.Vector2(x, y))
      const g = new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(18).map((p) => p.setX(Math.max(0.001, p.x))), 20)
      g.computeVertexNormals()
      items.push({ g: tint(g, '#2a5a48', (p, c) => void c.lerp(new THREE.Color('#6a9a70'), sm(-0.05, 0.38, p.y) * 0.75).multiplyScalar(0.72 + 0.28 * sm(0, r, Math.hypot(p.x, p.z)))), p: [0, y0, 0] })
    }
    return merge(items)
  })
export const rocksGeo = () =>
  once('rocks', () => {
    const moss = new THREE.Color('#8a9f62')
    const hi = new THREE.Color('#cfc8ba')
    const parts: Part[] = []
    for (let i = 0; i < 3; i++) {
      const x = i * 0.6 - 0.6
      parts.push({ t: 'e', p: [x, 0.07, 0], r: [0.15 + 0.04 * i, 0.1, 0.12], c: '#a49c90', k: 0.03 }, { t: 'e', p: [x + 0.07, 0.1, -0.04], r: [0.1, 0.085, 0.09], c: '#a49c90', k: 0.03 }, { t: 'e', p: [x - 0.06, 0.05, 0.03], r: [0.09, 0.06, 0.08], c: '#a49c90', k: 0.03 })
    }
    return clayMesh(parts, 0.028, 0.03, { paint: (p, n, c) => void c.lerp(hi, noise(p.x * 14, p.z * 14 + p.y * 9)).lerp(moss, sm(0.75, 0.95, n.y) * sm(0.45, 0.6, noise(p.x * 7 + 3, p.z * 7)) * 0.85) })
  })
// 小屋：圆角的墙、两片斜屋顶、烟囱、门、台阶、窗框。发光的窗单独返回。
export function houseGeo(kind: 'a' | 'b') {
  const [wall, roof] = kind === 'a' ? ['#f1e4cb', '#bf6247'] : ['#ecdcc6', '#48707c']
  const W = 0.42
  const D = 0.34
  const H = 0.26
  const body = once('house' + kind, () => {
    const box = (w: number, h: number, d: number, r = 0.015) => new RoundedBoxGeometry(w, h, d, 3, r)
    const tri = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, 0.2)])
    const gable = new THREE.ExtrudeGeometry(tri, { depth: D - 0.02, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 })
    gable.translate(0, 0, -(D - 0.02) / 2)
    const shade = shadeY(0, 0.12, 0.74)
    return merge([
      { g: tint(box(W, H, D, 0.02), wall, (p, c) => shade(new THREE.Vector3(0, p.y + H / 2, 0), c)), p: [0, H / 2, 0] },
      { g: tint(gable, wall), p: [0, H - 0.005, 0] },
      { g: tint(box(0.34, 0.035, D + 0.09, 0.012), roof), p: [-0.12, H + 0.1, 0], r: [0, 0, 0.733] },
      { g: tint(box(0.34, 0.035, D + 0.09, 0.012), roof), p: [0.12, H + 0.1, 0], r: [0, 0, -0.733] },
      { g: tint(box(0.06, 0.16, 0.06, 0.01), '#b8674a'), p: [0.11, H + 0.16, -0.06] },
      { g: tint(box(0.085, 0.15, 0.02, 0.008), '#7a4a32'), p: [-0.09, 0.075, D / 2 + 0.004] },
      { g: tint(box(0.13, 0.02, 0.05, 0.006), '#d9d2c2'), p: [-0.09, 0.01, D / 2 + 0.03] },
      { g: tint(box(0.13, 0.12, 0.02, 0.008), '#fff8e8'), p: [0.085, 0.15, D / 2 + 0.004] },
      { g: tint(box(0.02, 0.1, 0.1, 0.008), '#fff8e8'), p: [W / 2 + 0.004, 0.15, 0] },
      { g: tint(new THREE.BoxGeometry(0.012, 0.09, 0.016), '#6b4a32'), p: [0.085, 0.15, D / 2 + 0.016] },
      { g: tint(new THREE.BoxGeometry(0.1, 0.012, 0.016), '#6b4a32'), p: [0.085, 0.15, D / 2 + 0.016] },
    ])
  })
  const glow = once('houseglow', () =>
    merge([
      { g: tint(new THREE.BoxGeometry(0.1, 0.09, 0.012), '#ffffff'), p: [0.085, 0.15, D / 2 + 0.012] },
      { g: tint(new THREE.BoxGeometry(0.012, 0.075, 0.075), '#ffffff'), p: [W / 2 + 0.012, 0.15, 0] },
    ]),
  )
  return { body, glow }
}
const lathe = (pts: number[][], segs: number) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(0.0005, x), y)), segs)
export function lanternGeo() {
  const body = once('lantern', () => merge([{ g: tint(lathe([[0, 0], [0.035, 0], [0.04, 0.02], [0.014, 0.05], [0.011, 0.36], [0.02, 0.38], [0, 0.38]], 10), '#2a2622') }, { g: tint(lathe([[0.036, 0.455], [0.03, 0.47], [0.008, 0.49], [0, 0.5]], 10), '#2a2622') }]))
  const glow = once('lanternglow', () => tint(lathe([[0, 0.38], [0.02, 0.38], [0.03, 0.42], [0.026, 0.455], [0, 0.455]], 10), '#ffffff'))
  return { body, glow }
}
export function lighthouseGeo() {
  const body = once('lighthouse', () => {
    const R = (y: number) => 0.125 - y * 0.055
    const items: Parameters<typeof merge>[0] = [
      {
        g: clayMesh(
          [
            { t: 'e', p: [0, 0.03, 0], r: [0.34, 0.12, 0.3], c: '#a8a094' },
            { t: 'e', p: [0.18, 0.02, -0.1], r: [0.18, 0.1, 0.16], c: '#a8a094' },
            { t: 'e', p: [-0.2, 0.02, 0.08], r: [0.16, 0.09, 0.18], c: '#a8a094' },
          ],
          0.032,
          0.04,
          { paint: (p, _n, c) => void c.lerp(new THREE.Color('#cdc6b8'), noise(p.x * 12, p.z * 12)) },
        ),
      },
    ]
    for (let i = 0; i < 4; i++) {
      const y0 = 0.1 + i * 0.16
      const g = new THREE.CylinderGeometry(R(y0 + 0.16), R(y0), 0.16, 24)
      items.push({ g: tint(g, i % 2 === 0 ? '#f4ecdc' : '#d9502f', (p, c) => void c.multiplyScalar(0.8 + 0.2 * sm(-1, 1, -p.x / 0.12 - p.z / 0.12))), p: [0, y0 + 0.08, 0] })
    }
    items.push({ g: tint(lathe([[0, 0.74], [0.13, 0.74], [0.135, 0.755], [0.13, 0.77], [0, 0.77]], 24), '#3a3a3e') }, { g: tint(lathe([[0.09, 0.86], [0.095, 0.875], [0.02, 0.97], [0, 0.98]], 24), '#dc5238') }, { g: tint(new RoundedBoxGeometry(0.055, 0.09, 0.02, 2, 0.006), '#7a4a32'), p: [0, 0.145, 0.117] })
    return merge(items)
  })
  const glow = once('lighthouseglow', () => tint(lathe([[0, 0.77], [0.07, 0.77], [0.075, 0.815], [0.07, 0.86], [0, 0.86]], 16), '#ffffff'))
  return { body, glow }
}
export const boatGeo = () =>
  once('boat', () => {
    const hull = clayMesh(
      [
        { t: 'e', p: [0, 0.03, 0], r: [0.085, 0.075, 0.2], c: '#b56b3c' },
        { t: 'e', p: [0, 0.045, 0.14], r: [0.05, 0.05, 0.1], c: '#b56b3c' },
      ],
      0.016,
      0.03,
    )
    const hp = hull.attributes.position as THREE.BufferAttribute
    const hc = hull.attributes.color as THREE.BufferAttribute
    const deck = new THREE.Color('#f1e3c8')
    const c = new THREE.Color()
    for (let i = 0; i < hp.count; i++) {
      const y = hp.getY(i)
      if (y > 0.062) hp.setY(i, 0.062 + (y - 0.062) * 0.1)
      c.fromBufferAttribute(hc, i).lerp(deck, sm(0.058, 0.064, y))
      hc.setXYZ(i, c.r, c.g, c.b)
    }
    hull.computeVertexNormals()
    const sail = (pts: [number, number][], bulge: number) => {
      const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)))
      const g = new THREE.ShapeGeometry(s, 1)
      const out = new THREE.BufferGeometry()
      // 细分成小三角，中间鼓出去一点；正反两面各一份
      const p: number[] = []
      const N = 8
      const [A, B, Cc] = pts
      const P = (u: number, v: number) => {
        const z = A[0] + (B[0] - A[0]) * u + (Cc[0] - A[0]) * v
        const y = A[1] + (B[1] - A[1]) * u + (Cc[1] - A[1]) * v
        return [bulge * 4 * u * v * (1 - u - v) * 6 + 0.004, y, z]
      }
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N - i; j++) {
          const a = P(i / N, j / N)
          const b = P((i + 1) / N, j / N)
          const d = P(i / N, (j + 1) / N)
          p.push(...a, ...b, ...d, ...a, ...d, ...b)
          if (i + j < N - 1) {
            const e = P((i + 1) / N, (j + 1) / N)
            p.push(...b, ...e, ...d, ...b, ...d, ...e)
          }
        }
      out.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
      out.computeVertexNormals()
      g.dispose()
      return tint(out, '#fff6e4')
    }
    return merge([
      { g: hull },
      { g: tint(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 6), '#6b4a32'), p: [0, 0.24, 0] },
      { g: sail([[-0.012, 0.085], [-0.19, 0.085], [-0.012, 0.41]], 0.04) },
      { g: sail([[0.012, 0.085], [0.16, 0.085], [0.012, 0.33]], 0.03) },
      { g: tint(new THREE.BoxGeometry(0.004, 0.035, 0.06), '#e4502c'), p: [0, 0.4, -0.03] },
    ])
  })

// ---------- 每座岛上摆什么 ----------
// [零件, 方位角（0 朝右，90° 朝镜头）, 离岛心的距离, 大小, 自转]
export type Deco = [string, number, number, number, number]
export const DECO: Deco[][] = [
  [['tree_green', 215, 0.86, 0.95, 0.4], ['bush', 330, 0.9, 1.0, 1.2], ['rocks', 40, 1.0, 0.6, 2.0], ['lantern', 150, 0.8, 1, 0]],
  [['tree_pink', 300, 0.86, 0.9, 1.0], ['house_a', 235, 0.82, 0.92, 0.5], ['bush', 20, 0.92, 0.9, 0.3]],
  [['tree_deep', 200, 0.88, 1.0, 2.2], ['pine', 255, 0.9, 0.62, 0.5], ['tree_green', 320, 0.9, 0.8, 0.5], ['rocks', 35, 1.0, 0.6, 4.0]],
  [['pine', 310, 0.88, 0.62, 0.8], ['house_b', 225, 0.84, 0.92, 0.75], ['bush', 150, 0.92, 1.0, 2.0], ['lantern', 20, 0.82, 1, 0]],
  [['tree_gold', 320, 0.86, 0.9, 3.1], ['bush', 195, 0.95, 0.95, 0.9], ['rocks', 140, 1.02, 0.55, 1.0]],
  [['tree_pink', 205, 0.88, 0.85, 0.2], ['bush', 160, 0.95, 1.0, 0.2], ['rocks', 30, 1.0, 0.62, 1.0], ['lantern', 335, 0.82, 1, 0]],
  [['tree_deep', 220, 0.86, 0.9, 1.4], ['house_a', 305, 0.84, 0.92, -0.6], ['bush', 30, 0.95, 0.95, 2.5]],
  [['tree_gold', 210, 0.88, 0.85, 0.2], ['pine', 310, 0.9, 0.56, 1.7], ['lantern', 160, 0.84, 1, 0], ['bush', 25, 0.95, 0.85, 1.1]],
  [['tree_green', 315, 0.86, 0.9, 2.6], ['house_b', 215, 0.84, 0.92, 0.4], ['rocks', 150, 1.0, 0.6, 0.4]],
]
const FOOT: Record<string, number> = { tree: 0.3, bush: 0.3, pine: 0.3, rocks: 0.36, house: 0.42, lantern: 0.1 }
// 第 i 座岛：地面、并成一个的布景、并成一个的发光零件
export function buildIsle(i: number) {
  const it = ISLES[i]
  const top = ISLE_TOP
  const solid: Parameters<typeof merge>[0] = []
  const glow: Parameters<typeof merge>[0] = []
  const spots: Spot[] = []
  for (const [n, deg, r0, s, ry] of DECO[i] ?? []) {
    const a = (deg * Math.PI) / 180
    // 落在沙滩或水里就往岛心挪，直到站上草地
    let r = r0
    for (let k = 0; k < 12 && isleH(it, Math.cos(a) * r, Math.sin(a) * r) < top - 0.02; k++) r -= 0.05
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const y = isleH(it, x, z) - 0.008
    const at = { p: [x, y, z] as [number, number, number], r: [0, ry, 0] as [number, number, number], s }
    const kind = n.split('_')[0]
    spots.push({ x, z, r: (FOOT[kind] ?? 0.3) * s })
    if (kind === 'tree') solid.push({ g: treeGeo(n.split('_')[1] as keyof typeof TREE), ...at })
    else if (n === 'bush') solid.push({ g: bushGeo(), ...at })
    else if (n === 'pine') solid.push({ g: pineGeo(), ...at })
    else if (n === 'rocks') solid.push({ g: rocksGeo(), ...at })
    else if (kind === 'house') {
      const h = houseGeo(n.split('_')[1] as 'a' | 'b')
      solid.push({ g: h.body, ...at })
      glow.push({ g: h.glow, ...at })
    } else if (n === 'lantern') {
      const l = lanternGeo()
      solid.push({ g: l.body, ...at })
      glow.push({ g: l.glow, ...at })
    }
  }
  return { ground: isleGeo(it, spots), decor: solid.length ? merge(solid) : null, glow: glow.length ? merge(glow) : null }
}
