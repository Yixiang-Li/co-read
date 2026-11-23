import * as THREE from 'three'
import type { Lang } from '../i18n'

// 这本书用到的所有贴图，全部用代码画在 canvas 上：布面、烫金、环衬、内页排版、书口、堵头布、丝带、软阴影。

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
const mk = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d', { willReadFrequently: true })!] as const
}
const toTex = (c: HTMLCanvasElement, srgb = true) => {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}
// 画贴图是重活：每画一会儿就让出主线程，别卡住画面
const tick = () => new Promise<void>((r) => setTimeout(r, 0))
let sliceT = 0
const breathe = async () => {
  if (performance.now() - sliceT < 9) return
  await tick()
  sliceT = performance.now()
}
const SERIF = '"Noto Serif SC", "Songti SC", serif'
const SANS = '"Noto Sans SC", "PingFang SC", sans-serif'

// 书里用到的真字（书名、作者、章节结构），中英各一套；不编正文
const TXT = {
  zh: {
    t1: '思考，',
    t2: '快与慢',
    title: '思考，快与慢',
    author: '丹尼尔·卡尼曼',
    by: '[美]　丹尼尔·卡尼曼　著',
    sub: 'Thinking, Fast and Slow',
    contents: '目录',
    intro: '序言',
    concl: '结语',
    parts: [
      ['第一部分', '两个系统', '第 1–9 章'],
      ['第二部分', '启发法与偏差', '第 10–18 章'],
      ['第三部分', '过度自信', '第 19–24 章'],
      ['第四部分', '选择', '第 25–34 章'],
      ['第五部分', '两个自我', '第 35–38 章'],
    ],
    ch: ['第 1 章', '故事里的角色'],
  },
  en: {
    t1: 'Thinking,',
    t2: 'Fast and Slow',
    title: 'Thinking, Fast and Slow',
    author: 'Daniel Kahneman',
    by: 'Daniel Kahneman',
    sub: '',
    contents: 'Contents',
    intro: 'Introduction',
    concl: 'Conclusions',
    parts: [
      ['Part I', 'Two Systems', 'Chapters 1–9'],
      ['Part II', 'Heuristics and Biases', 'Chapters 10–18'],
      ['Part III', 'Overconfidence', 'Chapters 19–24'],
      ['Part IV', 'Choices', 'Chapters 25–34'],
      ['Part V', 'Two Selves', 'Chapters 35–38'],
    ],
    ch: ['Chapter 1', 'The Characters of the Story'],
  },
}
const BRAND = 'Co-read'
// 当前正在画哪种语言。每次同步地画一张贴图之前先调 use()
let T = TXT.zh
let EN = false
const use = (lang: Lang) => {
  T = TXT[lang]
  EN = lang === 'en'
}

export async function loadBookFonts(lang: Lang) {
  const all = [...new Set(JSON.stringify(TXT[lang]) + BRAND + '0123456789–·，')].join('')
  const wait = Promise.all([document.fonts.load(`900 64px ${SERIF}`, all), document.fonts.load(`400 32px ${SERIF}`, all), document.fonts.load(`900 30px ${SANS}`, BRAND)])
  await Promise.race([wait, new Promise((r) => setTimeout(r, 4000))]).catch(() => {})
}

// 把字号缩到一行放得下
function fit(g: CanvasRenderingContext2D, s: string, weight: number, size: number, maxW: number, gap = 0) {
  g.font = `${weight} 100px ${SERIF}`
  const w = g.measureText(s).width / 100
  const px = Math.min(size, (maxW - gap * (s.length - 1)) / w)
  g.font = `${weight} ${px}px ${SERIF}`
  return px
}

// 字距拉开的一行字
function spaced(g: CanvasRenderingContext2D, s: string, x: number, y: number, gap: number, align: 'center' | 'left' | 'right' = 'center') {
  const cs = [...s]
  const ws = cs.map((ch) => g.measureText(ch).width)
  const total = ws.reduce((a, b) => a + b, 0) + gap * (cs.length - 1)
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x
  const keep = g.textAlign
  g.textAlign = 'left'
  cs.forEach((ch, i) => {
    g.fillText(ch, cx, y)
    cx += ws[i] + gap
  })
  g.textAlign = keep
}

// 封面上那两条带箭头的线（一样长，看着不一样长）
function arrows(g: CanvasRenderingContext2D, cx: number, y: number, half: number, fin: number, k: number) {
  g.beginPath()
  g.moveTo(cx - half, y)
  g.lineTo(cx + half, y)
  for (const [x, s] of [[cx - half, -1], [cx + half, 1]] as const) {
    g.moveTo(x + s * k * fin, y - fin)
    g.lineTo(x, y)
    g.lineTo(x + s * k * fin, y + fin)
  }
  g.stroke()
}

