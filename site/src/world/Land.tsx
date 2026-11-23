import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { bus } from '../bus'
import { buildLamp } from './chars'
import { boatGeo, buildIsle, ISLES, lighthouseGeo } from './isles'
import { clayMat, GROUND, Pop, sm, TD, TW } from './kit'
import Sea from './Sea'
import { grainAt, paintPage } from './tex'

const BG = new THREE.Color('#06100e')
// 发光的小零件（窗、路灯、灯塔的灯）：不受光照，亮度超过 1，后期会给它们一圈光晕
const GLOW = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc864').multiplyScalar(4.2) })

// 地就是最后翻到的那个对开页：纸上印着一圈线框，线框里是一片海，海上是一座座小岛。
export function Land({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null)
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  const tex = useMemo(() => paintPage(), [])
  const grain = useMemo(() => grainAt(14, 10), [])
  useFrame(() => {
    if (!g.current) return
    g.current.visible = bus.open > 0.6 || bus.warm
    if (mat.current) mat.current.opacity = sm(0.61, 0.74, bus.open)
  })
  return (
    <group ref={g} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[TW, TD]} />
        <meshStandardMaterial ref={mat} map={tex} transparent roughness={0.92} normalMap={grain} normalScale={[0.3, 0.3]} envMapIntensity={0.4} />
      </mesh>
      <Sea />
      {children}
    </group>
  )
}

// 一座岛：地面一直在；树、屋、石头并成一个网格，有微观世界打开时收起来。
function IsleGroup({ i }: { i: number }) {
  const it = ISLES[i]
  const geo = useMemo(() => buildIsle(i), [i])
  const deco = useRef<THREE.Group>(null)
  const ground = useRef<THREE.Mesh>(null)
  useFrame(() => {
    // 岛从纸面里慢慢鼓起来
    if (ground.current) ground.current.scale.y = Math.max(0.001, sm(0.7 + i * 0.008, 0.9 + i * 0.008, bus.open))
    if (!deco.current) return
    const m = bus.micro
    const dx = it.x - m.ox
    const dz = it.z - m.oz
    // 被点开的那座岛，和挡在镜头前面的那几座岛，树和房子都先收起来
    const hide = m.k > 0.001 && (Math.hypot(dx, dz) < 0.5 || (dz > 0.8 && Math.abs(dx) < 4.4)) ? sm(0, 0.6, m.k) : 0
    const u = Math.min(1, Math.max(0, (bus.open - 0.79 - i * 0.012) / 0.2)) - 1
    const s = (1 + 2.7 * u * u * u + 1.7 * u * u) * (1 - hide)
    deco.current.scale.set(1, Math.max(0.0001, s), 1)
    deco.current.visible = s > 0.003 || bus.warm
  })
  const land = clayMat(0.94, 'ground', GROUND)
  return (
    <group position={[it.x, 0, it.z]}>
      <mesh ref={ground} geometry={geo.ground} material={land} castShadow receiveShadow />
      {geo.decor && (
        <group ref={deco} position={[0, 0.2, 0]}>
          <group position={[0, -0.2, 0]}>
            <mesh geometry={geo.decor} material={clayMat(0.9, 'plain')} castShadow receiveShadow />
            {geo.glow && <mesh geometry={geo.glow} material={GLOW} />}
          </group>
        </group>
      )}
    </group>
  )
}

