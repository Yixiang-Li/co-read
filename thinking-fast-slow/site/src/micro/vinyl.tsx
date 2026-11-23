import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bus } from '../bus'
import { L, useLang } from '../i18n'
import { sfx } from '../sound'
import { backOut, C, M, Meeple, sm, Tag } from '../world/kit'
import type { MicroProps } from './types'

// 曝光效应：把实验做在访客身上。小车绕着圈把同一个陌生的词播十二遍，然后让访客在它和一个新词之间挑。
const OLD = 'kadirga' // 书里举的例子：谁也不认识的词
const NEW = 'nansoma' // 同一组里的另一个，一次都不播
const N = 12 // 播几遍
const RR = 1.08 // 圈的半径
const CX = -0.08 // 圈心（让开右前方的乌龟）
const CZ = -0.1
const VS = 0.9 // 小车的大小
const S = 0.86 // 整个世界再缩一点：路边的人要站在岛顶上（草地半径约 1.6，有的方向只有 1.4），不能悬在海面上

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}
const vnoise = (x: number, y: number) => {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi))
  const v = (y - yi) * (y - yi) * (3 - 2 * (y - yi))
  const m = (a: number, b: number, t: number) => a + (b - a) * t
  return m(m(hash(xi, yi), hash(xi + 1, yi), u), m(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v)
}
const finish = (c: HTMLCanvasElement) => {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}
const FONT = '"Noto Sans SC", "PingFang SC", sans-serif'
// 圈上第 u 圈处的位置。u 每加 1 绕一整圈；u 的小数是 0.5 时正好开到最前面
const ring = (u: number, r = RR, out: [number, number, number] = [0, 0, 0]) => {
  const th = Math.PI * 2 * (u - 0.5)
  out[0] = CX + Math.sin(th) * r
  out[1] = CZ + Math.cos(th) * r
  out[2] = th + Math.PI / 2
  return out
}
const SPOT = CROWD_SPOTS()
function CROWD_SPOTS() {
  return [0.08, 0.91, 0.25, 0.77].map((u, i) => ring(u, [1.5, 1.52, 1.48, 1.46][i]))
}
const FRONT = ring(0.5, RR - 0.1)
// 十二个残影排在圈上，空出最后面车自己停的那一段（原来第 1 个和第 12 个会和车叠在一起）
const GF = (j: number) => (j + 1.5) / (N + 2)
const GHOST = Array.from({ length: N }, (_, j) => ring(N - GF(j)))
// 序号牌朝着镜头立着（微观世界里镜头是固定的）
const UPY = 0.79
const UPZ = -0.61

// 土路：一圈压出来的车道，边缘像颜料晕开
function paintRoad(S: number, world: number) {
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const k = S / world
  const mid = S / 2
  g.fillStyle = '#e7d6a6'
  g.fillRect(0, 0, S, S)
  // 顺着圈的笔触
  for (let i = 0; i < 2600; i++) {
    const a = hash(i, 1) * Math.PI * 2
    const r = (RR + (hash(i, 2) - 0.5) * 0.66) * k
    g.save()
    g.translate(mid + Math.cos(a) * r, mid + Math.sin(a) * r)
    g.rotate(a + Math.PI / 2)
    g.fillStyle = hash(i, 3) > 0.5 ? `rgba(255,248,222,${0.05 + hash(i, 4) * 0.08})` : `rgba(140,108,56,${0.04 + hash(i, 5) * 0.07})`
    g.beginPath()
    g.ellipse(0, 0, 12 + hash(i, 6) * 26, 2 + hash(i, 7) * 4, 0, 0, 7)
    g.fill()
    g.restore()
  }
  // 两道车辙和中间的虚线
  for (const off of [-0.2, 0.2]) {
    g.strokeStyle = 'rgba(150,118,66,0.26)'
    g.lineWidth = 0.075 * k
    g.beginPath()
    g.arc(mid, mid, (RR + off) * k, 0, 7)
    g.stroke()
  }
  g.setLineDash([0.13 * k, 0.15 * k])
  g.strokeStyle = 'rgba(255,253,240,0.8)'
  g.lineWidth = 0.028 * k
  g.beginPath()
  g.arc(mid, mid, RR * k, 0, 7)
  g.stroke()
  g.setLineDash([])
  const img = g.getImageData(0, 0, S, S)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.abs(Math.hypot(x - mid, y - mid) / k - RR)
      if (d < 0.2) continue
      if (d > 0.48) {
        img.data[(y * S + x) * 4 + 3] = 0
        continue
      }
      const n = vnoise(x / 26, y / 26) * 0.6 + vnoise(x / 7, y / 7) * 0.4
      const a = (0.37 - d - n * 0.1) / 0.06
      img.data[(y * S + x) * 4 + 3] = a >= 1 ? 255 : a <= 0 ? 0 : hash(x, y) < a * a ? 255 : 0
    }
  g.putImageData(img, 0, 0)
  return finish(c)
}

