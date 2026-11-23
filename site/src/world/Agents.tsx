import { Html, RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { bus } from '../bus'
import { paintLines } from '../paint'
import { ISLE_TOP, type Scene } from '../scenes'
import { backOut, C, M, Meeple, sm, TD, TW } from './kit'
import { glowTex } from './tex'

const KIN: Record<string, { v: number; rad: number; h: number }> = {
  lines: { v: 0.5, rad: 1.2, h: 1.0 },
  vinyl: { v: 0.85, rad: 1.7, h: 0.95 },
  tree: { v: 0.5, rad: 0.9, h: 2.05 },
  helmet: { v: 1.6, rad: 0.75, h: 0.95 },
  paddle: { v: 0.95, rad: 1.3, h: 0.95 },
  pawn: { v: 0.42, rad: 1.2, h: 1.15 },
  rose: { v: 0.42, rad: 0.8, h: 0.95 },
  coin: { v: 1.25, rad: 1.6, h: 0.85 },
  folder: { v: 0.6, rad: 1.25, h: 1.2 },
}

// 地上的一样东西：有的站着不动，有的自己到处走。被快撞到会晃一下。
export function Agent({ c, i, solved, canPick, onPick }: { c: Scene; i: number; solved: boolean; canPick: boolean; onPick: () => void }) {
  const g = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Group>(null)
  const k = KIN[c.id]
  const halo = useRef<THREE.Mesh>(null)
  const s = useRef({ x: c.pos[0], z: c.pos[1], tx: c.pos[0], tz: c.pos[1], wait: 0.5 + i * 0.3, head: i, moving: 0, dist: 0, hov: 0 })
  useFrame((_, rawDt) => {
    if (!g.current || !inner.current) return
    const a = s.current
    const dt = Math.min(0.05, rawDt) * (1 - 0.93 * bus.t)
    a.moving = 0
    if (k.v > 0 && !bus.micro.id && bus.open > 0.99) {
      if (a.wait > 0) a.wait -= dt
      else {
        const dx = a.tx - a.x
        const dz = a.tz - a.z
        const d = Math.hypot(dx, dz)
        if (d < 0.06) {
          a.wait = c.id === 'coin' ? 0.05 : 0.4 + Math.random() * 1.5
          const ang = Math.random() * Math.PI * 2
          const rr = Math.sqrt(Math.random()) * Math.min(k.rad, 0.5)
          a.tx = THREE.MathUtils.clamp(c.pos[0] + Math.cos(ang) * rr, -TW / 2 + 0.9, TW / 2 - 0.9)
          a.tz = THREE.MathUtils.clamp(c.pos[1] + Math.sin(ang) * rr, -TD / 2 + 0.9, TD / 2 - 0.9)
        } else {
          const step = Math.min(d, k.v * dt)
          a.x += (dx / d) * step
          a.z += (dz / d) * step
          a.dist += step
          a.moving = 1
          const want = Math.atan2(dx, dz)
          a.head += Math.atan2(Math.sin(want - a.head), Math.cos(want - a.head)) * Math.min(1, dt * 8)
        }
      }
    }
    const w = (bus.wob[c.id] ??= { x: 0, z: 0, vx: 0, vz: 0 })
    w.vx += (-w.x * 90 - w.vx * 7) * rawDt
    w.vz += (-w.z * 90 - w.vz * 7) * rawDt
    w.x += w.vx * rawDt
    w.z += w.vz * rawDt
    bus.pos[c.id] = { x: a.x, z: a.z, h: k.h, r: c.r }
    const hop = a.moving && c.id !== 'coin' ? Math.abs(Math.sin(a.dist * 9)) * 0.07 : 0
    g.current.position.set(a.x + w.x * 0.2, ISLE_TOP + hop, a.z + w.z * 0.2)
    // 指针指到它：整个人鼓起来一点，脚下亮一圈暖光
    a.hov += ((bus.hover === c.id && canPick ? 1 : 0) - a.hov) * Math.min(1, rawDt * 10)
    g.current.scale.setScalar(Math.max(0.0001, backOut((bus.open - 0.8 - i * 0.014) / 0.2) * (1 - sm(0, 0.45, bus.micro.k)) * (1 + 0.12 * a.hov)))
    if (halo.current) (halo.current.material as THREE.MeshBasicMaterial).opacity = 0.75 * a.hov
    inner.current.rotation.set(w.z * 0.5, k.v > 0 ? a.head : 0, -w.x * 0.5)
    inner.current.userData.dist = a.dist
  })
  return (
    <group
      ref={g}
      onPointerOver={(e) => (e.stopPropagation(), (bus.hover = c.id))}
      onPointerOut={() => bus.hover === c.id && (bus.hover = null)}
      onClick={(e) => {
        e.stopPropagation()
        if (canPick) onPick()
      }}
    >
      <group ref={inner}>
        <Model id={c.id} />
      </group>
      <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.85, 24]} />
        <meshBasicMaterial map={glowTex()} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, k.h / 2, 0]}>
        {/* 看不见的点击范围：比东西本身大一圈，差不多是半座岛，手指也点得中 */}
        <cylinderGeometry args={[0.8, 0.8, k.h, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html center position={[0, k.h + 0.45, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <span className={`flag ${solved ? 'show' : ''}`}>{c.concept}</span>
      </Html>
    </group>
  )
}

function Model({ id }: { id: string }) {
  const coin = useRef<THREE.Group>(null)
  const ball = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Mesh>(null)
  const rings = useRef<THREE.Group>(null)
  const lines = useMemo(() => (id === 'lines' ? paintLines() : null), [id])
  useFrame((st) => {
    const t = st.clock.elapsedTime
    const d = (coin.current?.parent?.userData.dist as number) ?? 0
    if (coin.current) coin.current.rotation.x = d / 0.36
    if (ball.current) ball.current.position.y = 0.12 + Math.abs(Math.sin(t * 5 * (1 - 0.9 * bus.t))) * 0.5
    if (halo.current) halo.current.position.y = 1.0 + Math.sin(t * 2) * 0.03
    rings.current?.children.forEach((m, i) => {
      const u = (t * 0.55 * (0.15 + 0.85 * (1 - bus.t)) + i / 3) % 1
      m.scale.setScalar(0.3 + u * 1.5)
      ;((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - u)
    })
  })
  switch (id) {
    case 'lines':
      return (
        <Meeple color="#2f6f73">
          {[0.17, -0.17].map((z) => (
            <group key={z} position={[0, 0.34, z]} rotation={[z > 0 ? -0.14 : 0.14, 0, 0]}>
              <RoundedBox args={[0.6, 0.6, 0.03]} radius={0.008} smoothness={2} castShadow>
                <M color="#24503f" />
              </RoundedBox>
              {[[0, 0.31, 0.66, 0.045], [0, -0.31, 0.66, 0.045], [0.31, 0, 0.045, 0.66], [-0.31, 0, 0.045, 0.66]].map(([x, y, w, h], n) => (
                <RoundedBox key={n} args={[w, h, 0.05]} radius={0.012} smoothness={2} position={[x, y, 0]} castShadow>
                  <M color="#b98652" />
                </RoundedBox>
              ))}
              <mesh position={[0, 0, z > 0 ? 0.018 : -0.018]} rotation={[0, z > 0 ? 0 : Math.PI, 0]}>
                <planeGeometry args={[0.6, 0.6]} />
                <meshBasicMaterial map={lines} transparent />
              </mesh>
            </group>
          ))}
        </Meeple>
      )
    case 'vinyl':
      return (
        <group>
          <RoundedBox args={[0.5, 0.27, 0.95]} radius={0.075} smoothness={4} position={[0, 0.275, 0]} castShadow>
            <M color={C.cream} rough={0.7} />
          </RoundedBox>
          <RoundedBox args={[0.46, 0.22, 0.68]} radius={0.085} smoothness={4} position={[0, 0.47, -0.05]} castShadow>
            <M color={C.cream} rough={0.7} />
          </RoundedBox>
          <RoundedBox args={[0.515, 0.1, 0.965]} radius={0.045} smoothness={3} position={[0, 0.185, 0]}>
            <M color={C.red} />
          </RoundedBox>
          <RoundedBox args={[0.36, 0.115, 0.03]} radius={0.012} smoothness={2} position={[0, 0.475, 0.286]} rotation={[-0.14, 0, 0]}>
            <M color="#a9d3ee" rough={0.3} />
          </RoundedBox>
          {[-1, 1].map((s) => (
            <group key={s}>
              <RoundedBox args={[0.03, 0.105, 0.4]} radius={0.012} smoothness={2} position={[s * 0.222, 0.48, -0.07]}>
                <M color="#a9d3ee" rough={0.3} />
              </RoundedBox>
              <mesh position={[s * 0.15, 0.275, 0.474]} scale={[1, 1, 0.5]}>
                <sphereGeometry args={[0.036, 14, 10]} />
                <meshStandardMaterial color="#fff1c2" emissive="#ffd98a" emissiveIntensity={1.6} roughness={0.4} />
              </mesh>
            </group>
          ))}
          {[[-0.25, 0.3], [0.25, 0.3], [-0.25, -0.3], [0.25, -0.3]].map(([x, z], n) => (
            <group key={n} position={[x, 0.11, z]} rotation={[0, 0, Math.PI / 2]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.11, 0.11, 0.075, 20]} />
                <M color="#2b2b30" />
              </mesh>
              <mesh>
                <cylinderGeometry args={[0.05, 0.05, 0.085, 14]} />
                <M color="#d9d2c2" />
              </mesh>
            </group>
          ))}
          <group position={[0, 0.6, 0]} rotation={[1.2, 0, 0]}>
            <mesh position={[0, 0.2, 0]} rotation={[Math.PI, 0, 0]} castShadow>
              <coneGeometry args={[0.24, 0.42, 28, 1, true]} />
              <meshStandardMaterial color={C.gold} roughness={0.45} metalness={0.2} side={THREE.DoubleSide} />
            </mesh>
            <group ref={rings} position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
              {[0, 1, 2].map((n) => (
                <mesh key={n}>
                  <torusGeometry args={[0.26, 0.016, 8, 36]} />
                  <meshBasicMaterial color="#fffdf2" transparent opacity={0.6} />
                </mesh>
              ))}
            </group>
          </group>
        </group>
      )
    case 'tree':
      return (
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
      )
    case 'rose':
      return (
        <group>
          <Meeple color="#56794a" />
          <group position={[0, 0, 0.42]}>
            <RoundedBox args={[0.36, 0.15, 0.42]} radius={0.035} smoothness={3} position={[0, 0.22, 0]} castShadow>
              <M color="#b9824f" />
            </RoundedBox>
            <mesh position={[0, 0.1, 0.24]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.1, 0.1, 0.05, 14]} />
              <M color={C.ink} />
            </mesh>
            {[[-0.08, 0.36, -0.06], [0.09, 0.38, 0.04], [0, 0.42, -0.02], [0.02, 0.35, 0.13]].map(([x, y, z], n) => (
              <mesh key={n} position={[x, y, z]} castShadow>
                <sphereGeometry args={[0.07, 10, 8]} />
                <M color="#c8324a" rough={0.6} />
              </mesh>
            ))}
          </group>
        </group>
      )
    case 'helmet':
      return (
        <Meeple color={C.red}>
          <mesh position={[0, 0.74, 0]} castShadow>
            <sphereGeometry args={[0.165, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <M color={C.gold} rough={0.5} />
          </mesh>
          <mesh position={[0, 0.74, 0.02]} castShadow>
            <cylinderGeometry args={[0.215, 0.215, 0.025, 20]} />
            <M color={C.gold} rough={0.5} />
          </mesh>
        </Meeple>
      )
    case 'paddle':
      return (
        <group>
          <Meeple color="#cf9238">
            <group position={[0.2, 0.42, 0.08]} rotation={[0.2, 0, -0.5]}>
              <mesh position={[0, 0.2, 0]} castShadow>
                <cylinderGeometry args={[0.16, 0.16, 0.03, 20]} />
                <M color={C.red} />
              </mesh>
              <mesh>
                <boxGeometry args={[0.04, 0.2, 0.03]} />
                <M color="#c79a62" />
              </mesh>
            </group>
          </Meeple>
          <mesh ref={ball} position={[0.15, 0.3, 0.55]} castShadow>
            <sphereGeometry args={[0.09, 16, 12]} />
            <M color={C.white} rough={0.5} />
          </mesh>
        </group>
      )
    case 'pawn':
      return (
        <group>
          <Meeple color={C.ink} x={-0.2}>
            <mesh ref={halo} position={[0, 1.0, 0]} rotation={[Math.PI / 2 - 0.2, 0, 0]} castShadow>
              <torusGeometry args={[0.17, 0.028, 10, 32]} />
              <meshStandardMaterial color={C.gold} emissive={C.gold} emissiveIntensity={0.5} roughness={0.4} />
            </mesh>
          </Meeple>
          <Meeple color={C.ink} x={0.24} />
        </group>
      )
    case 'coin':
      return (
        <group position={[0, 0.36, 0]}>
          <group ref={coin}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.34, 0.34, 0.06, 40]} />
              <meshStandardMaterial color="#e2b04a" roughness={0.34} metalness={1} />
            </mesh>
            <mesh rotation={[0, Math.PI / 2, 0]} castShadow>
              <torusGeometry args={[0.34, 0.036, 10, 44]} />
              <meshStandardMaterial color="#e8b955" roughness={0.3} metalness={1} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.2, 0.2, 0.085, 6]} />
              <meshStandardMaterial color="#d9a23a" roughness={0.4} metalness={1} />
            </mesh>
          </group>
        </group>
      )
    default:
      return (
        <Meeple color="#36518c">
          <group position={[0.2, 0.5, 0]} rotation={[0, 0, -0.15]}>
            <mesh position={[0, 0.25, 0]} castShadow>
              <boxGeometry args={[0.025, 0.9, 0.025]} />
              <M color="#c79a62" />
            </mesh>
            <RoundedBox args={[0.44, 0.3, 0.035]} radius={0.012} smoothness={2} position={[0, 0.62, 0]} castShadow>
              <M color={C.white} />
            </RoundedBox>
          </group>
        </Meeple>
      )
  }
}

export function FastShadow() {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (!ref.current) return
    ref.current.position.set(bus.fx + 0.08, 0.02, bus.fz + 0.05)
    const on = bus.open > 0.99 && Math.abs(bus.fx) < TW / 2 - 0.35 && Math.abs(bus.fz) < TD / 2 - 0.35
    ;(ref.current.material as THREE.MeshBasicMaterial).opacity = on ? 0.24 : 0
  })
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.27, 32]} />
      <meshBasicMaterial color="#1f3a12" transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}
