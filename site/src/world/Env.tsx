import { Environment, Lightformer } from '@react-three/drei'

// 环境反光：不用图片文件，用几块发光的板子现搭一个“房间”（左后方一盏暖灯、头顶一片冷的天光、右边一点补光）。
// 只在加载时渲一次，之后黄铜、釉面、眼睛的反光都从这里来。
export default function Env({ intensity = 0.5 }: { intensity?: number }) {
  return (
    <Environment resolution={128} frames={1} environmentIntensity={intensity}>
      {/* 底色不能是纯黑：金属朝向暗处的那一面会黑成一块。给一层很暗的暖灰，像屋里别处漫过来的光 */}
      <color attach="background" args={['#2a241d']} />
      <Lightformer form="rect" intensity={0.7} color="#d9b48a" position={[-10, 2.5, 4]} scale={[6, 5, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={0.45} color="#c9cfdc" position={[2, 2, -11]} scale={[14, 4, 1]} target={[0, 0, 0]} />
      <Lightformer form="circle" intensity={9} color="#ffc98a" position={[-6, 6, -5]} scale={5} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={1.1} color="#c3c8d4" position={[0, 9, 0]} rotation-x={Math.PI / 2} scale={[16, 16, 1]} />
      <Lightformer form="rect" intensity={1.6} color="#aab6d2" position={[9, 3, 6]} scale={[5, 4, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={0.5} color="#f6eedb" position={[0, 2, 10]} scale={[12, 3, 1]} target={[0, 0, 0]} />
    </Environment>
  )
}
