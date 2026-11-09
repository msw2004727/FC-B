import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { getApprovedStudentIdSet, type RosterUnionInput } from './roster-union';

// Oracle：FC functions/edu-course-enrollment-core.js 原檔照搬（FC origin/main，最後修改 commit 7680faf56）。
// 伺服器的報名容量、名冊同步與 listEduCourseEnrollmentSummaries 都用這支；B 的 helper 必須逐案一致。
const require = createRequire(import.meta.url);
const oracle = require('./__fixtures__/edu-course-enrollment-core.oracle.cjs') as {
  getApprovedStudentIdSet: (input: unknown) => Set<string>;
};

function sorted(set: Set<string>): string[] {
  return [...set].sort();
}

function expectSame(input: RosterUnionInput): void {
  const mine = sorted(getApprovedStudentIdSet(input));
  const theirs = sorted(oracle.getApprovedStudentIdSet(input));
  expect(mine).toEqual(theirs);
}

// 固定種子的亂數（mulberry32），每次跑出同一批案例。
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES: unknown[] = ['approved', 'pending', 'rejected', 'cancelled', 'removed', '', ' approved ', 'APPROVED', null, undefined, 1];
const IDS: unknown[] = ['s1', 's2', ' s3 ', 's4', '', null, undefined, 7, 'x'.repeat(130)];
const GROUPS: unknown[] = ['g1', 'g2', ' g1 ', '', null, 3, 'G1'];
const ENROLL_STATUS: unknown[] = ['active', 'pending', 'inactive', ' active ', '', null, undefined];

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)] as T;
}

function randomCase(r: () => number): RosterUnionInput {
  const enrollments = Array.from({ length: Math.floor(r() * 6) }, () =>
    r() < 0.05 ? (null as never) : { studentId: pick(r, IDS), status: pick(r, STATUSES) },
  );
  const students = Array.from({ length: Math.floor(r() * 6) }, () => {
    if (r() < 0.05) return null as never;
    const useDocId = r() < 0.3;
    return {
      ...(useDocId ? { _docId: pick(r, IDS) } : { id: pick(r, IDS) }),
      enrollStatus: pick(r, ENROLL_STATUS),
      groupIds: r() < 0.15 ? pick(r, GROUPS) : Array.from({ length: Math.floor(r() * 3) }, () => pick(r, GROUPS)),
    };
  });
  return {
    // 伺服器一定傳方案物件（oracle 遇到 null 會丟錯），所以不產生 null 方案。
    plan: r() < 0.1 ? {} : { groupId: r() < 0.2 ? undefined : pick(r, GROUPS) },
    enrollments,
    students,
    migrationCompleted: r() < 0.3,
  };
}

describe('getApprovedStudentIdSet × Functions oracle', () => {
  it('K0 情境：approved 報名加上分組 active 學員；pending／inactive 與單數 groupId 不算', () => {
    const input: RosterUnionInput = {
      plan: { groupId: 'g19' },
      enrollments: [
        { studentId: 'a', status: 'approved' },
        { studentId: 'b', status: 'pending' },
        { studentId: 'c', status: 'removed' },
      ],
      students: [
        { id: 'a', enrollStatus: 'active', groupIds: [] },
        { id: 'b', enrollStatus: 'active', groupIds: ['g19'] },
        { id: 'd', enrollStatus: 'active', groupIds: ['g19'] },
        { id: 'e', enrollStatus: 'inactive', groupIds: ['g19'] },
        { id: 'f', enrollStatus: 'pending', groupIds: ['g19'] },
        { id: 'g', enrollStatus: 'active', groupId: 'g19' } as never,
      ],
    };
    expect(sorted(getApprovedStudentIdSet(input))).toEqual(['a', 'b', 'd']);
    expectSame(input);
  });

  it('旗標已設定（遷移完成）時不算分組；方案沒有分組時退化成純報名', () => {
    const base = {
      enrollments: [{ studentId: 'a', status: 'approved' }],
      students: [{ id: 'b', enrollStatus: 'active', groupIds: ['g1'] }],
    };
    expect(sorted(getApprovedStudentIdSet({ ...base, plan: { groupId: 'g1' }, migrationCompleted: true }))).toEqual(['a']);
    expect(sorted(getApprovedStudentIdSet({ ...base, plan: {} }))).toEqual(['a']);
    expectSame({ ...base, plan: { groupId: 'g1' }, migrationCompleted: true });
    expectSame({ ...base, plan: {} });
  });

  it('空輸入與缺欄位', () => {
    expectSame({});
    expectSame({ plan: {}, enrollments: [], students: [] });
  });

  it('2000 組固定種子亂數案例逐案一致（狀態大小寫、空白、數字、超長 ID、null 列）', () => {
    const r = rng(20261109);
    for (let i = 0; i < 2000; i += 1) expectSame(randomCase(r));
  });
});
