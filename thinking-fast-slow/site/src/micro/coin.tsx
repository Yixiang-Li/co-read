import { RoundedBox } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { bus } from '../bus'
import { L, useLang } from '../i18n'
import { backOut, C, M, sm, Tag } from '../world/kit'
import { FINE } from '../world/tex'
import type { MicroProps } from './types'

// 硬币（损失厌恶）。
// ask：一枚大硬币立在中间，左边一摞是会输掉的 100，右边一摞是能赢的 150。弹起硬币 = 玩；把 100 收回来 = 不玩。
// 慢：硬币连抛六把，正反各半，后面那一摞净赚的钱 +150、−100 地涨上去，平均每把 +25。
// done：地上升起一架“感受的天平”。丢掉的 100 每一枚都有两倍重，150 压不住，一枚枚加到 200 才平。

const R = 0.55 // 大硬币的半径
// 这座岛的草地偏左前：右边和后面只到 1.4 左右，所以整个台子往左前挪了一点
const CX = -0.1
const CZ = -0.15
const ARM = 1.0 // 天平的臂长
const PAN = 0.4
const CR = 0.16 // 小硬币：一枚 10 块
const CT = 0.034
const POST = 1.95
const STR = 1.3
const TILT = 0.28
const NET: [number, number] = [0.42, -0.95] // 净赚的那一摞放在后面
const SEQ = [15, 5, 20, 10, 25, 15] // 正反正反正反，每一把之后净赚多少枚
const T0 = 0.08 // 慢想的时候，第一把从 p = T0 开始，每把占 TW
const TW = 0.145
const GOLD = new THREE.Color('#e6b441')
const PAIN = new THREE.Color('#8f2f3a')
const FLY = 1.3 // 访客自己那一抛，在空中的秒数
const lerp = THREE.MathUtils.lerp
const clamp = THREE.MathUtils.clamp
const ease = (t: number) => t * t * (3 - 2 * t)

function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 硬币面上的字：正、反。带一点压印的明暗
function faceTex(ch: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  const draw = () => {
    const g = c.getContext('2d')!
    g.clearRect(0, 0, 256, 256)
    g.font = '900 168px "Noto Serif SC", "Songti SC", serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = 'rgba(255,236,170,0.9)'
    g.fillText(ch, 131, 140)
    g.fillStyle = '#8a5a08'
    g.fillText(ch, 128, 136)
    t.needsUpdate = true
  }
  draw()
  document.fonts?.load('900 168px "Noto Serif SC"', ch).then(draw, () => {})
  return t
}
// 大硬币用的金色：和 kit 的 M 一样的哑光颗粒，另外带一点自发光。
// 台灯在左后方，立着的硬币正对镜头的那一面背光，不补一点就是一块发乌的圆。
const Gold = ({ color, glow = 0.2 }: { color: string; glow?: number }) => (
  <meshStandardMaterial color={color} roughness={0.74} metalness={0} normalMap={FINE()} normalMap-repeat={[3, 3]} normalScale={[0.28, 0.28]} envMapIntensity={0.7} emissive={color} emissiveIntensity={glow} />
)

type Res = null | 'H' | 'T' | 'N'
const N_LOSE = 10
const N_WIN = 15
const N_ADD = 5
const N_NET = 25
const N_ALL = N_LOSE + N_WIN + N_ADD + N_NET

