import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { bus } from '../bus'
import { C, M, Meeple } from '../world/kit'
import type { MicroProps } from './types'

// 通用占位：还没有专门设计的案例先用它。只放一个站在光圈里的小人，题目和选项走页面上的题卡。
export default function Fallback(_: MicroProps) {
  const g = useRef<THREE.Group>(null)
  useFrame((st) => {
    if (g.current) g.current.rotation.y = Math.sin(st.clock.elapsedTime * 0.8 * (1 - 0.93 * bus.t)) * 0.4
  })
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <circleGeometry args={[1.5, 48]} />
        <meshBasicMaterial color="#fffbe6" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <group ref={g} scale={1.6}>
        <Meeple color={C.blue} />
      </group>
      <mesh position={[1.1, 0.2, 0.3]} castShadow>
        <boxGeometry args={[0.4, 0.4, 0.4]} />
        <M color={C.cream} />
      </mesh>
    </group>
  )
}
