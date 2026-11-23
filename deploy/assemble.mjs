// 把各期网站打包好的 dist 拼成一个发布目录 out/：每期一个子目录，根目录跳到最新一期。
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const BOOKS = [{ slug: 'thinking-fast-slow', dist: '../thinking-fast-slow/site/dist' }]
const LATEST = BOOKS[BOOKS.length - 1].slug
const out = resolve(here, 'out')
rmSync(out, { recursive: true, force: true })
mkdirSync(out)
for (const b of BOOKS) {
  const src = resolve(here, b.dist)
  if (!existsSync(resolve(src, 'index.html'))) throw new Error(`${b.slug} 还没打包：先在它的 site 目录里运行 npm run build`)
  cpSync(src, resolve(out, b.slug), { recursive: true })
}
const page = (title, body, head = '') => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>${head}
    <style>
      html, body { height: 100%; margin: 0; background: #2a241d; color: #e9dcc0; }
      body { display: grid; place-items: center; font: 17px/1.7 Georgia, 'Songti SC', 'Noto Serif SC', serif; }
      a { color: inherit; }
    </style>
  </head>
  <body>${body}</body>
</html>
`
writeFileSync(
  resolve(out, 'index.html'),
  page('Co-read', `\n    <a href="./${LATEST}/">Co-read</a>\n    <script>location.replace('./${LATEST}/' + location.search)</script>\n  `, `\n    <meta http-equiv="refresh" content="0; url=./${LATEST}/" />`),
)
writeFileSync(resolve(out, '404.html'), page('Co-read', `\n    <p>这一页不在书里。<a href="/">回到 Co-read</a><br />This page is not in the book. <a href="/">Back to Co-read</a></p>\n  `))
// 带内容指纹的文件名可以长期缓存；页面本身每次都问服务器要最新的
writeFileSync(resolve(out, '_headers'), BOOKS.map((b) => `/${b.slug}/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`).join('\n'))
console.log('已生成', out)
