import { Html, RoundedBox } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { bus } from '../bus'
import { L, useLang } from '../i18n'
import { backOut, C, M, Meeple, sm, Tag, useKeepOnScreen } from '../world/kit'
import type { MicroProps } from './types'

// 琳达（合取谬误）。
// ask：琳达站在前面，她的特征一条条冒出来；身后是一群人，面前有两个柜台。访客把她拖进其中一圈。
// 慢：柜台收起来，“银行出纳”那一圈长大，所有出纳走进去；“女权运动的出纳”那一圈滑进大圈里面。

type V2 = [number, number]
const N = 42
const SC = 0.5 // 人群里小人的大小
// 岛顶的草地只有局部半径 1.5 左右。整个场景缩到 G 倍，下面的坐标都是缩之前的，
// 所以每样东西离原点不能超过 1.5 / G ≈ 1.76
const G = 0.85
const FLOOR = 0.03 // 草地有点起伏，贴地的东西垫高这么多才不会被草吃掉
const CROWD: V2 = [0.0, -1.05] // 人群站的那一片（椭圆，半轴 1.2 × 0.7）
const ZA: V2 = [-1.0, 0.2] // “银行出纳”那一圈
const ZB: V2 = [0.8, 0.2] // “女权运动的出纳”那一圈
const ZR = 0.48
const BIG: V2 = [0.05, -0.15] // 慢想的时候，大圈的位置和半径
const BR = 1.1
const SMALL: V2 = [0.54, 0.1]
const SR = 0.46
const L0: V2 = [0.0, 1.35] // 琳达一开始站的地方
const L_BIG: V2 = [-0.45, 0.22] // 她选了“出纳”时，最后站在大圈里的位置
const DESK_A: V2 = [-1.43, -0.34] // 两个柜台：各自靠在自己那一圈的外后方
const DESK_B: V2 = [1.32, -0.3]
// 两块纸签挂在柜台檐上方偏外一点，琳达举着牌子站进圈里时不会挡住它们
const TAG_A: [number, number, number] = [DESK_A[0] - 0.02, 1.15, DESK_A[1] - 0.1]
const TAG_B: [number, number, number] = [DESK_B[0] + 0.25, 1.15, DESK_B[1] - 0.1]
const TELLER = '#27325f'
const VISOR = '#3f7f68'
const PINK = '#d9788f' // 女权运动的颜色：一种收过饱和度的玫瑰色，和全场的色板一个调子
const PALE = new THREE.Color('#d9d6bf')
const traits = () => [L('31 岁，单身', '31, single'), L('直率', 'outspoken'), L('聪明', 'very bright'), L('读哲学', 'philosophy major'), L('关心社会公平', 'cares about social justice'), L('参加过反核游行', 'antinuclear marches')]
const N_TRAITS = 6
const sayAsk = () => L('把琳达拖进她更可能在的那一圈', 'Drag Linda to where she more likely is')
const sayHold = () => L('按住右边的慢，让它数一数', 'Now hold Slow, on the right, to count')

function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const lerp = THREE.MathUtils.lerp
const ease = (t: number) => t * t * (3 - 2 * t)

// kind：0 路人，1 举牌子的路人，2 出纳，3 举牌子的出纳
type Person = { home: V2; a: V2; b: V2; kind: number; col: THREE.Color; d: number; ph: number }
const TELLERS = 12
const FEM = 4

