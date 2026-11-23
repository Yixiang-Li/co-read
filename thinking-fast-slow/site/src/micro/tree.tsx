import { Html } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { bus } from '../bus'
import { L, useLang } from '../i18n'
import { backOut, C, M, Meeple, sm } from '../world/kit'
import { FINE } from '../world/tex'
import type { MicroProps } from './types'

// 红杉（锚定效应）。
// ask：先贴着树根看——树干粗得出了画面，量树的人仰着头。然后镜头拉远，他的标尺一节节立起来，
//      那个先听到的数字像一面旗插在标尺上，树顶藏在一朵云里。访客上下拖那朵云，猜树有多高。
// 慢：皮筋把访客的猜测和那面旗拴在一起；另一面旗插上来；两组人的平均猜测各自被自己的旗拽着。最后树回到真实的高度。

const U = 0.0034 // 一英尺在场景里多高
const TX = -0.5 // 树
const TZ = -0.3
const PX = 0.25 // 标尺
const PZ = -0.3
const Z0 = 8 // 一开始贴近树根的放大倍数（再大，树根就伸到岛外面的海上去了）
const SHIFT = 0.25 // 贴近的时候，树往岛中间挪这么多，两边的树根才都落在草地上
const REAL = 380
const AVG: Record<number, number> = { 1200: 844, 180: 282 }
const TIERS = 9
const NAVY = '#3b4d76' // 另一半人的旗：比色板里的 navy 灰一点，带了自发光之后才不会蓝得发艳
const lerp = THREE.MathUtils.lerp
const clamp = THREE.MathUtils.clamp
const ease = (t: number) => t * t * (3 - 2 * t)

// 这个世界里的东西都是竖着的，镜头又低，正对镜头的那一面背着台灯。
// 旗、箍、皮筋这些“读数”用的小件带一点自发光，在暗的背景前才看得清。
const Lit = ({ color, rough = 0.8, glow = 0.32 }: { color: string; rough?: number; glow?: number }) => (
  <meshStandardMaterial color={color} roughness={0.62 + 0.26 * rough} metalness={0} normalMap={FINE()} normalMap-repeat={[3, 3]} normalScale={[0.28, 0.28]} envMapIntensity={0.7} emissive={color} emissiveIntensity={glow} />
)

// 小纸签，但不是居中，而是一头对齐：at="r" 时纸签从这个点往右长，at="l" 时往左长。
// 中英文的字数差很多，居中的话英文的纸签会压到旗子或者云上。
function Label({ children, position, tone = 'light', show = true, at }: { children: React.ReactNode; position?: [number, number, number]; tone?: 'light' | 'dark' | 'red' | 'blue'; show?: boolean; at: 'l' | 'r' }) {
  return (
    <Html position={position} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div style={{ transform: at === 'r' ? 'translate(0, -50%)' : 'translate(-100%, -50%)' }}>
        <span className={`tag3d ${tone} ${show ? 'show' : ''}`}>{children}</span>
      </div>
    </Html>
  )
}

