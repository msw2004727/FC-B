import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 照 S: 檔的所有 export 逐一驗證；Firestore 與 callables 用 vi.mock 攔截（不得真的打外部）。
const h = vi.hoisted(() => ({
  updateDoc: vi.fn(),
  getDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  doc: vi.fn((_db: unknown, col: string, id: string) => ({ _col: col, _id: id })),
  getFirebase: vi.fn(() => Promise.resolve({ db: { fake: true } })),
  callFn: vi.fn(),
  writeOpLog: vi.fn(),
  toastShow: vi.fn(),
  loadSignupProfile: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: h.doc,
  updateDoc: h.updateDoc,
  getDoc: h.getDoc,
  serverTimestamp: h.serverTimestamp,
}));
vi.mock('@/data/firebase', () => ({ getFirebase: h.getFirebase }));
vi.mock('@/data/callables', () => ({ callFn: h.callFn }));
vi.mock('@/data/op-log', () => ({ writeOpLog: h.writeOpLog }));
vi.mock('@/ui/Toast', () => ({ toast: { show: h.toastShow } }));
vi.mock('./signup-profile', () => ({ loadSignupProfile: h.loadSignupProfile }));

import {
  bindLineNotify,
  buildLineNotifyPayload,
  dismissLineNotifyPrompt,
  formatBoundAt,
  shouldShowLineNotifyPrompt,
} from './line-notify-bind';

