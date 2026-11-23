import { useCallback, useEffect, useRef } from 'react'

// “按住才是慢”：按住时进度慢慢涨，松手就退回去，涨满才算数。
export function useHold(opts: {
  duration: number
  enabled: boolean
  onProgress: (p: number) => void
  onComplete: () => void
}) {
  const o = useRef(opts)
  o.current = opts
  const s = useRef({ p: 0, holding: false, done: false, raf: 0, last: 0 })

  const tick = useCallback((now: number) => {
    const st = s.current
    const dt = Math.min(250, now - st.last)
    st.last = now
    if (st.holding) st.p += dt / o.current.duration
    else st.p -= dt / (o.current.duration * 0.3)
    st.p = Math.max(0, Math.min(1, st.p))
    o.current.onProgress(st.p)
    if (st.p >= 1 && !st.done) {
      st.done = true
      st.holding = false
      st.raf = 0
      o.current.onComplete()
      return
    }
    if (st.p <= 0 && !st.holding) {
      st.raf = 0
      return
    }
    st.raf = requestAnimationFrame(tick)
  }, [])

  const start = useCallback(() => {
    const st = s.current
    if (!o.current.enabled || st.done) return
    st.holding = true
    if (!st.raf) {
      st.last = performance.now()
      st.raf = requestAnimationFrame(tick)
    }
  }, [tick])

  const stop = useCallback(() => {
    s.current.holding = false
  }, [])

  const reset = useCallback(() => {
    const st = s.current
    cancelAnimationFrame(st.raf)
    s.current = { p: 0, holding: false, done: false, raf: 0, last: 0 }
    o.current.onProgress(0)
  }, [])

  useEffect(() => () => cancelAnimationFrame(s.current.raf), [])

  return {
    reset,
    start,
    stop,
    bind: {
      onPointerDown: (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest('[data-nohold]')) return
        start()
      },
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
      onKeyDown: (e: React.KeyboardEvent) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && e.target === e.currentTarget) {
          e.preventDefault()
          start()
        }
      },
      onKeyUp: (e: React.KeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') stop()
      },
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  }
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
