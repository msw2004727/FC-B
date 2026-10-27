import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockWriteBatch,
  mockBatchSet,
  mockBatchUpdate,
  mockBatchCommit,
  mockCollection,
  mockDoc,
  mockServerTimestamp,
} = vi.hoisted(() => {
  const set = vi.fn();
  const update = vi.fn();
  const commit = vi.fn(() => Promise.resolve());
  let autoIdSeq = 0;
  return {
    mockBatchSet: set,
    mockBatchUpdate: update,
    mockBatchCommit: commit,
    mockWriteBatch: vi.fn(() => ({
      set,
      update,
      commit,
    })),
    mockCollection: vi.fn((_db: unknown, path: string) => ({ __type: 'collection', path })),
    mockDoc: vi.fn((first: unknown, second?: string, third?: string) => {
      if (second === undefined) {
        autoIdSeq += 1;
        const coll = first as { path: string };
        return { id: `auto_doc_${autoIdSeq}`, path: `${coll.path}/auto_doc_${autoIdSeq}` };
      }
      if (third !== undefined) {
        return { id: third, path: `${second}/${third}` };
      }
      return { id: second, path: String(second) };
    }),
    mockServerTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  };
});

vi.mock('firebase/firestore', () => ({
  writeBatch: mockWriteBatch,
  collection: mockCollection,
  doc: mockDoc,
  serverTimestamp: mockServerTimestamp,
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(() => Promise.resolve({ db: { __mockDb: true } })),
}));

import {
  buildAttendanceBaseRecord,
  collectAttendanceOps,
  formatAttendanceDateTime,
  normalizeAttendanceSelection,
  writeAttendanceOps,
  type AttendanceBaseRecord,
} from './attendance-edit';
import type { RosterAttendanceRecordInput, RosterRegistrationInput } from './attendance-roster-model';

describe('normalizeAttendanceSelection', () => {
  it('勾選 checkout 時強制連帶勾選 checkin', () => {
    expect(
      normalizeAttendanceSelection({ checkin: false, checkout: true, note: '遲到' }),
    ).toEqual({
      checkin: true,
      checkout: true,
      note: '遲到',
    });
  });

  it('處理空值與非字串備註', () => {
    expect(normalizeAttendanceSelection(null)).toEqual({
      checkin: false,
      checkout: false,
      note: '',
    });
  });
});

describe('buildAttendanceBaseRecord', () => {
  const selfBase = buildAttendanceBaseRecord('ce_pub_1', {
    uid: 'u_alice',
    name: 'Alice',
    isCompanion: false,
  });

  it('本人報名回傳 participantType=self baseRecord', () => {
    expect(selfBase).toEqual({
      ok: true,
      record: {
        eventId: 'ce_pub_1',
        uid: 'u_alice',
        userName: 'Alice',
        participantType: 'self',
        companionId: null,
        companionName: null,
      },
    });
  });

  it('同行者能依 companionId 找到報名並回傳主報名者 uid 與 companion 資訊', () => {
    const regs: RosterRegistrationInput[] = [
      {
        _docId: 'reg_c1',
        userId: 'u_host',
        userName: 'HostUser',
        status: 'confirmed',
        participantType: 'companion',
        companionId: 'comp_kid1',
        companionName: 'Kid One',
      },
    ];
    const res = buildAttendanceBaseRecord(
      'ce_pub_1',
      { uid: 'comp_kid1', name: 'Kid One', isCompanion: true, ownerUid: 'u_host' },
      regs,
    );
    expect(res).toEqual({
      ok: true,
      record: {
        eventId: 'ce_pub_1',
        uid: 'u_host',
        userName: 'HostUser',
        participantType: 'companion',
        companionId: 'comp_kid1',
        companionName: 'Kid One',
      },
    });
  });

  it('找不到同行者報名時回傳 companion_registration_missing 錯誤', () => {
    const res = buildAttendanceBaseRecord(
      'ce_pub_1',
      { uid: 'comp_missing', name: 'Ghost', isCompanion: true },
      [],
    );
    expect(res).toEqual({
      ok: false,
      reason: 'companion_registration_missing',
      personUid: 'comp_missing',
      personName: 'Ghost',
    });
  });

  it('R-ID-002：不以純名字比對同行者報名', () => {
    const regs: RosterRegistrationInput[] = [
      {
        _docId: 'reg_c2',
        userId: 'u_host',
        userName: 'HostUser',
        status: 'confirmed',
        participantType: 'companion',
        companionId: 'comp_other_id',
        companionName: 'SameName',
      },
    ];
    const res = buildAttendanceBaseRecord(
      'ce_pub_1',
      { uid: 'unrelated_uid', name: 'SameName', isCompanion: true, ownerUid: 'u_host' },
      regs,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('companion_registration_missing');
    }
  });
});

