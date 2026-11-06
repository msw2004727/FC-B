// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

describe('公開建置防呆（I-01 S2）', () => {
  it('vite.config.ts 在公開建置時檢查 applyRouteMeta 與 route-meta.ts，不符合就丟錯', () => {
    expect(config).toContain("config.env.VITE_PUBLIC_LAUNCH === '1' && isBuild");
    expect(config).toContain("includes('applyRouteMeta(')");
    expect(config).toContain('./src/app/App.tsx');
    expect(config).toContain('./src/core/route-meta.ts');
    expect(config).toContain('existsSync(routeMetaPath)');
    expect(config).toContain("throw new Error('S2 未完成，不可公開建置')");
  });
});
