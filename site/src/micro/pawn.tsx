import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bus } from '../bus'
import { L, TOUCH, useLang } from '../i18n'
import { backOut, C, Meeple, sm, Tag } from '../world/kit'
import type { MicroProps } from './types'

// Alan 和 Ben（光环效应）：两个一模一样的小人，六个词一张张报出来，顺序相反。
// 先到的词分量最重：Alan 头上长出光环，Ben 头上聚起乌云。
// 访客点其中一个人，或点中间的“一样”。按住慢之后，两摞词卡对齐，一张张对上，两个人合成一个。
// 性能：十二张词卡是两个 InstancedMesh（卡身一个、字面一个），六个词画在同一张贴图上。

// 这座岛的草地前半截窄（z > 0.2 处左边只到 x = -1.1），后半截宽（z = -0.4 处是 -1.5 到 1.4）。
// 所以整个场景往后挪：两个人站在宽的那一截，脚下都是平地；也离右前方的慢和它头顶的纸签远一点。
const CX = -0.25 // 整个场景的中线
const PX = 0.98 // 两个人离中线多远
const PZ = -0.4
const CZ = -1.1 // 词卡所在的深度
const PS = 1.3 // 小人的大小
const MEET: [number, number] = [CX, 0.17] // “一样”的位置，最后两个人在这里合成一个
const rowY = (i: number) => 2.1 - i * 0.27
const PAWN = '#2d3d3a' // 棋子的颜色：比色板里的墨色提亮一档，黄昏的光下不至于糊成两块纯黑
const cl = (x: number) => Math.min(1, Math.max(0, x))
const ez = (x: number) => {
  const t = cl(x)
  return t * t * (3 - 2 * t)
}
const T0 = 1.3 // 第一张词卡出现的时间
const GAP = 0.62 // 每张隔多久
const ALL = T0 + 5 * GAP + 0.75 // 六张都落定

// 六个词画在一张贴图上，一行一个；字太长就缩小。wide 是一行的宽度，要和卡面的长宽比一致，不然字会被横向拉宽
function wordsTex(words: string[], W: number) {
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = 144 * 6
  const g = cv.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, cv.width, cv.height)
  g.fillStyle = C.ink
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  words.forEach((w, i) => {
    let size = 84
    g.font = `900 ${size}px 'Fraunces Variable','Noto Serif SC','Songti SC',Georgia,serif`
    const wide = g.measureText(w).width
    if (wide > W * 0.9) g.font = `900 ${(size = Math.floor((size * W * 0.9) / wide))}px 'Fraunces Variable','Noto Serif SC','Songti SC',Georgia,serif`
    g.fillText(w, W / 2, i * 144 + 76)
  })
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

const heartGeo = () => {
  const s = new THREE.Shape()
  s.moveTo(0, -0.5)
  s.bezierCurveTo(-0.7, -0.05, -0.55, 0.55, -0.22, 0.5)
  s.bezierCurveTo(-0.08, 0.48, 0, 0.36, 0, 0.26)
  s.bezierCurveTo(0, 0.36, 0.08, 0.48, 0.22, 0.5)
  s.bezierCurveTo(0.55, 0.55, 0.7, -0.05, 0, -0.5)
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 3, curveSegments: 10 })
  g.center()
  return g
}
// 一小团乌云
const cloudGeo = () => {
  const gs = ([[0, 0, 0, 0.15], [0.12, 0.02, 0.02, 0.11], [-0.12, 0.01, 0.03, 0.12], [0.02, 0.09, -0.02, 0.11], [0.03, 0, 0.1, 0.1]] as const).map(([x, y, z, r]) => new THREE.SphereGeometry(r, 12, 9).translate(x, y, z))
  const out = mergeGeometries(gs)
  gs.forEach((g) => g.dispose())
  return out
}

