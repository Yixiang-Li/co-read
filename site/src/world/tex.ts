import * as THREE from 'three'
import { SEA_D, SEA_W, TD, TW } from './dims'

// 可以无缝平铺的细颗粒起伏（法线贴图）：皮面、纸面、泥塑表面都用它，只是密度和强度不同。
export function grainNormal(n = 256, periods = [64, 32, 16, 8], strength = 2.2, seed = 7) {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647), s / 2147483647)
  const h = new Float32Array(n * n)
  periods.forEach((p, oi) => {
    const cells = n / p
    const lat = Array.from({ length: cells * cells }, rnd)
    const amp = 1 / (oi + 1.4)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const fx = x / p
        const fy = y / p
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const tx = fx - x0
        const ty = fy - y0
        const ux = tx * tx * (3 - 2 * tx)
        const uy = ty * ty * (3 - 2 * ty)
        const g = (i: number, j: number) => lat[(j % cells) * cells + (i % cells)]
        h[y * n + x] += amp * ((g(x0, y0) * (1 - ux) + g(x0 + 1, y0) * ux) * (1 - uy) + (g(x0, y0 + 1) * (1 - ux) + g(x0 + 1, y0 + 1) * ux) * uy)
      }
  })
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (h[y * n + ((x + 1) % n)] - h[y * n + ((x + n - 1) % n)]) * strength
      const dy = (h[((y + 1) % n) * n + x] - h[((y + n - 1) % n) * n + x]) * strength
      const l = Math.hypot(dx, dy, 1)
      const i = (y * n + x) * 4
      data[i] = (-dx / l) * 127 + 128
      data[i + 1] = (-dy / l) * 127 + 128
      data[i + 2] = (1 / l) * 127 + 128
      data[i + 3] = 255
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}
let _grain: THREE.Texture | null = null
export const GRAIN = () => (_grain ??= grainNormal())
// 同一张图换一种平铺密度（各用各的，互不影响）
export const grainAt = (rx: number, ry: number, fine = false) => {
  const t = (fine ? FINE() : GRAIN()).clone()
  t.repeat.set(rx, ry)
  t.needsUpdate = true
  return t
}
let _fine: THREE.Texture | null = null
export const FINE = () => (_fine ??= grainNormal(256, [16, 8, 4], 3.2, 11))

