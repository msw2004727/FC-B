// 刪除賽事：詳情頁主辦區的危險鈕、確認框、成功導回列表、錯誤文字、刪到一半續刪。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocationProvider } from 'preact-iso';
import { toast } from '@/ui/Toast';
import type { CpActions } from '../actions';
import { CpCallError } from '../data/cp-callables';
import type { CompetitionDoc, DivisionDoc, StaffRole } from '../data/types';
import { CpEnvProvider, type CpActor, type CpInjectedEnv } from '../env';
import { taipeiMs } from '../format';
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
import { DELETE_ARM_MS } from '../ui/delete-competition';
import CompetitionDetailPage from './CompetitionDetailPage';

const LIVE = taipeiMs(2027, 1, 9, 10, 0);
const DIVS: DivisionDoc[] = [{ ...adultDivision, entryCount: 3 }, { ...youthDivision, entryCount: 2 }];
const PERSONAL: Partial<CompetitionDoc> = { hostType: 'personal', hostTeamId: null, feeNote: null };
const STUCK: Partial<CompetitionDoc> = { hidden: true, hiddenReason: null, deletingAt: NOW - 60_000 };

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

function dialog(): HTMLElement {
  const node = document.querySelector('dialog');
  if (!node) throw new Error('沒有確認框');
  return node as HTMLElement;
}

function confirmButton(): HTMLButtonElement {
  const found = dialog().querySelector('[data-delete-armed]');
  if (!found) throw new Error('找不到確認鈕');
  return found as HTMLButtonElement;
}

async function openAndArm(name = '刪除賽事'): Promise<void> {
  fireEvent.click(button(name));
  fireEvent.click(screen.getByLabelText('我了解刪除後無法復原'));
  await waitFor(() => expect(confirmButton().getAttribute('data-delete-armed')).toBe('true'), { timeout: 2000 });
}

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('刪除鈕顯示', () => {
  const shown: Array<[string, Opts]> = [
    ['管理員', { actor: adminActor }],
    ['個人主辦', { actor: hostActor, staff: ['host'], comp: PERSONAL }],
    ['俱樂部代表', { actor: clubRepActor }],
  ];
  const hidden: Array<[string, Opts]> = [
    ['前代表（俱樂部賽事上仍有 staff host）', { actor: formerRepActor, staff: ['host'] }],
    ['共同主辦（個人賽事）', { actor: coHostActor, staff: ['coHost'], comp: PERSONAL }],
    ['共同主辦（俱樂部賽事）', { actor: coHostActor, staff: ['coHost'] }],
    ['一般用戶', { actor: memberActor }],
    ['未登入', { actor: guestActor }],
  ];

  it.each(shown)('%s 看得到', async (_label, opts) => {
    draw(env(opts));
    await screen.findByText('示範盃');
    expect(findButton('刪除賽事')).toBeTruthy();
  });

  it.each(hidden)('%s 看不到', async (_label, opts) => {
    draw(env(opts));
    await screen.findByText('示範盃');
    expect(findButton('刪除賽事')).toBeUndefined();
  });

  it('刪除鈕在主辦區最下方（在報隊管理、賽程管理之後）', async () => {
    draw(env({ actor: hostActor, staff: ['host'], comp: PERSONAL }));
    await screen.findByText('示範盃');
    const all = [...document.querySelectorAll('button')].map((node) => (node.textContent ?? '').trim());
    const del = all.indexOf('刪除賽事');
    expect(del).toBeGreaterThan(all.indexOf('報隊管理'));
    expect(del).toBeGreaterThan(all.indexOf('賽程管理'));
    expect(button('刪除賽事').className).toContain('ui-button--danger');
  });

  it('首場開始後主辦看不到，管理員仍看得到', async () => {
    draw(env({ actor: hostActor, staff: ['host'], comp: PERSONAL, now: LIVE }));
    await screen.findAllByText('示範盃');
    expect(findButton('刪除賽事')).toBeUndefined();
    cleanup();
    draw(env({ actor: clubRepActor, now: LIVE }));
    await screen.findAllByText('示範盃');
    expect(findButton('刪除賽事')).toBeUndefined();
    cleanup();
    draw(env({ actor: adminActor, now: LIVE }));
    await screen.findAllByText('示範盃');
    expect(findButton('刪除賽事')).toBeTruthy();
  });

  it('被下架時主辦看不到，管理員仍看得到', async () => {
    draw(env({ actor: hostActor, staff: ['host'], comp: { ...PERSONAL, hidden: true, hiddenReason: '資料不實' } }));
    await screen.findByText('示範盃');
    expect(findButton('刪除賽事')).toBeUndefined();
    cleanup();
    draw(env({ actor: adminActor, comp: { hidden: true, hiddenReason: '資料不實' } }));
    await screen.findByText('示範盃');
    expect(findButton('刪除賽事')).toBeTruthy();
  });
});

