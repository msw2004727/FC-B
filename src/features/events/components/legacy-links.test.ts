import { describe, expect, it } from 'vitest';
import { LEGACY_SETTLE_URL, legacySiteUrl } from './legacy-links';

describe('legacySiteUrl', () => {
  it.each([
    ['toosterx.com', 'https://old.toosterx.com/'],
    ['www.toosterx.com', 'https://old.toosterx.com/'],
    ['next.toosterx.com', 'https://toosterx.com/'],
    ['old.toosterx.com', 'https://toosterx.com/'],
    ['localhost', 'https://toosterx.com/'],
    ['', 'https://toosterx.com/'],
  ])('%s → %s', (hostname, expected) => {
    expect(legacySiteUrl(hostname)).toBe(expected);
  });

  it('測試環境（localhost）仍指向 toosterx.com', () => {
    expect(LEGACY_SETTLE_URL).toBe('https://toosterx.com/');
  });
});
