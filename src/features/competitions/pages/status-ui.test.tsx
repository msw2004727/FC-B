// 狀態入口（延期／取消／恢復）的顯示規則、位置、流程、失敗處理。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocationProvider } from 'preact-iso';
import type { CpActions } from '../actions';
import { CpCallError } from '../data/cp-callables';
import type { CompetitionDoc, DivisionDoc, StaffRole } from '../data/types';
import { CpEnvProvider, type CpActor, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo, type FakeCpRepo } from '../testing/fake-cp-repo';
import {
  adminActor,
  adultDivision,
  clubRepActor,
  coHostActor,
  competition,
  hostActor,
  idleActions,
  memberActor,
  NOW,
  screenEnv,
  youthDivision,
} from '../testing/screen-fixtures';
import CompetitionDetailPage from './CompetitionDetailPage';

const DIVS: DivisionDoc[] = [{ ...adultDivision, entryCount: 3 }, { ...youthDivision, entryCount: 2 }];
const PERSONAL: Partial<CompetitionDoc> = { hostType: 'personal', hostTeamId: null, feeNote: null };

const guestActor: CpActor = { ...memberActor, uid: null, memberClubIds: [] };
const formerRepActor: CpActor = { ...clubRepActor, repClubs: [], memberClubIds: [] };

interface Opts {
  actor: CpActor;
  staff?: StaffRole[];
  comp?: Partial<CompetitionDoc>;
  now?: number;
  actions?: CpActions;
  repo?: FakeCpRepo;
  divisions?: DivisionDoc[];
}

function env(opts: Opts): CpInjectedEnv {
  const base = screenEnv('real-recruit');
  if (!base.bundle) throw new Error('fixture');
  return {
    ...base,
    actor: opts.actor,
    actions: opts.actions ?? idleActions(),
    repo: opts.repo ?? createFakeCpRepo(),
    now: opts.now ?? NOW,
    route: { cid: 'cup' },
    bundle: {
      ...base.bundle,
      divisions: opts.divisions ?? DIVS,
      staff: opts.staff && opts.actor.uid ? { uid: opts.actor.uid, roles: opts.staff } : null,
      competition: competition(opts.comp),
    },
  };
}

function draw(value: CpInjectedEnv) {
  return render(
    <LocationProvider>
      <CpEnvProvider value={value}><CompetitionDetailPage /></CpEnvProvider>
    </LocationProvider>,
  );
}

function findButton(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((node) => (node.textContent ?? '').trim() === name) as HTMLButtonElement | undefined;
}

function button(name: string): HTMLButtonElement {
  const found = findButton(name);
  if (!found) throw new Error(`找不到按鈕：${name}`);
  return found;
}

function dialog(): HTMLElement | null {
  return document.querySelector('dialog') as HTMLElement | null;
}

function footerButton(name: string): HTMLButtonElement {
  const dlg = dialog();
  if (!dlg) throw new Error('沒有確認框');
  const footer = dlg.querySelector('footer');
  const scope: ParentNode = footer ?? dlg;
  const found = [...scope.querySelectorAll('button')].find((node) => (node.textContent ?? '').trim() === name);
  if (!found) throw new Error(`footer 找不到按鈕：${name}`);
  return found as HTMLButtonElement;
}

function armedButton(): HTMLButtonElement {
  const dlg = dialog();
  if (!dlg) throw new Error('沒有確認框');
  const found = dlg.querySelector('[data-confirm-armed]');
  if (!found) throw new Error('找不到 armed 按鈕');
  return found as HTMLButtonElement;
}