describe('確認框', () => {
  it('寫出名稱、報隊數與無法復原；焦點在取消；取消在左、刪除在右', async () => {
    draw(env({ actor: hostActor, staff: ['host'], comp: PERSONAL }));
    await screen.findByText('示範盃');
    fireEvent.click(button('刪除賽事'));
    const box = dialog();
    expect(box.textContent).toContain('示範盃');
    expect(box.textContent).toContain('已有 5 隊報名');
    expect(box.textContent).toContain('報隊、名單、賽程、比分會全部刪除，無法復原');
    await waitFor(() => expect((document.activeElement?.textContent ?? '').trim()).toBe('取消'));
    const footer = [...box.querySelectorAll('footer button')].map((node) => (node.textContent ?? '').trim());
    expect(footer).toEqual(['取消', '刪除賽事']);
  });

  it('沒勾不能按；勾了 0.6 秒內也不能按；時間到才送出', async () => {
    const deleteCompetition = vi.fn(async ({ cid }: { cid: string }) => ({ cid, deleted: true as const }));
    draw(env({ actor: hostActor, staff: ['host'], comp: PERSONAL, actions: { ...idleActions(), deleteCompetition } }));
    await screen.findByText('示範盃');
    fireEvent.click(button('刪除賽事'));
    expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(confirmButton());
    await new Promise((resolve) => setTimeout(resolve, DELETE_ARM_MS + 100));
    expect(confirmButton().getAttribute('data-delete-armed')).toBe('false');
    fireEvent.click(confirmButton());
    expect(deleteCompetition).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('我了解刪除後無法復原'));
    expect(confirmButton().getAttribute('data-delete-armed')).toBe('false');
    fireEvent.click(confirmButton());
    await new Promise((resolve) => setTimeout(resolve, DELETE_ARM_MS / 2));
    expect(confirmButton().getAttribute('data-delete-armed')).toBe('false');
    fireEvent.click(confirmButton());
    expect(deleteCompetition).not.toHaveBeenCalled();

    await waitFor(() => expect(confirmButton().getAttribute('data-delete-armed')).toBe('true'), { timeout: 2000 });
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(deleteCompetition).toHaveBeenCalledTimes(1));
    expect(deleteCompetition).toHaveBeenCalledWith({ cid: 'cup' });
  });

  it('取消勾選後重新計時', async () => {
    draw(env({ actor: adminActor }));
    await screen.findByText('示範盃');
    await openAndArm();
    fireEvent.click(screen.getByLabelText('我了解刪除後無法復原'));
    expect(confirmButton().getAttribute('data-delete-armed')).toBe('false');
    fireEvent.click(screen.getByLabelText('我了解刪除後無法復原'));
    expect(confirmButton().getAttribute('data-delete-armed')).toBe('false');
  });

  it('手上沒有組別（首場後）打開時讀一次組別算報隊數', async () => {
    const repo = createFakeCpRepo({ divisions: { cup: DIVS } });
    draw(env({ actor: adminActor, now: LIVE, divisions: [], repo }));
    await screen.findAllByText('示範盃');
    expect(repo.calls()).not.toContain('listDivisions');
    fireEvent.click(button('刪除賽事'));
    await waitFor(() => expect(dialog().textContent).toContain('已有 5 隊報名'));
    expect(repo.calls().filter((name) => name === 'listDivisions')).toHaveLength(1);
  });
});

describe('刪除成功', () => {
  it('提示一句、取代歷史回賽事列表、清隊徽快取', async () => {
    const show = vi.spyOn(toast, 'show');
    const repo = createFakeCpRepo();
    const invalidate = vi.spyOn(repo, 'invalidateCrests');
    history.replaceState(null, '', '/tournaments');
    history.pushState(null, '', '/competitions/cup');
    draw(env({ actor: clubRepActor, repo }));
    await screen.findByText('示範盃');
    await openAndArm();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(window.location.pathname).toBe('/tournaments'));
    expect(document.querySelector('dialog')).toBeNull();
    // 詳情那筆被列表取代：返回只回到原本的列表，不會回到已刪除的賽事。
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.location.pathname).toBe('/tournaments');
    expect(show).toHaveBeenCalledWith({ message: '賽事已刪除' });
    expect(invalidate).toHaveBeenCalledWith('cup');
  });

  it('伺服器回 COMPETITION_NOT_FOUND（已刪完）也當成功', async () => {
    const deleteCompetition = vi.fn(async () => { throw new CpCallError('COMPETITION_NOT_FOUND', {}); });
    draw(env({ actor: adminActor, actions: { ...idleActions(), deleteCompetition } }));
    await screen.findByText('示範盃');
    await openAndArm();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(window.location.pathname).toBe('/tournaments'));
  });
});

