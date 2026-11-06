// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NOINDEX_HEADER_PATHS } from '../src/core/route-meta.ts';

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

describe('私人路徑 _headers（I-01 S3）', () => {
  it('vite.config.ts 在公開建置時檢查 data-route-robots，不符合就丟錯', () => {
    expect(config).toContain(`includes('meta[name="robots"][data-route-robots]')`);
    expect(config).toContain("routeMetaFor('/admin/users').indexable === false");
    expect(config).toContain("throw new Error('S3 未完成，不可公開建置')");
    expect(config).toContain("throw new Error('S2 未完成，不可公開建置')");
  });

  it('建置產生的 _headers 含 /admin/* 段與 X-Robots-Tag: noindex', () => {
    expect(config).toContain("from './src/core/route-meta.ts'");
    expect(config).toContain('...NOINDEX_HEADER_PATHS.flatMap((path) => [');
    expect(config).toContain("'  X-Robots-Tag: noindex',");
    expect(config).toContain('enabled ? [...INTERNAL_TEST_HEADERS, ...COMMON_HEADERS] : COMMON_HEADERS');

    const robotsLine = config.indexOf("'  X-Robots-Tag: noindex',");
    const cacheLine = config.lastIndexOf("'  Cache-Control: public, max-age=86400'");
    expect(robotsLine).toBeGreaterThan(cacheLine);
    expect(config.indexOf('];', robotsLine)).toBeGreaterThan(robotsLine);

    const block = NOINDEX_HEADER_PATHS.flatMap((path) => `${path}\n  X-Robots-Tag: noindex`).join('\n');
    expect(block).toContain('/admin/*\n  X-Robots-Tag: noindex');
    for (const path of NOINDEX_HEADER_PATHS) {
      expect(block).toContain(`${path}\n  X-Robots-Tag: noindex`);
    }
  });
});
