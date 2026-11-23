import type { Scene } from '../scenes'

// 每个微观世界拿到的东西。它自己负责把题目“演”出来，不要用成段的文字。
export type MicroProps = {
  c: Scene // 这个案例的文字素材（题目、选项、慢的推算、结论）
  phase: 'ask' | 'picked' | 'done' // ask：等访客凭直觉选；picked：已选，等访客按住慢；done：慢想完了
  pick: number | null // 访客选的是 c.opts 里的第几个
  choose: (k: number) => void // 访客在场景里做出选择时调用（只在 ask 阶段有效）
  say: (line: string) => void // 屏幕下方的一行字幕，尽量短；传空字符串清掉
  read?: (r: Read | null) => void // 场景里要读的字（词卡、牌子）：手机竖屏上太小读不清，另在画面上方排一张纸卡；只在手机竖屏显示
}
export type Read = { cols?: { h: string; items: string[] }[]; lines?: { t: string; red?: boolean }[] }
// 每帧都在变的量不走 props，直接读 bus：
//   bus.micro.k  镜头俯冲的程度 0–1（1 = 完全进入微观世界）
//   bus.p        访客按住慢的进度 0–1（松手会退回 0，按满变成 done）
//   bus.t        世界“变慢、褪色”的程度 0–1；所有自己写的动画都应该乘上 (1 - 0.93 * bus.t)
//   bus.awake    慢想完之后为 true

export type MicroDef = {
  // 镜头相对舞台中心的位置和看向的点。舞台中心在这个组的原点，地面是 y = 0。
  cam: { pos: [number, number, number]; look: [number, number, number] }
  bespoke: boolean // false 表示还在用通用的占位版本（会显示题卡和选项条）
}