describe('collectAttendanceOps', () => {
  const baseRecord: AttendanceBaseRecord = {
    eventId: 'ce_pub_1',
    uid: 'u_alice',
    userName: 'Alice',
    participantType: 'self',
    companionId: null,
    companionName: null,
  };
  const person = { uid: 'u_alice', name: 'Alice', isCompanion: false };
  const timeStr = '2026/05/01 19:30';
  const fixedRand = () => 'abcd';

  it('無變更時回傳空陣列與 grantExp=false', () => {
    const existing: RosterAttendanceRecordInput[] = [
      { _docId: 'd1', id: 'att_1', uid: 'u_alice', type: 'checkin', status: 'active' },
      { _docId: 'd2', id: 'att_note_1', uid: 'u_alice', type: 'note', note: '準時', status: 'active' },
    ];
    const counter = { v: 100 };
    const ops = collectAttendanceOps(
      person,
      { checkin: true, checkout: false, note: '準時' },
      existing,
      'ce_pub_1',
      timeStr,
      baseRecord,
      counter,
      fixedRand,
    );
    expect(ops).toEqual({ adds: [], removes: [], grantExp: false });
    expect(counter.v).toBe(100);
  });

  it('加簽到：新增一筆 checkin，grantExp=false', () => {
    const counter = { v: 100 };
    const ops = collectAttendanceOps(
      person,
      { checkin: true, checkout: false, note: '' },
      [],
      'ce_pub_1',
      timeStr,
      baseRecord,
      counter,
      fixedRand,
    );
    expect(ops.removes).toHaveLength(0);
    expect(ops.grantExp).toBe(false);
    expect(ops.adds).toEqual([
      {
        ...baseRecord,
        id: 'att_100_abcd',
        type: 'checkin',
        time: timeStr,
      },
    ]);
  });

  it('加簽退（已簽到）：新增一筆 checkout 且 grantExp=true', () => {
    const existing: RosterAttendanceRecordInput[] = [
      { _docId: 'd_in', id: 'att_1', uid: 'u_alice', type: 'checkin', status: 'active' },
    ];
    const counter = { v: 200 };
    const ops = collectAttendanceOps(
      person,
      { checkin: true, checkout: true, note: '' },
      existing,
      'ce_pub_1',
      timeStr,
      baseRecord,
      counter,
      fixedRand,
    );
    expect(ops.removes).toHaveLength(0);
    expect(ops.grantExp).toBe(true);
    expect(ops.adds).toEqual([
      {
        ...baseRecord,
        id: 'att_200_abcd',
        type: 'checkout',
        time: timeStr,
      },
    ]);
  });

  it('直接勾簽退（原本未簽到）：連帶補簽到並新增簽退，grantExp=true', () => {
    const counter = { v: 300 };
    const ops = collectAttendanceOps(
      person,
      { checkin: false, checkout: true, note: '' },
      [],
      'ce_pub_1',
      timeStr,
      baseRecord,
      counter,
      fixedRand,
    );
    expect(ops.adds).toHaveLength(2);
    expect(ops.adds[0]?.type).toBe('checkin');
    expect(ops.adds[0]?.id).toBe('att_300_abcd');
    expect(ops.adds[1]?.type).toBe('checkout');
    expect(ops.adds[1]?.id).toBe('att_301_abcd');
    expect(ops.grantExp).toBe(true);
  });

  it('取消簽退：只移除最新一筆 checkout，保留 checkin', () => {
    const existing: RosterAttendanceRecordInput[] = [
      { _docId: 'd_in', id: 'att_1', uid: 'u_alice', type: 'checkin', status: 'active' },
      { _docId: 'd_out', id: 'att_2', uid: 'u_alice', type: 'checkout', status: 'active' },
    ];
    const counter = { v: 400 };
    const ops = collectAttendanceOps(
      person,
      { checkin: true, checkout: false, note: '' },
      existing,
      'ce_pub_1',
      timeStr,
      baseRecord,
      counter,
      fixedRand,
    );
    expect(ops.adds).toHaveLength(0);
    expect(ops.removes).toHaveLength(1);
    expect(ops.removes[0]?._docId).toBe('d_out');
    expect(ops.grantExp).toBe(false);
  });

  it('取消簽到連帶取消簽退：同時移除 checkout 與 checkin（不重複）', () => {
    const existing: RosterAttendanceRecordInput[] = [
      { _docId: 'd_in', id: 'att_1', uid: 'u_alice', type: 'checkin', status: 'active' },
      { _docId: 'd_out', id: 'att_2', uid: 'u_alice', type: 'checkout', status: 'active' },
    ];
    const counter = { v: 500 };
    const ops = collectAttendanceOps(
      person,
      { checkin: false, checkout: false, note: '' },
      existing,
      'ce_pub_1',
      timeStr,
      baseRecord,
      counter,
      fixedRand,
    );
    expect(ops.adds).toHaveLength(0);
    expect(ops.removes.map((r) => r._docId)).toEqual(['d_out', 'd_in']);
  });

  it('備註變更：新增一筆 att_note_<counter> 紀錄', () => {
    const counter = { v: 600 };
    const ops = collectAttendanceOps(
      person,
      { checkin: false, checkout: false, note: '先走一步' },
      [],
      'ce_pub_1',
      timeStr,
      baseRecord,
      counter,
      fixedRand,
    );
    expect(ops.removes).toHaveLength(0);
    expect(ops.adds).toEqual([
      {
        ...baseRecord,
        id: 'att_note_600',
        type: 'note',
        time: timeStr,
        note: '先走一步',
      },
    ]);
  });

  it('阻擋 pseudo companion uid 作為 baseRecord.uid', () => {
    const badBase: AttendanceBaseRecord = {
      ...baseRecord,
      uid: 'comp_pseudo_123',
    };
    const ops = collectAttendanceOps(
      person,
      { checkin: true, checkout: false, note: '' },
      [],
      'ce_pub_1',
      timeStr,
      badBase,
      { v: 1 },
      fixedRand,
    );
    expect(ops.blocked).toBe(true);
    expect(ops.reason).toBe('companion_pseudo_uid_as_attendance_uid');
    expect(ops.adds).toHaveLength(0);
  });
});