type Stamp = (g: CanvasRenderingContext2D, w: number, h: number) => void

// 布面：平纹织物的高度场 → 颜色 + 法线；可选烫金（单独一层带透明度的贴图）和素压（只压凹不上金）
async function clothSet(w: number, h: number, pitch: number, seed: number, base: [number, number, number], foil?: Stamp, blind?: Stamp, tile = false) {
  const r = rng(seed)
  const n = w * h
  // 蒙版和它的软边（缩小再放大，等于模糊一下）
  const mask = (draw?: Stamp) => {
    if (!draw) return null
    const [c, g] = mk(w, h)
    g.fillStyle = g.strokeStyle = '#fff'
    draw(g, w, h)
    const [sc, sg] = mk(Math.ceil(w / 3), Math.ceil(h / 3))
    sg.drawImage(c, 0, 0, sc.width, sc.height)
    const [, bg] = mk(w, h)
    bg.drawImage(sc, 0, 0, w, h)
    return { m: g.getImageData(0, 0, w, h).data, b: bg.getImageData(0, 0, w, h).data }
  }
  const F = mask(foil)
  await breathe()
  const B = mask(blind)
  await breathe()
  // 每根线的粗细和深浅都不一样，沿着线还有粗节
  const nx = Math.ceil(w / pitch) + 2
  const ny = Math.ceil(h / pitch) + 2
  const wa = Float32Array.from({ length: nx }, () => 0.72 + r() * 0.4)
  const wt = Float32Array.from({ length: nx }, () => 0.9 + r() * 0.2)
  const fa = Float32Array.from({ length: ny }, () => 0.72 + r() * 0.4)
  const ft = Float32Array.from({ length: ny }, () => 0.9 + r() * 0.2)
  if (tile) {
    wa[nx - 2] = wa[0]
    wt[nx - 2] = wt[0]
    fa[ny - 2] = fa[0]
    ft[ny - 2] = ft[0]
  }
  const SB = 7
  const sh2 = Math.ceil(ny / SB) + 2
  const sw2 = Math.ceil(nx / SB) + 2
  const slW = Float32Array.from({ length: nx * sh2 }, () => (tile ? 1 : 0.78 + r() * 0.44))
  const slF = Float32Array.from({ length: sw2 * ny }, () => (tile ? 1 : 0.78 + r() * 0.44))
  const ix = new Int32Array(w)
  const cx = new Float32Array(w)
  const cxx = new Float32Array(w)
  const mx = new Int32Array(w)
  const tx = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const f = x / pitch
    ix[x] = Math.floor(f)
    const fr = f - ix[x] - 0.5
    cx[x] = Math.cos(Math.PI * fr)
    cxx[x] = 0.5 + 0.5 * Math.cos(2 * Math.PI * fr)
    mx[x] = Math.floor(f / SB)
    tx[x] = f / SB - mx[x]
  }
  const hgt = new Float32Array(n)
  const [cc, cg] = mk(w, h)
  const cd = cg.createImageData(w, h)
  const px = cd.data
  for (let y = 0; y < h; y++) {
    if ((y & 127) === 0) await breathe()
    const f = y / pitch
    const iy = Math.floor(f)
    const fr = f - iy - 0.5
    const cy = Math.cos(Math.PI * fr)
    const cyy = 0.5 + 0.5 * Math.cos(2 * Math.PI * fr)
    const my = Math.floor(f / SB)
    const ty = f / SB - my
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const jx = ix[x]
      let hv: number
      let tint: number
      if ((jx + iy) & 1) {
        const a = jx * sh2 + my
        hv = cx[x] * (0.62 + 0.38 * cyy) * wa[jx] * (slW[a] + (slW[a + 1] - slW[a]) * ty)
        tint = wt[jx]
      } else {
        const a = mx[x] * ny + iy
        hv = cy * (0.62 + 0.38 * cxx[x]) * fa[iy] * (slF[a] + (slF[a + ny] - slF[a]) * tx[x])
        tint = ft[iy]
      }
      let sh = (0.66 + 0.46 * hv) * tint
      let hh = hv
      if (F) {
        const m = F.m[i * 4 + 3] / 255
        const b = F.b[i * 4 + 3] / 255
        hh = hv * (1 - 0.6 * b) - 1.5 * b
        sh *= 1 - 0.3 * Math.max(0, b - m) // 烫印边缘压出来的一圈暗
      }
      if (B) {
        const m = B.m[i * 4 + 3] / 255
        const b = B.b[i * 4 + 3] / 255
        hh = hh * (1 - 0.55 * b) - 1.3 * b
        sh *= 1 - 0.2 * m - 0.18 * Math.max(0, b - m)
      }
      hgt[i] = hh
      px[i * 4] = base[0] * sh
      px[i * 4 + 1] = base[1] * sh
      px[i * 4 + 2] = base[2] * sh
      px[i * 4 + 3] = 255
    }
  }
  cg.putImageData(cd, 0, 0)
  if (!tile) {
    // 大块的深浅不匀，像染得不那么均匀的布
    for (let i = 0; i < 7; i++) {
      const x = r() * w
      const y = r() * h
      const rad = w * (0.25 + r() * 0.3)
      const gr = cg.createRadialGradient(x, y, 0, x, y, rad)
      gr.addColorStop(0, i & 1 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)')
      gr.addColorStop(1, 'rgba(0,0,0,0)')
      cg.fillStyle = gr
      cg.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
  }
  const [nc, ng] = mk(w, h)
  const nd = ng.createImageData(w, h)
  const np = nd.data
  const K = 1.7 * 0.5
  for (let y = 0; y < h; y++) {
    if ((y & 127) === 0) await breathe()
    const y0 = (tile ? (y + h - 1) % h : Math.max(0, y - 1)) * w
    const y1 = (tile ? (y + 1) % h : Math.min(h - 1, y + 1)) * w
    for (let x = 0; x < w; x++) {
      const x0 = tile ? (x + w - 1) % w : Math.max(0, x - 1)
      const x1 = tile ? (x + 1) % w : Math.min(w - 1, x + 1)
      const dx = (hgt[y * w + x1] - hgt[y * w + x0]) * K
      const dy = (hgt[y1 + x] - hgt[y0 + x]) * K
      const l = 127.5 / Math.sqrt(dx * dx + dy * dy + 1)
      const i = (y * w + x) * 4
      np[i] = 127.5 - dx * l
      np[i + 1] = 127.5 + dy * l
      np[i + 2] = 127.5 + l
      np[i + 3] = 255
    }
  }
  ng.putImageData(nd, 0, 0)
  const map = toTex(cc)
  const normalMap = toTex(nc, false)
  if (tile) for (const t of [map, normalMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping
  let foilMap: THREE.CanvasTexture | null = null
  if (F) {
    await breathe()
    const [fc, fg] = mk(w, h)
    const fd = fg.createImageData(w, h)
    const fp = fd.data
    for (let i = 0; i < n; i++) {
      const a = F.m[i * 4 + 3]
      if (!a) continue
      const v = 0.9 + 0.1 * Math.min(1, Math.max(0, hgt[i] + 1.6)) // 金箔压在布纹上，留一点布纹的起伏
      fp[i * 4] = 255 * v
      fp[i * 4 + 1] = 200 * v
      fp[i * 4 + 2] = 112 * v
      fp[i * 4 + 3] = a
    }
    fg.putImageData(fd, 0, 0)
    foilMap = toTex(fc)
  }
  return { map, normalMap, foilMap }
}

const GREEN: [number, number, number] = [44, 98, 80]

const coverFoil: Stamp = (g, w) => {
  const u = w / 1280 // 版式按 1280 宽写
  g.textBaseline = 'alphabetic'
  let y: number
  if (EN) {
    const px = fit(g, T.t2, 900, 150 * u, 900 * u)
    g.textAlign = 'center'
    g.fillText(T.t1, w / 2, 600 * u)
    y = 600 * u + px * 1.22
    g.fillText(T.t2, w / 2, y)
  } else {
    g.font = `900 ${204 * u}px ${SERIF}`
    // 逗号挂在行尾，不参与居中
    const w1 = g.measureText('思考').width
    g.textAlign = 'left'
    g.fillText(T.t1, w / 2 - w1 / 2, 590 * u)
    g.textAlign = 'center'
    y = 832 * u
    g.fillText(T.t2, w / 2, y)
  }
  g.fillRect(w / 2 - 50 * u, y + 96 * u, 100 * u, 4 * u)
  g.font = `400 ${52 * u}px ${SERIF}`
  spaced(g, T.author, w / 2, y + 202 * u, (EN ? 5 : 12) * u)
  g.lineWidth = 8 * u
  g.lineCap = 'round'
  g.lineJoin = 'round'
  arrows(g, w / 2, 1296 * u, 165 * u, 38 * u, 1)
  arrows(g, w / 2, 1412 * u, 165 * u, 38 * u, -1)
  g.font = `900 ${42 * u}px ${SANS}`
  spaced(g, BRAND, w / 2, 1722 * u, 7 * u)
  g.fillRect(w / 2 - 250 * u, 1706 * u, 110 * u, 3 * u)
  g.fillRect(w / 2 + 140 * u, 1706 * u, 110 * u, 3 * u)
}
const coverBlind: Stamp = (g, w, h) => {
  const u = w / 1280
  g.lineWidth = 9 * u
  g.strokeRect(70 * u, 70 * u, w - 140 * u, h - 140 * u)
  g.lineWidth = 3 * u
  g.strokeRect(96 * u, 96 * u, w - 192 * u, h - 192 * u)
}
// 书脊：竖排书名、作者，上下各两道金线。画布的横向对应书脊从封底到封面的弧长
const spineFoil: Stamp = (g, w, h) => {
  const cx = w / 2
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const y of [86, 102, h - 102, h - 86]) g.fillRect(cx - 82, y - 2, 164, y === 86 || y === h - 86 ? 5 : 2)
  const side = (s: string, y: number, font: string, gap: number) => {
    g.save()
    g.translate(cx, y)
    g.rotate(Math.PI / 2)
    g.font = font
    spaced(g, s, 0, 0, gap)
    g.restore()
  }
  if (EN) {
    // 英文书脊：字横着排，从上往下读
    side(T.title, 470, `900 46px ${SERIF}`, 2)
    side(T.author, 900, `400 29px ${SERIF}`, 3)
  } else {
    g.font = `900 66px ${SERIF}`
    ;['思', '考', '', '快', '与', '慢'].forEach((ch, i) => ch && g.fillText(ch, cx, 196 + i * 76 - (i > 2 ? 34 : 0)))
    g.fillRect(cx - 3, 196 + 2 * 76 - 22, 6, 6)
    g.font = `400 31px ${SERIF}`
    ;[...T.author].forEach((ch, i) => g.fillText(ch, cx, 700 + i * 37))
  }
  side(BRAND, h - 196, `900 26px ${SANS}`, 3)
}

// 纸：底色、纤维、订口一侧的暗
function paper(w: number, h: number, seed: number, gutterLeft: boolean, tone = '#f6efde', k = 1) {
  const [c, g] = mk(Math.round(w * k), Math.round(h * k))
  g.scale(k, k) // 版式按原尺寸写，画布可以整体缩小
  const r = rng(seed)
  g.fillStyle = tone
  g.fillRect(0, 0, w, h)
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(120,96,60,0.035)'
    g.fillRect(r() * w, r() * h, 1 + r() * 7, 1)
  }
  const gr = g.createLinearGradient(gutterLeft ? 0 : w, 0, gutterLeft ? w * 0.26 : w * 0.74, 0)
  gr.addColorStop(0, 'rgba(92,70,40,0.34)')
  gr.addColorStop(0.3, 'rgba(92,70,40,0.11)')
  gr.addColorStop(1, 'rgba(92,70,40,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, w, h)
  const eg = g.createLinearGradient(gutterLeft ? w : 0, 0, gutterLeft ? w - 46 : 46, 0)
  eg.addColorStop(0, 'rgba(120,96,60,0.09)')
  eg.addColorStop(1, 'rgba(120,96,60,0)')
  g.fillStyle = eg
  g.fillRect(0, 0, w, h)
  return [c, g, r] as const
}

const INK = '#2b2a27'
const PWX = 768
const PHX = 1067
const M_IN = 92
const M_OUT = 74
const COLS = 34
const CELL = (PWX - M_IN - M_OUT) / COLS
const PITCH = 31.5

// 正文用“假字”排：每个格子里几笔横竖，远看是一行行宋体字，但不编造原文
function greek(g: CanvasRenderingContext2D, r: () => number, x0: number, y0: number, rows: number, firstIndent = true) {
  g.fillStyle = INK
  let left = 0
  let indent = firstIndent
  for (let row = 0; row < rows; row++) {
    if (left <= 0) left = 2 + Math.floor(r() * 6)
    const last = left === 1
    const cols = last ? 6 + Math.floor(r() * (COLS - 10)) : COLS
    if (EN) {
      // 英文：一个个长短不一的词，字母高矮不同
      const x1 = x0 + cols * CELL
      let x = x0 + (indent ? CELL * 1.6 : 0)
      const by = y0 + row * PITCH
      while (x < x1 - CELL) {
        const n = 1 + Math.floor(r() * r() * 11)
        for (let q = 0; q < n && x < x1 - 4; q++) {
          const t = r()
          const up = t < 0.3 ? 5.5 : 0
          const down = t > 0.88 ? 4.5 : 0
          g.globalAlpha = 0.45 + r() * 0.25
          const lw = 3.6 + r() * 3.4
          g.fillRect(x, by + 6.5 - up, 1.3, 8 + up + down)
          if (r() < 0.7) g.fillRect(x, by + (r() < 0.5 ? 6.5 : 13.2), lw, 1.2)
          if (r() < 0.45) g.fillRect(x + lw - 1.2, by + 6.5, 1.2, 8)
          x += lw + 2.2
        }
        x += CELL * 0.42
      }
      indent = last
      left--
      continue
    }
    for (let c = indent ? 2 : 0; c < cols; c++) {
      const bx = x0 + c * CELL + CELL * 0.1
      const by = y0 + row * PITCH
      const s = CELL * 0.8
      if (r() < 0.07) {
        g.globalAlpha = 0.7
        g.fillRect(bx + s * 0.08, by + s * 0.74, s * 0.17, s * 0.17)
        continue
      }
      // 一个字：几笔横、几笔竖、偶尔一撇，挤在一个方格里
      const k = 5 + Math.floor(r() * 4)
      for (let q = 0; q < k; q++) {
        g.globalAlpha = 0.42 + r() * 0.3
        const t = r()
        if (t < 0.5) {
          const a = r() * 0.45
          g.fillRect(bx + s * a, by + s * (0.04 + r() * 0.92), s * (0.35 + r() * (0.65 - a)), 1)
        } else if (t < 0.88) {
          const a = r() * 0.45
          g.fillRect(bx + s * (0.06 + r() * 0.88), by + s * a, 1.15, s * (0.35 + r() * (0.65 - a)))
        } else {
          g.fillRect(bx + s * (0.2 + r() * 0.6), by + s * (0.2 + r() * 0.6), 2, 2)
        }
      }
    }
    indent = last
    left--
  }
  g.globalAlpha = 1
}
function folio(g: CanvasRenderingContext2D, gutterLeft: boolean, no: number, head: string) {
  g.fillStyle = INK
  g.globalAlpha = 0.72
  g.font = `400 15px ${SERIF}`
  g.textBaseline = 'alphabetic'
  const xo = gutterLeft ? PWX - M_OUT : M_OUT
  spaced(g, head, xo, 84, 3, gutterLeft ? 'right' : 'left')
  g.globalAlpha = 0.85
  g.font = `400 17px ${SERIF}`
  g.textAlign = gutterLeft ? 'right' : 'left'
  g.fillText(String(no), xo, PHX - 56)
  g.globalAlpha = 1
}
const finish = (c: HTMLCanvasElement, verso: boolean) => {
  const t = toTex(c)
  if (verso) {
    // 反面那一页：同一块网格的背面看过去，左右要翻一下
    t.wrapS = THREE.RepeatWrapping
    t.repeat.x = -1
    t.offset.x = 1
  }
  return t
}

function textPage(no: number, seed: number) {
  const recto = no % 2 === 1
  const [c, g, r] = paper(PWX, PHX, seed, recto, undefined, 0.84)
  folio(g, recto, no, recto ? `${T.parts[0][0]}　${T.parts[0][1]}` : T.title)
  greek(g, r, recto ? M_IN : M_OUT, 128, 27, r() > 0.5)
  return finish(c, !recto)
}
function blankPage(seed: number, verso: boolean, k = 0.5) {
  const [c] = paper(PWX, PHX, seed, !verso, undefined, k)
  return finish(c, verso)
}
function halfTitle() {
  const [c, g] = paper(PWX, PHX, 21, true)
  g.fillStyle = INK
  g.textBaseline = 'alphabetic'
  g.font = `900 ${EN ? 30 : 34}px ${SERIF}`
  spaced(g, T.title, PWX / 2 + 8, 372, EN ? 1.5 : 6)
  return finish(c, false)
}
function titlePage() {
  const [c, g] = paper(PWX, PHX, 22, true)
  const cx = PWX / 2 + 8
  g.fillStyle = INK
  g.textBaseline = 'alphabetic'
  if (EN) {
    g.font = `900 70px ${SERIF}`
    g.textAlign = 'center'
    g.fillText(T.t1, cx, 310)
    g.fillText(T.t2, cx, 396)
  } else {
    g.font = `900 92px ${SERIF}`
    const w1 = g.measureText('思考').width
    g.textAlign = 'left'
    g.fillText(T.t1, cx - w1 / 2, 300)
    g.textAlign = 'center'
    g.fillText(T.t2, cx, 412)
    g.globalAlpha = 0.7
    g.font = `400 19px ${SERIF}`
    spaced(g, T.sub, cx, 470, 2.5)
    g.globalAlpha = 1
  }
  g.fillRect(cx - 22, EN ? 462 : 520, 44, 2)
  g.font = `400 ${EN ? 27 : 24}px ${SERIF}`
  spaced(g, T.by, cx, EN ? 540 : 590, EN ? 2 : 5)
  g.strokeStyle = INK
  g.lineWidth = 2.6
  g.lineCap = 'round'
  g.lineJoin = 'round'
  arrows(g, cx, 800, 62, 14, 1)
  arrows(g, cx, 842, 62, 14, -1)
  g.font = `900 17px ${SANS}`
  spaced(g, BRAND, cx, PHX - 96, 4)
  return finish(c, false)
}
function contentsPage() {
  const [c, g] = paper(PWX, PHX, 23, true)
  const x0 = M_IN + 26
  const x1 = PWX - M_OUT - 26
  g.fillStyle = INK
  g.textBaseline = 'alphabetic'
  g.font = `900 40px ${SERIF}`
  spaced(g, T.contents, x0, 200, EN ? 2 : 22, 'left')
  g.fillRect(x0, 232, 40, 2.5)
  const row = (y: number, a: string, b: string, cnote: string, big: boolean) => {
    g.globalAlpha = big ? 0.62 : 0.8
    g.font = `400 17px ${SERIF}`
    if (big) spaced(g, a, x0, y, EN ? 1 : 3, 'left')
    g.globalAlpha = big ? 1 : 0.82
    g.font = `${big ? 900 : 400} ${big ? (EN ? 24 : 27) : 22}px ${SERIF}`
    const gap = big ? (EN ? 0.5 : 3) : EN ? 1 : 8
    spaced(g, b, big ? x0 + 118 : x0, y, gap, 'left')
    if (cnote) {
      const bw = g.measureText(b).width + (b.length - 1) * gap
      g.globalAlpha = 0.62
      g.font = `400 16px ${SERIF}`
      spaced(g, cnote, x1, y, EN ? 0.5 : 1.5, 'right')
      // 点线引到右边
      g.globalAlpha = 0.34
      for (let x = x0 + 118 + bw + 22; x < x1 - (EN ? 136 : 118); x += 11) g.fillRect(x, y - 6, 2, 2)
    }
    g.globalAlpha = 1
  }
  row(322, '', T.intro, '', false)
  T.parts.forEach((p, i) => row(410 + i * 84, p[0], p[1], p[2], true))
  row(410 + 5 * 84 + 4, '', T.concl, '', false)
  return finish(c, false)
}
function partPage() {
  const [c, g] = paper(PWX, PHX, 24, true)
  const cx = PWX / 2 + 8
  g.fillStyle = INK
  g.textBaseline = 'alphabetic'
  g.globalAlpha = 0.7
  g.font = `400 23px ${SERIF}`
  spaced(g, T.parts[0][0], cx, 372, EN ? 4 : 12)
  g.globalAlpha = 1
  fit(g, T.parts[0][1], 900, 78, 540, EN ? 1 : 10)
  spaced(g, T.parts[0][1], cx, 482, EN ? 1 : 10)
  g.fillRect(cx - 24, 536, 48, 2.5)
  g.strokeStyle = INK
  g.lineWidth = 2.4
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.globalAlpha = 0.8
  arrows(g, cx, 640, 52, 12, 1)
  arrows(g, cx, 676, 52, 12, -1)
  g.globalAlpha = 1
  return finish(c, false)
}
function chapterPage(no: number) {
  const [c, g, r] = paper(PWX, PHX, 25, true)
  g.fillStyle = INK
  g.textBaseline = 'alphabetic'
  g.globalAlpha = 0.7
  g.font = `400 21px ${SERIF}`
  spaced(g, T.ch[0], M_IN, 236, EN ? 2 : 6, 'left')
  g.globalAlpha = 1
  fit(g, T.ch[1], 900, 50, PWX - M_IN - M_OUT - 8, EN ? 0.5 : 5)
  spaced(g, T.ch[1], M_IN - 2, 312, EN ? 0.5 : 5, 'left')
  g.fillRect(M_IN, 352, 56, 2.5)
  greek(g, r, M_IN, 128 + 10 * PITCH, 17, false)
  g.globalAlpha = 0.85
  g.font = `400 17px ${SERIF}`
  g.textAlign = 'right'
  g.fillText(String(no), PWX - M_OUT, PHX - 56)
  g.globalAlpha = 1
  return finish(c, false)
}

// 环衬：暖赭色的纸，上面铺一层很淡的小箭头线（封面那个错觉的缩小版）
function endpaper() {
  const w = 900
  const h = 1250
  const [c, g, r] = paper(w, h, 31, true, '#cfb07c', 0.8)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const sx = 75
  const sy = 50
  for (let j = -1; j < h / sy + 1; j++) {
    for (let i = -1; i < w / sx + 1; i++) {
      const x = i * sx + (j & 1 ? sx / 2 : 0) + 20
      const y = j * sy + 24
      const out = (i + (j >> 1)) & 1
      g.strokeStyle = out ? 'rgba(244,228,190,0.5)' : 'rgba(138,104,56,0.42)'
      g.lineWidth = 2.1
      arrows(g, x, y, 17, 6, out ? 1 : -1)
    }
  }
  for (let i = 0; i < 700; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,244,214,0.07)' : 'rgba(96,70,34,0.05)'
    g.fillRect(r() * w, r() * h, 1 + r() * 9, 1)
  }
  return toTex(c)
}

