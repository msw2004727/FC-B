/**
 * attendance.ts 測試。
 *
 * 目標：
 *  - decideScanAction：覆蓋 A `_processAttendance` 的每個分支。
 *  - buildAttendanceRecord / buildFamilyCheckinRecords：golden payload（欄位逐一對照 A）。
 *  - allowlist：拒絕多餘欄位與「操作者欄位」（R-STAT-002）。
 *  - 路徑：寫入走 docId（R-REG-014），eventId 欄位存 public id（R-ID-009）。
 */

import { describe, expect, it } from 'vitest';

import {
  ATTENDANCE_FIELD_ALLOWLIST,
  buildAttendanceRecord,
  buildFamilyCheckinRecords,
  decideScanAction,
  recordAttendance,
  shouldUseFamilyFlow,
  type AttendanceWritePayload,
  type DecideScanActionInput,
  type ScanAttendance,
  type ScanRegistration,
} from '../attendance';

const NOW = new Date(2026, 4, 9, 10, 30, 0); // 2026-05-09 10:30 本地時間
const FMT = (): string => '2026/05/09 10:30';

/** 每次呼叫回傳遞增 id，避免多筆記錄撞號。 */
function seqFactory(): () => string {
  let n = 0;
  return () => `att_test_${++n}`;
}

function baseInput(over: Partial<DecideScanActionInput> = {}): DecideScanActionInput {
  return {
    eventId: 'evt_pub_1',
    uid: 'user_A',
    userName: 'Alice',
    mode: 'checkin',
    event: {},
    registrations: [],
    attendance: [],
    now: NOW,
    formatTime: FMT,
    idFactory: seqFactory(),
    ...over,
  };
}

function confirmed(userId: string, userName = userId): ScanRegistration {
  return { userId, userName, status: 'confirmed' };
}

function attendance(
  type: 'checkin' | 'checkout' | 'unreg',
  over: Partial<ScanAttendance> = {},
): ScanAttendance {
  return { uid: 'user_A', type, ...over };
}

// ── decideScanAction：未報名分支 ─────────────────

describe('decideScanAction — 未報名', () => {
  it('未報名 + checkin + 尚未簽到：寫 unreg + checkin，warning', () => {
    const r = decideScanAction(baseInput({ mode: 'checkin' }));
    expect(r.action).toBe('checkin');
    expect(r.resultClass).toBe('warning');
    expect(r.reasonKey).toBe('unregistered.checkin.success');
    expect(r.records.map((x) => x.type)).toEqual(['unreg', 'checkin']);
    for (const x of r.records) {
      expect(x.uid).toBe('user_A'); // 被簽到者（R-ID-003）
      expect(x.eventId).toBe('evt_pub_1'); // public id（R-ID-009）
      expect(x).not.toHaveProperty('operatorUid');
    }
  });

  it('未報名 + checkin + 已簽到：action=reject；僅寫 unreg（若尚未寫過）', () => {
    const r = decideScanAction(baseInput({
      mode: 'checkin',
      attendance: [attendance('checkin')],
    }));
    expect(r.action).toBe('reject');
    expect(r.reasonKey).toBe('unregistered.checkin.already');
    expect(r.records.map((x) => x.type)).toEqual(['unreg']);
  });

  it('未報名 + checkin + 已簽到 + 已有 unreg：不寫任何記錄', () => {
    const r = decideScanAction(baseInput({
      mode: 'checkin',
      attendance: [attendance('unreg'), attendance('checkin')],
    }));
    expect(r.action).toBe('reject');
    expect(r.records).toHaveLength(0);
  });

  it('未報名 + checkout + 尚未簽到：unreg + checkin + checkout，warning', () => {
    const r = decideScanAction(baseInput({ mode: 'checkout' }));
    expect(r.action).toBe('checkout');
    expect(r.reasonKey).toBe('unregistered.auto_full');
    expect(r.records.map((x) => x.type)).toEqual(['unreg', 'checkin', 'checkout']);
  });

  it('未報名 + checkout + 已簽到、未簽退：只寫 checkout（既有 unreg 不重寫）', () => {
    const r = decideScanAction(baseInput({
      mode: 'checkout',
      attendance: [attendance('unreg'), attendance('checkin')],
    }));
    expect(r.action).toBe('checkout');
    expect(r.reasonKey).toBe('unregistered.checkout.success');
    expect(r.records.map((x) => x.type)).toEqual(['checkout']);
  });

  it('未報名 + checkout + 已簽退：reject', () => {
    const r = decideScanAction(baseInput({
      mode: 'checkout',
      attendance: [attendance('unreg'), attendance('checkin'), attendance('checkout')],
    }));
    expect(r.action).toBe('reject');
    expect(r.reasonKey).toBe('unregistered.checkout.already');
    expect(r.records).toHaveLength(0);
  });

  it('participants 包含 userName 視為已報名（A 的 fallback）', () => {
    const r = decideScanAction(baseInput({
      mode: 'checkin',
      event: { participants: ['Alice'] },
    }));
    expect(r.reasonKey).toBe('checkin.success');
  });
});

