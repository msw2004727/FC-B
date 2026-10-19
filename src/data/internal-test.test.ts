import { afterEach, describe, expect, it, vi } from 'vitest';

const { getDocMock } = vi.hoisted(() => ({ getDocMock: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, coll: string, id: string) => ({ path: `${coll}/${id}` })),
  getDoc: getDocMock,
}));
vi.mock('./firebase', () => ({ getFirebase: vi.fn(async () => ({ db: {} })) }));

import {
  InternalTestBlockedError,
  assertInternalTestWritable,
  assertInternalTestEventDocWritable,
  assertInternalTestEventTitle,
  isInternalTestMode,
  isInternalTester,
  sha256Hex,
} from './internal-test';

afterEach(() => {
  vi.unstubAllEnvs();
  getDocMock.mockReset();
});

describe('internal-test', () => {
  it('dev／測試預設不套用內測模式，VITE_INTERNAL_TEST=1 才套用', () => {
    expect(isInternalTestMode()).toBe(false);
    vi.stubEnv('VITE_INTERNAL_TEST', '1');
    expect(isInternalTestMode()).toBe(true);
  });

  it('正式建置預設是內測模式，只有 VITE_PUBLIC_LAUNCH=1 才關閉', () => {
    vi.stubEnv('DEV', false);
    expect(isInternalTestMode()).toBe(true);
    vi.stubEnv('VITE_PUBLIC_LAUNCH', '1');
    expect(isInternalTestMode()).toBe(false);
  });

  it('sha256Hex 與已知值一致', async () => {
    expect(await sha256Hex('abc'))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('白名單比對雜湊；清單空白或格式錯誤時沒有人能進', async () => {
    vi.stubEnv('VITE_INTERNAL_TEST', '1');
    expect(await isInternalTester('U_tester')).toBe(false);
    vi.stubEnv('VITE_INTERNAL_TEST_UID_HASHES', 'not-a-hash, U_tester');
    expect(await isInternalTester('U_tester')).toBe(false);
    const hash = await sha256Hex('U_tester');
    vi.stubEnv('VITE_INTERNAL_TEST_UID_HASHES', ` ${hash.toUpperCase()} ,${'0'.repeat(64)}`);
    expect(await isInternalTester('U_tester')).toBe(true);
    expect(await isInternalTester('U_other')).toBe(false);
    expect(await isInternalTester(null)).toBe(false);
  });

  it('非內測模式所有人都放行', async () => {
    expect(await isInternalTester(null)).toBe(true);
  });

  it('內測模式只放行標題以「[內測]」開頭的活動', () => {
    expect(() => assertInternalTestEventTitle('週末練球')).not.toThrow();
    vi.stubEnv('VITE_INTERNAL_TEST', '1');
    expect(() => assertInternalTestEventTitle('[內測] 週末練球')).not.toThrow();
    expect(() => assertInternalTestEventTitle('週末練球 [內測]')).toThrow(InternalTestBlockedError);
    expect(() => assertInternalTestEventTitle(undefined)).toThrow(InternalTestBlockedError);
  });

  it('只有文件 id 時讀活動標題；讀不到文件一律擋下', async () => {
    await assertInternalTestEventDocWritable('ce_1');
    expect(getDocMock).not.toHaveBeenCalled();

    vi.stubEnv('VITE_INTERNAL_TEST', '1');
    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => ({ title: '[內測]練球' }) });
    await expect(assertInternalTestEventDocWritable('ce_1')).resolves.toBeUndefined();
    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => ({ title: '正式活動' }) });
    await expect(assertInternalTestEventDocWritable('ce_2')).rejects.toBeInstanceOf(InternalTestBlockedError);
    getDocMock.mockResolvedValueOnce({ exists: () => false });
    await expect(assertInternalTestEventDocWritable('legacy')).rejects.toBeInstanceOf(InternalTestBlockedError);
  });

  it('活動以外的寫入：標記「[內測]」或影響對象全在名單才放行', async () => {
    await expect(assertInternalTestWritable({ kind: 'team', affectedUids: [] })).resolves.toBeUndefined();
    vi.stubEnv('VITE_INTERNAL_TEST', '1');
    vi.stubEnv('VITE_INTERNAL_TEST_UID_HASHES', [await sha256Hex('U_a'), await sha256Hex('U_b')].join(','));
    await expect(assertInternalTestWritable({ kind: 'team', labeled: true, affectedUids: ['U_real'] }))
      .resolves.toBeUndefined();
    await expect(assertInternalTestWritable({ kind: 'pm', affectedUids: ['U_a', 'U_b', 'U_a'] }))
      .resolves.toBeUndefined();
    await expect(assertInternalTestWritable({ kind: 'pm', affectedUids: ['U_a', 'U_real'] }))
      .rejects.toMatchObject({ code: 'INTERNAL_TEST_BLOCKED', messageKey: 'internalTest.blocked', kind: 'pm' });
    await expect(assertInternalTestWritable({ kind: 'inbox', affectedUids: [] }))
      .rejects.toBeInstanceOf(InternalTestBlockedError);
    await expect(assertInternalTestWritable({ kind: 'inbox', affectedUids: [null] }))
      .rejects.toBeInstanceOf(InternalTestBlockedError);
  });

  it('正式上線（VITE_PUBLIC_LAUNCH=1）：所有守衛都不作用，不讀白名單', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_PUBLIC_LAUNCH', '1');
    vi.stubEnv('VITE_INTERNAL_TEST_UID_HASHES', '');
    expect(isInternalTestMode()).toBe(false);
    expect(await isInternalTester('U_anyone')).toBe(true);
    expect(() => assertInternalTestEventTitle('一般活動')).not.toThrow();
    await expect(assertInternalTestWritable({ kind: 'pm', affectedUids: [] })).resolves.toBeUndefined();
    await expect(assertInternalTestEventDocWritable('ce_1')).resolves.toBeUndefined();
    expect(getDocMock).not.toHaveBeenCalled();
  });
});