// 书口：一层层的纸。纵向 0–1 对应整本书芯的厚度
function edgeTex() {
  const w = 128
  const h = 1024
  const [c, g] = mk(w, h)
  const r = rng(41)
  g.fillStyle = '#efe5cf'
  g.fillRect(0, 0, w, h)
  let y = 0
  let n = 0
  while (y < h) {
    const t = 14 + r() * 13
    const l = 226 + r() * 24
    g.fillStyle = `rgb(${l + 8},${l},${l - 22})`
    g.fillRect(0, y, w, t)
    // 纸和纸之间的缝；每隔一帖深一点
    const sig = n % 6 === 5
    g.fillStyle = sig ? 'rgba(96,74,44,0.62)' : `rgba(110,88,56,${0.22 + r() * 0.3})`
    g.fillRect(0, y + t - (sig ? 5 : 3.2), w, sig ? 5 : 3.2)
    y += t
    n++
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(110,88,56,0.08)'
    g.fillRect(r() * w, r() * h, 6 + r() * 40, 1.4)
  }
  const t = toTex(c)
  t.wrapS = THREE.RepeatWrapping
  return t
}
// 堵头布：红白相间的细条纹
function bandTex() {
  const [c, g] = mk(16, 64)
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#efe2c6' : '#b93a2c'
    g.fillRect(0, i * 8, 16, 8)
    g.fillStyle = 'rgba(0,0,0,0.16)'
    g.fillRect(0, i * 8 + 7, 16, 1)
  }
  const t = toTex(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}