// ── decideScanAction：已報名分支 ─────────────────

describe('decideScanAction — 已報名', () => {
  it('已報名 + checkin + 未簽到：寫 checkin，success', () => {
    const r = decideScanAction(baseInput({
      mode: 'checkin',
      registrations: [confirmed('user_A', 'Alice')],
    }));
    expect(r.action).toBe('checkin');
    expect(r.resultClass).toBe('success');
    expect(r.reasonKey).toBe('checkin.success');
    expect(r.records.map((x) => x.type)).toEqual(['checkin']);
  });

  it('已報名 + checkin + 已簽到：reject', () => {
    const r = decideScanAction(baseInput({
      mode: 'checkin',
      registrations: [confirmed('user_A', 'Alice')],
      attendance: [attendance('checkin')],
    }));
    expect(r.action).toBe('reject');
    expect(r.reasonKey).toBe('checkin.already');
    expect(r.records).toHaveLength(0);
  });

  it('已報名 + checkout + 未簽到、未簽退：auto_full，寫 checkin + checkout', () => {
    const r = decideScanAction(baseInput({
      mode: 'checkout',
      registrations: [confirmed('user_A', 'Alice')],
    }));
    expect(r.action).toBe('checkout');
    expect(r.resultClass).toBe('success');
    expect(r.reasonKey).toBe('checkout.auto_full');
    expect(r.records.map((x) => x.type)).toEqual(['checkin', 'checkout']);
  });

  it('已報名 + checkout + 已簽到、未簽退：只寫 checkout', () => {
    const r = decideScanAction(baseInput({
      mode: 'checkout',
      registrations: [confirmed('user_A', 'Alice')],
      attendance: [attendance('checkin')],
    }));
    expect(r.action).toBe('checkout');
    expect(r.reasonKey).toBe('checkout.success');
    expect(r.records.map((x) => x.type)).toEqual(['checkout']);
  });

  it('已報名 + checkout + 已簽退：reject', () => {
    const r = decideScanAction(baseInput({
      mode: 'checkout',
      registrations: [confirmed('user_A', 'Alice')],
      attendance: [attendance('checkin'), attendance('checkout')],
    }));
    expect(r.action).toBe('reject');
    expect(r.reasonKey).toBe('checkout.already');
    expect(r.records).toHaveLength(0);
  });

  it('已報名 + 未報名 user 的記錄（status=pending）不算已報名', () => {
    const r = decideScanAction(baseInput({
      mode: 'checkin',
      registrations: [{ userId: 'user_A', userName: 'Alice', status: 'pending' }],
    }));
    expect(r.reasonKey).toBe('unregistered.checkin.success');
  });

  it('已簽到記錄 status=removed 不再視為已簽到（可重新簽到）', () => {
    const r = decideScanAction(baseInput({
      mode: 'checkin',
      registrations: [confirmed('user_A', 'Alice')],
      attendance: [{ uid: 'user_A', type: 'checkin', status: 'removed' }],
    }));
    expect(r.action).toBe('checkin');
    expect(r.reasonKey).toBe('checkin.success');
  });
});

