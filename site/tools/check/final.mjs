// 上线前的总检查：对着正式打包的版本（PORT=5190），中英文各走一遍完整流程，九个案例逐个进出，
// 记录所有报错、失败的请求、最长的卡顿帧。截图放 .shots/final/<lang>/
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
const PORT = process.env.PORT ?? 5190
const [vw, vh] = (process.env.VIEW ?? '1440x900').split('x').map(Number)
const touch = !!process.env.TOUCH
const tag = process.env.TAG ?? 'd'
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: [`--window-size=${vw},${vh}`, '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const bye = () => { try { browser.process()?.kill('SIGKILL') } catch {} ; process.exit(1) }
for (const s of ['SIGALRM', 'SIGTERM', 'SIGINT']) process.on(s, bye)
process.on('unhandledRejection', (e) => { console.log('ERROR', e?.message ?? e); bye() })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const IDS = ['lines', 'vinyl', 'tree', 'helmet', 'paddle', 'pawn', 'rose', 'coin', 'folder']
for (const lang of (process.env.LANGS ?? 'zh,en').split(',')) {
  const out = `.shots/final/${tag}_${lang}`; mkdirSync(out, { recursive: true })
  const page = await browser.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push('页面报错 ' + e.message.slice(0, 160)))
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/synchronously unmount|THREE.Clock|GPU stall|deprecated/i.test(m.text()) && problems.push(`控制台${m.type()} ` + m.text().slice(0, 160)))
  page.on('requestfailed', (r) => problems.push('请求失败 ' + r.url().slice(-60)))
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ` + r.url().slice(-60)))
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch })
  const shot = (n) => page.screenshot({ path: `${out}/${n}.jpg`, type: 'jpeg', quality: 84 })
  const B = (f) => page.evaluate(f)
  const t0 = Date.now()
  await page.goto(`${process.env.BASE ?? `http://localhost:${PORT}/`}?lang=${lang}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__bus && !document.querySelector('.loader'), { timeout: 60000 })
  const loadMs = Date.now() - t0
  // 开始记帧间隔
  await B(() => { window.__gaps = []; window.__marks = []; window.__long = []; let last = performance.now(); const f = (n) => { const d = n - last; window.__gaps.push(d); if (d > 60) window.__long.push([Math.round(n), Math.round(d)]); last = n; requestAnimationFrame(f) }; requestAnimationFrame(f) })
  const mark = (name) => page.evaluate((name) => window.__marks.push([Math.round(performance.now()), name]), name)
  await sleep(800); await shot('01_cover')
  await mark('翻书'); await (await page.$('.bookhint')).click()
  await page.waitForFunction(() => window.__bus.intro.on, { timeout: 30000 })
  await page.waitForFunction(() => (document.querySelector('.slow-hint')?.textContent ?? '').length > 0, { timeout: 40000 })
  await sleep(600); await shot('02_intro_ready')
  const hold = async () => {
    const s = await B(() => window.__bus.slow)
    await page.mouse.move(s.x, s.y, { steps: 10 }); await sleep(250); await page.mouse.down()
    for (let i = 0; i < 400; i++) { if (await B(() => window.__bus.awake)) break; await sleep(80) }
    await page.mouse.up()
  }
  await mark('按住乌龟（开场）'); await hold(); await sleep(2200); await shot('03_intro_done'); await mark('回到全景')
  await (await page.$('.next')).click(); await sleep(3200); await shot('04_table')
  for (const id of IDS) {
    const p = await page.evaluate((id) => { const a = window.__bus.pos[id]; return window.__proj(a.x, 0.4, a.z) }, id)
    await page.mouse.move(p[0], p[1], { steps: 12 }); await sleep(450)
    if (id === 'lines') await shot('05_hover')
    await mark('进 ' + id); await page.mouse.down(); await page.mouse.up()
    try { await page.waitForFunction(() => window.__bus.micro.k > 0.97, { timeout: 15000 }) } catch { problems.push('进不去 ' + id) }
    await sleep(id === 'tree' ? 9000 : 5200)
    await shot('10_' + id)
    if (id !== 'folder') {
      await mark('出 ' + id); const ex = await page.$('.exit'); if (ex) await ex.click(); else problems.push('没有返回按钮 ' + id)
      try { await page.waitForFunction(() => window.__bus.micro.k < 0.03, { timeout: 15000 }) } catch { problems.push('回不来 ' + id) }
      await sleep(900)
    }
  }
  // 琳达：完整做完
  for (let i = 0; i < 200; i++) { const cap = await B(() => document.querySelector('.caption')?.textContent ?? ''); if (/拖|Drag/.test(cap)) break; await sleep(100) }
  await sleep(600)
  const m = await B(() => ({ ox: window.__bus.micro.ox, oz: window.__bus.micro.oz }))
  const W = (x, y, z) => page.evaluate((a) => window.__proj(...a), [m.ox + x * 0.85 * 0.55, 0.222 + y * 0.85 * 0.55, m.oz + z * 0.85 * 0.55])
  const from = await W(0.05, 0.6, 1.35); const to = await W(0.85, 0.6, 0.25)
  await page.mouse.move(from[0], from[1], { steps: 8 }); await sleep(200); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 16 }); await sleep(300); await page.mouse.up(); await sleep(1500)
  if ((await B(() => document.querySelector('main').className)).includes('is-picked')) { await hold(); await sleep(2800) } else problems.push('琳达没拖进圈（可能是触屏下拖动方式不同）')
  await shot('20_folder_done')
  const nx = await page.$('.next'); if (nx) { await nx.click(); await sleep(2600) } else problems.push('琳达没有走到结论')
  await shot('21_table_after')
  const res = await page.$('.hintpill .btn'); if (res) { await res.click(); await sleep(1300); await shot('22_end') } else problems.push('没有“看结果”按钮')
  const g = await B(() => { const a = window.__gaps.slice().sort((x, y) => y - x); return { worst: a.slice(0, 6).map((x) => Math.round(x)), over50: a.filter((x) => x > 50).length, n: a.length, avg: a.reduce((s, x) => s + x, 0) / a.length } })
  console.log(`[${tag} ${lang}] 从打开到可操作 ${loadMs} ms；平均帧间隔 ${g.avg.toFixed(1)} ms；最长的几帧 ${g.worst.join(', ')} ms；超过 50ms 的帧 ${g.over50} / ${g.n}`)
  const lg = await B(() => window.__long.map(([t, d]) => { const m = window.__marks.filter((x) => x[0] <= t).pop(); return `${d}ms @ ${m ? m[1] + ' +' + (t - m[0]) + 'ms' : '开头'}` }))
  console.log(`[${tag} ${lang}] 长帧：` + (lg.join('；') || '无'))
  console.log(`[${tag} ${lang}] 问题 ${problems.length} 个` + (problems.length ? '：\n  ' + [...new Set(problems)].join('\n  ') : ''))
  await page.close()
}
await browser.close()
