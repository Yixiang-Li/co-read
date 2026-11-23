// 录一段操作录像。用法：node tools/record.mjs <输出.mp4> "<地址参数>" <动作脚本.mjs>
// 动作脚本和 shot.mjs 的一样：export default async ({ page, sleep, proj, bus, hold, move, click, drag }) => { ... }
//   move(x, y, ms)   鼠标平滑移到屏幕上的 (x, y)，用 ms 毫秒
//   click(x, y)      移过去点一下
//   drag(x0, y0, x1, y1, ms)  按住从一点拖到另一点
// 环境变量 VIEW=1440x900 改画面大小。录的是真实渲染的画面，界面上的鼠标用一个小圆点代替。
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const [, , out = 'preview/out.mp4', query = '', script] = process.argv
const [vw, vh] = (process.env.VIEW ?? '1440x900').split('x').map(Number)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: [`--window-size=${vw},${vh}`, '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const bye = (code = 1) => {
  try {
    browser.process()?.kill('SIGKILL')
  } catch {}
  process.exit(code)
}
for (const s of ['SIGALRM', 'SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => bye())
process.on('uncaughtException', (e) => (console.log('ERROR', e.message), bye()))
process.on('unhandledRejection', (e) => (console.log('ERROR', e?.message ?? e), bye()))
setTimeout(bye, Number(process.env.SHOT_MAX_MS ?? 400000)).unref()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1 })
await page.goto(`http://localhost:${process.env.PORT ?? 5183}/` + query, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForFunction(() => window.__bus, { timeout: 60000 })
await page.evaluate(() => document.fonts.ready)
// 界面上的鼠标：一个小圆点（三维画面里兔子就是光标，所以只在界面元素上显示）
await page.evaluate(() => {
  const d = document.createElement('div')
  d.style.cssText = 'position:fixed;left:0;top:0;z-index:999;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:rgba(246,238,219,.92);box-shadow:0 1px 6px rgba(0,0,0,.5);pointer-events:none;opacity:0;transition:opacity .15s'
  document.body.appendChild(d)
  addEventListener('pointermove', (e) => {
    d.style.transform = `translate(${e.clientX}px,${e.clientY}px)`
    const onCanvas = e.target?.tagName === 'CANVAS' && document.documentElement.classList.contains('opened')
    d.style.opacity = onCanvas ? '0' : '1'
  })
})
let mx = vw / 2
let my = vh / 2
await page.mouse.move(mx, my)
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
const move = async (x, y, ms = 600) => {
  const n = Math.max(2, Math.round(ms / 16))
  const x0 = mx
  const y0 = my
  for (let i = 1; i <= n; i++) {
    const k = ease(i / n)
    await page.mouse.move(x0 + (x - x0) * k, y0 + (y - y0) * k)
    await sleep(14)
  }
  mx = x
  my = y
}
const click = async (x, y, ms = 600) => {
  await move(x, y, ms)
  await sleep(120)
  await page.mouse.down()
  await sleep(70)
  await page.mouse.up()
}
const drag = async (x0, y0, x1, y1, ms = 900) => {
  await move(x0, y0, 500)
  await sleep(150)
  await page.mouse.down()
  await sleep(120)
  await move(x1, y1, ms)
  await sleep(150)
  await page.mouse.up()
}
const proj = (x, y, z) => page.evaluate((x, y, z) => window.__proj(x, y, z), x, y, z)
const bus = () => page.evaluate(() => JSON.parse(JSON.stringify({ ...window.__bus, cam: undefined })))
const hold = async (ms) => {
  const b = await bus()
  await move(b.slow.x, b.slow.y, 700)
  await sleep(250)
  await page.mouse.down()
  const t0 = Date.now()
  while (Date.now() - t0 < ms + 15000) {
    await sleep(200)
    if ((await page.evaluate(() => window.__bus.awake)) && Date.now() - t0 > 600) break
  }
  await sleep(250)
  await page.mouse.up()
}
const webm = out.replace(/\.mp4$/, '.webm')
const rec = await page.screencast({ path: webm })
await (await import(pathToFileURL(resolve(script)).href)).default({ page, sleep, proj, bus, hold, move, click, drag })
await rec.stop()
await browser.close()
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf', 'fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out])
rmSync(webm)
console.log('RECORDED', out)
