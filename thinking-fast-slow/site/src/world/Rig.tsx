import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { bus } from '../bus'
import { MICRO } from '../micro/registry'
import { HARE_SPOT, ISLE_TOP, MICRO_SCALE, SLOW_POS } from '../scenes'
import { sm } from './kit'

// 镜头：合着的书 → 俯瞰整片地 → 俯冲进某个案例的微观世界。顺便算出每帧要用的屏幕位置。
export default function Rig() {
  const { camera, size, gl } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  const mp = useMemo(() => new THREE.Vector3(), [])
  const ml = useMemo(() => new THREE.Vector3(), [])
  const ip = useMemo(() => new THREE.Vector3(), [])
  const il = useMemo(() => new THREE.Vector3(), [])
  const ic = useMemo(() => ({ on: false, p: new THREE.Vector3(), l: new THREE.Vector3() }), [])
  useFrame((_, dt) => {
    bus.open += (bus.openT - bus.open) * (1 - Math.exp(-dt * 4.5))
    if (Math.abs(bus.openT - bus.open) < 0.0005) bus.open = bus.openT
    const m = bus.micro
    m.k += ((m.id ? 1 : 0) - m.k) * (1 - Math.exp(-dt * 3.4))
    if (Math.abs((m.id ? 1 : 0) - m.k) < 0.0008) m.k = m.id ? 1 : 0
    const o = bus.open
    const asp = size.width / size.height
    const k = sm(0.42, 1, o)
    // 窗口越窄，镜头退得越远，保证整本书都在画面里
    // 竖屏：书顶满屏宽（纸边可以裁掉一点），镜头抬高一些往下看，让小岛在屏幕上尽量大
    const tall = sm(1.25, 0.65, asp)
    const f = THREE.MathUtils.clamp(1.6 / asp, 1, 4) * (1 - 0.15 * tall)
    // 合着的书：稍高一点俯看封面。翻开以后：压低到三十多度，小岛才有高度和前后层次
    bus.cam.look.set(THREE.MathUtils.lerp(0.4, 0, k), 0, THREE.MathUtils.lerp(0.5, 0.55 - 0.9 * tall, k))
    // 合着的书只有跨页一半宽：竖屏上按封面取景（书更大），翻开的过程中再退到能放下整个跨页的距离
    const F = THREE.MathUtils.lerp(THREE.MathUtils.clamp(0.95 / asp, 1, 4), f, k)
    bus.cam.pos.set(THREE.MathUtils.lerp(0.4, 0, k), THREE.MathUtils.lerp(15.5, 11.4 * (1 + 0.32 * tall), k) * F, bus.cam.look.z + THREE.MathUtils.lerp(16.0, 15.0 * (1 - 0.3 * tall), k) * F)
    // 开场介绍的特写：合影 → 兔子 → 乌龟。三个机位之间平滑地摇过去，介绍结束再拉回俯瞰
    const I = bus.intro
    I.k += ((I.on ? 1 : 0) - I.k) * (1 - Math.exp(-dt * 2.6))
    if (Math.abs((I.on ? 1 : 0) - I.k) < 0.0008) I.k = I.on ? 1 : 0
    if (I.k > 0.0005) {
      const [ix, iz] = SLOW_POS
      const hx = ix + HARE_SPOT[0]
      const hz = iz + HARE_SPOT[1]
      const S = [
        { p: [ix - 1.3, 1.85, iz + 4.5], l: [ix - 0.62, 0.36, iz + 0.25] },
        { p: [hx - 0.45, 1.02, hz + 2.75], l: [hx + 0.12, 0.47, hz] },
        { p: [ix - 0.75, 1.3, iz + 3.5], l: [ix - 0.28, 0.4, iz + 0.3] },
      ][I.shot - 1]
      const far = 1 + 0.85 * tall
      il.set(S.l[0], S.l[1], S.l[2])
      ip.set(S.l[0] + (S.p[0] - S.l[0]) * far, S.l[1] + (S.p[1] - S.l[1]) * far, S.l[2] + (S.p[2] - S.l[2]) * far)
      if (!ic.on) {
        ic.on = true
        ic.p.copy(ip)
        ic.l.copy(il)
      }
      const a = 1 - Math.exp(-dt * 2.2)
      ic.p.lerp(ip, a)
      ic.l.lerp(il, a)
      const e = sm(0, 1, I.k)
      bus.cam.pos.lerp(ic.p, e)
      bus.cam.look.lerp(ic.l, e)
    } else ic.on = false
    if (m.k > 0.0005 && m.last && MICRO[m.last]) {
      const c = MICRO[m.last].cam
      const far = 1 + 1.75 * tall
      const S = MICRO_SCALE
      mp.set(m.ox + c.pos[0] * far * S, ISLE_TOP + c.pos[1] * far * S, m.oz + c.pos[2] * far * S)
      ml.set(m.ox + c.look[0] * S, ISLE_TOP + c.look[1] * S, m.oz + c.look[2] * S)
      const e = sm(0, 1, m.k)
      bus.cam.pos.lerp(mp, e)
      bus.cam.look.lerp(ml, e)
    }
    camera.position.copy(bus.cam.pos)
    camera.lookAt(bus.cam.look)
    camera.updateMatrixWorld()
    const P = (x: number, y: number, z: number) => {
      v.set(x, y, z).project(camera)
      return [(v.x * 0.5 + 0.5) * size.width, (-v.y * 0.5 + 0.5) * size.height]
    }
    const w = window as unknown as { __proj: unknown; __bus: unknown }
    w.__proj = P
    w.__bus = bus
    ;(w as unknown as { __frames: number }).__frames = ((w as unknown as { __frames?: number }).__frames ?? 0) + 1
    bus.warm = (w as unknown as { __frames: number }).__frames < 10
    // 后期处理一帧里要画好几遍；自己累计再清零，才是这一帧真实的绘制量
    gl.info.autoReset = false
    ;(w as unknown as { __info: unknown }).__info = { calls: gl.info.render.calls, triangles: gl.info.render.triangles }
    gl.info.reset()
    const [sx, sy] = P(bus.slowPos.x, 0.6 - 0.3 * m.k, bus.slowPos.z)
    bus.slow.x = sx
    bus.slow.y = sy
    const root = document.documentElement.style
    root.setProperty('--cx', `${sx.toFixed(0)}px`)
    root.setProperty('--cy', `${sy.toFixed(0)}px`)
    const id = m.id ? null : bus.hover
    const a = id ? bus.pos[id] : null
    if (a && o > 0.98 && m.k < 0.05) {
      const [x0, y0] = P(a.x, 0, a.z)
      const [, y1] = P(a.x, a.h, a.z)
      const [x2] = P(a.x + a.r, 0, a.z)
      const bw = Math.abs(x2 - x0) * 2 + 18
      const bh = Math.abs(y0 - y1) + Math.abs(x2 - x0) * 0.7 + 18
      Object.assign(bus.sel, { on: true, x: x0, y: y0 + Math.abs(x2 - x0) * 0.35 + 9 - bh / 2, w: bw, h: bh })
    } else bus.sel.on = false
  })
  return null
}
