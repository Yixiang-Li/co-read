import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { bus } from '../bus'
import { useLang, type Lang } from '../i18n'
import { bookBase, bookSkin, drawPages, NL, type BookBase, type BookSkin } from './bookTex'
import { PD, PW, sm } from './kit'

// 一本布面精装书。下面的坐标都以订口（书脊那条线）为原点：x 向右是书口，y 向上，z 向着镜头是书根。
const TC = 0.055 // 封面纸板的厚度
const H = 0.51 // 书芯的厚度；摊开后左右各一半，页面顶面在 TC + H/2 = 0.31
const OV = 0.07 // 飘口：封面比书芯大出来的一圈
const JW = 0.13 // 书槽：纸板离订口的距离
const GAP = 0.014 // 合着时封面和书芯之间留给环衬的缝
const BW = PW + OV - JW
const BD = PD + OV * 2
const HX = -PW / 2
const YAW = 0.24 // 合着时书斜放一点，能看到书脊和书根
const NU = 24 // 一页纸从订口到书口分多少段（靠订口更密）
const NV = 6
const US = Float32Array.from({ length: NU + 1 }, (_, k) => Math.pow(k / NU, 1.5))
const L0 = 0.2 // 第一张纸起飞
const L1 = 0.495 // 最后一张纸起飞
const LDUR = 0.11
const LEND = L1 + LDUR // 到这里所有纸都落下了，书完全摊平（0.605）
export const BOOK_TOP = TC + H / 2 // 摊平后页面顶面的高度（书自己的坐标里）
const NS = 22
const lerp = THREE.MathUtils.lerp
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smoother = (t: number) => t * t * t * (t * (6 * t - 15) + 10)
const tau = (o: number, i: number) => clamp01((o - (L0 + (i * (L1 - L0)) / (NL - 1))) / LDUR)

// 书的姿态：封面角度、封面转轴的高度、左右两叠纸的厚度和顶面的轮廓
type Pose = { a: number; ky: number; hL: number; hR: number; yG: number; fan: number; yR: Float32Array; yL: Float32Array }
const ramp = (u: number) => 1 - Math.pow(1 - Math.min(1, u), 2.4)
function solve(P: Pose, o: number, lift: number) {
  P.a = Math.PI * sm(0, 0.3, o) + lift
  P.ky = lerp(TC + H + GAP, TC, sm(0.14, 0.3, o))
  P.hL = (H / 2) * sm(0.3, LEND, o)
  P.hR = H - P.hL
  // 书摊开后书口是斜的：越靠下的纸伸出去越多，两块封面板也跟着往两边让
  P.fan = 0.42 * P.hL
  // 订口那一点的高度：纸从这里爬上两边的纸叠
  P.yG = Math.min(TC + P.hR, Math.max(P.ky, TC + lerp(0.85, 0.94, sm(0.5, LEND, o)) * P.hL))
  const dR = TC + P.hR - P.yG
  const dL = TC + P.hL - P.yG
  const wR = 0.1 + 1.15 * Math.abs(dR)
  const wL = 0.1 + 1.15 * Math.abs(dL)
  for (let k = 0; k <= NU; k++) {
    const d = US[k] * PW
    P.yR[k] = P.yG + dR * ramp(d / wR)
    P.yL[k] = P.yG + dL * ramp(d / wL)
  }
}
const prof = (arr: Float32Array, d: number) => {
  const f = Math.pow(clamp01(d / PW), 1 / 1.5) * NU
  const i = Math.min(NU - 1, Math.floor(f))
  return arr[i] + (arr[i + 1] - arr[i]) * (f - i)
}
const put = (a: Float32Array, i: number, x: number, y: number, z: number) => {
  a[i] = x
  a[i + 1] = y
  a[i + 2] = z
}