function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 红杉的树皮：一条条纵向的深沟和浅色的纤维。只画一次
function barkTex() {
  const W = 512
  const H = 1024
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const r = rng(3)
  g.fillStyle = '#9a5333'
  g.fillRect(0, 0, W, H)
  g.lineCap = 'round'
  const stroke = (x: number, y: number, len: number, w: number, col: string) => {
    g.strokeStyle = col
    g.lineWidth = w
    for (const ox of [-W, 0, W])
      for (const oy of [-H, 0]) {
        g.beginPath()
        let px = x + ox
        g.moveTo(px, y + oy)
        for (let s = 0; s < len; s += 34) {
          px += (r() - 0.5) * 9
          g.lineTo(px, y + oy + s + 34)
        }
        g.stroke()
      }
  }
  for (let i = 0; i < 70; i++) stroke(r() * W, r() * H, 260 + r() * 620, 7 + r() * 13, `rgba(74,32,18,${0.28 + r() * 0.3})`)
  for (let i = 0; i < 90; i++) stroke(r() * W, r() * H, 160 + r() * 520, 4 + r() * 9, `rgba(214,138,92,${0.18 + r() * 0.24})`)
  for (let i = 0; i < 520; i++) stroke(r() * W, r() * H, 40 + r() * 200, 1 + r() * 2, r() > 0.5 ? 'rgba(60,24,12,0.35)' : 'rgba(236,170,124,0.28)')
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}
// 标尺：红白相间，一节 100 英尺，一共 13 节
function poleTex() {
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 13 * 32
  const g = c.getContext('2d')!
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? C.red : C.white
    g.fillRect(0, i * 32, 8, 32)
    g.fillStyle = 'rgba(35,36,43,0.55)'
    g.fillRect(0, i * 32, 8, 2)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
// 一根皮筋：从 (x0,y0) 到 (x1,y1) 的一条弧形带子，朝一边鼓出去
const BSEG = 18
function bandGeo() {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((BSEG + 1) * 6), 3))
  const idx: number[] = []
  for (let i = 0; i < BSEG; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
  g.setIndex(idx)
  return g
}
function setBand(g: THREE.BufferGeometry, x0: number, y0: number, x1: number, y1: number, bulge: number, w: number, z: number) {
  const pos = g.attributes.position as THREE.BufferAttribute
  const cx = (x0 + x1) / 2 + bulge
  const cy = (y0 + y1) / 2
  for (let i = 0; i <= BSEG; i++) {
    const t = i / BSEG
    const x = (1 - t) * (1 - t) * x0 + 2 * t * (1 - t) * cx + t * t * x1
    const y = (1 - t) * (1 - t) * y0 + 2 * t * (1 - t) * cy + t * t * y1
    let dx = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx)
    let dy = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy)
    const l = Math.hypot(dx, dy) || 1
    dx /= l
    dy /= l
    pos.setXYZ(i * 2, x - dy * w, y + dx * w, z)
    pos.setXYZ(i * 2 + 1, x + dy * w, y - dx * w, z)
  }
  pos.needsUpdate = true
}

const sayHold = () => L('按住右下角的慢，看别人怎么猜', 'Hold Slow to see what others guessed')

