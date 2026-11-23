import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bus } from '../bus'
import { L, useLang } from '../i18n'
import { backOut, Baked, C, sm, Tag } from '../world/kit'
import type { MicroProps } from './types'

// 消防队长（专家直觉）：一间剖开的小厨房架在地下室上面。
// 访客点门口（马上跑）或点队长（先问清楚）；按住慢之后，地板塌下去，地下室的大火露出来。
// 性能：不会动的东西烤成两个网格（哑光、带点光泽各一个），火苗和水滴用 InstancedMesh，不加点光源。

const F = 0.66 // 厨房地面的高度，下面是地下室
const ROT = 0.4 // 整栋房子转一点，能同时看见后墙和右墙
// 整栋房子缩到 0.82。这座岛的草地不是圆的：左后和右后各缺一块（那两个方向平地只到 1.15–1.3），
// 所以房子要往右前挪一点，四个墙角才都踩在平的草地上，不会有一角悬在沙滩的斜坡上面。
const S = 0.82
const OX = 0.03
const OZ = -0.42
const HW = 0.9 // 房子半宽
const HD = 0.7 // 房子半深
const WALL = 0.92
const DOORX = -0.58
const DH = 0.74 // 门洞的高度
const PS = 0.68 // 小人在屋里的大小
const cl = (x: number) => Math.min(1, Math.max(0, x))

// —— 把一堆零件烤成一个带顶点颜色的网格 ——
type V3 = [number, number, number]
type Part = { g: THREE.BufferGeometry; c: string; p?: V3; r?: V3; m?: THREE.Matrix4; gl?: boolean }
const mat4 = (p: V3 = [0, 0, 0], r: V3 = [0, 0, 0]) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1))
const within = (p: V3, r: V3, parts: Part[]): Part[] => parts.map((x) => ({ ...x, m: mat4(p, r).multiply(x.m ?? new THREE.Matrix4()) }))
function bake(parts: Part[]) {
  const col = new THREE.Color()
  const gs = parts.map((x) => {
    const n = x.g.index ? x.g.toNonIndexed() : x.g.clone()
    n.deleteAttribute('uv')
    n.applyMatrix4((x.m ? x.m.clone() : new THREE.Matrix4()).multiply(mat4(x.p, x.r)))
    col.set(x.c)
    const a = new Float32Array(n.attributes.position.count * 3)
    for (let i = 0; i < a.length; i += 3) a.set([col.r, col.g, col.b], i)
    n.setAttribute('color', new THREE.BufferAttribute(a, 3))
    x.g.dispose()
    return n
  })
  const out = mergeGeometries(gs)
  gs.forEach((g) => g.dispose())
  return out
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, r)
const cyl = (rt: number, rb: number, h: number, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg)
const sph = (r: number, seg = 14) => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75))

// 舞台坐标 → 房子自己的坐标
const H = (x: number, z: number): [number, number] => {
  const c = Math.cos(ROT)
  const s = Math.sin(ROT)
  return [((x - OX) * c - (z - OZ) * s) / S, ((x - OX) * s + (z - OZ) * c) / S]
}

type Path = { v: THREE.Vector3[]; L: number[]; len: number }
const mkPath = (pts: V3[]): Path => {
  const v = pts.map((p) => new THREE.Vector3(...p))
  const L = [0]
  for (let i = 1; i < v.length; i++) L.push(L[i - 1] + v[i].distanceTo(v[i - 1]))
  return { v, L, len: L[L.length - 1] }
}
// 沿着路线走到 u（0–1），返回朝向
const along = (path: Path, u: number, out: THREE.Vector3) => {
  const d = u * path.len
  let i = 1
  while (i < path.v.length - 1 && path.L[i] < d) i++
  const a = path.v[i - 1]
  const b = path.v[i]
  out.lerpVectors(a, b, cl((d - path.L[i - 1]) / Math.max(1e-6, path.L[i] - path.L[i - 1])))
  return Math.atan2(b.x - a.x, b.z - a.z)
}

const STOVE: [number, number] = [0.5, -HD + 0.2]
const who = (home: [number, number], lawn: [number, number], delay: number) => {
  const [lx, lz] = H(...lawn)
  return { home, lawn: [lx, lz] as [number, number], delay, path: mkPath([[home[0], F, home[1]], [DOORX, F, 0.4], [DOORX, F, HD + 0.36], [DOORX, 0, HD + 0.8], [DOORX, 0, HD + 0.98], [lx, 0, lz]]) }
}
// 三个队员 + 队长（最后一个）。第二项是撤出来以后站的位置（舞台坐标）。
// 门前的平地是一条往前伸的舌头（z = 1.3 处只剩 x 0.05–0.5 是平的），四个位置都挑在平地上；
// 右边那个不能再往右，不然会站到乌龟头顶“按住我”那张纸签的后面。
const WHO = [who([0.2, -0.16], [0.56, 0.74], 0), who([0.52, 0.04], [0.3, 1.06], 0.14), who([0.76, -0.14], [0.05, 1.27], 0.28), who([0.1, 0.42], [-0.47, 1.04], 0.5)]
const CAP = WHO[3]

