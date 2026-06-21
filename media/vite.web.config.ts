import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron 을 거치지 않고 렌더러(React)만 브라우저로 미리보기 위한 설정.
// X 디스플레이가 없는 Remote-SSH 환경에서 UI 확인용. (window.api 등 Electron 전용 기능은 비활성)
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  }
})
