import { describe, expect, it } from 'vitest';

import { buildUnsignedCustomToken } from './auth';

interface DecodedToken {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

function decodeBase64url(input: string): string {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return atob(b64);
}

function decodeToken(token: string): DecodedToken {
  const parts = token.split('.');
  expect(parts).toHaveLength(3);
  const [headerPart, payloadPart] = parts;
  if (!headerPart || !payloadPart) {
    throw new Error('token 缺少 header 或 payload');
  }
  // atob 只產生 Latin-1 字串；本測試 payload 全 ASCII 故可直接 JSON.parse。
  const header = JSON.parse(decodeBase64url(headerPart)) as Record<string, unknown>;
  const payload = JSON.parse(decodeBase64url(payloadPart)) as Record<string, unknown>;
  return { header, payload };
}

describe('buildUnsignedCustomToken（emulator）', () => {
  it('header 為 { alg: "none", typ: "JWT" }', () => {
    const token = buildUnsignedCustomToken('uid-1', {}, 1700000000);
    const { header } = decodeToken(token);
    expect(header).toEqual({ alg: 'none', typ: 'JWT' });
  });

  it('payload 含 iss / sub / aud / iat / exp / uid / claims', () => {
    const nowSec = 1_700_000_000;
    const token = buildUnsignedCustomToken('uid-1', { role: 'admin' }, nowSec);
    const { payload } = decodeToken(token);

    expect(typeof payload.iss).toBe('string');
    expect(payload.iss).toBeTruthy();
    expect(typeof payload.sub).toBe('string');
    expect(payload.sub).toBeTruthy();
    expect(payload.aud).toBe(
      'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    );
    expect(payload.iat).toBe(nowSec);
    expect(payload.exp).toBe(nowSec + 3600);
    expect(payload.uid).toBe('uid-1');
    expect(payload.claims).toEqual({ role: 'admin' });
  });

  it('uid 原樣寫入，不做改寫', () => {
    const token = buildUnsignedCustomToken('U1234567890abcdef', {}, 1_700_000_000);
    const { payload } = decodeToken(token);
    expect(payload.uid).toBe('U1234567890abcdef');
  });

  it('claims 空物件可用', () => {
    const token = buildUnsignedCustomToken('uid-x', {}, 1_700_000_000);
    const { payload } = decodeToken(token);
    expect(payload.claims).toEqual({});
  });

  it('以 "." 分隔三段（第三段為空簽章）', () => {
    const token = buildUnsignedCustomToken('uid-1', {}, 1_700_000_000);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[2]).toBe('');
  });

  it('base64url 無 padding', () => {
    const token = buildUnsignedCustomToken('uid-1', { a: 'x' }, 1_700_000_000);
    const parts = token.split('.');
    for (const part of parts.slice(0, 2)) {
      expect(part).not.toMatch(/=/);
    }
  });
});
