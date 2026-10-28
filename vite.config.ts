import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 项目页部署在 /sse-markdown-render/ 子路径下；
// 本地开发（npm run dev）默认根路径。CI 里通过 BASE_PATH 环境变量注入。
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
});
