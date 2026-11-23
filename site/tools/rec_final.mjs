// 最终录像的动作：封面 → 翻开 → 认识慢 → 在海图上逛 → 进琳达的岛 → 作答 → 按住乌龟 → 回到书上。
// 用法：node tools/record.mjs preview/成片.mp4 "?lang=zh" tools/rec_final.mjs
export default async ({ page, sleep, proj, bus, hold, move, click, drag }) => {
  const W = 1440
  const H = 900
  await sleep(2600) // 等待页淡出，看一会儿封面
  await move(W * 0.52, H * 0.5, 600)
  // 往下滚，翻开书
  for (let i = 0; i < 16; i++) {
    await page.mouse.wheel({ deltaY: 62 })
    await sleep(170)
  }
  await page.mouse.wheel({ deltaY: 500 })
  // 开场介绍：兔子抢答、乌龟出场。等到乌龟旁边冒出“按住我”再按
  for (let i = 0; i < 300; i++) {
    if (await page.evaluate(() => (document.querySelector('.slow-hint')?.textContent ?? '').length > 0)) break
    await sleep(100)
  }
  await sleep(1400)
  await hold(4000)
  await sleep(2600)
  const next = await page.$('.next')
  const nb = await next.boundingBox()
  await click(nb.x + nb.width / 2, nb.y + nb.height / 2, 700)
  await sleep(1200)
  // 兔子在海图上逛一圈：过海、上岛
  let b = await bus()
  const at = async (id, dy = 0.5) => proj(b.pos[id].x, dy, b.pos[id].z)
  let p = await proj(0.2, 0, 1.2)
  await move(p[0], p[1], 900)
  await sleep(500)
  p = await at('pawn')
  await move(p[0], p[1], 1100)
  await sleep(900)
  p = await at('helmet')
  await move(p[0], p[1], 1300)
  await sleep(900)
  // 进琳达的岛
  b = await bus()
  p = await at('folder')
  await click(p[0], p[1], 1000)
  for (let i = 0; i < 200; i++) {
    const cap = await page.evaluate(() => document.querySelector('.caption')?.textContent ?? '')
    if (/拖|Drag/.test(cap)) break
    await sleep(100)
  }
  await sleep(900)
  b = await bus()
  const G = 0.85
  const L = (x, y, z) => proj(b.micro.ox + x * G * 0.55, 0.222 + y * G * 0.55, b.micro.oz + z * G * 0.55)
  const from = await L(0.05, 0.6, 1.35)
  const to = await L(0.85, 0.6, 0.25)
  await drag(from[0], from[1], to[0], to[1], 1100)
  await sleep(1700)
  await hold(9000)
  await sleep(4200)
  const back = await page.$('.next')
  const bb = await back.boundingBox()
  await click(bb.x + bb.width / 2, bb.y + bb.height / 2, 700)
  await sleep(2400)
  p = await proj(1.2, 0, 0.6)
  await move(p[0], p[1], 900)
  await sleep(1600)
}
