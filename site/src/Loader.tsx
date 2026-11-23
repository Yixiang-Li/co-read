import { useEffect } from 'react'
import { bus } from './bus'

// 开场的等待页。它写在 index.html 里（脚本还在下载时就看得到，进度条先走到六成），脚本到了由这里接管：
// 场景里的形状是打开页面时现算的（约一秒），书的封面也要现画。等头十几帧预热完（见 bus.warm）、书摆上桌，进度走满，整页淡出。
type W = { __frames?: number; __bootP?: number; __bootTaken?: boolean }
export default function Loader() {
  useEffect(() => {
    const el = document.getElementById('boot')
    if (!el) return
    const w = window as unknown as W
    w.__bootTaken = true
    const from = Math.max(0.6, w.__bootP ?? 0)
    const t0 = performance.now()
    let raf = 0
    let out = 0
    const tick = () => {
      const s = (performance.now() - t0) / 1000
      const frames = w.__frames ?? 0
      const ready = frames > 14 && bus.bookReady
      if (ready || s > 15) {
        el.style.setProperty('--p', '1')
        el.classList.remove('waiting')
        out = window.setTimeout(() => {
          el.classList.add('done')
          out = window.setTimeout(() => el.remove(), 1100)
        }, 350)
        return
      }
      // 还没好：朝九成五慢慢走，不停在一个地方
      el.style.setProperty('--p', String(from + (0.95 - from) * (1 - Math.exp(-s / 1.6))))
      if (s > 4) el.classList.add('waiting')
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(out)
    }
  }, [])
  return null
}
