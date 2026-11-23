import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // 相对路径：放在域名根目录或某个子目录下都能直接用
  base: './',
  plugins: [react()],
})
