import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron 을 거치지 않고 렌더러(React)만 브라우저로 미리보기 위한 설정.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  server: {
    port: 5174,
    host: true
  }
})
