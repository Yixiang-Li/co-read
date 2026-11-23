// Co-read 配套网站的发布配置：只有静态文件，没有服务端代码。
// 发布：先在各期的 site 目录里 npm run build，再在这里 npm run deploy。
import { defineConfig } from 'cf/config'

export default defineConfig({
  worker: {
    name: 'co-read',
    compatibilityDate: '2026-11-20',
    domains: ['coread.yixiangli.com'],
    assets: {
      htmlHandling: 'auto-trailing-slash',
      notFoundHandling: '404-page',
    },
  },
})
