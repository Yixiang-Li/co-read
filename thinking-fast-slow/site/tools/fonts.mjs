// 按用字裁剪思源宋体：扫出网站文案里用到的字，每个字重只生成一个只含这些字的文件。
// 用法：node tools/fonts.mjs          生成 src/fonts/（打包前自动运行）
//       node tools/fonts.mjs --check  打包后核对：dist 里出现的每个字都在裁剪后的字体里
// 每个字重出两个文件：西文（字母、数字、西文标点）和中文（汉字、中文标点），浏览器按页面上出现的字只下需要的那个。
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAst } from 'rolldown/parseAst'
import subsetFont from 'subset-font'
import * as fontkit from 'fontkit'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(root, 'node_modules/@fontsource/noto-serif-sc')
const OUT = join(root, 'src/fonts')
const WEIGHTS = [400, 600, 900]
const FAMILY = 'Noto Serif SC'

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const add = (set, s) => {
  for (const ch of s) {
    const c = ch.codePointAt(0)
    if (c > 0x7f && !(c >= 0xd800 && c <= 0xdfff) && ![0xfeff, 0x200b, 0x200c, 0x200d, 0x2060, 0xa0].includes(c)) set.add(c)
  }
}

// 小于这个码位的算西文（字母、数字、西文标点、符号），其余算中文
const CJK_FROM = 0x2e80
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i)

// 只收写给人看的字：字符串、模板字符串、界面标签里的文字；注释和正则不算
const strings = (set, code, lang) => {
  const visit = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(visit)
    if (n.type === 'Literal' && typeof n.value === 'string') add(set, n.value)
    else if (n.type === 'TemplateElement') add(set, n.value.cooked ?? n.value.raw)
    else if (n.type === 'JSXText') add(set, n.value)
    for (const k in n) if (k !== 'type') visit(n[k])
  }
  visit(parseAst(code, { lang }))
}

// 网页本身：去掉注释；内嵌脚本只收字符串，样式里去掉注释
const html = (set, s) => {
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_, code) => (code.trim() && strings(set, code, 'js'), ''))
  s = s.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => (add(set, css.replace(/\/\*[\s\S]*?\*\//g, '')), ''))
  add(set, s)
}

// 一、源码里写给人看的字：字符串、模板字符串、界面标签里的文字（不含注释）
const fromSource = () => {
  const set = new Set()
  for (const file of walk(join(root, 'src'))) {
    if (file.startsWith(OUT)) continue
    if (/\.(ts|tsx)$/.test(file)) {
      strings(set, readFileSync(file, 'utf8'), file.endsWith('x') ? 'tsx' : 'ts')
    } else if (file.endsWith('.css')) add(set, readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
  }
  html(set, readFileSync(join(root, 'index.html'), 'utf8'))
  return set
}

// 二、打包结果里出现的字（压缩后没有注释），用来核对
const fromDist = () => {
  const set = new Set()
  const dir = join(root, 'dist')
  for (const file of walk(dir)) {
    if (file.endsWith('.js')) strings(set, readFileSync(file, 'utf8'), 'js')
    else if (file.endsWith('.css')) add(set, readFileSync(file, 'utf8').replace(/@font-face\s*\{[^}]*\}/g, ''))
    else if (file.endsWith('.html')) html(set, readFileSync(file, 'utf8'))
  }
  return set
}

const compact = (codes) => {
  const a = [...codes].sort((x, y) => x - y)
  const out = []
  for (let i = 0; i < a.length; i++) {
    let j = i
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++
    const h = (n) => n.toString(16).toUpperCase()
    out.push(i === j ? `U+${h(a[i])}` : `U+${h(a[i])}-${h(a[j])}`)
    i = j
  }
  return out.join(',')
}
const show = (codes) => [...codes].sort((x, y) => x - y).map((c) => String.fromCodePoint(c)).join('')

const source = (w) => readFileSync(join(PKG, `files/noto-serif-sc-chinese-simplified-${w}-normal.woff2`))

const PARTS = [
  { key: 'w', name: '西文', pick: (c) => c < CJK_FROM },
  { key: 'c', name: '中文', pick: (c) => c >= CJK_FROM },
]
const file = (w, key) => `noto-serif-sc-${key}-${w}.woff2`

if (process.argv.includes('--check')) {
  const want = [...fromDist()]
  let bad = 0
  for (const w of WEIGHTS) {
    const full = fontkit.create(source(w))
    const fonts = PARTS.map((p) => ({ p, font: fontkit.create(readFileSync(join(OUT, file(w, p.key)))) }))
    const miss = want.filter((c) => full.hasGlyphForCodePoint(c) && !fonts.find((f) => f.p.pick(c)).font.hasGlyphForCodePoint(c))
    if (miss.length) {
      bad += miss.length
      console.log(`字重 ${w} 缺 ${miss.length} 个字：${show(miss)}`)
    }
  }
  if (bad) {
    console.log('裁剪后的字体不全：先运行 node tools/fonts.mjs 再打包')
    process.exit(1)
  }
  console.log(`核对通过：打包结果里的 ${want.length} 个非 ASCII 字符都在裁剪后的字体里（或原字体本来就没有）`)
} else {
  const used = fromSource()
  const want = [...new Set([...ASCII, ...used])]
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  let css = `/* 由 tools/fonts.mjs 生成，不要手改。只含网站文案用到的字；改了文案后重新打包会自动更新。 */\n`
  let total = 0
  let none = []
  for (const w of WEIGHTS) {
    const buf = source(w)
    const full = fontkit.create(buf)
    none = want.filter((c) => !full.hasGlyphForCodePoint(c))
    const line = []
    for (const p of PARTS) {
      const have = want.filter((c) => p.pick(c) && full.hasGlyphForCodePoint(c))
      const sub = await subsetFont(buf, show(have), { targetFormat: 'woff2' })
      writeFileSync(join(OUT, file(w, p.key)), sub)
      total += sub.length
      css += `@font-face {\n  font-family: '${FAMILY}';\n  font-style: normal;\n  font-display: swap;\n  font-weight: ${w};\n  src: url(./${file(w, p.key)}) format('woff2');\n  unicode-range: ${compact(have)};\n}\n`
      line.push(`${p.name} ${have.length} 个字 ${(sub.length / 1024).toFixed(0)} KB`)
    }
    console.log(`字重 ${w}：${line.join('，')}（原文件 ${(buf.length / 1024).toFixed(0)} KB）`)
  }
  writeFileSync(join(OUT, 'noto-serif-sc.css'), css)
  console.log(`合计 ${(total / 1024).toFixed(0)} KB；文案里共 ${used.size} 个非 ASCII 字符`)
  if (none.length) console.log(`原字体里没有、会用系统字体显示的 ${none.length} 个：${show(none)}`)
}
