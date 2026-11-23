// 量首次打开要下载多少：到能操作为止，按类型汇总传输字节数。BASE=<地址> node tools/check/weight.mjs
import puppeteer from 'puppeteer-core'
const BASE = process.env.BASE ?? 'http://localhost:5190/'
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const bye = () => { try { browser.process()?.kill('SIGKILL') } catch {} ; process.exit(1) }
for (const s of ['SIGALRM', 'SIGTERM', 'SIGINT']) process.on(s, bye)
for (const lang of ['zh', 'en']) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const cdp = await page.createCDPSession()
  await cdp.send('Network.enable')
  const sum = {}
  const type = {}
  let n = 0
  cdp.on('Network.responseReceived', (e) => (type[e.requestId] = e.response.mimeType))
  cdp.on('Network.loadingFinished', (e) => {
    const m = type[e.requestId] ?? '?'
    const k = /font|woff/.test(m) ? '字体' : /javascript/.test(m) ? '脚本' : /css/.test(m) ? '样式' : /html/.test(m) ? '页面' : '其他'
    sum[k] = (sum[k] ?? 0) + e.encodedDataLength
    n++
  })
  const t0 = Date.now()
  await page.goto(`${BASE}?lang=${lang}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.querySelector('.loader'), { timeout: 60000 })
  const t1 = Date.now() - t0
  const first = { ...sum }
  const n1 = n
  await new Promise((r) => setTimeout(r, 6000))
  const kb = (o) => Object.entries(o).map(([k, v]) => `${k} ${(v / 1024).toFixed(0)}KB`).join('，') + `；合计 ${(Object.values(o).reduce((a, b) => a + b, 0) / 1024).toFixed(0)}KB`
  console.log(`[${lang}] 到加载页消失 ${t1}ms，${n1} 个请求：${kb(first)}`)
  console.log(`[${lang}] 再等 6 秒后共 ${n} 个请求：${kb(sum)}`)
  await ctx.close()
}
await browser.close()
