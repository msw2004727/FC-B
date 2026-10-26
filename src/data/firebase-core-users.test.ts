import { describe, expect, it } from 'vitest';

// T-041：getFirebaseCore() 只保證 app＋firestore 就緒，auth／functions 可能還在下載。
// 需要 auth／functions 的呼叫端必須走 getFirebase()（會 await 兩段都就緒），否則會出現「第一次點沒反應」。
// 這份清單是「只讀公開資料、只用 db」的呼叫端；新增者要先確認不碰 auth／functions，再更新這份清單。
const ALLOWED_CORE_USERS = [
  'src/data/firebase.ts',
  'src/features/events/data/events-repo.ts',
  'src/features/home/data/announcements.ts',
  'src/features/home/pages/HomePage.tsx',
];

describe('getFirebaseCore 的使用者', () => {
  it('只有清單內的檔案（非測試）引用 getFirebaseCore', () => {
    const sources = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.*'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    const users = Object.entries(sources)
      .filter(([, source]) => /\bgetFirebaseCore\b/.test(source))
      // glob 的 key 是相對本檔（src/data）的路徑：'./x' 在 src/data，'../x' 在 src
      .map(([file]) => (file.startsWith('./') ? `src/data/${file.slice(2)}` : `src/${file.replace(/^\.\.\//, '')}`))
      .sort();

    expect(users).toEqual([...ALLOWED_CORE_USERS].sort());
  });

  it('清單內的呼叫端沒有取用 auth 或 functions', () => {
    const sources = import.meta.glob(
      [
        '../features/events/data/events-repo.ts',
        '../features/home/data/announcements.ts',
        '../features/home/pages/HomePage.tsx',
      ],
      { query: '?raw', import: 'default', eager: true },
    ) as Record<string, string>;

    expect(Object.keys(sources)).toHaveLength(3);
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/\{[^}]*\b(auth|functions)\b[^}]*\}\s*=\s*await\s+\w*[Ff]irebase/);
      expect(source, file).not.toMatch(/\bctx\.(auth|functions)\b/);
    }
  });

  it('需要 auth／functions 的核心模組仍走完整的 getFirebase（會等兩段就緒）', () => {
    const sources = import.meta.glob(['./auth.ts', './callables.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    expect(Object.keys(sources)).toHaveLength(2);
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).toMatch(/\bgetFirebase\b/);
      expect(source, file).not.toMatch(/\bgetFirebaseCore\b/);
    }
  });
});
