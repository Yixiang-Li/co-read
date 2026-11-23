// 测流畅度。用法：node tools/perf.mjs "<地址参数>" [秒数=5]
// 输出：平均帧率、最差的 5% 帧的帧率、每帧绘制调用数和三角形数。目标见 BRIEF_COMMON.md 的“性能预算”。
import puppeteer from 'puppeteer-core'
const [, , query = '?table', secs = '5'] = process.argv
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--window-size=1440,900', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'] })
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
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
await page.goto(`http://localhost:${process.env.PORT ?? 5183}/` + query, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForFunction(() => window.__bus, { timeout: 60000 })
await new Promise((r) => setTimeout(r, 4000))
await page.mouse.move(700, 500)
const res = await page.evaluate(
  (ms) =>
    new Promise((done) => {
      const t = []
      let last = performance.now()
      const start = last
      let n = 0
      const f = (now) => {
        t.push(now - last)
        last = now
        // 鼠标绕圈，让跟随的角色一直在动
        n++
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 720 + Math.cos(n / 20) * 300, clientY: 480 + Math.sin(n / 20) * 180 }))
        if (now - start < ms) requestAnimationFrame(f)
        else {
          t.sort((a, b) => a - b)
          const avg = t.reduce((a, b) => a + b, 0) / t.length
          const p95 = t[Math.floor(t.length * 0.95)]
          const i = window.__info || {}
          done({ 平均帧率: Math.round(1000 / avg), 最差5的帧率: Math.round(1000 / p95), 绘制调用: i.calls, 三角形: i.triangles, 画质档: window.__bus?.quality, 像素比: document.querySelector('.world canvas')?.width / innerWidth })
        }
      }
      requestAnimationFrame(f)
    }),
  Number(secs) * 1000,
)
console.log(query, JSON.stringify(res))
await browser.close()
