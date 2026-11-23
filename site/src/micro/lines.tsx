import { RoundedBox } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { bus } from '../bus'
import { L, useLang } from '../i18n'
import { paintLines } from '../paint'
import { backOut, C, M, Meeple, sm, Tag } from '../world/kit'
import type { MicroProps } from './types'

// 缪勒-莱尔错觉：背牌子的人把牌子放大成一块画架，两条线的“箭头”是能开合的短杆。
// 镜头参数要和 registry.tsx 里 lines 那一行一致：牌子正对镜头，两条线离镜头一样远，屏幕上才是真的一样长。
const CAM_POS = [0, 3.5, 5.7]
const CAM_LOOK = [0, 0.8, 0]

const W = 2.7 // 牌子的宽和高
const H = 1.84
const LEN0 = 1.5 // 两条线一样长
const R = 0.042 // 线的粗细
const FIN = 0.36 // 短杆的长度
const Y0 = 0.43 // 张开时两条线离中线的距离
const Y1 = 0.17 // 收起对齐时靠拢到的距离
const RAIL = 0.77 // 顶上那根滑轨的高度
const LEN = 1.46 // 参考线垂下来的长度
const XG = LEN0 / 2 + R + 0.012 // 参考线对准线头时的位置
const XP = W / 2 - 0.2 // 参考线停在两角时的位置
const INK = '#fffdf2'

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
const finish = (c: HTMLCanvasElement, repeat = false) => {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// 黑板面：深绿底，带擦过的粉笔痕和很淡的刻度
function paintBoard() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 700
  const g = c.getContext('2d')!
  g.fillStyle = '#1f4a3c'
  g.fillRect(0, 0, 1024, 700)
  for (let i = 0; i < 46; i++) {
    const x = hash(i, 1) * 1024
    const y = hash(i, 2) * 700
    const r = 90 + hash(i, 3) * 220
    const gr = g.createRadialGradient(x, y, 0, x, y, r)
    gr.addColorStop(0, `rgba(235,245,225,${0.03 + hash(i, 4) * 0.035})`)
    gr.addColorStop(1, 'rgba(235,245,225,0)')
    g.fillStyle = gr
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = hash(i, 5) > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.07)'
    g.fillRect(hash(i, 6) * 1024, hash(i, 7) * 700, 2 + hash(i, 8) * 26, 1.4)
  }
  // 滑轨下面一排刻度，像一把尺
  g.fillStyle = 'rgba(255,253,242,0.3)'
  for (let i = 0; i <= 60; i++) g.fillRect(62 + i * 15, 70, 2, i % 5 ? 8 : 16)
  return finish(c)
}

// 木头：顺着纹理的细线
function paintWood() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#c99b63'
  g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 150; i++) {
    g.strokeStyle = hash(i, 9) > 0.5 ? `rgba(120,78,40,${0.08 + hash(i, 10) * 0.16})` : `rgba(255,232,190,${0.08 + hash(i, 11) * 0.14})`
    g.lineWidth = 0.6 + hash(i, 12) * 2
    const y = hash(i, 13) * 256
    g.beginPath()
    g.moveTo(0, y)
    g.bezierCurveTo(80, y + (hash(i, 14) - 0.5) * 14, 170, y + (hash(i, 15) - 0.5) * 14, 256, y)
    g.stroke()
  }
  return finish(c, true)
}

// 画架脚下的一块沙地，边缘像颜料晕开
function paintPatch() {
  const S = 512
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.fillStyle = '#e6d6a6'
  g.fillRect(0, 0, S, S)
  for (let i = 0; i < 2600; i++) {
    g.save()
    g.translate(hash(i, 21) * S, hash(i, 22) * S)
    g.rotate(-0.4 + hash(i, 23) * 0.5)
    g.fillStyle = hash(i, 24) > 0.5 ? `rgba(255,250,225,${0.05 + hash(i, 25) * 0.07})` : `rgba(150,120,60,${0.04 + hash(i, 26) * 0.06})`
    g.beginPath()
    g.ellipse(0, 0, 10 + hash(i, 27) * 22, 2 + hash(i, 28) * 4, 0, 0, 7)
    g.fill()
    g.restore()
  }
  const img = g.getImageData(0, 0, S, S)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x / S - 0.5, y / S - 0.5) * 2
      const n = vnoise(x / 30, y / 30) * 0.65 + vnoise(x / 8, y / 8) * 0.35
      const a = (0.93 - r - n * 0.2) / 0.1
      img.data[(y * S + x) * 4 + 3] = a >= 1 ? 255 : a <= 0 ? 0 : hash(x, y) < a * a ? 255 : 0
    }
  g.putImageData(img, 0, 0)
  return finish(c)
}