export function Scenery() {
  const boat = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Group>(null)
  const lh = useMemo(() => lighthouseGeo(), [])
  const bg = useMemo(() => boatGeo(), [])
  useFrame((st) => {
    const t = st.clock.elapsedTime * (1 - 0.93 * bus.t)
    if (boat.current) {
      const a = t * 0.07
      boat.current.position.set(0.1 + Math.sin(a * 2) * 0.42, 0.012 + Math.sin(t * 1.3) * 0.01, 0.7 + Math.cos(a) * 2.3)
      boat.current.rotation.set(Math.sin(t * 1.1) * 0.05, Math.atan2(Math.cos(a * 2) * 0.84, -Math.sin(a) * 2.3), Math.sin(t * 0.9) * 0.06)
    }
    if (beam.current) beam.current.rotation.y = t * 0.55
  })
  return (
    <>
      {ISLES.map((_, i) => (
        <IsleGroup key={i} i={i} />
      ))}
      {/* 书脊水道尽头的灯塔，灯一圈圈地扫 */}
      <group position={[0.15, 0, -3.25]}>
        <Pop at={10} keep>
          <group rotation={[0, 0.5, 0]} scale={1.05}>
            <mesh geometry={lh.body} material={clayMat(0.9, 'plain')} castShadow receiveShadow />
            <mesh geometry={lh.glow} material={GLOW} />
          </group>
          <group ref={beam} position={[0, 0.86 * 1.05, 0]}>
            {[0, Math.PI].map((r) => (
              <mesh key={r} rotation={[0, r, Math.PI / 2]} position={[Math.cos(r) * 1.1, 0, -Math.sin(r) * 1.1]}>
                <coneGeometry args={[0.3, 2.2, 20, 1, true]} />
                <BeamMat />
              </mesh>
            ))}
          </group>
        </Pop>
      </group>
      {/* 一条绕着水道慢慢走的小帆船 */}
      <group ref={boat}>
        <Pop at={12} keep>
          <mesh geometry={bg} material={clayMat(0.88, 'plain', undefined, { side: THREE.DoubleSide })} scale={1.25} castShadow />
        </Pop>
      </group>
    </>
  )
}

// 灯塔的光柱：靠近灯的一头亮，越远越淡
function BeamMat() {
  const m = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying float vY; void main(){ float a = pow(clamp(vY, 0.0, 1.0), 2.2) * 0.2; gl_FragColor = vec4(vec3(1.0, 0.82, 0.5) * a, a); }',
      }),
    [],
  )
  return <primitive object={m} attach="material" />
}

// 台灯：底座在书的左边，灯罩从画面左上角探进来
export const LAMP = { pos: [-8.5, -0.7, -1.2] as [number, number, number], rot: -0.25, s: 1.13 }
export function Lamp() {
  const obj = useMemo(() => buildLamp(), [])
  // 竖屏时灯座在画面外，只剩一个灯罩悬在半空，不如不放（光还在）
  useFrame((st) => (obj.visible = st.size.width / st.size.height > 0.95))
  return <primitive object={obj} position={LAMP.pos} rotation={[0, LAMP.rot, 0]} scale={LAMP.s} />
}

// 书桌：一大块深绿色的皮面，台灯的光在上面晕开；离书越远越暗，最后和背景融成一片，看不到桌边
export function Desk() {
  const grain = useMemo(() => grainAt(150, 116, true), [])
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#123a30', roughness: 0.7, metalness: 0, envMapIntensity: 0.3, normalMap: grain, normalScale: new THREE.Vector2(0.5, 0.5) })
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDeskP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDeskP = (modelMatrix * vec4(position, 1.0)).xyz;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDeskP;')
        // 皮面桌垫上压的一圈烫金线：围着书，两道，一粗一细
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec2 dq = abs(vDeskP.xz - vec2(0.0, 0.0)) - vec2(8.9, 6.6) + 0.7;
          float dd = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - 0.7;
          float dw = max(fwidth(dd), 0.004);
          float dGilt = max(1.0 - smoothstep(0.022, 0.022 + dw, abs(dd)), 1.0 - smoothstep(0.008, 0.008 + dw, abs(dd + 0.1)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.43, 0.15), dGilt * 0.9);`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.34, dGilt);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.9, dGilt);')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>\ngl_FragColor.rgb = mix(vec3(${BG.r.toFixed(5)}, ${BG.g.toFixed(5)}, ${BG.b.toFixed(5)}), gl_FragColor.rgb, 1.0 - smoothstep(8.5, 23.0, length(vDeskP.xz - vec2(-1.0, 0.0))));`)
    }
    return m
  }, [grain])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.7, -4]} receiveShadow material={mat}>
      <planeGeometry args={[110, 100]} />
    </mesh>
  )
}
