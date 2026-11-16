import { describe, expect, it } from 'vitest';

import {
  chineseMessage,
  codeLabel,
  deviceLabel,
  displayCode,
  errorWhere,
  groupErrors,
  isUserPrompt,
  severityOf,
  type ErrorLogDoc,
} from './error-log-model';

describe('isUserPrompt', () => {
  it('errorCode 為 user-prompt', () => {
    expect(isUserPrompt({ errorCode: 'user-prompt' })).toBe(true);
  });

  it('errorCode 為 client-prompt', () => {
    expect(isUserPrompt({ errorCode: 'client-prompt' })).toBe(true);
  });

  it('Functions 前綴也被視為同一代碼', () => {
    expect(isUserPrompt({ errorCode: 'functions/user-prompt' })).toBe(true);
  });

  it('context 為物件且 logType 為 user_prompt', () => {
    expect(isUserPrompt({ context: { logType: 'user_prompt' } })).toBe(true);
  });

  it('context 為字串且 logType 為 user_prompt', () => {
    expect(isUserPrompt({ context: '{"logType":"user_prompt"}' })).toBe(true);
  });

  it('context 為物件且 type 為 user-prompt', () => {
    expect(isUserPrompt({ context: { type: 'user-prompt' } })).toBe(true);
  });

  it('無關的錯誤不算用戶提示', () => {
    expect(isUserPrompt({ errorCode: 'permission-denied' })).toBe(false);
  });
});

describe('severityOf', () => {
  it('indexeddb transient 回 info', () => {
    expect(severityOf({ errorCode: 'firestore-indexeddb-transient' })).toBe('info');
  });

  it('用戶提示回 prompt', () => {
    expect(severityOf({ errorCode: 'user-prompt' })).toBe('prompt');
  });

  it('PROFILE_INCOMPLETE 回 info', () => {
    expect(severityOf({ errorCode: 'profile_incomplete' })).toBe('info');
  });

  it('permission-denied 回 critical', () => {
    expect(severityOf({ errorCode: 'permission-denied' })).toBe('critical');
  });

  it('訊息含 failed to fetch 回 warn', () => {
    expect(severityOf({ errorMessage: 'Failed to fetch' })).toBe('warn');
  });

  it('無法辨識時回 info', () => {
    expect(severityOf({ errorCode: 'something', errorMessage: 'plain' })).toBe('info');
  });
});

describe('codeLabel 與 displayCode', () => {
  it('用戶提示代碼', () => {
    const log: ErrorLogDoc = { errorCode: 'user-prompt' };
    expect(codeLabel(log)).toBe('用戶提示');
    expect(displayCode(log)).toBe('USER_PROMPT');
  });

  it('PROFILE_INCOMPLETE', () => {
    const log: ErrorLogDoc = { errorCode: 'profile_incomplete' };
    expect(codeLabel(log)).toBe('個人資料未補齊');
    expect(displayCode(log)).toBe('PROFILE_INCOMPLETE');
  });

  it('permission-denied', () => {
    const log: ErrorLogDoc = { errorCode: 'permission-denied' };
    expect(codeLabel(log)).toBe('權限不足');
    expect(displayCode(log)).toBe('permission-denied');
  });

  it('空代碼回「未分類」與空字串', () => {
    const log: ErrorLogDoc = {};
    expect(codeLabel(log)).toBe('未分類');
    expect(displayCode(log)).toBe('');
  });
});

describe('chineseMessage', () => {
  it('代碼對照', () => {
    expect(chineseMessage({ errorCode: 'permission-denied' })).toContain('權限不足');
    expect(chineseMessage({ errorCode: 'unauthenticated' })).toContain('登入');
  });

  it('訊息正則（權限）對應到中文白話', () => {
    expect(chineseMessage({ errorMessage: 'Missing or insufficient permissions.' })).toContain('權限不足');
  });

  it('訊息含中文原文直接回傳', () => {
    expect(chineseMessage({ errorMessage: '請重新登入' })).toBe('請重新登入');
  });

  it('無法辨識時回預設句', () => {
    expect(chineseMessage({ errorMessage: 'weird thing happened' })).toBe(
      '系統發生錯誤，請稍後再試；管理員可展開詳細紀錄追查原因。',
    );
  });
});

describe('deviceLabel', () => {
  it('iPhone 與 LINE UA 顯示「iOS · LINE」', () => {
    expect(deviceLabel({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Line/13' })).toBe('iOS · LINE');
  });

  it('Android Chrome UA 顯示「Android · Chrome」', () => {
    expect(
      deviceLabel({ userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/120 Mobile' }),
    ).toBe('Android · Chrome');
  });

  it('osName 欄位優先於 UA', () => {
    expect(deviceLabel({ osName: 'Windows', browserName: 'Edge', userAgent: 'iPhone Line' })).toBe(
      'Windows · Edge',
    );
  });

  it('只有 osName', () => {
    expect(deviceLabel({ osName: 'iOS' })).toBe('iOS');
  });

  it('只有 browserName', () => {
    expect(deviceLabel({ browserName: 'Safari' })).toBe('其他 · Safari');
  });
});

describe('errorWhere', () => {
  it('context.fn 優先回傳', () => {
    expect(errorWhere({ context: { fn: 'myFn' } })).toBe('myFn');
  });

  it('長字串截 80 字並加省略號', () => {
    const out = errorWhere({ context: 'a'.repeat(100) });
    expect(out).toBe('a'.repeat(80) + '…');
  });

  it('短字串原樣回傳', () => {
    expect(errorWhere({ context: 'hi' })).toBe('hi');
  });

  it('無 context 回空字串', () => {
    expect(errorWhere({})).toBe('');
  });
});

describe('groupErrors', () => {
  it('同鍵合併並保留 users 去重', () => {
    const base = { page: 'p1', errorCode: 'permission-denied', errorMessage: 'x' };
    const a: ErrorLogDoc = { ...base, uid: 'U1', createdAt: { seconds: 10 } };
    const b: ErrorLogDoc = { ...base, uid: 'U1', createdAt: { seconds: 20 } };
    const c: ErrorLogDoc = { ...base, uid: 'U2', createdAt: { seconds: 30 } };

    const groups = groupErrors([a, b, c]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.logs).toHaveLength(3);
    expect(groups[0]!.users).toBe(2);
  });

  it('次數多者排前面', () => {
    const a: ErrorLogDoc = { uid: 'A', page: 'pa', errorCode: 'permission-denied' };
    const b1: ErrorLogDoc = { uid: 'B1', page: 'pb', errorCode: 'permission-denied' };
    const b2: ErrorLogDoc = { uid: 'B2', page: 'pb', errorCode: 'permission-denied' };

    const groups = groupErrors([a, b1, b2]);

    expect(groups[0]!.page).toBe('pb');
    expect(groups[0]!.logs).toHaveLength(2);
    expect(groups[1]!.page).toBe('pa');
  });

  it('同次數時最近時間先', () => {
    const older: ErrorLogDoc = {
      uid: 'U1',
      page: 'pa',
      errorCode: 'permission-denied',
      createdAt: { seconds: 10 },
    };
    const newer: ErrorLogDoc = {
      uid: 'U2',
      page: 'pb',
      errorCode: 'permission-denied',
      createdAt: { seconds: 30 },
    };

    const groups = groupErrors([older, newer]);

    expect(groups).toHaveLength(2);
    expect(groups[0]!.page).toBe('pb');
    expect(groups[1]!.page).toBe('pa');
  });
});
