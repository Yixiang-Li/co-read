import * as THREE from 'three'

// 用代码“捏泥”：把椭球、胶囊、圆环这些基本形状光滑地融在一起（距离场的光滑并集），
// 再把融出来的表面变成网格。交接处像手捏过一样圆过去；法线直接从距离场求，所以表面很顺。
// 颜色跟着各个零件走，融合处自然过渡；凹缝里的暗（遮蔽）也从距离场估出来，写进顶点颜色。
// 全部在浏览器里加载时算一次并缓存，不需要任何模型文件。

type V3 = [number, number, number]
export type Part =
  | { t: 'e'; p: V3; r: V3; rot?: V3; c: string; k?: number } // 椭球：中心、三个半径、可选的旋转（欧拉角）
  | { t: 'c'; a: V3; b: V3; r: number; r2?: number; c: string; k?: number } // 胶囊：两端点、半径（r2 给了就是一头粗一头细）
  | { t: 't'; p: V3; R: number; r: number; rot?: V3; s?: V3; c: string; k?: number } // 圆环：中心、大半径、小半径；默认躺在 xz 平面
  | { t: 'b'; p: V3; h: V3; round: number; rot?: V3; c: string; k?: number } // 圆角方块：中心、半边长、圆角

type Compiled = { t: number; p: V3; r: V3; a: V3; b: V3; R: number; r1: number; r2: number; m: number[] | null; col: V3; k: number }
const tmpC = new THREE.Color()
function compile(parts: Part[], k0: number): Compiled[] {
  return parts.map((q) => {
    tmpC.set(q.c)
    const rot = 'rot' in q && q.rot ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...q.rot)).invert().elements : null
    const m = rot ? [rot[0], rot[4], rot[8], rot[1], rot[5], rot[9], rot[2], rot[6], rot[10]] : null
    const base = { m, col: [tmpC.r, tmpC.g, tmpC.b] as V3, k: q.k ?? k0, p: [0, 0, 0] as V3, r: [1, 1, 1] as V3, a: [0, 0, 0] as V3, b: [0, 0, 0] as V3, R: 0, r1: 0, r2: 0 }
    if (q.t === 'e') return { ...base, t: 0, p: q.p, r: q.r }
    if (q.t === 'c') return { ...base, t: 1, a: q.a, b: q.b, r1: q.r, r2: q.r2 ?? q.r }
    if (q.t === 't') return { ...base, t: 2, p: q.p, R: q.R, r1: q.r, r: q.s ?? [1, 1, 1] }
    return { ...base, t: 3, p: q.p, r: q.h, r1: q.round }
  })
}

function dist(q: Compiled, x: number, y: number, z: number) {
  if (q.t === 1) {
    const ax = x - q.a[0]
    const ay = y - q.a[1]
    const az = z - q.a[2]
    const bx = q.b[0] - q.a[0]
    const by = q.b[1] - q.a[1]
    const bz = q.b[2] - q.a[2]
    const h = Math.min(1, Math.max(0, (ax * bx + ay * by + az * bz) / (bx * bx + by * by + bz * bz)))
    return Math.hypot(ax - bx * h, ay - by * h, az - bz * h) - (q.r1 + (q.r2 - q.r1) * h)
  }
  let lx = x - q.p[0]
  let ly = y - q.p[1]
  let lz = z - q.p[2]
  if (q.m) {
    const m = q.m
    const tx = m[0] * lx + m[1] * ly + m[2] * lz
    const ty = m[3] * lx + m[4] * ly + m[5] * lz
    lz = m[6] * lx + m[7] * ly + m[8] * lz
    lx = tx
    ly = ty
  }
  if (q.t === 0) {
    const r = q.r
    const k0 = Math.hypot(lx / r[0], ly / r[1], lz / r[2])
    const k1 = Math.hypot(lx / (r[0] * r[0]), ly / (r[1] * r[1]), lz / (r[2] * r[2]))
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2])
  }
  if (q.t === 2) {
    lx /= q.r[0]
    ly /= q.r[1]
    lz /= q.r[2]
    return (Math.hypot(Math.hypot(lx, lz) - q.R, ly) - q.r1) * Math.min(q.r[0], q.r[1], q.r[2])
  }
  const dx = Math.abs(lx) - q.r[0] + q.r1
  const dy = Math.abs(ly) - q.r[1] + q.r1
  const dz = Math.abs(lz) - q.r[2] + q.r1
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0) - q.r1
}

export type Field = { d: (x: number, y: number, z: number) => number; col: (x: number, y: number, z: number, out: V3) => void; box: THREE.Box3 }

