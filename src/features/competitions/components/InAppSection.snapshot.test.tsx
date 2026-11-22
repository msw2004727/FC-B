// 站內清單本機快照接上站內區塊（顧問 §3.553 條件 2、5、6、7）。快照寫入守門、讀回時機、下架移除、當日摘要、閘門。
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emit } from '@/core/events';
import { CP_LIST_GUEST_SNAPSHOT_KEY, CP_LIST_SNAPSHOT_KEY, writeCpListSnapshot } from '../data/list-snapshot';
import { summaryShardIdOf } from '../data/schedule-load';
import type { CompetitionDoc, CpMineItem, SummaryEntry } from '../data/types';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { taipeiMs } from '../format';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo, type FakeCpRepo } from '../testing/fake-cp-repo';
import { NOW, competition, idleActions, memberActor } from '../testing/screen-fixtures';
import { InAppSection } from './InAppSection';

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const guestActor = { ...memberActor, uid: null };
/** 合格的賽事 id（後端 CID_RE：cp_＋20 碼英數）；short() 換回短名方便比對。 */
const C = (s: string) => `cp_${s.padEnd(20, '0')}`;
const short = (id: string | null | undefined) => (id ?? '').replace(/^cp_/, '').replace(/0+$/, '');
const G = CP_LIST_GUEST_SNAPSHOT_KEY;

const live = competition({
  id: C('livecup'), name: '進行盃', category: 'cup', hostTeamId: null,
  regCloseAt: taipeiMs(2026, 12, 1, 23, 59), firstMatchAt: NOW - 3_600_000, lastMatchAt: NOW + 2 * 86_400_000,
});
const warm = competition({
  id: C('warmlg'), name: '冬季聯賽', hostTeamId: null,
  regCloseAt: taipeiMs(2026, 12, 9, 23, 59), firstMatchAt: taipeiMs(2026, 12, 13, 9, 0), lastMatchAt: taipeiMs(2026, 12, 14, 18, 0),
});
const gone = competition({ id: C('gone'), name: '後來被下架', hostTeamId: null });
const fresh = competition({ id: C('fresh'), name: '新開的賽事', hostTeamId: null });

function entry(id: string, k: number, st: SummaryEntry['st']): SummaryEntry {
  return { id, k, st, dv: 'dv', r: 1, no: 1, v: null, h: { id: 'h', n: '主' }, a: { id: 'a', n: '客' }, s: [0, 0], wo: null } as SummaryEntry;
}
const SHARD = { [C('livecup')]: [{ id: summaryShardIdOf(NOW), entries: [entry('m1', NOW + 3_600_000, 'scheduled'), entry('m2', NOW + 7_200_000, 'scheduled')] }] };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** listPublic 等 release 才回（模擬伺服器慢）；fail 時回錯。 */
function slowRepo(
  competitions: CompetitionDoc[],
  options: { isPublic?: boolean; fail?: boolean; hangLaunch?: boolean; mine?: CpMineItem[]; testers?: string[]; mineFail?: boolean } = {},
) {
  const repo: FakeCpRepo = createFakeCpRepo({
    launch: { isPublic: options.isPublic ?? true, bannedWords: [] },
    competitions,
    summary: SHARD,
    mine: { uid_member: options.mine ?? [] },
    testers: options.testers ?? [],
  });
  if (options.mineFail) repo.listMine = async () => { throw new Error('offline'); };
  const release = deferred();
  const original = repo.listPublic.bind(repo);
  repo.listPublic = async (includeInternal) => {
    await release.promise;
    if (options.fail) throw new Error('offline');
    return original(includeInternal);
  };
  if (options.hangLaunch) repo.getLaunch = () => new Promise(() => undefined);
  return { repo, release: async () => { await act(async () => { release.resolve(); }); } };
}

function show(env: Partial<CpInjectedEnv> & Pick<CpInjectedEnv, 'repo'>, onGate = vi.fn(), onReady = vi.fn()) {
  const value = { actor: guestActor, actions: idleActions(), now: NOW, ...env } as CpInjectedEnv;
  render(
    <LocationProvider>
      <CpEnvProvider value={value}>
        <InAppSection onGate={onGate} onReady={onReady} />
      </CpEnvProvider>
    </LocationProvider>,
  );
  return { onGate, onReady };
}

