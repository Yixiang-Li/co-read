import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bus } from '../bus'
import { L, useLang } from '../i18n'
import { backOut, Baked, C, M, Meeple, sm, Tag } from '../world/kit'
import type { MicroProps } from './types'

// 球拍和球：一张小柜台。访客挑一枚硬币当作球的价钱；
// 球拍那边自动多出同样一枚再加 1 块。按住慢之后，用硬币把 2x + 1 块 = 1 块 1 摆出来。
// 性能：柜台、球拍、钱箱烤成两个网格；每枚硬币一个网格、一张贴图（正面、背面、边缘画在同一张上）。

const TT = 0.5 // 桌面的高度
// 整张柜台缩到 0.88，摆在岛顶正中偏后一点：四条桌腿和柜台后面的人都踩在平的草地上
//（原来偏左 0.25，左边两条腿和半个桌面悬在沙滩和海的上面）
const SC = 0.88
const AT: [number, number, number] = [0, 0, -0.09]
const cl = (x: number) => Math.min(1, Math.max(0, x))
const ez = (x: number) => {
  const t = cl(x)
  return t * t * (3 - 2 * t)
}
type V2 = [number, number]
type V3 = [number, number, number]

// 桌面上的位置（以桌子中心为原点）
const CH: V2[] = [[-0.62, 0.38], [-0.1, 0.38], [0.42, 0.38]] // 三枚候选的硬币
const BALL: V2 = [0.16, -0.42]
const SLOT_B: V2 = [0.16, -0.06] // 球的价钱
const SLOT_P1: V2 = [-0.94, -0.06] // 球拍的价钱里“和球一样”的那一枚
const SLOT_P2: V2 = [-0.5, -0.06] // 球拍多出来的 1 块
const TILL_G: V2 = [0.72, 0.02] // 钱箱里的 1 块
const TILL_S: V2 = [1.03, 0.02] // 钱箱里的 1 毛
// 算式摆在绒垫中间那一行（z = 0.36）：再靠后，右边两枚会压到拉开的抽屉边上
const X1: V2 = [-0.98, 0.36]
const X2: V2 = [-0.64, 0.36]
const GL: V2 = [-0.27, 0.36]
const EQ: V2 = [0.04, 0.36]
const GR: V2 = [0.36, 0.36]
const SR: V2 = [0.72, 0.36]
const CA: V2 = [0.4, 0.36]
const CB: V2 = [0.68, 0.36]

type Kind = 'g' | 's' | 'c'
const KIND: Record<Kind, { r: number; col: string; rim: string; ink: string }> = {
  g: { r: 0.15, col: '#e6b94b', rim: '#b98a26', ink: '#5e4208' },
  s: { r: 0.132, col: '#dfe0d8', rim: '#a2a8a4', ink: '#414a4a' },
  c: { r: 0.112, col: '#cf8a5c', rim: '#a2613c', ink: '#58300f' },
}
const OPT: Kind[] = ['s', 'c', 'g'] // 和选项的顺序一致：1 毛、5 分、1 块

// —— 把一堆零件烤成一个带顶点颜色的网格 ——
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

