import { useSyncExternalStore } from 'react'

// 中英文。所有给访客看的字都用 L('中文', 'English') 包起来；
// 组件里先调用一次 useLang()，切换语言时它就会重新渲染。
export type Lang = 'zh' | 'en'
// 触屏（手机、平板）：提示语里的“滚动、点击”要换成“滑、点”
export const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
const q = new URLSearchParams(location.search).get('lang')
// 第一次来的访客默认用哪种语言：不查 IP（静态网页查 IP 要调外面的服务，国内常被拦，还会先闪一下英文），
// 只看本机就有的两样：浏览器的语言列表里有没有中文（不只看排第一的那个）；系统时区是不是在中国大陆、港澳台。
// 访客手动切换过，就一直按他选的来。
const CN_TZ = /^(Asia\/(Shanghai|Chongqing|Chungking|Harbin|Urumqi|Kashgar|Hong_Kong|Macau|Macao|Taipei)|PRC|Hongkong|ROC)$/
function guess(): Lang {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language]
  if (list.some((l) => /^zh\b/i.test(l ?? ''))) return 'zh'
  try {
    if (CN_TZ.test(Intl.DateTimeFormat().resolvedOptions().timeZone)) return 'zh'
  } catch {
    /* 取不到时区就算了 */
  }
  return 'en'
}
const saved = (() => {
  try {
    const s = localStorage.getItem('lang')
    return s === 'zh' || s === 'en' ? s : null
  } catch {
    return null
  }
})()
let lang: Lang = q === 'en' || q === 'zh' ? q : (saved ?? guess())
const subs = new Set<() => void>()
const apply = () => {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  document.documentElement.dataset.lang = lang
  document.title = lang === 'zh' ? '思考，快与慢｜Co-read' : 'Thinking, Fast and Slow | Co-read'
}
apply()

export const getLang = () => lang
export const setLang = (l: Lang) => {
  lang = l
  try {
    localStorage.setItem('lang', l)
  } catch {
    /* 隐私模式下存不了就算了 */
  }
  apply()
  subs.forEach((f) => f())
}
export const L = (zh: string, en: string) => (lang === 'zh' ? zh : en)
export const useLang = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    getLang,
  )
