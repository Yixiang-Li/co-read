import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bus } from '../bus'
import { L, useLang } from '../i18n'
import { backOut, C, M, Meeple, sm, Tag } from '../world/kit'
import type { MicroProps } from './types'

// 信念偏差：一座小花园。三句话写在木牌上，中间那个“所以”是一块能推倒的箭头牌。
// 访客信这一步就点它（钉牢），不信就把它推倒。慢把花一盆盆分开：谢掉的全是别的花，玫瑰一朵不在里面。
const GX = 0 // 花园的中心
const GZ = -0.05
const FENCE = 1.36
type Kind = 'rose' | 'tulip' | 'daisy'
type Pot = { kind: Kind; home: [number, number]; to: [number, number]; wilt: boolean; n: number }

const RC: [number, number] = [0, 0.42] // 玫瑰最后聚到这里
const WC: [number, number] = [0.86, -0.12] // 谢得快的聚到这里
const RING = 0.41
const POTS: Pot[] = (() => {
  const raw: [Kind, number, number, boolean][] = [
    ['tulip', -0.3, -0.42, true], ['rose', 0.03, -0.42, false], ['daisy', 0.36, -0.42, false], ['rose', 0.69, -0.42, false], ['tulip', 1.02, -0.42, true],
    ['rose', -0.135, 0, false], ['daisy', 0.195, 0, true], ['tulip', 0.525, 0, false], ['daisy', 0.855, 0, true], ['rose', 1.185, 0, false],
    ['daisy', -0.3, 0.42, false], ['tulip', 0.03, 0.42, true], ['rose', 0.36, 0.42, false], ['tulip', 0.69, 0.42, false],
  ]
  const rest: [number, number][] = [[-0.82, -0.42], [-0.1, -0.58], [0.2, -0.6], [0.5, -0.66]]
  let r = 0
  let w = 0
  let o = 0
  return raw.map(([kind, x, z, wilt], i) => {
    const jx = Math.sin(i * 12.9) * 0.035
    const jz = Math.cos(i * 7.3) * 0.035
    let to: [number, number]
    if (kind === 'rose') {
      const a = (r++ / 5) * Math.PI * 2 + 0.5
      to = [RC[0] + Math.cos(a) * 0.235, RC[1] + Math.sin(a) * 0.235]
    } else if (wilt) {
      const a = (w++ / 5) * Math.PI * 2 - 0.4
      to = [WC[0] + Math.cos(a) * 0.235, WC[1] + Math.sin(a) * 0.235]
    } else to = rest[o++]
    return { kind, home: [x + jx, z + jz], to, wilt, n: i }
  })
})()

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}
const vnoise = (x: number, y: number) => {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi))
  const v = (y - yi) * (y - yi) * (3 - 2 * (y - yi))
  const m = (a: number, b: number, t: number) => a + (b - a) * t
  return m(m(hash(xi, yi), hash(xi + 1, yi), u), m(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v)
}
const finish = (c: HTMLCanvasElement) => {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}
const SERIF = '"Noto Serif SC", "Songti SC", serif'

// 花园的地：一圈铺了碎石的暖色地面，边缘像颜料晕开
function paintGround() {
  const S = 1024
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.fillStyle = '#e8dab2'
  g.fillRect(0, 0, S, S)
  for (let i = 0; i < 5200; i++) {
    g.save()
    g.translate(hash(i, 1) * S, hash(i, 2) * S)
    g.rotate(hash(i, 3) * 3)
    g.fillStyle = hash(i, 4) > 0.5 ? `rgba(255,251,232,${0.06 + hash(i, 5) * 0.1})` : `rgba(138,108,62,${0.05 + hash(i, 6) * 0.08})`
    g.beginPath()
    g.ellipse(0, 0, 8 + hash(i, 7) * 18, 3 + hash(i, 8) * 5, 0, 0, 7)
    g.fill()
    g.restore()
  }
  // 碎石
  for (let i = 0; i < 1700; i++) {
    g.fillStyle = ['rgba(255,255,255,0.75)', 'rgba(176,150,104,0.6)', 'rgba(214,196,160,0.9)'][i % 3]
    g.beginPath()
    g.ellipse(hash(i, 9) * S, hash(i, 10) * S, 1.5 + hash(i, 11) * 2.6, 1.2 + hash(i, 12) * 2, hash(i, 13) * 3, 0, 7)
    g.fill()
  }
  const img = g.getImageData(0, 0, S, S)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x / S - 0.5, y / S - 0.5) * 2
      if (r < 0.7) continue
      if (r > 0.97) {
        img.data[(y * S + x) * 4 + 3] = 0
        continue
      }
      const n = vnoise(x / 44, y / 44) * 0.65 + vnoise(x / 11, y / 11) * 0.35
      const a = (0.95 - r - n * 0.13) / 0.07
      img.data[(y * S + x) * 4 + 3] = a >= 1 ? 255 : a <= 0 ? 0 : hash(x, y) < a * a ? 255 : 0
    }
  g.putImageData(img, 0, 0)
  return finish(c)
}