// 把一组零件变成一个距离场。k 是融合的宽度：越大，交接处越圆。
export function field(parts: Part[], k = 0.05): Field {
  const cs = compile(parts, k)
  const d = (x: number, y: number, z: number) => {
    let v = 1e9
    for (let i = 0; i < cs.length; i++) {
      const di = dist(cs[i], x, y, z)
      const kk = cs[i].k
      const h = Math.max(kk - Math.abs(v - di), 0) / kk
      v = Math.min(v, di) - h * h * kk * 0.25
    }
    return v
  }
  const col = (x: number, y: number, z: number, out: V3) => {
    let w = 0
    out[0] = out[1] = out[2] = 0
    for (let i = 0; i < cs.length; i++) {
      const di = dist(cs[i], x, y, z)
      const wi = Math.exp(-Math.max(0, di) / (cs[i].k * 0.35))
      out[0] += cs[i].col[0] * wi
      out[1] += cs[i].col[1] * wi
      out[2] += cs[i].col[2] * wi
      w += wi
    }
    out[0] /= w
    out[1] /= w
    out[2] /= w
  }
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (const q of parts) {
    if (q.t === 'c') {
      const r = Math.max(q.r, q.r2 ?? q.r)
      box.expandByPoint(v.set(q.a[0] - r, q.a[1] - r, q.a[2] - r)).expandByPoint(v.set(q.a[0] + r, q.a[1] + r, q.a[2] + r))
      box.expandByPoint(v.set(q.b[0] - r, q.b[1] - r, q.b[2] - r)).expandByPoint(v.set(q.b[0] + r, q.b[1] + r, q.b[2] + r))
    } else {
      const r = q.t === 'e' ? Math.max(...q.r) : q.t === 't' ? (q.R + q.r) * Math.max(...(q.s ?? [1, 1, 1])) : Math.hypot(...q.h)
      box.expandByPoint(v.set(q.p[0] - r, q.p[1] - r, q.p[2] - r)).expandByPoint(v.set(q.p[0] + r, q.p[1] + r, q.p[2] + r))
    }
  }
  return { d, col, box }
}

