// 88934c43 導頁測試：代為新增（AddRosterPage）、自行登錄（JoinRosterPage）的三個出口（送出成功、標題「<」、取消）
// 用 useGoBack(名單頁)：有上一頁就 history.back，直開（歷史起點）才 replace 到名單頁。
// 原 bug：出口用 route(名單頁) 再推一筆，名單頁「<」（history.back）又回到表單，來回循環。
// 這裡用 LocationProvider＋Router 跑真的瀏覽器歷史（jsdom），斷言 history.length 與「<」之後到哪一頁。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { JSX } from 'preact';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import coreZh from '@/i18n/messages/zh-TW.json';
import { markHistoryRoot } from '@/core/back-guard';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import type { CpActions } from '../actions';
import type { RosterPublicDoc } from '../data/types';
import { CpEnvProvider, type CpActor, type CpInjectedEnv, type CpPreview } from '../env';
import { loadCompetitionsDict } from '../i18n';
import cpZh from '../locales-lazy/zh-TW.json';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import { NOW, idleActions, memberActor, repActor, screenEnv } from '../testing/screen-fixtures';
import AddRosterPage from './AddRosterPage';
import JoinRosterPage from './JoinRosterPage';
import RosterPage from './RosterPage';

function flatten(obj: Record<string, unknown>, prefix = '', out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value as Record<string, unknown>, path, out);
    else out[path] = String(value);
  }
  return out;
}

const dict = {
  ...flatten(coreZh as unknown as Record<string, unknown>),
  ...flatten(cpZh as unknown as Record<string, unknown>, 'competitions'),
};

vi.mock('../rep-clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rep-clubs')>();
  return { ...actual, loadMyBirthday: () => Promise.resolve(null) };
});

vi.mock('@/i18n/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/i18n')>();
  return {
    ...actual,
    useT: () => (key: string, params?: Record<string, unknown>) => {
      let text = dict[key] ?? key;
      for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value));
      return text;
    },
  };
});

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

const MANAGE = '/competitions/cup/manage';
const ROSTER = '/competitions/cup/entries/en_a';
const ADD = `${ROSTER}/add`;
const JOIN = `${ROSTER}/join`;
const NEW_NAME = '新來的示範';

/**
 * 報隊管理替身：用按鈕 route() 推「一筆」名單頁。
 * 刻意不用 CompetitionManagePage 的 `<a href onClick={preventDefault; route()}>` 寫法：preact-iso 2.12 的
 * LocationProvider 在 window 監聽 click、不看 defaultPrevented，那種連結會推兩筆同網址名單頁（另案回報），
 * 會讓這裡要驗的表單出口結果失真。
 */
function ManageStub(): JSX.Element {
  const { route } = useLocation();
  return (
    <div>
      <h1>報隊管理</h1>
      <button type="button" onClick={() => route(ROSTER)}>示範隊A</button>
    </div>
  );
}

/** 名單資料可變：送出成功時 action 把新球員寫進來，名單頁重新讀取時看得到。 */
function makeWorld(who: CpActor, preview: CpPreview) {
  const seedBundle = screenEnv('roster').bundle!;
  const players: RosterPublicDoc[] = [...seedBundle.roster];
  const base = createFakeCpRepo({
    competitions: [seedBundle.competition!],
    divisions: { cup: seedBundle.divisions },
    entries: { cup: seedBundle.entries },
  });
  const listRoster = vi.fn(async (_cid: string, enId: string) => players.filter((row) => row.enId === enId));
  const repo = { ...base, listRoster };
  const addNew = async () => {
    players.push({ ...players[0]!, id: 'pl_new', number: 14, displayName: NEW_NAME });
    return {};
  };
  const idle = idleActions();
  const actions: CpActions = {
    ...idle,
    addRosterByRep: vi.fn(addNew) as unknown as CpActions['addRosterByRep'],
    joinRoster: vi.fn(addNew) as unknown as CpActions['joinRoster'],
  };
  // 不帶 bundle、不帶 route：頁面照網址參數讀假 repo，跟正式頁一樣每次進名單頁都重讀。
  const env: CpInjectedEnv = { actor: who, repo, actions, now: NOW, preview };
  return { env, listRoster, actions };
}

function mountApp(env: CpInjectedEnv) {
  return render(
    <CpEnvProvider value={env}>
      <LocationProvider>
        <Router>
          <Route path="/competitions/:cid/manage" component={ManageStub} />
          <Route path="/competitions/:cid/entries/:enId/add" component={AddRosterPage} />
          <Route path="/competitions/:cid/entries/:enId/join" component={JoinRosterPage} />
          <Route path="/competitions/:cid/entries/:enId" component={RosterPage} />
        </Router>
      </LocationProvider>
      <AppConfirmHost />
    </CpEnvProvider>,
  );
}

function backButton(): HTMLElement {
  return screen.getByRole('button', { name: '返回' });
}

async function onRoster() {
  await screen.findByRole('heading', { level: 1, name: '本隊名單' });
  await waitFor(() => expect(location.pathname).toBe(ROSTER));
}

async function onForm(title: string, path: string) {
  await screen.findByRole('heading', { level: 1, name: title });
  expect(location.pathname).toBe(path);
}

/** 從報隊管理（起點）點進名單頁，再按名單頁按鈕推進表單頁。回傳進入表單後的 history.length。 */
async function walkToForm(buttonName: string, title: string, path: string): Promise<number> {
  await screen.findByRole('heading', { level: 1, name: '報隊管理' });
  fireEvent.click(screen.getByRole('button', { name: '示範隊A' }));
  await onRoster();
  await screen.findByText('王示範');
  fireEvent.click(await screen.findByRole('button', { name: buttonName }));
  await onForm(title, path);
  return history.length;
}