// 木牌上的一句话。tone：wood 是原木色黑字，red 是“所以”那块红底白字
function paintSign(text: string, tone: 'wood' | 'red', w = 768, h = 196) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = tone === 'wood' ? '#dcb680' : C.red
  g.fillRect(0, 0, w, h)
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = hash(i, 21) > 0.5 ? `rgba(110,70,30,${0.06 + hash(i, 22) * 0.12})` : `rgba(255,236,200,${0.07 + hash(i, 23) * 0.13})`
    g.lineWidth = 0.8 + hash(i, 24) * 2.4
    const y = hash(i, 25) * h
    g.beginPath()
    g.moveTo(0, y)
    g.bezierCurveTo(w * 0.3, y + (hash(i, 26) - 0.5) * 16, w * 0.7, y + (hash(i, 27) - 0.5) * 16, w, y)
    g.stroke()
  }
  g.fillStyle = tone === 'wood' ? '#3a2412' : '#fff6e0'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  let size = h * 0.56
  g.font = `900 ${size}px ${SERIF}`
  const fit = (w * 0.9) / g.measureText(text).width
  let rows = [text]
  if (fit < 0.72 && text.includes(' ')) {
    // 英文句子一行排下来字太小：在最靠中间的空格处折成两行
    const words = text.split(' ')
    let best = 1
    let bw = Infinity
    for (let i = 1; i < words.length; i++) {
      const m = Math.max(g.measureText(words.slice(0, i).join(' ')).width, g.measureText(words.slice(i).join(' ')).width)
      if (m < bw) {
        bw = m
        best = i
      }
    }
    rows = [words.slice(0, best).join(' '), words.slice(best).join(' ')]
    size = Math.min(h * 0.4, (size * w * 0.9) / bw)
  } else size *= Math.min(1, fit)
  g.font = `900 ${size}px ${SERIF}`
  rows.forEach((r, i) => g.fillText(r, w / 2, h / 2 + size * 0.04 + (i - (rows.length - 1) / 2) * size * 1.06))
  return finish(c)
}

