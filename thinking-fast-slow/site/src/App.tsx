import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import { bus } from './bus'
import FastLayer, { type FastApi } from './FastLayer'
import Loader from './Loader'
import type { Read } from './micro/types'
import World from './World'
import { L, setLang, TOUCH, useLang } from './i18n'
import { MICRO, PRELOAD } from './micro/registry'
import { CASES, INTRO, loc } from './scenes'
import { sfx } from './sound'
import { clauses, tidy } from './typo'
import { easeInOut, useHold } from './useHold'

type Stage = 'book' | 'intro' | 'table' | 'case' | 'end'
type Phase = 'ask' | 'picked' | 'done'
const SCORED = CASES.filter((c) => c.right >= 0).length
const qs = new URLSearchParams(location.search)
const auto = qs.get('micro') // 调试用：?micro=coin 直接进入某个微观世界
const panelDbg = qs.get('panel') // 调试用：?panel=coin 直接显示某个案例写完后的结论卡（?panel=intro 是开场那张），用来检查排版
const skip = qs.has('table') || !!auto || !!panelDbg
if (skip) bus.open = bus.openT = 1
const fixedOpen = qs.get('open') // 调试用：?open=0.4 把书停在翻开 40% 的位置
if (fixedOpen) bus.open = bus.openT = Number(fixedOpen)