export default function Tree({ c, phase, choose, say }: MicroProps) {
  const { camera, gl } = useThree()
  useLang()
  const anchor = Number(c.q.match(/\d+/)?.[0] ?? 1200) // 题目里的第一个数字就是这位访客分到的锚
  const other = anchor === 1200 ? 180 : 1200
  const tex = useMemo(() => {
    const bark = barkTex()
    const flare = bark.clone()
    flare.repeat.set(2, 0.16)
    return { bark, flare, pole: poleTex() }
  }, [])
  const geo = useMemo(() => {
    const shaft = new THREE.CylinderGeometry(0.012, 0.056, 1, 24, 1, true)
    shaft.translate(0, 0.5, 0)
    const flare = new THREE.LatheGeometry([new THREE.Vector2(0.112, 0), new THREE.Vector2(0.09, 0.012), new THREE.Vector2(0.07, 0.035), new THREE.Vector2(0.056, 0.07)], 24)
    const cone = new THREE.ConeGeometry(1, 1, 14, 1)
    cone.translate(0, 0.5, 0)
    const sh = new THREE.Shape()
    sh.moveTo(0, 0.1)
    sh.lineTo(0.4, 0.1)
    sh.lineTo(0.31, 0)
    sh.lineTo(0.4, -0.1)
    sh.lineTo(0, -0.1)
    const flag = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false })
    return { shaft, flare, cone, flag, bands: [bandGeo(), bandGeo(), bandGeo()] }
  }, [])
  const root = useRef<THREE.Group>(null)
  const zoom = useRef<THREE.Group>(null)
  const shaft = useRef<THREE.Mesh>(null)
  const leaves = useRef<THREE.InstancedMesh>(null)
  const man = useRef<THREE.Group>(null)
  const manLean = useRef<THREE.Group>(null)
  const cloud = useRef<THREE.Group>(null)
  const pole = useRef<THREE.Group>(null)
  const marker = useRef<THREE.Group>(null)
  const flagA = useRef<THREE.Group>(null)
  const flagB = useRef<THREE.Group>(null)
  const avgA = useRef<THREE.Group>(null)
  const avgB = useRef<THREE.Group>(null)
  const real = useRef<THREE.Group>(null)
  const bandM = useRef<(THREE.Mesh | null)[]>([])
  const tagG = useRef<THREE.Group>(null)
  const num = useRef<HTMLSpanElement>(null)
  const [ready, setReady] = useState(false) // 镜头拉远完了，可以拖了
  const [touched, setTouched] = useState(false)
  const [step, setStep] = useState(0)
  const [hot, setHot] = useState(false)
  const ph = useRef(phase)
  ph.current = phase
  const s = useRef({ t: 0, clock: 0, g: anchor, shown: anchor, h: -1, ready: false, drag: false, over: false, step: 0, hold: false, bp: -1, bg: -1 })
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), c: new THREE.Color(), v: new THREE.Vector3(), ndc: new THREE.Vector2(), ray: new THREE.Raycaster(), plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), greens: [new THREE.Color('#3d7353'), new THREE.Color('#4b8561'), new THREE.Color('#34664b')] }), [])
  const off = useRef<(() => void) | null>(null)

  useEffect(() => {
    const a = s.current
    if (phase === 'ask') {
      Object.assign(a, { t: 0, g: anchor, shown: anchor, ready: false, drag: false, step: 0 })
      setReady(false)
      setTouched(false)
      setStep(0)
      say(L(`最高的那棵红杉，有 ${anchor} 英尺高吗？`, `Is the tallest redwood over ${anchor} feet?`))
    } else if (phase === 'picked') say(sayHold())
    else say('')
  }, [phase, say, anchor])
  useEffect(() => () => off.current?.(), [])

  // 拖：抓住云（或者直接按在标尺上），上下移动
  const down = (jump: boolean) => (e: ThreeEvent<PointerEvent>) => {
    const a = s.current
    if (ph.current !== 'ask' || !a.ready || a.drag || !root.current) return
    e.stopPropagation()
    a.drag = true
    setHot(true)
    setTouched(true)
    tmp.plane.constant = -root.current.localToWorld(tmp.v.set(0, 0, PZ)).z
    const yAt = (ev: { clientX: number; clientY: number }) => {
      const r = gl.domElement.getBoundingClientRect()
      tmp.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      tmp.ray.setFromCamera(tmp.ndc, camera)
      if (!tmp.ray.ray.intersectPlane(tmp.plane, tmp.v) || !root.current) return null
      return root.current.worldToLocal(tmp.v).y
    }
    const y0 = yAt(e.nativeEvent) ?? a.g * U
    const offY = jump ? 0 : a.g * U - y0
    const set = (y: number | null) => y !== null && (a.g = clamp(Math.round((y + offY) / U / 10) * 10, 60, 1290))
    if (jump) set(y0)
    const move = (ev: PointerEvent) => set(yAt(ev))
    const up = () => {
      off.current?.()
      a.drag = false
      setHot(false)
      if (ph.current === 'ask') choose(clamp(Math.round(a.g / 200) - 1, 0, 3))
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
    const dt = Math.min(0.05, raw) * (1 - 0.93 * bus.t)
    a.clock += dt
    const p = ph.current === 'done' ? 1 : ph.current === 'picked' ? bus.p : 0
    if (bus.micro.k > 0.85) a.t += dt
    if (ph.current !== 'ask') a.t = Math.max(a.t, 9)

    // 镜头感：先贴着树根，再拉远
    const Z = a.t < 1.9 ? Z0 : Math.exp(Math.log(Z0) * (1 - ease(clamp((a.t - 1.9) / 1.9, 0, 1))))
    const near = sm(2.5, Z0, Z)
    const grow = backOut(clamp((a.t - 3.0) / 0.9, 0, 1))
    const popA = backOut(clamp((a.t - 3.7) / 0.4, 0, 1))
    const appear = backOut(clamp((a.t - 3.9) / 0.45, 0, 1))
    if (!a.ready && a.t > 4.2 && ph.current === 'ask') {
      a.ready = true
      setReady(true)
      say(L('那你猜它有多高？上下拖那朵云', 'How tall, then? Drag the cloud up or down'))
    }
    const hold = ph.current === 'picked' && bus.p > 0.03
    if (hold !== a.hold) {
      a.hold = hold
      if (ph.current === 'picked') say(hold ? '' : sayHold())
    }
    const st = p < 0.03 ? 0 : p < 0.21 ? 1 : p < 0.66 ? 2 : p < 0.84 ? 3 : p < 0.93 ? 4 : 5
    if (st !== a.step) setStep((a.step = st))

    // 树：高度先跟着访客的猜测，最后回到真实的 380
    a.shown += (a.g - a.shown) * (1 - Math.exp(-Math.min(0.05, raw) * 18))
    const gy = a.shown * U
    const h = lerp(gy, REAL * U, ease(sm(0.86, 1, p)))
    if (zoom.current) {
      zoom.current.scale.setScalar(Z)
      zoom.current.position.x = TX + SHIFT * near
    }
    if (Math.abs(h - a.h) > 0.0005) {
      a.h = h
      if (shaft.current) shaft.current.scale.y = Math.max(0.05, h - 0.07)
      tex.bark.repeat.set(2, Math.max(0.3, h * 2.2))
      const o = tmp.o
      const wide = clamp(0.55 + (0.45 * h) / 1.3, 0.62, 1.2)
      // 最上面一层的尖正好到 h（再多出 0.04 藏进云里）。原来尖会比 h 高出一成多，从云上面戳出来
      const gap = (h * 0.6 + 0.04) / (TIERS - 1 + 2.3)
      for (let i = 0; i < TIERS; i++) {
        const f = i / (TIERS - 1)
        o.position.set(0, h * 0.4 + gap * i, 0)
        o.rotation.set(0, i * 1.3, 0)
        o.scale.set(lerp(0.2, 0.07, f) * wide, Math.max(0.03, gap * 2.3), lerp(0.2, 0.07, f) * wide)
        o.updateMatrix()
        leaves.current?.setMatrixAt(i, o.matrix)
        leaves.current?.setColorAt(i, tmp.greens[i % 3])
      }
      if (leaves.current) {
        leaves.current.instanceMatrix.needsUpdate = true
        if (leaves.current.instanceColor) leaves.current.instanceColor.needsUpdate = true
      }
    }
    // 量树的人：贴近时仰头看，拉远后变成树脚下的一个小点
    if (man.current) man.current.scale.setScalar(0.26 * Math.pow(Z, -0.38))
    if (manLean.current) {
      manLean.current.rotation.x = -0.26 * near + Math.sin(a.clock * 1.3) * 0.03
      manLean.current.rotation.y = -0.5 + Math.sin(a.clock * 0.7) * 0.12
    }

    // 标尺、旗、云
    if (pole.current) {
      pole.current.visible = grow > 0.01
      pole.current.scale.set(1, Math.max(0.001, grow), 1)
    }
    const ya = anchor * U
    const yb = other * U
    if (flagA.current) {
      flagA.current.visible = popA > 0.01
      flagA.current.position.y = ya
      flagA.current.scale.setScalar(Math.max(0.001, popA) * (1 + sm(0.03, 0.12, p) * (1 - sm(0.14, 0.21, p)) * 0.25))
    }
    const popB = backOut(sm(0.21, 0.3, p))
    if (flagB.current) {
      flagB.current.visible = popB > 0.01
      flagB.current.position.y = yb
      flagB.current.scale.setScalar(Math.max(0.001, popB))
    }
    if (cloud.current) {
      cloud.current.visible = appear > 0.01
      cloud.current.position.set(TX, gy + 0.07 + Math.sin(a.clock * 1.6) * 0.012 + (a.over && !a.drag && ph.current === 'ask' ? 0.03 : 0), TZ + 0.06)
      cloud.current.scale.setScalar(Math.max(0.001, appear) * 0.36 * (a.drag ? 1.12 : 1) * lerp(1, 0.72, sm(0.86, 1, p)))
    }
    if (marker.current) {
      marker.current.visible = appear > 0.01
      marker.current.position.y = gy
      marker.current.scale.set(Math.max(0.001, appear), 1, 1)
    }
    tagG.current?.position.set(TX - 0.36, gy + 0.07 + (p > 0.86 && Math.abs(a.g - REAL) < 80 ? (a.g >= REAL ? 0.3 : -0.3) * sm(0.86, 0.95, p) : 0), TZ)
    if (num.current && num.current.dataset.v !== String(a.g)) {
      num.current.dataset.v = String(a.g)
      num.current.textContent = String(a.g)
    }

    // 两组人的平均猜测：从各自的旗那里出发，没走多远就停下
    const sa = ease(sm(0.44, 0.66, p))
    const sb = ease(sm(0.62, 0.84, p))
    const y1 = lerp(ya, AVG[anchor] * U, sa)
    const y2 = lerp(yb, AVG[other] * U, sb)
    if (avgA.current) {
      avgA.current.visible = p > 0.42
      avgA.current.position.y = y1
    }
    if (avgB.current) {
      avgB.current.visible = p > 0.6
      avgB.current.position.y = y2
    }
    const rs = backOut(sm(0.86, 0.95, p))
    if (real.current) {
      real.current.visible = rs > 0.01
      real.current.scale.set(Math.max(0.001, rs), 1, 1)
    }
    // 三根皮筋。参数没变就不重算
    if (p !== a.bp || Math.abs(gy - a.bg) > 0.0005) {
      a.bp = p
      a.bg = gy
      const d0 = sm(0.03, 0.2, p)
      setBand(geo.bands[0], PX, ya, PX, lerp(ya, gy, d0), -0.2 - Math.abs(gy - ya) * 0.03, 0.016, PZ + 0.05)
      setBand(geo.bands[1], PX + 0.04, ya, PX + 0.04, y1, 0.3, 0.014, PZ + 0.05)
      setBand(geo.bands[2], PX + 0.04, yb, PX + 0.04, y2, 0.3, 0.014, PZ + 0.05)
      const [b0, b1, b2] = bandM.current
      if (b0) b0.visible = p > 0.03 && Math.abs(gy - ya) > 0.02
      if (b1) b1.visible = p > 0.44
      if (b2) b2.visible = p > 0.62
    }
  })

  const asking = phase === 'ask'
  const fy = anchor * U
  return (
    <group ref={root}>
      {/* 树和量树的人：整组会放大缩小，像镜头推近拉远 */}
      <group ref={zoom} position={[TX + SHIFT, 0, TZ]} scale={Z0}>
        <mesh geometry={geo.flare} castShadow>
          <meshStandardMaterial map={tex.flare} bumpMap={tex.flare} bumpScale={1.5} roughness={0.95} emissive="#ffffff" emissiveMap={tex.flare} emissiveIntensity={0.16} />
        </mesh>
        <mesh ref={shaft} geometry={geo.shaft} position={[0, 0.07, 0]} castShadow>
          <meshStandardMaterial map={tex.bark} bumpMap={tex.bark} bumpScale={1.5} roughness={0.95} emissive="#ffffff" emissiveMap={tex.bark} emissiveIntensity={0.16} />
        </mesh>
        {/* 树根：几块拱出地面的圆疙瘩 */}
        {[0.3, 1.5, 2.6, 3.7, 4.9, 5.6].map((ang, i) => (
          <mesh key={i} position={[Math.cos(ang) * 0.1, 0.008, Math.sin(ang) * 0.1]} rotation={[0, -ang, 0]} scale={[0.05 + (i % 2) * 0.012, 0.024, 0.026]} castShadow>
            <sphereGeometry args={[1, 14, 10]} />
            <meshStandardMaterial map={tex.flare} roughness={0.95} emissive="#ffffff" emissiveMap={tex.flare} emissiveIntensity={0.16} />
          </mesh>
        ))}
        {/* 树脚下的蕨和石头 */}
        {/* 贴近时整组放大 Z0 倍，所以它们离树心不能远，否则会伸到岛外面去 */}
        {[[0.17, 0.03, 0.02], [0.045, 0.165, 0.014], [-0.02, 0.168, 0.018], [0.155, -0.065, 0.015]].map(([x, z, r], i) => (
          <group key={i} position={[x, 0, z]}>
            {[0, 1, 2, 3, 4].map((k) => (
              <mesh key={k} rotation={[0, k * 1.26, 0.9]} position={[Math.cos(k * 1.26) * r * 0.5, r * 0.5, -Math.sin(k * 1.26) * r * 0.5]} scale={[r * 0.28, r * 1.5, r * 0.6]}>
                <sphereGeometry args={[1, 8, 6]} />
                <M color={i % 2 ? C.g3 : C.g1} />
              </mesh>
            ))}
          </group>
        ))}
        {[[0.095, 0.165, 0.018]].map(([x, z, r], i) => (
          <mesh key={i} position={[x, r * 0.5, z]} scale={[r * 1.3, r * 0.8, r]} castShadow>
            <sphereGeometry args={[1, 12, 8]} />
            <M color="#b9b3a4" rough={1} />
          </mesh>
        ))}
        <instancedMesh ref={leaves} args={[geo.cone, undefined, TIERS]} castShadow frustumCulled={false}>
          <meshStandardMaterial roughness={0.95} emissive="#3d7353" emissiveIntensity={0.3} />
        </instancedMesh>
        {/* 量红杉的人：和书页上那个拿着红白标杆的是同一个 */}
        <group ref={man} position={[0.15, 0, 0.13]}>
          <group ref={manLean}>
            <Meeple color="#7a5c3e">
              <group position={[0.2, 0, 0.05]}>
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <mesh key={n} position={[0, 0.16 + n * 0.32, 0]} castShadow>
                    <cylinderGeometry args={[0.028, 0.028, 0.32, 8]} />
                    <M color={n % 2 ? C.white : C.red} />
                  </mesh>
                ))}
              </group>
            </Meeple>
          </group>
        </group>
      </group>

      {/* 标尺：他那根标杆的放大版，一节 100 英尺 */}
      <group ref={pole} position={[PX, 0, PZ]} visible={false}>
        <mesh position={[0, 6.5 * 100 * U, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 13 * 100 * U, 14]} />
          <meshStandardMaterial map={tex.pole} roughness={0.8} />
        </mesh>
        <mesh position={[0, 13 * 100 * U + 0.02, 0]}>
          <sphereGeometry args={[0.045, 14, 10]} />
          <M color={C.gold} rough={0.5} />
        </mesh>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.07, 0.09, 0.04, 16]} />
          <M color={C.trunk} />
        </mesh>
      </group>
      <mesh position={[PX, 2.2, PZ]} onPointerDown={down(true)} visible={ready}>
        <cylinderGeometry args={[0.13, 0.13, 4.4, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* 先听到的那个数字：一面旗 */}
      <group ref={flagA} position={[PX, fy, PZ]} visible={false}>
        <mesh geometry={geo.flag} position={[0.03, 0, -0.01]} castShadow>
          <Lit color={C.red} />
        </mesh>
        <Label at="r" position={[0.5, 0, 0]} tone="red" show={ready && step === 0}>
          <span className="tg16">{L(`${anchor} 英尺？`, `${anchor} feet?`)}</span>
        </Label>
        <Label at="r" position={[0.5, 0, 0]} tone="red" show={step >= 1}>
          <span className="tg16">{L(`你先听到 ${anchor}`, `You heard ${anchor}`)}</span>
        </Label>
      </group>
      <group ref={flagB} position={[PX, other * U, PZ]} visible={false}>
        <mesh geometry={geo.flag} position={[0.03, 0, -0.01]} castShadow>
          <Lit color={NAVY} glow={0.24} />
        </mesh>
        <Label at="r" position={[0.5, 0, 0]} tone="dark" show={step >= 2}>
          <span className="tg16">{L(`另一半人听到 ${other}`, `Others heard ${other}`)}</span>
        </Label>
      </group>
      {[avgA, avgB].map((ref, i) => (
        <group key={i} ref={ref} position={[PX, 0, PZ]} visible={false}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.05, 0.02, 10, 20]} />
            <Lit color={i ? NAVY : C.red} glow={i ? 0.24 : 0.32} />
          </mesh>
          <mesh position={[0.13, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <coneGeometry args={[0.045, 0.12, 12]} />
            <Lit color={i ? NAVY : C.red} glow={i ? 0.24 : 0.32} />
          </mesh>
          <Label at="r" position={[0.27, 0, 0]} tone="light" show={step >= (i ? 4 : 3)}>
            <span className="tg16">{L(`平均猜 ${AVG[i ? other : anchor]}`, `avg. guess ${AVG[i ? other : anchor]}`)}</span>
          </Label>
        </group>
      ))}
      {geo.bands.map((g, i) => (
        <mesh key={i} ref={(el) => void (bandM.current[i] = el)} geometry={g} visible={false} frustumCulled={false}>
          <meshStandardMaterial color={i === 2 ? NAVY : C.red} emissive={i === 2 ? NAVY : C.red} emissiveIntensity={i === 2 ? 0.24 : 0.32} roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* 访客的猜测：标尺上的一个箍，伸出一根杆指着树顶的云 */}
      <group ref={marker} position={[PX, fy, PZ]} visible={false}>
        <mesh>
          <cylinderGeometry args={[0.052, 0.052, 0.07, 16]} />
          <Lit color={C.blue} glow={0.28} />
        </mesh>
        <mesh position={[(TX - PX) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.011, 0.011, PX - TX, 8]} />
          <Lit color={C.blue} glow={0.28} />
        </mesh>
        <mesh position={[(TX - PX) / 2, 0, 0.1]} onPointerDown={down(false)}>
          <boxGeometry args={[PX - TX, 0.26, 0.2]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <group ref={cloud} position={[TX, fy, TZ]} visible={false}>
        {([[0, 0, 0, 0.5], [0.42, -0.04, 0.05, 0.36], [-0.4, -0.05, 0.08, 0.38], [0.08, 0.26, -0.04, 0.36], [-0.14, 0.02, 0.3, 0.3]] as const).map(([x, y, z, r], i) => (
          <mesh key={i} position={[x, y, z]} castShadow={i === 0}>
            <sphereGeometry args={[r, 18, 14]} />
            <meshStandardMaterial color={C.white} roughness={1} emissive={C.white} emissiveIntensity={0.22} />
          </mesh>
        ))}
        <mesh onPointerDown={down(false)} onPointerOver={() => (s.current.over = true)} onPointerOut={() => (s.current.over = false)}>
          <sphereGeometry args={[1.0, 10, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <group ref={tagG} position={[TX - 0.36, fy, TZ]}>
        <Label at="l" tone="dark" show={ready && !touched && asking}>
          <span className="tg17">？</span>
        </Label>
        <Label at="l" tone={hot ? 'blue' : 'light'} show={touched}>
          <span className="tg16">
            {L('你猜', 'Your guess:')} <span ref={num}>{anchor}</span>
          </span>
        </Label>
      </group>

      {/* 真实的高度 */}
      <group ref={real} position={[PX, REAL * U, PZ]} visible={false}>
        <mesh>
          <cylinderGeometry args={[0.056, 0.056, 0.05, 16]} />
          <Lit color={C.gold} />
        </mesh>
        <mesh position={[(TX - PX) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.012, PX - TX, 8]} />
          <Lit color={C.gold} />
        </mesh>
        <Label at="l" position={[TX - PX - 0.36, 0, 0]} tone="dark" show={step >= 5}>
          <span className="tg16">{L(`真实约 ${REAL}`, `Actual: ~${REAL}`)}</span>
        </Label>
      </group>
    </group>
  )
}