// 花盆、茎叶和三种花头，各合成一个几何体；十四盆花用几个 InstancedMesh 画完
const tint = (g: THREE.BufferGeometry, pick: (i: number) => string) => {
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  const c = new THREE.Color()
  for (let i = 0; i < n; i++) {
    c.set(pick(i))
    arr.set([c.r, c.g, c.b], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}
function makeGeo() {
  const ball = (r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, ry = 0, rx = 0) => {
    const g = new THREE.SphereGeometry(r, 10, 7)
    g.scale(sx, sy, sz)
    g.rotateX(rx)
    g.translate(x, y, z)
    g.rotateY(ry)
    return g
  }
  // 盆（陶土色）、盆里的土（深棕）、下半截茎（绿）合在一起
  const lathe = new THREE.LatheGeometry([[0.001, 0], [0.066, 0], [0.09, 0.122], [0.105, 0.126], [0.107, 0.152], [0.09, 0.156], [0.084, 0.136], [0.001, 0.136]].map(([x, y]) => new THREE.Vector2(x, y)), 18)
  const pot = mergeGeometries([tint(lathe, (i) => (i % 8 >= 6 ? '#4a3424' : '#c8683c')), tint(new THREE.CylinderGeometry(0.011, 0.013, 0.13, 6).translate(0, 0.2, 0), () => '#4f8a55')])
  const stemTop = mergeGeometries([new THREE.CylinderGeometry(0.01, 0.011, 0.13, 6).translate(0, 0.065, 0), ball(0.05, 1, 0.22, 0.42, 0.05, 0.03, 0, 0.6), ball(0.05, 1, 0.22, 0.42, 0.05, 0.06, 0, 3.6)])
  const rose = mergeGeometries([
    ball(0.047, 1, 1, 1, 0, 0.03, 0),
    ...[0, 1, 2, 3, 4].map((i) => ball(0.044, 1, 0.85, 0.55, 0, 0.018, 0.04, (i / 5) * Math.PI * 2, -0.35)),
    ...[0, 1, 2, 3, 4].map((i) => ball(0.046, 1, 0.7, 0.5, 0, -0.004, 0.064, ((i + 0.5) / 5) * Math.PI * 2, -0.75)),
  ])
  const tulip = mergeGeometries([
    ball(0.058, 1, 1.35, 1, 0, 0.05, 0),
    ...[0, 1, 2].map((i) => {
      const g = new THREE.ConeGeometry(0.036, 0.075, 8)
      g.scale(1, 1, 0.6)
      g.rotateX(0.28)
      g.translate(0, 0.128, 0.03)
      g.rotateY((i / 3) * Math.PI * 2)
      return g
    }),
  ])
  // 雏菊：白花瓣和黄花心合在一起，朝镜头仰着
  const daisy = mergeGeometries([
    tint(mergeGeometries(Array.from({ length: 9 }, (_, i) => ball(0.04, 1, 0.24, 0.42, 0.062, 0, 0, (i / 9) * Math.PI * 2))).rotateX(1.05).translate(0, 0.02, 0.012), () => C.white),
    tint(new THREE.SphereGeometry(0.03, 10, 7).scale(1, 0.6, 1).rotateX(1.05).translate(0, 0.024, 0.024), () => C.yellow),
  ])
  const petal = new THREE.SphereGeometry(0.03, 8, 6).scale(1, 0.25, 0.6)
  // 篱笆的一根木条：尖头
  const picket = mergeGeometries([new THREE.BoxGeometry(0.062, 0.3, 0.02).translate(0, 0.15, 0), new THREE.ConeGeometry(0.044, 0.06, 4).rotateY(Math.PI / 4).scale(1, 1, 0.32).translate(0, 0.33, 0)])
  // “所以”箭头牌
  const sh = new THREE.Shape()
  ;[[-0.29, -0.115], [0.1, -0.115], [0.1, -0.19], [0.31, 0], [0.1, 0.19], [0.1, 0.115], [-0.29, 0.115]].forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)))
  const arrow = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }).translate(0, 0, -0.02)
  // 圈住一群花的绳子
  const pts = Array.from({ length: 65 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2) * RING, 0, Math.sin((i / 64) * Math.PI * 2) * RING))
  const rope = () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.016, 6, false)
  // 小车的把手和支脚
  const bar = (x: number, y: number, z: number, len: number, rx: number) => new THREE.CylinderGeometry(0.014, 0.014, len, 6).rotateX(rx).translate(x, y, z)
  const handles = mergeGeometries([-0.15, 0.15].flatMap((x) => [bar(x, 0.2, -0.3, 0.3, 1.35), bar(x, 0.07, -0.12, 0.14, 0)]))
  return { pot, stemTop, rose, tulip, daisy, petal, picket, arrow, handles, rope: [rope(), rope()] }
}

// 各种花在各自 InstancedMesh 里的序号
const IDX = POTS.map((p, i) => POTS.slice(0, i).filter((q) => q.kind === p.kind).length)
const WILT = POTS.filter((p) => p.wilt)
const CART: [number, number, number, number][] = [[-0.09, 0.35, -0.08, 1], [0.09, 0.37, 0.03, 1.1], [0, 0.42, -0.03, 1.15], [0.03, 0.35, 0.13, 0.95], [-0.1, 0.34, 0.11, 0.9]]
const MAN_RY = Math.PI / 2 - 0.25
const MAN_X = -1.16 // 园丁停下的位置（车轮刚好不压到玫瑰那圈绳子）
const COL = { tulip: C.yellow, daisy: '#ffffff', wTulip: '#a58a52', wDaisy: '#c4b68e', leaf: '#4f8a55', wLeaf: '#7d8a48', pTulip: '#dccb62', pDaisy: C.white }

