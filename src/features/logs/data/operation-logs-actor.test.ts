import { describe, expect, it, vi } from 'vitest';
import {
  buildOperationLogDiagnosticText,
  getOperationLogActorUid,
  getOperationLogSearchText,
  matchesOperationLogKeyword,
  type OperationLogDoc,
} from './operation-logs';
import { filterOperationLogsList } from './log-center-model';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  query: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(() => Promise.resolve({ db: {} })),
}));

describe('操作者欄位容忍 actorUid 與 uid（actorUid 優先，缺值退 uid）', () => {
  it('只有 actorUid', () => {
    expect(getOperationLogActorUid({ actorUid: 'u_actor' })).toBe('u_actor');
  });

  it('只有 uid（舊別名，無害容錯）', () => {
    expect(getOperationLogActorUid({ uid: 'u_legacy' })).toBe('u_legacy');
  });

  it('兩者都有且不同：用 actorUid', () => {
    expect(getOperationLogActorUid({ actorUid: 'u_actor', uid: 'u_other' })).toBe('u_actor');
  });

  it('兩者皆缺：視為未知操作者，不丟錯', () => {
    expect(getOperationLogActorUid({})).toBe('');
    expect(getOperationLogActorUid(null)).toBe('');
    expect(getOperationLogActorUid(undefined)).toBe('');
    expect(getOperationLogActorUid({ actorUid: null, uid: null })).toBe('');
  });

  it('actorUid 為空字串、空白或非字串時退到 uid；前後空白會去掉', () => {
    expect(getOperationLogActorUid({ actorUid: '', uid: 'u_legacy' })).toBe('u_legacy');
    expect(getOperationLogActorUid({ actorUid: '   ', uid: ' u_legacy ' })).toBe('u_legacy');
    expect(
      getOperationLogActorUid({ actorUid: 123 as unknown as string, uid: 'u_legacy' }),
    ).toBe('u_legacy');
    expect(getOperationLogActorUid({ actorUid: '  u_actor  ' })).toBe('u_actor');
  });

  it('搜尋文字：只有 uid 的日誌能用該 uid 搜到；兩者不同時只認 actorUid', () => {
    const onlyUid: OperationLogDoc = { _docId: 'd1', uid: 'U_Legacy_1', operator: '甲' };
    expect(getOperationLogSearchText(onlyUid)).toContain('u_legacy_1');
    expect(matchesOperationLogKeyword(onlyUid, 'u_legacy_1')).toBe(true);

    const both: OperationLogDoc = { _docId: 'd2', actorUid: 'u_actor_2', uid: 'u_other_2' };
    expect(matchesOperationLogKeyword(both, 'u_actor_2')).toBe(true);
    expect(matchesOperationLogKeyword(both, 'u_other_2')).toBe(false);

    const neither: OperationLogDoc = { _docId: 'd3', operator: '丙' };
    expect(() => getOperationLogSearchText(neither)).not.toThrow();
    expect(matchesOperationLogKeyword(neither, 'u_')).toBe(false);
  });

  it('篩選：混合兩種欄位的清單都能依 uid 搜到', () => {
    const logs: OperationLogDoc[] = [
      { _docId: 'a', actorUid: 'u_new_1', type: 'exp', content: 'x' },
      { _docId: 'b', uid: 'u_old_1', type: 'exp', content: 'y' },
      { _docId: 'c', type: 'exp', content: 'z' },
    ];
    expect(filterOperationLogsList(logs, { keyword: 'u_new_1' }).map((l) => l._docId)).toEqual(['a']);
    expect(filterOperationLogsList(logs, { keyword: 'u_old_1' }).map((l) => l._docId)).toEqual(['b']);
    expect(filterOperationLogsList(logs, { keyword: '' })).toHaveLength(3);
  });

  it('診斷包：操作者列使用解析後的 UID，皆缺時顯示未標示', () => {
    expect(
      buildOperationLogDiagnosticText({ _docId: 'd1', operator: '甲', uid: 'u_legacy' }),
    ).toContain('操作者：甲 / u_legacy');
    expect(
      buildOperationLogDiagnosticText({ _docId: 'd2', operator: '乙', actorUid: 'u_actor', uid: 'u_other' }),
    ).toContain('操作者：乙 / u_actor');
    expect(buildOperationLogDiagnosticText({ _docId: 'd3', operator: '丙' })).toContain(
      '操作者：丙 / 未標示',
    );
  });
});