// ── shouldUseFamilyFlow ──────────────────────────

describe('shouldUseFamilyFlow', () => {
  it('多筆 confirmed → family', () => {
    expect(shouldUseFamilyFlow(
      [confirmed('user_A'), confirmed('user_A'), confirmed('user_A')],
      'user_A',
    )).toBe(true);
  });

  it('唯一一筆 companionId → family', () => {
    expect(shouldUseFamilyFlow(
      [{ userId: 'user_A', status: 'confirmed', companionId: 'c1' }],
      'user_A',
    )).toBe(true);
  });

  it('唯一一筆無 companionId → 普通流程', () => {
    expect(shouldUseFamilyFlow(
      [{ userId: 'user_A', status: 'confirmed', companionId: null }],
      'user_A',
    )).toBe(false);
  });
});

// ── buildAttendanceRecord：golden payloads ───────

describe('buildAttendanceRecord — golden payload', () => {
  it('非家庭（A _processAttendance 主路徑）', () => {
    // A 來源：
    //   _addRecord({ id, eventId, uid, userName, type, time })
    const rec = buildAttendanceRecord({
      eventId: 'evt_pub_1',
      uid: 'user_A',
      userName: 'Alice',
      type: 'checkin',
      now: NOW,
      idFactory: () => 'att_fixed_1',
      formatTime: FMT,
    });
    expect(rec).toEqual<AttendanceWritePayload>({
      id: 'att_fixed_1',
      eventId: 'evt_pub_1',
      uid: 'user_A',
      userName: 'Alice',
      type: 'checkin',
      time: '2026/05/09 10:30',
    });
  });

  it('家庭代簽 — 本人（companionId=null）', () => {
    // A 來源（_confirmFamilyCheckin）：
    //   participantType: cId ? 'companion' : 'self'
    //   companionId: cId || null
    //   companionName: cId ? displayName : null
    const rec = buildAttendanceRecord({
      eventId: 'evt_pub_1',
      uid: 'user_A',
      userName: 'Alice',
      type: 'checkin',
      now: NOW,
      companion: { companionId: null, companionName: null },
      idFactory: () => 'att_fixed_2',
      formatTime: FMT,
    });
    expect(rec).toEqual<AttendanceWritePayload>({
      id: 'att_fixed_2',
      eventId: 'evt_pub_1',
      uid: 'user_A',
      userName: 'Alice',
      type: 'checkin',
      time: '2026/05/09 10:30',
      participantType: 'self',
      companionId: null,
      companionName: null,
    });
  });

  it('家庭代簽 — 同行者（companionId 有值）', () => {
    const rec = buildAttendanceRecord({
      eventId: 'evt_pub_1',
      uid: 'user_A',
      userName: 'Alice',
      type: 'checkout',
      now: NOW,
      companion: { companionId: 'c_1', companionName: 'Bob' },
      idFactory: () => 'att_fixed_3',
      formatTime: FMT,
    });
    expect(rec).toEqual<AttendanceWritePayload>({
      id: 'att_fixed_3',
      eventId: 'evt_pub_1',
      uid: 'user_A',
      userName: 'Alice',
      type: 'checkout',
      time: '2026/05/09 10:30',
      participantType: 'companion',
      companionId: 'c_1',
      companionName: 'Bob',
    });
  });
});

// ── buildFamilyCheckinRecords：golden ────────────