export default function Rose({ c, phase, pick, choose, say, read }: MicroProps) {
  const lang = useLang()
  // 三句话直接取题目原文的前三行；“所以”单独做成箭头牌
  const lines = useMemo(() => {
    const q = c.q.split('\n').map((l) => l.replace(/[。.]$/, ''))
    const last = (q[2] ?? '').replace(/^(所以，|Therefore,? |So,? )/, '')
    return [q[0] ?? '', q[1] ?? '', last.charAt(0).toUpperCase() + last.slice(1), L('所以', 'So')]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.q, lang])
  const ground = useMemo(paintGround, [])
  // 手机竖屏上牌子的字太小：牌子立起来以后，把三句话另排一张纸卡
  const [signsUp, setSignsUp] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setSignsUp(true), 1400)
    return () => window.clearTimeout(id)
  }, [])
  useEffect(() => {
    if (!read) return
    read(signsUp && phase !== 'done' ? { lines: [{ t: lines[0] }, { t: lines[1] }, { t: L(`所以，${lines[2]}`, `So: ${lines[2]}`), red: true }] } : null)
  }, [signsUp, phase, lines, read])
  const tex = useMemo(() => ({ s1: paintSign(lines[0], 'wood'), s2: paintSign(lines[1], 'wood'), s3: paintSign(lines[2], 'wood', 820, 216), so: paintSign(lines[3], 'red', 300, 160) }), [lines])
  const geo = useMemo(makeGeo, [])
  const cols = useMemo(() => Object.fromEntries(Object.entries(COL).map(([k, v]) => [k, new THREE.Color(v)])) as Record<keyof typeof COL, THREE.Color>, [])
  // 每帧摆放花盆用的临时量，只建一次
  const tmp = useMemo(() => ({ a: new THREE.Matrix4(), b: new THREE.Matrix4(), c: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1), s: new THREE.Vector3(), col: new THREE.Color() }), [])
  useEffect(() => {
    // 字体到了以后把木牌重画一遍；换语言时旧贴图丢掉
    let live = true
    const all: [THREE.CanvasTexture, string, 'wood' | 'red', number?, number?][] = [[tex.s1, lines[0], 'wood'], [tex.s2, lines[1], 'wood'], [tex.s3, lines[2], 'wood', 820, 216], [tex.so, lines[3], 'red', 300, 160]]
    document.fonts?.load(`900 60px ${SERIF}`, lines.join('')).then(() => {
      if (live)
        all.forEach(([t, s, tone, w, h]) => {
          t.image = paintSign(s, tone, w, h).image
          t.needsUpdate = true
        })
    })
    return () => {
      live = false
      all.forEach(([t]) => t.dispose())
    }
  }, [tex, lines])

  const iPot = useRef<THREE.InstancedMesh>(null)
  const iStem = useRef<THREE.InstancedMesh>(null)
  const iRose = useRef<THREE.InstancedMesh>(null)
  const iTulip = useRef<THREE.InstancedMesh>(null)
  const iDaisy = useRef<THREE.InstancedMesh>(null)
  const iPetal = useRef<THREE.InstancedMesh>(null)
  const signs = useRef<(THREE.Group | null)[]>([])
  const arrow = useRef<THREE.Group>(null)
  const arrowIn = useRef<THREE.Group>(null)
  const man = useRef<THREE.Group>(null)
  const manIn = useRef<THREE.Group>(null)
  const wheel = useRef<THREE.Mesh>(null)
  const fence = useRef<THREE.InstancedMesh>(null)
  const s = useRef({ t: 0, tilt: 0, tv: 0, tiltT: 0, fell: 0, nailed: 0, hover: 0, wob: 1, drag: null as null | { x: number; moved: number }, armed: false, nod: 0 })
  const chooseRef = useRef(choose)
  chooseRef.current = choose
  const [step, setStep] = useState(0) // 木牌立到第几块
  const [flags, setFlags] = useState(0) // 1 谢得快的圈好了；2 玫瑰圈好了；4 结论；8 所以倒了；16 正按着慢

  useEffect(() => {
    if (phase === 'ask') {
      Object.assign(s.current, { t: 0, tilt: 0, tv: 0, tiltT: 0, fell: 0, nailed: 0, armed: false, drag: null })
      setStep(0)
      say('')
    }
    if (phase === 'picked') say(flags & 16 ? '' : L('按住乌龟，让它把花分一分', 'Hold the tortoise. Let it sort them'))
    if (phase === 'done') say('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, flags & 16])
  useEffect(() => {
    if (step === 4 && phase === 'ask') say(L('“所以”站得住吗？点它，或者推倒它', 'Does “So” hold? Tap it, or push it over'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  useLayoutEffect(() => {
    // 后半圈白篱笆
    const m = fence.current
    if (!m) return
    const o = new THREE.Object3D()
    for (let i = 0; i < m.count; i++) {
      const a = THREE.MathUtils.degToRad(168 + (i / (m.count - 1)) * 204)
      o.position.set(GX + Math.cos(a) * FENCE, 0, GZ + Math.sin(a) * FENCE)
      o.rotation.set(0, -a + Math.PI / 2, 0)
      o.scale.setScalar(0.94 + hash(i, 41) * 0.12)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    }
    m.instanceMatrix.needsUpdate = true
    // 落下的花瓣颜色跟着花走
    WILT.forEach((pt, wi) => [0, 1, 2].forEach((j) => iPetal.current?.setColorAt(wi * 3 + j, pt.kind === 'tulip' ? cols.pTulip : cols.pDaisy)))
    if (iPetal.current?.instanceColor) iPetal.current.instanceColor.needsUpdate = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, raw) => {
    const a = s.current
    const slow = 1 - 0.93 * bus.t
    const rdt = Math.min(0.05, raw)
    const dt = rdt * slow
    const p = bus.p
    const picked = phase === 'picked'
    const done = phase === 'done'
    if (bus.micro.k > 0.8) a.t += dt
    const T = a.t

    // 一、三句话的木牌依次立起来
    const st = T > 4.5 ? 4 : T > 3.9 ? 3 : T > 1.9 ? 2 : T > 0.4 ? 1 : 0
    if (phase === 'ask' && st !== step) setStep(st)
    if (st === 4) a.armed = true
    const at = [0.4, 1.9, 3.9, 4.3]
    signs.current.forEach((g, i) => {
      if (!g) return
      const k = phase === 'ask' ? backOut((T - at[i]) / 0.5) : 1
      g.scale.setScalar(Math.max(0.0001, k))
      g.rotation.z = (1 - clamp01((T - at[i]) / 0.9)) * Math.sin((T - at[i]) * 14) * 0.12 * (phase === 'ask' ? 1 : 0)
    })

    // 二、慢的推算：先把谢掉的归到一处，再把玫瑰归到一处，两圈绳子互不相交
    const gW = picked ? sm(0.03, 0.27, p) : done ? 1 : 0
    const gR = picked ? sm(0.3, 0.55, p) : done ? 1 : 0
    const rW = picked ? sm(0.2, 0.34, p) : done ? 1 : 0
    const rR = picked ? sm(0.5, 0.64, p) : done ? 1 : 0
    const fallP = picked ? sm(0.68, 0.86, p) : done ? 1 : 0
    geo.rope[0].setDrawRange(0, Math.floor(rW * 96) * 36)
    geo.rope[1].setDrawRange(0, Math.floor(rR * 96) * 36)
    const fl = (rW > 0.96 ? 1 : 0) | (rR > 0.96 ? 2 : 0) | ((picked && p > 0.8) || done ? 4 : 0) | ((picked && p > 0.88) || done ? 8 : 0) | (picked && p > 0.04 ? 16 : 0)
    if (fl !== flags) setFlags(fl)

    const { a: mA, b: mB, c: mC, q, e, v, one, s: sc, col } = tmp
    const pots = iPot.current
    const stems = iStem.current
    const roses = iRose.current
    const tulips = iTulip.current
    const daisies = iDaisy.current
    const petals = iPetal.current
    if (pots && stems && roses && tulips && daisies && petals) {
      let wi = 0
      for (let i = 0; i < POTS.length; i++) {
        const pt = POTS[i]
        const grp = pt.kind === 'rose' ? gR : gW
        const m = ease(clamp01((grp - (i % 5) * 0.09) / 0.64))
        // 第一块牌立起来时，玫瑰挨个跳一下，认一认谁是玫瑰
        const hq = pt.kind === 'rose' && phase === 'ask' ? (T - 0.95 - (i % 5) * 0.13) / 0.42 : -1
        const hop = Math.sin(Math.PI * m) * 0.2 + (hq > 0 && hq < 1 ? Math.sin(hq * Math.PI) * 0.13 : 0)
        // 盆
        mA.compose(v.set(THREE.MathUtils.lerp(pt.home[0], pt.to[0], m), hop, THREE.MathUtils.lerp(pt.home[1], pt.to[1], m)), q.setFromEuler(e.set(0, 0, Math.sin(Math.PI * m) * 0.25 * (i % 2 ? 1 : -1))), one)
        pots.setMatrixAt(i, mA)
        // 上半截茎：第二块牌立起来，这几盆很快谢掉，垂下头
        const w = pt.wilt ? ease(clamp01((T - 2.35 - (i % 5) * 0.2) / 1.25)) : 0
        const sway = Math.sin(T * 1.7 + i * 1.3) * 0.05 * (1 - w)
        mB.compose(v.set(0, 0.262, 0), q.setFromEuler(e.set(w * 1.85 + sway, 0, sway * 0.6 + w * 0.3 * (i % 2 ? 1 : -1))), one)
        mA.multiply(mB)
        stems.setMatrixAt(i, mA)
        stems.setColorAt(i, col.copy(cols.leaf).lerp(cols.wLeaf, w))
        // 花头
        mC.compose(v.set(0, 0.13, 0), q.identity(), sc.setScalar(1 - 0.24 * w))
        mA.multiply(mC)
        const head = pt.kind === 'rose' ? roses : pt.kind === 'tulip' ? tulips : daisies
        head.setMatrixAt(IDX[i], mA)
        if (pt.kind !== 'rose') head.setColorAt(IDX[i], col.copy(cols[pt.kind]).lerp(pt.kind === 'tulip' ? cols.wTulip : cols.wDaisy, w))
        // 落下来的花瓣，留在原地（省电档只落一片）
        if (pt.wilt) {
          for (let j = 0; j < 3; j++) {
            const u = j && !bus.quality ? 0 : clamp01((T - 2.5 - (i % 5) * 0.2 - j * 0.22) / 0.9)
            const ang = i * 2.1 + j * 2.3
            mB.compose(
              v.set(pt.home[0] + Math.cos(ang) * (0.05 + 0.1 * u) + Math.sin(u * 9 + j) * 0.03 * (1 - u), THREE.MathUtils.lerp(0.4, 0.02, u * u), pt.home[1] + 0.06 + Math.sin(ang) * 0.06 + 0.1 * u),
              q.setFromEuler(e.set(u * 5 + j, ang, (1 - u) * 2)),
              sc.setScalar(u > 0 ? 1 : 0.0001),
            )
            petals.setMatrixAt(wi * 3 + j, mB)
          }
          wi++
        }
      }
      // 车里那几朵玫瑰跟着车走
      const mx = THREE.MathUtils.lerp(-1.75, MAN_X, ease(clamp01(T / 1.1)))
      mA.compose(v.set(mx, 0, 0.56), q.setFromEuler(e.set(0, MAN_RY, 0)), one)
      for (let n = 0; n < CART.length; n++) {
        const [x, y, z, k] = CART[n]
        mB.compose(v.set(x, y, z + 0.44), q.setFromEuler(e.set(0, n * 1.3, 0)), sc.setScalar(k * 1.05))
        roses.setMatrixAt(5 + n, mC.multiplyMatrices(mA, mB))
      }
      for (const im of [pots, stems, roses, tulips, daisies, petals]) im.instanceMatrix.needsUpdate = true
      for (const im of [stems, tulips, daisies]) if (im.instanceColor) im.instanceColor.needsUpdate = true
    }

    // 三、“所以”箭头牌：没钉牢的时候晃着；拖它会跟着倒；钉牢就不晃了
    if (arrow.current) {
      const wantWob = phase === 'ask' && !a.drag ? 1 : 0
      a.wob += (wantWob - a.wob) * Math.min(1, rdt * 6)
      let target = a.tiltT
      if (a.fell) target = a.fell * 1.5
      else if (pick === 0 && phase !== 'ask') target = fallP * 1.5
      const stiff = a.fell || (pick === 0 && phase !== 'ask') ? 70 : 160
      a.tv += ((target - a.tilt) * stiff - a.tv * (a.fell ? 7 : 16)) * rdt
      a.tilt += a.tv * rdt
      if (Math.abs(a.tilt) > 1.52) {
        a.tilt = Math.sign(a.tilt) * 1.52
        a.tv *= -0.35
      }
      a.nailed += ((pick === 0 && phase !== 'ask' ? 1 : 0) - a.nailed) * Math.min(1, rdt * 10)
      const k = phase === 'ask' ? backOut((T - at[3]) / 0.5) : 1
      arrow.current.rotation.z = a.tilt + Math.sin(T * 5.2) * (0.06 + a.hover * 0.07) * a.wob * (a.fell ? 0 : 1)
      // 倒到一半开始绕着桩子拧过去，最后牌面朝上平躺在地上（不然侧立着像一座小红房子，看不出是倒了）
      const lay = sm(0.55, 1.4, Math.abs(a.tilt))
      if (arrowIn.current) arrowIn.current.rotation.y = Math.sign(a.tilt) * (Math.PI / 2) * lay
      arrow.current.position.y = -0.05 * a.nailed * (1 - fallP) + 0.062 * lay
      arrow.current.scale.setScalar(Math.max(0.0001, k * (1 + a.hover * 0.05 * a.wob)))
    }

    // 四、园丁推着车进来，站在一边看；你点头他也点头
    a.nod = Math.max(0, a.nod - dt * 1.1)
    if (man.current && manIn.current) {
      const e = ease(clamp01(T / 1.1))
      man.current.position.x = THREE.MathUtils.lerp(-1.75, MAN_X, e)
      manIn.current.position.y = e < 1 ? Math.abs(Math.sin(T * 10)) * 0.05 : 0
      manIn.current.rotation.x = Math.sin(a.nod * Math.PI * 4) * 0.22 * a.nod
      manIn.current.rotation.z = Math.sin(T * 1.2) * 0.03
      if (wheel.current) wheel.current.rotation.x = e * 5
    }
  })

  const settle = (k: number, dir = 1) => {
    const a = s.current
    if (k === 1) a.fell = dir
    else a.nod = 1
    a.tiltT = 0
    chooseRef.current(k)
  }

  return (
    // 整体收一点：后半圈篱笆和两边的木牌原来贴着岛顶的边（有的方向岛顶半径只有 1.4）
    <group scale={0.95}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[GX, 0.012, GZ]} receiveShadow>
        <planeGeometry args={[3.1, 3.1]} />
        <meshStandardMaterial map={ground} transparent alphaTest={0.5} roughness={1} />
      </mesh>

      {/* 篱笆：圈住的都是花 */}
      <instancedMesh ref={fence} args={[geo.picket, undefined, 38]} castShadow>
        <meshStandardMaterial color={C.white} roughness={0.9} emissive={C.cream} emissiveIntensity={0.32} />
      </instancedMesh>
      {[0.11, 0.23].map((y) => (
        <mesh key={y} position={[GX, y, GZ]} rotation={[Math.PI / 2, 0, THREE.MathUtils.degToRad(168)]}>
          <torusGeometry args={[FENCE + 0.012, 0.014, 5, 48, THREE.MathUtils.degToRad(204)]} />
          <meshStandardMaterial color={C.cream} roughness={0.9} emissive={C.cream} emissiveIntensity={0.28} />
        </mesh>
      ))}

      {/* 两句前提：钉在同一根桩上 */}
      <group position={[-0.74, 0, -1.02]} rotation={[-0.16, 0.08, 0]}>
        <mesh position={[0, 0.5, -0.04]} castShadow>
          <cylinderGeometry args={[0.026, 0.032, 1.0, 10]} />
          <M color="#a8743f" rough={0.8} />
        </mesh>
        {[tex.s1, tex.s2].map((t, i) => (
          <group key={i} position={[0, i ? 0.52 : 0.83, 0]}>
            <group ref={(g) => void (signs.current[i] = g)} scale={0.0001}>
              <RoundedBox args={[0.98, 0.25, 0.045]} radius={0.02} smoothness={3} castShadow>
                <M color="#c99b63" rough={0.8} />
              </RoundedBox>
              <mesh position={[0, 0, 0.024]}>
                <planeGeometry args={[0.94, 0.215]} />
                <meshStandardMaterial map={t} roughness={0.85} emissive="#ffffff" emissiveMap={t} emissiveIntensity={0.42} />
              </mesh>
            </group>
          </group>
        ))}
      </group>

      {/* 结论 */}
      <group position={[0.97, 0, -1.0]} rotation={[-0.16, -0.1, 0]}>
        <group ref={(g) => void (signs.current[2] = g)} scale={0.0001}>
          <mesh position={[0, 0.3, -0.04]} castShadow>
            <cylinderGeometry args={[0.026, 0.032, 0.62, 10]} />
            <M color="#a8743f" rough={0.8} />
          </mesh>
          <RoundedBox args={[1.02, 0.275, 0.045]} radius={0.02} smoothness={3} position={[0, 0.64, 0]} castShadow>
            <M color="#c99b63" rough={0.8} />
          </RoundedBox>
          <mesh position={[0, 0.64, 0.024]}>
            <planeGeometry args={[0.98, 0.24]} />
            <meshStandardMaterial map={tex.s3} roughness={0.85} emissive="#ffffff" emissiveMap={tex.s3} emissiveIntensity={0.42} />
          </mesh>
        </group>
        <Tag position={[0, 0.94, 0]} tone="dark" show={!!(flags & 4)}>{L('碰巧是对的', 'true, by luck')}</Tag>
      </group>

      {/* “所以”：访客要判断的就是这一步 */}
      <group position={[0.2, 0, -0.9]}>
        <group ref={arrow} scale={0.0001}>
          <group ref={arrowIn} rotation={[-0.16, 0, 0]}>
            <mesh position={[0, 0.3, -0.035]} castShadow>
              <cylinderGeometry args={[0.022, 0.028, 0.62, 10]} />
              <M color="#a8743f" rough={0.8} />
            </mesh>
            <mesh geometry={geo.arrow} position={[0, 0.62, 0]} castShadow>
              <M color={C.red} rough={0.8} />
            </mesh>
            <mesh position={[-0.085, 0.62, 0.034]}>
              <planeGeometry args={[0.3, 0.16]} />
              <meshStandardMaterial map={tex.so} roughness={0.8} emissive="#ffffff" emissiveMap={tex.so} emissiveIntensity={0.3} />
            </mesh>
            <mesh
              position={[0, 0.5, 0.05]}
              visible={false}
              onPointerOver={(e) => (e.stopPropagation(), (s.current.hover = 1))}
              onPointerOut={() => (s.current.hover = 0)}
              onPointerDown={(e) => {
                const a = s.current
                if (phase !== 'ask' || !a.armed) return
                e.stopPropagation()
                ;(e.target as Element).setPointerCapture?.(e.pointerId)
                a.drag = { x: e.nativeEvent.clientX, moved: 0 }
              }}
              onPointerMove={(e) => {
                const a = s.current
                if (!a.drag) return
                const dx = e.nativeEvent.clientX - a.drag.x
                a.drag.moved = Math.max(a.drag.moved, Math.abs(dx))
                a.tiltT = THREE.MathUtils.clamp(-dx / 130, -1.3, 1.3)
              }}
              onPointerUp={(e) => {
                const a = s.current
                if (!a.drag) return
                ;(e.target as Element).releasePointerCapture?.(e.pointerId)
                const d = a.drag
                a.drag = null
                if (d.moved < 8) settle(0)
                else if (Math.abs(a.tiltT) > 0.42) settle(1, Math.sign(a.tiltT))
                else a.tiltT = 0
              }}
              onPointerCancel={() => {
                s.current.drag = null
                s.current.tiltT = 0
              }}
            >
              <boxGeometry args={[0.86, 1.0, 0.3]} />
            </mesh>
          </group>
        </group>
        <Tag position={[0, 1.02, 0]} tone="red" show={!!(flags & 8)}>{L('推不出来', 'does not follow')}</Tag>
      </group>

      {/* 十四盆花：盆、茎叶、三种花头、落下的花瓣，各一个 InstancedMesh */}
      <instancedMesh ref={iPot} args={[geo.pot, undefined, POTS.length]} castShadow receiveShadow frustumCulled={false}>
        <meshStandardMaterial vertexColors roughness={0.82} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={iStem} args={[geo.stemTop, undefined, POTS.length]} castShadow frustumCulled={false}>
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={iRose} args={[geo.rose, undefined, 5 + CART.length]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#c9364a" roughness={0.78} />
      </instancedMesh>
      <instancedMesh ref={iTulip} args={[geo.tulip, undefined, POTS.filter((p) => p.kind === 'tulip').length]} castShadow frustumCulled={false}>
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={iDaisy} args={[geo.daisy, undefined, POTS.filter((p) => p.kind === 'daisy').length]} castShadow frustumCulled={false}>
        <meshStandardMaterial vertexColors roughness={0.85} emissive={C.cream} emissiveIntensity={0.22} />
      </instancedMesh>
      <instancedMesh ref={iPetal} args={[geo.petal, undefined, WILT.length * 3]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>

      {/* 两圈绳子 */}
      <mesh geometry={geo.rope[0]} position={[WC[0], 0.03, WC[1]]}>
        <M color={C.ink} rough={0.8} />
      </mesh>
      <mesh geometry={geo.rope[1]} position={[RC[0], 0.03, RC[1]]} rotation={[0, 2.2, 0]}>
        <M color={C.ink} rough={0.8} />
      </mesh>
      <Tag position={[WC[0], 0.05, WC[1] + RING + 0.14]} tone="dark" show={!!(flags & 1)}>{L('谢得快的花', 'fade quickly')}</Tag>
      <Tag position={[RC[0], 0.05, RC[1] + RING + 0.14]} tone="dark" show={!!(flags & 2)}>{L('玫瑰：一朵没谢', 'roses: none faded')}</Tag>

      {/* 园丁和他那车玫瑰，和地上那个是同一个 */}
      <group ref={man} position={[MAN_X, 0, 0.56]} rotation={[0, MAN_RY, 0]}>
        <group ref={manIn}>
          <Meeple color={C.green} />
        </group>
        <group position={[0, 0, 0.44]}>
          <RoundedBox args={[0.38, 0.15, 0.44]} radius={0.03} smoothness={3} position={[0, 0.22, 0]} castShadow>
            <M color="#b9824f" />
          </RoundedBox>
          <mesh ref={wheel} position={[0, 0.1, 0.25]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 0.05, 18]} />
            <M color={C.ink} />
          </mesh>
          <mesh geometry={geo.handles}>
            <M color="#8a5a3c" />
          </mesh>
        </group>
      </group>
    </group>
  )
}
