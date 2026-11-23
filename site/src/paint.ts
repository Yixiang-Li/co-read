import * as THREE from 'three'
import { TD, TW } from './world/kit'

// 用代码画出来的贴图：一片像水彩画的地（田块、河、小路，边缘像颜料晕开），和书的封面。
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// —— 地 ——
// 贴图比地多出一圈（LAND_M），给晕开的边和喷溅的颗粒留位置。
// 颜色通道是画；透明度通道不是透明度，而是“离颜料边缘有多远”，
// 真正的边缘在着色器里现算（这样近看也有颗粒，还能做出颜料慢慢晕开的动画）。
export const LAND_M = 0.8
// 河和小路的走向。着色器里有一份一样的公式（河面的流动要用）。
export const riverX = (z: number) => {
  const t = Math.min(1, Math.max(0, (z + 0.6) / 2))
  return -3.48 + 0.5 * Math.sin(0.9 * z + 2.3) * (1 - t * t * (3 - 2 * t)) + 0.1 * Math.sin(1.9 * z + 0.7)
}
export const pathX = (z: number) => 0.13 * Math.sin(0.85 * z + 0.4)

type RGB = [number, number, number]
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const mixc = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`

// 一张可以平铺的随机表，比每个像素都算 sin 快得多
const NT = 256
let tile: Float32Array | null = null
const ns = (x: number, y: number) => {
  if (!tile) {
    tile = new Float32Array(NT * NT)
    const q = rng(77)
    for (let i = 0; i < NT * NT; i++) tile[i] = q()
  }
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const x0 = xi & 255
  const x1 = (xi + 1) & 255
  const y0 = (yi & 255) * NT
  const y1 = ((yi + 1) & 255) * NT
  return lerp(lerp(tile[y0 + x0], tile[y0 + x1], u), lerp(tile[y1 + x0], tile[y1 + x1], u), v)
}

// 把多边形的边揉皱：每条边取中点再随机推一下，重复几次
function crumple(pts: number[][], depth: number, amp: number, r: () => number) {
  let cur = pts
  for (let d = 0; d < depth; d++) {
    const nx: number[][] = []
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]
      const b = cur[(i + 1) % cur.length]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const k = Math.min(len * 0.22, amp) * (r() + r() + r() - 1.5) * 0.9
      const ang = r() * Math.PI * 2
      nx.push(a, [(a[0] + b[0]) / 2 + Math.cos(ang) * k, (a[1] + b[1]) / 2 + Math.sin(ang) * k])
    }
    cur = nx
  }
  return cur
}
const trace = (g: CanvasRenderingContext2D, pts: number[][]) => {
  g.beginPath()
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
  g.closePath()
}
// 一笔：几根并排的刷毛，深浅不一，两头参差
function brush(g: CanvasRenderingContext2D, r: () => number, x: number, y: number, ang: number, len: number, w: number, col: RGB, a: number) {
  const nb = 4 + Math.floor(r() * 5)
  const cx = Math.cos(ang)
  const sy = Math.sin(ang)
  const bend = (r() - 0.5) * len * 0.22
  for (let j = 0; j < nb; j++) {
    const off = ((j + 0.5) / nb - 0.5) * w + (r() - 0.5) * w * 0.14
    const s0 = r() * len * 0.2
    const s1 = len - r() * len * 0.2
    g.strokeStyle = css(col, a * (0.3 + r() * 1.0))
    g.lineWidth = (w / nb) * (0.8 + r() * 1.0)
    g.beginPath()
    g.moveTo(x + cx * s0 - sy * off, y + sy * s0 + cx * off)
    g.quadraticCurveTo(x + cx * len * 0.5 - sy * (off + bend), y + sy * len * 0.5 + cx * (off + bend), x + cx * s1 - sy * off, y + sy * s1 + cx * off)
    g.stroke()
  }
}

export function paintLand() {
  const W = 2560
  const ppu = W / (TW + LAND_M * 2) // 每个世界单位多少像素
  const H = Math.round((TD + LAND_M * 2) * ppu)
  const X = (x: number) => (x + TW / 2 + LAND_M) * ppu
  const Z = (z: number) => (z + TD / 2 + LAND_M) * ppu
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const r = rng(11)
  g.lineCap = 'round'
  g.lineJoin = 'round'

  // 1 底色：一层淡淡的黄绿
  g.fillStyle = '#c3dd92'
  g.fillRect(0, 0, W, H)

  // 2 田块：每块是很多层半透明、边缘各不相同的色块叠起来的（水彩的叠色）
  const fields: { col: string; ang: number; pts: number[][]; rows?: string }[] = [
    { col: '#b4d886', ang: -0.25, pts: [[-8, -5.5], [-3.3, -5.5], [-3.2, 0.25], [-8, 0.65]] },
    { col: '#a3d29b', ang: 0.35, pts: [[-8, 0.65], [-3.2, 0.25], [-3.5, 5.5], [-8, 5.5]] },
    { col: '#cfe08a', ang: 0.1, pts: [[-3.3, -5.5], [0, -5.5], [0, -1.32], [-3.2, -0.92]], rows: '#a9c96e' },
    { col: '#a5d07c', ang: -0.4, pts: [[-3.2, -0.92], [0, -1.32], [0, 1.92], [-3.4, 1.72]] },
    { col: '#bbdc92', ang: 0.2, pts: [[-3.4, 1.72], [0, 1.92], [0, 5.5], [-3.5, 5.5]] },
    { col: '#aed684', ang: -0.15, pts: [[0, -5.5], [3.15, -5.5], [2.7, -0.9], [0, -1.32]] },
    { col: '#95c88e', ang: 0.5, pts: [[3.15, -5.5], [8, -5.5], [8, -0.45], [2.7, -0.9]] },
    { col: '#c6df8c', ang: -0.05, pts: [[0, -1.32], [2.7, -0.9], [8, -0.45], [8, 1.1], [3.3, 1.55], [0, 1.92]] },
    { col: '#d2e4a4', ang: 0.3, pts: [[3.3, 1.55], [8, 1.1], [8, 5.5], [5.5, 5.5]] },
    { col: '#efdc8e', ang: -0.95, pts: [[3.3, 1.55], [5.5, 5.5], [0.8, 5.5]], rows: '#d9bd62' },
    { col: '#a1ce86', ang: -0.3, pts: [[0, 1.92], [3.3, 1.55], [0.8, 5.5], [0, 5.5]] },
  ]
  const LIGHT: RGB = [255, 253, 226]
  const WARM: RGB = [246, 226, 120]
  const COOL: RGB = [110, 190, 160]
  const DEEP: RGB = [52, 118, 70]
  for (const f of fields) {
    const col = hex(f.col)
    const px = f.pts.map(([x, z]) => [X(x), Z(z)])
    const base = crumple(px, 3, 26, r)
    for (let l = 0; l < 20; l++) {
      g.fillStyle = css(mixc(col, l % 3 ? col : l % 2 ? WARM : COOL, 0.1), 0.11)
      trace(g, crumple(base, 3, 20, r))
      g.fill()
    }
    // 只在这块田里落笔
    g.save()
    trace(g, base)
    g.clip()
    const xs = px.map((p) => p[0])
    const ys = px.map((p) => p[1])
    const x0 = Math.max(0, Math.min(...xs))
    const x1 = Math.min(W, Math.max(...xs))
    const y0 = Math.max(0, Math.min(...ys))
    const y1 = Math.min(H, Math.max(...ys))
    const area = (x1 - x0) * (y1 - y0)
    // 水渍：中间淡、边上积一圈颜料
    for (let i = 0; i < area / 90000; i++) {
      const bx = lerp(x0, x1, r())
      const by = lerp(y0, y1, r())
      const br = 70 + r() * 190
      const gr = g.createRadialGradient(bx, by, br * 0.1, bx, by, br)
      const lite = mixc(col, r() > 0.5 ? LIGHT : WARM, 0.5)
      gr.addColorStop(0, css(lite, 0.2))
      gr.addColorStop(0.72, css(lite, 0.1))
      gr.addColorStop(0.9, css(mixc(col, DEEP, 0.4), 0.13))
      gr.addColorStop(1, css(mixc(col, DEEP, 0.4), 0))
      g.fillStyle = gr
      g.save()
      g.translate(bx, by)
      g.rotate(r() * 3)
      g.scale(1, 0.55 + r() * 0.4)
      g.translate(-bx, -by)
      g.fillRect(bx - br, by - br, br * 2, br * 2)
      g.restore()
    }
    // 大笔触：顺着这块田自己的方向
    for (let i = 0; i < area / 5200; i++) {
      const k = r()
      const tone = k < 0.4 ? mixc(col, LIGHT, 0.5) : k < 0.72 ? mixc(col, DEEP, 0.34) : k < 0.86 ? mixc(col, WARM, 0.4) : mixc(col, COOL, 0.35)
      const len = 150 + r() * 330
      brush(g, r, lerp(x0, x1, r()) - len / 2, lerp(y0, y1, r()), f.ang + (r() - 0.5) * 0.34, len, 22 + r() * 44, tone, 0.1)
    }
    // 干笔：细一点、短一点
    for (let i = 0; i < area / 2600; i++) {
      const tone = r() < 0.5 ? mixc(col, LIGHT, 0.62) : mixc(col, DEEP, 0.42)
      const len = 50 + r() * 130
      brush(g, r, lerp(x0, x1, r()) - len / 2, lerp(y0, y1, r()), f.ang + (r() - 0.5) * 0.5, len, 7 + r() * 12, tone, 0.12)
    }
    // 垄：种了东西的田有一行一行的痕迹
    if (f.rows) {
      const rc = hex(f.rows)
      const dx = Math.cos(f.ang)
      const dy = Math.sin(f.ang)
      const span = Math.hypot(x1 - x0, y1 - y0)
      const mx = (x0 + x1) / 2
      const my = (y0 + y1) / 2
      for (let o = -span / 2; o < span / 2; o += 30 + r() * 5) {
        g.strokeStyle = css(rc, 0.32 + r() * 0.2)
        g.lineWidth = 6 + r() * 5
        g.beginPath()
        for (let s = -span / 2; s <= span / 2; s += 46) {
          const wob = (ns(s / 70 + o, o / 9) - 0.5) * 10
          const qx = mx + dx * s - dy * (o + wob)
          const qy = my + dy * s + dx * (o + wob)
          if (s === -span / 2) g.moveTo(qx, qy)
          else g.lineTo(qx, qy)
        }
        g.stroke()
      }
    }
    g.restore()
  }

  // 3 田埂：一团一团深绿点出来的，底下晕一圈淡的
  const hedges: number[][][] = [
    [[-7.6, 0.66], [-5.4, 0.36], [-3.5, 0.26]],
    [[-2.75, -0.96], [-1.4, -1.2], [-0.3, -1.3]],
    [[-2.95, 1.76], [-1.5, 1.8], [-0.3, 1.9]],
    [[3.2, -5.2], [2.98, -3], [2.72, -0.95]],
    [[0.3, -1.28], [1.5, -1.15], [2.72, -0.92], [5.2, -0.62], [7.6, -0.47]],
    [[0.3, 1.9], [1.8, 1.66], [3.3, 1.55], [5.5, 1.3], [7.6, 1.12]],
    [[3.3, 1.55], [2.2, 3.3], [0.95, 5.3]],
    [[3.3, 1.55], [4.3, 3.4], [5.4, 5.3]],
  ]
  const HG = ['#2f6f43', '#3a8049', '#2a6540', '#43823c', '#35764a'].map(hex)
  for (const line of hedges) {
    const pts: number[][] = []
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i]
      const [bx, bz] = line[i + 1]
      const n = Math.ceil((Math.hypot(bx - ax, bz - az) * ppu) / 9)
      for (let k = 0; k < n; k++) pts.push([X(lerp(ax, bx, k / n)), Z(lerp(az, bz, k / n))])
    }
    pts.forEach((p, i) => {
      const w = (ns(i / 14 + p[1] / 50, p[0] / 60) - 0.5) * 16
      p[0] += w
      p[1] += w * 0.6
    })
    for (let pass = 0; pass < 3; pass++) {
      g.strokeStyle = css(hex('#3c7c48'), 0.09)
      g.lineWidth = 46 - pass * 10
      g.beginPath()
      pts.forEach((p, i) => (i ? g.lineTo(p[0] + (r() - 0.5) * 5, p[1] + (r() - 0.5) * 5) : g.moveTo(p[0], p[1])))
      g.stroke()
    }
    for (const p of pts) {
      if (ns(p[0] / 90, p[1] / 90 + 40) < 0.2) continue // 留几个缺口
      const big = r() < 0.06 ? 1.7 : 1
      g.fillStyle = css(HG[Math.floor(r() * HG.length)], 0.7 + r() * 0.25)
      g.beginPath()
      g.ellipse(p[0] + (r() - 0.5) * 7, p[1] + (r() - 0.5) * 7, (8 + r() * 7) * big, (6 + r() * 5) * big, r() * 3, 0, 7)
      g.fill()
      if (r() < 0.45) {
        g.fillStyle = css(hex(r() < 0.5 ? '#7fb35a' : '#9cc76a'), 0.45 + r() * 0.3)
        g.beginPath()
        g.ellipse(p[0] - 3 + (r() - 0.5) * 6, p[1] - 4 + (r() - 0.5) * 6, 3 + r() * 4, 2.5 + r() * 3, r() * 3, 0, 7)
        g.fill()
      }
    }
  }

  // 沿着一条竖着走的曲线画（河和小路都用它）；off 是横向偏移，可以带一点抖动
  const run = (fx: (z: number) => number, off: number, wob: number, seed: number, z0 = -5.3, z1 = 5.3) => {
    g.beginPath()
    for (let z = z0; z <= z1 + 0.001; z += 0.08) {
      const x = X(fx(z)) + off + (ns(z * 2.2 + seed, seed * 3.1) - 0.5) * wob
      if (z === z0) g.moveTo(x, Z(z))
      else g.lineTo(x, Z(z))
    }
  }

  // 4 河：沙岸，一层层往中间变浅的蓝，再带几道留白
  const RW = 0.72 * ppu
  for (let i = 0; i < 4; i++) {
    g.strokeStyle = css(hex(i % 2 ? '#eadcae' : '#dccb97'), 0.5)
    g.lineWidth = RW + 34 - i * 5
    run(riverX, 0, 16, i * 7 + 1)
    g.stroke()
  }
  const BLUE = ['#3f86d8', '#4a93e0', '#58a0e7', '#69aeee', '#7fbcf3', '#97caf6'].map(hex)
  BLUE.forEach((b, i) => {
    g.strokeStyle = css(b, i ? 0.62 : 0.96)
    g.lineWidth = RW * (1 - i * 0.15)
    run(riverX, (r() - 0.5) * 8, 10 + i * 4, 30 + i * 5)
    g.stroke()
  })
  g.lineCap = 'round'
  for (let i = 0; i < 150; i++) {
    const z0 = -5 + r() * 10
    const len = 0.25 + r() * 0.8
    const light = r() < 0.6
    g.strokeStyle = light ? css([236, 247, 255], 0.3 + r() * 0.35) : css(hex('#2f70c6'), 0.16 + r() * 0.16)
    g.lineWidth = light ? 2 + r() * 4.5 : 4 + r() * 8
    run(riverX, (r() - 0.5) * RW * 0.78, 5, 60 + i, z0, z0 + len)
    g.stroke()
  }

  // 5 小路：正中间，书脊的位置
  const PWd = 0.4 * ppu
  for (let i = 0; i < 5; i++) {
    g.strokeStyle = css(hex(['#dcc793', '#e6d4a2', '#ecdcae', '#e2cf9a', '#f1e4bd'][i]), i < 4 ? 0.55 : 0.6)
    g.lineWidth = i < 4 ? PWd + 12 - i * 7 : PWd * 0.5
    run(pathX, (r() - 0.5) * 6, 18 - i * 2, 90 + i * 9)
    g.stroke()
  }
  for (let i = 0; i < 1100; i++) {
    const z = -5.2 + r() * 10.4
    const x = X(pathX(z)) + (r() + r() - 1) * PWd * 0.52
    g.fillStyle = r() < 0.55 ? css(hex('#c2a672'), 0.3 + r() * 0.3) : css([255, 250, 228], 0.35 + r() * 0.3)
    g.beginPath()
    g.ellipse(x, Z(z), 1.5 + r() * 3.5, 1.2 + r() * 2.2, r() * 3, 0, 7)
    g.fill()
  }
  // 路边和河边长出来的草
  for (let i = 0; i < 900; i++) {
    const z = -5.2 + r() * 10.4
    const side = r() < 0.5 ? -1 : 1
    const onPath = r() < 0.5
    const x = onPath ? X(pathX(z)) + side * (PWd * 0.5 + (r() - 0.3) * 10) : X(riverX(z)) + side * (RW * 0.5 + 12 + (r() - 0.3) * 14)
    g.fillStyle = css(hex(r() < 0.5 ? '#8fc46a' : '#6fae5a'), 0.4 + r() * 0.35)
    g.beginPath()
    g.ellipse(x, Z(z), 4 + r() * 8, 3 + r() * 5, r() * 3, 0, 7)
    g.fill()
  }

  // 6 草的小撇和野花
  const clear = (x: number, y: number) => {
    const z = y / ppu - TD / 2 - LAND_M
    const wx = x / ppu - TW / 2 - LAND_M
    return Math.abs(wx - riverX(z)) > 0.52 && Math.abs(wx - pathX(z)) > 0.3
  }
  for (let i = 0; i < 2600; i++) {
    const x = r() * W
    const y = r() * H
    if (!clear(x, y)) continue
    g.strokeStyle = css(r() < 0.7 ? [58, 124, 62] : [240, 250, 200], 0.2 + r() * 0.22)
    g.lineWidth = 1.6 + r() * 1.4
    const n = 2 + Math.floor(r() * 2)
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (k - (n - 1) / 2) * 0.5 + (r() - 0.5) * 0.3
      const l = 7 + r() * 8
      g.beginPath()
      g.moveTo(x + k * 2, y)
      g.lineTo(x + k * 2 + Math.cos(a) * l, y + Math.sin(a) * l)
      g.stroke()
    }
  }
  const FL = ['#fffdf2', '#ffd95a', '#f7a9c3', '#cdb9f0', '#ffffff'].map(hex)
  const flower = (x: number, y: number, col: RGB, s: number) => {
    if (!clear(x, y)) return
    g.fillStyle = css(col, 0.92)
    g.beginPath()
    g.arc(x, y, s, 0, 7)
    g.fill()
    if (s > 3.4) {
      g.fillStyle = css(hex('#f0b83a'), 0.9)
      g.beginPath()
      g.arc(x, y, s * 0.36, 0, 7)
      g.fill()
    }
  }
  for (let i = 0; i < 90; i++) {
    const cx = r() * W
    const cy = r() * H
    const col = FL[Math.floor(r() * FL.length)]
    const rad = 30 + r() * 80
    for (let k = 0, n = 5 + r() * 14; k < n; k++) {
      const a = r() * 7
      const d = Math.sqrt(r()) * rad
      flower(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, r() < 0.75 ? col : FL[0], 2.4 + r() * 2.6)
    }
  }
  for (let i = 0; i < 700; i++) flower(r() * W, r() * H, FL[Math.floor(r() * FL.length)], 2 + r() * 2.2)

  // 7 逐个像素：纸的颗粒、颜料沉积，再把“离边缘多远”写进透明度通道
  const img = g.getImageData(0, 0, W, H)
  const d = img.data
  const RAD = 0.9
  const edge = (x: number, y: number) => {
    const qx = Math.abs(x - W / 2) / ppu - (TW / 2 - RAD)
    const qy = Math.abs(y - H / 2) / ppu - (TD / 2 - RAD)
    const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RAD
    const wx = x / ppu
    const wy = y / ppu
    return -sd + (ns(wx * 1.15, wy * 1.15) - 0.5) * 0.8 + (ns(wx * 4.6 + 31, wy * 4.6 + 7) - 0.5) * 0.24 + (ns(wx * 19 + 3, wy * 19 + 11) - 0.5) * 0.07 - 0.16
  }
  const far = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const inY = Math.min(y, H - 1 - y) / ppu - LAND_M
    for (let x = 0; x < W; x++) {
      const inX = Math.min(x, W - 1 - x) / ppu - LAND_M
      far[y * W + x] = inX > 1.2 && inY > 1.2 ? 9 : edge(x, y)
    }
  }
  // 喷溅的颗粒：越靠近边缘越密，大多很小，偶尔一大滴
  const rs = rng(23)
  for (let i = 0; i < 26000; i++) {
    const x = Math.floor(rs() * W)
    const y = Math.floor(rs() * H)
    const e = far[y * W + x]
    if (e > -0.03 || e < -0.62 || rs() > Math.exp(e / 0.13) * 0.55) continue
    const k = rs()
    const rad = k < 0.72 ? 1.6 + rs() * 3 : k < 0.96 ? 4 + rs() * 5 : 9 + rs() * 8
    const sq = 0.7 + rs() * 0.3
    const rot = rs() * 3
    const R = Math.ceil(rad + 3)
    for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy++) {
      for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx++) {
        const ux = (xx - x) * Math.cos(rot) + (yy - y) * Math.sin(rot)
        const uy = (-(xx - x) * Math.sin(rot) + (yy - y) * Math.cos(rot)) / sq
        const v = Math.min(0.22, ((rad - Math.hypot(ux, uy)) / ppu) * 5)
        if (v > far[yy * W + xx]) far[yy * W + xx] = v
      }
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      // 纸纹：细颗粒 + 稍大的起伏 + 很淡的大片深浅
      const gr = (ns(x / 2.3, y / 2.3) - 0.5) * 0.085 + (ns(x / 9 + 50, y / 7 + 20) - 0.5) * 0.06 + (ns(x / 260 + 9, y / 260 + 4) - 0.5) * 0.09
      const k = 1 + gr
      d[i] = d[i] * k
      d[i + 1] = d[i + 1] * k
      d[i + 2] = d[i + 2] * (k - gr * 0.3)
      const e = far[y * W + x]
      d[i + 3] = e >= 0.8 ? 255 : Math.max(0, Math.min(255, (0.5 + e / 1.6) * 255))
    }
  }
  const t = new THREE.DataTexture(new Uint8Array(d.buffer), W, H, THREE.RGBAFormat)
  t.colorSpace = THREE.SRGBColorSpace
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.generateMipmaps = true
  t.anisotropy = 8
  // 数据贴图第一行在下面，这里把它翻回来（第一行 = 远处）
  t.repeat.set(1, -1)
  t.offset.set(0, 1)
  t.needsUpdate = true
  return t
}

// 一小张可以平铺的颗粒图：地的边缘和近看时的纸纹都用它
export function paintGrain() {
  const N = 256
  const q = rng(41)
  const a = new Uint8Array(N * N * 4)
  for (let i = 0; i < N * N; i++) {
    a[i * 4] = q() * 255
    a[i * 4 + 1] = q() * 255
    a[i * 4 + 2] = q() * 255
    a[i * 4 + 3] = 255
  }
  const t = new THREE.DataTexture(a, N, N, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

export function paintCover(ready: boolean) {
  const c = document.createElement('canvas')
  c.width = 720
  c.height = 1000
  const g = c.getContext('2d')!
  const r = rng(5)
  g.fillStyle = '#1f4a3c'
  g.fillRect(0, 0, 720, 1000)
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)'
    g.fillRect(r() * 720, r() * 1000, 1 + r() * 14, 1)
  }
  g.strokeStyle = '#e9dcb8'
  g.lineWidth = 3
  g.strokeRect(44, 44, 632, 912)
  if (ready) {
    g.fillStyle = '#f1e7c9'
    g.textAlign = 'center'
    g.font = '900 108px "Noto Serif SC", serif'
    g.fillText('思考，', 360, 330)
    g.fillText('快与慢', 360, 470)
    g.font = '400 34px "Noto Serif SC", serif'
    g.fillText('丹尼尔 · 卡尼曼', 360, 590)
    g.font = '900 30px "Noto Sans SC", sans-serif'
    g.fillText('Co-read', 360, 880)
  }
  // 封面上那两条线
  g.strokeStyle = '#f1e7c9'
  g.lineWidth = 5
  g.lineCap = 'round'
  const L = (y: number, k: number) => {
    g.beginPath()
    g.moveTo(270, y)
    g.lineTo(450, y)
    for (const [x, s] of [[270, -1], [450, 1]] as const) {
      g.moveTo(x, y)
      g.lineTo(x + s * k * 22, y - 22)
      g.moveTo(x, y)
      g.lineTo(x + s * k * 22, y + 22)
    }
    g.stroke()
  }
  L(690, 1)
  L(760, -1)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

export function paintLines() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')!
  g.strokeStyle = '#fffdf2'
  g.lineWidth = 17
  g.lineCap = 'round'
  const L = (y: number, k: number) => {
    g.beginPath()
    g.moveTo(130, y)
    g.lineTo(382, y)
    for (const [x, s] of [[130, -1], [382, 1]] as const) {
      g.moveTo(x, y)
      g.lineTo(x + s * k * 46, y - 46)
      g.moveTo(x, y)
      g.lineTo(x + s * k * 46, y + 46)
    }
    g.stroke()
  }
  L(180, 1)
  L(336, -1)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// —— 彩色图解的对开页：几大块平涂色（像教科书的彩色图版），一条钴蓝的河，沿书脊的小路，
// 上面是黑色细线的标注和小图表。四周留白边，像印出来的一页。
export function paintPlates() {
  const W = 2048
  const H = 1423
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const r = rng(23)
  const PAPER = '#f6f0e2'
  const INK = '#1d1d1f'
  g.fillStyle = PAPER
  g.fillRect(0, 0, W, H)
  const mx = 0.036 * W
  const my = 0.052 * H
  const gut = 0.011 * W
  // 只在两页的版心里画
  g.save()
  g.beginPath()
  g.roundRect(mx, my, W / 2 - mx - gut, H - my * 2, 10)
  g.roundRect(W / 2 + gut, my, W / 2 - mx - gut, H - my * 2, 10)
  g.clip()
  g.fillStyle = '#f1e7d0'
  g.fillRect(0, 0, W, H)
  // 远处的山：几个平涂的三角
  const tri = (x: number, base: number, w: number, h: number, col: string) => {
    g.fillStyle = col
    g.beginPath()
    g.moveTo(x - w / 2, base)
    g.lineTo(x, base - h)
    g.lineTo(x + w / 2, base)
    g.fill()
  }
  tri(0.16 * W, 0.3 * H, 0.2 * W, 0.2 * H, '#5fa57a')
  tri(0.3 * W, 0.3 * H, 0.24 * W, 0.24 * H, '#2f63c6')
  tri(0.4 * W, 0.3 * H, 0.16 * W, 0.15 * H, '#f5c54a')
  tri(0.64 * W, 0.3 * H, 0.2 * W, 0.19 * H, '#c9a6d4')
  tri(0.76 * W, 0.3 * H, 0.22 * W, 0.23 * H, '#2f63c6')
  tri(0.9 * W, 0.3 * H, 0.14 * W, 0.14 * H, '#1f6e63')
  // 一层层起伏的色块，从远到近；每层上沿留一条纸白的缝
  const layers: [string, number, number, number, number][] = [
    ['#efb7c0', 0.2, 0.03, 5.2, 0.4],
    ['#5fa57a', 0.3, 0.035, 4.1, 2.0],
    ['#f5c54a', 0.41, 0.04, 3.3, 3.6],
    ['#c9a6d4', 0.54, 0.035, 4.6, 1.1],
    ['#a9d5ba', 0.66, 0.04, 3.7, 4.4],
    ['#f0835c', 0.79, 0.045, 3.0, 2.7],
    ['#f5c54a', 0.9, 0.025, 5.5, 0.9],
  ]
  for (const [col, base, amp, f, ph] of layers) {
    const y = (u: number) => (base + amp * Math.sin(u * f + ph) + amp * 0.45 * Math.sin(u * f * 2.3 + ph * 1.7)) * H
    g.beginPath()
    g.moveTo(0, H)
    for (let x = 0; x <= W; x += 8) g.lineTo(x, y(x / W))
    g.lineTo(W, H)
    g.closePath()
    g.fillStyle = col
    g.fill()
    g.beginPath()
    for (let x = 0; x <= W; x += 8) (x ? g.lineTo(x, y(x / W)) : g.moveTo(x, y(x / W)))
    g.strokeStyle = PAPER
    g.lineWidth = 9
    g.stroke()
  }
  // 河
  const river = () => {
    g.beginPath()
    g.moveTo(0.3 * W, 0.03 * H)
    g.bezierCurveTo(0.38 * W, 0.26 * H, 0.1 * W, 0.4 * H, 0.2 * W, 0.6 * H)
    g.bezierCurveTo(0.28 * W, 0.76 * H, 0.14 * W, 0.86 * H, 0.2 * W, 1.0 * H)
  }
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.strokeStyle = PAPER
  g.lineWidth = 190
  river()
  g.stroke()
  g.strokeStyle = '#2f63c6'
  g.lineWidth = 168
  river()
  g.stroke()
  // 水纹：几道短而疏的弧线，不要画成路上的标线
  g.strokeStyle = 'rgba(246,240,226,0.8)'
  g.lineWidth = 3.5
  g.setLineDash([70, 330])
  for (const [off, d] of [[-52, 40], [0, 210], [50, 120]]) {
    g.save()
    g.translate(off, off * 0.4)
    g.lineDashOffset = d
    river()
    g.stroke()
    g.restore()
  }
  g.setLineDash([])
  // 油墨的颗粒：很轻
  for (let i = 0; i < 26000; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)'
    g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2)
  }
  g.restore()
  // 沿书脊的小路（压在两页中间）
  g.fillStyle = '#f1e7d0'
  g.fillRect(W / 2 - 0.03 * W, my, 0.06 * W, H - my * 2)
  g.strokeStyle = INK
  g.lineWidth = 2.5
  g.setLineDash([14, 14])
  for (const dx of [-0.019, 0.019]) {
    g.beginPath()
    g.moveTo(W / 2 + dx * W, my + 10)
    g.lineTo(W / 2 + dx * W, H - my - 10)
    g.stroke()
  }
  g.setLineDash([])
  // 标注和小图表：细黑线
  g.strokeStyle = INK
  g.fillStyle = INK
  g.lineWidth = 2.2
  const dot = (x: number, y: number, rad = 5) => {
    g.beginPath()
    g.arc(x, y, rad, 0, 7)
    g.fill()
  }
  const line = (...p: number[]) => {
    g.beginPath()
    g.moveTo(p[0], p[1])
    for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1])
    g.stroke()
  }
  // 左上：网格和十字圆
  for (let i = 0; i <= 4; i++) {
    line(0.055 * W + i * 34, 0.075 * H, 0.055 * W + i * 34, 0.075 * H + 102)
    if (i <= 3) line(0.055 * W, 0.075 * H + i * 34, 0.055 * W + 136, 0.075 * H + i * 34)
  }
  g.beginPath()
  g.arc(0.055 * W + 68, 0.075 * H + 51, 30, 0, 7)
  g.stroke()
  // 右上：饼图
  g.beginPath()
  g.arc(0.93 * W, 0.11 * H, 34, 0, 7)
  g.stroke()
  g.fillStyle = '#f5c54a'
  g.beginPath()
  g.moveTo(0.93 * W, 0.11 * H)
  g.arc(0.93 * W, 0.11 * H, 34, -Math.PI / 2, 0.3)
  g.fill()
  g.fillStyle = INK
  line(0.93 * W, 0.11 * H, 0.93 * W, 0.11 * H - 34)
  // 右下：线框立方体和尺寸箭头
  const cx = 0.9 * W
  const cy = 0.87 * H
  line(cx - 40, cy - 10, cx + 20, cy - 10, cx + 20, cy + 40, cx - 40, cy + 40, cx - 40, cy - 10)
  line(cx - 40, cy - 10, cx - 12, cy - 34, cx + 48, cy - 34, cx + 20, cy - 10)
  line(cx + 48, cy - 34, cx + 48, cy + 16, cx + 20, cy + 40)
  line(cx - 62, cy - 10, cx - 62, cy + 40)
  line(cx - 68, cy - 2, cx - 62, cy - 10, cx - 56, cy - 2)
  line(cx - 68, cy + 32, cx - 62, cy + 40, cx - 56, cy + 32)
  // 左下：三个叠在一起的圆
  for (const [dx, dy, col] of [[0, 0, 'rgba(47,99,198,0.85)'], [46, -6, 'rgba(245,197,74,0.85)'], [22, 34, 'rgba(201,166,212,0.85)']] as const) {
    g.fillStyle = col
    g.beginPath()
    g.arc(0.075 * W + dx, 0.86 * H + dy, 34, 0, 7)
    g.fill()
  }
  g.fillStyle = INK
  // 几条带圆点的引线
  for (const [x1, y1, x2, y2] of [[0.36, 0.12, 0.44, 0.09], [0.6, 0.63, 0.66, 0.58], [0.82, 0.5, 0.88, 0.46], [0.42, 0.8, 0.46, 0.86]]) {
    dot(x1 * W, y1 * H)
    line(x1 * W, y1 * H, x2 * W, y2 * H)
    g.beginPath()
    g.arc(x2 * W + 11, y2 * H - 8, 12, 0, 7)
    g.stroke()
  }
  // 裁切角线和页码位置的小横线
  for (const [x, y, sx, sy] of [[mx, my, -1, -1], [W - mx, my, 1, -1], [mx, H - my, -1, 1], [W - mx, H - my, 1, 1]] as const) {
    line(x + sx * 8, y, x + sx * 30, y)
    line(x, y + sy * 8, x, y + sy * 30)
  }
  // 纸纹和书脊处的阴影
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(120,100,60,0.035)'
    g.fillRect(r() * W, r() * H, 1 + r() * 9, 1)
  }
  const sh = g.createLinearGradient(W / 2 - 0.05 * W, 0, W / 2 + 0.05 * W, 0)
  sh.addColorStop(0, 'rgba(60,45,20,0)')
  sh.addColorStop(0.5, 'rgba(60,45,20,0.2)')
  sh.addColorStop(1, 'rgba(60,45,20,0)')
  g.fillStyle = sh
  g.fillRect(W / 2 - 0.05 * W, 0, 0.1 * W, H)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

// —— 群岛的海面：书页上的一片水。岛周围是浅滩和一圈浪花，书脊处是更深的水道。
export function paintSea(isles: [number, number, number][], tw: number, td: number) {
  const W = 2048
  const H = Math.round((W * td) / tw)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const r = rng(41)
  g.fillStyle = '#f3ead6'
  g.fillRect(0, 0, W, H)
  const m = 0.026 * W
  g.save()
  g.beginPath()
  g.roundRect(m, m, W - m * 2, H - m * 2, 46)
  g.clip()
  const sea = g.createLinearGradient(0, 0, 0, H)
  sea.addColorStop(0, '#3a7fc0')
  sea.addColorStop(1, '#2f6cae')
  g.fillStyle = sea
  g.fillRect(0, 0, W, H)
  // 大片柔和的深浅变化
  for (let i = 0; i < 46; i++) {
    const x = r() * W
    const y = r() * H
    const rad = 120 + r() * 260
    const gr = g.createRadialGradient(x, y, 0, x, y, rad)
    gr.addColorStop(0, r() > 0.5 ? 'rgba(70,140,200,0.2)' : 'rgba(18,60,110,0.2)')
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gr
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  // 书脊：更深的水道
  const ch = g.createLinearGradient(W / 2 - 110, 0, W / 2 + 110, 0)
  ch.addColorStop(0, 'rgba(14,42,84,0)')
  ch.addColorStop(0.5, 'rgba(14,42,84,0.55)')
  ch.addColorStop(1, 'rgba(14,42,84,0)')
  g.fillStyle = ch
  g.fillRect(W / 2 - 110, 0, 220, H)
  const px = (x: number) => ((x + tw / 2) / tw) * W
  const py = (z: number) => ((z + td / 2) / td) * H
  const s = W / tw
  // 岛的周围：浅滩（青绿）和一圈不规则的浪花
  for (const [x, z, rad] of isles) {
    const gr = g.createRadialGradient(px(x), py(z), rad * s * 0.7, px(x), py(z), rad * s * 1.7)
    gr.addColorStop(0, 'rgba(120,205,205,0.95)')
    gr.addColorStop(0.45, 'rgba(84,170,196,0.6)')
    gr.addColorStop(1, 'rgba(60,130,180,0)')
    g.fillStyle = gr
    g.beginPath()
    g.arc(px(x), py(z), rad * s * 1.7, 0, 7)
    g.fill()
    for (const [k, a, w] of [[1.13, 0.5, 5], [1.32, 0.22, 3]] as const) {
      g.strokeStyle = `rgba(255,255,255,${a})`
      g.lineWidth = w
      g.setLineDash([40 + r() * 60, 14 + r() * 26])
      g.beginPath()
      for (let i = 0; i <= 60; i++) {
        const ang = (i / 60) * Math.PI * 2
        const rr = rad * s * k * (1 + 0.05 * Math.sin(ang * 5 + x) + 0.035 * Math.sin(ang * 9 + z))
        const X = px(x) + Math.cos(ang) * rr
        const Y = py(z) + Math.sin(ang) * rr
        if (i) g.lineTo(X, Y)
        else g.moveTo(X, Y)
      }
      g.stroke()
    }
    g.setLineDash([])
  }
  // 水面上的小波纹
  g.lineCap = 'round'
  for (let i = 0; i < 520; i++) {
    const x = r() * W
    const y = r() * H
    const w = 16 + r() * 34
    g.strokeStyle = `rgba(255,255,255,${0.1 + r() * 0.16})`
    g.lineWidth = 2.5
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + w / 2, y - 5 - r() * 4, x + w, y)
    g.stroke()
  }
  for (let i = 0; i < 20000; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,10,40,0.05)'
    g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2)
  }
  g.restore()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}