beforeEach(() => {
  h.updateDoc.mockReset().mockResolvedValue(undefined);
  h.getDoc
    .mockReset()
    .mockResolvedValue({ exists: () => true, data: () => ({ line_binding: 5 }) });
  h.doc.mockReset().mockImplementation((_db: unknown, col: string, id: string) => ({
    _col: col,
    _id: id,
  }));
  h.serverTimestamp.mockReset().mockReturnValue('SERVER_TIMESTAMP');
  h.getFirebase
    .mockReset()
    .mockImplementation(() => Promise.resolve({ db: { fake: true } }));
  h.callFn.mockReset().mockResolvedValue({});
  h.writeOpLog.mockReset().mockResolvedValue(undefined);
  h.toastShow.mockReset();
  h.loadSignupProfile.mockReset().mockResolvedValue({ lineNotifyBound: false });
  vi.spyOn(window, 'open').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('formatBoundAt（照 A `_completeLineBinding` 的 boundAt）', () => {
  it('輸出 YYYY/MM/DD，月日補零', () => {
    expect(formatBoundAt(new Date(Date.parse('2024-01-04T16:00:00Z')))).toBe('2024/01/05');
    expect(formatBoundAt(new Date(Date.parse('2024-12-30T16:00:00Z')))).toBe('2024/12/31');
    expect(formatBoundAt(new Date(Date.parse('2000-07-08T16:00:00Z')))).toBe('2000/07/09');
  });

  it('台北日界：16:30Z 與 15:59Z 為 10/19，16:00Z 為 10/20', () => {
    expect(formatBoundAt(new Date(Date.parse('2026-10-18T16:30:00Z')))).toBe('2026/10/19');
    expect(formatBoundAt(new Date(Date.parse('2026-10-19T15:59:00Z')))).toBe('2026/10/19');
    expect(formatBoundAt(new Date(Date.parse('2026-10-19T16:00:00Z')))).toBe('2026/10/20');
  });
});

describe('buildLineNotifyPayload（照 A `_completeLineBinding` 的 lineNotify）', () => {
  it('逐欄等於 A：bound / boundAt / settings', () => {
    const payload = buildLineNotifyPayload(new Date(Date.parse('2024-06-14T16:00:00Z')));
    expect(payload).toEqual({
      lineNotify: {
        bound: true,
        boundAt: '2024/06/15',
        settings: { activity: true, system: true, tournament: false },
      },
    });
  });

  it('未給日期時使用今天', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.parse('2026-10-19T15:59:00Z')));
    try {
      expect(buildLineNotifyPayload().lineNotify.boundAt).toBe('2026/10/19');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('bindLineNotify（照 A bindLineNotify + _completeLineBinding + _reconcileLineBindingExp）', () => {
  it('uid 空字串時丟錯', async () => {
    await expect(bindLineNotify('')).rejects.toThrow(/uid is required/);
    expect(window.open).not.toHaveBeenCalled();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('uid 全空白時也丟錯', async () => {
    await expect(bindLineNotify('   ')).rejects.toThrow(/uid is required/);
  });

  it('開 LINE 加好友頁（https://line.me/R/ti/p/@830utvza）', async () => {
    await bindLineNotify('U1');
    expect(window.open).toHaveBeenCalledWith(
      'https://line.me/R/ti/p/@830utvza',
      'sporthub_line',
    );
  });

  it('寫 users/{uid}，payload 逐欄同 A：lineNotify + updatedAt: serverTimestamp()', async () => {
    vi.useFakeTimers();
    try {
      await bindLineNotify('U1');

      expect(h.updateDoc).toHaveBeenCalledTimes(1);
      const call = h.updateDoc.mock.calls[0];
      expect(call).toBeDefined();
      const docRef = call?.[0] as { _col: string; _id: string };
      const payload = call?.[1];
      expect(docRef._col).toBe('users');
      expect(docRef._id).toBe('U1');
      expect(payload).toEqual({
        lineNotify: {
          bound: true,
          boundAt: expect.stringMatching(/^\d{4}\/\d{2}\/\d{2}$/),
          settings: { activity: true, system: true, tournament: false },
        },
        updatedAt: 'SERVER_TIMESTAMP',
      });
      vi.advanceTimersByTime(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('讀 siteConfig/autoExpRules.line_binding > 0 才呼叫 adjustExp，參數逐欄同 A', async () => {
    vi.useFakeTimers();
    try {
      await bindLineNotify('U1', 'Alice');

      // getDoc 對 siteConfig/autoExpRules
      expect(h.getDoc).toHaveBeenCalledTimes(1);
      const call = h.getDoc.mock.calls[0];
      expect(call).toBeDefined();
      const siteRef = call?.[0] as { _col: string; _id: string };
      expect(siteRef._col).toBe('siteConfig');
      expect(siteRef._id).toBe('autoExpRules');

      // callFn('adjustExp', {...}) 逐欄對 A `adjustUserExp` + `_reconcileLineBindingExp`
      expect(h.callFn).toHaveBeenCalledTimes(1);
      const cf = h.callFn.mock.calls[0];
      expect(cf?.[0]).toBe('adjustExp');
      expect(cf?.[1]).toEqual({
        mode: 'auto',
        targets: ['U1'],
        amount: 5,
        reason: '自動：綁定 LINE 推播',
        operatorLabel: '系統',
        requestId: 'autoexp_U1_line_binding',
        ruleKey: 'line_binding',
      });
      vi.advanceTimersByTime(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('寫 opLog：type=exp / typeName=自動EXP / content / actorUid / operator', async () => {
    vi.useFakeTimers();
    try {
      await bindLineNotify('U1', 'Alice');
      expect(h.writeOpLog).toHaveBeenCalledTimes(1);
      const arg = h.writeOpLog.mock.calls[0]?.[0];
      expect(arg).toEqual({
        type: 'exp',
        typeName: '自動EXP',
        content: 'Alice +5「自動：綁定 LINE 推播」',
        actorUid: 'U1',
        operator: 'Alice',
      });
      vi.advanceTimersByTime(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('displayName 空時 operator / content 以「系統」帶入', async () => {
    vi.useFakeTimers();
    try {
      await bindLineNotify('U1');
      const arg = h.writeOpLog.mock.calls[0]?.[0];
      expect(arg).toMatchObject({
        content: '系統 +5「自動：綁定 LINE 推播」',
        operator: '系統',
      });
      vi.advanceTimersByTime(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('line_binding 金額 0 → 不呼叫 adjustExp、不寫 opLog', async () => {
    h.getDoc.mockReset().mockResolvedValue({
      exists: () => true,
      data: () => ({ line_binding: 0 }),
    });
    vi.useFakeTimers();
    try {
      await bindLineNotify('U1');
      expect(h.callFn).not.toHaveBeenCalled();
      expect(h.writeOpLog).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('siteConfig 不存在 → 不呼叫 adjustExp', async () => {
    h.getDoc.mockReset().mockResolvedValue({ exists: () => false });
    vi.useFakeTimers();
    try {
      await bindLineNotify('U1');
      expect(h.callFn).not.toHaveBeenCalled();
      expect(h.writeOpLog).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('綁定寫入仍成功（即使 adjustExp 失敗只 warn，不阻擋）', async () => {
    h.callFn.mockReset().mockRejectedValue(new Error('CF down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      await expect(bindLineNotify('U1', 'Alice')).resolves.toBeUndefined();
      expect(h.updateDoc).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
    }
  });

  it('600ms 後才 toast「已啟用 LINE 通知，請確認已加入官方帳號好友」', async () => {
    vi.useFakeTimers();
    try {
      await bindLineNotify('U1');
      expect(h.toastShow).not.toHaveBeenCalled();
      vi.advanceTimersByTime(599);
      expect(h.toastShow).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(h.toastShow).toHaveBeenCalledTimes(1);
      expect(h.toastShow).toHaveBeenCalledWith({
        message: '已啟用 LINE 通知，請確認已加入官方帳號好友',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('shouldShowLineNotifyPrompt（照 A `_maybeShowLineNotifyPrompt`）', () => {
  it('localStorage 有 _dismissLineNotifyPrompt=1 → false，且不呼叫 loadSignupProfile', async () => {
    localStorage.setItem('_dismissLineNotifyPrompt', '1');
    expect(await shouldShowLineNotifyPrompt('U1')).toBe(false);
    expect(h.loadSignupProfile).not.toHaveBeenCalled();
  });

  it('已綁定 lineNotifyBound=true → false', async () => {
    h.loadSignupProfile.mockResolvedValue({ lineNotifyBound: true });
    expect(await shouldShowLineNotifyPrompt('U1')).toBe(false);
  });

  it('未綁定 + 未永久關閉 → true', async () => {
    h.loadSignupProfile.mockResolvedValue({ lineNotifyBound: false });
    expect(await shouldShowLineNotifyPrompt('U1')).toBe(true);
  });

  it('loadSignupProfile 失敗 → false（照 A 若取不到不顯示的保守行為）', async () => {
    h.loadSignupProfile.mockRejectedValue(new Error('boom'));
    expect(await shouldShowLineNotifyPrompt('U1')).toBe(false);
  });
});

describe('dismissLineNotifyPrompt', () => {
  it('寫 localStorage `_dismissLineNotifyPrompt=1`', () => {
    expect(localStorage.getItem('_dismissLineNotifyPrompt')).toBeNull();
    dismissLineNotifyPrompt();
    expect(localStorage.getItem('_dismissLineNotifyPrompt')).toBe('1');
  });

  it('localStorage.setItem 丟錯時不拋', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(() => dismissLineNotifyPrompt()).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