// —— 火苗：水滴形，底下圆，尖上带一点弯。三层颜色各一个 InstancedMesh ——
const flameGeo = (() => {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 12; i++) {
    const t = i / 12
    pts.push(new THREE.Vector2(0.4 * Math.pow(Math.sin(Math.PI * Math.sqrt(t)), 0.8) * (1 - 0.15 * t) + 0.0001, t))
  }
  const g = new THREE.LatheGeometry(pts, 14)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + 0.2 * pos.getY(i) * pos.getY(i))
  g.computeVertexNormals()
  return g
})()
const FL: [number, number, number, string, number][] = [[0, 0, 1, '#ee5326', 0.55], [0.02, 0.13, 0.72, '#fb9a25', 0.75], [0.0, 0.25, 0.46, '#ffe067', 1]]
// 每一簇火：位置、大小、相位、摆动幅度、是否镜像、属于哪一组（0 灶台，1 地下室，2 队长记得的）
type Fl = { x: number; y: number; z: number; s: number; seed: number; wild: number; flip: boolean; grp: 0 | 1 | 2; i: number }
const BUB: [number, number][] = [[-0.225, 0.02], [-0.075, 0.02], [0.075, 0.02], [0.225, 0.02], [-0.225, -0.14], [-0.075, -0.14], [0.075, -0.14], [0.225, -0.14]]
const FIRES: Fl[] = [
  { x: STOVE[0], y: F + 0.4, z: STOVE[1] - 0.01, s: 0.34, seed: 1, wild: 0.4, flip: false, grp: 0, i: 0 },
  { x: STOVE[0] + 0.15, y: F + 0.4, z: STOVE[1] - 0.08, s: 0.22, seed: 3, wild: 0.4, flip: true, grp: 0, i: 1 },
  { x: STOVE[0] - 0.14, y: F + 0.4, z: STOVE[1] - 0.06, s: 0.18, seed: 5, wild: 0.4, flip: false, grp: 0, i: 2 },
  ...([[-0.22, 0.0, 0.5, 2, 0], [0.32, -0.14, 0.56, 7, 1], [0.04, 0.36, 0.42, 11, 0], [0.64, 0.3, 0.4, 4, 1], [-0.6, 0.28, 0.36, 9, 1], [-0.44, -0.38, 0.4, 13, 0], [0.64, -0.36, 0.34, 15, 0], [0.34, 0.44, 0.28, 17, 1], [-0.14, -0.44, 0.3, 19, 1]] as const).map(([x, z, s, seed, flip], i): Fl => ({ x, y: 0.02, z, s, seed, wild: 1, flip: !!flip, grp: 1, i })),
  ...BUB.map(([x, y], i): Fl => ({ x, y, z: 0.024, s: 0.135, seed: i * 3 + 20, wild: 0.7, flip: i % 3 === 1, grp: 2, i })),
]

// —— 消防员：和地上那个代表同一个形象（红身子、黄头盔） ——
const fighterGeo = (captain: boolean) =>
  bake([
    { g: cyl(0.07, 0.2, 0.54, 20), c: C.red, p: [0, 0.27, 0] },
    { g: new THREE.SphereGeometry(0.14, 18, 14), c: C.skin, p: [0, 0.66, 0] },
    { g: new THREE.SphereGeometry(0.165, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), c: C.gold, p: [0, 0.74, 0] },
    { g: cyl(0.215, 0.215, 0.025, 22), c: C.gold, p: [0, 0.74, 0.02] },
    { g: cyl(0.152, 0.166, 0.045, 18), c: '#f4e9b8', p: [0, 0.4, 0] },
    ...(captain
      ? [
          // 队长：头盔上多一道白箍和一块白徽
          { g: new THREE.TorusGeometry(0.152, 0.02, 6, 22), c: C.white, p: [0, 0.775, 0] as V3, r: [Math.PI / 2, 0, 0] as V3 },
          { g: cyl(0.05, 0.05, 0.02, 5), c: C.white, p: [0, 0.83, 0.125] as V3, r: [-0.6, 0, 0] as V3 },
        ]
      : [
          // 队员：背着水罐，手里一支水枪
          { g: new THREE.CapsuleGeometry(0.07, 0.16, 4, 10), c: '#5d7f96', p: [0, 0.34, -0.17] as V3 },
          { g: cyl(0.022, 0.034, 0.22, 8), c: C.ink, p: [0.04, 0.42, 0.2] as V3, r: [1.25, 0, 0] as V3 },
        ]),
  ])

const CUT = '#3d3a3c' // 墙被剖开的断面
const WALLC = '#f5ead4'
const STONE = '#cdbb9f'
const FLW = HW + 0.08 - DOORX - 0.3 // 地下室正面会沉下去的那段墙的宽度

