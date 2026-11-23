// 拍 README 用的图，存到仓库根目录的 docs/。对着打包好的版本跑（npm run build && npm run preview -- --port 5190）。
// 用法：node tools/readme-shots.mjs [只拍哪几张，逗号分隔：cover,overview,intro,islands,characters,phone]
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = resolve(root, '../../docs')
const TMP = join(root, '.shots/readme')
mkdirSync(DOCS, { recursive: true })
mkdirSync(TMP, { recursive: true })
const BASE = process.env.BASE ?? `http://localhost:${process.env.PORT ?? 5190}/`
const only = (process.argv[2] ?? 'cover,overview,intro,islands,characters,phone').split(',')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars'] })
const bye = (code = 1) => {
  try {
    browser.process()?.kill('SIGKILL')
  } catch {}
  process.exit(code)
}
for (const s of ['SIGALRM', 'SIGTERM', 'SIGINT']) process.on(s, () => bye())

const open = async (q, { w = 1600, h = 1000, dpr = 1.25, touch = false } = {}) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 160)))
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr, isMobile: touch, hasTouch: touch })
  await page.goto(BASE + q, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__bus && !document.querySelector('.loader'), { timeout: 60000 })
  return page
}
const B = (page, f, ...a) => page.evaluate(f, ...a)
const jpg = (page, path, q = 86) => page.screenshot({ path, type: 'jpeg', quality: q })
const compose = (...a) => execFileSync('python3', [join(root, 'tools/readme-compose.py'), ...a], { stdio: 'inherit' })

if (only.includes('cover')) {
  const page = await open('?lang=en')
  await sleep(2500)
  await jpg(page, join(DOCS, 'cover.jpg'))
  await page.close()
  console.log('cover')
}

if (only.includes('overview')) {
  const page = await open('?table&lang=en')
  await sleep(2500)
  // 兔子（光标）停在消防员的岛上，选框和名签亮起来
  const p = await B(page, () => { const a = window.__bus.pos.helmet; return window.__proj(a.x, 0.4, a.z) })
  await page.mouse.move(p[0] + 160, p[1] + 120)
  await page.mouse.move(p[0], p[1], { steps: 30 })
  await sleep(1400)
  await jpg(page, join(DOCS, 'overview.jpg'))
  await page.close()
  console.log('overview')
}

if (only.includes('intro')) {
  // 开场：兔子抢答 17 × 24，乌龟按住才醒；拍一张按到一半（世界在变慢、褪色），一张想完以后的笔记本
  const page = await open('?lang=en')
  await sleep(800)
  await (await page.$('.bookhint')).click()
  await page.waitForFunction(() => (document.querySelector('.slow-hint')?.textContent ?? '').length > 0, { timeout: 40000 })
  await sleep(700)
  await jpg(page, join(DOCS, 'fast.jpg'))
  const s = await B(page, () => window.__bus.slow)
  await page.mouse.move(s.x, s.y, { steps: 10 })
  await sleep(250)
  await page.mouse.down()
  await page.waitForFunction(() => window.__bus.p > 0.62, { timeout: 20000 })
  await jpg(page, join(DOCS, 'slow.jpg'))
  await page.waitForFunction(() => window.__bus.awake, { timeout: 20000 })
  await page.mouse.up()
  await sleep(2400)
  await jpg(page, join(DOCS, 'notebook.jpg'))
  await page.close()
  console.log('intro')
}

if (only.includes('islands')) {
  // 九个微观世界拼成 3×3
  const IDS = ['lines', 'paddle', 'folder', 'vinyl', 'tree', 'coin', 'pawn', 'rose', 'helmet']
  for (const id of IDS) {
    const page = await open(`?micro=${id}&lang=en`, { w: 1200, h: 800, dpr: 1 })
    await page.waitForFunction(() => window.__bus.micro.k > 0.97, { timeout: 20000 })
    await sleep(id === 'tree' ? 8000 : 4800)
    await jpg(page, join(TMP, `micro_${id}.jpg`), 92)
    await page.close()
    console.log('micro', id)
  }
  compose('islands', join(DOCS, 'islands.jpg'), ...IDS.map((id) => join(TMP, `micro_${id}.jpg`)))
}

if (only.includes('characters')) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.25 })
  await page.goto(BASE + '?model=hare,tortoise', { waitUntil: 'domcontentloaded' })
  await sleep(5000)
  await jpg(page, join(DOCS, 'characters.jpg'))
  await page.close()
  console.log('characters')
}

if (only.includes('phone')) {
  // 三张手机截图并排：封面、琳达的岛、读卡（手机竖屏上把场景里太小的字另排一张纸卡）
  const shots = [
    ['?lang=en', 2200, 'phone_cover'],
    ['?micro=folder&lang=en', 6000, 'phone_folder'],
    ['?micro=pawn&lang=en', 7500, 'phone_pawn'],
  ]
  for (const [q, wait, name] of shots) {
    const page = await open(q, { w: 390, h: 844, dpr: 2, touch: true })
    await sleep(wait)
    await page.screenshot({ path: join(TMP, `${name}.png`) })
    await page.close()
    console.log(name)
  }
  // 圆角，放在深色底上排成一排
  compose('phone', join(DOCS, 'phone.jpg'), ...shots.map(([, , name]) => join(TMP, `${name}.png`)))
}

await browser.close()
console.log('done →', DOCS)