const shownCids = () => [...document.querySelectorAll('[data-cid]')].map((el) => short(el.getAttribute('data-cid')));
const guestPorts = (confirmed: string | null) => ({ confirmedUid: () => confirmed });
/** 畫面更新後 preact 的 effect 晚一拍才跑；寫快照在 effect 裡。 */
const flush = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });
const savedAt = () => (JSON.parse(localStorage.getItem(G) ?? 'null') as { savedAt: number } | null)?.savedAt;

describe('閘門通過後、讀回前先畫快照', () => {
  it('讀回前就畫出上次的卡，並通知 onReady；讀回後換成伺服器清單：已下架的卡在第一次更新就消失、新卡補上', async () => {
    writeCpListSnapshot(null, 'public', { publicDocs: [warm, gone], hosted: [], mine: [] });
    const { repo, release } = slowRepo([warm, fresh, { ...gone, hidden: true }]);
    const { onReady } = show({ repo, listSnapshot: guestPorts(null) });
    await waitFor(() => expect(shownCids().sort()).toEqual(['gone', 'warmlg']));
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(repo.calls()).not.toContain('listPublic');
    await release();
    await waitFor(() => expect(shownCids().sort()).toEqual(['fresh', 'warmlg']));
    await flush();
    // 寫回的新快照也不帶下架的
    const rows = (JSON.parse(localStorage.getItem(G) ?? '{}') as { rows: { id: string }[] }).rows;
    expect(rows.map((row) => short(row.id)).sort()).toEqual(['fresh', 'warmlg']);
  });

  it('沒有快照時照舊：讀回前什麼都不畫、不通知 onReady', async () => {
    const { repo, release } = slowRepo([warm]);
    const { onReady } = show({ repo, listSnapshot: guestPorts(null) });
    await act(async () => { await Promise.resolve(); });
    expect(shownCids()).toEqual([]);
    expect(onReady).not.toHaveBeenCalled();
    await release();
    await waitFor(() => expect(shownCids()).toEqual(['warmlg']));
  });

  it('注入環境沒開快照（listSnapshot 省略）：不讀也不寫', async () => {
    writeCpListSnapshot(null, 'public', { publicDocs: [gone], hosted: [], mine: [] });
    const before = localStorage.getItem(G);
    const { repo, release } = slowRepo([warm]);
    show({ repo });
    await act(async () => { await Promise.resolve(); });
    expect(shownCids()).toEqual([]);
    await release();
    await waitFor(() => expect(shownCids()).toEqual(['warmlg']));
    await flush();
    expect(localStorage.getItem(G)).toBe(before);
  });
});

describe('條件 6：快照畫面不帶當日摘要', () => {
  it('快照上進行中的卡直接是記分板卡、數字格先預留不畫、不讀摘要片；讀回後才讀摘要並畫數字格（卡不換版面）', async () => {
    writeCpListSnapshot(null, 'public', { publicDocs: [live, warm], hosted: [], mine: [] });
    const { repo, release } = slowRepo([live, warm]);
    show({ repo, listSnapshot: guestPorts(null) });
    await waitFor(() => expect(shownCids()).toContain('livecup'));
    const card = document.querySelector(`[data-cid="${C('livecup')}"]`);
    expect(card?.classList.contains('cpl-card--board')).toBe(true);
    expect(card?.querySelector('.d2-sb--lit .d2-sb__st')?.textContent).toContain('進行中');
    expect(card?.querySelector('.cpl-cells--wait')).not.toBeNull();
    expect(card?.querySelector('.d2-num')).toBeNull();
    await flush();
    expect(repo.calls()).not.toContain('getSummaryShard');
    await release();
    await waitFor(() => expect(document.querySelector(`[data-cid="${C('livecup')}"] .d2-num`)).not.toBeNull());
    expect(document.querySelector(`[data-cid="${C('livecup')}"] .cpl-cells--wait`)).toBeNull();
    expect(repo.calls()).toContain('getSummaryShard');
    expect(document.querySelector(`[data-cid="${C('livecup')}"] .d2-num`)?.textContent).toBe('13:00');
  });
});