/** 原因欄的 label 後面另有「必填」字樣，用確認框裡唯一的 textarea 找。label 只做存在檢查。 */
function fillTextarea(label: string, value: string): void {
  const dlg = document.querySelector('dialog');
  if (!dlg || !(dlg.textContent ?? '').includes(label)) throw new Error(`沒有原因欄：${label}`);
  const el = dlg.querySelector('textarea');
  if (!el) throw new Error('沒有 textarea');
  fireEvent.input(el, { target: { value } });
}

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('狀態變更入口顯示', () => {
  const shown: Array<[string, Opts]> = [
    ['管理員', { actor: adminActor }],
    ['個人主辦', { actor: hostActor, staff: ['host'], comp: PERSONAL }],
    ['俱樂部代表', { actor: clubRepActor }],
    ['共同主辦（個人賽事）', { actor: coHostActor, staff: ['coHost'], comp: PERSONAL }],
    ['共同主辦（俱樂部賽事）', { actor: coHostActor, staff: ['coHost'] }],
    // 後端 hostAccess：俱樂部賽事不是目前代表時改看 staff roles，含 host 就放行（與編輯、排賽程同一條 canHostOrCo）。
    ['前代表（俱樂部賽事上仍有 staff host）', { actor: formerRepActor, staff: ['host'] }],
  ];
  const hidden: Array<[string, Opts]> = [
    // Opus 審 P3-4：前代表沒有 staff 角色時後端 hostAccess 回 NOT_HOST（不可改成 isPrimaryHostView 這類只看代表的判斷）。
    ['前代表（沒有 staff 角色）', { actor: formerRepActor }],
    ['一般用戶', { actor: memberActor }],
    ['未登入', { actor: guestActor }],
  ];

  it.each(shown)('%s 看得到入口', async (_label, opts) => {
    draw(env(opts));
    await screen.findByText('示範盃');
    expect(findButton('延期或取消賽事')).toBeTruthy();
  });

  it.each(hidden)('%s 看不到入口', async (_label, opts) => {
    draw(env(opts));
    await screen.findByText('示範盃');
    expect(findButton('延期或取消賽事')).toBeUndefined();
    expect(findButton('恢復或取消賽事')).toBeUndefined();
  });

  it('入口在「編輯賽事」之後、「刪除賽事」之前', async () => {
    draw(env({ actor: adminActor }));
    await screen.findByText('示範盃');
    const all = [...document.querySelectorAll('button')].map((node) => (node.textContent ?? '').trim());
    const idx = all.indexOf('延期或取消賽事');
    expect(idx).toBeGreaterThan(all.indexOf('編輯賽事'));
    expect(idx).toBeLessThan(all.indexOf('刪除賽事'));
  });
});

describe('狀態顯示規則', () => {
  it('草稿看不到', async () => {
    draw(env({ actor: hostActor, staff: ['host'], comp: { ...PERSONAL, status: 'draft' } }));
    await screen.findByText('示範盃');
    expect(findButton('延期或取消賽事')).toBeUndefined();
  });

  it('已取消看不到', async () => {
    draw(env({ actor: hostActor, staff: ['host'], comp: { ...PERSONAL, status: 'cancelled' } }));
    await screen.findByText('示範盃');
    expect(findButton('延期或取消賽事')).toBeUndefined();
  });

  it('已結束（endedAt 有值、endedBy host）看不到', async () => {
    draw(env({ actor: hostActor, staff: ['host'], comp: { ...PERSONAL, endedAt: NOW, endedBy: 'host' } }));
    await screen.findByText('示範盃');
    expect(findButton('延期或取消賽事')).toBeUndefined();
  });

  it('延期中主辦看到「恢復或取消賽事」', async () => {
    draw(env({ actor: hostActor, staff: ['host'], comp: { ...PERSONAL, status: 'postponed' } }));
    await screen.findByText('示範盃');
    expect(findButton('恢復或取消賽事')).toBeTruthy();
    expect(findButton('延期或取消賽事')).toBeUndefined();
  });

  it('下架時主辦看不到、管理員看得到', async () => {
    draw(env({ actor: hostActor, staff: ['host'], comp: { ...PERSONAL, hidden: true, hiddenReason: '資料不實' } }));
    await screen.findByText('示範盃');
    expect(findButton('延期或取消賽事')).toBeUndefined();
    cleanup();
    draw(env({ actor: adminActor, comp: { hidden: true, hiddenReason: '資料不實' } }));
    await screen.findByText('示範盃');
    expect(findButton('延期或取消賽事')).toBeTruthy();
  });

  it('刪除中主辦與管理員都看不到', async () => {
    draw(env({ actor: hostActor, staff: ['host'], comp: { ...PERSONAL, hidden: true, deletingAt: NOW - 60_000 } }));
    await screen.findByText('示範盃');
    expect(findButton('延期或取消賽事')).toBeUndefined();
    cleanup();
    draw(env({ actor: adminActor, comp: { hidden: true, deletingAt: NOW - 60_000 } }));
    await screen.findByText('示範盃');
    expect(findButton('延期或取消賽事')).toBeUndefined();
  });
});