// —— 房子里所有不会动的东西 ——
function houseParts(): Part[] {
  const tile = '#a8cfc6'
  const cab = '#4f8ea3'
  const B = -HD
  const dz = HD + 0.04
  const cap = '#a3957d'
  const inner = '#5b4a40'
  const lw = DOORX + 0.3 + HW + 0.08
  const curb = HW + 0.08 - DOORX - 0.27
  return [
    // 后墙、右墙，和墙裙瓷砖
    { g: box(HW * 2 + 0.16, WALL, 0.08), c: WALLC, p: [0, F + WALL / 2, B - 0.04] },
    { g: box(0.08, WALL, HD * 2), c: WALLC, p: [HW + 0.04, F + WALL / 2, 0] },
    { g: box(HW * 2, 0.48, 0.012), c: tile, p: [0, F + 0.24, B + 0.006], gl: true },
    { g: box(0.012, 0.48, HD * 2), c: tile, p: [HW - 0.006, F + 0.24, 0], gl: true },
    { g: box(HW * 2, 0.026, 0.024), c: C.white, p: [0, F + 0.49, B + 0.012], gl: true },
    { g: box(0.024, 0.026, HD * 2), c: C.white, p: [HW - 0.012, F + 0.49, 0], gl: true },
    // 墙顶的断面
    { g: box(HW * 2 + 0.165, 0.025, 0.085), c: CUT, p: [0, F + WALL + 0.012, B - 0.04] },
    { g: box(0.085, 0.025, HD * 2), c: CUT, p: [HW + 0.04, F + WALL + 0.012, 0] },
    // 靠近镜头的两面墙只留一道矮墙根
    { g: box(0.08, 0.08, HD * 2 + 0.16), c: WALLC, p: [-HW - 0.04, F + 0.04, 0] },
    { g: box(0.085, 0.014, HD * 2 + 0.165), c: CUT, p: [-HW - 0.04, F + 0.086, 0] },
    { g: box(curb, 0.08, 0.08), c: WALLC, p: [(DOORX + 0.27 + HW + 0.08) / 2, F + 0.04, dz] },
    { g: box(curb + 0.005, 0.014, 0.085), c: CUT, p: [(DOORX + 0.27 + HW + 0.08) / 2, F + 0.086, dz] },
    { g: box(DOORX - 0.27 + HW + 0.08, 0.08, 0.08), c: WALLC, p: [(-HW - 0.08 + DOORX - 0.27) / 2, F + 0.04, dz] },
    // 冰箱
    { g: rbox(0.36, 0.68, 0.34, 0.045), c: '#e9efe3', p: [-0.68, F + 0.34, B + 0.18], gl: true },
    { g: box(0.34, 0.008, 0.004), c: '#b9c2b4', p: [-0.68, F + 0.45, B + 0.352] },
    { g: new THREE.CapsuleGeometry(0.011, 0.05, 3, 6), c: '#9aa39a', p: [-0.56, F + 0.36, B + 0.362], gl: true },
    { g: new THREE.CapsuleGeometry(0.011, 0.08, 3, 6), c: '#9aa39a', p: [-0.56, F + 0.54, B + 0.362], gl: true },
    // 窗
    { g: rbox(0.5, 0.3, 0.04, 0.02), c: C.white, p: [-0.1, F + 0.68, B + 0.01], gl: true },
    { g: box(0.43, 0.23, 0.006), c: '#bfe0ee', p: [-0.1, F + 0.68, B + 0.03], gl: true },
    { g: box(0.018, 0.23, 0.01), c: C.white, p: [-0.1, F + 0.68, B + 0.036], gl: true },
    // 橱柜、台面、水槽、龙头
    { g: rbox(0.7, 0.3, 0.32, 0.028), c: cab, p: [-0.11, F + 0.15, B + 0.17] },
    { g: rbox(0.74, 0.04, 0.36, 0.018), c: C.cream, p: [-0.11, F + 0.32, B + 0.18], gl: true },
    ...[-0.33, -0.17, -0.05, 0.11].map((x): Part => ({ g: sph(0.02, 8), c: C.gold, p: [x, F + 0.215, B + 0.34], gl: true })),
    { g: box(0.008, 0.24, 0.004), c: '#3f7689', p: [-0.11, F + 0.15, B + 0.332] },
    { g: box(0.28, 0.008, 0.18), c: '#b9c6cc', p: [-0.1, F + 0.342, B + 0.19], gl: true },
    { g: new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), c: '#c9d2d6', p: [-0.1, F + 0.4, B + 0.07], r: [0, Math.PI / 2, 0], gl: true },
    // 灶台和锅
    { g: rbox(0.42, 0.33, 0.36, 0.032), c: C.white, p: [STOVE[0], F + 0.165, B + 0.19], gl: true },
    { g: rbox(0.28, 0.15, 0.01, 0.004), c: '#33363d', p: [STOVE[0], F + 0.13, B + 0.372], gl: true },
    ...[-0.11, 0, 0.11].map((x): Part => ({ g: cyl(0.02, 0.02, 0.02, 10), c: C.red, p: [STOVE[0] + x, F + 0.27, B + 0.375], r: [Math.PI / 2, 0, 0], gl: true })),
    { g: cyl(0.14, 0.14, 0.012, 20), c: '#33363d', p: [STOVE[0], F + 0.335, B + 0.19] },
    { g: cyl(0.12, 0.105, 0.1, 20), c: '#565a63', p: [STOVE[0], F + 0.39, B + 0.19], gl: true },
    { g: cyl(0.013, 0.013, 0.14, 6), c: C.ink, p: [STOVE[0] - 0.18, F + 0.42, B + 0.19], r: [0, 0, Math.PI / 2] },
    // 抽油烟机
    { g: cyl(0.09, 0.27, 0.16, 4), c: '#c8cdd0', p: [STOVE[0], F + 0.82, B + 0.15], r: [0, Math.PI / 4, 0], gl: true },
    // 右墙上的搁板和罐子
    { g: box(0.14, 0.022, 0.6), c: '#c79a62', p: [HW - 0.08, F + 0.62, 0.2] },
    ...([[-0.02, C.coral, 0.1], [0.14, C.white, 0.13], [0.29, C.pink, 0.09], [0.42, C.olive, 0.11]] as const).map(([z, c, h]): Part => ({ g: cyl(0.04, 0.04, h, 12), c, p: [HW - 0.08, F + 0.632 + h / 2, z], gl: true })),
    // 门框，和一扇推到一边的门
    { g: box(0.06, DH + 0.04, 0.085), c: C.white, p: [DOORX - 0.24, F + DH / 2 + 0.02, dz] },
    { g: box(0.06, DH + 0.04, 0.085), c: C.white, p: [DOORX + 0.24, F + DH / 2 + 0.02, dz] },
    { g: box(0.54, 0.06, 0.085), c: C.white, p: [DOORX, F + DH + 0.07, dz] },
    ...within([DOORX - 0.23, F, dz + 0.04], [0, -2.55, 0], [
      { g: rbox(0.42, DH, 0.035, 0.014), c: '#3f9a8a', p: [0.21, DH / 2 + 0.005, 0] },
      { g: sph(0.022, 8), c: C.gold, p: [0.36, DH / 2, -0.03], gl: true },
    ]),
    // 门外的平台和台阶
    { g: rbox(0.58, F, 0.3, 0.02), c: '#e9dfcd', p: [DOORX, F / 2 - 0.001, HD + 0.21] },
    ...[0, 1, 2].map((k): Part => {
      const h = F * (1 - (k + 1) / 4)
      return { g: rbox(0.58, h, 0.15, 0.018), c: k % 2 ? '#e9dfcd' : '#ded2bc', p: [DOORX, h / 2, HD + 0.36 + 0.07 + k * 0.14] }
    }),
    // 地下室的墙（正面右边那段是活的，另外放）
    { g: box(HW * 2 + 0.16, 0.6, 0.08), c: STONE, p: [0, 0.3, -dz] },
    { g: box(0.08, 0.6, HD * 2), c: STONE, p: [HW + 0.04, 0.3, 0] },
    { g: box(0.08, 0.6, HD * 2 + 0.16), c: STONE, p: [-HW - 0.04, 0.3, 0] },
    { g: box(lw, 0.6, 0.08), c: STONE, p: [-HW - 0.08 + lw / 2, 0.3, dz] },
    { g: box(HW * 2, 0.6, 0.006), c: inner, p: [0, 0.3, -HD + 0.004] },
    { g: box(0.006, 0.6, HD * 2), c: inner, p: [HW - 0.004, 0.3, 0] },
    { g: box(0.006, 0.6, HD * 2), c: inner, p: [-HW + 0.004, 0.3, 0] },
    // 托着厨房地板的一圈梁，和几根烧黑的龙骨
    { g: box(HW * 2 + 0.17, 0.066, 0.09), c: cap, p: [0, 0.628, -dz] },
    { g: box(HW * 2 + 0.17, 0.066, 0.09), c: cap, p: [0, 0.628, dz] },
    { g: box(0.09, 0.066, HD * 2), c: cap, p: [-HW - 0.04, 0.628, 0] },
    { g: box(0.09, 0.066, HD * 2), c: cap, p: [HW + 0.04, 0.628, 0] },
    ...[-0.54, -0.1, 0.34, 0.72].map((x): Part => ({ g: box(0.05, 0.07, HD * 2), c: '#2e2725', p: [x, 0.575, 0] })),
    // 地下室里的杂物
    { g: rbox(0.28, 0.24, 0.28, 0.02), c: '#4a3a30', p: [-0.62, 0.13, -0.4], r: [0, 0.3, 0] },
    { g: cyl(0.12, 0.12, 0.34, 14), c: '#3b4a52', p: [0.72, 0.18, -0.46] },
  ]
}

