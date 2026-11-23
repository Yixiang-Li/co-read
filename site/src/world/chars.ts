import * as THREE from 'three'
import { aged, clayMat, FELT, SKIN as SKIN_MAT } from './kit'
import { clayMesh, tint, type Part } from './sdf'

// 兔子（快）、乌龟（慢）和台灯。全部用代码生成：柔软的身体是“捏”出来的（见 sdf.ts），
// 硬的零件（眼镜、灯罩）是旋转体和圆环。脸朝 +Z，脚踩在 y = 0。

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const C = (hex: string) => new THREE.Color(hex)
const mesh = (name: string, g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
  const o = new THREE.Mesh(g, m)
  o.name = name
  o.castShadow = shadow
  o.receiveShadow = shadow
  return o
}
const EYE = new THREE.MeshStandardMaterial({ color: '#0b0c10', roughness: 0.05, metalness: 0, envMapIntensity: 1.6 })
const GLINT = new THREE.MeshBasicMaterial({ color: '#ffffff' })
export const BRASS = aged(new THREE.MeshStandardMaterial({ color: '#d9a550', roughness: 0.28, metalness: 1, envMapIntensity: 1.25 }))
const BRASS_D = aged(new THREE.MeshStandardMaterial({ color: '#8a6230', roughness: 0.44, metalness: 1 }))
const eyeGeo = new THREE.SphereGeometry(1, 20, 14)

