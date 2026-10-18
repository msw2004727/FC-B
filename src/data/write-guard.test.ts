import { describe, expect, it } from 'vitest';

import {
  assertAllowedFields,
  assertNoDerivedFields,
  FORBIDDEN_DERIVED_FIELDS,
} from './write-guard';

describe('assertAllowedFields', () => {
  it('全部欄位都在 allowlist → 放行', () => {
    expect(() =>
      assertAllowedFields('createEvent', { name: 'x', status: 'open' }, ['name', 'status']),
    ).not.toThrow();
  });

  it('多出欄位 → 丟錯並列出多出的 key', () => {
    expect(() =>
      assertAllowedFields('createEvent', { name: 'x', extra: 1, another: 2 }, ['name']),
    ).toThrow(/extra.*another|another.*extra/);
  });

  it('點記法：只要頂層段落被允許即可', () => {
    expect(() =>
      assertAllowedFields('updateLocation', { 'location.lat': 1, 'location.lng': 2 }, [
        'location',
      ]),
    ).not.toThrow();
  });

  it('點記法：頂層段落不在 allowlist → 丟錯', () => {
    expect(() =>
      assertAllowedFields('updateLocation', { 'other.lat': 1 }, ['location']),
    ).toThrow(/other\.lat/);
  });

  it('空 payload 放行', () => {
    expect(() => assertAllowedFields('noop', {}, ['allowed'])).not.toThrow();
  });
});

describe('FORBIDDEN_DERIVED_FIELDS', () => {
  it('內容固定（A02 契約）', () => {
    expect(FORBIDDEN_DERIVED_FIELDS).toEqual([
      'current',
      'waitlist',
      'participants',
      'waitlistNames',
      'realCurrent',
    ]);
  });
});

describe('assertNoDerivedFields', () => {
  it('沒有衍生欄位 → 放行', () => {
    expect(() => assertNoDerivedFields({ name: 'x', status: 'open' })).not.toThrow();
  });

  it('出現 current → 丟錯', () => {
    expect(() => assertNoDerivedFields({ current: 5 })).toThrow(/current/);
  });

  it('出現 participants → 丟錯', () => {
    expect(() => assertNoDerivedFields({ participants: [] })).toThrow(/participants/);
  });

  it('出現 realCurrent → 丟錯', () => {
    expect(() => assertNoDerivedFields({ realCurrent: 0 })).toThrow(/realCurrent/);
  });

  it('同時出現多個 → 錯誤訊息全列出', () => {
    expect(() =>
      assertNoDerivedFields({ current: 1, waitlist: [], participants: [] }),
    ).toThrow(/current.*waitlist.*participants|current.*participants.*waitlist/);
  });
});
