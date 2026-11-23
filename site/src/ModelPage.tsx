import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { buildHare, buildLamp, buildTortoise } from './world/chars'
import Env from './world/Env'
import Post from './world/Post'

// 调试用：?model=hare,tortoise 单独看代码生成的角色，灯光和后期与正式场景一致。&s=0.3 缩放，&d=2.4 镜头距离。
const BUILD: Record<string, () => THREE.Object3D> = { hare: buildHare, tortoise: buildTortoise, lamp: buildLamp }
export default function ModelPage({ names }: { names: string[] }) {
  const q = new URLSearchParams(location.search)
  const s = Number(q.get('s') ?? 1)
  const d = Number(q.get('d') ?? 2.4)
  const gap = Number(q.get('gap') ?? 1.0)
  const objs = useMemo(() => {
    const t0 = performance.now()
    const o = names.map((n) => (BUILD[n] ?? buildHare)())
    console.log('BUILD_MS', Math.round(performance.now() - t0), o.map((x) => { let n = 0; x.traverse((m) => { const g = (m as THREE.Mesh).geometry; if (g) n += (g.index ? g.index.count : g.attributes.position.count) / 3 }); return Math.round(n) }).join(','))
    return o
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <Canvas className="world" shadows flat dpr={[1, 2]} camera={{ fov: 30, position: [0.45 * d, 0.5 * d, 0.85 * d], near: 0.05, far: 80 }} gl={{ antialias: false }}>
      <color attach="background" args={['#06100e']} />
      <hemisphereLight args={['#9fb6e8', '#2a1c12', 0.22]} />
      <spotLight position={[-2.2, 3.2, -1.6]} angle={0.8} penumbra={1} decay={1.6} intensity={60} color="#ffc27a" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-radius={4} />
      <directionalLight position={[3, 2.4, 2.6]} intensity={0.4} color="#8fb0ff" />
      <Env />
      {objs.map((o, i) => (
        <primitive key={i} object={o} position={[(i - (objs.length - 1) / 2) * gap, 0, 0]} scale={s} />
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#1c4a3d" roughness={0.7} />
      </mesh>
      <OrbitControls target={[0, 0.25 * (d / 2.4), 0]} />
      <Post level={2} mobile={false} />
    </Canvas>
  )
}