export type Paint = (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void

// 把距离场的表面变成网格（表面网格法）。cell 是网格的格子大小：越小越细。
// paint：可选，逐顶点改颜色（画腮红、鼻子、花纹）。ao：凹处压暗的强度。
export function mesh(f: Field, cell: number, opt: { paint?: Paint; ao?: number; aoDist?: number } = {}) {
  const pad = cell * 2
  const min = f.box.min.clone().subScalar(pad)
  const size = f.box.max.clone().addScalar(pad).sub(min)
  const nx = Math.ceil(size.x / cell) + 1
  const ny = Math.ceil(size.y / cell) + 1
  const nz = Math.ceil(size.z / cell) + 1
  const val = new Float32Array(nx * ny * nz)
  for (let k = 0, i = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let a = 0; a < nx; a++, i++) val[i] = f.d(min.x + a * cell, min.y + j * cell, min.z + k * cell)
  const idx = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1)
  const pos: number[] = []
  const sx = 1
  const sy = nx
  const sz = nx * ny
  const cx = nx - 1
  const cy = ny - 1
  const corner = [0, sx, sy, sx + sy, sz, sz + sx, sz + sy, sz + sx + sy]
  const co = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let a = 0; a < nx - 1; a++) {
        const g = a + j * sy + k * sz
        let mask = 0
        for (let c = 0; c < 8; c++) if (val[g + corner[c]] < 0) mask |= 1 << c
        if (mask === 0 || mask === 255) continue
        let px = 0
        let py = 0
        let pz = 0
        let n = 0
        for (const [e0, e1] of edges) {
          const v0 = val[g + corner[e0]]
          const v1 = val[g + corner[e1]]
          if (v0 < 0 === v1 < 0) continue
          const t = v0 / (v0 - v1)
          px += co[e0][0] + (co[e1][0] - co[e0][0]) * t
          py += co[e0][1] + (co[e1][1] - co[e0][1]) * t
          pz += co[e0][2] + (co[e1][2] - co[e0][2]) * t
          n++
        }
        idx[a + j * cx + k * cx * cy] = pos.length / 3
        pos.push(min.x + (a + px / n) * cell, min.y + (j + py / n) * cell, min.z + (k + pz / n) * cell)
      }
  const index: number[] = []
  const cell4 = (a: number, j: number, k: number) => idx[a + j * cx + k * cx * cy]
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) index.push(a, c, b, a, d, c)
    else index.push(a, b, c, a, c, d)
  }
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let a = 1; a < nx - 1; a++) {
        const g = a + j * sy + k * sz
        const v = val[g] < 0
        if (v !== val[g + sx] < 0) quad(cell4(a, j - 1, k - 1), cell4(a, j, k - 1), cell4(a, j, k), cell4(a, j - 1, k), !v)
        if (v !== val[g + sy] < 0) quad(cell4(a - 1, j, k - 1), cell4(a - 1, j, k), cell4(a, j, k), cell4(a, j, k - 1), !v)
        if (v !== val[g + sz] < 0) quad(cell4(a - 1, j - 1, k), cell4(a, j - 1, k), cell4(a, j, k), cell4(a - 1, j, k), !v)
      }
  const nv = pos.length / 3
  const nor = new Float32Array(nv * 3)
  const col = new Float32Array(nv * 3)
  const e = cell * 0.5
  const p = new THREE.Vector3()
  const nn = new THREE.Vector3()
  const cc = new THREE.Color()
  const tmp: V3 = [0, 0, 0]
  const aoK = opt.ao ?? 1
  const aoD = opt.aoDist ?? Math.max(0.045, cell * 4)
  for (let i = 0; i < nv; i++) {
    const x = pos[i * 3]
    const y = pos[i * 3 + 1]
    const z = pos[i * 3 + 2]
    nn.set(f.d(x + e, y, z) - f.d(x - e, y, z), f.d(x, y + e, z) - f.d(x, y - e, z), f.d(x, y, z + e) - f.d(x, y, z - e)).normalize()
    nor[i * 3] = nn.x
    nor[i * 3 + 1] = nn.y
    nor[i * 3 + 2] = nn.z
    f.col(x, y, z, tmp)
    cc.setRGB(tmp[0], tmp[1], tmp[2])
    if (opt.paint) opt.paint(p.set(x, y, z), nn, cc)
    // 凹处的暗：沿法线往外走几步，离表面的距离要是比走的步子小，说明附近有别的表面挡着
    let occ = 0
    for (let s = 1; s <= 3; s++) {
      const h = (aoD * s) / 3
      occ += Math.max(0, h - f.d(x + nn.x * h, y + nn.y * h, z + nn.z * h)) / h / s
    }
    const ao = 1 - Math.min(1, occ * 0.6) * 0.62 * aoK
    col[i * 3] = cc.r * ao * (1 + 0.05 * (1 - ao))
    col[i * 3 + 1] = cc.g * ao
    col[i * 3 + 2] = cc.b * ao * (1 - 0.08 * (1 - ao))
  }
  // 顶点颜色沿着网格抹两遍：遮蔽是逐点估的，不抹会有一道道的印子
  const acc = new Float32Array(nv * 3)
  const cnt = new Uint16Array(nv)
  for (let pass = 0; pass < 5; pass++) {
    acc.fill(0)
    cnt.fill(0)
    for (let i = 0; i < index.length; i += 3)
      for (let a = 0; a < 3; a++) {
        const u = index[i + a]
        const w = index[i + ((a + 1) % 3)]
        acc[u * 3] += col[w * 3]
        acc[u * 3 + 1] += col[w * 3 + 1]
        acc[u * 3 + 2] += col[w * 3 + 2]
        cnt[u]++
      }
    for (let i = 0; i < nv; i++)
      if (cnt[i]) {
        col[i * 3] = col[i * 3] * 0.4 + (acc[i * 3] / cnt[i]) * 0.6
        col[i * 3 + 1] = col[i * 3 + 1] * 0.4 + (acc[i * 3 + 1] / cnt[i]) * 0.6
        col[i * 3 + 2] = col[i * 3 + 2] * 0.4 + (acc[i * 3 + 2] / cnt[i]) * 0.6
      }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setIndex(index)
  return g
}

// 常用的一步：零件 → 网格
export const clayMesh = (parts: Part[], cell: number, k = 0.05, opt: Parameters<typeof mesh>[2] = {}) => mesh(field(parts, k), cell, opt)

// 给现成的几何体（旋转体、方块）刷上一个纯色的顶点颜色，好和捏出来的网格用同一种材质
export function tint(g: THREE.BufferGeometry, color: string, shade?: (p: THREE.Vector3, c: THREE.Color) => void) {
  const n = g.attributes.position.count
  const col = new Float32Array(n * 3)
  const c = new THREE.Color()
  const p = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    c.set(color)
    if (shade) shade(p.fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i), c)
    col.set([c.r, c.g, c.b], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}