// 一叠纸：顶面是一页，三面是书口
function makeStack(sign: 1 | -1) {
  const nT = (NU + 1) * 2
  const count = nT * 3 + 8
  const pos = new Float32Array(count * 3)
  const uv = new Float32Array(count * 2)
  const idx: number[] = []
  const quad = (a: number, b: number, c: number, d: number, rev: boolean) => (rev !== sign < 0 ? idx.push(a, c, b, b, c, d) : idx.push(a, b, c, b, d, c))
  const A = nT
  const B = nT * 2
  const F = nT * 3
  const S = F + 4
  for (let k = 0; k < NU; k++) quad(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 3, false)
  for (let k = 0; k < NU; k++) quad(A + 2 * k, A + 2 * k + 1, A + 2 * k + 2, A + 2 * k + 3, true)
  for (let k = 0; k < NU; k++) quad(B + 2 * k, B + 2 * k + 1, B + 2 * k + 2, B + 2 * k + 3, false)
  quad(F, F + 1, F + 2, F + 3, true)
  quad(S, S + 1, S + 2, S + 3, false)
  for (let k = 0; k <= NU; k++) {
    uv.set([US[k], 1, US[k], 0], k * 4)
    uv.set([US[k] * 2.2, 0, US[k] * 2.2, 1], (A + 2 * k) * 2)
    uv.set([US[k] * 2.2 + 0.37, 0, US[k] * 2.2 + 0.37, 1], (B + 2 * k) * 2)
  }
  uv.set([0, 0, 3.1, 0, 0, 1, 3.1, 1], F * 2)
  uv.set([0, 0, 3.1, 0, 0, 1, 3.1, 1], S * 2)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.addGroup(0, NU * 6, 0)
  geo.addGroup(NU * 6, idx.length - NU * 6, 1)
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3((sign * PW) / 2, 0.3, 0), 4)
  const z = PD / 2
  const update = (top: Float32Array, hNom: number, fan: number) => {
    const vt = hNom / H // 书口的纹理按厚度取，纸叠薄了，纸的层数就少了
    for (let k = 0; k <= NU; k++) {
      const x = sign * US[k] * PW
      const xb = sign * US[k] * (PW + fan)
      const t = top[k]
      put(pos, k * 6, x, t, -z)
      put(pos, k * 6 + 3, x, t, z)
      put(pos, (A + 2 * k) * 3, xb, TC, z)
      put(pos, (A + 2 * k) * 3 + 3, x, t, z)
      put(pos, (B + 2 * k) * 3, xb, TC, -z)
      put(pos, (B + 2 * k) * 3 + 3, x, t, -z)
      uv[(A + 2 * k + 1) * 2 + 1] = vt
      uv[(B + 2 * k + 1) * 2 + 1] = vt
    }
    const xf = sign * PW
    const xfb = sign * (PW + fan)
    put(pos, F * 3, xfb, TC, -z)
    put(pos, F * 3 + 3, xfb, TC, z)
    put(pos, F * 3 + 6, xf, top[NU], -z)
    put(pos, F * 3 + 9, xf, top[NU], z)
    put(pos, S * 3, 0, TC, -z)
    put(pos, S * 3 + 3, 0, TC, z)
    put(pos, S * 3 + 6, 0, top[0], -z)
    put(pos, S * 3 + 9, 0, top[0], z)
    uv[(F + 2) * 2 + 1] = uv[(F + 3) * 2 + 1] = uv[(S + 2) * 2 + 1] = uv[(S + 3) * 2 + 1] = vt
    geo.attributes.position.needsUpdate = true
    geo.attributes.uv.needsUpdate = true
    geo.computeVertexNormals()
  }
  return { geo, update }
}