// 丝带：缎面上细密的竖纹
function ribbonTex() {
  const [c, g] = mk(64, 64)
  const r = rng(51)
  g.fillStyle = '#cf4532'
  g.fillRect(0, 0, 64, 64)
  for (let x = 0; x < 64; x += 2) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,190,160,0.12)' : 'rgba(60,0,0,0.12)'
    g.fillRect(x, 0, 1, 64)
  }
  const eg = g.createLinearGradient(0, 0, 64, 0)
  eg.addColorStop(0, 'rgba(60,0,0,0.3)')
  eg.addColorStop(0.12, 'rgba(60,0,0,0)')
  eg.addColorStop(0.88, 'rgba(60,0,0,0)')
  eg.addColorStop(1, 'rgba(60,0,0,0.3)')
  g.fillStyle = eg
  g.fillRect(0, 0, 64, 64)
  const t = toTex(c)
  t.wrapT = THREE.RepeatWrapping
  return t
}
// 书压在纸上的那一圈软阴影：方形，四周晕开
function softShadow() {
  const s = 128
  const [c, g] = mk(s, s)
  const d = g.createImageData(s, s)
  const half = 0.38 // 贴图中间这一块是书的底面，外面是晕开的范围
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const px = Math.abs((x + 0.5) / s - 0.5)
      const py = Math.abs((y + 0.5) / s - 0.5)
      const qx = Math.max(0, px - half + 0.03)
      const qy = Math.max(0, py - half + 0.03)
      const dist = Math.hypot(qx, qy) - 0.03 + Math.min(0, Math.max(px - half, py - half)) * 0.6
      const t = Math.min(1, Math.max(0, 1 - dist / 0.12))
      const a = t * t * t * (t * (6 * t - 15) + 10)
      const i = (y * s + x) * 4
      d.data[i] = 46
      d.data[i + 1] = 34
      d.data[i + 2] = 20
      d.data[i + 3] = Math.min(1, a * a * 1.25) * 255
    }
  }
  g.putImageData(d, 0, 0)
  return toTex(c)
}