describe('條件 7：只在閘門允許顯示站內時才畫', () => {
  it('閘門還在判定（cpConfig/launch 沒回）：有快照也不畫', async () => {
    writeCpListSnapshot(null, 'public', { publicDocs: [warm], hosted: [], mine: [] });
    const { repo } = slowRepo([warm], { hangLaunch: true });
    const { onReady } = show({ repo, listSnapshot: guestPorts(null) });
    await act(async () => { await new Promise((done) => setTimeout(done, 20)); });
    expect(shownCids()).toEqual([]);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('閘門沒過（未公開、不是測試者）：不畫快照', async () => {
    writeCpListSnapshot(null, 'public', { publicDocs: [warm], hosted: [], mine: [] });
    const { repo } = slowRepo([warm], { isPublic: false });
    const { onGate, onReady } = show({ repo, listSnapshot: guestPorts(null) });
    await waitFor(() => expect(onGate).toHaveBeenCalledWith(false, 'denied'));
    expect(shownCids()).toEqual([]);
    expect(onReady).not.toHaveBeenCalled();
    // 伺服器明確判定看不到：這位使用者的快照刪掉（審查 P3）
    expect(localStorage.getItem(G)).toBeNull();
  });
});

describe('範圍：測試者／管理員是 internal，一般人是 public（審查 P2-1）', () => {
  it('未公開、是測試者：讀回後寫成 internal 範圍', async () => {
    const { repo, release } = slowRepo([warm], { isPublic: false, testers: ['uid_member'] });
    show({ repo, actor: memberActor, listSnapshot: guestPorts('uid_member') });
    await release();
    await waitFor(() => expect(shownCids()).toEqual(['warmlg']));
    await flush();
    const env = JSON.parse(localStorage.getItem(CP_LIST_SNAPSHOT_KEY) ?? '{}') as { scope?: string; owner?: string };
    expect(env.owner).toBe('uid:uid_member');
    expect(env.scope).toBe('internal');
  });

  it('同帳號存的是 internal 快照，現在是一般使用者（已公開、不是測試者）：不畫', async () => {
    writeCpListSnapshot('uid_member', 'internal', { publicDocs: [gone], hosted: [], mine: [] });
    const { repo, release } = slowRepo([warm]);
    const { onReady } = show({ repo, actor: memberActor, listSnapshot: guestPorts('uid_member') });
    await act(async () => { await new Promise((done) => setTimeout(done, 20)); });
    expect(shownCids()).toEqual([]);
    expect(onReady).not.toHaveBeenCalled();
    await release();
    await waitFor(() => expect(shownCids()).toEqual(['warmlg']));
    await flush();
    expect((JSON.parse(localStorage.getItem(CP_LIST_SNAPSHOT_KEY) ?? '{}') as { scope?: string }).scope).toBe('public');
  });
});

describe('條件 2：登入者帳號守門', () => {
  it('登入狀態還沒確認是畫面使用者：不讀本人快照，也不寫', async () => {
    writeCpListSnapshot('uid_member', 'public', { publicDocs: [gone], hosted: [], mine: [] });
    const before = localStorage.getItem(CP_LIST_SNAPSHOT_KEY);
    const { repo, release } = slowRepo([warm]);
    show({ repo, actor: memberActor, listSnapshot: { confirmedUid: () => undefined } });
    await act(async () => { await Promise.resolve(); });
    expect(shownCids()).toEqual([]);
    await release();
    await waitFor(() => expect(shownCids()).toEqual(['warmlg']));
    await flush();
    expect(localStorage.getItem(CP_LIST_SNAPSHOT_KEY)).toBe(before);
  });

  it('確認是本人：先畫本人快照，讀回後寫成本人的', async () => {
    writeCpListSnapshot('uid_member', 'public', { publicDocs: [gone], hosted: [], mine: [] });
    const { repo, release } = slowRepo([warm]);
    show({ repo, actor: memberActor, listSnapshot: guestPorts('uid_member') });
    await waitFor(() => expect(shownCids()).toEqual(['gone']));
    await release();
    await waitFor(() => expect(shownCids()).toEqual(['warmlg']));
    await flush();
    const env = JSON.parse(localStorage.getItem(CP_LIST_SNAPSHOT_KEY) ?? '{}') as { owner: string; rows: { id: string }[] };
    expect(env.owner).toBe('uid:uid_member');
    expect(env.rows.map((row) => short(row.id))).toEqual(['warmlg']);
  });

  it('確定沒登入的訪客畫面遇到別人的快照：不畫，並刪掉', async () => {
    writeCpListSnapshot('uid_member', 'public', { publicDocs: [gone], hosted: [], mine: [] });
    const { repo } = slowRepo([warm]);
    show({ repo, listSnapshot: guestPorts(null) });
    await waitFor(() => expect(localStorage.getItem(CP_LIST_SNAPSHOT_KEY)).toBeNull());
    expect(shownCids()).toEqual([]);
  });

  it('清單比登入確認早回來：先不寫，auth:changed 之後補寫', async () => {
    let confirmed: string | null | undefined;
    const { repo, release } = slowRepo([warm]);
    show({ repo, listSnapshot: { confirmedUid: () => confirmed } });
    await release();
    await waitFor(() => expect(shownCids()).toEqual(['warmlg']));
    await flush();
    expect(localStorage.getItem(G)).toBeNull();
    confirmed = null;
    await act(async () => { emit('auth:changed', { uid: null }); });
    await flush();
    expect(localStorage.getItem(G)).toContain('"owner":"guest"');
  });
});

describe('讀回失敗', () => {
  it('公開清單讀取失敗而畫面上是快照：保留快照、不改寫', async () => {
    writeCpListSnapshot(null, 'public', { publicDocs: [warm], hosted: [], mine: [] });
    const at = savedAt();
    const { repo, release } = slowRepo([warm], { fail: true });
    show({ repo, listSnapshot: guestPorts(null) });
    await waitFor(() => expect(shownCids()).toEqual(['warmlg']));
    await release();
    await act(async () => { await new Promise((done) => setTimeout(done, 20)); });
    expect(shownCids()).toEqual(['warmlg']);
    expect(savedAt()).toBe(at);
  });

  it('公開清單讀取失敗而畫面上沒有快照：照舊畫讀到的我的賽事，但不拿這半份清單蓋掉本機快照', async () => {
    // 存的是管理員範圍（internal），一般範圍讀不到，所以畫面上沒有快照。
    writeCpListSnapshot('uid_member', 'internal', { publicDocs: [warm], hosted: [], mine: [] });
    const before = localStorage.getItem(CP_LIST_SNAPSHOT_KEY);
    const mine = [{ id: 'm', cid: C('olda'), roles: ['host'], host: true, name: '去年秋季盃', category: 'cup' } as CpMineItem];
    const { repo, release } = slowRepo([warm], { fail: true, mine });
    show({ repo, actor: memberActor, listSnapshot: guestPorts('uid_member') });
    await release();
    await waitFor(() => expect(shownCids()).toEqual(['olda']));
    await flush();
    expect(localStorage.getItem(CP_LIST_SNAPSHOT_KEY)).toBe(before);
  });

  it('我的清單讀取失敗：照舊畫公開清單，但不拿這半份清單蓋掉本機快照（審查 P3）', async () => {
    writeCpListSnapshot('uid_member', 'internal', { publicDocs: [gone], hosted: [], mine: [] });
    const before = localStorage.getItem(CP_LIST_SNAPSHOT_KEY);
    const { repo, release } = slowRepo([warm], { mineFail: true });
    show({ repo, actor: memberActor, listSnapshot: guestPorts('uid_member') });
    await release();
    await waitFor(() => expect(shownCids()).toEqual(['warmlg']));
    await flush();
    expect(localStorage.getItem(CP_LIST_SNAPSHOT_KEY)).toBe(before);
  });
});