// ---------- 兔子 ----------
const FUR = '#f1e4cf'
const BELLY = C('#fffaf0')
const PINK = C('#f0a3b0')
const BLUSH = C('#f2ab9e')
export function buildHare() {
  const fur = clayMat(0.95, 'felt', FELT)
  const root = new THREE.Group()
  root.name = 'hare'
  const body: Part[] = [
    { t: 'e', p: [0, 0.175, -0.05], r: [0.155, 0.16, 0.19], c: FUR },
    { t: 'e', p: [0, 0.17, -0.13], r: [0.16, 0.162, 0.15], c: FUR },
    { t: 'e', p: [0, 0.21, 0.07], r: [0.125, 0.14, 0.12], c: FUR },
    { t: 'e', p: [0, 0.41, 0.14], r: [0.152, 0.132, 0.142], c: FUR }, // 头
    { t: 'e', p: [0.072, 0.368, 0.215], r: [0.07, 0.06, 0.064], c: FUR }, // 两腮
    { t: 'e', p: [-0.072, 0.368, 0.215], r: [0.07, 0.06, 0.064], c: FUR },
    { t: 'e', p: [0, 0.385, 0.262], r: [0.05, 0.04, 0.046], c: FUR }, // 鼻吻
    { t: 'e', p: [0.072, 0.065, 0.155], r: [0.043, 0.066, 0.058], c: FUR }, // 前爪
    { t: 'e', p: [-0.072, 0.065, 0.155], r: [0.043, 0.066, 0.058], c: FUR },
    { t: 'e', p: [0.118, 0.042, 0.005], r: [0.056, 0.042, 0.132], c: FUR }, // 后脚
    { t: 'e', p: [-0.118, 0.042, 0.005], r: [0.056, 0.042, 0.132], c: FUR },
    { t: 'e', p: [0.05, 0.52, 0.1], r: [0.04, 0.04, 0.036], c: FUR }, // 耳根
    { t: 'e', p: [-0.05, 0.52, 0.1], r: [0.04, 0.04, 0.036], c: FUR },
    { t: 'e', p: [0, 0.2, -0.3], r: [0.07, 0.07, 0.07], c: '#fffaf0', k: 0.02 }, // 尾巴
  ]
  const v = new THREE.Vector3()
  root.add(
    mesh(
      'body',
      clayMesh(body, 0.016, 0.04, {
        paint: (p, n, c) => {
          const belly = sstep(0.1, 0.5, n.z) * sstep(0.34, 0.12, p.y) * sstep(-0.02, 0.06, p.z)
          c.lerp(BELLY, belly)
          for (const sx of [1, -1]) c.lerp(BLUSH, (1 - sstep(0.012, 0.046, p.distanceTo(v.set(sx * 0.112, 0.352, 0.245)))) * 0.75)
        },
      }),
      fur,
    ),
  )
  for (const [name, sx] of [['earL', 1], ['earR', -1]] as const) {
    const piv = new THREE.Group()
    piv.name = name
    piv.position.set(sx * 0.056, 0.525, 0.1)
    const g = clayMesh(
      [
        { t: 'e', p: [sx * 0.012, 0.165, 0], r: [0.047, 0.165, 0.027], rot: [0, 0, -sx * 0.1], c: FUR },
        { t: 'e', p: [0, 0.025, 0], r: [0.036, 0.05, 0.03], c: FUR },
      ],
      0.0085,
      0.03,
      {
        paint: (p, n, c) => {
          const ex = (p.x - sx * (0.012 + (p.y - 0.165) * 0.1)) / 0.03
          const ey = (p.y - 0.17) / 0.128
          c.lerp(PINK, (1 - sstep(0.7, 1, Math.hypot(ex, ey))) * sstep(0.2, 0.5, n.z))
        },
      },
    )
    piv.add(mesh(name + '_m', g, fur))
    root.add(piv)
  }
  // 红围巾：绕脖子一圈，结在一侧，两条尾巴往后飘
  const RED = '#d9502f'
  root.add(
    mesh(
      'scarf',
      clayMesh(
        [
          { t: 't', p: [0, 0.292, 0.085], R: 0.116, r: 0.029, rot: [0.2, 0, 0], s: [1, 0.85, 0.97], c: RED },
          { t: 'e', p: [0.1, 0.277, 0.165], r: [0.037, 0.036, 0.035], c: RED },
          { t: 'c', a: [0.1, 0.275, 0.165], b: [0.19, 0.285, 0.03], r: 0.022, c: RED },
          { t: 'c', a: [0.19, 0.285, 0.03], b: [0.215, 0.31, -0.09], r: 0.021, r2: 0.016, c: RED },
          { t: 'c', a: [0.1, 0.27, 0.165], b: [0.185, 0.215, 0.06], r: 0.021, c: RED },
          { t: 'c', a: [0.185, 0.215, 0.06], b: [0.215, 0.205, -0.04], r: 0.02, r2: 0.015, c: RED },
        ],
        0.0085,
        0.022,
      ),
      clayMat(0.95, 'felt', FELT),
    ),
  )
  for (const sx of [1, -1]) {
    const e = mesh('eye', eyeGeo, EYE)
    e.position.set(sx * 0.078, 0.434, 0.2445)
    e.scale.set(0.025, 0.027, 0.025)
    const gl = mesh('glint', eyeGeo, GLINT, false)
    gl.position.set(sx * 0.078 - 0.007, 0.446, 0.2645)
    gl.scale.setScalar(0.0066)
    root.add(e, gl)
  }
  const nose = mesh('nose', tint(new THREE.SphereGeometry(1, 14, 10), '#ec8f9f'), clayMat(0.6, 'plain'))
  nose.position.set(0, 0.394, 0.303)
  nose.scale.set(0.017, 0.012, 0.011)
  root.add(nose)
  return root
}