export default function App() {
  const fast = useRef<FastApi>(null)
  const card = useRef<HTMLElement>(null)
  const selbox = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Stage>(panelDbg === 'intro' ? 'intro' : panelDbg ? 'case' : skip ? 'table' : 'book')
  const [active, setActive] = useState<string | null>(panelDbg && panelDbg !== 'intro' ? panelDbg : null)
  const [hover, setHover] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>(panelDbg ? 'done' : 'picked')
  const [pick, setPick] = useState<number | null>(null)
  const [p, setP] = useState(0)
  const [solved, setSolved] = useState<string[]>([])
  const [score, setScore] = useState(0)
  const [nudge, setNudge] = useState(false)
  const [sound, setSound] = useState(true)
  const [caption, setCaption] = useState('')
  const [read, setRead] = useState<Read | null>(null)
  // 开场介绍走到第几步：1 合影，2 兔子抢答，3 乌龟出场、兔子答不上，4 可以按住乌龟了
  const [istep, setIstep] = useState(0)
  const [prompt, setPrompt] = useState('')
  const lang = useLang()
  const cases = useMemo(() => CASES.map((c) => loc(c, lang)), [lang])
  const sc = stage === 'case' ? cases.find((c) => c.id === active)! : loc(INTRO, lang)
  const T = (s: string) => tidy(s, lang) // 断行处理：小词不留行尾，末行不落单（见 typo.ts）
  // 标题、结论、字幕：每个分句是一个尽量不拆的块，换行只发生在分句之间
  const K = (s: string) =>
    clauses(s, lang).map((c, i) => (
      <span className="keep" key={i}>
        {c}
        {lang === 'en' ? ' ' : ''}
      </span>
    ))
  const slow = useMemo(() => sc.slow.map((l) => tidy(l, lang)), [sc, lang])
  const total = slow.join('').length
  const canHold = ((stage === 'intro' && istep === 4) || stage === 'case') && phase === 'picked'

  const setT = (v: number) => {
    bus.t = v
    document.documentElement.style.setProperty('--t', v.toFixed(3))
  }

  const hold = useHold({
    duration: 1300 + total * 42,
    enabled: canHold,
    onProgress: (v) => {
      bus.p = v
      setP(v)
      setT(v)
      sfx.hum(v)
    },
    onComplete: () => {
      setPhase('done')
      bus.awake = true
      sfx.hum(0)
      sfx.ding()
      const tw = { v: 1 }
      gsap.to(tw, { v: 0, duration: 1.4, ease: 'power2.inOut', onUpdate: () => setT(tw.v) })
      const right = sc.right === pick
      if (right) setScore((s) => s + 1)
      window.setTimeout(() => {
        if (stage === 'intro') fast.current?.say(L('……我本来也知道', '…I knew that'), 2400)
        else if (sc.right < 0) fast.current?.say(L('……行吧', '…fine'), 1700)
        else if (right) {
          fast.current?.mood('proud')
          fast.current?.say(sc.id === 'helmet' ? L('我就说吧！', 'Told you!') : L('答对了！', 'Got it!'))
        } else {
          fast.current?.mood('sulk')
          fast.current?.say(L('……哦', '…oh'), 1700)
        }
      }, 900)
    },
  })

  // 翻书：滚轮、拖动或点一下
  useEffect(() => {
    if (stage !== 'book') return
    const wheel = (e: WheelEvent) => (bus.openT = Math.min(1, Math.max(0, bus.openT + e.deltaY * 0.0011)))
    let y0: number | null = null
    const down = (e: PointerEvent) => (y0 = e.clientY)
    const move = (e: PointerEvent) => {
      if (y0 === null || e.pointerType === 'mouse') return
      bus.openT = Math.min(1, Math.max(0, bus.openT + (y0 - e.clientY) * 0.003))
      y0 = e.clientY
    }
    const up = () => (y0 = null)
    window.addEventListener('wheel', wheel, { passive: true })
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [stage])
  const openBook = () => stage === 'book' && gsap.to(bus, { openT: 1, duration: 2.6, ease: 'power1.inOut' })

  // 每帧：选框和工具条跟着被选中的东西走
  useEffect(() => {
    let raf = 0
    let last = ''
    let page = 0
    const tick = () => {
      // 翻书的时候，每翻过一页响一声纸
      const pg = Math.floor(Math.max(0, bus.open - 0.04) / 0.11)
      if (pg !== page && bus.open < 0.7) sfx.page()
      page = pg
      if (bus.open > 0.995) setStage((s) => (s === 'book' ? 'intro' : s))
      const s = bus.sel
      if (selbox.current) {
        selbox.current.style.opacity = s.on ? '1' : '0'
        if (s.on) selbox.current.style.transform = `translate(${s.x}px,${s.y - s.h / 2}px)`
        // 选中的东西在画面边上时，上面的名签往里挪，别被屏幕边切掉
        const lab = selbox.current.querySelector<HTMLElement>('.sellabel')
        if (s.on && lab) {
          const w = lab.offsetWidth
          const dx = Math.max(8 - (s.x - w / 2), 0) + Math.min(innerWidth - 8 - (s.x + w / 2), 0)
          lab.style.marginLeft = `${dx.toFixed(1)}px`
        }
      }
      const h = bus.active ?? bus.hover ?? ''
      if (h !== last) setHover((last = h) || null)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // 开场介绍的时间线：书里第一章自己的两个演示。兔子抢答（快是自动的），乌龟算 17 × 24（慢要费力）
  useEffect(() => {
    document.documentElement.classList.toggle('introing', stage === 'intro')
    if (stage !== 'intro') {
      bus.intro.on = false
      setIstep(0)
      setPrompt('')
      return
    }
    bus.intro.on = true
    bus.intro.shot = 1
    setIstep(1)
    const T: number[] = []
    const at = (ms: number, f: () => void) => T.push(window.setTimeout(f, ms))
    const blurt = (s: string, ms: number) => {
      fast.current?.say(s, ms)
      bus.intro.perk = 1
    }
    at(3000, () => ((bus.intro.shot = 2), setIstep(2)))
    at(4300, () => setPrompt(L('床前明月光，', 'Bread and…')))
    at(4800, () => blurt(L('疑是地上霜！', 'butter!'), 1900))
    at(7300, () => setPrompt('2 + 2 ='))
    at(7650, () => blurt(L('4！', '4!'), 1600))
    at(10200, () => setPrompt(''))
    at(11000, () => ((bus.intro.shot = 3), setIstep(3)))
    at(12300, () => setPrompt('17 × 24 ='))
    at(13700, () => fast.current?.say(L('呃……', 'Uh…'), 1500))
    at(15600, () => fast.current?.say(L('……三百多？', '…350-ish?'), 2000))
    at(16400, () => setIstep(4))
    return () => T.forEach((x) => window.clearTimeout(x))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  // 书翻开以后，趁空闲把九个微观世界的代码一个个先读好，点开时不用再等
  useEffect(() => {
    if (stage === 'book') return
    let i = 0
    let id = 0
    const next = () => {
      if (i >= PRELOAD.length) return
      PRELOAD[i++]().catch(() => {})
      id = window.setTimeout(next, 350)
    }
    id = window.setTimeout(next, 1500)
    return () => window.clearTimeout(id)
  }, [stage === 'book'])

  useEffect(() => {
    document.documentElement.classList.toggle('opened', stage !== 'book')
    if (stage !== 'book') sfx.ambient()
  }, [stage])

  useEffect(() => {
    const up = () => hold.stop()
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [hold])

  useLayoutEffect(() => {
    if (card.current) gsap.fromTo(card.current, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' })
  }, [stage, active])

  useEffect(() => {
    if (!nudge) return
    const t = window.setTimeout(() => setNudge(false), 1600)
    return () => window.clearTimeout(t)
  }, [nudge])

  const reset = () => {
    hold.reset()
    bus.awake = false
    setPick(null)
  }
  const open = (id: string) => {
    if (stage !== 'table') return
    reset()
    setActive(id)
    bus.active = id
    const c = CASES.find((x) => x.id === id)!
    // 先只登记“要去哪”：布景搭好、着色器编译完以后，World 里才把 id 写上，镜头才开始俯冲（见 MicroHost）
    Object.assign(bus.micro, { pending: id, last: id, ox: c.pos[0], oz: c.pos[1] })
    setCaption('')
    setRead(null)
    setPhase('ask')
    setStage('case')
  }
  const toTable = (done: boolean) => {
    if (done && active) setSolved((s) => (s.includes(active) ? s : [...s, active]))
    reset()
    setActive(null)
    bus.active = null
    bus.micro.id = null
    bus.micro.pending = null
    setCaption('')
    setRead(null)
    setStage('table')
  }
  const choose = (k: number) => {
    if (phase !== 'ask') return
    setPick(k)
    setPhase('picked')
    fast.current?.say(sc.fast[k])
  }
  useEffect(() => {
    if (auto && CASES.some((c) => c.id === auto)) window.setTimeout(() => open(auto), 600)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const again = () => {
    setSolved([])
    setScore(0)
    setPhase('picked')
    reset()
    setStage('intro')
  }

  let left = phase === 'done' ? total : Math.floor(Math.min(1, p * 1.04) * total)
  // 每一行写到第几个字。整句一开始就排好了位置（没写到的字先透明），所以写的过程中断行不会跳
  const typed = slow.map((l) => {
    const n = Math.min(l.length, Math.max(0, left))
    left -= l.length
    return n
  })
  const hint = stage === 'end' || stage === 'book' || phase === 'done' || p > 0.04 ? '' : nudge ? (stage === 'table' ? L('先点一样东西', 'Pick something first') : L('你先猜一个', 'Take a guess first')) : canHold ? L('按住我，别松手', 'Press and hold me') : ''
  const allDone = solved.length === CASES.length
  const hov = cases.find((c) => c.id === hover)
  const bespoke = stage === 'case' && !!active && MICRO[active].bespoke
  const caseNo = CASES.findIndex((c) => c.id === active) + 1
  const remain = CASES.length - new Set(active ? [...solved, active] : solved).size

  return (
    <main className={`stage st-${stage} is-${phase} ${(stage === 'intro' || stage === 'case') && (p > 0.03 || phase === 'done') ? 'panel-on' : ''}`}>
      <World cases={cases} solved={solved} canPick={stage === 'table'} onPick={open} slowHint={hint} onSlowDown={() => (canHold ? hold.start() : stage !== 'book' && setNudge(true))} onSlowUp={() => hold.stop()} onBook={openBook} micro={stage === 'case' ? active : null} mp={{ phase, pick, choose, say: setCaption, read: setRead }} />
      <div className="cold" aria-hidden="true" />
      <header className="top">
        <div className="head">
          <span className="brand">Co-read</span>
          <i className="rule" />
          <span className="book">{L('思考，快与慢', 'Thinking, Fast and Slow')}</span>
        </div>
        <div className="tools">
          {stage !== 'book' && (
            <div className="dots" role="img" aria-label={L(`看过 ${solved.length} 个，共 ${CASES.length} 个`, `${solved.length} of ${CASES.length} seen`)}>
              {CASES.map((c) => (
                <i key={c.id} className={solved.includes(c.id) ? 'on' : ''} />
              ))}
            </div>
          )}
          <button className="langsw" data-hot onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} aria-label={L('切换到英文', 'Switch to Chinese')}>
            <span className={lang === 'zh' ? 'on' : ''}>中</span>
            <span className={lang === 'en' ? 'on' : ''}>EN</span>
          </button>
          <button className={`snd ${sound ? 'on' : ''}`} data-hot onClick={() => setSound(sfx.toggle())} aria-label={sound ? L('关掉声音', 'Mute') : L('打开声音', 'Unmute')} aria-pressed={sound}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path className="spk" d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z" />
              <path className="w1" d="M15.2 9.3a3.8 3.8 0 0 1 0 5.4" />
              <path className="w2" d="M17.8 6.9a7.2 7.2 0 0 1 0 10.2" />
              <path className="x" d="M15.5 9.5l5 5m0-5l-5 5" />
            </svg>
          </button>
        </div>
      </header>

      {stage === 'book' && (
        <button className="bookhint" onClick={openBook}>
          <i />
          {TOUCH ? L('向上滑，或点一下这本书', 'Swipe up, or tap the book') : L('向下滚动，翻开这本书', 'Scroll down to open the book')}
        </button>
      )}

      <div ref={selbox} className="selbox" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        {stage === 'table' && hov && <span className="sellabel">{solved.includes(hov.id) ? hov.concept : hov.teaser}</span>}
      </div>

      {stage === 'case' && !bespoke && phase !== 'done' && (
        <div ref={toolbar} className="toolbar fixedbar card" data-hot>
          {sc.opts.map((o, k) => (
            <button key={o} className={pick === k ? 'picked' : ''} disabled={phase !== 'ask'} onClick={() => choose(k)}>
              {o}
            </button>
          ))}
        </div>
      )}
      {stage === 'case' && phase !== 'done' && (
        <button className="exit" data-hot onClick={() => toTable(false)}>
          {L('回到书上', 'Back to the book')}
        </button>
      )}
      {stage === 'case' && caption && <p className="caption" key={caption}>{K(caption)}</p>}
      {stage === 'case' && read && phase !== 'done' && (
        <div className="readcard" aria-hidden="true">
          {read.cols && (
            <div className="rc-cols">
              {read.cols.map((c) => (
                <div key={c.h}>
                  <b>{c.h}</b>
                  {c.items.map((w, i) => (
                    <span key={i}>{w}</span>
                  ))}
                </div>
              ))}
            </div>
          )}
          {read.lines?.map((l, i) => (
            <p key={i} className={l.red ? 'red' : ''}>
              {T(l.t)}
            </p>
          ))}
        </div>
      )}

      {stage === 'table' && (
        <div className="hintpill card">
          <span>
            {T(allDone ? L('九样东西都看过了。', 'You have seen all nine.') : solved.length ? L('再点一样。', 'Pick another.') : L('书里的九个案例都在这两页上。点一样看看。', 'Nine cases from the book live on these pages. Pick one.'))}
            {!solved.length && <em className="turn">{L('把手机横过来，看得更清楚。', 'Turn your phone sideways for a bigger view.')}</em>}
          </span>
          {solved.length > 0 && (
            <button className="btn" data-hot onClick={() => setStage('end')}>
              {L('看结果', 'See results')}
            </button>
          )}
        </div>
      )}

      {stage === 'intro' && (
        <>
          <section className={`introline ${p > 0.03 || phase === 'done' ? 'off' : ''}`} key={Math.min(istep, 3)}>
            <h1>{K([sc.q, sc.q, L('这是快，系统 1。', 'This is Fast, System 1.'), L('这道题，快答不了。', 'Fast cannot answer this one.'), L('这道题，快答不了。', 'Fast cannot answer this one.')][istep])}</h1>
            <p>
              {T(
                [
                  '',
                  L('一只兔子，一只乌龟。', 'A hare and a tortoise.'),
                  L('问题还没问完，它已经答了。自动、不费力，你也拦不住。', 'It answers before the question ends. Automatic, effortless, impossible to stop.'),
                  L('17 × 24，它只会猜。', 'For 17 × 24 it can only guess.'),
                  L('按住乌龟别松手，让慢来算。', 'Press and hold the tortoise. Let Slow work it out.'),
                ][istep],
              )}
            </p>
          </section>
          {prompt && phase !== 'done' && (
            <div className={`prompt card ${istep >= 3 ? 'right' : ''}`} key={prompt}>
              <span>{prompt}</span>
              <i />
            </div>
          )}
          {phase !== 'done' && (
            <button className="skip" data-hot onClick={() => toTable(false)}>
              {L('跳过介绍', 'Skip intro')}
            </button>
          )}
        </>
      )}

      {stage === 'case' && !bespoke && (
        <section ref={card} className={`qcard card size-${sc.size}`} key={stage + (active ?? '')}>
          <h1 className="q">
            {sc.q.split('\n').map((l) => (
              <span className="ln" key={l}>
                {l}
              </span>
            ))}
          </h1>
          {sc.id === 'lines' && (
            <svg className="mlines" viewBox="90 10 420 200" aria-hidden="true">
              <g className="guides" style={{ ['--draw' as string]: phase === 'done' ? 0 : 1 - easeInOut(p) }}>
                <path d="M150 14 V206" pathLength={1} />
                <path d="M450 14 V206" pathLength={1} />
              </g>
              <path className={pick === 0 ? 'on' : ''} d="M150 60 H450 M150 60 L122 32 M150 60 L122 88 M450 60 L478 32 M450 60 L478 88" />
              <path className={pick === 1 ? 'on' : ''} d="M150 160 H450 M150 160 L178 132 M150 160 L178 188 M450 160 L422 132 M450 160 L422 188" />
            </svg>
          )}
          <p className="cue">{phase === 'ask' ? L('在下面点一个，凭感觉', 'Pick one below. Go with your gut') : phase === 'picked' ? L('现在按住那只乌龟，让它慢慢想', 'Now press and hold the tortoise and let it think') : ''}</p>
        </section>
      )}

      {stage === 'end' && (
        <section ref={card} className="endcard card" key="end">
          <div className="end-main">
            <h1 className="end-h">
              {lang === 'zh' ? (
                <>
                  <span className="ln">{`${SCORED} 道有对错的题，`}</span>
                  <span className="ln">{`快答对了 ${score} 道。`}</span>
                </>
              ) : (
                <>
                  <span className="keep">{T(`Of ${SCORED} questions with a right answer,`)} </span>
                  <span className="keep">{T(`Fast got ${score} right.`)}</span>
                </>
              )}
            </h1>
            <p className="endnote">{T(L('快的答案就是直觉。它大多数时候是对的，否则你活不到现在。它什么时候可以信？这件事本身有规律，你在这件事上花的时间够久，而且每次都能很快有反馈。少了任何一个，无论你多有把握，都把慢叫起来。', 'What Fast gives you is intuition. It is right most of the time, or you would not be alive. When can you trust it? When the situation is regular, you have spent long enough at it, and feedback comes quickly every time. If either is missing, wake Slow up, however sure you feel.'))}</p>
            <div className="endbtns">
              <button className="btn" data-hot onClick={() => setStage('table')}>
                {L('回到书里', 'Back to the book')}
              </button>
              <button className="btn ghost" data-hot onClick={again}>
                {L('从头再来', 'Start over')}
              </button>
            </div>
          </div>
          {/* 书后的索引：九个概念，看过的写出名字，没看过的留着 */}
          <ol className="end-index">
            <li className="end-index-h">
              <span>{L('这本书里的九个概念', 'Nine ideas from the book')}</span>
              <em>
                {solved.length} / {CASES.length}
              </em>
            </li>
            {cases.map((c, i) => (
              <li key={c.id} className={solved.includes(c.id) ? 'on' : ''}>
                <span>{solved.includes(c.id) ? c.concept : c.teaser}</span>
                <i />
                <em>{String(i + 1).padStart(2, '0')}</em>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(stage === 'intro' || stage === 'case') && (
        <aside className={`panel ${p > 0.03 || phase === 'done' ? 'on' : ''}`} aria-live="polite">
          {/* 乌龟的笔记本：一页横线纸。顶边是按住的进度；它一行行写，写完概念名升到页眉 */}
          <i className="note-prog" style={{ transform: `scaleX(${phase === 'done' ? 1 : p})` }} />
          <header className="note-head">
            <span className={`note-title ${phase === 'done' ? 'named' : ''}`}>{phase === 'done' ? sc.concept : L('慢在想……', 'Slow is thinking…')}</span>
            {stage === 'case' && <span className="note-num">{`${String(caseNo).padStart(2, '0')} / ${String(CASES.length).padStart(2, '0')}`}</span>}
          </header>
          <div className="work">
            <div>
              {slow.map((l, k) => (
                <p key={k}>
                  {l.slice(0, typed[k])}
                  {typed[k] > 0 && phase !== 'done' && (typed[k + 1] ?? 0) === 0 && <i className="caret" />}
                  <span className="rest">{l.slice(typed[k])}</span>
                </p>
              ))}
            </div>
            {sc.venn && (
              <svg className="venn" viewBox="0 0 160 130" style={{ ['--draw' as string]: phase === 'done' ? 0 : 1 - easeInOut(p) }} aria-hidden="true">
                <circle cx="72" cy="66" r="58" pathLength={1} />
                <circle cx="96" cy="78" r="24" pathLength={1} />
                <text x="44" y="46">{L('出纳', 'tellers')}</text>
                <text x="96" y="82">{L('女权', 'feminist')}</text>
              </svg>
            )}
          </div>
          {phase === 'done' && (
            <div className="result">
              <p className="verdict">{K(sc.verdict)}</p>
              {sc.stat.split('\n').map((para, i) => (
                <p className="stat" key={i}>
                  {T(para)}
                </p>
              ))}
              <div className="note-foot">
                <button className="next" data-hot onClick={() => toTable(stage === 'case')}>
                  {stage === 'intro' ? L('去书里看看', 'Explore the book') : L('放它回去', 'Put it back')}
                </button>
                {stage === 'case' && <span>{remain > 0 ? L(`还有 ${remain} 个没看`, `${remain} more to see`) : L('九个都看过了', 'All nine seen')}</span>}
              </div>
            </div>
          )}
        </aside>
      )}
      <FastLayer ref={fast} />
      <Loader />
    </main>
  )
}
