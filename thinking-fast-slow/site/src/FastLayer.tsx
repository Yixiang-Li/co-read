import { useFrame } from '@react-three/fiber'
import { forwardRef, Suspense, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import * as THREE from 'three'
import { bus, R_FAST } from './bus'
import { sfx } from './sound'
import { buildHare } from './world/chars'
import { HARE_SPOT, ISLE_TOP, MICRO_SCALE, SLOW_POS } from './scenes'
import { shoreAt } from './world/Sea'
import { sm } from './world/kit'
import { grainAt } from './world/tex'

export type FastApi = { say: (s: string, ms?: number) => void; mood: (m: 'ok' | 'sulk' | 'proud') => void }

// 快：系统 1。一只跟着你跑的兔子，它就是你的光标。兔子本身在主场景里（见 World），这里是它说话的气泡。
const FastLayer = forwardRef<FastApi>(function FastLayer(_, ref) {
  const bubble = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const timer = useRef(0)
  useImperativeHandle(ref, () => ({
    say(s, ms = 1900) {
      setText(s)
      window.clearTimeout(timer.current)
      const el = bubble.current?.firstElementChild
      if (el) gsap.fromTo(el, { scale: 0, rotate: -14, opacity: 1 }, { scale: 1, rotate: -5, duration: 0.42, ease: 'elastic.out(1.1,0.5)' })
      timer.current = window.setTimeout(() => el && gsap.to(el, { scale: 0, opacity: 0, duration: 0.18, ease: 'power2.in' }), ms)
    },
    mood(m) {
      bus.mood = m
      if (m !== 'ok') window.setTimeout(() => (bus.mood = 'ok'), 3200)
    },
  }))
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const b = bubble.current
      if (b) {
        // 兔子在画面边上时，气泡往里收，别被屏幕边切掉
        const w = (b.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0
        const x = Math.min(Math.max(bus.sx, -4), innerWidth - w - 22)
        const y = Math.max(bus.sy, 64)
        b.style.transform = `translate3d(${x}px,${y}px,0)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div ref={bubble} className="fast-say-wrap" aria-hidden="true">
      <div className="fast-say">{text}</div>
    </div>
  )
})
export default FastLayer

export function Hare() {
  const g = useRef<THREE.Group>(null)
  const tilt = useRef<THREE.Group>(null)
  const ears = useRef<(THREE.Object3D | null)[]>([])
  const tub = useRef<THREE.Group>(null)
  const rings = useRef<THREE.Group>(null)
  const s = useRef({ nx: 0, ny: 0.2, vx: 0, vz: 0, hot: 1, hotT: 1, pop: 1, popV: 0, head: 0, dist: 0, idle: 0, gy: 0, wet: 0 })
  const tmp = useMemo(() => ({ ray: new THREE.Raycaster(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit: new THREE.Vector3(), v: new THREE.Vector3(), v2: new THREE.Vector2() }), [])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if ((e.target as HTMLElement).tagName !== 'CANVAS') return // 指针在界面上时，兔子留在原地
      s.current.nx = (e.clientX / innerWidth) * 2 - 1
      s.current.ny = -(e.clientY / innerHeight) * 2 + 1
    }
    const down = (e: PointerEvent) => {
      move(e)
      s.current.pop = 0.7
      sfx.pop()
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerdown', down, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', down)
    }
  }, [])

  useFrame((st, rawDt) => {
    const a = s.current
    const cam = st.camera
    const dt = Math.min(2.5, rawDt * 60)
    tmp.plane.constant = -a.gy // 指针落在兔子脚下那个高度的平面上
    tmp.ray.setFromCamera(tmp.v2.set(a.nx, a.ny), cam)
    if (!tmp.ray.ray.intersectPlane(tmp.plane, tmp.hit)) return
    const I = bus.intro
    if (I.on) tmp.hit.set(SLOW_POS[0] + HARE_SPOT[0], 0, SLOW_POS[1] + HARE_SPOT[1])
    I.perk *= Math.exp(-rawDt * 2.6)
    const t = bus.t
    const k = 0.16 * (1 - t) + 0.014 * t
    const d = 0.6 * (1 - t) + 0.9 * t
    a.vx = (a.vx + (tmp.hit.x - bus.fx) * k * dt) * Math.pow(d, dt)
    a.vz = (a.vz + (tmp.hit.z - bus.fz) * k * dt) * Math.pow(d, dt)
    let x = bus.fx + a.vx * dt
    let z = bus.fz + a.vz * dt
    const sp = Math.hypot(a.vx, a.vz)
    // 撞到地上的东西：自己被挡住，东西被撞得晃一下
    const hitOne = (id: string, ox: number, oz: number, r: number) => {
      const dx = x - ox
      const dz = z - oz
      const dist = Math.hypot(dx, dz)
      const min = r + R_FAST
      if (dist < min && dist > 0.0001) {
        x = ox + (dx / dist) * min
        z = oz + (dz / dist) * min
        const w = (bus.wob[id] ??= { x: 0, z: 0, vx: 0, vz: 0 })
        const push = Math.min(0.5, sp) * 9
        w.vx -= (dx / dist) * push
        w.vz -= (dz / dist) * push
      }
    }
    if (bus.micro.k < 0.2) for (const id in bus.pos) hitOne(id, bus.pos[id].x, bus.pos[id].z, bus.pos[id].r)
    hitOne('slow', bus.slowPos.x, bus.slowPos.z, 1.12 - 0.62 * bus.micro.k)
    const moved = Math.hypot(x - bus.fx, z - bus.fz)
    bus.fx = x
    bus.fz = z
    bus.fv = sp
    a.dist += moved
    a.idle = sp < 0.004 ? a.idle + rawDt : 0
    if (I.on && sp < 0.02) a.head += Math.atan2(Math.sin(0.5 - a.head), Math.cos(0.5 - a.head)) * Math.min(1, 0.12 * dt) // 开场：站定后转过来对着镜头，稍微偏向乌龟
    else if (sp > 0.006) {
      const want = Math.atan2(a.vx, a.vz)
      a.head += Math.atan2(Math.sin(want - a.head), Math.cos(want - a.head)) * Math.min(1, 0.3 * dt)
    }
    a.popV += ((1 - a.pop) * 0.3 - a.popV * 0.28) * dt
    a.pop += a.popV * dt
    a.hot += (a.hotT - a.hot) * 0.25
    // 脚下是水还是岛：在水上就坐进一只小木盆里漂着，上了岸再跳出来跑
    const sh = shoreAt(x, z)
    const wetT = sh > 0.015 ? 1 : 0
    a.wet += (wetT - a.wet) * Math.min(1, 0.2 * dt)
    const land = ISLE_TOP * sm(0, 0.26, -sh)
    const tt = st.clock.elapsedTime
    const bob = Math.sin(tt * 2.1) * 0.012 * a.wet
    a.gy += (land - a.gy) * Math.min(1, 0.3 * dt)
    const run = Math.min(1, sp * 14)
    const hop = Math.abs(Math.sin(a.dist * 4.2)) * 0.2 * run * (1 - a.wet) + (bus.mood === 'proud' ? Math.abs(Math.sin(tt * 11)) * 0.35 : 0) + I.perk * Math.abs(Math.sin(tt * 13)) * 0.22
    const scale = a.pop * a.hot * (bus.mood === 'sulk' ? 0.8 : 1) * (bus.open > 0.985 ? 1 : 0.0001) * (1 - (1 - 0.5 * MICRO_SCALE) * bus.micro.k) * 1.12
    if (g.current) {
      g.current.position.set(x, a.gy + bob + 0.035 * a.wet * scale + hop, z)
      g.current.rotation.y = a.head
      g.current.scale.setScalar(scale)
    }
    if (tilt.current) {
      tilt.current.rotation.x = -Math.cos(a.dist * 4.2) * 0.22 * run * (1 - a.wet) + (a.idle > 0.6 ? -0.5 * Math.min(1, (a.idle - 0.6) * 3) * (1 - a.wet) : 0) + Math.sin(tt * 1.7) * 0.05 * a.wet - run * 0.12 * a.wet
      tilt.current.rotation.z = Math.sin(tt * 1.3 + 1) * 0.06 * a.wet
    }
    if (tub.current) {
      tub.current.visible = a.wet > 0.02
      tub.current.scale.setScalar(Math.max(0.001, a.wet))
    }
    if (rings.current) {
      rings.current.visible = a.wet > 0.5 && scale > 0.01
      rings.current.position.set(x, 0.012, z)
      rings.current.children.forEach((m, i) => {
        const u = (tt * 0.45 + i / 2) % 1
        m.scale.setScalar(scale * (0.3 + u * 0.55))
        ;((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.38 * (1 - u) * a.wet
      })
    }
    ears.current.forEach((e, i) => {
      if (!e) return
      const twitch = a.idle > 1 ? Math.max(0, Math.sin(tt * 2.2 + i * 2)) ** 12 * 0.5 : 0
      // 模型里耳朵朝上；往后倒是绕 x 轴正方向转
      e.rotation.x = 0.08 + run * 0.95 * (1 - 0.4 * a.wet) + (bus.mood === 'sulk' ? 1.2 : 0) - twitch
      e.rotation.z = (i ? 1 : -1) * (0.05 + (bus.mood === 'sulk' ? 0.45 : 0))
    })
    tmp.v.set(x, a.gy + 0.8 * scale + hop, z).project(cam)
    bus.sx = (tmp.v.x * 0.5 + 0.5) * innerWidth
    bus.sy = (-tmp.v.y * 0.5 + 0.5) * innerHeight
  })

  return (
    <>
      <group ref={g}>
        <group ref={tilt}>
          <Suspense fallback={null}>
            <HareModel ears={ears} />
          </Suspense>
          <group ref={tub} visible={false}>
            <Tub />
          </group>
        </group>
      </group>
      <group ref={rings} visible={false}>
        {[0, 1].map((i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.9, 1, 40]} />
            <meshBasicMaterial color="#e9fff6" transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </>
  )
}

// 兔子过海坐的小木盆
const TUB_GEO = new THREE.LatheGeometry(
  ([[0, 0], [0.2, 0], [0.265, 0.03], [0.3, 0.13], [0.312, 0.21], [0.292, 0.215], [0.27, 0.1], [0.22, 0.045], [0, 0.04]] as const).map(([x, y]) => new THREE.Vector2(x, y)),
  28,
)
const HOOP_GEO = new THREE.TorusGeometry(1, 0.012, 6, 28)
function Tub() {
  const grain = useMemo(() => grainAt(6, 2, true), [])
  return (
    <group position={[0, -0.035, 0.02]}>
      <mesh geometry={TUB_GEO} castShadow receiveShadow>
        <meshStandardMaterial color="#b9743e" roughness={0.7} normalMap={grain} normalScale={[0.5, 0.5]} side={THREE.DoubleSide} />
      </mesh>
      {[[0.288, 0.075], [0.308, 0.17]].map(([r, y]) => (
        <mesh key={y} geometry={HOOP_GEO} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[r, r, 1]}>
          <meshStandardMaterial color="#5c3a22" roughness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

// 代码捏的兔子（形状见 world/chars.ts）。两只耳朵是单独的节点，跑起来往后倒，站定了偶尔抖一下。
function HareModel({ ears }: { ears: React.RefObject<(THREE.Object3D | null)[]> }) {
  const obj = useMemo(() => buildHare(), [])
  useEffect(() => {
    ears.current[0] = obj.getObjectByName('earL') ?? null
    ears.current[1] = obj.getObjectByName('earR') ?? null
  }, [obj, ears])
  return <primitive object={obj} />
}