// ---------- 乌龟 ----------
// 龟甲的花纹是着色器里现算的（中间一列椎盾、两侧肋盾、外圈缘盾），所以推到多近都是清楚的。
const SHELL_EXTRA = {
  pars: /* glsl */ `
    const vec2 SS[13] = vec2[13](vec2(0.0, -0.76), vec2(0.0, -0.38), vec2(0.0, 0.0), vec2(0.0, 0.38), vec2(0.0, 0.76),
      vec2(0.58, -0.57), vec2(0.58, -0.19), vec2(0.58, 0.19), vec2(0.58, 0.57), vec2(-0.58, -0.57), vec2(-0.58, -0.19), vec2(-0.58, 0.19), vec2(-0.58, 0.57));`,
  color: /* glsl */ `
    {
      vec3 sq = (vClayP - vec3(0.0, 0.135, 0.0)) / vec3(0.335, 0.27, 0.405);
      float sr = length(sq);
      float sth = acos(clamp(sq.y / sr, -1.0, 1.0));
      float sph = atan(-sq.z, sq.x);
      float sur = sth / 1.501;
      vec2 su = sur * vec2(cos(sph), sin(sph));
      float d1 = 9.0; float d2 = 9.0; float sid = 0.0;
      for (int i = 0; i < 13; i++) { float d = distance(su, SS[i]); if (d < d1) { d2 = d1; d1 = d; sid = float(i); } else if (d < d2) { d2 = d; } }
      float sdome = step(sur, 1.0);
      float sseg = fract(sph / 6.2831853 * 22.0);
      float sedge = mix(min(min(sseg, 1.0 - sseg) * 0.2856, (sur - 1.0) * 1.2), min((d2 - d1) * 0.5, 1.0 - sur), sdome);
      float sg = smoothstep(0.0, 0.05, sedge);
      float sb = clamp(1.0 - (d1 / 0.4) * (d1 / 0.4), 0.0, 1.0);
      float stop = smoothstep(0.08, 0.098, vClayP.y);
      float sring = sin(sedge * 120.0) * 0.5 + 0.5;
      vec3 scD = mix(vec3(0.0123, 0.0908, 0.117), vec3(0.098, 0.386, 0.323), pow(sb, 1.2)) * (0.88 + 0.24 * fract(sin(sid * 12.9898) * 43758.5453)) * (0.9 + 0.1 * sring);
      vec3 scM = mix(vec3(0.694, 0.397, 0.107), vec3(0.871, 0.694, 0.36), smoothstep(0.0, 0.1, sedge));
      vec3 sc = mix(scM, scD, sdome);
      sc = mix(vec3(0.0048, 0.0284, 0.0395), sc, smoothstep(0.0, 0.022, sedge));
      sc = mix(vec3(0.823, 0.694, 0.423), sc, stop);
      diffuseColor.rgb *= sc;
      cHx = mix((sg - 1.0) * 0.007 + sg * 0.004, (sg - 1.0) * 0.012 + sb * sg * 0.013 + (sring - 0.5) * 0.0012 * sg * (1.0 - sb), sdome) * stop;
    }`,
}
const SKIN = '#a9c088'
const NAIL = '#f3e6c4'
export function buildTortoise() {
  const skin = clayMat(0.8, 'skin', SKIN_MAT)
  const root = new THREE.Group()
  root.name = 'tortoise'
  const shellG = clayMesh(
    [
      { t: 'e', p: [0, 0.135, 0], r: [0.335, 0.27, 0.405], c: '#ffffff' },
      { t: 'e', p: [0, 0.118, 0], r: [0.362, 0.062, 0.432], c: '#ffffff' },
    ],
    0.024,
    0.03,
    { ao: 0.5 },
  )
  const sp = shellG.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < sp.count; i++) if (sp.getY(i) < 0.075) sp.setY(i, 0.075 + (sp.getY(i) - 0.075) * 0.25) // 肚皮压平
  root.add(mesh('shell', shellG, clayMat(0.42, 'shell', { ...SHELL_EXTRA, bump: 0.3 }, { envMapIntensity: 0.75 })))
  // 头和脖子：单独一个节点，睡着时缩进壳里
  const NP: [number, number, number] = [0, 0.14, 0.28]
  const neck = new THREE.Group()
  neck.name = 'neck'
  neck.position.set(...NP)
  const L = (x: number, y: number, z: number): [number, number, number] => [x - NP[0], y - NP[1], z - NP[2]]
  const v = new THREE.Vector3()
  const headG = clayMesh(
    [
      { t: 'e', p: L(0, 0.215, 0.5), r: [0.122, 0.108, 0.118], c: SKIN },
      { t: 'e', p: L(0, 0.195, 0.575), r: [0.088, 0.072, 0.07], c: SKIN },
      { t: 'e', p: L(0, 0.165, 0.39), r: [0.074, 0.07, 0.1], c: SKIN },
      { t: 'e', p: L(0, 0.14, 0.28), r: [0.068, 0.062, 0.1], c: SKIN },
      { t: 'e', p: L(0.06, 0.185, 0.555), r: [0.045, 0.04, 0.04], c: SKIN },
      { t: 'e', p: L(-0.06, 0.185, 0.555), r: [0.045, 0.04, 0.04], c: SKIN },
    ],
    0.011,
    0.035,
    {
      paint: (p, _n, c) => {
        c.multiplyScalar(0.9 + 0.1 * sstep(-0.04, 0.1, p.y))
        for (const sx of [1, -1]) c.lerp(BLUSH, (1 - sstep(0.012, 0.042, p.distanceTo(v.set(...L(sx * 0.088, 0.185, 0.565))))) * 0.7)
      },
    },
  )
  neck.add(mesh('head_m', headG, skin))
  const DARK = new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 0.8 })
  // 微笑：一小段弧线；两个鼻孔
  const smile = mesh('smile', new THREE.TorusGeometry(0.05, 0.0038, 6, 16, 1.5), DARK, false)
  smile.position.set(...L(0, 0.226, 0.6405))
  smile.rotation.set(0.1, 0, Math.PI + (Math.PI - 1.5) / 2)
  neck.add(smile)
  for (const sx of [1, -1]) {
    const n = mesh('nostril', eyeGeo, DARK, false)
    n.position.set(...L(sx * 0.02, 0.222, 0.644))
    n.scale.setScalar(0.0055)
    neck.add(n)
    const dir = new THREE.Vector3(sx * 0.56, 0.55, 0.62).normalize()
    const ec = new THREE.Vector3(...L(0, 0.215, 0.5)).addScaledVector(dir, 0.106)
    const e = mesh('eye', eyeGeo, EYE)
    e.position.copy(ec)
    e.scale.setScalar(0.029)
    const gl = mesh('glint', eyeGeo, GLINT, false)
    gl.position.copy(ec).add(new THREE.Vector3(-0.006 + sx * 0.002, 0.014, 0.022))
    gl.scale.setScalar(0.0072)
    // 眼皮：盖在眼球上的小圆顶，绕眼球中心转
    const lid = new THREE.Group()
    lid.name = sx > 0 ? 'lidL' : 'lidR'
    lid.position.copy(ec)
    lid.add(mesh('lid_m', tint(new THREE.SphereGeometry(0.0325, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.44), '#9db57e'), clayMat(0.8, 'skin', SKIN_MAT), false))
    // 黄铜圆眼镜
    const gc = ec.clone().addScaledVector(dir, 0.03)
    const ring = mesh('glass', new THREE.TorusGeometry(0.043, 0.0036, 8, 36), BRASS, false)
    ring.position.copy(gc)
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
    neck.add(e, gl, lid, ring)
  }
  const bridge = mesh('bridge', new THREE.TorusGeometry(0.026, 0.0032, 6, 14, Math.PI), BRASS, false)
  bridge.position.set(...L(0, 0.288, 0.598))
  bridge.rotation.set(-0.75, 0, 0)
  neck.add(bridge)
  root.add(neck)
  // 四条腿：各自一个节点，原点在胯上，睡着时缩小收进壳里
  ;[[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sf], i) => {
    const hip: [number, number, number] = [sx * 0.2, 0.11, sf * 0.22]
    const fx = sx * 0.285
    const fz = sf * 0.3 + 0.03
    const parts: Part[] = [
      { t: 'e', p: [sx * 0.22 - hip[0], 0.105 - hip[1], sf * 0.24 - hip[2]], r: [0.09, 0.085, 0.095], c: SKIN },
      { t: 'e', p: [fx - hip[0], 0.055 - hip[1], fz - hip[2]], r: [0.082, 0.055, 0.1], c: SKIN },
    ]
    for (const kx of [-1, 0, 1]) parts.push({ t: 'e', p: [fx + kx * 0.048 - hip[0], 0.04 - hip[1], fz + 0.088 - Math.abs(kx) * 0.016 - hip[2]], r: [0.02, 0.016, 0.02], c: NAIL, k: 0.008 })
    const leg = mesh('leg' + i, clayMesh(parts, 0.014, 0.035, { paint: (p, _n, c) => void c.multiplyScalar(0.86 + 0.14 * sstep(-0.09, 0.01, p.y)) }), skin)
    leg.position.set(...hip)
    root.add(leg)
  })
  root.add(mesh('tail', clayMesh([{ t: 'c', a: [0, 0.085, -0.4], b: [0, 0.07, -0.5], r: 0.036, r2: 0.014, c: SKIN }], 0.01, 0.02), skin))
  return root
}

