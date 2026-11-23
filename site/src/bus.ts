import * as THREE from 'three'

// 两块画布和页面之间共用的状态，每帧都在变，所以不放进 React。
export const bus = {
  t: 0, // 冷世界的程度 0–1
  p: 0, // 按住慢的进度 0–1
  awake: false,
  fx: 0,
  fz: 3,
  fv: 0, // 快的速度
  sx: 0, // 快在屏幕上的位置
  sy: 0,
  mood: 'ok' as 'ok' | 'sulk' | 'proud',
  active: null as string | null,
  hover: null as string | null,
  open: 0, // 书翻开的程度 0–1
  openT: 0,
  pos: {} as Record<string, { x: number; z: number; h: number; r: number }>,
  sel: { on: false, x: 0, y: 0, w: 0, h: 0 },
  slow: { x: 0, y: 0 },
  slowPos: { x: 4.9, z: 2.2 },
  bookReady: false, // 书的封面和书页贴图画好、书已经摆上桌：等待页等到这一刻才揭开，免得先露出一张空桌子
  warm: true, // 预热：刚打开的头几帧（等待页还盖着），把此刻本该藏着的海、小岛、布景也画出来，让贴图和网格先传给显卡；不然翻书翻到一半它们第一次出现时会顿一下
  quality: 1 as 0 | 1, // 画质档位：1 正常，0 省电（帧率掉下来时自动切到 0，重的效果要看这个值关掉）
  micro: { id: null as string | null, pending: null as string | null, last: null as string | null, k: 0, ox: 0, oz: 0 }, // 正在打开的微观世界：k 是镜头俯冲的程度 0–1。pending 是刚点开、还在搭布景的那个；搭好了才写进 id，镜头才开始动
  wob: {} as Record<string, { x: number; z: number; vx: number; vz: number }>,
  // 开场介绍：on 时镜头给特写、兔子不跟鼠标而是站到乌龟的岛边；shot 是第几个镜头（1 合影、2 兔子、3 乌龟）；perk 是兔子抢答时蹦一下的劲
  intro: { on: false, shot: 1 as 1 | 2 | 3, k: 0, perk: 0 },
  cam: { pos: new THREE.Vector3(0, 11.9, 10.7), look: new THREE.Vector3(0, 0, 0.35) },
}
export const CAM = { fov: 32, pos: [0, 11.9, 10.7] as [number, number, number] }
export const R_FAST = 0.26
