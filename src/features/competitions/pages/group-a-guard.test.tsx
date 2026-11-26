// 賽事 A 組 commit 3：讀取失敗與防呆（B2、B3、B10、B12、B13、B14、B17、TEAMID P3-2）。不新增樣式。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getCurrentLocale } from '@/i18n/i18n';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import { InAppSection } from '../components/InAppSection';
import type { CompetitionDoc } from '../data/types';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import { hostActor, idleActions, manageBundle, memberActor, NOW, screenEnv } from '../testing/screen-fixtures';
import CompetitionManagePage from './CompetitionManagePage';
import HostMatchesPage from './HostMatchesPage';
import HostSchedulePage from './HostSchedulePage';
import JoinRosterPage from './JoinRosterPage';
import ScorerMatchesPage from './ScorerMatchesPage';

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
  await loadCompetitionsDict(getCurrentLocale());
});

afterEach(() => {
  cleanup();
  _resetAppConfirmForTest();
});

function draw(env: CpInjectedEnv, Page: ComponentType) {
  return render(
    <LocationProvider>
      <CpEnvProvider value={env}>
        <Page />
        <AppConfirmHost />
      </CpEnvProvider>
    </LocationProvider>,
  );
}

function hasButton(name: string): boolean {
  return screen.queryAllByRole('button', { name }).length > 0;
}

describe('B2 拒絕面板寫明會清空名單', () => {
  function rejectEnv(rosterCount: number): CpInjectedEnv {
    const env = screenEnv('host-reject');
    const bundle = env.bundle!;
    return { ...env, bundle: { ...bundle, entries: bundle.entries.map((row) => (row.status === 'pending' ? { ...row, rosterCount } : row)) } };
  }
  it('已登錄 5 位：寫出會一併移除、無法復原；0 位不寫', async () => {
    const view = draw(rejectEnv(5), CompetitionManagePage);
    expect(await screen.findByText('這隊已登錄的 5 位球員會一併移除，無法復原')).toBeTruthy();
    view.unmount();
    draw(rejectEnv(0), CompetitionManagePage);
    await screen.findAllByText('拒絕原因');
    expect(screen.queryByText(/位球員會一併移除/)).toBeNull();
  });
});

describe('B3 已有賽程時產生賽程先確認', () => {
  function schedEnv(scheduledMatches: number, generate: ReturnType<typeof vi.fn>): CpInjectedEnv {
    const env = screenEnv('real-host-schedule');
    const bundle = env.bundle!;
    return {
      ...env,
      actions: { ...env.actions, generateSchedule: generate as never },
      bundle: { ...bundle, divisions: bundle.divisions.map((row) => (row.dvId === 'dv_adult' ? { ...row, scheduledMatches } : row)) },
    };
  }
  const result = (dryRun: boolean) => ({ dvId: 'dv_adult', seed: 7, matchCount: 6, unplacedCount: 0, daysUsed: ['2027-01-09'], perTeam: 3, teamCount: 4, dryRun });

  it('已有 6 場：跳危險確認寫明取代 6 場，按取消不送正式產生', async () => {
    const generate = vi.fn(async (input: { dryRun: boolean }) => result(input.dryRun));
    draw(schedEnv(6, generate), HostSchedulePage);
    fireEvent.click(await screen.findByRole('button', { name: '預覽' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '產生賽程' })).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: '產生賽程' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent ?? '').toContain('這個組別已有 6 場賽程');
    expect(dialog.textContent ?? '').toContain('產生後會全部取代');
    expect(dialog.textContent ?? '').toContain('改期與記分員指派要重做');
    // 確認框的第一顆是取消（appConfirm 全站同一種）
    fireEvent.click(dialog.querySelectorAll('button')[0]!);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(generate.mock.calls.filter(([input]) => input.dryRun === false)).toHaveLength(0);
  });

  it('沒有賽程：不問，直接產生', async () => {
    const generate = vi.fn(async (input: { dryRun: boolean }) => result(input.dryRun));
    draw(schedEnv(0, generate), HostSchedulePage);
    fireEvent.click(await screen.findByRole('button', { name: '預覽' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '產生賽程' })).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: '產生賽程' }));
    await waitFor(() => expect(generate.mock.calls.filter(([input]) => input.dryRun === false)).toHaveLength(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('B10 公開清單讀取失敗', () => {
  it('不說「目前沒有賽事」，顯示讀取失敗與重試；重試成功後恢復', async () => {
    const repo = createFakeCpRepo({ launch: { isPublic: true, bannedWords: [] }, competitions: [] });
    let fail = true;
    const listPublic = repo.listPublic.bind(repo);
    repo.listPublic = async (...args: Parameters<typeof repo.listPublic>) => {
      if (fail) throw new Error('offline');
      return listPublic(...args);
    };
    draw({ actor: { ...memberActor, uid: null }, repo, actions: idleActions(), now: NOW }, InAppSection as ComponentType);
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    expect(screen.queryByText('目前沒有賽事')).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('目前沒有賽事')).toBeTruthy();
    expect(screen.queryByText('讀取失敗')).toBeNull();
  });
});

describe('B12 我的場次讀取失敗有重試', () => {
  it('讀取失敗顯示讀取失敗與重試，按了重讀', async () => {
    const repo = createFakeCpRepo({ assignments: { cup: [{ uid: 'uid_member', roles: ['scorer'], matchIds: [], expiresAt: null }] } });
    let fail = true;
    const original = repo.getStaffAssignment.bind(repo);
    const spy = vi.fn(async (cid: string, uid: string) => {
      if (fail) throw new Error('offline');
      return original(cid, uid);
    });
    repo.getStaffAssignment = spy;
    draw({ actor: memberActor, repo, actions: idleActions(), now: NOW, route: { cid: 'cup' } }, ScorerMatchesPage);
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('讀取失敗')).toBeNull());
  });
});