// 一团柔和的光（代替点光源：便宜，而且不会让全场的材质重新编译）
const glowTex = () => {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const g = cv.getContext('2d')!
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.45, 'rgba(255,255,255,0.42)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(cv)
}

const NX = 7
const NZ = 6
const TN = NX * NZ
const TWX = (HW * 2) / NX
const TWZ = (HD * 2) / NZ
const tileSeed = Array.from({ length: TN }, (_, i) => [Math.sin(i * 12.9898) * 43758.5453, Math.sin(i * 78.233) * 12543.123].map((v) => (v - Math.floor(v)) * 2 - 1))
const ND = 24 // 水滴
const NS = 3 // 烟

export default function Helmet({ c, phase, pick, choose, say }: MicroProps) {
  const lang = useLang()
  const geo = useMemo(() => {
    const parts = houseParts()
    return {
      matte: bake(parts.filter((x) => !x.gl)),
      gloss: bake(parts.filter((x) => x.gl)),
      crew: fighterGeo(false),
      cap: fighterGeo(true),
      ears: bake([{ g: sph(0.052, 10), c: '#ffffff', p: [-0.17, 0.635, 0.02] }, { g: sph(0.052, 10), c: '#ffffff', p: [0.17, 0.635, 0.02] }]),
      board: bake([{ g: rbox(0.66, 0.38, 0.04, 0.018), c: C.white }, { g: sph(0.05, 10), c: C.white, p: [-0.1, -0.27, 0] }, { g: sph(0.032, 8), c: C.white, p: [-0.05, -0.36, 0] }]),
      glow: glowTex(),
    }
  }, [])
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo])

  const men = useRef<(THREE.Mesh | null)[]>([])
  const capG = useRef<THREE.Group>(null)
  const tiles = useRef<THREE.InstancedMesh>(null)
  const drops = useRef<THREE.InstancedMesh>(null)
  const smoke = useRef<THREE.InstancedMesh>(null)
  const flames = useRef<(THREE.InstancedMesh | null)[]>([])
  const flap = useRef<THREE.Mesh>(null)
  const bubP = useRef<THREE.Group>(null)
  const bubble = useRef<THREE.Group>(null)
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  const ember = useRef<THREE.MeshStandardMaterial>(null)
  const spill = useRef<THREE.MeshBasicMaterial>(null)
  const up = useRef<THREE.MeshBasicMaterial>(null)
  const ear = useRef<THREE.MeshStandardMaterial>(null)
  const s = useRef({ T: 0, FT: 0, run: 0, q: -1, head: WHO.map(() => Math.PI), dist: WHO.map(() => 0), last: WHO.map(() => new THREE.Vector3()) })
  const [beat, setBeat] = useState(0) // 0 灭火中，1 队长喊了，2 等访客选
  const [hov, setHov] = useState<null | 'door' | 'cap'>(null)
  const [bits, setBits] = useState(0)
  const bitsR = useRef(0)
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), v: new THREE.Vector3(), col: new THREE.Color(), m: new THREE.Matrix4(), hot: new THREE.Color('#ff5a3a'), skin: new THREE.Color(C.skin) }), [])

  useEffect(() => {
    const m = tiles.current
    if (!m) return
    for (let i = 0; i < TN; i++) m.setColorAt(i, tmp.col.set(((i % NX) + Math.floor(i / NX)) % 2 ? '#f6efdf' : '#c4d3d6'))
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [tmp])

  // 字幕
  const quiet = !!(bits & 1)
  useEffect(() => {
    if (phase === 'ask') say(beat === 0 ? L('厨房着火，队员们正在灭火。', 'A kitchen fire. The crew hoses it down.') : beat === 1 ? L('队长突然喊了一声。', 'Suddenly the captain shouts.') : L('你听不听他的？', 'Do you listen to him?'))
    else if (phase === 'picked') say(quiet ? '' : pick === 0 ? L('全都撤出来了。然后呢？', 'Everyone is out. Now what?') : L('为什么要喊，他也说不上来。', 'He has no idea why he shouted.'))
    else say('')
  }, [phase, beat, pick, quiet, say, lang])

  useFrame((_, rawDt) => {
    const a = s.current
    const dt = Math.min(0.05, rawDt) * (1 - 0.93 * bus.t)
    if (bus.micro.k > 0.75) a.T += dt
    a.FT += dt
    const T = a.T
    const lite = bus.quality === 0
    const p = phase === 'done' ? 1 : phase === 'picked' ? bus.p : 0
    if (phase !== 'ask' && pick === 0) a.run = Math.min(1, a.run + dt / 1.9)
    const U = Math.max(a.run, sm(0.01, 0.13, p))
    const nb = T > 3.1 ? 2 : T > 1.7 ? 1 : 0
    if (nb !== beat && phase === 'ask') setBeat(nb)
    const b = (p > 0.04 ? 1 : 0) | (p > 0.57 ? 2 : 0) | (p > 0.69 ? 4 : 0) | (p > 0.88 ? 8 : 0)
    if (b !== bitsR.current) setBits((bitsR.current = b))

    // 人
    const asked = phase !== 'ask' && pick === 1
    for (let i = 0; i < 4; i++) {
      const w = WHO[i]
      const g = i === 3 ? capG.current : men.current[i]
      if (!g) continue
      const u = cl(U * 1.5 - w.delay)
      let want = along(w.path, u * u * (3 - 2 * u), tmp.v)
      const moving = u > 0.001 && u < 0.999
      if (!moving) {
        if (u === 0) {
          // 屋里：队员对着灶台喷水；被问的时候都扭头看队长
          const tx = i === 3 ? (T > 1.7 ? 0.3 : STOVE[0]) : asked ? CAP.home[0] : STOVE[0]
          const tz = i === 3 ? (T > 1.7 ? 3 : STOVE[1]) : asked ? CAP.home[1] : STOVE[1]
          want = Math.atan2(tx - w.home[0], tz - w.home[1])
        } else want = Math.atan2(0.2 - w.lawn[0], 0 - w.lawn[1]) // 站在草地上回头看房子
      }
      a.dist[i] += tmp.v.distanceTo(a.last[i])
      a.last[i].copy(tmp.v)
      a.head[i] += Math.atan2(Math.sin(want - a.head[i]), Math.cos(want - a.head[i])) * Math.min(1, rawDt * 12)
      let y = tmp.v.y + (moving ? Math.abs(Math.sin(a.dist[i] * 15)) * 0.05 : 0)
      if (i === 3 && u === 0) {
        const j = T - 1.7 // 队长喊的那一下，整个人弹起来
        if (j > 0 && j < 0.5) y += Math.sin((j / 0.5) * Math.PI) * 0.14
      } else if (u === 0) y += Math.max(0, Math.sin(T * 3 + i * 2)) * 0.01
      g.position.set(tmp.v.x, y, tmp.v.z)
      g.rotation.y = a.head[i]
      g.rotation.z = u === 0 && i < 3 && !asked ? Math.sin(T * 2.2 + i) * 0.05 : 0
    }

    // 水
    const dm = drops.current
    if (dm) {
      const on = U === 0 && !asked
      for (let i = 0; i < 3; i++) {
        const w = WHO[i]
        const dx = STOVE[0] - w.home[0]
        const dz = STOVE[1] - w.home[1]
        const d = Math.hypot(dx, dz)
        for (let j = 0; j < 8; j++) {
          const t = (T * 1.5 + j / 8 + i * 0.13) % 1
          const r = 0.2 + (d - 0.2) * t
          tmp.o.position.set(w.home[0] + (dx / d) * r, F + 0.31 + 0.16 * t + 0.34 * t * (1 - t), w.home[1] + (dz / d) * r)
          tmp.o.scale.setScalar(on && !(lite && j % 2) ? 0.55 + 0.6 * Math.sin(t * Math.PI) : 0.0001)
          tmp.o.rotation.set(0, 0, 0)
          tmp.o.updateMatrix()
          dm.setMatrixAt(i * 8 + j, tmp.o.matrix)
        }
      }
      dm.instanceMatrix.needsUpdate = true
    }

    // 地板塌下去（只在进度变了的时候重排）
    const q = sm(0.11, 0.26, p)
    const tm = tiles.current
    if (tm && q !== a.q) {
      a.q = q
      for (let i = 0; i < TN; i++) {
        const iz = Math.floor(i / NX)
        const x = -HW + TWX * ((i % NX) + 0.5)
        const z = -HD + TWZ * (iz + 0.5)
        const [r1, r2] = tileSeed[i]
        const f = iz === 0 ? 0 : cl(q * 1.6 - (Math.hypot(x - 0.15, z - 0.1) / 1.3) * 0.6)
        tmp.o.position.set(x + r1 * 0.05 * f, F - 0.025 - (F - 0.09 - (r2 + 1) * 0.04) * f * f, z + r2 * 0.05 * f)
        tmp.o.rotation.set(r1 * 1.3 * f, r2 * 0.6 * f, r2 * 1.3 * f)
        tmp.o.scale.setScalar(1)
        tmp.o.updateMatrix()
        tm.setMatrixAt(i, tmp.o.matrix)
      }
      tm.instanceMatrix.needsUpdate = true
    }

    // 地下室正面的墙沉下去，火露出来
    const open = sm(0.27, 0.5, p)
    const seen = Math.max(q, open)
    if (flap.current) flap.current.position.y = 0.3 - 0.66 * open
    const flick = 1 + 0.1 * Math.sin(T * 17) + 0.07 * Math.sin(T * 29)
    if (ember.current) ember.current.emissiveIntensity = 0.9 * flick
    if (spill.current) spill.current.opacity = 0.32 * open * flick
    if (up.current) up.current.opacity = 0.42 * seen * flick

    // 烟
    const sk = smoke.current
    if (sk) {
      for (let i = 0; i < NS; i++) {
        const t = (T * 0.22 + i / NS) % 1
        tmp.o.position.set(STOVE[0] - 0.1 - t * 0.7, F + 0.92 + t * 0.4, -HD + 0.28 + i * 0.05)
        tmp.o.scale.setScalar(lite ? 0.0001 : (0.5 + t * 0.9) * Math.sin(t * Math.PI))
        tmp.o.rotation.set(0, 0, 0)
        tmp.o.updateMatrix()
        sk.setMatrixAt(i, tmp.o.matrix)
      }
      sk.instanceMatrix.needsUpdate = true
    }

    // 队长的耳朵
    const hot = sm(0.62, 0.74, p)
    if (ear.current) {
      ear.current.emissiveIntensity = hot * (1.1 + 0.25 * Math.sin(T * 6))
      ear.current.color.copy(tmp.skin).lerp(tmp.hot, hot)
    }
    // 队长脑子里见过的那些火
    const bs = Math.max(0.0001, backOut((p - 0.76) / 0.08))
    if (bubble.current && bubP.current) {
      bubble.current.scale.setScalar(bs)
      bubble.current.updateMatrix()
      bubP.current.updateMatrix()
      tmp.m.multiplyMatrices(bubP.current.matrix, bubble.current.matrix)
    }

    // 所有火苗
    const grow = 1 + 0.26 * q + 0.04 * Math.sin(T * 5)
    const ft = a.FT
    for (let n = 0; n < FIRES.length; n++) {
      const f = FIRES[n]
      const sc = f.grp === 2 ? f.s * Math.max(0.0001, backOut((p - 0.8 - f.i * 0.017) / 0.06)) : f.s
      for (let i = 0; i < 3; i++) {
        const im = flames.current[i]
        if (!im) continue
        const w = Math.sin(ft * (6.5 + i * 2.1) * (0.5 + 0.5 * f.wild) + f.seed + i * 1.7)
        const k = FL[i][2] * sc
        const dir = f.flip ? -1 : 1
        tmp.o.position.set(f.x + FL[i][0] * sc * dir, f.y, f.z + FL[i][1] * sc * (f.grp === 2 ? 0.35 : 1))
        tmp.o.rotation.set(0, f.flip ? Math.PI : 0, Math.sin(ft * 4.3 * (0.5 + 0.5 * f.wild) + f.seed * 2 + i) * 0.11 * f.wild)
        tmp.o.scale.set(k * (1 - 0.07 * w * f.wild), k * (1 + 0.16 * w * f.wild) * (f.grp === 1 ? grow : 1), k * (1 - 0.07 * w * f.wild) * (f.grp === 2 ? 0.35 : 1))
        tmp.o.updateMatrix()
        if (f.grp === 2) tmp.o.matrix.premultiply(tmp.m)
        im.setMatrixAt(n, tmp.o.matrix)
      }
    }
    for (let i = 0; i < 3; i++) if (flames.current[i]) flames.current[i]!.instanceMatrix.needsUpdate = true

    if (mat.current) mat.current.opacity = phase === 'ask' && beat === 2 ? (hov === 'door' ? 0.8 : 0.36 + 0.18 * Math.sin(T * 5)) : 0
  })

  const can = phase === 'ask' && beat >= 1
  // 从镜头看过去，门口的范围有一角叠在队长和他的纸签前面：只要这一下同时穿过了队长的范围，就算点的是队长
  const onCap = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.intersections.some((i) => i.object.userData.z === 'cap')
  const over = (k: 'door' | 'cap') => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (can) setHov(onCap(e) ? 'cap' : k)
  }
  const out = () => setHov(null)
  const click = (k: number) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (!can) return
    setHov(null)
    choose(onCap(e) ? 1 : k)
  }
  const done = phase === 'done'
  const capL = CAP.lawn

  return (
    <group position={[OX, 0, OZ]} rotation={[0, ROT, 0]} scale={S}>
      <mesh geometry={geo.matte} castShadow receiveShadow>
        <Baked rough={0.85} />
      </mesh>
      <mesh geometry={geo.gloss} castShadow receiveShadow>
        <Baked rough={0.05} />
      </mesh>
      {/* 地下室正面那块墙：慢把它拉下去 */}
      <mesh ref={flap} position={[HW + 0.08 - FLW / 2, 0.3, HD + 0.04]} castShadow receiveShadow>
        <boxGeometry args={[FLW, 0.6, 0.078]} />
        <meshStandardMaterial color={STONE} roughness={0.9} />
      </mesh>
      {/* 厨房地砖 */}
      <instancedMesh ref={tiles} args={[undefined, undefined, TN]} receiveShadow frustumCulled={false}>
        <boxGeometry args={[TWX - 0.008, 0.05, TWZ - 0.008]} />
        <meshStandardMaterial roughness={0.7} />
      </instancedMesh>
      {/* 火：灶台上那点小而安静，地下室里的才是真的 */}
      {FL.map(([, , , col, em], i) => (
        <instancedMesh key={i} ref={(m) => void (flames.current[i] = m)} args={[flameGeo, undefined, FIRES.length]} frustumCulled={false}>
          <meshStandardMaterial color={col} emissive={col} emissiveIntensity={em} roughness={0.6} />
        </instancedMesh>
      ))}
      <instancedMesh ref={smoke} args={[undefined, undefined, NS]} frustumCulled={false}>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial color="#6b6560" transparent opacity={0.4} roughness={1} depthWrite={false} />
      </instancedMesh>
      {/* 灶台的火映在墙上的光 */}
      <mesh position={[STOVE[0], F + 0.62, -HD + 0.02]}>
        <planeGeometry args={[1.1, 0.9]} />
        <meshBasicMaterial map={geo.glow} color="#ff9a3c" transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* 地下室的余烬，和从里面透出来的光 */}
      <mesh position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[HW * 2 - 0.02, HD * 2 - 0.02]} />
        <meshStandardMaterial ref={ember} color="#ffb24a" emissive="#ff8a2a" emissiveIntensity={0.9} roughness={0.8} />
      </mesh>
      {/* 只照亮缺口前面那一小块草地；片子大了、亮了会把半座岛盖成一片白 */}
      <mesh position={[0.35, 0.02, HD + 0.44]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.5, 0.9]} />
        <meshBasicMaterial ref={spill} map={geo.glow} color="#ff8a2a" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh position={[0.1, F + 0.45, -HD + 0.03]}>
        <planeGeometry args={[1.9, 1.3]} />
        <meshBasicMaterial ref={up} map={geo.glow} color="#ff8a2a" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* 水 */}
      <instancedMesh ref={drops} args={[undefined, undefined, ND]} frustumCulled={false}>
        <sphereGeometry args={[0.026, 8, 6]} />
        <meshStandardMaterial color="#7cc4f2" roughness={0.2} emissive="#7cc4f2" emissiveIntensity={0.25} />
      </instancedMesh>
      {/* 门口地上的一块光：往这儿跑 */}
      <mesh position={[DOORX, F + 0.004, HD - 0.17]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.42, 0.34]} />
        <meshBasicMaterial ref={mat} color="#7df0a0" transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* 三个队员 */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(g) => void (men.current[i] = g)} geometry={geo.crew} position={[WHO[i].home[0], F, WHO[i].home[1]]} scale={PS} castShadow>
          <Baked rough={0.3} />
        </mesh>
      ))}
      {/* 队长 */}
      <group ref={capG} position={[CAP.home[0], F, CAP.home[1]]} scale={hov === 'cap' ? PS * 1.22 : PS * 1.12}>
        <mesh geometry={geo.cap} castShadow>
          <Baked rough={0.3} />
        </mesh>
        <mesh geometry={geo.ears}>
          <meshStandardMaterial ref={ear} color={C.skin} roughness={0.8} emissive="#ff3b1f" emissiveIntensity={0} />
        </mesh>
        <Tag position={[0, 1.2, 0]} tone="red" show={phase === 'ask' && beat >= 1}>
          {L('全部出去！', 'Everybody out!')}
        </Tag>
        <Tag position={[0, -0.14, 0.1]} tone={hov === 'cap' ? 'blue' : 'light'} show={phase === 'ask' && beat === 2}>
          {c.opts[1]}
        </Tag>
        <Tag position={[0, 1.2, 0]} tone="dark" show={phase === 'picked' && pick === 1 && !quiet}>
          {L('……说不上来', '…no idea why')}
        </Tag>
      </group>
      <Tag position={[DOORX, F + 0.1, HD + 0.36]} tone={hov === 'door' ? 'blue' : 'light'} show={phase === 'ask' && beat === 2}>
        {c.opts[0]}
      </Tag>
      {/* 点得到的范围（不画出来）。门口：门洞一格，加上平台和台阶；都不高过厨房地面多少，免得盖住旁边的队长 */}
      <mesh position={[DOORX, F + 0.4, HD - 0.13]} onPointerOver={over('door')} onPointerMove={over('door')} onPointerOut={out} onClick={click(0)}>
        <boxGeometry args={[0.5, 0.8, 0.34]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <mesh position={[DOORX, (F + 0.05) / 2, HD + 0.405]} onPointerOver={over('door')} onPointerMove={over('door')} onPointerOut={out} onClick={click(0)}>
        <boxGeometry args={[0.58, F + 0.05, 0.77]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* 队长：整个人，和脚边那张纸签 */}
      {phase === 'ask' && (
        <>
          <mesh position={[CAP.home[0], F + 0.36, CAP.home[1]]} userData={{ z: 'cap' }} onPointerOver={over('cap')} onPointerOut={out} onClick={click(1)}>
            <cylinderGeometry args={[0.2, 0.2, 0.78, 10]} />
            <meshBasicMaterial visible={false} />
          </mesh>
          <mesh position={[CAP.home[0] + 0.01, F - 0.1, CAP.home[1] + 0.1]} rotation={[0, -ROT, 0]} userData={{ z: 'cap' }} onPointerOver={over('cap')} onPointerOut={out} onClick={click(1)}>
            <boxGeometry args={[0.6, 0.2, 0.05]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        </>
      )}
      {/* 慢想起来的两条线索 */}
      <Tag position={[STOVE[0], F + 1.1, -HD + 0.2]} tone="dark" show={done || !!(bits & 2)}>
        {L('安静得反常', 'Unusually quiet')}
      </Tag>
      <Tag position={[capL[0] + 0.3, 0.6, capL[1] + 0.16]} tone="dark" show={done || !!(bits & 4)}>
        {L('耳朵发烫', 'Ears burning')}
      </Tag>
      {/* 队长脑子里的一格格火：他见过太多了 */}
      <group ref={bubP} position={[capL[0], 0, capL[1]]} rotation={[0, -ROT, 0]}>
        <group ref={bubble} position={[0, 1.04, 0]} rotation={[-0.3, 0, 0]} scale={0.0001}>
          <mesh geometry={geo.board} castShadow>
            <meshStandardMaterial vertexColors roughness={0.75} />
          </mesh>
          <Tag position={[0, 0.31, 0]} tone="blue" show={done || !!(bits & 8)}>
            {L('他见过太多火', 'Seen too many fires')}
          </Tag>
        </group>
      </group>
    </group>
  )
}
