import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { incrementVersion, todayTaipei, VERSION_PATTERN } from './bump-version.mjs';

describe('bump-version（規則照 A scripts/bump-version.js）', () => {
  it('跨日重置為今天無後綴', () => {
    expect(incrementVersion('0.20261019c', '20261020')).toBe('0.20261020');
  });
  it('同日第二次起遞增後綴：無→a、a→b、y→z、z→za、zz→zza、az→ba', () => {
    expect(incrementVersion('0.20261020', '20261020')).toBe('0.20261020a');
    expect(incrementVersion('0.20261020a', '20261020')).toBe('0.20261020b');
    expect(incrementVersion('0.20261020y', '20261020')).toBe('0.20261020z');
    expect(incrementVersion('0.20261020z', '20261020')).toBe('0.20261020za');
    expect(incrementVersion('0.20261020zz', '20261020')).toBe('0.20261020zza');
    expect(incrementVersion('0.20261020az', '20261020')).toBe('0.20261020ba');
  });
  it('不符格式時重置為今天', () => {
    expect(incrementVersion('1.2.3', '20261020')).toBe('0.20261020');
  });
  it('系統日期比版號舊時沿用版號日期遞增（照 A）', () => {
    expect(incrementVersion('0.20261021', '20261020')).toBe('0.20261021a');
  });
  it('台北日期：UTC 16:00 已是台北隔天', () => {
    expect(todayTaipei(new Date('2026-10-19T16:30:00Z'))).toBe('20261020');
  });
  it('src/version.ts 目前的版號符合格式', () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'version.ts'), 'utf8');
    const v = src.match(/APP_VERSION = '([^']+)'/)?.[1] ?? '';
    expect(VERSION_PATTERN.test(v)).toBe(true);
  });
});