/** 名單頁按「<」應回報隊管理（不是又回表單）。 */
async function rosterBackReachesManage() {
  fireEvent.click(backButton());
  await screen.findByRole('heading', { level: 1, name: '報隊管理' });
  expect(location.pathname).toBe(MANAGE);
  expect(screen.queryByRole('heading', { level: 1, name: '代為新增球員' })).toBeNull();
  expect(screen.queryByRole('heading', { level: 1, name: '登錄名單' })).toBeNull();
}

beforeEach(() => {
  // 每案從報隊管理起點開始（模擬 initBackGuard 開站時標記起點）。jsdom 的 history.length 跨案累積，只比相對值。
  history.replaceState(null, '', MANAGE);
  markHistoryRoot();
});

afterEach(() => {
  _resetAppConfirmForTest();
  cleanup();
  history.replaceState(null, '', '/');
});

describe('代為新增球員（AddRosterPage）導頁', () => {
  const preview: CpPreview = { prefillForm: true }; // 預填未成年、監護人與隱私已勾，可直接送出

  it('送出成功：退回原名單頁並重讀出新球員，不多推一筆；名單頁「<」回報隊管理', async () => {
    const { env, listRoster, actions } = makeWorld(repActor, preview);
    mountApp(env);
    const lengthAtForm = await walkToForm('代為新增球員', '代為新增球員', ADD);
    const readsBefore = listRoster.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    await onRoster();
    expect(actions.addRosterByRep).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(NEW_NAME)).toBeTruthy();
    expect(listRoster.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(history.length).toBe(lengthAtForm);

    await rosterBackReachesManage();
  });

  it('取消：回名單頁，再按名單頁「<」回報隊管理', async () => {
    const { env, actions } = makeWorld(repActor, preview);
    mountApp(env);
    const lengthAtForm = await walkToForm('代為新增球員', '代為新增球員', ADD);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await onRoster();
    expect(history.length).toBe(lengthAtForm);
    expect(actions.addRosterByRep).not.toHaveBeenCalled();
    await rosterBackReachesManage();
  });

  it('標題「<」：回名單頁，再按名單頁「<」回報隊管理', async () => {
    const { env } = makeWorld(repActor, preview);
    mountApp(env);
    const lengthAtForm = await walkToForm('代為新增球員', '代為新增球員', ADD);
    fireEvent.click(backButton());
    await onRoster();
    expect(history.length).toBe(lengthAtForm);
    await rosterBackReachesManage();
  });

  describe('直接開新增頁網址（歷史起點）', () => {
    beforeEach(() => {
      history.replaceState(null, '', ADD);
      markHistoryRoot();
    });

    for (const exit of ['送出成功', '取消', '標題「<」'] as const) {
      it(`${exit}：取代成名單頁（history.length 不變），名單頁仍是起點`, async () => {
        const { env, actions } = makeWorld(repActor, preview);
        mountApp(env);
        await onForm('代為新增球員', ADD);
        const before = history.length;
        if (exit === '送出成功') fireEvent.click(screen.getByRole('button', { name: '新增' }));
        else if (exit === '取消') fireEvent.click(screen.getByRole('button', { name: '取消' }));
        else fireEvent.click(backButton());
        await onRoster();
        expect(history.length).toBe(before);
        expect((history.state as Record<string, unknown> | null)?.['__fcbRoot']).toBe(true);
        if (exit === '送出成功') {
          expect(actions.addRosterByRep).toHaveBeenCalledTimes(1);
          expect(await screen.findByText(NEW_NAME)).toBeTruthy();
        }
      });
    }
  });
});

describe('自行登錄名單（JoinRosterPage）導頁', () => {
  // 預覽旗標讓表單不打個人資料生日、預填未成年真名與勾選，可直接送出（正式頁要等生日回來）。
  const preview: CpPreview = { prefillForm: true, selfMinor: true };

  it('送出成功：退回原名單頁並重讀出新球員，不多推一筆；名單頁「<」回報隊管理', async () => {
    const { env, listRoster, actions } = makeWorld(memberActor, preview);
    mountApp(env);
    const lengthAtForm = await walkToForm('登錄名單', '登錄名單', JOIN);
    const readsBefore = listRoster.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await onRoster();
    expect(actions.joinRoster).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(NEW_NAME)).toBeTruthy();
    expect(listRoster.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(history.length).toBe(lengthAtForm);
    await rosterBackReachesManage();
  });

  it('取消：回名單頁，再按名單頁「<」回報隊管理', async () => {
    const { env } = makeWorld(memberActor, preview);
    mountApp(env);
    const lengthAtForm = await walkToForm('登錄名單', '登錄名單', JOIN);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await onRoster();
    expect(history.length).toBe(lengthAtForm);
    await rosterBackReachesManage();
  });

  it('標題「<」：回名單頁，再按名單頁「<」回報隊管理', async () => {
    const { env } = makeWorld(memberActor, preview);
    mountApp(env);
    const lengthAtForm = await walkToForm('登錄名單', '登錄名單', JOIN);
    fireEvent.click(backButton());
    await onRoster();
    expect(history.length).toBe(lengthAtForm);
    await rosterBackReachesManage();
  });

  it('直開登錄頁網址：標題「<」取代成名單頁（history.length 不變）', async () => {
    history.replaceState(null, '', JOIN);
    markHistoryRoot();
    const { env } = makeWorld(memberActor, preview);
    mountApp(env);
    await onForm('登錄名單', JOIN);
    const before = history.length;
    fireEvent.click(backButton());
    await onRoster();
    expect(history.length).toBe(before);
  });
});
