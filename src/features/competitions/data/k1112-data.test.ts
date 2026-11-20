// 第 4 步 K11 邀請、K12 下架與檢舉：資料層（Callable 送出形狀、讀取查詢、連結格式）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as { name: string; data: Record<string, unknown> }[],
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => async (data: Record<string, unknown>) => {
    h.calls.push({ name, data });
    return { data: { ok: true } };
  },
}));

vi.mock('./cp-firebase', () => ({
  getCpFirebase: async () => ({ functions: {} }),
}));

import {
  cpHostCreateInvite,
  cpHostModerate,
  cpHostReviewReport,
  cpHostRevokeInvite,
  cpParticipantAcceptInvite,
} from './cp-callables';
import { createCompetitionsRepo, inviteFromDoc, reportFromDoc, type CpFirestoreSdk } from './cp-repo';
import {
  INVITE_STORE_KEY,
  buildInviteUrl,
  clearInviteTicket,
  parseInviteHash,
  readInviteTicket,
  saveInviteTicket,
} from './invite-link';
import { liveCpActions } from '../actions';
import { staffDisplayNames } from './staff-assign';

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const IV = 'iv_aaaaaaaaaaaaaaaaaaaa';

function last(): { name: string; data: Record<string, unknown> } {
  const call = h.calls.at(-1);
  if (!call) throw new Error('沒有送出');
  return call;
}

describe('K11／K12 Callable 只送契約列出的鍵', () => {
  beforeEach(() => {
    h.calls.length = 0;
    vi.unstubAllEnvs();
  });

  it('createInvite：省略 expiresAt 不送；帶了才送', async () => {
    await cpHostCreateInvite({ cid: 'cup', roles: ['scorer'], matchIds: ['mt_1', 'mt_2'] });
    expect(last()).toEqual({
      name: 'cpHost',
      data: { action: 'createInvite', cid: 'cup', roles: ['scorer'], matchIds: ['mt_1', 'mt_2'] },
    });
    await cpHostCreateInvite({ cid: 'cup', roles: ['scorer', 'referee'], matchIds: [], expiresAt: 99 });
    expect(last().data).toEqual({ action: 'createInvite', cid: 'cup', roles: ['scorer', 'referee'], matchIds: [], expiresAt: 99 });
  });

  it('revokeInvite、acceptInvite（code 只在本文）', async () => {
    await cpHostRevokeInvite({ cid: 'cup', ivId: IV });
    expect(last()).toEqual({ name: 'cpHost', data: { action: 'revokeInvite', cid: 'cup', ivId: IV } });
    await cpParticipantAcceptInvite({ cid: 'cup', ivId: IV, code: CODE });
    expect(last()).toEqual({ name: 'cpParticipant', data: { action: 'acceptInvite', cid: 'cup', ivId: IV, code: CODE } });
  });

  it('moderate：下架帶原因、恢復不帶 reason', async () => {
    await cpHostModerate({ cid: 'cup', hidden: true, reason: '冒用名義' });
    expect(last()).toEqual({ name: 'cpHost', data: { action: 'moderate', cid: 'cup', hidden: true, reason: '冒用名義' } });
    await cpHostModerate({ cid: 'cup', hidden: false });
    expect(last().data).toEqual({ action: 'moderate', cid: 'cup', hidden: false });
    expect(last().data).not.toHaveProperty('reason');
  });

  it('reviewReport 三種狀態', async () => {
    for (const status of ['resolved', 'dismissed', 'open'] as const) {
      await cpHostReviewReport({ cid: 'cup', reportId: 'rp_abcdefgh', status });
      expect(last()).toEqual({ name: 'cpHost', data: { action: 'reviewReport', cid: 'cup', reportId: 'rp_abcdefgh', status } });
    }
  });

  it('liveCpActions 接上五支', () => {
    expect(liveCpActions.createInvite).toBe(cpHostCreateInvite);
    expect(liveCpActions.revokeInvite).toBe(cpHostRevokeInvite);
    expect(liveCpActions.acceptInvite).toBe(cpParticipantAcceptInvite);
    expect(liveCpActions.moderate).toBe(cpHostModerate);
    expect(liveCpActions.reviewReport).toBe(cpHostReviewReport);
  });
});

type Clause =
  | { kind: 'where'; field: string; op: string; value: unknown }
  | { kind: 'limit'; n: number }
  | { kind: 'orderBy'; field: string; dir: string };

function sdkWith(rows: Record<string, { id: string; data: Record<string, unknown> }[]>) {
  const queries: { path: string; clauses: Clause[] }[] = [];
  const sdk: CpFirestoreSdk = {
    doc: (_db, path) => ({ path }),
    collection: (_db, path) => ({ path }),
    where: (field, op, value) => ({ kind: 'where', field, op, value }),
    limit: (n) => ({ kind: 'limit', n }),
    orderBy: (field, dir = 'asc') => ({ kind: 'orderBy', field, dir }),
    query: (col, ...clauses) => ({ path: (col as { path: string }).path, clauses }),
    async getDoc() {
      return { id: '', exists: () => false, data: () => undefined };
    },
    async getDocs(query) {
      const rec = query as { path: string; clauses: Clause[] };
      queries.push(rec);
      return { docs: (rows[rec.path] ?? []).map((row) => ({ id: row.id, data: () => row.data })) };
    },
  };
  const repo = createCompetitionsRepo({ getDb: async () => ({}), loadSdk: async () => sdk });
  return { repo, queries };
}

