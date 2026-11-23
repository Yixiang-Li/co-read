// 断行的讲究。浏览器只知道“排不下就换行”，所以会出现：一行末尾挂着 a / of，最后一行只剩一个词或一两个字，
// 中文把一个词拆到两行（“自/动”“它/们”）。这里在文字里预先插入“不许在这里断”的记号，
// 配合样式里的 text-wrap，让每一行断在顺眼的地方。
const NBSP = ' ' // 不换行的空格
const WJ = '⁠' // 零宽的连接符：两边的字不许分到两行

// —— 英文 ——
// 冠词和两三个字母的介词不留在行尾（和后一个词绑在一起）；数字和单位、“85% to 90%”不拆开；最后两个词绑在一起，末行不落单。
const SMALL = /(?<=^|[\s(“"])(a|an|the|of|to|in|on|at|by|or|as|is|it|if)\s+(?=\S)/gi
function en(s: string) {
  let t = s.replace(SMALL, (_, w: string) => `${w}${NBSP}`)
  t = t.replace(/(\d[\d.,]*%?)\s+(to|or|and)\s+(\d)/gi, `$1${NBSP}$2${NBSP}$3`)
  t = t.replace(/([$€£]?\d[\d.,]*)\s+(feet|people|times|percent|cents?|dollars?)\b/gi, `$1${NBSP}$2`)
  const i = t.trimEnd().lastIndexOf(' ')
  if (i > 0 && t.length - i < 14) t = t.slice(0, i) + NBSP + t.slice(i + 1)
  return t
}

// —— 中文 ——
// 用浏览器自带的分词：一个词里面不断行，只在词和词之间换；数字和后面的量词不拆开；
// 每句最后凑够四个字的那几个词连在一起，末行不会只剩一两个字。
const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('zh', { granularity: 'word' }) : null
const PUNC = /[，。、；：！？…—“”‘’（）《》.,;:!?]/
// 自带的分词偶尔会切错，这几个词明确不许拆
const KEEP = ['松手', '抢答', '不费力', '拦不住', '睡回去', '一步一步', '一长一短', '第一印象', '下意识', '大多数', '差不多', '一半以上', '花的时间']
// 数字连着它的量词；“85% 到 90%”整个连着
const SPANS = [/\d[\d.,]*\s?%?\s?(到|至)\s?\d[\d.,]*\s?%?/g, /\d[\d.,]*\s?(个|人|次|道|块|毛|分|英尺|岁|遍|把|年|倍)/g, /(系统|第)\s?\d+/g]
function zh(s: string) {
  return s
    .split(/(?<=[。！？\n])/)
    .map((sentence) => {
      const cs = [...sentence]
      const n = cs.length
      const nb = new Array<boolean>(n).fill(false) // nb[i]：第 i 个字和第 i+1 个字之间不许断
      const span = (from: number, len: number) => {
        for (let i = from; i < from + len - 1 && i < n - 1; i++) nb[i] = true
      }
      // 一个词里面不断
      if (seg) for (const x of seg.segment(sentence)) if (x.isWordLike) span([...sentence.slice(0, x.index)].length, [...x.segment].length)
      for (const k of KEEP) for (let i = sentence.indexOf(k); i >= 0; i = sentence.indexOf(k, i + 1)) span([...sentence.slice(0, i)].length, [...k].length)
      for (const re of SPANS) for (const m of sentence.matchAll(re)) span([...sentence.slice(0, m.index)].length, [...m[0]].length)
      // 句尾：往前凑够四个字，这一段连着
      let vis = 0
      for (let i = n - 1; i > 0 && vis < 4; i--) {
        if (cs[i] === '\n') continue
        if (!PUNC.test(cs[i]) && cs[i] !== ' ') vis++
        nb[i - 1] = true
      }
      let out = ''
      for (let i = 0; i < n; i++) {
        const c = cs[i]
        if (c === ' ') out += nb[i] || nb[i - 1] ? NBSP : ' '
        else out += c + (nb[i] && cs[i + 1] !== ' ' && cs[i + 1] !== '\n' ? WJ : '')
      }
      return out
    })
    .join('')
}

// 给界面上的一段话做断行处理。
export const tidy = (s: string, lang: 'zh' | 'en') => (lang === 'zh' ? zh(s) : en(s))

// 标题、结论、字幕这类短句：拆成一个个分句。界面上每个分句是一个“尽量不拆”的块——
// 一行放得下就整句待在一行，换行只发生在分句之间；实在放不下（窄屏）才在分句里面断。
export const clauses = (s: string, lang: 'zh' | 'en') => (lang === 'zh' ? s.split(/(?<=[，、；：。！？])/) : s.split(/(?<=[.!?])\s+/)).filter(Boolean).map((c) => tidy(c, lang))
