import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

// 开发期把 /api 转给本机跑着的那套（Caddy 会把 /api 前缀剥掉再转给 NestJS）。
// 换后端地址改 FAMILY_API_ORIGIN 即可，不用改代码。
const apiOrigin = process.env.FAMILY_API_ORIGIN ?? 'http://localhost:8088';

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5180,
    host: true,
    proxy: { '/api': { target: apiOrigin, changeOrigin: true } },
  },
});