export default function Pawn({ c, phase, pick, choose, say, read }: MicroProps) {
  const lang = useLang()
  const CW = lang === 'zh' ? 0.5 : 0.66 // 英文的词长，卡片宽一点
  const GX = lang === 'zh' ? 0.17 : 0.1 // 两摞之间留的缝（一半）。英文的卡宽，缝收窄一点，外沿才不会顶到两个人头上的光环和乌云
  const res = useMemo(() => {
    // 六个词就取自慢的那句推算
    const words = c.slow[1].replace(/[。.]/g, '').split(/、|,\s*/).map((w) => w.trim().toLowerCase())
    const face = new THREE.PlaneGeometry(CW * 0.9, 0.2025).translate(0, 0, 0.0185)
    // 每张卡用贴图上的哪一行：0–5 是 Alan 的，6–11 是 Ben 的（倒过来）
    face.setAttribute('aRow', new THREE.InstancedBufferAttribute(Float32Array.from({ length: 12 }, (_, n) => 5 - (n < 6 ? n : 11 - n)), 1))
    // 词卡正对镜头，背着台灯：只靠灯光的话是一摞灰牌子，叠在后面那座岛的树上读不清。
    // 给纸面加一点自己的亮度（照样乘上每张卡自己的深浅，后报的词还是暗一档）。
    const tex = wordsTex(words, Math.round((144 * CW * 0.9) / 0.2025))
    const lit = '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif'
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.5 })
    faceMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'attribute float aRow;\nvoid main() {').replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv.y = ( vMapUv.y + aRow ) / 6.0;\n\tvEmissiveMapUv.y = ( vEmissiveMapUv.y + aRow ) / 6.0;')
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', lit)
    }
    faceMat.customProgramCacheKey = () => 'pawn-face'
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.85, emissive: '#ffffff', emissiveIntensity: 0.42 })
    bodyMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', lit)
    }
    bodyMat.customProgramCacheKey = () => 'pawn-body'
    return { body: new RoundedBoxGeometry(CW, 0.235, 0.035, 3, 0.016), face, faceMat, bodyMat, heart: heartGeo(), cloud: cloudGeo(), bars: mergeGeometries([new RoundedBoxGeometry(0.3, 0.03, 0.06, 2, 0.012).translate(0, 0.06, -0.06), new RoundedBoxGeometry(0.3, 0.03, 0.06, 2, 0.012).translate(0, 0.06, 0.06)]) }
  }, [c, CW])
  useEffect(
    () => () => {
      res.faceMat.map?.dispose()
      Object.values(res).forEach((x) => x.dispose())
    },
    [res],
  )

  const bodies = useRef<THREE.InstancedMesh>(null)
  const faces = useRef<THREE.InstancedMesh>(null)
  const alan = useRef<THREE.Group>(null)
  const ben = useRef<THREE.Group>(null)
  const halo = useRef<THREE.Mesh>(null)
  const cloud = useRef<THREE.Mesh>(null)
  const heart = useRef<THREE.Mesh>(null)
  const pad = useRef<THREE.Group>(null)
  const s = useRef({ T: 0, since: 0, hv: [0, 0, 0] })
  const [beat, setBeat] = useState(0) // 0 开场，1 词卡在报，2 报完了
  const [hov, setHov] = useState<number | null>(null)
  const [bits, setBits] = useState(0)
  const bitsR = useRef(0)
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), a: new THREE.Color(C.white), b: new THREE.Color('#b9b3a6'), hit: new THREE.Color(C.blue).lerp(new THREE.Color('#ffffff'), 0.7), t: new THREE.Color() }), [])

  // 先给每张卡一个颜色，这样第一帧编译材质时就带上“每个实例一个颜色”
  useLayoutEffect(() => {
    for (const m of [bodies.current, faces.current]) {
      if (!m) continue
      for (let n = 0; n < 12; n++) m.setColorAt(n, tmp.a)
      m.instanceColor!.needsUpdate = true
    }
  }, [tmp, res])

  const quiet = !!(bits & 1)
  // 手机竖屏上词卡太小：报词开始以后，把两个人的六个词另排一张纸卡（顺序和词卡一样，Ben 的倒过来）
  useEffect(() => {
    if (!read) return
    const words = c.slow[1].replace(/[。.]/g, '').split(/、|,\s*/).map((w) => w.trim().toLowerCase())
    read(beat >= 1 && phase !== 'done' ? { cols: [{ h: c.opts[0], items: words }, { h: c.opts[1], items: [...words].reverse() }] } : null)
  }, [beat, phase, c, read, lang])
  useEffect(() => {
    if (phase === 'ask') say(beat < 2 ? L('两个人，各有六个形容词。', 'Two people. Six words about each.') : L('你对谁更有好感？点他。', TOUCH ? 'Who do you like better? Tap him.' : 'Who do you like better? Click him.'))
    else if (phase === 'picked') say(quiet ? '' : pick === 2 ? L('你觉得他们一样。', 'You think they are the same.') : L(`你对 ${c.opts[pick ?? 0]} 更有好感。`, `You like ${c.opts[pick ?? 0]} better.`))
    else say('')
  }, [phase, beat, pick, quiet, c, say, lang])

  useFrame((_, rawDt) => {
    const a = s.current
    const dt = Math.min(0.05, rawDt) * (1 - 0.93 * bus.t)
    // 访客要是没等报完就选了，剩下的词快点报完
    if (bus.micro.k > 0.75) a.T += dt * (phase !== 'ask' && a.T < ALL ? 5 : 1)
    if (phase !== 'ask') a.since += dt
    const T = a.T
    const p = phase === 'done' ? 1 : phase === 'picked' ? bus.p : 0
    const nb = T > ALL ? 2 : T > T0 ? 1 : 0
    if (nb !== beat) setBeat(nb)
    const b = (p > 0.04 ? 1 : 0) | (p > 0.93 ? 2 : 0)
    if (b !== bitsR.current) setBits((bitsR.current = b))

    const join = sm(0.03, 0.2, p) // 两摞靠到一起，大小也变回一样
    const gone = sm(0.62, 0.86, p) // 光环和乌云散掉
    const merge = ez((p - 0.84) / 0.14) // 两个人走到一起

    // 词卡
    const bm = bodies.current
    const fm = faces.current
    if (bm && fm) {
      for (let n = 0; n < 12; n++) {
        const isB = n >= 6
        const r = isB ? n - 6 : n // 报出来的次序，也是一开始所在的行
        const side = isB ? 1 : -1
        const t = T - T0 - r * GAP
        const pop = backOut(t / 0.2)
        const fly = ez((t - 0.34) / 0.34)
        // 倒过来：Ben 的第 r 张挪到第 5 - r 行
        const rev = isB ? ez((p - 0.24 - r * 0.025) / 0.2) : 0
        const row = isB ? 5 - r : r // 对齐以后所在的行
        const hit = ez((p - 0.6 - row * 0.045) / 0.08) // 这一行对上了
        const weight = (1 - 0.055 * r) * (1 - join) + join
        const sx = CX + side * (CW / 2 + GX - (GX - 0.02) * join) * (1 - hit) + side * Math.sin(rev * Math.PI) * (0.2 + 0.07 * Math.abs(5 - 2 * r))
        const sy = rowY(r) + (rowY(5 - r) - rowY(r)) * rev
        const sz = CZ + Math.sin(rev * Math.PI) * 0.12 * (r < 3 ? 1 : -1) - (isB ? 0.012 * hit : 0)
        // 先在这个人头顶冒出来，再飞进自己那一摞
        const hx = CX + side * PX
        tmp.o.position.set(hx + (sx - hx) * fly, 1.62 + (sy - 1.62) * fly + Math.sin(fly * Math.PI) * 0.12, PZ + (sz - PZ) * fly)
        tmp.o.rotation.set(-0.12, 0, 0)
        tmp.o.scale.setScalar(Math.max(0.0001, pop * (1 + (weight - 1) * fly) * (1 + 0.16 * Math.sin(hit * Math.PI))))
        tmp.o.updateMatrix()
        bm.setMatrixAt(n, tmp.o.matrix)
        fm.setMatrixAt(n, tmp.o.matrix)
        tmp.t.copy(tmp.a).lerp(tmp.b, (r / 5) * 0.8 * (1 - join) * fly).lerp(tmp.hit, Math.sin(hit * Math.PI) * 0.8)
        bm.setColorAt(n, tmp.t)
        fm.setColorAt(n, tmp.t)
      }
      bm.instanceMatrix.needsUpdate = fm.instanceMatrix.needsUpdate = true
      bm.instanceColor!.needsUpdate = fm.instanceColor!.needsUpdate = true
    }

    // 两个人
    const first = backOut((T - T0 - 0.12) / 0.45)
    for (let i = 0; i < 3; i++) a.hv[i] += ((phase === 'ask' && hov === i ? 1 : 0) - a.hv[i]) * Math.min(1, rawDt * 12)
    const hop = (i: number) => (phase !== 'ask' && (pick === i || pick === 2) && a.since < 0.5 ? Math.sin((a.since / 0.5) * Math.PI) * 0.16 : 0)
    if (alan.current) {
      alan.current.position.set(CX - PX + (MEET[0] - (CX - PX)) * merge, hop(0) + a.hv[0] * 0.06 + Math.sin(merge * Math.PI) * 0.1, PZ + (MEET[1] - PZ) * merge)
      alan.current.rotation.y = 0.28 * (1 - merge)
    }
    if (ben.current) {
      ben.current.position.set(CX + PX + (MEET[0] - (CX + PX)) * merge, hop(1) + a.hv[1] * 0.06 + Math.sin(merge * Math.PI) * 0.1, PZ + (MEET[1] - PZ) * merge - 0.002)
      ben.current.rotation.y = -0.28 * (1 - merge)
      ben.current.rotation.x = 0.1 * cl(first) * (1 - gone) // 垂着一点头
      ben.current.visible = merge < 0.999 // 合成一个以后只留一个
    }
    if (halo.current) {
      halo.current.scale.setScalar(Math.max(0.0001, first * (1 - gone)))
      halo.current.position.y = 0.96 + Math.sin(T * 2) * 0.025
      halo.current.rotation.z = T * 0.6
    }
    if (cloud.current) {
      cloud.current.scale.setScalar(Math.max(0.0001, first * (1 - gone)))
      cloud.current.position.x = Math.sin(T * 0.9) * 0.03
    }
    if (heart.current) {
      const on = phase !== 'ask' ? backOut(a.since / 0.4) * (1 - sm(0.5, 0.7, p)) : 0
      heart.current.scale.setScalar(Math.max(0.0001, on * 0.2 * (1 + 0.08 * Math.sin(T * 5))))
      heart.current.position.y = (pick === 2 ? 0.75 : 1.92) + Math.sin(T * 2.2) * 0.03
    }
    if (pad.current) pad.current.position.y = a.hv[2] * 0.03
  })

  const can = phase === 'ask' && beat >= 1
  const over = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (can) setHov(i)
  }
  const out = (i: number) => () => setHov((h) => (h === i ? null : h))
  const click = (i: number) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (!can) return
    setHov(null)
    choose(i)
  }
  const done = phase === 'done'
  const end = done || !!(bits & 2)
  const names = phase === 'ask' ? beat >= 1 : !end
  const hx = pick === 0 ? CX - PX : pick === 1 ? CX + PX : MEET[0]
  const on = (i: number) => hov === i || (phase !== 'ask' && pick === i)

  return (
    <group>
      {/* Alan：先听到好词，头上长出光环 */}
      <group ref={alan} position={[CX - PX, 0, PZ]} scale={PS}>
        <Meeple color={PAWN}>
          <mesh ref={halo} position={[0, 0.96, 0]} rotation={[Math.PI / 2 - 0.22, 0, 0]} scale={0.0001}>
            <torusGeometry args={[0.18, 0.03, 10, 32]} />
            <meshStandardMaterial color={C.gold} emissive={C.gold} emissiveIntensity={0.6} roughness={0.35} />
          </mesh>
        </Meeple>
      </group>
      {/* Ben：先听到坏词，头上聚起乌云 */}
      <group ref={ben} position={[CX + PX, 0, PZ]} scale={PS}>
        <Meeple color={PAWN}>
          <mesh ref={cloud} geometry={res.cloud} position={[0, 1.02, 0]} scale={0.0001}>
            <meshStandardMaterial color="#585d68" roughness={0.95} />
          </mesh>
        </Meeple>
      </group>

      {/* 十二张词卡 */}
      <instancedMesh ref={bodies} args={[res.body, res.bodyMat, 12]} castShadow frustumCulled={false} />
      <instancedMesh ref={faces} args={[res.face, res.faceMat, 12]} frustumCulled={false} />

      {/* 中间的“一样” */}
      <group ref={pad} position={[MEET[0], 0, MEET[1]]}>
        <mesh position={[0, 0.025, 0]} receiveShadow>
          <cylinderGeometry args={[0.34, 0.37, 0.05, 32]} />
          <meshStandardMaterial color={C.cream} roughness={0.8} />
        </mesh>
        <mesh geometry={res.bars}>
          <meshStandardMaterial color={on(2) ? C.blue : C.ink} roughness={0.6} />
        </mesh>
      </group>

      {/* 好感 */}
      <mesh ref={heart} geometry={res.heart} position={[hx, 1.92, pick === 2 ? MEET[1] : PZ]} scale={0.0001}>
        <meshStandardMaterial color={C.red} roughness={0.55} emissive={C.red} emissiveIntensity={0.15} />
      </mesh>

      {/* 点得到的范围（不画出来） */}
      {phase === 'ask' && (
        <>
          {[-1, 1].map((sd, i) => (
            <mesh key={sd} position={[CX + sd * PX, 0.75, PZ]} onPointerOver={over(i)} onPointerOut={out(i)} onClick={click(i)}>
              <cylinderGeometry args={[0.4, 0.4, 1.6, 10]} />
              <meshBasicMaterial visible={false} />
            </mesh>
          ))}
          <mesh position={[MEET[0], 0.12, MEET[1]]} onPointerOver={over(2)} onPointerOut={out(2)} onClick={click(2)}>
            <cylinderGeometry args={[0.44, 0.44, 0.3, 12]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        </>
      )}

      {/* 名字像胸牌一样别在身上：放在脚边的话，右边那张会钻到慢头顶“按住我”的纸签底下 */}
      <Tag position={[CX - PX, 0.4, PZ + 0.24]} tone={on(0) ? 'blue' : 'light'} show={names}>
        {c.opts[0]}
      </Tag>
      <Tag position={[CX + PX, 0.4, PZ + 0.24]} tone={on(1) ? 'blue' : 'light'} show={names}>
        {c.opts[1]}
      </Tag>
      <Tag position={[MEET[0], -0.02, MEET[1] + 0.52]} tone={on(2) ? 'blue' : 'light'} show={phase === 'ask' ? beat >= 1 : !end}>
        {c.opts[2]}
      </Tag>
      <Tag position={[MEET[0], -0.02, MEET[1] + 0.52]} tone="blue" show={end}>
        {`${c.opts[0]} = ${c.opts[1]}`}
      </Tag>
    </group>
  )
}
