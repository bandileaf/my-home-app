import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // node_modules 를 번들에 포함하지 않고 런타임 require() 로 로드
    // — node: 내장 모듈 사용 패키지(@distube/ytdl-core, youtubei.js 등) 오류 방지
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, '../shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          toast: resolve(__dirname, 'src/preload/toast.ts'),
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          toast:  resolve(__dirname, 'src/renderer/toast.html'),
        }
      }
    },
    plugins: [react()]
  }
})