// ---------- 台灯 ----------
// 单位就是世界单位：底座半径约 1，灯罩离桌面约 5，伸向 +X。
const lathe = (pts: [number, number][], segs: number) => new THREE.LatheGeometry(new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(pts.length * 3).map((p) => p.setX(Math.max(0, p.x))), segs)
export function buildLamp() {
  const root = new THREE.Group()
  root.name = 'lamp'
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => root.add(mesh('p', g, m, false))
  add(lathe([[0, 0], [0.92, 0], [1.0, 0.03], [1.0, 0.1], [0.95, 0.15], [0.86, 0.17], [0.8, 0.22], [0.5, 0.3], [0.2, 0.36], [0.15, 0.5], [0.13, 0.62], [0, 0.62]], 28), BRASS)
  add(lathe([[0, 0.56], [0.17, 0.56], [0.2, 0.6], [0.2, 0.7], [0.17, 0.74], [0, 0.74]], 24), BRASS_D)
  const path = new THREE.CatmullRomCurve3([[0, 0.6, 0], [0, 2.0, 0], [0, 3.3, 0], [0.05, 4.2, 0], [0.42, 5.05, 0], [1.15, 5.52, 0], [1.95, 5.5, 0], [2.35, 5.3, 0]].map(([x, y, z]) => new THREE.Vector3(x, y, z)))
  add(new THREE.TubeGeometry(path, 32, 0.085, 8), BRASS)
  const knob = lathe([[0, -0.12], [0.15, -0.12], [0.18, -0.08], [0.18, 0.08], [0.15, 0.12], [0, 0.12]], 20)
  knob.rotateX(Math.PI / 2).translate(0, 3.3, 0)
  add(knob, BRASS_D)
  // 灯罩：钟形，口朝右下方的书。外面是黄铜，里面是发亮的白釉
  const head = new THREE.Group()
  head.position.set(2.62, 4.92, 0)
  head.rotation.z = 0.66
  const shade = (g: THREE.BufferGeometry, m: THREE.Material) => head.add(mesh('s', g, m, false))
  const BR2 = BRASS.clone()
  BR2.side = THREE.DoubleSide
  shade(lathe([[0.16, 0.78], [0.24, 0.72], [0.27, 0.6], [0.34, 0.5], [0.62, 0.34], [0.98, 0.08], [1.12, -0.06], [1.16, -0.1], [1.14, -0.13]], 32), BR2)
  shade(lathe([[1.14, -0.13], [1.09, -0.07], [0.95, 0.06], [0.6, 0.3], [0.3, 0.46], [0, 0.5]], 32), new THREE.MeshStandardMaterial({ color: '#fff3da', roughness: 0.5, emissive: '#ffd9a0', emissiveIntensity: 2.2, side: THREE.DoubleSide }))
  shade(lathe([[0, 0.76], [0.19, 0.76], [0.22, 0.8], [0.22, 0.9], [0.16, 0.96], [0, 0.98]], 24), BRASS_D)
  shade(lathe([[0, 0.42], [0.1, 0.4], [0.13, 0.3], [0.2, 0.18], [0.27, 0.04], [0.24, -0.1], [0.12, -0.2], [0, -0.22]], 24), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe2b0').multiplyScalar(9) }))
  root.add(head)
  return root
}