function buildCrowd(): Person[] {
  const r = rng(7)
  const far = (p: V2, list: V2[], min: number) => list.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > min)
  const homes: V2[] = []
  for (let n = 0; homes.length < N && n < 9000; n++) {
    const p: V2 = [CROWD[0] + (r() * 2 - 1) * 1.2, CROWD[1] + (r() * 2 - 1) * 0.7]
    if (((p[0] - CROWD[0]) / 1.2) ** 2 + ((p[1] - CROWD[1]) / 0.7) ** 2 > 1) continue
    if (far(p, homes, 0.21)) homes.push(p)
  }
  const pal = [C.yellow, C.coral, '#8fa9c4', C.lilac, '#86ab8b', '#dcb8a2', '#e6d6aa', '#c8c2ae']
  const people: Person[] = homes.map((home, i) => ({ home, a: home, b: home, kind: 0, col: new THREE.Color(pal[i % pal.length]), d: r(), ph: r() * 6.28 }))
  // 随机挑出出纳和举牌子的人
  const order = people.map((_, i) => i).sort(() => r() - 0.5)
  order.forEach((idx, n) => (people[idx].kind = n < TELLERS - FEM ? 2 : n < TELLERS ? 3 : n < TELLERS + 9 ? 1 : 0))
  // 出纳在大圈里的站位
  const spots: V2[] = []
  for (let n = 0; spots.length < TELLERS - FEM && n < 9000; n++) {
    const ang = r() * 6.28
    const rad = Math.sqrt(r()) * (BR - 0.2)
    const p: V2 = [BIG[0] + Math.cos(ang) * rad, BIG[1] + Math.sin(ang) * rad]
    if (Math.hypot(p[0] - SMALL[0], p[1] - SMALL[1]) < SR + 0.17) continue
    if (Math.hypot(p[0] - L_BIG[0], p[1] - L_BIG[1]) < 0.4) continue
    if (far(p, spots, 0.3)) spots.push(p)
  }
  const tel = people.filter((p) => p.kind === 2).sort((p, q) => p.home[0] - q.home[0])
  spots.sort((p, q) => p[0] - q[0])
  tel.forEach((p, i) => ((p.a = spots[i]), (p.b = spots[i]), (p.col = new THREE.Color(TELLER))))
  // 举牌子的出纳：先进大圈，再聚到小圈里
  people
    .filter((p) => p.kind === 3)
    .sort((p, q) => p.home[0] - q.home[0])
    .forEach((p, i) => {
      const ang = [2.5, 4.0, 5.5, 0.75][i]
      p.b = [SMALL[0] + Math.cos(ang) * 0.29, SMALL[1] + Math.sin(ang) * 0.29]
      p.a = [lerp(p.home[0], p.b[0], 0.72) + (i % 2 ? 0.2 : -0.16), lerp(p.home[1], p.b[1], 0.6)]
      p.col = new THREE.Color(TELLER)
    })
  // 不是出纳的人：退到大圈外面，围成一圈看
  const rim: V2[] = []
  for (const [rad, n] of [[BR + 0.25, 14], [BR + 0.5, 16]] as const)
    for (let j = 0; j < n; j++) {
      const th = ((172 + ((j + 0.5) / n) * 196) * Math.PI) / 180
      rim.push([BIG[0] + Math.cos(th) * rad, BIG[1] + Math.sin(th) * rad])
    }
  rim.sort((p, q) => p[0] - q[0])
  people
    .filter((p) => p.kind < 2)
    .sort((p, q) => p.home[0] - q.home[0])
    .forEach((p, i) => (p.a = p.b = rim[i]))
  return people
}

