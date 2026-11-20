// 開放前兩項提示：讀賽事被權限拒絕時顯示「不公開」（不放重試）；檢舉成功與未登入的提示。
import type { ComponentType } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocationProvider } from 'preact-iso';
import { toast } from '@/ui/Toast';
import type { CpActions } from '../actions';
import { CpCallError } from '../data/cp-callables';
import { CpEnvProvider, type CpActor, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import { competition, hostActor, idleActions, memberActor, NOW, screenEnv } from '../testing/screen-fixtures';
import { loadFailOf } from '../ui/feedback';
import AddRosterPage from './AddRosterPage';
import CompetitionDetailPage from './CompetitionDetailPage';
import CompetitionManagePage from './CompetitionManagePage';
import HostMatchesPage from './HostMatchesPage';
import HostSchedulePage from './HostSchedulePage';
import JoinRosterPage from './JoinRosterPage';
import RosterPage from './RosterPage';

const guestActor: CpActor = { ...memberActor, uid: null, displayName: null, memberClubIds: [] };
const DENIED = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };

function draw(Page: ComponentType, env: CpInjectedEnv) {
  return render(
    <LocationProvider>
      <CpEnvProvider value={env}>
        <Page />
      </CpEnvProvider>
    </LocationProvider>,
  );
}

function button(name: string): HTMLButtonElement | null {
  return ([...document.querySelectorAll('button')].find((node) => (node.textContent ?? '').trim() === name) as HTMLButtonElement | undefined) ?? null;
}

/** 根文件第一次讀照 failures 依序丟錯，用完後正常回傳。 */
function failingRepo(failures: unknown[]) {
  const base = createFakeCpRepo({ competitions: [competition({ id: 'cup', name: '示範盃' })] });
  let reads = 0;
  return {
    ...base,
    getCompetition: async (cid: string) => {
      reads += 1;
      const err = failures.shift();
      if (err !== undefined) throw err;
      return base.getCompetition(cid);
    },
    reads: () => reads,
  };
}

function liveEnv(actor: CpActor, repo: CpInjectedEnv['repo'], actions: CpActions = idleActions()): CpInjectedEnv {
  return { actor, repo, actions, now: NOW, route: { cid: 'cup', enId: 'en_a' } };
}

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('讀取錯誤碼判斷（loadFailOf）', () => {
  it('只有 permission-denied 算不公開，其他都是讀取失敗', () => {
    expect(loadFailOf(DENIED)).toBe('hidden');
    expect(loadFailOf({ code: 'unavailable' })).toBe('error');
    expect(loadFailOf(new Error('Failed to fetch'))).toBe('error');
    expect(loadFailOf(new CpCallError('UNKNOWN', {}))).toBe('error');
    expect(loadFailOf(null)).toBe('error');
    expect(loadFailOf('permission-denied')).toBe('error');
  });
});

describe('詳情頁讀不到根文件', () => {
  it('permission-denied：顯示不公開與返回賽事列表，沒有重試，不透露下架／草稿／內部', async () => {
    const repo = failingRepo([DENIED]);
    const view = draw(CompetitionDetailPage, liveEnv(guestActor, repo));
    expect(await screen.findByText('這場賽事目前不公開')).toBeTruthy();
    expect(button('重試')).toBeNull();
    const text = view.container.textContent ?? '';
    expect(text).not.toContain('讀取失敗');
    expect(text).not.toContain('下架');
    expect(text).not.toContain('草稿');
    expect(text).not.toContain('內部');
    const back = button('返回賽事列表');
    expect(back).toBeTruthy();
    fireEvent.click(back as HTMLButtonElement);
    await waitFor(() => expect(location.pathname).toBe('/tournaments'));
    expect(repo.reads()).toBe(1);
  });

  it('網路錯誤：維持讀取失敗＋重試，重試成功後顯示賽事', async () => {
    const repo = failingRepo([new Error('Failed to fetch')]);
    draw(CompetitionDetailPage, liveEnv(memberActor, repo));
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    expect(screen.queryByText('這場賽事目前不公開')).toBeNull();
    expect(button('返回賽事列表')).toBeNull();
    fireEvent.click(button('重試') as HTMLButtonElement);
    expect(await screen.findByText('賽事詳情')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('讀取失敗')).toBeNull());
    expect(repo.reads()).toBe(2);
  });

  it('第一次網路錯誤、重試時權限被拒：改成不公開，不再放重試', async () => {
    const repo = failingRepo([{ code: 'unavailable' }, DENIED]);
    draw(CompetitionDetailPage, liveEnv(guestActor, repo));
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    fireEvent.click(button('重試') as HTMLButtonElement);
    expect(await screen.findByText('這場賽事目前不公開')).toBeTruthy();
    expect(button('重試')).toBeNull();
  });

  it('主辦看自己被下架的賽事：讀得到根文件，下架提示不變', async () => {
    const base = createFakeCpRepo({
      competitions: [competition({ id: 'cup', name: '示範盃', hidden: true, hiddenReason: '主辦資料不實' })],
      staff: { cup: [{ uid: 'uid_host', roles: ['host'] }] },
    });
    draw(CompetitionDetailPage, liveEnv(hostActor, base));
    expect(await screen.findByText('此賽事已被管理員下架：主辦資料不實')).toBeTruthy();
    expect(screen.queryByText('這場賽事目前不公開')).toBeNull();
  });
});