describe('錯誤文字', () => {
  const cases: Array<[string, string]> = [
    ['DELETE_AFTER_START', '比賽已開始，不能刪除；請改用結束賽事'],
    ['COMPETITION_HIDDEN', '這場賽事目前不公開'],
    ['NOT_PRIMARY_HOST', '只有主要主辦可以做這個操作'],
    ['DELETE_FAILED', '刪除沒有完成，請再試一次'],
  ];

  it.each(cases)('%s → %s，停在確認框、不重讀賽事以外的資料', async (reason, text) => {
    const repo = createFakeCpRepo({ competitions: [competition(PERSONAL)] });
    const deleteCompetition = vi.fn(async () => { throw new CpCallError(reason, {}); });
    draw(env({ actor: hostActor, staff: ['host'], comp: PERSONAL, repo, actions: { ...idleActions(), deleteCompetition } }));
    await screen.findByText('示範盃');
    await openAndArm();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(dialog().textContent).toContain(text));
    expect(window.location.pathname).not.toBe('/tournaments');
  });

  it('封鎖前就被拒（例如比賽已開始）不重讀根文件', async () => {
    const repo = createFakeCpRepo({ competitions: [competition(PERSONAL)] });
    const deleteCompetition = vi.fn(async () => { throw new CpCallError('DELETE_AFTER_START', {}); });
    draw(env({ actor: hostActor, staff: ['host'], comp: PERSONAL, repo, actions: { ...idleActions(), deleteCompetition } }));
    await screen.findByText('示範盃');
    await openAndArm();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(dialog().textContent).toContain('比賽已開始'));
    expect(repo.calls()).not.toContain('getCompetition');
  });
});

describe('刪到一半（deletingAt）', () => {
  it('主辦看到續刪提示與「繼續刪除」，不顯示管理員下架', async () => {
    draw(env({ actor: hostActor, staff: ['host'], comp: { ...PERSONAL, ...STUCK } }));
    await screen.findByText('示範盃');
    expect(document.body.textContent).toContain('刪除沒有完成，請按下方「繼續刪除」');
    expect(document.body.textContent).not.toContain('此賽事已被管理員下架');
    expect(findButton('繼續刪除')).toBeTruthy();
    expect(findButton('刪除賽事')).toBeUndefined();
  });

  it('共同主辦只看到刪除中，沒有按鈕；首場後主辦也只看到刪除中、管理員仍可續刪', async () => {
    draw(env({ actor: coHostActor, staff: ['coHost'], comp: { ...PERSONAL, ...STUCK } }));
    await screen.findByText('示範盃');
    expect(document.body.textContent).toContain('這場賽事正在刪除中');
    expect(findButton('繼續刪除')).toBeUndefined();
    cleanup();
    draw(env({ actor: hostActor, staff: ['host'], comp: { ...PERSONAL, ...STUCK }, now: LIVE }));
    await screen.findAllByText('示範盃');
    expect(document.body.textContent).toContain('這場賽事正在刪除中');
    expect(findButton('繼續刪除')).toBeUndefined();
    cleanup();
    draw(env({ actor: adminActor, comp: STUCK, now: LIVE }));
    await screen.findAllByText('示範盃');
    expect(findButton('繼續刪除')).toBeTruthy();
  });

  it('按「繼續刪除」再呼叫一次 delete，成功後回列表', async () => {
    const deleteCompetition = vi.fn(async ({ cid }: { cid: string }) => ({ cid, deleted: true as const }));
    draw(env({ actor: clubRepActor, comp: STUCK, actions: { ...idleActions(), deleteCompetition } }));
    await screen.findByText('示範盃');
    await openAndArm('繼續刪除');
    expect(dialog().querySelector('h2')?.textContent).toContain('繼續刪除');
    fireEvent.click(confirmButton());
    await waitFor(() => expect(window.location.pathname).toBe('/tournaments'));
    expect(deleteCompetition).toHaveBeenCalledWith({ cid: 'cup' });
  });

  it('中途失敗：重讀到 deletingAt，同一顆鈕改成「繼續刪除」，確認框留著顯示錯誤', async () => {
    const stuckDoc = competition({ ...PERSONAL, ...STUCK });
    const repo = createFakeCpRepo({ competitions: [stuckDoc] });
    const deleteCompetition = vi.fn(async () => { throw new CpCallError('UNKNOWN', {}); });
    draw(env({ actor: hostActor, staff: ['host'], comp: PERSONAL, repo, actions: { ...idleActions(), deleteCompetition } }));
    await screen.findByText('示範盃');
    await openAndArm();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(document.body.textContent).toContain('刪除沒有完成，請按下方「繼續刪除」'));
    expect(dialog().textContent).toContain('操作失敗，請稍後再試');
    expect(findButton('繼續刪除')).toBeTruthy();
    expect(repo.calls()).toContain('getCompetition');
  });

  it('中途失敗但重讀發現已不存在（其實刪完了）：當成功回列表', async () => {
    const repo = createFakeCpRepo({ competitions: [] });
    const deleteCompetition = vi.fn(async () => { throw new CpCallError('UNKNOWN', {}); });
    draw(env({ actor: adminActor, repo, actions: { ...idleActions(), deleteCompetition } }));
    await screen.findByText('示範盃');
    await openAndArm();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(window.location.pathname).toBe('/tournaments'));
  });
});
