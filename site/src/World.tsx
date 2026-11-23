import { Sparkles } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { bus, CAM } from './bus'
import { GLLost } from './NoGL'
import { Hare } from './FastLayer'
import { MICRO } from './micro/registry'
import type { MicroProps } from './micro/types'
import { ISLE_TOP, MICRO_SCALE, type Scene } from './scenes'
import { Agent } from './world/Agents'
import { backOut, upgrade } from './world/kit'
import Env from './world/Env'
import { Desk, Lamp, Land, Scenery } from './world/Land'
import Lights from './world/Lights'
import Post from './world/Post'
import Rig from './world/Rig'
import SlowBlob from './world/Slow'

// 书单独加载并隔离：它正在被重做，中途出错不能让整页空白
const Book = lazy(() => import('./world/BigBook'))

type Props = { cases: Scene[]; canPick: boolean; solved: string[]; onPick: (id: string) => void; slowHint: string; onSlowDown: () => void; onSlowUp: () => void; onBook: () => void; micro: string | null; mp: Omit<MicroProps, 'c'> }

export default function World(p: Props) {
  // 帧率掉下来就自动降清晰度，再不行切到省电档（bus.quality = 0）
  const mobile = useMemo(() => matchMedia('(pointer: coarse)').matches || innerWidth < 760, [])
  // 画质分四级，只降不升：来回切换会重建缓冲、重编着色器，每切一次都会顿一下
  const LEVELS = useMemo(() => [{ dpr: 1.5, fx: 2 }, { dpr: 1.2, fx: 2 }, { dpr: 1.1, fx: 1 }, { dpr: 0.9, fx: 0 }] as const, [])
  const [lv, setLv] = useState(() => Number(new URLSearchParams(location.search).get('lv') ?? (mobile ? 1 : 0)))
  const L = LEVELS[Math.min(LEVELS.length - 1, lv)]
  // 场景晚两帧再搭：先让等待页画出来，再做生成形状的那一秒计算
  const [go, setGo] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setGo(true)))
    return () => cancelAnimationFrame(id)
  }, [])
  bus.quality = L.fx === 0 ? 0 : 1
  const [lost, setLost] = useState(false)
  if (lost) return <GLLost />
  return (
    <Canvas onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', () => setLost(true), { once: true })} className="world" shadows flat dpr={Math.min(L.dpr, window.devicePixelRatio)} camera={{ fov: CAM.fov, position: [0, 7.2, 7.4], near: 0.5, far: 90 }} gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}>
      <color attach="background" args={['#06100e']} />
      <Monitor onDecline={() => setLv((v) => Math.min(LEVELS.length - 1, v + 1))} />
      <Env intensity={0.45} />
      <Desk />
      <Rig />
      <Lights />
      <Guard>
        <Suspense fallback={null}>
          <Book onOpen={p.onBook} />
        </Suspense>
      </Guard>
      {go && (
        <>
          {/* 灯光里的浮尘 */}
          {L.fx > 0 && <Sparkles count={34} scale={[13, 3, 8.5]} position={[-1, 2.1, 0]} size={1.5} speed={0.16} opacity={0.3} color="#ffdfb0" noise={0.7} />}
      <Suspense fallback={null}>
        <Lamp />
      </Suspense>
      <Land>
        <Suspense fallback={null}>
          <Scenery />
        </Suspense>
        <Suspense fallback={null}>
          {p.cases.map((c, i) => (
            <Agent key={c.id} c={c} i={i} solved={p.solved.includes(c.id)} canPick={p.canPick} onPick={() => p.onPick(c.id)} />
          ))}
          <MicroHost id={p.micro} mp={p.mp} cases={p.cases} />
          <SlowBlob hint={p.slowHint} onDown={p.onSlowDown} onUp={p.onSlowUp} />
          <Hare />
        </Suspense>
      </Land>
        </>
      )}
      <Post level={L.fx} mobile={mobile} />
    </Canvas>
  )
}