describe('listInvites／listReports 查詢', () => {
  it('邀請：where status == open、limit 30，不加 orderBy；建立時間新到舊', async () => {
    const { repo, queries } = sdkWith({
      'competitions/cup/invites': [
        { id: 'iv_old', data: { status: 'open', roles: ['scorer'], matchIds: ['mt_1'], expiresAt: 500, createdAt: 1 } },
        { id: 'iv_new', data: { status: 'open', roles: ['referee', 'bogus'], matchIds: [], expiresAt: { toMillis: () => 900 }, createdAt: 2 } },
      ],
    });
    const rows = await repo.listInvites('cup');
    expect(queries[0]).toEqual({
      path: 'competitions/cup/invites',
      clauses: [{ kind: 'where', field: 'status', op: '==', value: 'open' }, { kind: 'limit', n: 30 }],
    });
    expect(rows.map((row) => row.id)).toEqual(['iv_new', 'iv_old']);
    expect(rows[0]).toMatchObject({ roles: ['referee'], expiresAt: 900 });
    expect(await repo.listInvites('a/b')).toEqual([]);
  });

  it('檢舉：orderBy lastAt desc、limit 50；結果不含 reporterUid', async () => {
    const { repo, queries } = sdkWith({
      'competitions/cup/reports': [
        { id: 'rp_aaaaaaaa', data: { reporterUid: 'uid_secret_reporter', reason: 'fake', detail: '假資料', count: 3, lastAt: 10, status: 'resolved', reopened: true } },
        { id: 'rp_bbbbbbbb', data: { reporterUid: 'uid_other', reason: 'other', detail: '  ', count: 1, lastAt: 20 } },
        { id: 'rp_cccccccc', data: { reason: 'nope' } },
      ],
    });
    const rows = await repo.listReports('cup');
    expect(queries[0]).toEqual({
      path: 'competitions/cup/reports',
      clauses: [{ kind: 'orderBy', field: 'lastAt', dir: 'desc' }, { kind: 'limit', n: 50 }],
    });
    expect(rows.map((row) => row.id)).toEqual(['rp_bbbbbbbb', 'rp_aaaaaaaa']);
    expect(rows[1]).toEqual({ id: 'rp_aaaaaaaa', reason: 'fake', detail: '假資料', count: 3, lastAt: 10, status: 'resolved', reopened: true });
    expect(rows[0]).toMatchObject({ detail: null, status: 'open', reopened: false });
    expect(JSON.stringify(rows)).not.toContain('uid_');
  });

  it('reportFromDoc／inviteFromDoc 丟掉壞資料', () => {
    expect(reportFromDoc('rp_x', { reason: 'x' })).toBeNull();
    expect(inviteFromDoc('iv_x', { status: 'weird' })).toBeNull();
    expect(inviteFromDoc('iv_x', { status: 'used', usedMemberNo: 4, roles: 'scorer' })).toMatchObject({ roles: [], usedMemberNo: 4 });
  });
});

describe('staff 顯示名', () => {
  it('有 displayName 用名字；null 或空白退回成員 N；自己仍是我自己', () => {
    const names = staffDisplayNames([
      { uid: 'u1', roles: ['scorer'], memberNo: 3, displayName: '陳小明' },
      { uid: 'u2', roles: ['scorer'], memberNo: 4, displayName: null },
      { uid: 'u3', roles: ['referee'], memberNo: 5, displayName: '  ' },
      { uid: 'me', roles: ['host'], memberNo: 1, displayName: '主辦本人' },
    ], 'me');
    expect(names.get('u1')).toBe('陳小明');
    expect(names.get('u2')).toBe('成員 4');
    expect(names.get('u3')).toBe('成員 5');
    expect(names.get('me')).toBe('我自己');
  });
});

describe('邀請連結（代碼放 # 之後）', () => {
  afterEach(() => {
    clearInviteTicket();
  });

  it('產生的網址不含查詢字串，# 後面帶 i 與 c', () => {
    const url = buildInviteUrl('https://example.test/', 'cup', IV, CODE);
    expect(url).toBe(`https://example.test/competitions/cup/invite#i=${IV}&c=${CODE}`);
    expect(new URL(url).search).toBe('');
    expect(parseInviteHash(new URL(url).hash)).toEqual({ ivId: IV, code: CODE });
  });

  it('形狀不對回 null', () => {
    expect(parseInviteHash('')).toBeNull();
    expect(parseInviteHash('#i=iv_x')).toBeNull();
    expect(parseInviteHash(`#i=bad&c=${CODE}`)).toBeNull();
    expect(parseInviteHash(`#i=${IV}&c=short`)).toBeNull();
  });

  it('sessionStorage 暫存：同賽事才回、別的賽事不回、壞資料清掉', () => {
    saveInviteTicket({ cid: 'cup', ivId: IV, code: CODE });
    expect(INVITE_STORE_KEY.startsWith('fcb:')).toBe(true);
    expect(readInviteTicket('other')).toBeNull();
    expect(readInviteTicket('cup')).toEqual({ cid: 'cup', ivId: IV, code: CODE });
    clearInviteTicket();
    expect(sessionStorage.getItem(INVITE_STORE_KEY)).toBeNull();
    sessionStorage.setItem(INVITE_STORE_KEY, '{bad');
    expect(readInviteTicket('cup')).toBeNull();
    expect(sessionStorage.getItem(INVITE_STORE_KEY)).toBeNull();
  });
});
