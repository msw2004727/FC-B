import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // LINE 內建瀏覽器相容目標
    target: ['es2020', 'chrome87', 'safari14'],
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        // 同一語系的核心與各功能字典合併成一個 chunk，切換語系只需一次請求（避免每個功能一個小檔）
        manualChunks(id: string) {
          const m = id.match(/[\\/](?:messages|locales)[\\/](zh-TW|zh-CN|en|ja|vi|th|ko)\.json$/);
          return m ? `i18n-${m[1]}` : undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
});
