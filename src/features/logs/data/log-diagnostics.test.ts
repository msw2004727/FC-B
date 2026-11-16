import { describe, expect, it } from 'vitest';

import {
  buildAuditDiagnostic,
  buildErrorDiagnostic,
  buildErrorGroupDiagnostic,
} from './log-diagnostics';
import type { AuditEntry } from './audit-log-model';
import type { ErrorGroup, ErrorLogDoc } from './error-log-model';

const TAIPEI_MS = Date.parse('2026-11-19T04:00:00Z');

describe('buildErrorDiagnostic - 一般錯誤', () => {
  it('欄位標題順序與台北時間格式', () => {
    const log: ErrorLogDoc = {
      uid: 'U1111aaaa0000000000000000000000aa',
      userName: '小明',
      errorCode: 'permission-denied',
      errorMessage: 'Missing or insufficient permissions.',
      errorStack: 'stack line 1',
      page: 'user',
      context: { fn: 'openThing' },
      appVersion: '1.0.0',
      url: 'https://x/y',
      userAgent: 'Mozilla/5.0 (iPhone) Line/13',
      createdAt: { seconds: Math.floor(TAIPEI_MS / 1000) },
      _docId: 'doc-1',
    };

    const lines = buildErrorDiagnostic(log).split('\n');

    expect(lines[0]).toBe('ToosterX 錯誤診斷包');
    expect(lines[1]).toBe('時間：2026/11/19 12:00');
    expect(lines[2]).toMatch(/^嚴重度：/);
    expect(lines[2]).toBe('嚴重度：嚴重');
    expect(lines[3]).toMatch(/^白話錯誤：/);
    expect(lines[4]).toMatch(/^錯誤類型：權限不足 \(permission-denied\)$/);
    expect(lines[5]).toMatch(/^用戶：小明 \/ U1111/);
    expect(lines[6]).toBe('頁面/功能：user / openThing');
    expect(lines[7]).toBe('版本/裝置：1.0.0 / iOS · LINE');
    expect(lines[8]).toBe('URL：https://x/y');
    expect(lines[9]).toMatch(/^Context：fn=openThing|Context：openThing/);
    expect(lines[10]).toMatch(/^原始錯誤：/);
    expect(lines[11]).toMatch(/^Stack：/);
    expect(lines[12]).toBe('文件 ID：doc-1');
  });
});

describe('buildErrorDiagnostic - 用戶提示', () => {
  it('標題、來源、分類、內容與欄位順序', () => {
    const log: ErrorLogDoc = {
      uid: 'U2222',
      userName: '小華',
      errorCode: 'user-prompt',
      errorMessage: 'session expired',
      context: {
        logType: 'user_prompt',
        surface: 'toast',
        promptKey: 'session_expired',
        promptMessage: '請重新登入',
        fn: 'h',
      },
      page: 'user',
      createdAt: { seconds: Math.floor(TAIPEI_MS / 1000) },
      _docId: 'doc-2',
    };

    const lines = buildErrorDiagnostic(log).split('\n');

    expect(lines[0]).toBe('ToosterX 用戶提示診斷包');
    expect(lines[1]).toBe('時間：2026/11/19 12:00');
    expect(lines[2]).toBe('提示來源：提示訊息');
    expect(lines[3]).toBe('提示分類：登入過期／不同步');
    expect(lines[4]).toBe('提示內容：請重新登入');
    expect(lines[5]).toMatch(/^用戶：/);
    expect(lines[6]).toMatch(/^頁面\/功能：/);
    expect(lines[7]).toMatch(/^版本\/裝置：/);
    expect(lines[8]).toMatch(/^URL：/);
    expect(lines[9]).toMatch(/^Context：/);
    expect(lines[10]).toBe('原始訊息：session expired');
    expect(lines[11]).toBe('文件 ID：doc-2');
  });
});

describe('buildErrorGroupDiagnostic', () => {
  it('含筆數、受影響用戶數並附第一筆單筆診斷', () => {
    const first: ErrorLogDoc = {
      uid: 'U1',
      userName: '小明',
      errorCode: 'permission-denied',
      errorMessage: 'x',
      page: 'p',
      createdAt: { seconds: 100 },
      _docId: 'd1',
    };
    const second: ErrorLogDoc = { ...first, uid: 'U2', _docId: 'd2', createdAt: { seconds: 200 } };

    const group: ErrorGroup = {
      key: 'k',
      severity: 'critical',
      label: '權限不足',
      message: '權限不足的訊息',
      page: 'p',
      where: '',
      logs: [first, second],
      users: 2,
      lastMs: 200000,
    };

    const text = buildErrorGroupDiagnostic(group);
    const lines = text.split('\n');

    expect(lines[0]).toBe('ToosterX 同類錯誤診斷包');
    expect(lines[1]).toBe('筆數：2');
    expect(lines[6]).toBe('受影響用戶數：2');
    expect(text).toContain('ToosterX 錯誤診斷包');
  });
});

describe('buildAuditDiagnostic', () => {
  it('Meta 以原始 key=value 呈現，不是中文鍵名', () => {
    const entry: AuditEntry = {
      _docId: 'a1',
      action: 'login_success',
      actorUid: 'U1',
      actorName: '',
      result: 'success',
      source: 'web',
      targetType: 'user',
      targetId: 'U2',
      targetLabel: '小明',
      meta: { reason: 'why', ip: '1.1.1.1' },
      createdAtMs: TAIPEI_MS,
    };

    const text = buildAuditDiagnostic(entry, '小明');

    expect(text).toContain('ToosterX 稽核日誌診斷包');
    expect(text).toContain('時間：2026/11/19 12:00');
    expect(text).toContain('結果：成功 (success)');
    expect(text).toContain('動作：登入成功 (login_success)');
    expect(text).toContain('操作者：小明 / U1');
    expect(text).toContain('目標：用戶：小明');
    expect(text).toContain('來源：網頁 (web)');
    expect(text).toContain('Meta：reason=why · ip=1.1.1.1');
    expect(text).not.toContain('原因=why');
    expect(text).toContain('文件 ID：a1');
  });
});