// 一块画着符号的小牌子贴图
function glyph(kind: 'peace' | 'venus', bg: string, ink: string) {
  const c = document.createElement('canvas')
  c.width = 176
  c.height = 120
  const g = c.getContext('2d')!
  g.fillStyle = bg
  g.fillRect(0, 0, 176, 120)
  g.strokeStyle = ink
  g.lineWidth = 9
  g.lineCap = 'round'
  g.beginPath()
  if (kind === 'peace') {
    g.arc(88, 60, 40, 0, 7)
    g.moveTo(88, 20)
    g.lineTo(88, 100)
    g.moveTo(88, 60)
    g.lineTo(60, 88)
    g.moveTo(88, 60)
    g.lineTo(116, 88)
  } else {
    g.arc(88, 44, 26, 0, 7)
    g.moveTo(88, 70)
    g.lineTo(88, 108)
    g.moveTo(72, 90)
    g.lineTo(104, 90)
  }
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

// 一圈绳子：半径随时会变，所以每帧直接改顶点，绳子的粗细不跟着放大
const SEG = 84
const RAD = 8
function ropeGeo() {
  const g = new THREE.BufferGeometry()
  const n = (SEG + 1) * (RAD + 1)
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  const idx: number[] = []
  for (let i = 0; i < SEG; i++)
    for (let j = 0; j < RAD; j++) {
      const a = i * (RAD + 1) + j
      const b = a + RAD + 1
      idx.push(a, a + 1, b, b, a + 1, b + 1) // 面朝外（反了的话看到的是管子的内壁，背光时一圈发黑）
    }
  g.setIndex(idx)
  return g
}
function setRope(g: THREE.BufferGeometry, R: number, t: number) {
  const pos = g.attributes.position as THREE.BufferAttribute
  const nor = g.attributes.normal as THREE.BufferAttribute
  let k = 0
  for (let i = 0; i <= SEG; i++) {
    const u = (i / SEG) * Math.PI * 2
    // 绳子有一点点起伏，像随手摆在地上的
    const wob = 1 + Math.sin(u * 5) * 0.012 + Math.sin(u * 9 + 1) * 0.008
    for (let j = 0; j <= RAD; j++) {
      const v = (j / RAD) * Math.PI * 2
      const cx = Math.cos(v)
      const cy = Math.sin(v)
      pos.setXYZ(k, (R * wob + t * cx) * Math.cos(u), t + t * cy, (R * wob + t * cx) * Math.sin(u))
      nor.setXYZ(k, cx * Math.cos(u), cy, cx * Math.sin(u))
      k++
    }
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
}

export default function Folder({ phase, pick, choose, say }: MicroProps) {
  const traitsRef = useRef<HTMLDivElement>(null)
  useKeepOnScreen(traitsRef)
  const { camera, gl } = useThree()
  useLang()
  const TRAITS = traits()
  const crowd = useMemo(buildCrowd, [])
  const tex = useMemo(() => ({ peace: glyph('peace', C.white, C.ink), venus: glyph('venus', PINK, '#fbf3ee') }), [])
  const rope = useMemo(() => ({ a: ropeGeo(), b: ropeGeo() }), [])
  const geo = useMemo(() => {
    const at = <T extends THREE.BufferGeometry>(g: T, x: number, y: number, z: number) => (g.translate(x, y, z), g)
    return {
      body: at(new THREE.CylinderGeometry(0.07, 0.2, 0.54, 18), 0, 0.27, 0),
      head: at(new THREE.SphereGeometry(0.14, 18, 14), 0, 0.66, 0),
      // 出纳的绿色遮光帽檐：一个压扁的半圆片，加一圈帽带
      visor: at(new THREE.CylinderGeometry(0.215, 0.215, 0.028, 22, 1, false, -Math.PI / 2, Math.PI), 0, 0.715, 0.03),
      band: at(new THREE.CylinderGeometry(0.128, 0.145, 0.06, 18, 1, true), 0, 0.735, 0),
      stick: at(new THREE.BoxGeometry(0.03, 0.8, 0.03), 0.19, 0.62, 0.04),
      board: at(new THREE.BoxGeometry(0.36, 0.26, 0.04), 0.19, 1.05, 0.04),
    }
  }, [])
  const root = useRef<THREE.Group>(null)
  const bodies = useRef<THREE.InstancedMesh>(null)
  const heads = useRef<THREE.InstancedMesh>(null)
  const visors = useRef<THREE.InstancedMesh>(null)
  const bands = useRef<THREE.InstancedMesh>(null)
  const sticks = useRef<THREE.InstancedMesh>(null)
  const boards = useRef<THREE.InstancedMesh>(null)
  const linda = useRef<THREE.Group>(null)
  const lean = useRef<THREE.Group>(null)
  const ringA = useRef<THREE.Group>(null)
  const ringB = useRef<THREE.Group>(null)
  const matA = useRef<THREE.Mesh>(null)
  const matB = useRef<THREE.Mesh>(null)
  const deskA = useRef<THREE.Group>(null)
  const deskB = useRef<THREE.Group>(null)
  const tagA = useRef<THREE.Group>(null)
  const tagB = useRef<THREE.Group>(null)
  const [shown, setShown] = useState(0) // 已经冒出来几条特征
  const [hot, setHot] = useState(-1) // 琳达正悬在哪一圈上面
  const [step, setStep] = useState(0) // 慢想到第几步
  const [grab, setGrab] = useState(false)
  const ph = useRef(phase)
  ph.current = phase
  const pk = useRef(pick)
  pk.current = pick
  const s = useRef({ x: L0[0], z: L0[1], y: 0, tx: L0[0], tz: L0[1], vx: 0, over: false, drag: false, t: 0, clock: 0, hold: false, hot: -1, step: 0, shown: 0, ox: 0, oz: 0, ra: 0, ta: 0, rb: 0, tb: 0 })
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), c: new THREE.Color(), v: new THREE.Vector3(), hit: new THREE.Vector3(), ndc: new THREE.Vector2(), ray: new THREE.Raycaster(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0) }), [])
  const off = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (phase === 'ask') {
      Object.assign(s.current, { x: L0[0], z: L0[1], tx: L0[0], tz: L0[1], drag: false, t: 0, shown: 0, hot: -1 })
      setShown(0)
      setHot(-1)
      say(L('这是琳达。', 'This is Linda.'))
    } else if (phase === 'picked') say(sayHold())
    else say(L('小圈一直在大圈里面', 'Always inside the big ring'))
  }, [phase, say])
  useEffect(() => () => off.current?.(), [])

  const zoneAt = (x: number, z: number) => (Math.hypot(x - ZA[0], z - ZA[1]) < 0.62 ? 0 : Math.hypot(x - ZB[0], z - ZB[1]) < 0.62 ? 1 : -1)
  const down = (e: ThreeEvent<PointerEvent>) => {
    if (ph.current !== 'ask' || !root.current || s.current.drag) return
    e.stopPropagation()
    const a = s.current
    a.drag = true
    setGrab(true)
    tmp.plane.constant = -e.point.y
    root.current.worldToLocal(tmp.v.copy(e.point))
    a.ox = a.x - tmp.v.x
    a.oz = a.z - tmp.v.z
    const move = (ev: PointerEvent) => {
      if (!root.current) return
      const r = gl.domElement.getBoundingClientRect()
      tmp.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      tmp.ray.setFromCamera(tmp.ndc, camera)
      if (!tmp.ray.ray.intersectPlane(tmp.plane, tmp.hit)) return
      root.current.worldToLocal(tmp.hit)
      let x = tmp.hit.x + a.ox
      let z = tmp.hit.z + a.oz
      const d = Math.hypot(x, z)
      if (d > 1.6) ((x *= 1.6 / d), (z *= 1.6 / d))
      a.tx = x
      a.tz = Math.max(-0.2, z) // 不让她被拖进后面的人堆里
    }
    const up = () => {
      off.current?.()
      a.drag = false
      setGrab(false)
      const k = zoneAt(a.tx, a.tz)
      if (k >= 0 && ph.current === 'ask') choose(k)
      else ((a.tx = L0[0]), (a.tz = L0[1]))
    }
    off.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      off.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  useFrame((_, raw) => {
    const a = s.current
    const slowK = 1 - 0.93 * bus.t
    const dt = Math.min(0.05, raw)
    a.clock += dt * slowK
    const t = a.clock
    const p = ph.current === 'done' ? 1 : ph.current === 'picked' ? bus.p : 0
    const sel = pk.current

    // 特征一条条冒出来
    if (ph.current === 'ask' && bus.micro.k > 0.9) {
      a.t += dt * slowK
      const n = Math.min(N_TRAITS, Math.floor((a.t - 0.5) / 0.55) + 1)
      if (n > a.shown) {
        a.shown = n
        setShown(n)
        if (n === N_TRAITS) say(sayAsk())
      }
    }
    // 按住慢的时候把字幕让给慢
    const hold = ph.current === 'picked' && bus.p > 0.03
    if (hold !== a.hold) {
      a.hold = hold
      if (ph.current === 'picked') say(hold ? '' : sayHold())
    }
    const st = p < 0.36 ? 0 : p < 0.74 ? 1 : p < 0.86 ? 2 : 3
    if (st !== a.step) setStep((a.step = st))

    // 两圈绳子和地垫
    const g1 = ease(sm(0.02, 0.34, p))
    const g2 = ease(sm(0.4, 0.7, p))
    const pulse = sm(0.74, 0.86, p) * (1 - sm(0.9, 1, p) * 0.6)
    const ax = lerp(ZA[0], BIG[0], g1)
    const az = lerp(ZA[1], BIG[1], g1)
    const ar = lerp(ZR, BR, g1)
    const bx = lerp(ZB[0], SMALL[0], g2)
    const bz = lerp(ZB[1], SMALL[1], g2)
    const br = lerp(ZR, SR, g2)
    const hotA = a.hot === 0 ? 1 : 0
    const hotB = a.hot === 1 ? 1 : 0
    const ta = 0.026 + hotA * 0.01
    const tb = 0.026 + hotB * 0.01 + pulse * 0.014
    if (ar !== a.ra || ta !== a.ta) setRope(rope.a, (a.ra = ar), (a.ta = ta))
    if (br !== a.rb || tb !== a.tb) setRope(rope.b, (a.rb = br), (a.tb = tb))
    ringA.current?.position.set(ax, FLOOR, az)
    ringB.current?.position.set(bx, FLOOR + 0.004, bz)
    if (matA.current) {
      matA.current.scale.setScalar(ar)
      ;(matA.current.material as THREE.MeshStandardMaterial).opacity = 0.5 + hotA * 0.25 + (sel === 0 && p === 0 ? 0.2 : 0)
    }
    if (matB.current) {
      matB.current.scale.setScalar(br)
      ;(matB.current.material as THREE.MeshStandardMaterial).opacity = 0.55 + hotB * 0.25 + (sel === 1 && p === 0 ? 0.2 : 0) + g2 * 0.3 + pulse * 0.12
    }
    const fold = 1 - sm(0, 0.13, p)
    deskA.current?.scale.setScalar(Math.max(0.0001, backOut(fold)))
    deskB.current?.scale.setScalar(Math.max(0.0001, backOut(fold)))
    // 两块小纸签一开始挂在各自柜台的檐上（像招牌），慢想时跟着圈走
    tagA.current?.position.set(lerp(TAG_A[0], BIG[0] - 0.7, g1), lerp(TAG_A[1], 0.5, g1), lerp(TAG_A[2], BIG[1] - 0.98, g1))
    tagB.current?.position.set(lerp(TAG_B[0], SMALL[0] + 0.72, g2), lerp(TAG_B[1], 0.9, g2), lerp(TAG_B[2], SMALL[1] - 0.2, g2))

    // 琳达
    if (ph.current !== 'ask' && sel !== null) {
      if (sel === 0) ((a.tx = lerp(ZA[0], L_BIG[0], g1)), (a.tz = lerp(ZA[1] + 0.05, L_BIG[1], g1)))
      else ((a.tx = lerp(ZB[0] - 0.08, SMALL[0], g2)), (a.tz = lerp(ZB[1] + 0.05, SMALL[1], g2)))
    }
    const follow = 1 - Math.exp(-dt * (a.drag ? 22 : p > 0 ? 30 : 9))
    const px = a.x
    a.x += (a.tx - a.x) * follow
    a.z += (a.tz - a.z) * follow
    a.vx += ((a.x - px) / Math.max(dt, 0.001) - a.vx) * Math.min(1, dt * 10)
    const away = Math.hypot(a.tx - a.x, a.tz - a.z)
    const lift = a.drag ? 0.2 : Math.min(0.3, away * 0.5) * (p > 0 ? 0 : 1) + (a.over && ph.current === 'ask' ? 0.07 : 0)
    a.y += (lift - a.y) * Math.min(1, dt * 12)
    const h = a.drag ? zoneAt(a.x, a.z) : -1
    if (h !== a.hot) setHot((a.hot = h))
    if (linda.current) {
      linda.current.position.set(a.x, a.y, a.z)
      linda.current.scale.setScalar(lerp(1.08, 0.74, sm(0.02, 0.4, p)))
    }
    if (lean.current) {
      lean.current.rotation.z = THREE.MathUtils.clamp(-a.vx * 0.12, -0.35, 0.35)
      lean.current.rotation.y = a.drag ? 0 : Math.sin(t * 1.1) * 0.12 * (1 - sm(0, 0.1, p))
    }

    // 人群
    const o = tmp.o
    let iv = 0
    let ib = 0
    const face0 = 1 - sm(0, 0.25, p)
    crowd.forEach((c, i) => {
      const d1 = c.kind >= 2 ? 0.02 + c.d * 0.1 : 0.03 + c.d * 0.12
      const u1 = sm(d1, d1 + 0.2, p)
      const u2 = c.kind === 3 ? sm(0.4 + c.d * 0.06, 0.62 + c.d * 0.06, p) : 0
      const e1 = ease(u1)
      const e2 = ease(u2)
      let x = lerp(c.home[0], c.a[0], e1)
      let z = lerp(c.home[1], c.a[1], e1)
      x = lerp(x, c.b[0], e2)
      z = lerp(z, c.b[1], e2)
      // 没被叫到的时候，原地晃一晃
      const idle = 1 - sm(0, 0.05, p)
      x += Math.sin(t * 0.5 + c.ph) * 0.02 * idle
      z += Math.cos(t * 0.43 + c.ph * 2) * 0.02 * idle
      const walking = Math.sin(u1 * Math.PI) + Math.sin(u2 * Math.PI)
      const y = Math.abs(Math.sin((u1 + u2) * Math.PI * 4)) * 0.05 * Math.min(1, walking * 3) + Math.max(0, Math.sin(t * 1.7 + c.ph)) * 0.012 * idle + (c.kind === 3 ? pulse * 0.07 * Math.abs(Math.sin(p * 40 + i)) : 0)
      const out = c.kind < 2 ? e1 : 0
      const sc = SC * lerp(1, 0.86, out)
      const toL = Math.atan2(a.x - x, a.z - z)
      const rot = toL * face0 * 0.8 + Math.sin(t * 0.8 + c.ph) * 0.2 * idle + (c.kind < 2 ? Math.atan2(BIG[0] - x, BIG[1] - z) * out : 0)
      o.position.set(x, y, z)
      o.rotation.set(0, rot, 0)
      o.scale.setScalar(sc)
      o.updateMatrix()
      bodies.current?.setMatrixAt(i, o.matrix)
      heads.current?.setMatrixAt(i, o.matrix)
      tmp.c.copy(c.col).lerp(PALE, out * 0.72)
      bodies.current?.setColorAt(i, tmp.c)
      if (c.kind >= 2) {
        visors.current?.setMatrixAt(iv, o.matrix)
        bands.current?.setMatrixAt(iv, o.matrix)
        iv++
      }
      if (c.kind === 1 || c.kind === 3) {
        sticks.current?.setMatrixAt(ib, o.matrix)
        boards.current?.setMatrixAt(ib, o.matrix)
        tmp.c.set(PINK).lerp(PALE, out * 0.6)
        boards.current?.setColorAt(ib, tmp.c)
        ib++
      }
    })
    for (const m of [bodies, heads, visors, bands, sticks, boards]) if (m.current) m.current.instanceMatrix.needsUpdate = true
    if (bodies.current?.instanceColor) bodies.current.instanceColor.needsUpdate = true
    if (boards.current?.instanceColor) boards.current.instanceColor.needsUpdate = true
  })

  const asking = phase === 'ask'
  const nBoards = crowd.filter((c) => c.kind === 1 || c.kind === 3).length
  return (
    <group ref={root} scale={G}>
      {/* 人群：身体、头、出纳的帽檐、举着的牌子 */}
      <instancedMesh ref={bodies} args={[geo.body, undefined, N]} castShadow frustumCulled={false}>
        <meshStandardMaterial roughness={0.78} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[geo.head, undefined, N]} castShadow frustumCulled={false}>
        <meshStandardMaterial color={C.skin} roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={visors} args={[geo.visor, undefined, TELLERS]} castShadow frustumCulled={false}>
        <meshStandardMaterial color={VISOR} roughness={0.55} />
      </instancedMesh>
      <instancedMesh ref={bands} args={[geo.band, undefined, TELLERS]} frustumCulled={false}>
        <meshStandardMaterial color={VISOR} roughness={0.55} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={sticks} args={[geo.stick, undefined, nBoards]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#c79a62" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={boards} args={[geo.board, undefined, nBoards]} castShadow frustumCulled={false}>
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>

      {/* “银行出纳”那一圈 */}
      <group ref={ringA}>
        <mesh ref={matA} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow onClick={(e) => asking && (e.stopPropagation(), choose(0))}>
          <circleGeometry args={[1, 64]} />
          <meshStandardMaterial color={C.white} transparent opacity={0.5} roughness={1} depthWrite={false} />
        </mesh>
        <mesh geometry={rope.a} castShadow frustumCulled={false}>
          <meshStandardMaterial color={C.white} roughness={0.85} />
        </mesh>
      </group>
      {/* “女权运动的出纳”那一圈 */}
      <group ref={ringB}>
        <mesh ref={matB} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]} receiveShadow onClick={(e) => asking && (e.stopPropagation(), choose(1))}>
          <circleGeometry args={[1, 64]} />
          <meshStandardMaterial color="#dfa0ad" transparent opacity={0.55} roughness={1} depthWrite={false} />
        </mesh>
        <mesh geometry={rope.b} castShadow frustumCulled={false}>
          <meshStandardMaterial color={PINK} roughness={0.8} />
        </mesh>
      </group>

      {/* 两个柜台。第二个多插了一面旗 */}
      <group position={[DESK_A[0], 0, DESK_A[1]]} rotation={[0, 0.62, 0]} scale={0.85}>
        <group ref={deskA}>
          <Counter />
        </group>
      </group>
      <group position={[DESK_B[0], 0, DESK_B[1]]} rotation={[0, -0.62, 0]} scale={0.85}>
        <group ref={deskB}>
          <Counter />
          <group position={[0.43, 0, 0.02]} rotation={[0, 0, -0.06]}>
            <mesh position={[0, 0.55, 0]} castShadow>
              <cylinderGeometry args={[0.018, 0.022, 1.1, 10]} />
              <M color="#c79a62" />
            </mesh>
            <mesh position={[0, 1.11, 0]} castShadow>
              <sphereGeometry args={[0.035, 12, 10]} />
              <M color={C.gold} rough={0.5} />
            </mesh>
            <mesh position={[0.2, 0.93, 0]} castShadow>
              <boxGeometry args={[0.36, 0.26, 0.022]} />
              <M color={PINK} rough={0.8} />
            </mesh>
            <mesh position={[0.2, 0.93, 0.012]}>
              <planeGeometry args={[0.36, 0.245]} />
              <meshStandardMaterial map={tex.venus} roughness={0.8} />
            </mesh>
          </group>
        </group>
      </group>
      <group ref={tagA} position={TAG_A}>
        <Tag big show tone={hot === 0 || (pick === 0 && step === 0) ? 'blue' : 'light'}>
          {L('银行出纳', 'Bank teller')}
        </Tag>
        <Tag big below tone="dark" show={step >= 2}>
          {L(`${TELLERS} 人`, `${TELLERS} people`)}
        </Tag>
      </group>
      <group ref={tagB} position={TAG_B}>
        <Tag big show tone={hot === 1 || (pick === 1 && step === 0) ? 'blue' : 'light'}>
          {L('女权运动的出纳', 'Feminist bank teller')}
        </Tag>
        <Tag big below tone="dark" show={step >= 3}>
          {L(`其中 ${FEM} 人`, `${FEM} of them`)}
        </Tag>
      </group>

      {/* 琳达：和书页上那个举牌子的蓝色小人是同一个 */}
      <group ref={linda} position={[L0[0], 0, L0[1]]}>
        <group ref={lean}>
          <Meeple color={C.blue}>
            <group position={[0.2, 0.5, 0]} rotation={[0, 0, -0.15]}>
              <mesh position={[0, 0.25, 0]} castShadow>
                <boxGeometry args={[0.025, 0.9, 0.025]} />
                <M color="#c79a62" />
              </mesh>
              <mesh position={[0, 0.62, 0]} castShadow>
                <boxGeometry args={[0.44, 0.3, 0.03]} />
                <M color={C.white} />
              </mesh>
              <mesh position={[0, 0.62, 0.017]}>
                <planeGeometry args={[0.42, 0.286]} />
                <meshStandardMaterial map={tex.peace} roughness={0.9} />
              </mesh>
            </group>
          </Meeple>
        </group>
        <mesh position={[0.05, 0.6, 0]} onPointerDown={down} onPointerOver={() => (s.current.over = true)} onPointerOut={() => (s.current.over = false)}>
          <cylinderGeometry args={[0.36, 0.3, 1.3, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <Tag position={[-0.08, 1.02, 0]} tone="dark" show={asking && !grab}>
          <span className="tg16">{L('琳达', 'Linda')}</span>
        </Tag>
        {/* 她的特征：几枚小标签，靠着她左手边排成一小簇 */}
        <Html position={[-0.36, 0.34, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={traitsRef} className="traits" style={{ transform: 'translate(-100%, -50%)', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
            {TRAITS.map((tr, i) => (
              <span key={tr} className={`tag3d light ${asking && !grab && shown > i ? 'show' : ''}`} data-tg="15">
                {tr}
              </span>
            ))}
          </div>
        </Html>
      </group>
    </group>
  )
}

// 银行柜台：木头台面、一块玻璃、绿色的招牌檐，台面上两摞硬币
function Counter() {
  return (
    <group>
      <RoundedBox args={[0.66, 0.32, 0.22]} radius={0.04} smoothness={4} position={[0, 0.16, 0]} castShadow>
        <M color="#c99763" />
      </RoundedBox>
      <RoundedBox args={[0.74, 0.05, 0.3]} radius={0.02} smoothness={3} position={[0, 0.34, 0]} castShadow>
        <M color="#f1e4c6" rough={0.7} />
      </RoundedBox>
      {[-0.32, 0.32].map((x) => (
        <mesh key={x} position={[x, 0.56, -0.02]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.4, 10]} />
          <M color="#8a5a3c" />
        </mesh>
      ))}
      <mesh position={[0, 0.55, -0.02]}>
        <boxGeometry args={[0.6, 0.34, 0.012]} />
        <meshStandardMaterial color="#cfe6f2" transparent opacity={0.38} roughness={0.15} />
      </mesh>
      <RoundedBox args={[0.78, 0.13, 0.2]} radius={0.05} smoothness={4} position={[0, 0.8, 0]} castShadow>
        <M color={VISOR} rough={0.7} />
      </RoundedBox>
      {[[-0.2, 3], [-0.09, 5]].map(([x, n]) => (
        <mesh key={x} position={[x, 0.365 + n * 0.008, 0.07]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, n * 0.016, 16]} />
          <M color={C.gold} rough={0.45} />
        </mesh>
      ))}
    </group>
  )
}