// 烫金要反射点东西才像金属：搭一个只给金箔用的小“摄影棚”
function foilEnv(gl: THREE.WebGLRenderer) {
  const sc = new THREE.Scene()
  const lit = (r: number, g: number, b: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide, toneMapped: false })
  const room = new THREE.Mesh(new THREE.SphereGeometry(30, 24, 16), lit(0.16, 0.13, 0.09))
  sc.add(room)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 24), lit(0.5, 0.44, 0.33))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -4
  sc.add(floor)
  const panel = (el: number, az: number, w: number, h: number, c: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lit(...c))
    m.position.set(10 * Math.cos(el) * Math.sin(az), 10 * Math.sin(el), -10 * Math.cos(el) * Math.cos(az))
    m.lookAt(0, 0, 0)
    sc.add(m)
  }
  panel(0.77, 0, 15, 2.5, [2.3, 2.05, 1.6]) // 主灯箱：一条窄的亮带，正好落在封面反射的方向上
  panel(1.3, 0.3, 7, 5, [0.5, 0.46, 0.38])
  panel(0.4, -1.25, 2.2, 7, [0.9, 0.8, 0.62])
  panel(0.4, 1.3, 1.6, 7, [0.6, 0.55, 0.46])
  const pm = new THREE.PMREMGenerator(gl)
  const env = pm.fromScene(sc, 0.02).texture
  pm.dispose()
  sc.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
  })
  return env
}