describe('B13 無權限畫面有返回鈕', () => {
  it('賽程管理與排賽程：一般會員看到「回賽事頁」', () => {
    const view = draw({ ...screenEnv('host-approved'), actor: memberActor, bundle: manageBundle(null), matches: [] }, HostMatchesPage);
    expect(screen.getByText('只有主辦可以做這個操作')).toBeTruthy();
    expect(hasButton('回賽事頁')).toBe(true);
    view.unmount();
    draw({ ...screenEnv('host-approved'), actor: memberActor, bundle: manageBundle(null) }, HostSchedulePage);
    expect(screen.getByText('只有主辦可以做這個操作')).toBeTruthy();
    expect(hasButton('回賽事頁')).toBe(true);
  });

  it('排賽程下架時主辦也有「回賽事頁」', () => {
    const base = manageBundle({ uid: 'uid_host', roles: ['host'] });
    draw({ ...screenEnv('host-approved'), actor: hostActor, bundle: { ...base, competition: { ...base.competition!, hidden: true } as CompetitionDoc } }, HostSchedulePage);
    expect(screen.getByText('這場賽事目前不公開')).toBeTruthy();
    expect(hasButton('回賽事頁')).toBe(true);
  });
});

describe('B14 名單表單錯誤標在那一欄', () => {
  it('自己登錄：沒填背號時錯誤畫在背號欄，不在底下', async () => {
    const view = draw(screenEnv('form-self-adult'), JoinRosterPage);
    const number = view.container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.input(number, { target: { value: '' } });
    fireEvent.click(await screen.findByRole('button', { name: '送出' }));
    await waitFor(() => expect(view.container.querySelector('[data-field-error]')).toBeTruthy());
    const err = view.container.querySelector('[data-field-error]');
    expect(err?.textContent).toBe('還有必填項目沒填');
    expect(err?.closest('.ui-input')?.querySelector('input')?.getAttribute('type')).toBe('number');
    expect(view.container.querySelector('.cps-warn')).toBeNull();
  });
});

describe('B17 順延／對調原因會發公告', () => {
  it('整天順延面板寫出原因會自動發成公告', async () => {
    const env = screenEnv('real-shift-day');
    draw(env, HostMatchesPage);
    fireEvent.click(await screen.findByRole('button', { name: '整天順延' }));
    expect(await screen.findByText('原因會自動發成公告')).toBeTruthy();
  });
});

describe('TEAMID P3-2 俱樂部文件讀取失敗', () => {
  it('不說「只有俱樂部成員可以做這個操作」，改讀取失敗＋重試；重試成功後出表單', async () => {
    const env = screenEnv('form-self-adult');
    let fail = true;
    const clubKeys = vi.fn(async (_uid: string | null, teamId: string) => {
      if (fail) throw new Error('offline');
      return [teamId, 'legacy_demo'];
    });
    draw({ ...env, actor: { ...env.actor, memberClubIds: ['legacy_demo'] }, clubKeys }, JoinRosterPage);
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    expect(screen.queryByText('只有俱樂部成員可以做這個操作')).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByRole('button', { name: '送出' })).toBeTruthy();
    expect(clubKeys).toHaveBeenCalledTimes(2);
  });
});
