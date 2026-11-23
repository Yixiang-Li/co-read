// 桌上九样东西，各对应口播稿里的一个案例。right 是正确选项的序号，-1 表示没有对错。
export type Scene = {
  id: string
  size: 'xl' | 'l' | 'm'
  teaser: string
  q: string
  opts: string[]
  fast: string[]
  right: number
  slow: string[]
  verdict: string
  concept: string
  stat: string
  venn?: boolean
  pos: [number, number]
  r: number
}

const anchor: 1200 | 180 = (() => {
  const s = sessionStorage.getItem('anchor')
  if (s === '1200' || s === '180') return Number(s) as 1200 | 180
  const a = Math.random() < 0.5 ? 1200 : 180
  sessionStorage.setItem('anchor', String(a))
  return a
})()

export const INTRO: Scene = {
  id: 'intro',
  size: 'xl',
  teaser: '',
  q: '你的脑子里住着两个室友。',
  opts: [],
  fast: [],
  right: -1,
  slow: ['17 × 20 = 340', '17 × 4 = 68', '340 + 68 = 408'],
  verdict: '408。',
  concept: '系统 2',
  stat: '这是慢，系统 2：专注、费力，一步一步来；你一松手，它就睡回去。\n那只抢答的兔子是快，系统 1：自动、不费力，你也拦不住它。',
  pos: [0, 0],
  r: 0,
}