// 一张写着词的牌子面。kind：card 是立着的大牌子，pop 是从喇叭里飘出来的那一声，side 是车身上的字
function paintWord(word: string, kind: 'card' | 'pop' | 'side') {
  const c = document.createElement('canvas')
  c.width = 640
  c.height = kind === 'card' ? 340 : 200
  const g = c.getContext('2d')!
  const { width: w, height: h } = c
  if (kind === 'card') {
    g.fillStyle = C.paper
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = hash(i, 31) > 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(150,130,90,0.08)'
      g.fillRect(hash(i, 32) * w, hash(i, 33) * h, 1 + hash(i, 34) * 9, 1)
    }
    g.strokeStyle = 'rgba(35,36,43,0.16)'
    g.lineWidth = 3
    g.strokeRect(22, 22, w - 44, h - 44)
  } else if (kind === 'pop') {
    g.fillStyle = C.white
    g.beginPath()
    g.roundRect(30, 26, w - 60, h - 70, 54)
    g.fill()
    g.beginPath()
    g.moveTo(w / 2 - 26, h - 46)
    g.lineTo(w / 2, h - 8)
    g.lineTo(w / 2 + 26, h - 46)
    g.fill()
  }
  g.fillStyle = kind === 'side' ? C.red : C.ink
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `900 ${kind === 'card' ? 124 : kind === 'pop' ? 88 : 132}px ${FONT}`
  g.fillText(word, w / 2, kind === 'pop' ? h / 2 - 22 : h / 2 - 4)
  return finish(c)
}

// 残影头顶的序号：十二个数字画在一张图上（4 列 3 行），用一个几何体一次画完
function paintNums() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 384
  const g = c.getContext('2d')!
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `900 68px ${FONT}`
  for (let n = 0; n < N; n++) {
    const x = (n % 4) * 128 + 64
    const y = Math.floor(n / 4) * 128 + 64
    g.fillStyle = C.ink
    g.beginPath()
    g.arc(x, y, 54, 0, 7)
    g.fill()
    g.fillStyle = '#fffdf2'
    g.fillText(String(n + 1), x, y + 4)
  }
  return finish(c)
}
function numGeo() {
  const g = new THREE.BufferGeometry()
  const uv = new Float32Array(N * 8)
  const idx: number[] = []
  for (let n = 0; n < N; n++) {
    const u0 = (n % 4) / 4
    const v1 = 1 - Math.floor(n / 4) / 3
    uv.set([u0, v1 - 1 / 3, u0 + 0.25, v1 - 1 / 3, u0 + 0.25, v1, u0, v1], n * 8)
    idx.push(n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3)
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 12), 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}
// 残影：整辆车合成一个几何体，十二个用 InstancedMesh 一次画完
function ghostGeo() {
  const wheel = (x: number, z: number) => new THREE.CylinderGeometry(0.11, 0.11, 0.07, 12).rotateZ(Math.PI / 2).translate(x, 0.11, z)
  return mergeGeometries([
    new THREE.BoxGeometry(0.5, 0.36, 0.95).translate(0, 0.3, 0),
    wheel(-0.26, 0.3), wheel(0.26, 0.3), wheel(-0.26, -0.3), wheel(0.26, -0.3),
    new THREE.ConeGeometry(0.24, 0.42, 16, 1, true).rotateX(1.25).translate(0, 0.62, -0.05),
  ]).scale(VS * 0.47, VS * 0.47, VS * 0.47) // 小一点，十二个之间留出缝，看得出是一辆一辆的车
}