describe('狀態確認框', () => {
  it('延期流程：指定原因後送出，參數正確、入口變恢復', async () => {
    const setCompetitionStatus = vi.fn(async (input: { cid: string; status: string; reason?: string }) => ({ cid: input.cid, status: input.status }));
    const actions: CpActions = { ...idleActions(), setCompetitionStatus: setCompetitionStatus as unknown as CpActions['setCompetitionStatus'] };
    draw(env({ actor: hostActor, staff: ['host'], comp: PERSONAL, actions }));
    await screen.findByText('示範盃');
    fireEvent.click(button('延期或取消賽事'));
    await waitFor(() => expect(dialog()).toBeTruthy());
    fireEvent.click(screen.getByLabelText('延期（日期另行公布）'));
    fillTextarea('原因（會公開）', '場地整修');
    fireEvent.click(footerButton('確定延期'));
    await waitFor(() => {
      expect(setCompetitionStatus).toHaveBeenCalledTimes(1);
      expect(setCompetitionStatus).toHaveBeenCalledWith({ cid: 'cup', status: 'postponed', reason: '場地整修' });
    });
    await waitFor(() => expect(dialog()).toBeNull());
    await screen.findByText('恢復或取消賽事');
  });

  it('取消流程：勾選後按鈕解鎖，參數正確、入口消失', async () => {
    const setCompetitionStatus = vi.fn(async (input: { cid: string; status: string; reason?: string }) => ({ cid: input.cid, status: input.status }));
    const actions: CpActions = { ...idleActions(), setCompetitionStatus: setCompetitionStatus as unknown as CpActions['setCompetitionStatus'] };
    draw(env({ actor: hostActor, staff: ['host'], comp: PERSONAL, actions }));
    await screen.findByText('示範盃');
    fireEvent.click(button('延期或取消賽事'));
    await waitFor(() => expect(dialog()).toBeTruthy());
    fireEvent.click(screen.getByLabelText('取消賽事'));
    fillTextarea('原因（會公開）', '颱風');
    const before = armedButton();
    expect(before.disabled).toBe(true);
    expect(before.getAttribute('data-confirm-armed')).toBe('false');
    fireEvent.click(screen.getByLabelText('我了解取消後不能恢復'));
    await waitFor(() => expect(armedButton().getAttribute('data-confirm-armed')).toBe('true'), { timeout: 2000 });
    fireEvent.click(armedButton());
    await waitFor(() => {
      expect(setCompetitionStatus).toHaveBeenCalledWith({ cid: 'cup', status: 'cancelled', reason: '颱風' });
    });
    await waitFor(() => expect(findButton('延期或取消賽事')).toBeUndefined());
    expect(findButton('恢復或取消賽事')).toBeUndefined();
  });

  it('恢復流程：沒有原因欄，參數正確', async () => {
    const setCompetitionStatus = vi.fn(async (input: { cid: string; status: string }) => ({ cid: input.cid, status: input.status }));
    const actions: CpActions = { ...idleActions(), setCompetitionStatus: setCompetitionStatus as unknown as CpActions['setCompetitionStatus'] };
    draw(env({ actor: hostActor, staff: ['host'], comp: { ...PERSONAL, status: 'postponed' }, actions }));
    await screen.findByText('示範盃');
    fireEvent.click(button('恢復或取消賽事'));
    await waitFor(() => expect(dialog()).toBeTruthy());
    fireEvent.click(screen.getByLabelText('恢復賽事'));
    await waitFor(() => expect(document.querySelector('dialog textarea')).toBeNull());
    fireEvent.click(footerButton('確定恢復'));
    await waitFor(() => {
      expect(setCompetitionStatus).toHaveBeenCalledWith({ cid: 'cup', status: 'published' });
    });
  });

  it('失敗：STATUS_TRANSITION 顯示 alert、入口不變', async () => {
    const setCompetitionStatus = vi.fn(async () => { throw new CpCallError('STATUS_TRANSITION', {}); });
    const actions: CpActions = { ...idleActions(), setCompetitionStatus: setCompetitionStatus as unknown as CpActions['setCompetitionStatus'] };
    draw(env({ actor: hostActor, staff: ['host'], comp: PERSONAL, actions }));
    await screen.findByText('示範盃');
    fireEvent.click(button('延期或取消賽事'));
    await waitFor(() => expect(dialog()).toBeTruthy());
    fireEvent.click(screen.getByLabelText('延期（日期另行公布）'));
    fillTextarea('原因（會公開）', '場地整修');
    fireEvent.click(footerButton('確定延期'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('賽事目前的狀態不能這樣改');
    expect(findButton('延期或取消賽事')).toBeTruthy();
    expect(findButton('恢復或取消賽事')).toBeUndefined();
  });
});
