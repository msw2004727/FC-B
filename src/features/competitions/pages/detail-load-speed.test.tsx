// CP-DETAIL-SPEED d1／d3／d4：賽事詳情冷開的讀取順序與量測標記。
// d3：登入狀態確定前先不讀（只轉圈），確定後只讀一輪，不會先用訪客身分整組讀一次再整組重讀、閃回轉圈。
// d1：已登入時自己的 staff 合併成一次讀，計分員一定看得到「我的場次」。
// d4：名稱第一次畫出時記 performance.mark('cp:detail-title')，每次掛載一次、不帶任何參數。
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CpEnvProvider, type CpActor, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo, type FakeCpRepo } from '../testing/fake-cp-repo';
import { competition, idleActions, memberActor, NOW, screenEnv } from '../testing/screen-fixtures';
import CompetitionDetailPage from './CompetitionDetailPage';

const pendingActor: CpActor = { ...memberActor, uid: null, authPending: true };
const guestActor: CpActor = { ...memberActor, uid: null, authPending: false };

function envOf(actor: CpActor, repo: CpInjectedEnv['repo']): CpInjectedEnv {
  return { actor, repo, actions: idleActions(), now: NOW, route: { cid: 'cup' } };
}

function node(env: CpInjectedEnv) {
  return (
    <LocationProvider>
      <CpEnvProvider value={env}>
        <CompetitionDetailPage />
      </CpEnvProvider>
    </LocationProvider>
  );
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function scorerRepo(): FakeCpRepo {
  return createFakeCpRepo({
    competitions: [competition({ id: 'cup', name: '示範盃' })],
    assignments: { cup: [{ uid: memberActor.uid ?? 'uid_member', roles: ['scorer'], matchIds: ['mt_1'], expiresAt: null }] },
  });
}

/** 記下「名稱已出現之後，轉圈又出現」的閃回。 */
function watchFlash(container: Element): { flashed: () => boolean; stop: () => void } {
  let named = false;
  let flashed = false;
  const check = () => {
    if (container.querySelector('.d2-board__name')) named = true;
    else if (named && container.querySelector('.ui-page-spinner')) flashed = true;
  };
  const mo = new MutationObserver(check);
  mo.observe(container, { childList: true, subtree: true });
  return { flashed: () => flashed, stop: () => mo.disconnect() };
}

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('詳情頁登入待定時先不讀（d3）', () => {
  it('待定 → 登入者：待定期間 0 次讀取、只轉圈；uid 到了只讀一輪（職員合併讀），不閃回轉圈', async () => {
    const repo = scorerRepo();
    const view = render(node(envOf(pendingActor, repo)));
    const flash = watchFlash(view.container);
    await flush();
    expect(repo.calls()).toEqual([]);
    expect(view.container.querySelector('.ui-page-spinner')).toBeTruthy();

    view.rerender(node(envOf(memberActor, repo)));
    expect(await screen.findByRole('heading', { level: 1, name: '示範盃' })).toBeTruthy();
    await flush();
    expect(repo.calls().filter((name) => name === 'getCompetition')).toHaveLength(1);
    expect(repo.calls().filter((name) => name === 'getStaffWithAssignment')).toHaveLength(1);
    expect(repo.calls()).not.toContain('getStaff');
    expect(repo.calls()).not.toContain('getStaffAssignment');
    // 計分員一定看得到自己的場次入口。
    expect(screen.getByRole('button', { name: '我的場次' })).toBeTruthy();
    expect(flash.flashed()).toBe(false);
    expect(view.container.querySelector('.ui-page-spinner')).toBeNull();
    flash.stop();
  });

  it('待定 → 確定是訪客：只讀一輪訪客版，不讀職員', async () => {
    const repo = scorerRepo();
    const view = render(node(envOf(pendingActor, repo)));
    await flush();
    expect(repo.calls()).toEqual([]);

    view.rerender(node(envOf(guestActor, repo)));
    expect(await screen.findByRole('heading', { level: 1, name: '示範盃' })).toBeTruthy();
    await flush();
    expect(repo.calls().filter((name) => name === 'getCompetition')).toHaveLength(1);
    expect(repo.calls().some((name) => name.startsWith('getStaff'))).toBe(false);
    expect(screen.queryByRole('button', { name: '我的場次' })).toBeNull();
  });

  it('訪客（一開始就不是待定）：路徑不變，直接讀一輪、不讀職員', async () => {
    const repo = scorerRepo();
    render(node(envOf(guestActor, repo)));
    expect(await screen.findByRole('heading', { level: 1, name: '示範盃' })).toBeTruthy();
    await flush();
    expect(repo.calls().filter((name) => name === 'getCompetition')).toHaveLength(1);
    expect(repo.calls().some((name) => name.startsWith('getStaff'))).toBe(false);
  });

  it('uid 到了讀取失敗：顯示讀取失敗與重試；重試只讀一輪就顯示賽事，指派照樣帶到', async () => {
    const base = scorerRepo();
    let fails = 1;
    const repo = {
      ...base,
      getCompetition: async (cid: string) => {
        if (fails > 0) {
          fails -= 1;
          throw { code: 'unavailable' };
        }
        return base.getCompetition(cid);
      },
    };
    const view = render(node(envOf(pendingActor, repo)));
    await flush();
    view.rerender(node(envOf(memberActor, repo)));
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    // 賽事根讀失敗就沒讀職員。
    expect(base.calls().some((name) => name.startsWith('getStaff'))).toBe(false);
    const retry = [...document.querySelectorAll('button')].find((el) => (el.textContent ?? '').trim() === '重試');
    if (!retry) throw new Error('讀取失敗應有重試');
    fireEvent.click(retry);
    expect(await screen.findByRole('heading', { level: 1, name: '示範盃' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: '我的場次' })).toBeTruthy();
    expect(base.calls().filter((name) => name === 'getStaffWithAssignment')).toHaveLength(1);
  });

  it('賽事不存在：已登入只讀賽事根 1 筆（原本還會多讀自己的指派）', async () => {
    const repo = createFakeCpRepo({ competitions: [] });
    render(node(envOf(memberActor, repo)));
    await waitFor(() => expect(repo.calls()).toEqual(['getCompetition']));
    await flush();
    expect(repo.calls()).toEqual(['getCompetition']);
    expect(repo.readCount()).toBe(1);
  });
});

describe('詳情頁量測標記（d4）', () => {
  it('名稱第一次畫出時記一次 cp:detail-title，不帶任何參數；重新渲染不再記', async () => {
    const mark = vi.spyOn(performance, 'mark');
    const repo = scorerRepo();
    const view = render(node(envOf(memberActor, repo)));
    const titleMarks = () => mark.mock.calls.filter(([name]) => name === 'cp:detail-title');
    await screen.findByRole('heading', { level: 1, name: '示範盃' });
    await flush();
    expect(titleMarks()).toHaveLength(1);
    expect(titleMarks()[0]).toEqual(['cp:detail-title']);
    view.rerender(node({ ...envOf(memberActor, repo), now: NOW + 1 }));
    await flush();
    expect(titleMarks()).toHaveLength(1);
  });

  it('登入待定期間（只有轉圈）不記', async () => {
    const mark = vi.spyOn(performance, 'mark');
    render(node(envOf(pendingActor, scorerRepo())));
    await flush();
    expect(mark.mock.calls.filter(([name]) => name === 'cp:detail-title')).toHaveLength(0);
  });

  it('注入 bundle 的環境（harness、畫面測試）不記', async () => {
    const mark = vi.spyOn(performance, 'mark');
    render(node(screenEnv('detail-member')));
    await flush();
    expect(document.querySelector('.d2-board__name')).toBeTruthy();
    expect(mark.mock.calls.filter(([name]) => name === 'cp:detail-title')).toHaveLength(0);
  });

  it('performance.mark 拋錯也不影響畫面', async () => {
    vi.spyOn(performance, 'mark').mockImplementation(() => {
      throw new Error('not supported');
    });
    render(node(envOf(memberActor, scorerRepo())));
    expect(await screen.findByRole('heading', { level: 1, name: '示範盃' })).toBeTruthy();
  });
});
