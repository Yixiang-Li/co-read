import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { MicroDef, MicroProps } from './types'

// 九个微观世界。每个文件单独懒加载，一个写坏了不会连累别的。
export const PRELOAD: (() => Promise<unknown>)[] = []
const def = (file: () => Promise<{ default: ComponentType<MicroProps> }>, cam: MicroDef['cam'], bespoke = true) => (PRELOAD.push(file), { C: lazy(file), cam, bespoke })
// 默认镜头：{ pos: [0, 3.3, 4.4], look: [0, 0.55, 0] }

export const MICRO: Record<string, MicroDef & { C: LazyExoticComponent<ComponentType<MicroProps>> }> = {
  lines: def(() => import('./lines'), { pos: [0, 3.5, 5.7], look: [0, 0.8, 0] }, true),
  vinyl: def(() => import('./vinyl'), { pos: [-0.25, 4.1, 5.1], look: [-0.25, 0.15, 0.25] }, true),
  tree: def(() => import('./tree'), { pos: [-0.3, 5.1, 9.9], look: [-0.3, 2.08, -0.3] }, true),
  helmet: def(() => import('./helmet'), { pos: [-0.55, 3.8, 5.6], look: [-0.55, 0.55, -0.1] }, true),
  paddle: def(() => import('./paddle'), { pos: [-0.45, 4.7, 4.3], look: [-0.45, 0.42, -0.1] }, true),
  pawn: def(() => import('./pawn'), { pos: [-0.9, 3.7, 7.0], look: [-0.9, 1.0, 0] }, true),
  rose: def(() => import('./rose'), { pos: [0, 4.4, 5.5], look: [0, 0.3, 0.2] }, true),
  coin: def(() => import('./coin'), { pos: [0.2, 4.7, 6.5], look: [0.2, 0.95, -0.1] }, true),
  folder: def(() => import('./folder'), { pos: [0.1, 4.25, 4.4], look: [0.1, 0.2, 0.0] }, true),
}