export const CASES: Scene[] = [
  {
    id: 'lines',
    size: 'l',
    teaser: '背着两条线的人',
    q: '哪一条线更长？',
    opts: ['上面那条', '下面那条'],
    fast: ['上面！一眼就知道', '下面！一眼就知道'],
    right: -1,
    slow: ['把两头对齐。', '左边，齐的。右边，也是齐的。'],
    verdict: '一样长。',
    concept: '错觉关不掉',
    stat: '你已经知道了。可是再看一眼，它们还是一长一短。',
    pos: [-4.6, -2.5],
    r: 0.45,
  },
  {
    id: 'vinyl',
    size: 'm',
    teaser: '反复广播的小车',
    q: '一首歌第一次听，觉得很一般，甚至有点吵。\n在短视频里刷到十几遍之后，\n你觉得它怎么样？',
    opts: ['越听越好听', '还是一般'],
    fast: ['好听！单曲循环', '一般。我很有主见'],
    right: -1,
    slow: ['歌没有变。', '变的只是你听它的次数。', '连一个谁也不认识的外语单词，多看几遍，人们也会觉得它是个“好词”。'],
    verdict: '歌没变，变的是你。',
    concept: '曝光效应',
    stat: '一样东西只要反复出现，你就会慢慢对它有好感。地铁站里那些反复播的广告，背后就有这样的道理。',
    pos: [-1.9, -2.6],
    r: 0.6,
  },
  {
    id: 'tree',
    size: 'm',
    teaser: '量红杉的人',
    q: `世界上最高的那棵红杉树，\n有没有 ${anchor} 英尺高？\n那你猜一猜，它到底有多高？`,
    opts: ['200 英尺', '400 英尺', '600 英尺', '800 英尺'],
    fast: ['200！', '400！', '600！', '800！'],
    right: 1,
    slow: [`你先听到的数字是 ${anchor}。`, `另一半访客听到的是 ${anchor === 1200 ? 180 : 1200}。`, '听到 1200 的人平均猜 844 英尺，听到 180 的平均只猜 282。'],
    verdict: '大约 380 英尺。',
    concept: '锚定效应',
    stat: '在估一个你不知道的数之前，只要先听到了某个数字，你的答案就会下意识地基于它来进行。',
    pos: [1.9, -2.6],
    r: 0.42,
  },
  {
    id: 'helmet',
    size: 'm',
    teaser: '跑出来的消防员',
    q: '消防队长带着队员在厨房里灭火。\n突然，他脱口喊了一声：“全部出去！”\n为什么要喊，他自己也说不上来。\n你听不听他的？',
    opts: ['马上跑', '先问清楚'],
    fast: ['跑！', '等等，凭什么？'],
    right: 0,
    slow: ['队员们刚撤出来，地板就塌了。', '火源不在厨房，在他们脚下的地下室。', '那场火安静得反常。他见过太多火，身体先认出来了。'],
    verdict: '这一次，快是对的。',
    concept: '专家直觉',
    stat: '直觉可以信，要同时满足两个条件：这件事本身有规律；你在这件事上花的时间够久，而且每次都能很快有反馈。',
    pos: [-3.3, 0.1],
    r: 0.42,
  },
  {
    id: 'paddle',
    size: 'l',
    teaser: '球拍和球',
    q: '球拍和球一共 1 块 1，\n球拍比球贵 1 块。\n球多少钱？',
    opts: ['1 毛', '5 分', '1 块'],
    fast: ['1 毛！这还用想', '5 分……吧？', '1 块！'],
    right: 1,
    slow: ['设球是 x，球拍就是 x + 1 块。', '加起来：2x + 1 块 = 1 块 1。', 'x = 5 分。'],
    verdict: '5 分。',
    concept: '快在抢答',
    stat: '哈佛、麻省理工、普林斯顿的学生，有一半以上答了 1 毛。',
    pos: [1.9, 2.6],
    r: 0.42,
  },
  {
    id: 'pawn',
    size: 'm',
    teaser: 'Alan 和 Ben',
    q: 'Alan：聪明、勤奋、冲动、挑剔、固执、嫉妒。\nBen：嫉妒、固执、挑剔、冲动、勤奋、聪明。\n你对谁更有好感？',
    opts: ['Alan', 'Ben', '一样'],
    fast: ['Alan！一看就靠谱', 'Ben！', '一样……吗？'],
    right: 2,
    slow: ['把两个人的词排在一起。', '聪明、勤奋、冲动、挑剔、固执、嫉妒。', '一模一样的六个词，只是顺序倒了过来。'],
    verdict: '是同一个人。',
    concept: '光环效应',
    stat: '你对一个人最先的印象是好是坏，会顺带决定你怎么看他其他的一切。所以第一印象才那么难改。',
    pos: [3.2, 0.0],
    r: 0.55,
  },
  {
    id: 'rose',
    size: 'l',
    teaser: '推玫瑰的园丁',
    q: '玫瑰都是花。\n有的花谢得很快。\n所以，有的玫瑰谢得很快。\n这个推理有没有问题？',
    opts: ['没问题', '有问题'],
    fast: ['没问题！玫瑰确实会谢', '有问题……吧？'],
    right: 1,
    slow: ['谢得很快的那些花里，', '完全可以一朵玫瑰都没有。', '结论碰巧是对的，推理却不成立。'],
    verdict: '推理不成立。',
    concept: '信念偏差',
    stat: '人一旦信了结论，就懒得回头查它是怎么推出来的。大多数大学生都觉得这个推理没问题。',
    pos: [-4.7, 2.7],
    r: 0.5,
  },
  {
    id: 'coin',
    size: 'l',
    teaser: '滚来滚去的硬币',
    q: '抛一次硬币。\n反面你输 100 块，\n正面你赢 150 块。\n玩不玩？',
    opts: ['玩', '不玩'],
    fast: ['玩！', '不玩！输了怎么办'],
    right: 0,
    slow: ['输和赢，机会一半一半。', '赢的比输的多 50 块。', '一直玩下去，平均每一把赚 25 块。'],
    verdict: '该玩。',
    concept: '损失厌恶',
    stat: '可大多数人要等赢的钱加到 200 块左右才肯玩。同样一笔钱，丢掉它的难受，差不多是得到它的开心的两倍。',
    pos: [4.7, -2.5],
    r: 0.42,
  },
  {
    id: 'folder',
    size: 'm',
    teaser: '琳达',
    q: '琳达 31 岁，单身，性格直率，人也很聪明。\n大学读的是哲学，关心歧视和社会公平，\n还参加过反核游行。\n现在的她，更可能是哪一种人？',
    opts: ['银行出纳', '积极参加女权运动的银行出纳'],
    fast: ['出纳。就这样', '第二个！这才像她'],
    right: 0,
    slow: ['参加女权运动的出纳，首先得是个出纳。', '所有出纳里，只有一部分人参加女权运动。', '一部分，不可能比全体还多。'],
    verdict: '银行出纳。',
    concept: '合取谬误',
    stat: '多加一个条件，可能性只会变小。可在美国几所名校，有 85% 到 90% 的人选了第二个。',
    venn: true,
    pos: [-1.8, 2.6],
    r: 0.42,
  },
]

