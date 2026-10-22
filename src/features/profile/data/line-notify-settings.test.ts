import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path: string, id: string) => ({ __doc: `${path}/${id}` })),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sv: 'SERVER_TIMESTAMP' })),
}));

import { getFirebase } from '@/data/firebase';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import {
  buildToggledLineNotifyFromRaw,
  buildUnboundLineNotify,
  readLineNotify,
  saveLineNotify,
  type LineNotifyState,
} from './line-notify-settings';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFirebase).mockResolvedValue({ db: {} } as never);
  vi.mocked(updateDoc).mockResolvedValue(undefined);
  vi.mocked(serverTimestamp).mockReturnValue({ __sv: 'SERVER_TIMESTAMP' } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readLineNotify（顯示用正規化）', () => {
  it('profile 沒有 lineNotify 時回傳預設未綁定', () => {
    expect(readLineNotify({})).toEqual({ bound: false, settings: {} });
  });

  it('非物件一律視為未綁定', () => {
    expect(readLineNotify({ lineNotify: 'oops' })).toEqual({ bound: false, settings: {} });
    expect(readLineNotify({ lineNotify: 42 })).toEqual({ bound: false, settings: {} });
    expect(readLineNotify({ lineNotify: null })).toEqual({ bound: false, settings: {} });
    expect(readLineNotify({ lineNotify: [] })).toEqual({ bound: false, settings: {} });
    expect(readLineNotify({ lineNotify: false })).toEqual({ bound: false, settings: {} });
  });

  it('完整已綁定：bound=true、boundAt、三個 settings 都保留', () => {
    const r = readLineNotify({
      lineNotify: {
        bound: true,
        boundAt: '2025/01/02',
        settings: { activity: true, system: false, tournament: true },
      },
    });
    expect(r.bound).toBe(true);
    expect(r.boundAt).toBe('2025/01/02');
    expect(r.settings).toEqual({ activity: true, system: false, tournament: true });
  });

  it('bound 只認 true（字串「true」視為 false）', () => {
    const r = readLineNotify({ lineNotify: { bound: 'true', settings: {} } });
    expect(r.bound).toBe(false);
  });

  it('顯示用：settings 非物件 → 空物件；只保留三個合法 key；型別不符不顯示', () => {
    const r1 = readLineNotify({ lineNotify: { bound: true, settings: 'x' } });
    expect(r1.settings).toEqual({});
    const r2 = readLineNotify({
      lineNotify: { bound: true, settings: { activity: true, system: 'yes', foo: true } },
    });
    expect(r2.settings).toEqual({ activity: true });
    // 寫入保留未知 key 由 buildToggledLineNotifyFromRaw 測試。
  });

  it('settings 不是物件時仍保留 bound 狀態', () => {
    const r = readLineNotify({ lineNotify: { bound: true, settings: null } });
    expect(r.bound).toBe(true);
    expect(r.settings).toEqual({});
  });

  it('boundAt 非字串在顯示時丟棄（安全）', () => {
    const r = readLineNotify({
      lineNotify: { bound: true, boundAt: 123, settings: {} },
    });
    expect(r.boundAt).toBeUndefined();
  });
});