// 柜台、球拍、钱箱：都不会动
function stallParts(): Part[] {
  const wood = '#c9a06a'
  const dark = '#9c7148'
  const red = C.red
  return [
    { g: rbox(2.56, 0.09, 1.56, 0.04), c: wood, p: [0, TT - 0.045, 0] },
    { g: rbox(2.36, 0.12, 1.36, 0.03), c: dark, p: [0, TT - 0.14, 0] },
    ...([[-1.1, -0.6], [1.1, -0.6], [-1.1, 0.6], [1.1, 0.6]] as const).map(([x, z]): Part => ({ g: cyl(0.065, 0.045, TT - 0.2, 12), c: dark, p: [x, (TT - 0.2) / 2, z] })),
    // 前面一块深蓝的绒垫，硬币在上面摆
    { g: rbox(2.3, 0.022, 0.66, 0.01), c: C.navy, p: [-0.06, TT + 0.011, 0.4] },
    // 球拍和它的小木座
    ...within([-0.72, TT, -0.42], [0, 0, 0], [
      { g: rbox(0.34, 0.08, 0.22, 0.03), c: dark, p: [0, 0.04, 0] },
      ...within([0, 0.07, 0.02], [-0.3, 0.12, 0.06], [
        { g: rbox(0.085, 0.3, 0.05, 0.022), c: '#c79a62', p: [0, 0.13, 0] },
        { g: cyl(0.052, 0.06, 0.05, 12), c: '#a9773f', p: [0, 0.02, 0] },
        ...within([0, 0.53, 0], [Math.PI / 2, 0, 0], [
          { g: cyl(0.29, 0.29, 0.03, 40), c: '#c79a62' },
          { g: cyl(0.278, 0.278, 0.014, 40), c: C.red, p: [0, 0.021, 0] },
          { g: cyl(0.278, 0.278, 0.014, 40), c: C.ink, p: [0, -0.021, 0] },
        ]),
      ]),
    ]),
    // 托着球的小杯子
    { g: cyl(0.07, 0.05, 0.1, 16), c: dark, p: [BALL[0], TT + 0.05, BALL[1]] },
    // 钱箱：抽屉拉开着，里面是一共收的 1 块 1
    ...within([0.875, TT, -0.4], [0, 0, 0], [
      { g: rbox(0.62, 0.3, 0.44, 0.06), c: red, p: [0, 0.15, 0], gl: true },
      { g: rbox(0.5, 0.2, 0.2, 0.05), c: red, p: [0, 0.36, -0.08], r: [-0.25, 0, 0], gl: true },
      { g: rbox(0.38, 0.11, 0.02, 0.008), c: '#2c3440', p: [0, 0.375, 0.022], r: [-0.25, 0, 0], gl: true },
      ...[-0.18, -0.06, 0.06, 0.18].flatMap((x) => [0.1, 0.17].map((z): Part => ({ g: cyl(0.035, 0.035, 0.03, 10), c: C.cream, p: [x, 0.305, z], gl: true }))),
      { g: rbox(0.66, 0.05, 0.4, 0.02), c: '#a8452f', p: [0, 0.027, 0.42] },
      { g: box(0.6, 0.012, 0.34), c: '#5b2a2a', p: [0, 0.054, 0.42] },
      // 小票
      { g: box(0.16, 0.26, 0.006), c: C.white, p: [0.2, 0.52, -0.1], r: [-0.35, 0, 0.05] },
      ...[0.6, 0.56, 0.52, 0.48].map((y, i): Part => ({ g: box(0.1 - (i % 2) * 0.03, 0.012, 0.002), c: '#9aa0a6', p: [0.2 - (i % 2) * 0.015, y, -0.127 + (0.6 - y) * 0.36], r: [-0.35, 0, 0.05] })),
    ]),
  ]
}