// 摊开的那一页纸：一张旧海图的图幅。米色的纸、订口的阴影；围着海的是图框——
// 里外两道线，中间一圈黑白相间的刻度条，外面每隔一段标着度数；上下是页眉和页码。
export function paintPage() {
  const W = 2560
  const H = Math.round((W * TD) / TW)
  const k = W / TW
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const INK = '38,66,62'
  const draw = () => {
    g.globalAlpha = 1
    g.fillStyle = '#e5d8bc'
    g.fillRect(0, 0, W, H)
    // 纸的纤维和几处旧纸的黄斑
    const img = g.getImageData(0, 0, W, H)
    let s = 5
    for (let i = 0; i < img.data.length; i += 4) {
      s = (s * 16807) % 2147483647
      const n = ((s & 255) / 255 - 0.5) * 8
      img.data[i] += n
      img.data[i + 1] += n
      img.data[i + 2] += n * 0.8
    }
    g.putImageData(img, 0, 0)
    for (let i = 0; i < 26; i++) {
      s = (s * 16807) % 2147483647
      const x = (s % 1000) / 1000
      s = (s * 16807) % 2147483647
      const y = (s % 1000) / 1000
      s = (s * 16807) % 2147483647
      const r = (0.12 + ((s % 100) / 100) * 0.5) * k
      const sp = g.createRadialGradient(x * W, y * H, 0, x * W, y * H, r)
      sp.addColorStop(0, 'rgba(150,110,60,0.07)')
      sp.addColorStop(1, 'rgba(150,110,60,0)')
      g.fillStyle = sp
      g.fillRect(x * W - r, y * H - r, r * 2, r * 2)
    }
    // 订口：中间一道往下陷的阴影
    const gut = g.createLinearGradient(W / 2 - 0.9 * k, 0, W / 2 + 0.9 * k, 0)
    gut.addColorStop(0, 'rgba(90,60,30,0)')
    gut.addColorStop(0.5, 'rgba(90,60,30,0.3)')
    gut.addColorStop(1, 'rgba(90,60,30,0)')
    g.fillStyle = gut
    g.fillRect(0, 0, W, H)
    // 图框：两道线
    const rr = (m: number, r: number, lw: number) => {
      const w = (SEA_W + m * 2) * k
      const h = (SEA_D + m * 2) * k
      g.lineWidth = lw * k
      g.beginPath()
      g.roundRect((W - w) / 2, (H - h) / 2, w, h, r * k)
      g.stroke()
    }
    g.strokeStyle = `rgba(${INK},0.8)`
    rr(0.035, 0.455, 0.008)
    rr(0.125, 0.545, 0.008)
    rr(0.165, 0.585, 0.02)
    // 两道线之间的刻度条：一段实、一段空
    g.fillStyle = `rgba(${INK},0.78)`
    const x0 = (TW - SEA_W) / 2
    const z0 = (TD - SEA_D) / 2
    const seg = 0.25
    const band = 0.06
    for (let x = x0 + 0.75, n = 0; x + seg <= TW - x0 - 0.7; x += seg, n++)
      if (n % 2 === 0) {
        g.fillRect(x * k, (z0 - 0.11) * k, seg * k, band * k)
        g.fillRect(x * k, (TD - z0 + 0.05) * k, seg * k, band * k)
      }
    for (let z = z0 + 0.75, n = 0; z + seg <= TD - z0 - 0.7; z += seg, n++)
      if (n % 2 === 0) {
        g.fillRect((x0 - 0.11) * k, z * k, band * k, seg * k)
        g.fillRect((TW - x0 + 0.05) * k, z * k, band * k, seg * k)
      }
    // 度数
    g.fillStyle = `rgba(${INK},0.72)`
    g.textBaseline = 'middle'
    g.textAlign = 'center'
    g.font = `italic 400 ${0.075 * k}px "Fraunces Variable", Georgia, serif`
    for (let x = x0 + 0.75, d = 20; x <= TW - x0 - 0.7; x += 1, d++) {
      g.fillText(`${d}°`, x * k, (z0 - 0.245) * k)
      g.fillText(`${d}°`, x * k, (TD - z0 + 0.25) * k)
    }
    for (let z = z0 + 0.75, d = 48; z <= TD - z0 - 0.7; z += 1, d--) {
      g.save()
      g.translate((x0 - 0.25) * k, z * k)
      g.rotate(-Math.PI / 2)
      g.fillText(`${d}°`, 0, 0)
      g.restore()
      g.save()
      g.translate((TW - x0 + 0.25) * k, z * k)
      g.rotate(Math.PI / 2)
      g.fillText(`${d}°`, 0, 0)
      g.restore()
    }
    // 页眉、页码
    g.fillStyle = `rgba(${INK},0.85)`
    g.font = `600 ${0.105 * k}px "Noto Serif SC", serif`
    g.textAlign = 'left'
    g.fillText('思考，快与慢', (x0 + 0.02) * k, 0.115 * k)
    g.textAlign = 'right'
    g.font = `italic 500 ${0.112 * k}px "Fraunces Variable", Georgia, serif`
    g.fillText('Thinking, Fast and Slow', (TW - x0 - 0.02) * k, 0.115 * k)
    g.font = `400 ${0.095 * k}px "Fraunces Variable", Georgia, serif`
    g.textAlign = 'left'
    g.fillText('24', (x0 + 0.02) * k, H - 0.11 * k)
    g.textAlign = 'right'
    g.fillText('25', (TW - x0 - 0.02) * k, H - 0.11 * k)
  }
  draw()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  // 字体读好以后重画一遍（第一遍可能用的是替代字体）
  Promise.all([document.fonts.load('italic 400 20px "Fraunces Variable"'), document.fonts.load('600 20px "Noto Serif SC"', '思考，快与慢')]).then(() => {
    draw()
    t.needsUpdate = true
  })
  return t
}

