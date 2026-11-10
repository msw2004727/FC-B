// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

describe('SPEED-1-7 /img 與 /fonts 短快取', () => {
  it('固定檔名用一天快取加 stale-while-revalidate，且能蓋過內測全站 no-cache', () => {
    for (const path of ['/img/*', '/fonts/*']) {
      const at = config.indexOf(`'${path}'`);
      expect(at).toBeGreaterThan(config.indexOf("'/assets/*',"));
      const block = config.slice(at, at + 220);
      expect(block).toContain('! Cache-Control');
      expect(block).toContain('Cache-Control: public, max-age=86400, stale-while-revalidate=86400');
      expect(block).not.toContain('immutable');
    }
    expect(config).toContain('enabled ? [...INTERNAL_TEST_HEADERS, ...COMMON_HEADERS] : COMMON_HEADERS');
  });
});