// 一枚硬币的贴图：左半是面值，右半是 x；圆外面的四个角是边缘的颜色
function coinTex(text: string, k: Kind) {
  const { col, rim, ink } = KIND[k]
  const cv = document.createElement('canvas')
  cv.width = 384
  cv.height = 192
  const g = cv.getContext('2d')!
  g.fillStyle = rim
  g.fillRect(0, 0, 384, 192)
  for (const [ox, label, italic] of [[0, text, false], [192, 'x', true]] as const) {
    g.fillStyle = col
    g.beginPath()
    g.arc(ox + 96, 96, 94, 0, 7)
    g.fill()
    const gr = g.createRadialGradient(ox + 66, 56, 8, ox + 96, 96, 120)
    gr.addColorStop(0, 'rgba(255,255,255,0.5)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.beginPath()
    g.arc(ox + 96, 96, 94, 0, 7)
    g.fill()
    g.strokeStyle = rim
    g.lineWidth = 7
    g.beginPath()
    g.arc(ox + 96, 96, 78, 0, 7)
    g.stroke()
    g.fillStyle = ink
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = italic ? "italic 700 104px Georgia, 'Times New Roman', serif" : "900 66px 'Noto Sans SC','PingFang SC',sans-serif"
    g.fillText(label, ox + 96, italic ? 90 : 102)
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}
// 硬币的几何体：顶面用贴图左半，底面用右半，侧面取角上的边缘色
function coinGeo(r: number) {
  const g = new THREE.CylinderGeometry(r, r, 0.04, 36)
  const uv = g.attributes.uv
  const idx = g.index!
  const seen = new Uint8Array(uv.count)
  g.groups.forEach((grp, gi) => {
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      const v = idx.getX(i)
      if (seen[v]) continue
      seen[v] = 1
      if (gi === 0) uv.setXY(v, 0.004, 0.008)
      else uv.setX(v, uv.getX(v) * 0.5 + (gi === 2 ? 0.5 : 0))
    }
  })
  g.clearGroups()
  g.rotateY(Math.PI / 2) // 让字朝着镜头的方向
  return g
}

export default function Paddle({ c, phase, pick, choose, say }: MicroProps) {
  const lang = useLang()
  const PRICE = lang === 'zh' ? ['1 块 1', '1 块零 5 分', '2 块'] : ['$1.10', '$1.05', '$2.00'] // 球拍 = 球 + 1 块
  const SUM = lang === 'zh' ? ['1 块 2', '1 块 1', '3 块'] : ['$1.20', '$1.10', '$3.00'] // 两样加起来
  const res = useMemo(() => {
    const parts = stallParts()
    const label = (i: number) => c.opts[i].replace(/\s/g, '')
    const mk = (k: Kind, text: string) => ({ geo: coinGeo(KIND[k].r), mat: new THREE.MeshStandardMaterial({ map: coinTex(text, k), roughness: 0.58, metalness: 0.12 }) })
    return {
      matte: bake(parts.filter((x) => !x.gl)),
      gloss: bake(parts.filter((x) => x.gl)),
      coin: { s: mk('s', label(0)), c: mk('c', label(1)), g: mk('g', label(2)) },
      slots: bake([
        ...[SLOT_B, SLOT_P1].map((at): Part => ({ g: new THREE.RingGeometry(0.135, 0.158, 36), c: '#fff8e6', p: [at[0], TT + 0.004, at[1]], r: [-Math.PI / 2, 0, 0] })),
        { g: box(0.11, 0.006, 0.028), c: '#fff8e6', p: [(SLOT_P1[0] + SLOT_P2[0]) / 2 - 0.01, TT + 0.005, SLOT_P1[1]] },
        { g: box(0.028, 0.006, 0.11), c: '#fff8e6', p: [(SLOT_P1[0] + SLOT_P2[0]) / 2 - 0.01, TT + 0.005, SLOT_P1[1]] },
      ]),
      eq: bake([{ g: box(0.15, 0.022, 0.034), c: '#fff8e6', p: [0, 0, -0.045] }, { g: box(0.15, 0.022, 0.034), c: '#fff8e6', p: [0, 0, 0.045] }]),
    }
  }, [c, lang])
  useEffect(
    () => () => {
      res.matte.dispose()
      res.gloss.dispose()
      res.slots.dispose()
      res.eq.dispose()
      Object.values(res.coin).forEach((x) => (x.geo.dispose(), x.mat.map?.dispose(), x.mat.dispose()))
    },
    [res],
  )

  const co = useRef<Record<string, THREE.Object3D | null>>({})
  const ball = useRef<THREE.Mesh>(null)
  const man = useRef<THREE.Group>(null)
  const eq = useRef<THREE.Mesh>(null)
  const slots = useRef<THREE.MeshBasicMaterial>(null)
  const s = useRef({ T: 0, since: 0, h: [0, 0, 0] })
  const [beat, setBeat] = useState(0) // 0 合计，1 贵 1 块，2 等访客挑硬币
  const [st, setSt] = useState(0) // 选完以后：1 球的价钱落下，2 球拍的价钱跟上，3 合计算出来
  const [hov, setHov] = useState<number | null>(null)
  const [bits, setBits] = useState(0)
  const bitsR = useRef(0)
  const k = pick ?? 0

  const quiet = !!(bits & 1)
  useEffect(() => {
    if (phase === 'ask') say(beat === 0 ? L('球拍和球，一共 1 块 1。', 'A bat and a ball: $1.10 in total.') : beat === 1 ? L('球拍比球贵 1 块。', 'The bat costs $1.00 more than the ball.') : L('球多少钱？挑一枚硬币给它。', 'How much is the ball? Pick a coin.'))
    else if (phase === 'picked') say(quiet || st < 2 ? '' : L(`球 ${c.opts[k]}，球拍就是 ${PRICE[k]}。`, `Ball ${c.opts[k]}, so the bat is ${PRICE[k]}.`))
    else say('')
  }, [phase, beat, st, quiet, k, c, say, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, rawDt) => {
    const a = s.current
    const dt = Math.min(0.05, rawDt) * (1 - 0.93 * bus.t)
    if (bus.micro.k > 0.75) a.T += dt
    if (phase !== 'ask') a.since += dt
    const T = a.T
    const p = phase === 'done' ? 1 : phase === 'picked' ? bus.p : 0
    const nb = T > 4.2 ? 2 : T > 2.1 ? 1 : 0
    if (nb !== beat && phase === 'ask') setBeat(nb)
    const ns = phase === 'ask' ? 0 : a.since > 1.5 ? 3 : a.since > 0.95 ? 2 : a.since > 0.45 ? 1 : 0
    if (ns !== st) setSt(ns)
    const b = (p > 0.04 ? 1 : 0) | (p > 0.15 ? 2 : 0) | (p > 0.36 ? 4 : 0) | (p > 0.93 ? 8 : 0)
    if (b !== bitsR.current) setBits((bitsR.current = b))

    // 把一枚硬币放到 from → to 之间 t 的位置；y 是离桌面的高度，rx 是翻面的角度
    const put = (id: string, from: V2, to: V2, t: number, y: number, rx: number, sc: number) => {
      const g = co.current[id]
      if (!g) return
      g.position.set(from[0] + (to[0] - from[0]) * t, TT + 0.043 + y, from[1] + (to[1] - from[1]) * t)
      g.scale.setScalar(Math.max(0.0001, sc))
      g.rotation.x = rx
    }
    const flip = sm(0.06, 0.2, p) // 翻成 x
    const mv = ez((p - 0.38) / 0.15) // 左边三枚挪到一行
    const mv2 = ez((p - 0.43) / 0.15) // 钱箱里的两枚也挪过来
    const cut = sm(0.6, 0.74, p) // 两边各拿走 1 块
    const sp = sm(0.8, 0.89, p) // 1 毛换成两个 5 分
    const nod = Math.sin(sm(0.9, 0.99, p) * Math.PI) * 0.07
    const hop = Math.sin(flip * Math.PI) * 0.18

    // 三枚候选
    for (let i = 0; i < 3; i++) {
      const ap = backOut((T - 4.25 - i * 0.12) / 0.4)
      a.h[i] += ((phase === 'ask' && hov === i ? 1 : 0) - a.h[i]) * Math.min(1, rawDt * 12)
      if (phase === 'ask') put('ch' + i, CH[i], CH[i], 0, 0.16 * a.h[i] + (beat === 2 ? Math.max(0, Math.sin(T * 2.4 - i * 0.7)) * 0.02 : 0), 0.55 * a.h[i], ap * (1 + 0.12 * a.h[i]))
      else if (i === pick) {
        const j = ez(a.since / 0.5)
        if (mv > 0) put('ch' + i, SLOT_B, X2, mv, Math.sin(mv * Math.PI) * 0.22 + nod, Math.PI * flip, 1)
        else put('ch' + i, CH[i], SLOT_B, j, Math.sin(j * Math.PI) * 0.34 + hop, Math.PI * flip, 1)
      } else put('ch' + i, CH[i], CH[i], 0, 0, 0, 1 - ez(a.since / 0.3))
    }
    // 球拍那边跟着多出来的同一枚
    const j2 = cl((a.since - 0.5) / 0.4)
    put('cp', SLOT_P1, X1, mv, (1 - ez(j2)) * 0.5 + hop + Math.sin(mv * Math.PI) * 0.12 + nod, Math.PI * flip, phase === 'ask' ? 0 : backOut(j2 * 1.2))
    // 两枚 1 块：一枚是球拍贵出来的，一枚在钱箱里
    put('g1', SLOT_P2, GL, mv, Math.sin(mv * Math.PI) * 0.1 + cut * 0.34, 0, backOut((T - 2.3) / 0.4) * (1 - cut))
    put('g2', TILL_G, GR, mv2, Math.sin(mv2 * Math.PI) * 0.2 + cut * 0.34 + 0.012 * (1 - mv2), 0, 1 - cut)
    put('sv', TILL_S, SR, mv2, Math.sin(mv2 * Math.PI) * 0.2 + 0.012 * (1 - mv2), 0, 1 - sp)
    put('c1', SR, CA, sp, Math.sin(sp * Math.PI) * 0.16 + nod, 0, backOut(sp * 1.3))
    put('c2', SR, CB, sp, Math.sin(sp * Math.PI) * 0.1 + nod, 0, backOut(sp * 1.3))

    if (eq.current) eq.current.scale.setScalar(Math.max(0.0001, backOut((p - 0.5) / 0.08)))
    if (slots.current) slots.current.opacity = 0.8 * cl((T - 2.3) / 0.4) * (1 - mv)
    if (ball.current) ball.current.position.y = TT + 0.185 + Math.abs(Math.sin(T * 3.2)) * (phase === 'ask' ? 0.09 : 0.02)
    if (man.current) {
      man.current.rotation.y = Math.sin(T * 0.9) * 0.25
      man.current.position.y = phase !== 'ask' && a.since < 0.5 ? Math.sin((a.since / 0.5) * Math.PI) * 0.14 : 0
    }
  })

  const can = phase === 'ask' && beat === 2
  const done = phase === 'done'
  const end = done || !!(bits & 8)
  const algebra = !end && !!(bits & 2)
  const right = k === c.right
  const coin = (id: string, kind: Kind) => <mesh key={id} ref={(g) => void (co.current[id] = g)} geometry={res.coin[kind].geo} material={res.coin[kind].mat} scale={0.0001} />
  return (
    <group position={AT} scale={SC}>
      <mesh geometry={res.matte} castShadow receiveShadow>
        <Baked rough={0.85} />
      </mesh>
      <mesh geometry={res.gloss} castShadow receiveShadow>
        <Baked rough={0.3} />
      </mesh>
      {/* 柜台后面的人：和地上那个代表是同一个 */}
      <group ref={man} position={[-0.24, 0, -1.08]} scale={1.22}>
        <Meeple color="#cf9238">
          {/* 一顶小帽子：镜头从上往下看，光头的脑袋紧挨着球拍，很像一只大号的球 */}
          <mesh position={[0, 0.7, 0]} castShadow>
            <sphereGeometry args={[0.156, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <M color={C.teal} rough={0.8} />
          </mesh>
          <mesh position={[0, 0.705, 0.13]} rotation={[0.12, 0, 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 0.022, 18]} />
            <M color={C.teal} rough={0.8} />
          </mesh>
        </Meeple>
      </group>
      <mesh ref={ball} position={[BALL[0], TT + 0.185, BALL[1]]} castShadow>
        <sphereGeometry args={[0.088, 20, 14]} />
        <M color={C.white} rough={0.45} />
      </mesh>
      {/* 价钱的空位和加号；等号 */}
      <mesh geometry={res.slots}>
        <meshBasicMaterial ref={slots} color={C.cream} transparent opacity={0} />
      </mesh>
      <mesh ref={eq} geometry={res.eq} position={[EQ[0], TT + 0.035, EQ[1]]} scale={0.0001}>
        <meshBasicMaterial color={C.cream} />
      </mesh>
      {/* 硬币 */}
      {OPT.map((kind, i) => coin('ch' + i, kind))}
      {coin('cp', OPT[k])}
      {coin('g1', 'g')}
      {coin('g2', 'g')}
      {coin('sv', 's')}
      {coin('c1', 'c')}
      {coin('c2', 'c')}
      {/* 点得到的范围比硬币本身大一圈（不画出来） */}
      {can &&
        CH.map((at, i) => (
          <mesh
            key={i}
            position={[at[0], TT + 0.1, at[1]]}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => (e.stopPropagation(), setHov(i))}
            onPointerOut={() => setHov((h) => (h === i ? null : h))}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation()
              setHov(null)
              choose(i)
            }}
          >
            <cylinderGeometry args={[0.24, 0.24, 0.3, 10]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        ))}
      {/* 标签 */}
      <Tag position={[0.875, TT + 0.82, -0.5]} show>
        {L('合计 1 块 1', 'Total $1.10')}
      </Tag>
      <Tag position={[-0.72, TT + 1.0, -0.42]} tone={end ? 'blue' : 'light'} show={phase === 'ask' ? beat >= 1 : true}>
        {end ? PRICE[1] : algebra ? L('x + 1 块', 'x + $1.00') : phase !== 'ask' && st >= 2 ? PRICE[k] : L('比球贵 1 块', 'Ball + $1.00')}
      </Tag>
      <Tag position={[BALL[0], TT + 0.52, BALL[1]]} tone={end ? 'blue' : phase === 'ask' && hov !== null ? 'blue' : 'light'} show={phase === 'ask' ? beat >= 2 : true}>
        {end ? c.opts[1] : algebra ? 'x' : phase === 'ask' ? (hov !== null ? c.opts[hov] : L('？', '?')) : st >= 1 ? c.opts[k] : L('？', '?')}
      </Tag>
      <Tag position={[-0.3, TT + 0.16, 0.82]} tone={end ? 'blue' : quiet ? (right ? 'blue' : 'red') : 'dark'} show={end || (phase === 'picked' && st >= 3 && !(bits & 4))}>
        {L('加起来 ', 'Adds up to ') + SUM[end ? 1 : k]}
      </Tag>
    </group>
  )
}