// 一张会弯的纸（每张只有 175 个顶点，只在翻书时才重算）。t 是它翻过去的进度：书口那一头先抬起来、先落下去，靠书根的角先动
const LAG = 0.34
const ZL = 0.2
function makeLeaf() {
  const pos = new Float32Array((NU + 1) * (NV + 1) * 3)
  const uv = new Float32Array((NU + 1) * (NV + 1) * 2)
  const idx: number[] = []
  for (let j = 0; j <= NV; j++) for (let k = 0; k <= NU; k++) uv.set([US[k], 1 - j / NV], (j * (NU + 1) + k) * 2)
  for (let j = 0; j < NV; j++) {
    for (let k = 0; k < NU; k++) {
      const a = j * (NU + 1) + k
      const b = a + NU + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 5)
  const update = (P: Pose, t: number, offR: number, offL: number) => {
    for (let j = 0; j <= NV; j++) {
      const z = -PD / 2 + (PD * j) / NV
      const tr = clamp01(t * (1 + ZL) - ZL * (1 - j / NV))
      const off = lerp(offR, offL, smoother(tr))
      let x = 0
      let y = P.yG
      let p = j * (NU + 1) * 3
      put(pos, p, 0, y + off, z)
      for (let k = 0; k < NU; k++) {
        const um = (US[k] + US[k + 1]) / 2
        const e = smoother(clamp01(tr * (1 + LAG) - LAG * (1 - um)))
        const dx = (US[k + 1] - US[k]) * PW
        const dyR = P.yR[k + 1] - P.yR[k]
        const dyL = P.yL[k + 1] - P.yL[k]
        // 每一小段的方向：从贴着右边纸叠，转到贴着左边纸叠
        const ang = Math.atan2(dyR, dx) * (1 - e) + (Math.PI - Math.atan2(dyL, dx)) * e
        const len = Math.hypot(dx, dyR) * (1 - e) + Math.hypot(dx, dyL) * e
        x += Math.cos(ang) * len
        y += Math.sin(ang) * len
        const fl = x >= 0 ? prof(P.yR, x) : prof(P.yL, -x)
        p += 3
        put(pos, p, x, Math.max(y, fl) + off, z)
      }
    }
    geo.attributes.position.needsUpdate = true
    geo.computeVertexNormals()
  }
  return { geo, update }
}

// 书脊的布：从封底纸板的边绕到封面纸板的边，两头各有一道书槽。封面掀开时它跟着被拉开、放平
function makeSpine() {
  const count = (NS + 1) * 8
  const pos = new Float32Array(count * 3)
  const nor = new Float32Array(count * 3)
  const uv = new Float32Array(count * 2)
  const idx: number[] = []
  const outer: number[] = []
  for (let k = 0; k < NS; k++) {
    const a = k * 8
    const b = a + 8
    outer.push(a, a + 1, b, a + 1, b + 1, b)
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3)
    idx.push(a + 4, b + 4, a + 5, a + 5, b + 4, b + 5)
    idx.push(a + 6, a + 7, b + 6, a + 7, b + 7, b + 6)
  }
  for (let k = 0; k <= NS; k++) {
    const q = k / NS
    uv.set([q, 1, q, 0, q, 1, q, 0, q, 0.5, q, 0.5, q, 0.5, q, 0.5], k * 16)
  }
  const mkGeo = (index: number[]) => {
    const geo = new THREE.BufferGeometry()
    geo.setIndex(index)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), 4)
    return geo
  }
  const geo = mkGeo([...outer, ...idx])
  const foilGeo = mkGeo(outer)
  const pa = new THREE.BufferAttribute(pos, 3)
  const na = new THREE.BufferAttribute(nor, 3)
  const ua = new THREE.BufferAttribute(uv, 2)
  for (const g of [geo, foilGeo]) {
    g.setAttribute('position', pa)
    g.setAttribute('normal', na)
    g.setAttribute('uv', ua)
  }
  const ox = new Float32Array(NS + 1)
  const oy = new Float32Array(NS + 1)
  const z = BD / 2
  const update = (P: Pose) => {
    const ca = Math.cos(P.a)
    const sa = Math.sin(P.a)
    const x0 = JW + P.fan
    const y0 = TC + 0.004
    const x3 = -P.fan + JW * ca - 0.004 * sa
    const y3 = P.ky + JW * sa + 0.004 * ca
    const m = lerp(0.27, (2 * JW + 2 * P.fan) / 3, clamp01(P.a / Math.PI))
    const x1 = x0 - m
    const y1 = y0
    const x2 = x3 - m * ca
    const y2 = y3 - m * sa
    for (let k = 0; k <= NS; k++) {
      const q = k / NS
      const r = 1 - q
      const bx = r * r * r * x0 + 3 * r * r * q * x1 + 3 * r * q * q * x2 + q * q * q * x3
      const by = r * r * r * y0 + 3 * r * r * q * y1 + 3 * r * q * q * y2 + q * q * q * y3
      let tx = 3 * r * r * (x1 - x0) + 6 * r * q * (x2 - x1) + 3 * q * q * (x3 - x2)
      let ty = 3 * r * r * (y1 - y0) + 6 * r * q * (y2 - y1) + 3 * q * q * (y3 - y2)
      const l = Math.hypot(tx, ty) || 1
      tx /= l
      ty /= l
      // 两头是书槽（贴着纸板内侧那一层），中间鼓出来一个纸板的厚度
      const w = sm(0.07, 0.2, q) * (1 - sm(0.8, 0.93, q))
      let x = bx - ty * TC * 0.92 * w
      let y = by + tx * TC * 0.92 * w
      // 不许钻进书芯里
      if (x > -0.006) y = q < 0.5 ? Math.min(y, TC + 0.004) : Math.max(y, P.ky + 0.003)
      else if (q < 0.5 && y > TC && x > -0.012) x = -0.012
      ox[k] = x
      oy[k] = y
    }
    for (let k = 0; k <= NS; k++) {
      const a = Math.max(0, k - 1)
      const b = Math.min(NS, k + 1)
      let tx = ox[b] - ox[a]
      let ty = oy[b] - oy[a]
      const l = Math.hypot(tx, ty) || 1
      tx /= l
      ty /= l
      const nx = -ty
      const ny = tx
      const q = k / NS
      const th = 0.005 + 0.017 * sm(0.07, 0.2, q) * (1 - sm(0.8, 0.93, q))
      const ix = ox[k] - nx * th
      const iy = oy[k] - ny * th
      const p = k * 24
      put(pos, p, ox[k], oy[k], -z)
      put(pos, p + 3, ox[k], oy[k], z)
      put(pos, p + 6, ix, iy, -z)
      put(pos, p + 9, ix, iy, z)
      put(pos, p + 12, ox[k], oy[k], -z)
      put(pos, p + 15, ix, iy, -z)
      put(pos, p + 18, ox[k], oy[k], z)
      put(pos, p + 21, ix, iy, z)
      put(nor, p, nx, ny, 0)
      put(nor, p + 3, nx, ny, 0)
      put(nor, p + 6, -nx, -ny, 0)
      put(nor, p + 9, -nx, -ny, 0)
      put(nor, p + 12, 0, 0, -1)
      put(nor, p + 15, 0, 0, -1)
      put(nor, p + 18, 0, 0, 1)
      put(nor, p + 21, 0, 0, 1)
    }
    pa.needsUpdate = true
    na.needsUpdate = true
  }
  return { geo, foilGeo, update }
}