describe('buildToggledLineNotifyFromRaw（照 A 以原始 lineNotify 展開）', () => {
  it('只切換指定 key；未知 settings key、其他根欄位（含 boundAt 非字串）原樣保留', () => {
    const raw = {
      bound: true,
      boundAt: 123,
      customRoot: 'keep-me',
      settings: {
        activity: true,
        system: false,
        custom: 'yes',
        foo: true,
        nested: { a: 1 },
      },
    };
    const next = buildToggledLineNotifyFromRaw(raw, 'system');
    expect(next).toEqual({
      bound: true,
      boundAt: 123,
      customRoot: 'keep-me',
      settings: {
        activity: true,
        system: true,
        custom: 'yes',
        foo: true,
        nested: { a: 1 },
      },
    });
    // 純函式：不動來源
    expect(raw.settings.system).toBe(false);
  });

  it('undefined → true（照 A `!settings[key]`）', () => {
    const next = buildToggledLineNotifyFromRaw(
      { bound: true, settings: { activity: false, foo: 'bar' } },
      'tournament',
    );
    expect(next).toEqual({
      bound: true,
      settings: { activity: false, foo: 'bar', tournament: true },
    });
  });

  it('true → false，保留其他根欄位', () => {
    const next = buildToggledLineNotifyFromRaw(
      { bound: true, boundAt: '2025/01/02', settings: { system: true }, extra: 7 },
      'system',
    );
    expect(next).toEqual({
      bound: true,
      boundAt: '2025/01/02',
      settings: { system: false },
      extra: 7,
    });
  });

  it('raw 非物件回 null（不得寫入）', () => {
    expect(buildToggledLineNotifyFromRaw(null, 'activity')).toBeNull();
    expect(buildToggledLineNotifyFromRaw(undefined, 'activity')).toBeNull();
    expect(buildToggledLineNotifyFromRaw('oops', 'activity')).toBeNull();
    expect(buildToggledLineNotifyFromRaw(42, 'activity')).toBeNull();
    expect(buildToggledLineNotifyFromRaw([], 'activity')).toBeNull();
    expect(buildToggledLineNotifyFromRaw(false, 'activity')).toBeNull();
  });

  it('settings 非物件時視為空物件，只新增切換 key', () => {
    const next = buildToggledLineNotifyFromRaw(
      { bound: true, settings: 'x', customRoot: 1 },
      'activity',
    );
    expect(next).toEqual({
      bound: true,
      settings: { activity: true },
      customRoot: 1,
    });
  });
});

describe('buildUnboundLineNotify', () => {
  it('固定 payload（不帶 boundAt）', () => {
    const r = buildUnboundLineNotify();
    expect(r).toEqual({
      bound: false,
      settings: { activity: true, system: true, tournament: false },
    });
    expect(r.boundAt).toBeUndefined();
  });
});

describe('saveLineNotify', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uid 空白 throw，不觸發 firestore 呼叫', async () => {
    await expect(saveLineNotify('', buildUnboundLineNotify())).rejects.toThrow();
    await expect(saveLineNotify('   ', buildUnboundLineNotify())).rejects.toThrow();
    expect(doc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(serverTimestamp).not.toHaveBeenCalled();
  });

  it('寫入 users/{uid}：只帶 lineNotify 與 updatedAt 兩個 key', async () => {
    const ln = buildUnboundLineNotify();
    await saveLineNotify('u1', ln);
    expect(doc).toHaveBeenCalledWith({}, 'users', 'u1');
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const call = vi.mocked(updateDoc).mock.calls[0];
    expect(call).toBeTruthy();
    const [ref, payload] = call!;
    expect(ref).toEqual({ __doc: 'users/u1' });
    const keys = Object.keys(payload as object).sort();
    expect(keys).toEqual(['lineNotify', 'updatedAt']);
    expect((payload as unknown as Record<string, unknown>)['lineNotify']).toEqual(ln);
    expect((payload as unknown as Record<string, unknown>)['updatedAt']).toEqual({ __sv: 'SERVER_TIMESTAMP' });
  });

  it('原始 Record 含未知欄位也會原樣寫入 lineNotify', async () => {
    const ln: Record<string, unknown> = {
      bound: true,
      boundAt: 123,
      customRoot: 'keep-me',
      settings: { activity: true, custom: 'yes' },
    };
    await saveLineNotify('u2', ln);
    const [, payload] = vi.mocked(updateDoc).mock.calls[0]!;
    expect((payload as unknown as Record<string, unknown>)['lineNotify']).toEqual(ln);
    expect(Object.keys(payload as object).sort()).toEqual(['lineNotify', 'updatedAt']);
  });
});
