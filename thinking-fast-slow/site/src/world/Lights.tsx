import { useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'
import * as THREE from 'three'

// 黄昏的书桌：主光是左上角那盏台灯（暖），天光很暗，右边补一点偏冷的光把暗部托住。
// 补光只带一点点蓝：太蓝的话，背着台灯的白色面会被染成蓝紫色。
// 阴影用带柔边的普通阴影贴图，一盏灯罩住整本书。
export const KEY_POS: [number, number, number] = [-6.5, 9.5, -5.5]
export default function Lights() {
  const gl = useThree((s) => s.gl)
  useLayoutEffect(() => {
    gl.shadowMap.type = THREE.PCFShadowMap
    gl.shadowMap.needsUpdate = true
  }, [gl])
  return (
    <>
      <hemisphereLight args={['#c3c8d4', '#2a1c12', 0.3]} />
      <spotLight position={KEY_POS} angle={0.82} penumbra={1} decay={1.6} distance={60} intensity={245} color="#ffbf73" castShadow shadow-mapSize={[2048, 2048]} shadow-radius={3.5} shadow-bias={-0.0005} shadow-normalBias={0.02} shadow-camera-near={4} shadow-camera-far={30} />
      <directionalLight position={[8, 6, 7]} intensity={0.4} color="#aab6d2" />
    </>
  )
}