// 书签丝带：夹在靠后的某一页，从书根垂出来，搭在纸面上拐个弯
function makeRibbon() {
  const xr = 1.05
  const yr = TC + H * 0.25
  const z = PD / 2
  const pts = ([[xr, yr, z - 0.08], [xr, yr, z + 0.008], [xr + 0.008, yr - 0.03, z + 0.05], [xr + 0.022, 0.074, z + OV + 0.028], [xr + 0.05, 0.022, z + OV + 0.1], [xr + 0.12, 0.008, z + 0.3], [xr + 0.25, 0.008, z + 0.41], [xr + 0.4, 0.008, z + 0.44], [xr + 0.53, 0.008, z + 0.53]] as const).map((p) => new THREE.Vector3(...p))
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
  const M = 40
  const W = 0.04
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const side = new THREE.Vector3(1, 0, 0)
  const T = new THREE.Vector3()
  const P = new THREE.Vector3()
  for (let i = 0; i <= M; i++) {
    const t = i / M
    curve.getPointAt(t, P)
    curve.getTangentAt(t, T)
    if (Math.hypot(T.x, T.z) > 0.2) side.set(T.z, 0, -T.x).normalize()
    const y = Math.max(P.y, 0.007)
    // 末端剪成燕尾
    const tip = i === M ? 0.06 : 0
    pos.push(P.x - side.x * W + T.x * tip, y, P.z - side.z * W + T.z * tip, P.x, y, P.z, P.x + side.x * W + T.x * tip, y, P.z + side.z * W + T.z * tip)
    uv.push(0, t * 10, 0.5, t * 10, 1, t * 10)
    if (i < M) {
      const a = i * 3
      idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

// 包着布的纸板，边角略圆。tile 有值时布纹平铺，否则整张贴图铺满正面（封面的烫金版式）
function slab(tile?: number) {
  const g = new RoundedBoxGeometry(BW, TC, BD, 2, 0.017)
  g.translate(JW + BW / 2, TC / 2, 0)
  const p = g.attributes.position
  const uv = g.attributes.uv
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    if (tile) uv.setXY(i, x / tile, z / tile)
    else uv.setXY(i, (x - JW) / BW, 0.5 - z / BD)
  }
  return g
}

const clothMat = (map: THREE.Texture, normalMap: THREE.Texture) => new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.93 })
// 烫金单独一层，贴在布面上面一点点：全金属，只有它反射那个小摄影棚
const foilMat = (map: THREE.Texture, normalMap: THREE.Texture, envMap: THREE.Texture) =>
  new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1, 1), envMap, envMapIntensity: 1.2, metalness: 1, roughness: 0.24, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