class Guard extends Component<{ children: ReactNode }, { bad: boolean }> {
  state = { bad: false }
  static getDerivedStateFromError() {
    return { bad: true }
  }
  componentDidCatch(e: unknown) {
    console.error('微观世界出错', e)
  }
  render() {
    return this.state.bad ? null : this.props.children
  }
}

// 被点开的那个案例的微观世界：随着镜头俯冲，从地上长出来
function MicroHost({ id, mp, cases }: { id: string | null; mp: Omit<MicroProps, 'c'>; cases: Scene[] }) {
  const [shown, setShown] = useState<string | null>(null)
  const g = useRef<THREE.Group>(null)
  useEffect(() => {
    if (id) setShown(id)
  }, [id])
  const n = useRef(0)
  useFrame(() => {
    // 道具是陆续挂上来的：每隔半秒扫一遍，把纯色的标准材质换成“看颜色认材质”
    if (g.current && n.current++ % 30 === 0) g.current.traverse((o) => {
      const m = (o as THREE.Mesh).material
      if (m) (Array.isArray(m) ? m : [m]).forEach(upgrade)
    })
    if (!id && shown && bus.micro.k < 0.02) setShown(null)
    if (g.current) g.current.scale.setScalar(Math.max(0.0001, backOut(bus.micro.k * 1.15)) * MICRO_SCALE)
  })
  const c = cases.find((x) => x.id === shown)
  if (!shown || !c) return null
  const D = MICRO[shown].C
  return (
    <group ref={g} position={[c.pos[0], ISLE_TOP, c.pos[1]]}>
      <Guard key={shown}>
        <Suspense fallback={null}>
          <D c={c} {...mp} />
          <Ready id={shown} />
        </Suspense>
      </Guard>
    </group>
  )
}

// 布景搭好以后才让镜头动：新布景先缩得看不见、原地画上三帧（搭网格、画贴图、编译着色器都发生在这几帧里），
// 然后才登记 bus.micro.id。这样那一下停顿发生在画面静止的时候，俯冲的过程是顺的。
function Ready({ id }: { id: string }) {
  useEffect(() => {
    let live = true
    let n = 0
    let raf = 0
    const tick = () => {
      if (!live) return
      if (++n >= 3) {
        if (bus.micro.pending === id) bus.micro.id = id
      } else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      live = false
      cancelAnimationFrame(raf)
    }
  }, [id])
  return null
}

// 判断“是不是真的跑不动”，跑不动才降一档画质。
// 不能只看帧率：省电模式、低电量模式下浏览器会把动画整齐地限制在每秒 30 帧，那不是显卡慢，降画质只会白白变糊。
// 所以每两秒看一次帧间隔：如果绝大多数帧都整齐地落在同一个间隔上（被系统限速），就不动；
// 只有帧间隔参差不齐、而且平均不到 45 帧，连续两次都这样，才降一档。
function Monitor({ onDecline }: { onDecline: () => void }) {
  const s = useRef({ t: [] as number[], bad: 0, skip: 3 })
  useFrame((_, dt) => {
    const a = s.current
    if (document.hidden || bus.warm) return
    a.t.push(dt * 1000)
    if (a.t.length < 120) return
    const t = a.t
    a.t = []
    if (a.skip-- > 0) return // 刚打开、刚降过档的头几轮不算
    const sorted = [...t].sort((x, y) => x - y)
    const med = sorted[sorted.length >> 1]
    const avg = t.reduce((x, y) => x + y, 0) / t.length
    const steady = t.filter((x) => Math.abs(x - med) < med * 0.14).length / t.length
    const capped = steady > 0.8 && (Math.abs(med - 33.3) < 2.5 || Math.abs(med - 16.7) < 1.5 || Math.abs(med - 20) < 1.2 || Math.abs(med - 25) < 1.5 || Math.abs(med - 41.7) < 2)
    if (1000 / avg < 45 && !capped) {
      if (++a.bad >= 2) {
        a.bad = 0
        a.skip = 3
        onDecline()
      }
    } else a.bad = 0
  })
  return null
}
