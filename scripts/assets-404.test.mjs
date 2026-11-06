// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 顧問 §1.28：/assets/* 不存在的檔回 Pages 真 404（最近一層 404.html），不再拿到 SPA 首頁並被 immutable 快取一年。
describe('public/assets/404.html', () => {
  it('只有一行純文字、不含 HTML 或內部資訊', () => {
    const body = readFileSync(new URL('../public/assets/404.html', import.meta.url), 'utf8');
    expect(body).toBe('Not Found\n');
  });

  it('不進 Service Worker 預存', () => {
    const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
    const ignores = /globIgnores:\s*\[([^\]]*)\]/.exec(viteConfig)?.[1] ?? '';
    expect(ignores).toContain("'assets/404.html'");
  });

  it('站台根目錄沒有 404.html（有的話 Pages 會關掉全站 SPA fallback）', () => {
    expect(() => readFileSync(new URL('../public/404.html', import.meta.url))).toThrow();
  });
});
