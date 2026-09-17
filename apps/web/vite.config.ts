import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

// 开发期把 /api 转给本机跑着的那套（Caddy 会把 /api 前缀剥掉再转给 NestJS）。
// 换后端地址改 FAMILY_API_ORIGIN 即可，不用改代码。
const apiOrigin = process.env.FAMILY_API_ORIGIN ?? 'http://localhost:8088';
// 直连 NestJS（比如 Playwright 起的隔离 API）时没有 Caddy 帮忙剥 /api 前缀，自己剥。
const stripPrefix = process.env.FAMILY_API_STRIP_PREFIX === '1';

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5180,
    host: true,
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
        ...(stripPrefix ? { rewrite: (path: string) => path.replace(/^\/api/, '') } : {}),
      },
    },
  },
});