describe('其他讀賽事根文件的頁面', () => {
  const PAGES: [string, ComponentType, CpActor][] = [
    ['報名名單', RosterPage, guestActor],
    ['加入名單', JoinRosterPage, memberActor],
    ['代表登錄球員', AddRosterPage, memberActor],
    ['報名管理', CompetitionManagePage, hostActor],
    ['排賽程', HostSchedulePage, hostActor],
    ['賽程管理', HostMatchesPage, hostActor],
  ];

  for (const [label, Page, actor] of PAGES) {
    it(`${label}：permission-denied 顯示不公開，其他錯誤仍是讀取失敗`, async () => {
      draw(Page, liveEnv(actor, failingRepo([DENIED])));
      expect(await screen.findByText('這場賽事目前不公開')).toBeTruthy();
      expect(button('返回賽事列表')).toBeTruthy();
      expect(button('重試')).toBeNull();
      expect(screen.queryByText('讀取失敗')).toBeNull();
      cleanup();

      draw(Page, liveEnv(actor, failingRepo([new Error('Failed to fetch')])));
      expect(await screen.findByText('讀取失敗')).toBeTruthy();
      expect(screen.queryByText('這場賽事目前不公開')).toBeNull();
      expect(button('返回賽事列表')).toBeNull();
    });
  }
});

describe('檢舉提示', () => {
  it('送出成功：關閉面板並提示已收到檢舉', async () => {
    const show = vi.spyOn(toast, 'show');
    const report = vi.fn(async () => ({ cid: 'cup', reported: true }));
    draw(CompetitionDetailPage, screenEnv('detail-report', { ...idleActions(), report }));
    fireEvent.click(button('送出檢舉') as HTMLButtonElement);
    await waitFor(() => expect(show).toHaveBeenCalledWith({ message: '已收到檢舉，管理員會盡快處理', tone: 'success' }));
    expect(report).toHaveBeenCalledTimes(1);
    expect(button('送出檢舉')).toBeNull();
  });

  it('送出失敗：不提示成功，維持原本錯誤文字', async () => {
    const show = vi.spyOn(toast, 'show');
    const report = vi.fn(async () => { throw new CpCallError('REPORT_RATE_LIMITED', {}); });
    draw(CompetitionDetailPage, screenEnv('detail-report', { ...idleActions(), report }));
    fireEvent.click(button('送出檢舉') as HTMLButtonElement);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(show).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
    expect(button('送出檢舉')).toBeTruthy();
  });

  it('未登入按檢舉：直接提示先登入、有登入鈕、不給填表也不送出', async () => {
    const report = vi.fn(async () => ({}));
    const signIn = vi.fn(async () => undefined);
    const env = { ...screenEnv('detail-member', { ...idleActions(), report }), actor: guestActor, signIn };
    const view = draw(CompetitionDetailPage, env);
    fireEvent.click(screen.getByRole('menuitem', { name: '檢舉' }));
    expect(await screen.findByText('請先登入再檢舉')).toBeTruthy();
    expect(button('送出檢舉')).toBeNull();
    expect(view.container.querySelector('textarea')).toBeNull();
    fireEvent.click(button('登入') as HTMLButtonElement);
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(report).not.toHaveBeenCalled();
  });

  it('伺服器回 SIGN_IN_REQUIRED：改成先登入提示與登入鈕', async () => {
    const report = vi.fn(async () => { throw new CpCallError('SIGN_IN_REQUIRED', {}); });
    draw(CompetitionDetailPage, screenEnv('detail-report', { ...idleActions(), report }));
    fireEvent.click(button('送出檢舉') as HTMLButtonElement);
    expect(await screen.findByText('請先登入再檢舉')).toBeTruthy();
    expect(button('登入')).toBeTruthy();
    expect(screen.queryByText('操作失敗，請稍後再試')).toBeNull();
  });

  it('登入狀態還在確認：不先說要登入；uid 晚到後照常顯示檢舉表單', async () => {
    const pending: CpActor = { ...guestActor, authPending: true };
    const env = { ...screenEnv('detail-report'), actor: pending };
    const view = draw(CompetitionDetailPage, env);
    expect(screen.queryByText('請先登入再檢舉')).toBeNull();
    expect(button('送出檢舉')).toBeTruthy();
    view.rerender(
      <LocationProvider>
        <CpEnvProvider value={{ ...env, actor: memberActor }}>
          <CompetitionDetailPage />
        </CpEnvProvider>
      </LocationProvider>,
    );
    expect(screen.queryByText('請先登入再檢舉')).toBeNull();
    expect(button('送出檢舉')).toBeTruthy();
  });
});