export default function Coin({ phase, choose, say }: MicroProps) {
  const { camera, gl } = useThree()
  const lang = useLang()
  // 硬币两面的字跟着语言走：正 / 反，或者 H / T
  const faces = useMemo(() => ({ h: faceTex(lang === 'zh' ? '正' : 'H'), t: faceTex(lang === 'zh' ? '反' : 'T') }), [lang])
  useEffect(() => () => (faces.h.dispose(), faces.t.dispose()), [faces])
  const jit = useMemo(() => {
    const r = rng(5)
    return Array.from({ length: N_ALL }, () => [(r() - 0.5) * 0.026, (r() - 0.5) * 0.026, r() * 6.28])
  }, [])
  const root = useRef<THREE.Group>(null)
  const coin = useRef<THREE.Group>(null)
  const yaw = useRef<THREE.Group>(null)
  const flip = useRef<THREE.Group>(null)
  const coins = useRef<THREE.InstancedMesh>(null)
  const panL = useRef<THREE.Group>(null)
  const panR = useRef<THREE.Group>(null)
  const post = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Group>(null)
  const strings = useRef<(THREE.Mesh | null)[]>([])
  const tagCoin = useRef<THREE.Group>(null)
  const tagNet = useRef<THREE.Group>(null)
  const tagMore = useRef<THREE.Group>(null)
  const [res, setRes] = useState<Res>(null) // 访客自己那一下的结果：正、反、没玩
  const [face, setFace] = useState(0) // 立着转的时候，现在朝外的是哪一面
  const [sim, setSim] = useState(-1) // 慢连抛的第几把已经落地
  const [step, setStep] = useState(0)
  const [act, setAct] = useState(0) // 天平演到第几幕：1 升起 2 左边变重 3 加完了
  const [added, setAdded] = useState(0)
  const ph = useRef(phase)
  ph.current = phase
  const s = useRef({ clock: 0, mode: 'idle' as 'idle' | 'toss' | 'rest' | 'decl', mt: 0, heads: true, pull: 0, over: false, overPile: false, px: 0, pz: 0, ptx: 0, ptz: 0, pileDrag: false, x: CX, y: R, z: CZ, rx: 0, ry: 0, sc: 1, T: 0, th: 0, om: 0, swell: 0, added: 0, act: 0, face: 0, sim: -1, step: 0, hold: false, said: '' })
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), c: new THREE.Color(), a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), d: new THREE.Vector3(), ndc: new THREE.Vector2(), ray: new THREE.Raycaster() }), [])
  const off = useRef<(() => void) | null>(null)

  const hint = (r: Res) =>
    r === 'H'
      ? L('正面，赢了 150。按住慢，听它算', 'Heads, you won $150. Hold Slow to hear the math')
      : r === 'T'
        ? L('反面，输了 100。按住慢，听它算', 'Tails, you lost $100. Hold Slow to hear the math')
        : L('没玩。按住慢，听它算一算', 'You passed. Hold Slow to hear the math')
  useEffect(() => {
    const a = s.current
    if (phase === 'ask') {
      Object.assign(a, { mode: 'idle', mt: 0, pull: 0, px: 0, pz: 0, ptx: 0, ptz: 0, T: 0, th: 0, om: 0, swell: 0, added: 0, act: 0, sim: -1, step: 0 })
      setRes(null)
      setSim(-1)
      setStep(0)
      setAct(0)
      setAdded(0)
      say(L('抛一次硬币。', 'A coin toss.'))
    } else if (phase === 'done') say('')
  }, [phase, say])
  useEffect(() => () => off.current?.(), [])

  const toss = () => {
    const a = s.current
    if (a.mode !== 'idle') return
    a.mode = 'toss'
    a.mt = 0
    a.heads = Math.random() < 0.5
    say('')
    choose(0)
  }
  const decline = () => {
    const a = s.current
    if (a.mode !== 'idle') return
    a.mode = 'decl'
    a.mt = 0
    a.ptx = 0.15 // 收回来的那摞停在左前方的草地上（再往左就是沙滩了）
    a.ptz = 0.85
    setRes('N')
    say(hint('N'))
    choose(1)
  }
  const listen = (move: (e: PointerEvent) => void, up: (e: PointerEvent) => void) => {
    const end = (e: PointerEvent) => {
      off.current?.()
      up(e)
    }
    off.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      off.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }
  // 硬币：往上一弹（或点一下）是抛，往下按是不玩
  const downCoin = (e: ThreeEvent<PointerEvent>) => {
    const a = s.current
    if (ph.current !== 'ask' || a.mode !== 'idle' || off.current) return
    e.stopPropagation()
    const y0 = e.nativeEvent.clientY
    listen(
      (ev) => (a.pull = clamp((y0 - ev.clientY) / 160, -0.5, 1)),
      (ev) => {
        const dy = y0 - ev.clientY
        a.pull = 0
        if (dy < -34) decline()
        else toss()
      },
    )
  }
  // 那摞 100：拖开或点一下，就是把钱收回来
  const downPile = (e: ThreeEvent<PointerEvent>) => {
    const a = s.current
    if (ph.current !== 'ask' || a.mode !== 'idle' || off.current || !root.current) return
    e.stopPropagation()
    const p0 = root.current.worldToLocal(e.point.clone())
    const x0 = e.nativeEvent.clientX
    const y0 = e.nativeEvent.clientY
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -e.point.y)
    a.pileDrag = true
    listen(
      (ev) => {
        if (!root.current) return
        const r = gl.domElement.getBoundingClientRect()
        tmp.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
        tmp.ray.setFromCamera(tmp.ndc, camera)
        if (!tmp.ray.ray.intersectPlane(plane, tmp.d)) return
        root.current.worldToLocal(tmp.d)
        a.ptx = clamp(tmp.d.x - p0.x, -0.7, 1.2)
        a.ptz = clamp(tmp.d.z - p0.z, -0.5, 1.2)
      },
      (ev) => {
        a.pileDrag = false
        const click = Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6
        if (click || Math.hypot(a.ptx, a.ptz) > 0.3) decline()
        else a.ptx = a.ptz = 0
      },
    )
  }

  useFrame((_, raw) => {
    const a = s.current
    const slowK = 1 - 0.93 * bus.t
    const dt = Math.min(0.05, raw) * slowK
    a.clock += dt
    a.mt += dt
    const p = ph.current === 'done' ? 1 : ph.current === 'picked' ? bus.p : 0
    const done = ph.current === 'done'
    if (done) a.T += dt

    // 字幕
    if (ph.current === 'ask' && a.mode === 'idle' && a.clock > 2.4 && a.said !== 'ask') {
      a.said = 'ask'
      say(L('弹起硬币就是玩，收回 100 就是不玩', 'Flick the coin to play, or take your $100 back to pass'))
    }
    if (ph.current !== 'ask' && a.said === 'ask') a.said = ''
    const hold = ph.current === 'picked' && bus.p > 0.03
    if (hold !== a.hold) {
      a.hold = hold
      if (ph.current === 'picked' && a.mode !== 'toss') say(hold ? '' : hint(a.mode === 'decl' ? 'N' : a.heads ? 'H' : 'T'))
    }

    // ---------- 大硬币 ----------
    // 先算它“自己待着”的姿势
    let x = CX
    let y = R
    let z = CZ
    let rx = 0
    let ry = 0
    if (a.mode === 'idle') {
      // 立着慢慢转，轮流亮出两面
      const cyc = a.clock / 2.6
      const k = Math.floor(cyc)
      const f = ease(clamp((cyc - k - 0.72) / 0.28, 0, 1))
      ry = (k + f) * Math.PI
      const fc = (k + (f > 0.5 ? 1 : 0)) % 2
      if (fc !== a.face) setFace((a.face = fc))
      y = R + Math.abs(Math.sin(a.clock * 2.2)) * 0.03 + (a.over ? 0.08 : 0) + Math.max(0, a.pull) * 0.42
      rx = Math.min(0, a.pull) * 1.1
      z = CZ - Math.min(0, a.pull) * 0.3
    } else if (a.mode === 'toss') {
      const end = a.heads ? -6.5 * Math.PI : -7.5 * Math.PI
      const u = Math.min(1, a.mt / FLY)
      ry = a.heads ? 0 : Math.PI // 反面朝上落地时转半圈，字才是正着对着访客的
      y = lerp(R, 0.06, u) + 4 * 1.9 * u * (1 - u)
      z = lerp(CZ, CZ + 0.42, u)
      rx = end * (1 - (1 - u) * (1 - u) * 0.35 - (1 - u) * 0.65)
      if (u >= 1) {
        // 落地：弹两下，晃一晃
        const q = a.mt - FLY
        y = 0.06 + Math.abs(Math.sin(q * 15)) * 0.22 * Math.exp(-q * 6)
        rx = end + Math.sin(q * 26) * 0.3 * Math.exp(-q * 5.5)
        if (q > 0.75) {
          a.mode = 'rest'
          const r: Res = a.heads ? 'H' : 'T'
          setRes(r)
          if (ph.current === 'picked' && !a.hold) say(hint(r))
        }
      }
    } else if (a.mode === 'rest') {
      rx = a.heads ? -6.5 * Math.PI : -7.5 * Math.PI
      ry = a.heads ? 0 : Math.PI
      y = 0.06
      z = CZ + 0.42
    } else {
      // 没玩：硬币自己慢慢躺下
      const u = Math.min(1, a.mt / 0.7)
      const fall = u * u
      rx = -Math.PI / 2 * fall + (u >= 1 ? Math.sin((a.mt - 0.7) * 24) * 0.12 * Math.exp(-(a.mt - 0.7) * 6) : 0)
      y = lerp(R, 0.06, fall)
      z = CZ + 0.42 * fall
    }
    let scl = 1
    // 慢：连抛六把（全由 p 决定，松手会倒着退回去）
    if (p > 0 && !done) {
      const w = ease(sm(0, 0.06, p))
      let sx = 0
      let sy = R
      let syaw = 0
      const i = Math.floor((p - T0) / TW)
      const E = (n: number) => (n < 0 ? 0 : -Math.PI / 2 - 2 * Math.PI - 3 * Math.PI * n)
      if (p >= T0) {
        const n = Math.min(5, i)
        const u = clamp((p - T0 - n * TW) / (TW * 0.82), 0, 1)
        sx = lerp(E(n - 1), E(n), u)
        sy = lerp(n ? 0.06 : R, 0.06, u) + 4 * 1.15 * u * (1 - u)
        const Y = (k: number) => (k > 0 && k % 2 ? Math.PI : 0) // 单数把是反面，同样转半圈
        syaw = lerp(Y(n - 1), Y(n), ease(u))
      }
      const rr = lerp(rx, sx, w)
      x = CX
      y = lerp(y, sy, w)
      z = lerp(z, CZ + 0.1, w)
      rx = w >= 1 ? sx : rr
      ry = lerp(ry % (Math.PI * 2), syaw, w)
      const ld = p >= T0 + TW * 0.82 ? Math.min(5, Math.floor((p - T0 - TW * 0.82) / TW)) : -1
      if (ld !== a.sim) setSim((a.sim = ld))
    } else if (!done && a.sim !== -1) setSim((a.sim = -1))
    if (done) {
      // 硬币跳上天平的柱顶，当它的支点
      const u = ease(clamp(a.T / 0.9, 0, 1))
      const E5 = -Math.PI / 2 - 2 * Math.PI - 15 * Math.PI
      const top = POST * backOut(clamp(a.T / 0.9, 0, 1)) + R * 0.5 + 0.05
      x = CX
      y = lerp(0.06, top, u) + Math.sin(u * Math.PI) * 0.5
      z = lerp(CZ + 0.1, CZ, u)
      rx = lerp(E5, -18 * Math.PI, u)
      ry = lerp(Math.PI, 0, u) + Math.sin(a.clock * 0.7) * 0.5 * u // 第六把是反面，落地时转着半圈
      scl = lerp(1, 0.5, u)
    }
    const st2 = p < 0.27 ? 0 : p < 0.56 ? 1 : 2
    if (st2 !== a.step) setStep((a.step = st2))
    a.x = x
    a.y = y
    a.z = z
    if (coin.current) {
      coin.current.position.set(x, y, z)
      coin.current.scale.setScalar((R / 0.36) * scl)
    }
    if (yaw.current) yaw.current.rotation.y = ry
    if (flip.current) flip.current.rotation.x = rx
    tagCoin.current?.position.set(x + 0.05, p > 0 && !done ? lerp(y + 0.62, 2.0, sm(0, 0.08, p)) : y + 0.62, z)

    // ---------- 天平 ----------
    const rise = done ? backOut(clamp(a.T / 0.9, 0, 1)) : 0
    // 第二幕：丢掉的 100 每一枚变成两倍重
    const sw = done ? ease(clamp((a.T - 1.9) / 1.0, 0, 1)) : 0
    a.swell = sw
    const add = done ? clamp(Math.floor((a.T - 3.5) / 0.42) + 1, 0, N_ADD) : 0
    if (add !== a.added) setAdded((a.added = add))
    const ac = !done ? 0 : a.T < 1.7 ? 1 : a.T < 3.5 + 0.42 * 5 ? 2 : 3
    if (ac !== a.act) {
      setAct((a.act = ac))
      if (ac === 3) say(L('要加到 200，天平才平', 'It balances only at $200'))
    }
    const wl = 100 * (1 + sw)
    const wr = 150 + 10 * clamp(Math.floor((a.T - 3.8) / 0.42) + 1, 0, N_ADD) // 落到盘里的才算数
    const target = done && a.T > 0.75 ? clamp((wl - wr) / 50, -1, 1) * TILT : 0
    a.om += ((target - a.th) * 26 - a.om * 4.2) * dt
    a.th += a.om * dt
    if (!done) a.th = a.om = 0
    const by = POST * rise
    const yl = Math.max(0.02, by - ARM * Math.sin(a.th) - STR)
    const yr = Math.max(0.02, by + ARM * Math.sin(a.th) - STR)
    const xl = CX - ARM * Math.cos(a.th)
    const xr = CX + ARM * Math.cos(a.th)
    if (post.current) {
      post.current.visible = rise > 0.01
      post.current.scale.y = Math.max(0.001, rise)
    }
    if (beam.current) {
      beam.current.visible = rise > 0.01
      beam.current.position.set(CX, by, CZ)
      beam.current.rotation.z = a.th
    }
    panL.current?.position.set(xl, yl, CZ)
    panR.current?.position.set(xr, yr, CZ)
    // 六根吊绳：从横梁两头拉到盘沿
    strings.current.forEach((m, i) => {
      if (!m) return
      m.visible = rise > 0.05
      const left = i < 3
      const ang = ((i % 3) / 3) * Math.PI * 2 + Math.PI / 2
      tmp.a.set(left ? CX - ARM * Math.cos(a.th) : CX + ARM * Math.cos(a.th), by + (left ? -1 : 1) * ARM * Math.sin(a.th) - 0.03, CZ)
      tmp.b.set((left ? xl : xr) + Math.cos(ang) * PAN * 0.9, (left ? yl : yr) + 0.03, CZ + Math.sin(ang) * PAN * 0.9)
      tmp.d.subVectors(tmp.b, tmp.a)
      const len = tmp.d.length()
      m.position.copy(tmp.a).addScaledVector(tmp.d, 0.5)
      m.quaternion.setFromUnitVectors(tmp.up, tmp.d.normalize())
      m.scale.set(1, len, 1)
    })

    // ---------- 一枚枚小硬币 ----------
    // 那摞 100 被收回去的位置（按住慢时会自己回到盘里）
    const back = 1 - sm(0, 0.1, p)
    const fol = 1 - Math.exp(-Math.min(0.05, raw) * (a.pileDrag ? 24 : 9))
    a.px += (a.ptx - a.px) * fol
    a.pz += (a.ptz - a.pz) * fol
    const lost = a.mode === 'rest' && !a.heads ? back : 0 // 抛出反面：那 100 沉下去
    const won = a.mode === 'rest' && a.heads ? back : 0 // 抛出正面：那 150 跳一跳
    const more = st2 === 1 && !done ? Math.sin(sm(0.27, 0.56, p) * Math.PI) : 0
    // 净赚的那一摞现在有多少枚
    let net = 0
    if (p >= T0) {
      const i = Math.min(5, Math.floor((p - T0) / TW))
      const u = sm(0.82, 1, (p - T0 - i * TW) / TW)
      net = lerp(i ? SEQ[i - 1] : 0, SEQ[i], u)
    }
    const o = tmp.o
    const put = (i: number, px: number, py: number, pz: number, sy: number, sc: number, col: THREE.Color) => {
      o.position.set(px + jit[i][0], py, pz + jit[i][1])
      o.rotation.set(0, jit[i][2], 0)
      o.scale.set(sc, sc * sy, sc)
      o.updateMatrix()
      coins.current?.setMatrixAt(i, o.matrix)
      coins.current?.setColorAt(i, col)
    }
    const hopPile = a.overPile && ph.current === 'ask' && a.mode === 'idle' && !a.pileDrag ? Math.abs(Math.sin(a.clock * 6)) * 0.03 : 0
    for (let i = 0; i < N_LOSE; i++) {
      const th = 1 + sw
      tmp.c.copy(GOLD).lerp(PAIN, sw)
      const sink = lost * 0.75
      put(i, xl + a.px * back, yl + 0.03 + hopPile + (i + 0.5) * CT * th * (1 - sink), CZ + a.pz * back, th * (1 - sink), 1, tmp.c)
    }
    for (let i = 0; i < N_WIN; i++) {
      const k = N_LOSE + i
      const up = i >= 10 ? more * 0.16 : 0
      const hop = won * Math.abs(Math.sin(a.mt * 7 + i * 0.25)) * 0.07 * Math.exp(-Math.max(0, a.mt - 0.2) * 1.2)
      put(k, xr, yr + 0.03 + (i + 0.5) * CT + up + hop, CZ, 1, 1, GOLD)
    }
    for (let i = 0; i < N_ADD; i++) {
      const k = N_LOSE + N_WIN + i
      const u = done ? clamp((a.T - 3.5 - i * 0.42) / 0.3, 0, 1) : 0
      const fall = (1 - u * u) * 1.1
      put(k, xr, yr + 0.03 + (N_WIN + i + 0.5) * CT + fall, CZ, 1, u > 0 ? 1 : 0.0001, GOLD)
    }
    for (let i = 0; i < N_NET; i++) {
      const k = N_LOSE + N_WIN + N_ADD + i
      const v = clamp(net - i, 0, 1)
      put(k, NET[0], 0.02 + (i + 0.5) * CT * 1.25, NET[1], 1, v > 0 ? 1.25 * (0.6 + 0.4 * backOut(v)) : 0.0001, GOLD)
    }
    if (coins.current) {
      coins.current.instanceMatrix.needsUpdate = true
      if (coins.current.instanceColor) coins.current.instanceColor.needsUpdate = true
    }
    tagNet.current?.position.set(NET[0], 0.34 + net * CT * 1.25, NET[1])
    tagMore.current?.position.set(xr + 0.62, yr + 0.03 + 13 * CT + more * 0.16, CZ)
  })

  const asking = phase === 'ask'
  const done = phase === 'done'
  const total = sim >= 0 ? SEQ[sim] * 10 : 0
  return (
    <group ref={root}>
      {/* 大硬币：和书页上滚来滚去的那一枚是同一枚，只是把正反两面刻了出来 */}
      <group ref={coin} position={[CX, R, CZ]}>
        <group ref={yaw}>
          <group ref={flip}>
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.36, 0.36, 0.07, 48]} />
              <Gold color={C.gold} />
            </mesh>
            <mesh castShadow>
              <torusGeometry args={[0.345, 0.036, 12, 56]} />
              <Gold color="#ecc566" />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.26, 0.26, 0.085, 6]} />
              <Gold color="#d3a03c" />
            </mesh>
            <mesh position={[0, 0, 0.0435]}>
              <circleGeometry args={[0.2, 32]} />
              <meshStandardMaterial map={faces.h} transparent roughness={0.5} polygonOffset polygonOffsetFactor={-2} />
            </mesh>
            <mesh position={[0, 0, -0.0435]} rotation={[0, Math.PI, 0]}>
              <circleGeometry args={[0.2, 32]} />
              <meshStandardMaterial map={faces.t} transparent roughness={0.5} polygonOffset polygonOffsetFactor={-2} />
            </mesh>
          </group>
        </group>
        <mesh onPointerDown={downCoin} onPointerOver={() => (s.current.over = true)} onPointerOut={() => (s.current.over = false)}>
          <sphereGeometry args={[0.42, 12, 10]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <group ref={tagCoin}>
        <Tag show={phase === 'picked' && (res === 'H' || res === 'T') && sim < 0 && step === 0} tone={res === 'H' ? 'blue' : 'red'}>
          <span className="tg17">{res === 'H' ? L('正面，+150', 'Heads, +$150') : L('反面，−100', 'Tails, −$100')}</span>
        </Tag>
        <Tag show={phase === 'picked' && sim >= 0} tone={sim % 2 ? 'red' : 'blue'}>
          <span className="tg17">{sim % 2 ? L('反 −100', 'Tails −$100') : L('正 +150', 'Heads +$150')}</span>
        </Tag>
      </group>

      {/* 小硬币：一枚 10 块。左边 10 枚，右边 15 枚，后来加的 5 枚，净赚的那一摞 */}
      <instancedMesh ref={coins} args={[undefined, undefined, N_ALL]} castShadow receiveShadow frustumCulled={false}>
        <cylinderGeometry args={[CR, CR, CT * 0.9, 28]} />
        <meshStandardMaterial roughness={0.42} />
      </instancedMesh>

      {/* 两只托盘：一开始只是垫在钱下面，后来才看出是天平的两个盘 */}
      {[panL, panR].map((ref, i) => (
        <group key={i} ref={ref} position={[CX + (i ? ARM : -ARM), 0.02, CZ]}>
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[PAN, PAN * 0.86, 0.04, 40]} />
            <M color="#d8b876" rough={0.6} />
          </mesh>
          <mesh position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[PAN, 0.022, 10, 48]} />
            <M color="#c79a4e" rough={0.5} />
          </mesh>
          <mesh position={[0, 0.022, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[PAN * 0.9, 40]} />
            <M color={i ? '#3f6f58' : '#6f3f4a'} rough={1} />
          </mesh>
          {i === 0 ? (
            <>
              <Tag position={[0, 0.78, 0]} tone={asking && face === 1 ? 'red' : 'light'} show={!done && step !== 1}>
                <span className="tg16">{L('反面 输 100', 'Tails: lose $100')}</span>
              </Tag>
              <Tag position={[-0.1, 1.0, 0]} tone="dark" show={act >= 2}>
                <span className="tg16">{L('丢 100 的难受', 'Pain of losing $100')}</span>
              </Tag>
            </>
          ) : (
            <>
              <Tag position={[0, 0.95, 0]} tone={asking && face === 0 ? 'blue' : 'light'} show={!done && step !== 1}>
                <span className="tg16">{L('正面 赢 150', 'Heads: win $150')}</span>
              </Tag>
              <Tag position={[0.1, 1.12, 0]} tone={act >= 3 ? 'blue' : 'light'} show={act >= 2}>
                <span className="tg16">{L(`赢 ${150 + added * 10} 的开心`, `Joy of winning $${150 + added * 10}`)}</span>
              </Tag>
            </>
          )}
        </group>
      ))}
      <mesh position={[CX - ARM, 0.35, CZ]} onPointerDown={downPile} onPointerOver={() => (s.current.overPile = true)} onPointerOut={() => (s.current.overPile = false)}>
        <cylinderGeometry args={[0.3, 0.3, 0.7, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={tagMore}>
        <Tag show={phase === 'picked' && step === 1} tone="dark">
          <span className="tg16">{L('多 50', '$50 more')}</span>
        </Tag>
      </group>
      <group ref={tagNet}>
        <Tag show={sim >= 0 && !(done || sim === 5)} tone="light">
          <span className="tg16">{L(`净赚 ${total}`, `Net +$${total}`)}</span>
        </Tag>
        <Tag show={done || (phase === 'picked' && sim === 5)} tone="dark">
          <span className="tg16">{L('平均每把 +25', 'Avg. +$25 a toss')}</span>
        </Tag>
      </group>

      {/* 天平：柱子、横梁、吊绳。done 之后才从地里升起来 */}
      <group ref={post} position={[CX, 0, CZ]} visible={false}>
        <mesh position={[0, POST / 2, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.07, POST, 16]} />
          <M color="#8a5a3c" rough={0.8} />
        </mesh>
        <mesh position={[0, 0.04, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.3, 0.08, 28]} />
          <M color="#7a4d32" rough={0.8} />
        </mesh>
      </group>
      <group ref={beam} visible={false}>
        <RoundedBox args={[ARM * 2 + 0.14, 0.075, 0.095]} radius={0.03} smoothness={4} castShadow>
          <M color="#a06b45" rough={0.75} />
        </RoundedBox>
        <mesh castShadow>
          <sphereGeometry args={[0.085, 16, 12]} />
          <M color={C.gold} rough={0.45} />
        </mesh>
        {[-ARM, ARM].map((x) => (
          <mesh key={x} position={[x, -0.03, 0]}>
            <sphereGeometry args={[0.045, 12, 10]} />
            <M color="#c79a4e" rough={0.5} />
          </mesh>
        ))}
      </group>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i} ref={(el) => void (strings.current[i] = el)} visible={false}>
          <cylinderGeometry args={[0.009, 0.009, 1, 6]} />
          <M color="#5d4634" rough={1} />
        </mesh>
      ))}
    </group>
  )
}