export const NL = 8 // 飞起来的纸有几张

// 和语言无关的贴图：布纹、环衬、书口、堵头布、丝带、软阴影、金箔反射的环境。只画一次
async function makeBase(gl: THREE.WebGLRenderer) {
  sliceT = performance.now()
  const cloth = await clothSet(256, 256, 8, 9, GREEN, undefined, undefined, true)
  await tick()
  const env = foilEnv(gl)
  await tick()
  return { cloth, env, endpaper: endpaper(), blank: blankPage(59, false, 0.34), edge: edgeTex(), band: bandTex(), ribbon: ribbonTex(), shadow: softShadow() }
}
// 带字的贴图：封面和书脊。每种语言画一次
async function makeSkin(lang: Lang) {
  await loadBookFonts(lang)
  sliceT = performance.now()
  use(lang)
  const cover = await clothSet(1024, 1504, 1024 / 142, 5, GREEN, coverFoil, coverBlind)
  await tick()
  use(lang)
  const spine = await clothSet(288, 1284, 6.17, 7, GREEN, spineFoil)
  return { cover, spine }
}
export type BookBase = Awaited<ReturnType<typeof makeBase>>
export type BookSkin = Awaited<ReturnType<typeof makeSkin>>

let base: { gl: THREE.WebGLRenderer; p: Promise<BookBase> } | null = null
export function bookBase(gl: THREE.WebGLRenderer) {
  if (!base || base.gl !== gl) base = { gl, p: makeBase(gl) }
  return base.p
}
const skins: Partial<Record<Lang, Promise<BookSkin>>> = {}
export const bookSkin = (lang: Lang) => (skins[lang] ??= makeSkin(lang))

