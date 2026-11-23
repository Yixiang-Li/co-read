// 多种屏幕尺寸 × 几个画面，拍成对照图。node tools/check/views.mjs（默认对本地 5190）
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
const BASE = process.env.BASE ?? 'http://localhost:5190/'
const VIEWS = (process.env.VIEWS ?? '375x667t,430x932t,844x390t,768x1024t,1024x768t,1280x720,1920x1080,2560x1080').split(',')
const STATES = (process.env.STATES ?? 'cover:?lang=zh,intro:?panel=intro&lang=zh,table:?table&lang=zh,micro:?micro=folder&lang=zh,panel_en:?panel=lines&lang=en').split(',').map((s) => s.split(/:(.*)/s).slice(0, 2))
const dir = `.shots/views/${process.env.TAG ?? 'now'}`
mkdirSync(dir, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const bye = () => { try { browser.process()?.kill('SIGKILL') } catch {} ; process.exit(1) }
for (const s of ['SIGALRM', 'SIGTERM', 'SIGINT']) process.on(s, bye)
for (const v of VIEWS) {
  const touch = v.endsWith('t')
  const [w, h] = v.replace('t', '').split('x').map(Number)
  for (const [name, q] of STATES) {
    const page = await browser.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)))
    await page.setViewport({ width: w, height: h, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch })
    await page.goto(BASE + q, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__bus && !document.querySelector('.loader'), { timeout: 60000 }).catch(() => errs.push('加载页没消失'))
    await new Promise((r) => setTimeout(r, name === 'micro' ? 5000 : 3200))
    // 文字溢出：任何可见元素超出视口，或文字被截断
    const over = await page.evaluate(() => {
      const out = []
      const W = innerWidth, H = innerHeight
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue
        if (el.closest('canvas')) continue
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height) continue
        const txt = (el.childNodes[0]?.nodeType === 3 ? el.textContent.trim().slice(0, 18) : '') || el.className?.toString().slice(0, 24)
        if (r.left < -1 || r.right > W + 1 || r.bottom > H + 1 || r.top < -1) if (el.children.length === 0 && el.textContent.trim()) out.push(`出界 ${txt} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`)
        if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible' && el.textContent.trim()) out.push(`横向截断 ${txt}`)
        if (el.children.length === 0 && el.textContent.trim() && parseFloat(cs.fontSize) < 11) out.push(`字太小 ${parseFloat(cs.fontSize)}px ${txt}`)
        if ((el.tagName === 'BUTTON' || el.matches('[data-hot],a')) && (r.width < 32 || r.height < 32)) out.push(`点击区太小 ${Math.round(r.width)}×${Math.round(r.height)} ${txt || el.getAttribute('aria-label')}`)
      }
      return [...new Set(out)].slice(0, 8)
    })
    await page.screenshot({ path: `${dir}/${v}_${name}.jpg`, type: 'jpeg', quality: 80 })
    const all = [...errs, ...over]
    if (all.length) console.log(v, name, all.join(' | '))
    await page.close()
  }
}
await browser.close()
console.log('done')
