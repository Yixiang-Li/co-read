// 诊断加载：每 2 秒记一次页面状态，打印所有报错。BASE=<地址> VIEW=390x844 TOUCH=1 node tools/check/diag.mjs
import puppeteer from 'puppeteer-core'
const BASE = process.env.BASE ?? 'http://localhost:5190/'
const [vw, vh] = (process.env.VIEW ?? '390x844').split('x').map(Number)
const touch = process.env.TOUCH === '1'
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const bye = () => { try { browser.process()?.kill('SIGKILL') } catch {} ; process.exit(1) }
for (const s of ['SIGALRM', 'SIGTERM', 'SIGINT']) process.on(s, bye)
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)))
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.log('CONSOLE', m.type(), m.text().slice(0, 300)))
page.on('requestfailed', (r) => console.log('FAILED', r.url().slice(-80), r.failure()?.errorText))
page.on('response', (r) => r.status() >= 400 && console.log('HTTP', r.status(), r.url().slice(-80)))
await page.setViewport({ width: vw, height: vh, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch })
const t0 = Date.now()
await page.goto(`${BASE}?lang=${process.env.LANG2 ?? 'en'}`, { waitUntil: 'domcontentloaded' })
for (let i = 0; i < 12; i++) {
  const s = await Promise.race([
    page.evaluate(() => ({ bus: !!window.__bus, frames: window.__frames ?? null, loader: !!document.querySelector('.loader'), canvas: !!document.querySelector('canvas'), root: document.getElementById('root')?.children.length, q: window.__bus?.quality })),
    new Promise((r) => setTimeout(() => r('EVALUATE TIMEOUT（主线程卡住）'), 4000)),
  ])
  console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(s))
  if (s && s.bus && !s.loader) break
  await new Promise((r) => setTimeout(r, 2000))
}
await browser.close()
