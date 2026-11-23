// 声音都是现场合成的，整体要轻：点一下是很轻的“笃”，背景是很稀的几个音，
// 按住慢的时候是很低的一层嗡声，同时背景被压下去；想完是一声软的铃。
let ctx: AudioContext | null = null
let on = true
let hum: { o: OscillatorNode[]; g: GainNode } | null = null
let amb: { g: GainNode; f: BiquadFilterNode; timer: number } | null = null
let noiseBuf: AudioBuffer | null = null
const ac = () => (ctx ??= new AudioContext())
const noise = () => {
  const a = ac()
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  const s = a.createBufferSource()
  s.buffer = noiseBuf
  s.loop = true
  return s
}

export const sfx = {
  get on() {
    return on
  },
  toggle() {
    on = !on
    if (!on) {
      sfx.hum(0)
      if (amb) amb.g.gain.setTargetAtTime(0, ac().currentTime, 0.1)
    } else if (amb) amb.g.gain.setTargetAtTime(0.022, ac().currentTime, 0.4)
    return on
  },
  // 点一下：木头上很轻的一声
  pop() {
    if (!on) return
    const a = ac()
    const t = a.currentTime
    const n = noise()
    const f = a.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 1500 + Math.random() * 500
    f.Q.value = 5
    const g = a.createGain()
    g.gain.setValueAtTime(0.07, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
    n.connect(f).connect(g).connect(a.destination)
    n.start(t)
    n.stop(t + 0.08)
    const o = a.createOscillator()
    const g2 = a.createGain()
    o.frequency.setValueAtTime(260, t)
    o.frequency.exponentialRampToValueAtTime(170, t + 0.07)
    g2.gain.setValueAtTime(0.04, t)
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
    o.connect(g2).connect(a.destination)
    o.start(t)
    o.stop(t + 0.1)
  },
  // 翻过一页纸。合成的纸声不像真的，先不出声；等换成真实录音再接上。
  page() {},
  // 按住慢：很低的一层嗡声，环境声同时被压下去
  hum(p: number) {
    const a = ac()
    if (amb) {
      amb.f.frequency.setTargetAtTime(5000 - 4400 * Math.min(1, p * 1.5), a.currentTime, 0.1)
      amb.g.gain.setTargetAtTime(on ? 0.022 * (1 - 0.7 * p) : 0, a.currentTime, 0.1)
    }
    if (!on || p <= 0) {
      if (hum) {
        hum.g.gain.setTargetAtTime(0, a.currentTime, 0.1)
        hum.o.forEach((o) => o.stop(a.currentTime + 0.5))
        hum = null
      }
      return
    }
    if (!hum) {
      const g = a.createGain()
      g.gain.value = 0
      const lp = a.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 420
      const o = [55, 82.6, 110.4].map((f) => {
        const x = a.createOscillator()
        x.type = 'sine'
        x.frequency.value = f
        x.connect(lp)
        x.start()
        return x
      })
      lp.connect(g).connect(a.destination)
      hum = { o, g }
    }
    hum.g.gain.setTargetAtTime(0.05 * Math.min(1, p * 3), a.currentTime, 0.08)
  },
  // 想完了：一声软的铃
  ding() {
    if (!on) return
    const a = ac()
    ;[523.3, 784, 1046.5].forEach((f, i) => {
      const o = a.createOscillator()
      const g = a.createGain()
      const t = a.currentTime + i * 0.07
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.07 / (i + 1), t + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0005, t + 1.6)
      o.connect(g).connect(a.destination)
      o.start(t)
      o.stop(t + 1.7)
    })
  },
  // 书翻开之后的背景：很轻、很稀的几个音，像远处的八音盒。不用持续的噪声，免得吵。
  ambient() {
    if (amb) return
    const a = ac()
    const f = a.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 5000
    const g = a.createGain()
    g.gain.value = on ? 0.022 : 0
    // 一点回声，让稀疏的音有空间感
    const delay = a.createDelay(1)
    delay.delayTime.value = 0.42
    const fb = a.createGain()
    fb.gain.value = 0.32
    f.connect(g).connect(a.destination)
    f.connect(delay)
    delay.connect(fb).connect(delay)
    fb.connect(g)
    const scale = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3] // 五声音阶，两个八度
    let last = 2
    const note = () => {
      if (on && amb && !document.hidden) {
        last = Math.max(0, Math.min(scale.length - 1, last + Math.round((Math.random() - 0.5) * 4)))
        const t = a.currentTime
        const o = a.createOscillator()
        const ng = a.createGain()
        o.type = 'sine'
        o.frequency.value = scale[last]
        ng.gain.setValueAtTime(0.0001, t)
        ng.gain.exponentialRampToValueAtTime(0.9, t + 0.02)
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.2)
        o.connect(ng).connect(f)
        o.start(t)
        o.stop(t + 2.3)
      }
      if (amb) amb.timer = window.setTimeout(note, 1400 + Math.random() * 2600)
    }
    amb = { g, f, timer: window.setTimeout(note, 1500) }
  },
}
