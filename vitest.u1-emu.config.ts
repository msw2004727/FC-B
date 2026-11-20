import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

// Node 的套件匯出把 `node` 條件排在 `browser` 前面，Vitest 直接交給 Node 解析時會載入
// `@firebase/firestore` 的 gRPC 建置。這支 Node 在開流時會壞。改指向瀏覽器建置（WebChannel）。
const root = import.meta.dirname;
const browserEntry = path.resolve(root, 'node_modules/firebase/firestore/dist/esm/index.esm.js');
const browserFirestore = path.resolve(root, 'node_modules/@firebase/firestore/dist/index.esm.js');

function firestoreBrowser(): Plugin {
  return {
    name: 'firestore-browser',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'firebase/firestore') return browserEntry;
      if (id === '@firebase/firestore') return browserFirestore;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [firestoreBrowser()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(root, 'src') },
      { find: /^firebase\/firestore$/, replacement: browserEntry },
      { find: /^@firebase\/firestore$/, replacement: browserFirestore },
    ],
  },
  ssr: {
    noExternal: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/features/competitions/live/data/**/*.emu.test.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
    server: {
      deps: {
        inline: [/^firebase/, /^@firebase/],
      },
    },
  },
});