// 纸：粗糙、不反光，背着光的一面也透一点亮（纸是半透的）
function paperMat(map: THREE.Texture, side: THREE.Side = THREE.FrontSide) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.93, side, shadowSide: THREE.DoubleSide, emissive: '#fff6e4', emissiveMap: map, emissiveIntensity: 0.2 })
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
        reflectedLight.directDiffuse += saturate( dot( -normal, directionalLights[ 0 ].direction ) ) * 0.34 * directionalLights[ 0 ].color * BRDF_Lambert( material.diffuseColor );
      #endif`,
    )
  }
  m.customProgramCacheKey = () => 'book-paper'
  return m
}
const noHit = () => null

function build(tex: BookBase) {
  const edge = new THREE.MeshStandardMaterial({ map: tex.edge, roughness: 0.96, emissive: '#ffe9c4', emissiveMap: tex.edge, emissiveIntensity: 0.3 })
  const blob = () => new THREE.MeshBasicMaterial({ map: tex.shadow, transparent: true, depthWrite: false, toneMapped: false })
  // 内页先用一张白纸占位，画好了再换上（见 drawPages）
  const leaves = Array.from({ length: NL }, (_, i) => ({ ...makeLeaf(), mats: [paperMat(i ? tex.blank : tex.endpaper), paperMat(tex.blank, THREE.BackSide)] }))
  // 封面和书脊的布面、烫金先用平铺的布纹占位，带字的贴图由 skin() 换上
  const cloth = () => clothMat(tex.cloth.map, tex.cloth.normalMap)
  return {
    stackR: makeStack(1),
    stackL: makeStack(-1),
    spine: makeSpine(),
    leaves,
    front: slab(),
    back: slab(0.65),
    ribbon: makeRibbon(),
    coverMat: cloth(),
    coverFoil: foilMat(tex.blank, tex.cloth.normalMap, tex.env),
    spineMat: cloth(),
    spineFoil: foilMat(tex.blank, tex.cloth.normalMap, tex.env),
    clothMat: cloth(),
    rightMats: [paperMat(tex.blank), edge],
    leftMats: [paperMat(tex.blank), edge],
    endMat: paperMat(tex.endpaper),
    bandMat: new THREE.MeshStandardMaterial({ map: tex.band, roughness: 0.7 }),
    ribbonMat: new THREE.MeshStandardMaterial({ map: tex.ribbon, roughness: 0.48, side: THREE.DoubleSide }),
    blobR: blob(),
    blobL: blob(),
  }
}
type Kit = ReturnType<typeof build>
// 换上某种语言的封面和书脊
function skin(K: Kit, sk: BookSkin) {
  K.coverMat.map = sk.cover.map
  K.coverMat.normalMap = K.coverFoil.normalMap = sk.cover.normalMap
  K.coverFoil.map = sk.cover.foilMap
  K.spineMat.map = sk.spine.map
  K.spineMat.normalMap = K.spineFoil.normalMap = sk.spine.normalMap
  K.spineFoil.map = sk.spine.foilMap
}

