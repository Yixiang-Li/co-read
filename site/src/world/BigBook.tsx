import Book, { BOOK_TOP } from './Book'
import { PW, TW } from './kit'

// 书放大到和世界一样大：摊开的对开页就是整片地（宽 TW），页面顶面落在 y = 0 稍下一点。
export const BOOK_SCALE = TW / (2 * PW)
export default function BigBook({ onOpen }: { onOpen: () => void }) {
  return (
    <group scale={BOOK_SCALE} position={[0, -BOOK_TOP * BOOK_SCALE - 0.012, 0]}>
      <Book onOpen={onOpen} />
    </group>
  )
}