describe('writeAttendanceOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('使用同一個 writeBatch 原子提交新增與軟刪除，且不寫入 A 快取內部欄位', async () => {
    const timeStr = '2026/05/01 09:05';
    const res = await writeAttendanceOps(
      'event_doc_99',
      {
        adds: [
          {
            id: 'att_100_abcd',
            eventId: 'ce_pub_99',
            uid: 'u_member',
            userName: 'Member',
            participantType: 'self',
            companionId: null,
            companionName: null,
            type: 'checkin',
            time: timeStr,
          },
          {
            id: 'att_note_101',
            eventId: 'ce_pub_99',
            uid: 'u_member',
            userName: 'Member',
            participantType: 'self',
            companionId: null,
            companionName: null,
            type: 'note',
            time: timeStr,
            note: '有帶球',
          },
        ],
        removes: [
          {
            _docId: 'old_att_doc_1',
            id: 'att_old_1',
            uid: 'u_member',
            type: 'checkout',
             _path: 'events/event_doc_99/attendanceRecords/old_att_doc_1',
          } as RosterAttendanceRecordInput,
        ],
      },
      'u_operator_admin',
    );

    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockCollection).toHaveBeenCalledWith(
      expect.anything(),
      'events/event_doc_99/attendanceRecords',
    );
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    const firstSetPayload = mockBatchSet.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(firstSetPayload).toEqual({
      id: 'att_100_abcd',
      eventId: 'ce_pub_99',
      uid: 'u_member',
      userName: 'Member',
      participantType: 'self',
      companionId: null,
      companionName: null,
      type: 'checkin',
      time: timeStr,
      status: 'active',
      createdAt: { __serverTimestamp: true },
    });
    expect('_docId' in firstSetPayload).toBe(false);
    expect('_path' in firstSetPayload).toBe(false);
    expect('_parentPath' in firstSetPayload).toBe(false);
    expect('_sourceKind' in firstSetPayload).toBe(false);
    expect('_sourceCollection' in firstSetPayload).toBe(false);

    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      {
        id: 'old_att_doc_1',
        path: 'events/event_doc_99/attendanceRecords/old_att_doc_1',
      },
      {
        status: 'removed',
        removedAt: { __serverTimestamp: true },
        removedByUid: 'u_operator_admin',
      },
    );
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(res.addedDocIds).toHaveLength(2);
    expect(res.removedDocIds).toEqual(['old_att_doc_1']);
  });
});

describe('formatAttendanceDateTime', () => {
  it('絕對時間格式化成台北牆鐘，00:30 不會變成前一天', () => {
    expect(formatAttendanceDateTime(new Date('2026-05-01T09:05:00+08:00'))).toBe('2026/05/01 09:05');
    expect(formatAttendanceDateTime(new Date('2026-10-19T00:30:00+08:00'))).toBe('2026/10/19 00:30');
  });
});