// 内页：书出现之后在后台一张张画，画好一张交出去一张。leaf 是第几张纸（NL 表示右边纸叠最上面那页），side 0 正面 1 反面
type Page = [leaf: number, side: 0 | 1, tex: THREE.Texture]
const pageJobs: (() => Page[])[] = [
  () => {
    const b = blankPage(60, true)
    return [0, 1, 2, 3, 4].map((i) => [i, 1, b] as Page)
  },
  () => [[1, 0, halfTitle()]],
  () => [[2, 0, titlePage()]],
  () => [[3, 0, contentsPage()]],
  () => [[4, 0, partPage()]],
  () => [[5, 0, chapterPage(19)]],
  () => [[5, 1, textPage(20, 70)]],
  () => [[6, 0, textPage(21, 71)]],
  () => [[6, 1, textPage(22, 72)]],
  () => [[7, 0, textPage(23, 73)]],
  () => {
    const t = textPage(24, 74)
    return [[7, 1, t], [NL, 1, t]] // 摊平后左边纸叠的顶面也是这一页
  },
  () => [[NL, 0, textPage(25, 75)]],
]
const pageDone: Record<Lang, Page[][]> = { zh: [], en: [] }
export async function drawPages(lang: Lang, apply: (leaf: number, side: 0 | 1, t: THREE.Texture) => void, dead: () => boolean) {
  const done = pageDone[lang]
  await loadBookFonts(lang)
  for (let i = 0; i < pageJobs.length; i++) {
    if (dead()) return
    if (!done[i]) {
      await new Promise((r) => setTimeout(r, 30))
      use(lang)
      if (!done[i]) done[i] = pageJobs[i]()
    }
    if (dead()) return
    for (const [leaf, side, t] of done[i]) apply(leaf, side, t)
  }
}
