// CP-FIRST-LOAD：首次讀取卡住時 8 秒自動重讀一次；晚到結果不覆蓋第二次的內容。
import { act, cleanup, render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CpEnvProvider, type CpActor, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict } from '../i18n';
import { FIRST_LOAD_TIMEOUT_MS, _clearFirstLoadLogForTest } from '../data/first-load';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import { competition, idleActions, memberActor, NOW, screenEnv } from '../testing/screen-fixtures';
import CompetitionDetailPage from './CompetitionDetailPage';
import RosterPage from './RosterPage';

function envOf(actor: CpActor, repo: CpInjectedEnv['repo']): CpInjectedEnv {
  return { actor, repo, actions: idleActions(), now: NOW, route: { cid: 'cup' } };
}

function detailNode(env: CpInjectedEnv) {
  return (
    <LocationProvider>
      <CpEnvProvider value={env}>
        <CompetitionDetailPage />
      </CpEnvProvider>
    </LocationProvider>
  );
}

function rosterNode(env: CpInjectedEnv) {
  return (
    <LocationProvider>
      <CpEnvProvider value={env}>
        <RosterPage />
      </CpEnvProvider>
    </LocationProvider>
  );
}

function rosterEnv(repo: CpInjectedEnv['repo']): CpInjectedEnv {
  return { actor: memberActor, repo, actions: idleActions(), now: NOW, route: { cid: 'cup', enId: 'en_a' } };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  _clearFirstLoadLogForTest();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  _clearFirstLoadLogForTest();
});

describe('詳情：首次讀取逾時自動重讀一次（CP-FIRST-LOAD）', () => {
  it('第 1 輪卡住 → 8 秒後自動重讀，標題出現；getCompetition 共呼叫 2 次', async () => {
    const base = createFakeCpRepo({
      competitions: [competition({ id: 'cup', name: '示範盃' })],
    });
    let firstCall = true;
    const getCompetition = vi.fn(async (cid: string) => {
      if (firstCall) {
        firstCall = false;
        return new Promise<never>(() => undefined);
      }
      return base.getCompetition(cid);
    });
    const repo = { ...base, getCompetition };
    render(detailNode(envOf(memberActor, repo)));
    await flush();
    expect(document.querySelector('.ui-page-spinner')).toBeTruthy();
    expect(getCompetition).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS + 500);
    });
    await flush();
    expect(screen.queryByRole('heading', { level: 1, name: '示範盃' })).toBeTruthy();
    expect(getCompetition).toHaveBeenCalledTimes(2);
  });

  it('第 1 輪卡住、第 2 輪 reject { code: "unavailable" } → 顯示讀取失敗與重試', async () => {
    const base = createFakeCpRepo({
      competitions: [competition({ id: 'cup', name: '示範盃' })],
    });
    let firstCall = true;
    const getCompetition = vi.fn(async (cid: string) => {
      if (firstCall) {
        firstCall = false;
        return new Promise<never>(() => undefined);
      }
      // 第二輪：用第一個呼叫的載入路徑丟掉。
      void cid;
      throw { code: 'unavailable' };
    });
    const repo = { ...base, getCompetition };
    render(detailNode(envOf(memberActor, repo)));
    await flush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS + 500);
    });
    await flush();
    expect(getCompetition).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('讀取失敗')).toBeTruthy();
    const retry = [...document.querySelectorAll('button')].find((el) => (el.textContent ?? '').trim() === '重試');
    expect(retry).toBeTruthy();
  });

  it('正常讀取 → 不重讀；推進 20 秒也不再讀', async () => {
    const base = createFakeCpRepo({
      competitions: [competition({ id: 'cup', name: '示範盃' })],
    });
    const getCompetition = vi.fn(base.getCompetition);
    const repo = { ...base, getCompetition };
    render(detailNode(envOf(memberActor, repo)));
    await flush();
    expect(screen.queryByRole('heading', { level: 1, name: '示範盃' })).toBeTruthy();
    expect(getCompetition).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await flush();
    expect(getCompetition).toHaveBeenCalledTimes(1);
  });

  it('第 1 輪卡住期間卸載 → 推進時間後不再呼叫 getCompetition（仍是 1 次）', async () => {
    const base = createFakeCpRepo({
      competitions: [competition({ id: 'cup', name: '示範盃' })],
    });
    let firstCall = true;
    const getCompetition = vi.fn(async (cid: string) => {
      if (firstCall) {
        firstCall = false;
        return new Promise<never>(() => undefined);
      }
      return base.getCompetition(cid);
    });
    const repo = { ...base, getCompetition };
    const view = render(detailNode(envOf(memberActor, repo)));
    await flush();
    expect(getCompetition).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(getCompetition).toHaveBeenCalledTimes(1);
  });
});

describe('名單：首次讀取逾時自動重讀一次（CP-FIRST-LOAD）', () => {
  it('第 1 輪 listRoster 卡住 → 8 秒後自動重讀，名單出現', async () => {
    const seedBundle = screenEnv('roster').bundle!;
    const base = createFakeCpRepo({
      competitions: [seedBundle.competition!],
      divisions: { cup: seedBundle.divisions },
      entries: { cup: seedBundle.entries },
    });
    let firstCall = true;
    const listRoster = vi.fn(async () => {
      if (firstCall) {
        firstCall = false;
        return new Promise<never>(() => undefined);
      }
      return seedBundle.roster;
    });
    const repo = { ...base, listRoster };
    const seedName = seedBundle.roster[0]?.displayName ?? '';
    render(rosterNode(rosterEnv(repo)));
    await flush();
    expect(document.querySelector('.ui-page-spinner')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS + 500);
    });
    await flush();
    expect(screen.queryByRole('heading', { level: 1, name: '本隊名單' })).toBeTruthy();
    expect(seedName).not.toBe('');
    expect(screen.queryByText(seedName)).toBeTruthy();
    expect(listRoster).toHaveBeenCalledTimes(2);
  });

  it('第 1 輪卡住後晚到（不同名稱）不覆蓋第 2 輪已畫的內容', async () => {
    const seedBundle = screenEnv('roster').bundle!;
    const base = createFakeCpRepo({
      competitions: [seedBundle.competition!],
      divisions: { cup: seedBundle.divisions },
      entries: { cup: seedBundle.entries },
    });
    let resolveFirst: (rows: typeof seedBundle.roster) => void = () => undefined;
    const first = new Promise<typeof seedBundle.roster>((resolve) => { resolveFirst = resolve; });
    const roundTwoRows = seedBundle.roster.map((row) => ({ ...row, displayName: '第二輪球員' }));
    const roundOneRows = seedBundle.roster.map((row) => ({ ...row, displayName: '第一輪球員' }));
    let call = 0;
    const listRoster = vi.fn(() => {
      call += 1;
      return call === 1 ? first : Promise.resolve(roundTwoRows);
    });
    const repo = { ...base, listRoster };
    render(rosterNode(rosterEnv(repo)));
    await flush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS + 500);
    });
    await flush();
    expect(screen.queryAllByText('第二輪球員').length).toBeGreaterThan(0);

    // 第 1 輪晚到：不改變結果。
    await act(async () => {
      resolveFirst(roundOneRows);
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    await flush();
    expect(screen.queryAllByText('第二輪球員').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('第一輪球員')).toHaveLength(0);
  });
});
