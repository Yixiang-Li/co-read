import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { bus } from '../bus'
import { ISLE_TOP, MICRO_SCALE, SLOW_POS } from '../scenes'
import { buildTortoise } from './chars'
import { isleH, ISLES } from './isles'
import { Pop, sm } from './kit'

// 慢：系统 2。一只睡在自己小岛上的泥塑乌龟，头缩在壳里；按住它，它才慢慢伸出头、站起来。
export default function SlowBlob({ hint, onDown, onUp }: { hint: string; onDown: () => void; onUp: () => void }) {
  const outer = useRef<THREE.Group>(null)
  const zzz = useRef<HTMLDivElement>(null)
  const obj = useMemo(() => buildTortoise(), [])
  const parts = useRef<{ neck?: THREE.Object3D; shell?: THREE.Object3D; lids: THREE.Object3D[]; legs: THREE.Object3D[]; eyes: THREE.Object3D[]; z0: number; y0: number }>({ legs: [], lids: [], eyes: [], z0: 0, y0: 0 })
  if (!parts.current.neck) {
    const p = parts.current
    p.neck = obj.getObjectByName('neck') ?? undefined
    p.shell = obj.getObjectByName('shell') ?? undefined
    p.lids = ['lidL', 'lidR'].map((n) => obj.getObjectByName(n)).filter(Boolean) as THREE.Object3D[]
    p.legs = ['leg0', 'leg1', 'leg2', 'leg3'].map((n) => obj.getObjectByName(n)).filter(Boolean) as THREE.Object3D[]
    p.neck?.traverse((o) => o.name === 'eye' && p.eyes.push(o))
    p.z0 = p.neck?.position.z ?? 0
    p.y0 = p.neck?.position.y ?? 0
  }
  useFrame((st) => {
    const e = sm(0, 1, bus.micro.k)
    const S = MICRO_SCALE
    bus.slowPos.x = THREE.MathUtils.lerp(SLOW_POS[0], bus.micro.ox + 1.5 * S, e)
    bus.slowPos.z = THREE.MathUtils.lerp(SLOW_POS[1], bus.micro.oz + 0.66 * S, e)
    if (outer.current) {
      const it = ISLES.find((q) => Math.hypot(q.x - bus.micro.ox, q.z - bus.micro.oz) < 0.5)
      const stageY = it ? Math.max(0.03, isleH(it, 1.5 * S, 0.66 * S)) : ISLE_TOP
      outer.current.position.set(bus.slowPos.x, THREE.MathUtils.lerp(0.186, stageY - 0.002, e), bus.slowPos.z)
      outer.current.scale.setScalar(THREE.MathUtils.lerp(1, 0.34 * S, e))
    }
    const open = bus.awake ? 1 : Math.min(1, bus.p * 1.7)
    const breath = Math.sin(st.clock.elapsedTime * 1.2) * 0.012 * (1 - open)
    const p = parts.current
    // 睡着：头缩进壳里、腿收着、壳贴地。醒来：头伸出来抬高，壳被腿撑起来。
    if (p.neck) {
      p.neck.position.z = p.z0 - 0.21 + open * 0.21
      p.neck.position.y = p.y0 - 0.035 + open * 0.06
      p.neck.rotation.x = -open * 0.3
    }
    if (p.shell) p.shell.position.y = -0.03 + open * 0.03 + breath
    p.legs.forEach((l) => l.scale.setScalar(0.5 + 0.5 * open))
    // 眼皮：睡着时盖下来，醒了翻上去；醒着的时候隔一会儿眨一下
    const tt = st.clock.elapsedTime
    const blink = open > 0.9 && tt % 4.2 < 0.13 ? 1 : 0
    const lid = THREE.MathUtils.lerp(0.95, -0.9, Math.min(1, Math.max(0, open * 1.6 - 0.5)) * (1 - blink))
    p.lids.forEach((l) => (l.rotation.x = lid))
    // 用力想的时候瞳孔会放大（书里第二章写的）：按住的过程中眼睛慢慢变大，想完了恢复
    const pupil = 0.029 * (1 + 0.34 * (bus.awake ? 0 : bus.p))
    p.eyes.forEach((o) => o.scale.setScalar(pupil))
    if (zzz.current) {
      // 镜头拉近（开场特写、横屏）时 Z 会飘进顶栏，压在语言切换上：进了顶栏那一条就不显示
      const top = zzz.current.getBoundingClientRect().top
      zzz.current.style.opacity = String(bus.open > 0.99 && top > 60 ? Math.max(0, 1 - open * 4) : 0)
    }
  })
  return (
    <group ref={outer}>
      <Pop at={9} keep>
        <group rotation={[0, -0.6, 0]} scale={1.74}>
          <primitive object={obj} />
          {/* 看不见的按压范围：整只乌龟 */}
          <mesh
            position={[0, 0.2, 0]}
            scale={[0.42, 0.3, 0.52]}
            onPointerDown={(e) => {
              e.stopPropagation()
              ;(e.target as Element).setPointerCapture?.(e.pointerId)
              onDown()
            }}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerOut={onUp}
          >
            <sphereGeometry args={[1, 16, 12]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
        <Html position={[0.62, 1.15, 0]} style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
          <div ref={zzz} className="zzz3d">
            <span>z</span>
            <span>z</span>
            <span>Z</span>
          </div>
        </Html>
        <Html position={[-0.22, 0.5, 0.6]} style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
          <div className="slow-hint" style={{ opacity: hint ? 1 : 0 }}>
            {hint}
          </div>
        </Html>
      </Pop>
    </group>
  )
}