function Body({ base, sk, lang, onOpen }: { base: BookBase; sk: BookSkin; lang: Lang; onOpen: () => void }) {
  const g = useRef<THREE.Group>(null)
  const cover = useRef<THREE.Group>(null)
  const backG = useRef<THREE.Group>(null)
  const left = useRef<THREE.Mesh>(null)
  const bands = useRef<THREE.Group>(null)
  const leafG = useRef<(THREE.Group | null)[]>([])
  const ground = useRef<THREE.Mesh>(null)
  const blobL = useRef<THREE.Mesh>(null)
  const foil = useRef<THREE.Mesh>(null)
  const sfoil = useRef<THREE.Mesh>(null)
  const K = useMemo(() => build(base), [base])
  const S = useRef({ t: 0, lift: 0, hover: false, intro: 0, o: -1, a: -1, pose: { a: 0, ky: 0, hL: 0, hR: 0, yG: 0, fan: 0, yR: new Float32Array(NU + 1), yL: new Float32Array(NU + 1) } as Pose })
  useLayoutEffect(() => skin(K, sk), [K, sk])
  useEffect(() => () => void (document.body.style.cursor = ''), [])
  // 内页在后台一张张画，画好就换到对应的纸上
  useEffect(() => {
    let dead = false
    drawPages(
      lang,
      (leaf, side, t) => {
        const m = leaf === NL ? ((side ? K.leftMats : K.rightMats)[0] as THREE.MeshStandardMaterial) : K.leaves[leaf].mats[side]
        m.map = m.emissiveMap = t
      },
      () => dead,
    )
    return () => void (dead = true)
  }, [K, lang])

  useFrame((st, dt) => {
    const o = bus.open
    const s = S.current
    if (!g.current) return
    s.t += dt * (1 - 0.93 * bus.t)
    s.intro = Math.min(1, s.intro + dt / 0.55)
    const pop = 1 - Math.pow(1 - s.intro, 3)
    if (s.hover && o > 0.08) {
      s.hover = false
      document.body.style.cursor = ''
    }
    // 合着时很轻的呼吸：封面抬起一线；鼠标放上去再抬一点，提示可以翻开
    const closed = 1 - sm(0, 0.05, o)
    const want = (0.006 + 0.006 * Math.sin(s.t * 1.15) + (s.hover ? 0.04 : 0)) * closed
    s.lift += (want - s.lift) * (1 - Math.exp(-dt * 5))
    if (Math.abs(want - s.lift) < 0.00005) s.lift = want
    // 合着时书在正中；翻开时整本往右挪半页，摊开后订口正好在原点
    g.current.position.x = (sm(0, 0.5, o) * PW) / 2
    g.current.rotation.y = YAW * (1 - sm(0, 0.32, o))
    g.current.scale.setScalar(0.94 + 0.06 * pop)

    // 几何体只在书真的动了的时候才重算；摊平以后每帧什么都不用算
    const P = s.pose
    const moved = o !== s.o
    if (moved || s.lift !== s.a) {
      solve(P, o, s.lift)
      K.spine.update(P)
      if (cover.current) {
        cover.current.position.set(-P.fan, P.ky, 0)
        cover.current.rotation.z = P.a
      }
      // 扣在下面看不见的烫金就不画了
      if (foil.current) foil.current.visible = P.a < 2.3
      if (sfoil.current) sfoil.current.visible = P.a < 2.7
      s.a = s.lift
    }
    if (moved) {
      s.o = o
      K.stackR.update(P.yR, P.hR, P.fan)
      if (backG.current) backG.current.position.x = P.fan
      if (blobL.current) blobL.current.position.x = -(JW + BW / 2) - P.fan + 0.05
      if (left.current) {
        left.current.visible = P.hL > 0.003
        if (left.current.visible) K.stackL.update(P.yL, P.hL, P.fan)
      }
      // 堵头布贴着书芯的背，书摊开后只剩订口底下那一小段
      if (bands.current) {
        const hb = Math.max(0.0005, P.yG - TC)
        bands.current.scale.y = hb
        bands.current.visible = hb > 0.004
        base.band.repeat.set(1, hb / 0.2)
      }
      // 一张张纸：压在下面看不见的不画，只有在空中的才投影子；全落下之后就都收起来，露出两叠纸平整的顶面
      for (let i = 0; i < NL; i++) {
        const lg = leafG.current[i]
        if (!lg) continue
        const t = tau(o, i)
        lg.visible = o < LEND && (t <= 0 ? i === 0 || tau(o, i - 1) > 0 : t >= 1 ? i === NL - 1 || tau(o, i + 1) < 1 : true)
        if (!lg.visible) continue
        K.leaves[i].update(P, t, 0.0012 * (NL - i), 0.003 + 0.0012 * i)
        lg.children[0].castShadow = t > 0 && t < 1 && bus.quality === 1
      }
    }
    // 金箔上的反光跟着时间和鼠标慢慢移动
    if (o < 0.3) {
      const rx = 0.07 * Math.sin(s.t * 0.55) + st.pointer.y * 0.1
      const ry = st.pointer.x * 0.3
      K.coverFoil.envMapRotation.set(rx, ry, 0)
      K.spineFoil.envMapRotation.set(rx, ry, 0)
    }
    // 桌面上的影子：画出来的一圈软阴影一直在；真影子只在正常档开
    K.blobR.opacity = 0.5 * pop
    K.blobL.opacity = 0.5 * pop * sm(0.18, 0.3, o)
    if (ground.current) ground.current.visible = bus.quality === 1
  })

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (bus.open > 0.5) return
    e.stopPropagation()
    onOpen()
  }
  const over = () => {
    if (bus.open > 0.05) return
    S.current.hover = true
    document.body.style.cursor = 'pointer'
  }
  const out = () => {
    if (!S.current.hover) return
    S.current.hover = false
    document.body.style.cursor = ''
  }
  const bw = BW / 0.76
  const bd = BD / 0.76
  return (
    <group ref={g}>
      <group position={[HX, 0, 0]}>
        {/* 封底：纸板、内侧的环衬、压在桌面上的软阴影 */}
        <group ref={backG}>
          <mesh geometry={K.back} material={K.clothMat} castShadow receiveShadow raycast={noHit} />
          <mesh position={[(JW + BW - 0.035) / 2, TC + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} material={K.endMat} receiveShadow raycast={noHit}>
            <planeGeometry args={[JW + BW - 0.035, BD - 0.07]} />
          </mesh>
          <mesh position={[JW + BW / 2 + 0.05, 0.004, -0.04]} rotation={[-Math.PI / 2, 0, 0]} material={K.blobR} raycast={noHit}>
            <planeGeometry args={[bw, bd]} />
          </mesh>
        </group>
        <mesh ref={blobL} position={[-(JW + BW / 2) + 0.05, 0.004, -0.04]} rotation={[-Math.PI / 2, 0, 0]} material={K.blobL} raycast={noHit}>
          <planeGeometry args={[bw, bd]} />
        </mesh>
        {/* 书芯 */}
        <mesh geometry={K.stackR.geo} material={K.rightMats} castShadow receiveShadow onClick={click} onPointerOver={over} onPointerOut={out} />
        <mesh ref={left} geometry={K.stackL.geo} material={K.leftMats} castShadow receiveShadow visible={false} raycast={noHit} />
        {K.leaves.map((lf, i) => (
          <group key={i} ref={(el) => void (leafG.current[i] = el)} visible={false}>
            <mesh geometry={lf.geo} material={lf.mats[0]} receiveShadow raycast={noHit} />
            <mesh geometry={lf.geo} material={lf.mats[1]} receiveShadow raycast={noHit} />
          </group>
        ))}
        {/* 书脊、堵头布、丝带 */}
        <mesh geometry={K.spine.geo} material={K.spineMat} castShadow receiveShadow raycast={noHit} />
        <mesh ref={sfoil} geometry={K.spine.foilGeo} material={K.spineFoil} raycast={noHit} />
        <group ref={bands} position={[-0.004, TC, 0]}>
          {[-1, 1].map((sg) => (
            <mesh key={sg} position={[0, 0.5, sg * (PD / 2 + 0.006)]} material={K.bandMat} raycast={noHit}>
              <cylinderGeometry args={[0.032, 0.032, 1, 10, 1, true]} />
            </mesh>
          ))}
        </group>
        <mesh geometry={K.ribbon} material={K.ribbonMat} castShadow receiveShadow raycast={noHit} />
        {/* 封面：纸板、烫金、内侧的环衬 */}
        <group ref={cover}>
          <mesh geometry={K.front} material={K.coverMat} castShadow receiveShadow onClick={click} onPointerOver={over} onPointerOut={out} />
          <mesh ref={foil} position={[JW + BW / 2, TC + 0.0008, 0]} rotation={[-Math.PI / 2, 0, 0]} material={K.coverFoil} raycast={noHit}>
            <planeGeometry args={[BW, BD]} />
          </mesh>
          <mesh position={[(JW + BW - 0.04) / 2, -0.0012, 0]} rotation={[Math.PI / 2, 0, 0]} material={K.endMat} receiveShadow raycast={noHit}>
            <planeGeometry args={[JW + BW - 0.04, BD - 0.08]} />
          </mesh>
        </group>
      </group>
      {/* 只接影子的一块桌面：书和翻起来的纸投下的真影子。省电档关掉 */}
      <mesh ref={ground} position={[-0.3, 0.002, -0.2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow raycast={noHit}>
        <planeGeometry args={[10.4, 7.8]} />
        <shadowMaterial transparent color="#3a2a16" opacity={0.26} depthWrite={false} />
      </mesh>
    </group>
  )
}

// 一本布面精装书：封面掀开，书页一张张弯着翻过去，最后摊成平整的两页，之后一直摊在那里。
// 整本书在自己的坐标里：桌面是 y = 0，摊平后页面顶面在 y = BOOK_TOP（0.31），对开页的中心（订口）在 x = 0。
export default function Book({ onOpen }: { onOpen: () => void }) {
  const gl = useThree((s) => s.gl)
  const lang = useLang()
  const [tex, setTex] = useState<{ base: BookBase; sk: BookSkin; lang: Lang } | null>(null)
  useEffect(() => {
    let dead = false
    Promise.all([bookBase(gl), bookSkin(lang)]).then(([base, sk]) => !dead && setTex({ base, sk, lang }))
    return () => void (dead = true)
  }, [gl, lang])
  useEffect(() => void (tex && (bus.bookReady = true)), [tex])
  return tex ? <Body {...tex} onOpen={onOpen} /> : null
}
