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
  buildToggledLineNotify,
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

describe('readLineNotify', () => {
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

  it('settings 非物件 → 空物件；只保留三個合法 key；型別不符丟棄', () => {
    const r1 = readLineNotify({ lineNotify: { bound: true, settings: 'x' } });
    expect(r1.settings).toEqual({});
    const r2 = readLineNotify({
      lineNotify: { bound: true, settings: { activity: true, system: 'yes', foo: true } },
    });
    expect(r2.settings).toEqual({ activity: true });
  });

  it('settings 不是物件時仍保留 bound 狀態', () => {
    const r = readLineNotify({ lineNotify: { bound: true, settings: null } });
    expect(r.bound).toBe(true);
    expect(r.settings).toEqual({});
  });

  it('boundAt 非字串丟棄（安全）', () => {
    const r = readLineNotify({
      lineNotify: { bound: true, boundAt: 123, settings: {} },
    });
    expect(r.boundAt).toBeUndefined();
  });
});

describe('buildToggledLineNotify', () => {
  it('activity false → true，保留其他欄位（含 boundAt）', () => {
    const cur: LineNotifyState = {
      bound: true,
      boundAt: '2025/01/02',
      settings: { activity: false, system: true },
    };
    const next = buildToggledLineNotify(cur, 'activity');
    expect(next.bound).toBe(true);
    expect(next.boundAt).toBe('2025/01/02');
    expect(next.settings).toEqual({ activity: true, system: true });
    // 純函式：不動來源
    expect(cur.settings.activity).toBe(false);
  });

  it('undefined → true（照 A `!settings[key]`）', () => {
    const cur: LineNotifyState = { bound: true, settings: {} };
    const next = buildToggledLineNotify(cur, 'tournament');
    expect(next.settings.tournament).toBe(true);
  });

  it('true → false', () => {
    const cur: LineNotifyState = { bound: true, settings: { system: true } };
    const next = buildToggledLineNotify(cur, 'system');
    expect(next.settings.system).toBe(false);
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

  it('已綁定含 boundAt 也會原樣寫入 lineNotify', async () => {
    const ln: LineNotifyState = {
      bound: true,
      boundAt: '2025/05/06',
      settings: { activity: true, system: false, tournament: true },
    };
    await saveLineNotify('u2', ln);
    const [, payload] = vi.mocked(updateDoc).mock.calls[0]!;
    expect((payload as unknown as Record<string, unknown>)['lineNotify']).toEqual(ln);
    expect(Object.keys(payload as object).sort()).toEqual(['lineNotify', 'updatedAt']);
  });
});