// 两点之间的一根圆杆（画架的腿）
function Strut({ a, b, r = 0.034, map }: { a: [number, number, number]; b: [number, number, number]; r?: number; map: THREE.Texture }) {
  const v = useMemo(() => {
    const A = new THREE.Vector3(...a)
    const d = new THREE.Vector3(...b).sub(A)
    return { pos: A.clone().addScaledVector(d, 0.5), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), len: d.length() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.join(), b.join()])
  return (
    <mesh position={v.pos} quaternion={v.quat} castShadow>
      <cylinderGeometry args={[r, r * 1.15, v.len, 12]} />
      <meshStandardMaterial map={map} roughness={0.8} />
    </mesh>
  )
}

export default function Lines({ phase, pick, choose, say }: MicroProps) {
  useLang()
  const size = useThree((s) => s.size)
  const far = size.width / size.height < 1.15 ? 1.55 : 1
  const tilt = Math.atan2(CAM_POS[1] * far - CAM_LOOK[1], CAM_POS[2] * far - CAM_LOOK[2])
  const tex = useMemo(() => ({ board: paintBoard(), wood: paintWood(), patch: paintPatch(), lines: paintLines() }), [])
  // 两条线各一个材质：线和它的短杆一起变色
  const mats = useMemo(() => [0, 1].map(() => new THREE.MeshStandardMaterial({ color: INK, roughness: 0.62, emissive: '#fff3c4', emissiveIntensity: 0 })), [])
  const col = useMemo(() => ({ ink: new THREE.Color(INK), red: new THREE.Color(C.red) }), [])
  const bars = useRef<(THREE.Group | null)[]>([])
  const fins = useRef<(THREE.Group | null)[]>([])
  const guides = useRef<(THREE.Group | null)[]>([])
  const rods = useRef<(THREE.Group | null)[]>([])
  const tips = useRef<(THREE.Mesh | null)[]>([])
  const ticks = useRef<(THREE.Mesh | null)[]>([])
  const man = useRef<THREE.Group>(null)
  const stick = useRef<THREE.Group>(null)
  const s = useRef({ f: 0, fv: 0, hover: -1, lift: [0, 0], red: [0, 0], hop: 0, t: 0, touched: false })
  const [flags, setFlags] = useState(0) // 1 左边齐了；2 右边齐了；4 正按着慢
  const [folded, setFolded] = useState(true) // done 之后访客自己开合

  useEffect(() => {
    if (phase === 'ask') {
      s.current.hover = -1
      s.current.touched = false
      setFolded(true)
      say(L('哪一条更长？点它', 'Which one is longer? Tap it'))
    }
    if (phase === 'picked') {
      s.current.hop = 1
      say(flags & 4 ? '' : L('按住乌龟，让它量一量', 'Hold the tortoise. Let it measure'))
    }
    if (phase !== 'done') return
    say('')
    // 量完停一会儿，短杆自己张开：错觉马上回来
    const a = window.setTimeout(() => {
      setFolded(false)
      s.current.hop = 1
      say(L('一张开，又不一样长了', 'Open them, unequal again'))
    }, 1900)
    const b = window.setTimeout(() => !s.current.touched && say(L('点牌子，自己再收一次', 'Tap the board to fold them')), 5600)
    return () => (window.clearTimeout(a), window.clearTimeout(b))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, flags & 4])

  useFrame((_, raw) => {
    const dt = Math.min(0.05, raw)
    const a = s.current
    const slow = 1 - 0.93 * bus.t
    a.t += dt * slow
    const p = bus.p
    const picked = phase === 'picked'
    const done = phase === 'done'
    // 短杆收起的程度：按住慢的时候跟着进度走，量完以后跟着访客的开合走；用弹簧追，松手会弹回去
    const target = picked ? sm(0.02, 0.3, p) : done && folded ? 1 : 0
    a.fv += ((target - a.f) * 150 - a.fv * 15) * dt
    a.f += a.fv * dt
    const fc = clamp01(a.f)
    const over = a.f - fc
    const y = THREE.MathUtils.lerp(Y0, Y1, ease(fc))
    for (let b = 0; b < 2; b++) {
      const g = bars.current[b]
      const on = phase === 'ask' && a.hover === b ? 1 : 0
      a.lift[b] += (on - a.lift[b]) * Math.min(1, dt * 12)
      a.red[b] += ((pick === b && phase !== 'ask' ? 1 : 0) - a.red[b]) * Math.min(1, dt * 7)
      const red = a.red[b] * (1 - 0.92 * ease(fc)) // 收起来量的时候，两条线变回一个颜色
      if (g) {
        g.position.set(0, b ? -y : y, 0.078 + a.lift[b] * 0.05)
        g.scale.setScalar(1 + a.lift[b] * 0.035)
      }
      mats[b].color.copy(col.ink).lerp(col.red, red)
      mats[b].emissiveIntensity = a.lift[b] * 0.35
    }
    for (let i = 0; i < 8; i++) {
      const g = fins.current[i]
      if (!g) continue
      const b = i >> 2
      const k = (i % 4) / 3
      const fi = ease(clamp01(fc * 1.25 - k * 0.25)) + over * 1.4
      g.rotation.z = (i % 2 ? -1 : 1) * (b ? 0.25 : 0.75) * Math.PI * (1 - fi)
      g.scale.x = 1 - 0.14 * clamp01(fi)
      // 省电档：短杆不投影
      const m = g.children[0] as THREE.Mesh
      if (m.castShadow !== !!bus.quality) m.castShadow = !!bus.quality
    }
    // 两根参考线：滑块先沿滑轨对准线头，再垂下来
    let both = 0
    for (let i = 0; i < 2; i++) {
      const sl = picked ? (i ? sm(0.5, 0.66, p) : sm(0.2, 0.36, p)) : done ? 1 : 0
      const d = picked ? (i ? sm(0.66, 0.93, p) : sm(0.36, 0.58, p)) : done ? 1 : 0
      if (d > 0.97) both |= 1 << i
      const g = guides.current[i]
      if (g) g.position.x = (i ? 1 : -1) * THREE.MathUtils.lerp(XP, XG, ease(sl))
      const rod = rods.current[i]
      if (rod) rod.scale.y = Math.max(0.0001, d)
      const tip = tips.current[i]
      if (tip) {
        tip.position.y = -LEN * d - 0.03
        tip.scale.setScalar(0.6 + 0.4 * sm(0, 0.08, d))
      }
      for (let b = 0; b < 2; b++) {
        const m = ticks.current[i * 2 + b]
        if (!m) continue
        const by = b ? -y : y
        m.position.y = by - RAIL
        m.scale.setScalar(Math.max(0.0001, backOut((d * LEN - (RAIL - by) + 0.02) / 0.1)))
      }
    }
    const fl = both | (picked && p > 0.04 ? 4 : 0)
    if (fl !== flags) setFlags(fl)
    // 背牌子的人：平时轻轻晃，选了以后蹦一下，用小棍指着你选的那条
    a.hop = Math.max(0, a.hop - dt * 2.2 * slow)
    if (man.current) {
      man.current.position.y = Math.abs(Math.sin(a.hop * Math.PI * 2)) * 0.16 * a.hop
      man.current.rotation.z = Math.sin(a.t * 1.3) * 0.035
      man.current.rotation.y = Math.PI - 0.5 + Math.sin(a.t * 0.7) * 0.1
    }
    if (stick.current) {
      const want = phase === 'ask' ? -0.5 + Math.sin(a.t * 1.6) * 0.07 : phase === 'picked' && p < 0.04 ? (pick === 0 ? -1.05 : -0.8) : -0.3
      stick.current.rotation.x += (want - stick.current.rotation.x) * Math.min(1, dt * 6)
    }
  })

  const BX = -0.12
  const BY = 0.2 + (H / 2) * Math.cos(tilt)
  const BZ = -0.45
  // 牌子上的一个点在舞台里的位置（给画架的腿用）
  const at = (x: number, y: number, z: number): [number, number, number] => [BX + x, BY + y * Math.cos(tilt) + z * Math.sin(tilt), BZ - y * Math.sin(tilt) + z * Math.cos(tilt)]
  const brass = <meshStandardMaterial color={C.gold} roughness={0.45} />

  return (
    <group>
      {/* 沙地收在岛顶以内（草地半径约 1.6），再大就会悬在斜坡和海面上 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.08, 0.012, 0.02]} scale={[1, 0.8, 1]} receiveShadow>
        <planeGeometry args={[3.24, 3.24]} />
        <meshStandardMaterial map={tex.patch} transparent alphaTest={0.5} roughness={1} />
      </mesh>

      {/* 画架的腿 */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <Strut a={at(sx * 1.02, 0.5, -0.06)} b={[BX + sx * 1.16, 0, BZ - 1.05]} map={tex.wood} />
          <Strut a={at(sx * 1.02, -H / 2 + 0.1, -0.05)} b={[BX + sx * 1.1, 0, BZ + H / 2 * Math.sin(tilt) + 0.16]} map={tex.wood} r={0.04} />
        </group>
      ))}

      <group position={[BX, BY, BZ]} rotation={[-tilt, 0, 0]}>
        {/* 板面和木框 */}
        <RoundedBox args={[W, H, 0.07]} radius={0.03} smoothness={4} castShadow>
          <M color="#1b4135" />
        </RoundedBox>
        <mesh position={[0, 0, 0.037]} receiveShadow>
          <planeGeometry args={[W - 0.02, H - 0.02]} />
          <meshStandardMaterial map={tex.board} roughness={0.95} emissive="#ffffff" emissiveMap={tex.board} emissiveIntensity={0.3} />
        </mesh>
        {([[0, H / 2 + 0.035, W + 0.2, 0.1], [0, -H / 2 - 0.035, W + 0.2, 0.1], [-W / 2 - 0.035, 0, 0.1, H + 0.02], [W / 2 + 0.035, 0, 0.1, H + 0.02]] as const).map(([x, y, w, h], i) => (
          <RoundedBox key={i} args={[w, h, 0.13]} radius={0.035} smoothness={3} position={[x, y, 0]} castShadow={i === 0}>
            <meshStandardMaterial map={tex.wood} roughness={0.78} />
          </RoundedBox>
        ))}
        {/* 底下的托条 */}
        <RoundedBox args={[W - 0.5, 0.07, 0.16]} radius={0.03} smoothness={3} position={[0, -H / 2 + 0.03, 0.1]}>
          <meshStandardMaterial map={tex.wood} roughness={0.78} />
        </RoundedBox>

        {/* 两条线，上面那条短杆朝外张，下面那条朝里收 */}
        {[0, 1].map((b) => (
          <group key={b} ref={(g) => void (bars.current[b] = g)} position={[0, b ? -Y0 : Y0, 0.078]}>
            <mesh rotation={[0, 0, Math.PI / 2]} material={mats[b]} castShadow>
              <capsuleGeometry args={[R, LEN0, 6, 16]} />
            </mesh>
            {[-1, 1].map((e) => (
              <group key={e} position={[(e * LEN0) / 2, 0, 0]} scale={[-e, 1, 1]}>
                {[1, -1].map((sg) => (
                  <group key={sg} ref={(g) => void (fins.current[b * 4 + (e > 0 ? 2 : 0) + (sg > 0 ? 0 : 1)] = g)} rotation={[0, 0, sg * (b ? 0.25 : 0.75) * Math.PI]}>
                    <mesh position={[FIN / 2, 0, -0.004]} rotation={[0, 0, Math.PI / 2]} material={mats[b]} castShadow>
                      <capsuleGeometry args={[R * 0.9, FIN, 6, 14]} />
                    </mesh>
                  </group>
                ))}
                {/* 合页的铜钉和把线撑离板面的小柱 */}
                <mesh position={[0, 0, -0.012]} rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.023, 0.023, R * 2 + 0.036, 14]} />
                  {brass}
                </mesh>
              </group>
            ))}
          </group>
        ))}

        {/* 顶上的滑轨和两根参考线 */}
        <mesh position={[0, RAIL, 0.06]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.016, 0.016, W - 0.16, 10]} />
          {brass}
        </mesh>
        {[0, 1].map((i) => (
          <group key={i} ref={(g) => void (guides.current[i] = g)} position={[(i ? 1 : -1) * XP, RAIL, 0.135]}>
            <RoundedBox args={[0.09, 0.1, 0.08]} radius={0.025} smoothness={3} position={[0, 0, -0.05]}>
              {brass}
            </RoundedBox>
            <group ref={(g) => void (rods.current[i] = g)} scale={[1, 0.0001, 1]}>
              <mesh position={[0, -LEN / 2, 0]}>
                <boxGeometry args={[0.016, LEN, 0.012]} />
                <meshStandardMaterial color="#ffd761" roughness={0.35} metalness={0.3} emissive="#ffc94a" emissiveIntensity={0.35} />
              </mesh>
            </group>
            <mesh ref={(m) => void (tips.current[i] = m)} position={[0, -0.03, 0]} rotation={[0, 0, Math.PI]}>
              <coneGeometry args={[0.032, 0.075, 14]} />
              {brass}
            </mesh>
            {[0, 1].map((b) => (
              <mesh key={b} ref={(m) => void (ticks.current[i * 2 + b] = m)} position={[0, 0, 0.004]} scale={0.0001}>
                <boxGeometry args={[0.13, 0.02, 0.012]} />
                <meshStandardMaterial color="#ffd761" roughness={0.35} emissive="#ffc94a" emissiveIntensity={0.35} />
              </mesh>
            ))}
          </group>
        ))}

        {/* 两张小签贴在参考线内侧、两条线中间的空处：放在板子底边的话，左边那张会被结论卡盖住，右边那张会和小棍打架 */}
        <Tag position={[-XG + 0.36, 0, 0.14]} tone="dark" show={!!(flags & 1)}>{L('左边，齐', 'Left: level')}</Tag>
        <Tag position={[XG - 0.36, 0, 0.14]} tone="dark" show={!!(flags & 2)}>{L('右边，也齐', 'Right: level too')}</Tag>

        {/* 看不见的两块，访客点上半块或下半块；量完以后点哪里都是开合 */}
        {[0, 1].map((b) => (
          <mesh
            key={b}
            visible={false}
            position={[0, b ? -H / 4 : H / 4, 0.22]}
            onPointerOver={(e) => (e.stopPropagation(), (s.current.hover = b))}
            onPointerOut={() => s.current.hover === b && (s.current.hover = -1)}
            onClick={(e) => {
              e.stopPropagation()
              if (phase === 'ask') choose(b)
              else if (phase === 'done') {
                setFolded((v) => !v)
                s.current.touched = true
                say('')
              }
            }}
          >
            <planeGeometry args={[W, H / 2]} />
          </mesh>
        ))}
      </group>

      {/* 背牌子的人，和地上那个是同一个 */}
      <group position={[-0.16, 0, 0.92]}>
        <group ref={man} rotation={[0, Math.PI - 0.5, 0]} scale={0.95}>
          <Meeple color={C.teal}>
            {[0.17, -0.17].map((z) => (
              <group key={z} position={[0, 0.34, z]} rotation={[z > 0 ? -0.14 : 0.14, 0, 0]}>
                <mesh castShadow>
                  <boxGeometry args={[0.62, 0.62, 0.03]} />
                  <meshStandardMaterial color="#1f4a3c" roughness={0.92} emissive="#1f4a3c" emissiveIntensity={0.55} />
                </mesh>
                <mesh position={[0, 0, z > 0 ? 0.018 : -0.018]} rotation={[0, z > 0 ? 0 : Math.PI, 0]}>
                  <planeGeometry args={[0.6, 0.6]} />
                  <meshBasicMaterial map={tex.lines} transparent />
                </mesh>
              </group>
            ))}
            <group ref={stick} position={[-0.3, 0.42, 0.1]} rotation={[-0.5, 0.25, 0]}>
              <mesh position={[0, 0, 0.27]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                <cylinderGeometry args={[0.012, 0.016, 0.56, 8]} />
                <meshStandardMaterial map={tex.wood} roughness={0.8} />
              </mesh>
              <mesh position={[0, 0, 0.56]}>
                <sphereGeometry args={[0.03, 12, 10]} />
                <M color={C.red} rough={0.5} />
              </mesh>
            </group>
          </Meeple>
        </group>
      </group>
    </group>
  )
}
