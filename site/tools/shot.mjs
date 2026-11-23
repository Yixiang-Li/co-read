// 截图工具。用法：
//   node tools/shot.mjs <输出目录> <地址参数> <动作脚本.mjs 可选>
// 例：node tools/shot.mjs .shots/coin "?micro=coin"
// 不带动作脚本时：打开页面，等 3 秒，截一张 00.jpg。
// 动作脚本需要 export default async ({ page, shot, sleep, proj, bus, hold }) => { ... }
//   shot(name)            截图到 <输出目录>/<name>.jpg
//   proj(x, y, z)         世界坐标 → 屏幕坐标 [px, py]
//   bus()                 读取共享状态（bus.pos、bus.slow、bus.micro 等）
//   hold(ms)              把鼠标移到“慢”身上按住 ms 毫秒（相当于访客按住慢）
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const [, , out = '.shots/tmp', query = '', script] = process.argv
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--window-size=1440,900', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
// 超时或被中断时也要把浏览器一起关掉，否则它会留在后台一直渲染、把机器拖垮
const bye = () => {
  try {
    browser.process()?.kill('SIGKILL')
  } catch {}
  process.exit(1)
}
for (const s of ['SIGALRM', 'SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, bye)
process.on('uncaughtException', (e) => (console.log('ERROR', e.message), bye()))
process.on('unhandledRejection', (e) => (console.log('ERROR', e?.message ?? e), bye()))
setTimeout(bye, Number(process.env.SHOT_MAX_MS ?? 150000)).unref()
const page = await browser.newPage()
page.on('console', (m) => m.text().includes('BUILD_MS') && console.log(m.text()))
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => m.type() === 'error' && !m.text().includes('synchronously unmount') && console.log('CONSOLE', m.text().slice(0, 300)))
// 环境变量 VIEW=390x844 可以换视口（测手机）；TOUCH=1 模拟触屏
const [vw, vh] = (process.env.VIEW ?? '1440x900').split('x').map(Number)
await page.setViewport({ width: vw, height: vh, deviceScaleFactor: process.env.TOUCH ? 2 : 1, isMobile: !!process.env.TOUCH, hasTouch: !!process.env.TOUCH })
await page.goto(`http://localhost:${process.env.PORT ?? 5183}/` + query, { waitUntil: 'domcontentloaded', timeout: 60000 })
if (!query.includes('model=') && !query.includes('style=')) await page.waitForFunction(() => window.__bus, { timeout: 60000 })
await page.evaluate(() => document.fonts.ready)
const shot = (name) => page.screenshot({ path: `${out}/${name}.jpg`, quality: 86, type: 'jpeg' })
const proj = (x, y, z) => page.evaluate((x, y, z) => window.__proj(x, y, z), x, y, z)
const bus = () => page.evaluate(() => JSON.parse(JSON.stringify({ ...window.__bus, cam: undefined })))
const hold = async (ms) => {
  const b = await bus()
  await page.mouse.move(b.slow.x, b.slow.y, { steps: 20 })
  await sleep(250)
  await page.mouse.down()
  await sleep(ms)
  await page.mouse.up()
}
if (script) await (await import(pathToFileURL(resolve(script)).href)).default({ page, shot, sleep, proj, bus, hold })
else {
  await sleep(3000)
  await shot('00')
}
await browser.close()
