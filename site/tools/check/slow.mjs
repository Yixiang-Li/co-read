// 慢网 + 慢 CPU 下的加载过程：每 0.5 秒拍一张，记录关键时刻。
// BASE=<地址> RTT=300 KBPS=190 CPU=4 VIEW=390x844 TOUCH=1 node tools/check/slow.mjs
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
const BASE = process.env.BASE ?? 'http://localhost:5190/'
const [vw, vh] = (process.env.VIEW ?? '390x844').split('x').map(Number)
const touch = process.env.TOUCH === '1'
const RTT = Number(process.env.RTT ?? 300), KBPS = Number(process.env.KBPS ?? 190), CPU = Number(process.env.CPU ?? 4)
const TAG = process.env.TAG ?? 'slow'
const dir = `.shots/slow/${TAG}`
mkdirSync(dir, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const bye = () => { try { browser.process()?.kill('SIGKILL') } catch {} ; process.exit(1) }
for (const s of ['SIGALRM', 'SIGTERM', 'SIGINT']) process.on(s, bye)
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)))
await page.setViewport({ width: vw, height: vh, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch })
const cdp = await page.createCDPSession()
await cdp.send('Network.enable')
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: RTT, downloadThroughput: KBPS * 1024, uploadThroughput: 90 * 1024 })
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
let bytes = 0
cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength))
const t0 = Date.now()
const ev = []
page.goto(`${BASE}?lang=${process.env.LANG2 ?? 'zh'}`, { waitUntil: 'domcontentloaded', timeout: 120000 }).then(() => ev.push(['HTML 到达', Date.now() - t0]))
const seen = {}
for (let i = 0; i < 80; i++) {
  await new Promise((r) => setTimeout(r, 500))
  const t = Date.now() - t0
  let s = {}
  try {
    s = await Promise.race([page.evaluate(() => ({ loader: !!document.querySelector('.loader'), loaderText: document.querySelector('.loader-t')?.textContent ?? '', done: !!document.querySelector('.loader.done'), bus: !!window.__bus, frames: window.__frames ?? 0, text: document.body?.innerText.slice(0, 40) ?? '' })), new Promise((r) => setTimeout(() => r({ busy: true }), 1500))])
  } catch { s = { nav: true } }
  for (const [k, label] of [['loader', '出现加载页'], ['bus', '三维场景开始'], ['done', '加载页开始淡出']]) if (s[k] && !seen[k]) { seen[k] = t; ev.push([label, t]) }
  if (seen.done && !s.loader && !seen.gone) { seen.gone = t; ev.push(['加载页完全消失', t]) }
  if (i % 2 === 1 || (seen.done && !seen.shotDone)) {
    try { await page.screenshot({ path: `${dir}/${String(t).padStart(6, '0')}.jpg`, type: 'jpeg', quality: 70 }) } catch {}
    if (seen.done) seen.shotDone = true
  }
  if (seen.gone && t - seen.gone > 2000) break
}
console.log(`[${TAG}] RTT ${RTT}ms，${KBPS} KB/s，CPU 慢 ${CPU} 倍，${vw}×${vh}`)
for (const [l, t] of ev.sort((a, b) => a[1] - b[1])) console.log(`  ${(t / 1000).toFixed(1)}s  ${l}`)
console.log(`  共下载 ${(bytes / 1024).toFixed(0)} KB`)
await browser.close()