// 印在海面上的那层细线：罗盘花、从它放射出去的航向线、零星的水深数字。只存浓淡，颜色在海面的着色器里给。
// keep(x, z)：这一点是不是开阔的水面（数字只印在开阔处）。
export const ROSE: [number, number] = [0.05, -1.2]
export function paintChart(open: (x: number, z: number) => number) {
  const W = 2560
  const H = Math.round((W * TD) / TW)
  const k = W / TW
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const X = (x: number) => (x + TW / 2) * k
  const Z = (z: number) => (z + TD / 2) * k
  const draw = () => {
    g.clearRect(0, 0, W, H)
    g.fillStyle = '#000'
    g.fillRect(0, 0, W, H)
    g.strokeStyle = '#fff'
    g.fillStyle = '#fff'
    const [rx, rz] = ROSE
    // 航向线：从罗盘花放射出去的三十二条细线
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2
      g.globalAlpha = i % 8 === 0 ? 0.42 : i % 2 === 0 ? 0.26 : 0.14
      g.lineWidth = 0.006 * k
      g.beginPath()
      g.moveTo(X(rx + Math.cos(a) * 0.66), Z(rz + Math.sin(a) * 0.66))
      g.lineTo(X(rx + Math.cos(a) * 16), Z(rz + Math.sin(a) * 16))
      g.stroke()
    }
    // 罗盘花
    g.globalAlpha = 1
    const ring = (r: number, lw: number) => {
      g.lineWidth = lw * k
      g.beginPath()
      g.arc(X(rx), Z(rz), r * k, 0, Math.PI * 2)
      g.stroke()
    }
    ring(0.6, 0.012)
    ring(0.55, 0.005)
    ring(0.4, 0.005)
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2
      const r0 = i % 9 === 0 ? 0.47 : i % 3 === 0 ? 0.5 : 0.525
      g.lineWidth = 0.005 * k
      g.beginPath()
      g.moveTo(X(rx + Math.cos(a) * r0), Z(rz + Math.sin(a) * r0))
      g.lineTo(X(rx + Math.cos(a) * 0.55), Z(rz + Math.sin(a) * 0.55))
      g.stroke()
    }
    // 星芒：四长、四中、八短；每一瓣半边实、半边空
    const point = (a: number, len: number, wid: number) => {
      const tip: [number, number] = [rx + Math.cos(a) * len, rz + Math.sin(a) * len]
      for (const s of [1, -1]) {
        const b = a + s * (Math.PI / 2)
        const side: [number, number] = [rx + Math.cos(a) * wid * 0.9 + Math.cos(b) * wid, rz + Math.sin(a) * wid * 0.9 + Math.sin(b) * wid]
        g.beginPath()
        g.moveTo(X(rx), Z(rz))
        g.lineTo(X(side[0]), Z(side[1]))
        g.lineTo(X(tip[0]), Z(tip[1]))
        g.closePath()
        g.lineWidth = 0.005 * k
        g.stroke()
        if (s > 0) g.fill()
      }
    }
    for (let i = 0; i < 16; i++) if (i % 2 === 1) point((i / 16) * Math.PI * 2, 0.24, 0.028)
    for (let i = 0; i < 8; i++) if (i % 2 === 1) point((i / 8) * Math.PI * 2, 0.36, 0.045)
    for (let i = 0; i < 4; i++) point((i / 4) * Math.PI * 2 - Math.PI / 2, 0.5, 0.07)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `italic 500 ${0.13 * k}px "Fraunces Variable", Georgia, serif`
    g.fillText('N', X(rx), Z(rz - 0.74))
    // 水深数字：零星地印在开阔的水面上。里面混着几个书里的数
    let s = 77
    const rnd = () => ((s = (s * 16807) % 2147483647), s / 2147483647)
    const book = ['1200', '180', '110', '5', '150', '100', '31', '9']
    const placed: [number, number][] = [[rx, rz]]
    g.font = `italic 400 ${0.078 * k}px "Fraunces Variable", Georgia, serif`
    g.globalAlpha = 0.62
    for (let i = 0, n = 0; i < 900 && n < 58; i++) {
      const x = (rnd() - 0.5) * (SEA_W - 0.5)
      const z = (rnd() - 0.5) * (SEA_D - 0.5)
      if (open(x, z) < 0.3 || Math.hypot(x - rx, z - rz) < 0.95) continue
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.46)) continue
      placed.push([x, z])
      g.fillText(n % 7 === 3 ? book[(n / 7) | 0] ?? '12' : String(3 + Math.floor(rnd() * 46)), X(x), Z(z))
      n++
    }
    g.globalAlpha = 1
  }
  draw()
  const t = new THREE.CanvasTexture(c)
  t.anisotropy = 8
  document.fonts.load('italic 400 20px "Fraunces Variable"').then(() => {
    draw()
    t.needsUpdate = true
  })
  return t
}

// 一团柔和的暖光（路灯脚下、窗前的地面）
let _glow: THREE.Texture | null = null
export function glowTex() {
  if (_glow) return _glow
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,205,120,0.95)')
  r.addColorStop(0.35, 'rgba(255,180,90,0.42)')
  r.addColorStop(1, 'rgba(255,160,70,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 128, 128)
  _glow = new THREE.CanvasTexture(c)
  _glow.colorSpace = THREE.SRGBColorSpace
  return _glow
}