// 英文版文案。措辞尽量贴着书的英文原版。
const other = anchor === 1200 ? 180 : 1200
const EN: Record<string, Partial<Scene>> = {
  intro: {
    q: 'Two roommates live in your head.',
    slow: ['17 × 20 = 340', '17 × 4 = 68', '340 + 68 = 408'],
    verdict: '408.',
    concept: 'System 2',
    stat: 'This is Slow, System 2: focused and effortful, one step at a time. Let go and it dozes off again.\nThe hare that blurted out the answers is Fast, System 1: automatic, effortless, impossible to switch off.',
  },
  lines: {
    teaser: 'The man with two lines',
    q: 'Which line is longer?',
    opts: ['The top one', 'The bottom one'],
    fast: ['Top! Obviously', 'Bottom! Obviously'],
    slow: ['Line up the two ends.', 'Left ends: level. Right ends: level too.'],
    verdict: 'They are the same length.',
    concept: 'The illusion stays',
    stat: 'Now you know. Look again, and one still looks longer than the other.',
  },
  vinyl: {
    teaser: 'The van on repeat',
    q: 'The first time you hear a song, it is nothing special, maybe a little noisy.\nAfter it has shown up in your feed a dozen times,\nhow does it sound?',
    opts: ['Better every time', 'Still nothing special'],
    fast: ['Love it! On repeat', 'Meh. I know my own mind'],
    slow: ['The song has not changed.', 'Only the number of times you have heard it.', 'Even a foreign word nobody knows, seen a few more times, starts to feel like a “good” word.'],
    verdict: 'The song did not change. You did.',
    concept: 'Mere exposure effect',
    stat: 'Anything that keeps showing up slowly earns your liking. That is the logic behind the ad that plays on a loop in the subway station.',
  },
  tree: {
    teaser: 'Measuring the redwood',
    q: `Is the tallest redwood in the world\nmore or less than ${anchor} feet tall?\nNow your best guess: how tall is it?`,
    opts: ['200 feet', '400 feet', '600 feet', '800 feet'],
    fast: ['200!', '400!', '600!', '800!'],
    slow: [`The first number you heard was ${anchor}.`, `The other half of the visitors heard ${other}.`, 'People who heard 1200 guessed 844 feet on average. Those who heard 180 guessed 282.'],
    verdict: 'About 380 feet.',
    concept: 'Anchoring effect',
    stat: 'Before you estimate a number you do not know, any number you have just heard quietly becomes your starting point.',
  },
  helmet: {
    teaser: '“Everybody out!”',
    q: 'A fire captain and his crew are hosing down a kitchen fire.\nSuddenly he hears himself shout: “Let’s get out of here!”\nHe has no idea why.\nDo you listen to him?',
    opts: ['Run now', 'Ask why first'],
    fast: ['Run!', 'Hold on, says who?'],
    slow: ['The crew had barely made it out when the floor collapsed.', 'The fire was not in the kitchen. It was in the basement beneath their feet.', 'That fire was unusually quiet. He had seen too many fires, and his body recognised it first.'],
    verdict: 'This time, Fast was right.',
    concept: 'Expert intuition',
    stat: 'Intuition can be trusted when two conditions hold: the situation is regular enough to be predictable, and you have had long practice with quick feedback.',
  },
  paddle: {
    teaser: 'A bat and a ball',
    q: 'A bat and a ball cost $1.10 in total.\nThe bat costs $1.00 more than the ball.\nHow much is the ball?',
    opts: ['10¢', '5¢', '$1'],
    fast: ['10 cents! Easy', '5 cents… I think?', 'A dollar!'],
    slow: ['Say the ball is x. Then the bat is x + $1.00.', 'Together: 2x + $1.00 = $1.10.', 'x = 5 cents.'],
    verdict: '5 cents.',
    concept: 'Fast jumps in',
    stat: 'More than half of the students at Harvard, MIT and Princeton answered 10 cents.',
  },
  pawn: {
    teaser: 'Alan and Ben',
    q: 'Alan: intelligent, industrious, impulsive, critical, stubborn, envious.\nBen: envious, stubborn, critical, impulsive, industrious, intelligent.\nWho do you like better?',
    opts: ['Alan', 'Ben', 'The same'],
    fast: ['Alan! Seems solid', 'Ben!', 'The same… are they?'],
    slow: ['Put the two lists side by side.', 'Intelligent, industrious, impulsive, critical, stubborn, envious.', 'The very same six words, in reverse order.'],
    verdict: 'They are the same person.',
    concept: 'Halo effect',
    stat: 'Your first impression of a person, good or bad, colours how you read everything else about them. That is why first impressions are so hard to change.',
  },
  rose: {
    teaser: 'The rose gardener',
    q: 'All roses are flowers.\nSome flowers fade quickly.\nTherefore some roses fade quickly.\nIs this argument sound?',
    opts: ['It is fine', 'It is flawed'],
    fast: ['Fine! Roses do fade', 'Flawed… maybe?'],
    slow: ['Among the flowers that fade quickly,', 'there may be no roses at all.', 'The conclusion happens to be true, but the argument does not hold.'],
    verdict: 'The argument is invalid.',
    concept: 'Belief bias',
    stat: 'When people believe a conclusion, they rarely go back to check how it was reached. A large majority of college students endorse this argument.',
  },
  coin: {
    teaser: 'The rolling coin',
    q: 'A coin toss.\nTails, you lose $100.\nHeads, you win $150.\nWill you play?',
    opts: ['Play', 'Pass'],
    fast: ['Play!', 'Pass! What if I lose?'],
    slow: ['Winning and losing are equally likely.', 'The win is $50 bigger than the loss.', 'Keep playing, and you make $25 a toss on average.'],
    verdict: 'You should play.',
    concept: 'Loss aversion',
    stat: 'Yet most people will not play until the win reaches about $200. Losing a sum hurts roughly twice as much as gaining it pleases.',
  },
  folder: {
    teaser: 'Linda',
    q: 'Linda is 31, single, outspoken and very bright.\nShe majored in philosophy, cared deeply about discrimination and social justice,\nand took part in antinuclear demonstrations.\nWhich is she more likely to be?',
    opts: ['A bank teller', 'A bank teller active in the feminist movement'],
    fast: ['A teller. That is it', 'The second! That is so her'],
    slow: ['A feminist bank teller is, first of all, a bank teller.', 'Only some bank tellers are active in the feminist movement.', 'A part can never be bigger than the whole.'],
    verdict: 'A bank teller.',
    concept: 'Conjunction fallacy',
    stat: 'Adding a condition can only make something less likely. Yet at several major universities, 85% to 90% of students chose the second.',
  },
}

// 取某种语言的文案：中文是原稿，英文在上面覆盖
export const loc = (c: Scene, lang: 'zh' | 'en'): Scene => (lang === 'en' ? { ...c, ...EN[c.id] } : c)

export const SLOW_POS: [number, number] = [4.8, 2.72]
// 开场介绍时兔子站的地方：乌龟的岛左前方的浅水里（相对岛心）
export const HARE_SPOT: [number, number] = [-1.3, 0.62]

// 小岛顶面的高度，和微观世界搬到岛上之后缩小的倍数
export const ISLE_S = 0.86 // 小岛模型放进场景时的大小
export const ISLE_TOP = 0.222 // 岛顶（草地）的高度
export const MICRO_SCALE = 0.55