// 飘在路人头顶的音符
function paintNote() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = C.white // 深色的音符在墨青的海面和深色桌面上看不见
  g.beginPath()
  g.ellipse(44, 96, 22, 16, -0.4, 0, 7)
  g.fill()
  g.fillRect(58, 22, 9, 76)
  g.beginPath()
  g.moveTo(58, 20)
  g.quadraticCurveTo(100, 30, 96, 66)
  g.quadraticCurveTo(88, 46, 58, 44)
  g.fill()
  return finish(c)
}

// 三个音的小旋律（五声音阶，很轻很短），每开过一遍响一次。访客点过页面之后才出声，静音时不响
let actx: AudioContext | null = null
function jingle() {
  if (!sfx.on) return
  if (!(navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) return
  try {
    actx ??= new AudioContext()
    const a = actx
    ;[659.3, 784, 880].forEach((f, i) => {
      const o = a.createOscillator()
      const g = a.createGain()
      o.type = 'triangle'
      o.frequency.value = f
      const t0 = a.currentTime + i * 0.075
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.14)
      o.connect(g).connect(a.destination)
      o.start(t0)
      o.stop(t0 + 0.16)
    })
  } catch {
    /* 没有声音也不要紧 */
  }
}

// 广播车，和地上那辆一样，车身上多了那个词
function Van({ side, rings, wheels }: { side: THREE.Texture; rings: React.RefObject<THREE.Group | null>; wheels: React.RefObject<THREE.Group | null> }) {
  return (
    <group scale={VS}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[0.5, 0.36, 0.95]} />
        <M color={C.cream} rough={0.7} />
      </mesh>
      <mesh position={[0, 0.3, 0.36]}>
        <boxGeometry args={[0.52, 0.12, 0.24]} />
        <M color="#a9c3cc" rough={0.6} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <boxGeometry args={[0.52, 0.08, 0.97]} />
        <M color={C.red} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * 0.2515, 0.335, -0.12]} rotation={[0, (sx * Math.PI) / 2, 0]}>
          <planeGeometry args={[0.6, 0.19]} />
          <meshBasicMaterial map={side} transparent />
        </mesh>
      ))}
      <group ref={wheels}>
        {[[-0.26, 0.3], [0.26, 0.3], [-0.26, -0.3], [0.26, -0.3]].map(([x, z], n) => (
          <mesh key={n} position={[x, 0.11, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.11, 0.11, 0.07, 14]} />
            <M color={C.ink} />
          </mesh>
        ))}
      </group>
      <group position={[0, 0.62, -0.05]} rotation={[1.25, 0, 0]}>
        <mesh castShadow>
          <coneGeometry args={[0.24, 0.42, 20, 1, true]} />
          <meshStandardMaterial color={C.gold} roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
        <group ref={rings} position={[0, -0.34, 0]} rotation={[Math.PI / 2, 0, 0]}>
          {[0, 1, 2].map((n) => (
            <mesh key={n}>
              <torusGeometry args={[0.26, 0.016, 6, 28]} />
              <meshBasicMaterial color="#fffdf2" transparent opacity={0.6} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  )
}

const CROWD: { color: string; s: number }[] = [
  { color: C.navy, s: 0.9 },
  { color: C.pink, s: 0.82 },
  { color: C.coral, s: 0.86 },
  { color: C.blue, s: 0.94 },
]
const CARDS = [
  { word: OLD, x: CX - 0.43 },
  { word: NEW, x: CX + 0.43 },
]

export default function Vinyl({ phase, pick, choose, say }: MicroProps) {
  useLang()
  const tex = useMemo(
    () => ({
      road: paintRoad(1024, (RR + 0.6) * 2),
      cards: [paintWord(OLD, 'card'), paintWord(NEW, 'card')],
      pop: paintWord(OLD, 'pop'),
      side: paintWord(OLD, 'side'),
      nums: paintNums(),
      note: paintNote(),
    }),
    [],
  )
  const geo = useMemo(() => ({ ghost: ghostGeo(), nums: numGeo() }), [])
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), s: new THREE.Vector3(), at: [0, 0, 0] as [number, number, number] }), [])
  // 字体晚到的话重画一遍
  useEffect(() => {
    document.fonts?.load(`900 80px ${FONT}`, OLD + NEW + '0123456789').then(() => {
      const again = [paintWord(OLD, 'card'), paintWord(NEW, 'card'), paintWord(OLD, 'pop'), paintWord(OLD, 'side')]
      ;[tex.cards[0], tex.cards[1], tex.pop, tex.side].forEach((t, i) => {
        t.image = again[i].image
        t.needsUpdate = true
      })
      tex.nums.image = paintNums().image
      tex.nums.needsUpdate = true
    })
  }, [tex])

  const van = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const rings = useRef<THREE.Group>(null)
  const wheels = useRef<THREE.Group>(null)
  const pops = useRef<(THREE.Sprite | null)[]>([])
  const crowd = useRef<(THREE.Group | null)[]>([])
  const hands = useRef<(THREE.Group | null)[]>([])
  const notes = useRef<(THREE.Sprite | null)[]>([])
  const cards = useRef<(THREE.Group | null)[]>([])
  const frames = useRef<(THREE.Mesh | null)[]>([])
  const ghosts = useRef<THREE.InstancedMesh>(null)
  const s = useRef({ t: 0, u: 0, passes: 0, ready: 0, up: [0, 0], lift: [0, 0], hover: -1, pop: [-9, -9, -9, -9], popN: 0, like: 0, spin: 0, cheer: 0 })
  const [count, setCount] = useState(0) // 第几遍
  const [ready, setReady] = useState(false) // 播完了，牌子立起来
  const [seen, setSeen] = useState(0) // 慢倒着数出来的次数
  const [holding, setHolding] = useState(false)
  const [zero, setZero] = useState(false) // 另一个词：0 次

  useEffect(() => {
    if (phase === 'ask') {
      Object.assign(s.current, { t: 0, u: 0, passes: 0, ready: 0, up: [0, 0], hover: -1, like: 0 })
      setCount(0)
      setReady(false)
      setSeen(0)
      say(L('先别动，听它广播', 'Just listen to the van for a bit'))
    }
    if (phase === 'picked') {
      s.current.cheer = 1
      say(holding ? '' : L('按住乌龟，把时间倒回去数', 'Hold the tortoise. Rewind and count'))
    }
    if (phase === 'done') say('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, holding])
  useEffect(() => {
    if (ready && phase === 'ask') say(L('哪个词看着更顺眼？点它', 'Which word feels nicer? Tap it'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  useFrame((_, raw) => {
    const a = s.current
    const slow = 1 - 0.93 * bus.t
    const dt = Math.min(0.05, raw) * slow
    const p = bus.p
    const picked = phase === 'picked'
    const done = phase === 'done'
    if (bus.micro.k > 0.8) a.t += dt

    // 一、绕圈广播：越播越快，播满十二遍，开到圈的最后面停下
    if (phase === 'ask' && a.t > 0.25 && a.u < N) {
      const lap = Math.max(0.62, 1.9 * Math.pow(0.82, a.u))
      const brake = a.u > N - 0.5 ? 0.22 + 0.78 * (N - a.u) * 2 : 1
      a.u = Math.min(N, a.u + (dt / lap) * brake)
      if (a.u > N - 0.004) a.u = N
      const passes = Math.min(N, Math.floor(a.u + 0.5))
      if (passes > a.passes) {
        a.passes = passes
        setCount(passes)
        a.pop[a.popN++ % 4] = a.t
        jingle()
      }
      if (a.u >= N && !a.ready) {
        a.ready = 1
        setReady(true)
      }
    }
    // 二、慢的推算：把车沿着圈倒回去一整圈，每倒一格留下一个残影，一共十二个
    const back = picked ? clamp01((p - 0.05) / 0.57) : done ? 1 : 0
    const u = a.u - back
    const [vx, vz, vr] = ring(u, RR, tmp.at)
    if (van.current) {
      van.current.position.set(vx, 0, vz)
      van.current.rotation.y = vr
    }
    const moving = phase === 'ask' && a.u < N ? 1 : 0
    a.spin += dt * 9 * moving
    if (body.current) {
      body.current.position.y = Math.abs(Math.sin(a.t * 17)) * 0.012 * moving
      body.current.rotation.z = 0.07 * moving
    }
    wheels.current?.children.forEach((m) => (m.rotation.x = a.spin))
    rings.current?.children.forEach((m, i) => {
      const q = (a.t * 0.9 + i / 3) % 1
      m.scale.setScalar(0.3 + q * 1.7)
      ;((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - q) * (done || picked ? 0.35 : 1)
    })
    // 每开过正前方一次，喇叭里飘出一声那个词
    pops.current.forEach((sp, i) => {
      if (!sp) return
      const age = (a.t - a.pop[i]) / 1.15
      sp.visible = age >= 0 && age < 1
      if (!sp.visible) return
      const k = backOut(age * 5) * (1 - sm(0.75, 1, age))
      sp.position.set(FRONT[0] + (i % 2 ? 0.16 : -0.16), 0.95 + age * 0.75, FRONT[1])
      sp.scale.set(0.9 * k, 0.28 * k, 1)
      sp.material.opacity = 1 - sm(0.7, 1, age)
    })
    const n = Math.max(0, Math.min(N, Math.floor((back - 0.03) * (N + 2) - 0.5))) // 已经留下几个残影
    if (n !== seen) setSeen(n)
    const h = picked && p > 0.04
    if (h !== holding) setHolding(h)
    const z = (picked && p > 0.68) || done
    if (z !== zero) setZero(z)
    const gi = ghosts.current
    if (gi) {
      gi.visible = back > 0
      if (gi.castShadow !== !!bus.quality) gi.castShadow = !!bus.quality
      const pos = geo.nums.attributes.position as THREE.BufferAttribute
      for (let j = 0; j < N; j++) {
        const k = Math.max(0.0001, backOut((back - GF(j) - 0.03) / 0.045))
        // 数完以后，残影一个接一个地跳一下
        const wave = picked ? sm(0.76, 1, p) * 1.25 - j / N : 9
        const hop = wave > 0 && wave < 0.25 ? Math.sin((wave / 0.25) * Math.PI) * 0.14 : 0
        const [x, z, r] = GHOST[j]
        gi.setMatrixAt(j, tmp.m.compose(tmp.v.set(x, hop, z), tmp.q.setFromEuler(tmp.e.set(0, r, 0)), tmp.s.setScalar(k)))
        // 头顶的序号牌：四个角
        const h = 0.085 * k
        const y = 0.52 + hop
        pos.setXYZ(j * 4, x - h, y - h * UPY, z - h * UPZ)
        pos.setXYZ(j * 4 + 1, x + h, y - h * UPY, z - h * UPZ)
        pos.setXYZ(j * 4 + 2, x + h, y + h * UPY, z + h * UPZ)
        pos.setXYZ(j * 4 + 3, x - h, y + h * UPY, z + h * UPZ)
      }
      gi.instanceMatrix.needsUpdate = true
      pos.needsUpdate = true
    }
    // 三、路边的人：头几遍捂着耳朵背过身，听多了就转过来跟着晃。倒回去的时候他们也退回最初的样子
    const likeT = sm(1.2, 8.5, a.u) * (picked ? 1 - 0.92 * sm(0.05, 0.6, p) : 1)
    a.like += (likeT - a.like) * Math.min(1, dt * 5)
    a.cheer = Math.max(0, a.cheer - dt * 1.4)
    crowd.current.forEach((g, i) => {
      if (!g) return
      const m = a.like
      const [x, z] = SPOT[i]
      const away = Math.atan2(x - CX, z - CZ)
      const toward = Math.atan2(vx - x, vz - z)
      const face = sm(0.25, 0.65, m)
      g.rotation.y = away + Math.atan2(Math.sin(toward - away), Math.cos(toward - away)) * face
      const beat = a.t * 7 + i * 1.7
      g.position.y = Math.abs(Math.sin(beat)) * 0.09 * m + (pick === 0 ? Math.abs(Math.sin(a.cheer * 9 + i)) * 0.2 * a.cheer : 0)
      g.rotation.z = Math.sin(beat) * 0.16 * m + Math.sin(a.t * 31 + i) * 0.03 * (1 - m)
      g.rotation.x = -0.2 * (1 - m)
      hands.current[i]?.scale.setScalar(Math.max(0.001, 1 - sm(0.2, 0.55, m)))
      const sp = notes.current[i]
      if (sp) {
        const q = (a.t * 0.55 + i * 0.37) % 1
        sp.position.set(x + Math.sin(q * 6 + i) * 0.08, 0.88 + q * 0.34, z) // 飘得低一点，别飘到页眉那一行去
        const k = bus.quality ? sm(0.6, 0.95, m) * Math.sin(q * Math.PI) : 0 // 省电档不飘音符
        sp.scale.setScalar(0.24 * k + 0.0001)
        sp.material.opacity = k
      }
    })
    // 四、两块牌子：播完才立起来
    for (let i = 0; i < 2; i++) {
      const g = cards.current[i]
      if (!g) continue
      const want = a.ready ? 1 : 0
      a.up[i] += (want - a.up[i]) * Math.min(1, dt * (5 - i * 1.2))
      a.lift[i] += ((phase === 'ask' && a.ready && a.hover === i ? 1 : 0) - a.lift[i]) * Math.min(1, dt * 12)
      const e = backOut(a.up[i])
      g.position.y = a.lift[i] * 0.07
      g.scale.setScalar(Math.max(0.0001, e * (1 + a.lift[i] * 0.05)))
      const f = frames.current[i]
      if (f) f.scale.setScalar(pick === i && phase !== 'ask' ? 1 : 0.0001)
    }
  })

  return (
    <group scale={S}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CX, 0.012, CZ]} receiveShadow>
        <planeGeometry args={[(RR + 0.6) * 2, (RR + 0.6) * 2]} />
        <meshStandardMaterial map={tex.road} transparent alphaTest={0.5} roughness={1} />
      </mesh>

      <group ref={van}>
        <group ref={body}>
          <Van side={tex.side} rings={rings} wheels={wheels} />
        </group>
      </group>
      {[0, 1, 2, 3].map((i) => (
        <sprite key={i} ref={(m) => void (pops.current[i] = m)} visible={false} renderOrder={5}>
          <spriteMaterial map={tex.pop} transparent depthWrite={false} />
        </sprite>
      ))}

      {/* 十二个残影，沿着圈排开，头顶各有一个序号 */}
      <instancedMesh ref={ghosts} args={[geo.ghost, undefined, N]} visible={false} castShadow frustumCulled={false}>
        <meshStandardMaterial color={C.white} roughness={0.95} side={THREE.DoubleSide} emissive={C.cream} emissiveIntensity={0.14} />
      </instancedMesh>
      <mesh geometry={geo.nums} visible={phase !== 'ask'} frustumCulled={false} renderOrder={4}>
        <meshBasicMaterial map={tex.nums} transparent depthWrite={false} />
      </mesh>

      {/* 路边的人 */}
      {CROWD.map((c, i) => {
        const [x, z] = SPOT[i]
        return (
          <group key={i} position={[x, 0, z]} scale={c.s}>
            <group ref={(g) => void (crowd.current[i] = g)}>
              <Meeple color={c.color}>
                <group ref={(g) => void (hands.current[i] = g)} position={[0, 0.66, 0]}>
                  {[-1, 1].map((sx) => (
                    <mesh key={sx} position={[sx * 0.15, 0.01, 0.02]}>
                      <sphereGeometry args={[0.062, 10, 8]} />
                      <M color={c.color} rough={0.75} />
                    </mesh>
                  ))}
                </group>
              </Meeple>
            </group>
          </group>
        )
      })}
      {CROWD.map((_, i) => (
        <sprite key={i} ref={(m) => void (notes.current[i] = m)} scale={0.0001} renderOrder={4}>
          <spriteMaterial map={tex.note} transparent depthWrite={false} opacity={0} />
        </sprite>
      ))}

      {/* 两块牌子：左边是播了十二遍的词，右边是一次都没播过的 */}
      {CARDS.map((c, i) => (
        <group key={i} position={[c.x, 0, CZ + 0.42]}>
          <group
            ref={(g) => void (cards.current[i] = g)}
            rotation={[-0.34, 0, 0]}
            scale={0.0001}
            onPointerOver={(e) => (e.stopPropagation(), (s.current.hover = i))}
            onPointerOut={() => s.current.hover === i && (s.current.hover = -1)}
            onClick={(e) => {
              e.stopPropagation()
              if (phase === 'ask' && s.current.ready) choose(i)
            }}
          >
            {[-0.24, 0.24].map((x) => (
              <mesh key={x} position={[x, 0.14, -0.03]} castShadow>
                <cylinderGeometry args={[0.022, 0.026, 0.28, 10]} />
                <M color="#b9824f" rough={0.8} />
              </mesh>
            ))}
            <RoundedBox args={[0.8, 0.46, 0.05]} radius={0.022} smoothness={4} position={[0, 0.48, 0]} castShadow receiveShadow>
              <M color="#c79a62" rough={0.8} />
            </RoundedBox>
            <mesh position={[0, 0.48, 0.027]}>
              <planeGeometry args={[0.74, 0.4]} />
              <meshStandardMaterial map={tex.cards[i]} roughness={0.9} emissive="#ffffff" emissiveMap={tex.cards[i]} emissiveIntensity={0.62} />
            </mesh>
            <mesh ref={(m) => void (frames.current[i] = m)} position={[0, 0.48, -0.004]} scale={0.0001}>
              <boxGeometry args={[0.88, 0.54, 0.05]} />
              <M color={C.red} rough={0.6} />
            </mesh>
            <Tag position={[0, 0.84, 0]} tone="dark" show={i === 0 ? (phase === 'picked' && seen > 0) || phase === 'done' : zero}>
              {L(`见过 ${i ? 0 : phase === 'done' ? N : seen} 次`, `seen ${i ? 0 : phase === 'done' ? N : seen}×`)}
            </Tag>
          </group>
        </group>
      ))}

      <Tag position={[CX, 0.05, CZ + 0.12]} show={phase === 'ask' && count > 0 && !ready}>
        <span className="tg22">{L(`第 ${count} 遍`, `Play ${count}`)}</span>
      </Tag>
    </group>
  )
}