describe('buildFamilyCheckinRecords — golden payload', () => {
  it('checkout 對「本人＋同行者」：本人未簽到會自動補 checkin', () => {
    const records = buildFamilyCheckinRecords({
      eventId: 'evt_pub_1',
      uid: 'user_A',
      userName: 'Alice',
      mode: 'checkout',
      members: [
        { companionId: null, companionName: null },
        { companionId: 'c_1', companionName: 'Bob' },
      ],
      attendance: [],
      now: NOW,
      idFactory: seqFactory(),
      formatTime: FMT,
    });

    // 對照 A `_confirmFamilyCheckin`：每位成員 type 依序 checkin(+checkout)
    expect(records.map((r) => ({
      uid: r.uid,
      eventId: r.eventId,
      userName: r.userName,
      type: r.type,
      participantType: r.participantType,
      companionId: r.companionId,
      companionName: r.companionName,
      time: r.time,
    }))).toEqual([
      {
        uid: 'user_A', eventId: 'evt_pub_1', userName: 'Alice',
        type: 'checkin', participantType: 'self',
        companionId: null, companionName: null,
        time: '2026/05/09 10:30',
      },
      {
        uid: 'user_A', eventId: 'evt_pub_1', userName: 'Alice',
        type: 'checkout', participantType: 'self',
        companionId: null, companionName: null,
        time: '2026/05/09 10:30',
      },
      {
        uid: 'user_A', eventId: 'evt_pub_1', userName: 'Alice',
        type: 'checkin', participantType: 'companion',
        companionId: 'c_1', companionName: 'Bob',
        time: '2026/05/09 10:30',
      },
      {
        uid: 'user_A', eventId: 'evt_pub_1', userName: 'Alice',
        type: 'checkout', participantType: 'companion',
        companionId: 'c_1', companionName: 'Bob',
        time: '2026/05/09 10:30',
      },
    ]);

    for (const r of records) {
      expect(r.uid).toBe('user_A'); // 被簽到者（R-ID-003）
      expect(r.eventId).toBe('evt_pub_1'); // public id（R-ID-009）
      expect(r).not.toHaveProperty('operatorUid');
    }
  });

  it('已簽到的成員在 checkin 模式會被跳過', () => {
    const records = buildFamilyCheckinRecords({
      eventId: 'evt_pub_1',
      uid: 'user_A',
      userName: 'Alice',
      mode: 'checkin',
      members: [
        { companionId: null, companionName: null },
        { companionId: 'c_1', companionName: 'Bob' },
      ],
      attendance: [
        { uid: 'user_A', type: 'checkin', companionId: null },
      ],
      now: NOW,
      idFactory: seqFactory(),
      formatTime: FMT,
    });

    expect(records.map((r) => ({ type: r.type, companionId: r.companionId }))).toEqual([
      { type: 'checkin', companionId: 'c_1' },
    ]);
  });
});

// ── allowlist：拒絕多餘欄位與操作者欄位 ──────────

describe('ATTENDANCE_FIELD_ALLOWLIST / recordAttendance', () => {
  it('allowlist 不含任何「操作者」欄位（R-STAT-002）', () => {
    for (const key of ['operatorUid', 'actorUid', 'createdByUid', 'signedByUid']) {
      expect((ATTENDANCE_FIELD_ALLOWLIST as readonly string[]).includes(key)).toBe(false);
    }
  });

  it('recordAttendance 拒絕多餘欄位（sync throw，Promise rejected）', async () => {
    const bad = {
      id: 'att_x',
      eventId: 'evt_pub_1',
      uid: 'user_A',
      userName: 'Alice',
      type: 'checkin' as const,
      time: '2026/05/09 10:30',
      operatorUid: 'attacker', // 不在 allowlist
    } as unknown as AttendanceWritePayload;

    await expect(recordAttendance('docId_1', bad)).rejects.toThrow(/operatorUid/);
  });

  it('recordAttendance 需要 eventDocId（R-REG-014）', async () => {
    await expect(recordAttendance('', {
      id: 'att_x', eventId: 'evt_pub_1', uid: 'user_A', userName: 'Alice',
      type: 'checkin', time: '',
    })).rejects.toThrow(/eventDocId/);
  });
});
