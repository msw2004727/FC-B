// 編輯賽事（站長 11-21：建賽後缺少像活動系統那樣的編輯功能）：建賽精靈同一份表單，網址 /competitions/new?edit=<cid>。
// 預填、只送有變的鍵、依狀態鎖欄位、後端錯誤對回欄位、入口可見性、取消比對預填值；建立模式不受影響。
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import type { ComponentType } from 'preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { markHistoryRoot } from '@/core/back-guard';
import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import { canEditCompetition } from '../access';
import type { CpActions } from '../actions';
import { CpCallError, type CpHostUpdateInput } from '../data/cp-callables';
import type { CompetitionDoc, StaffDoc } from '../data/types';
import { CpEnvProvider, type CpActor, type CpInjectedEnv } from '../env';
import { taipeiMs, toDatetimeLocalValue } from '../format';
import { loadCompetitionsDict } from '../i18n';
import { buildUpdateInput, type EditDraft } from '../payload';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import {
  FIRST_MATCH,
  LAST_MATCH,
  NOW,
  REG_CLOSE,
  REG_OPEN,
  adminActor,
  clubRepActor,
  coHostActor,
  competition,
  editBundle,
  hostActor,
  idleActions,
  manageBundle,
  memberActor,
  screenEnv,
} from '../testing/screen-fixtures';
import CompetitionDetailPage from './CompetitionDetailPage';
import CompetitionManagePage from './CompetitionManagePage';
import NewCompetitionPage from './NewCompetitionPage';
import { editErrorField } from './edit-competition';
import { step1Problem } from './new-competition-check';

const EDIT_URL = '/competitions/new?edit=cup';
const LIVE_NOW = taipeiMs(2027, 1, 9, 12, 0);

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

beforeEach(() => {
  // 直開編輯頁（歷史起點）：返回取代成賽事詳情。
  history.replaceState(null, '', EDIT_URL);
  markHistoryRoot();
});

afterEach(() => {
  cleanup();
  _resetAppConfirmForTest();
  _resetOverlayBackForTest();
  vi.restoreAllMocks();
});

interface DrawOpts {
  personal?: boolean;
  locked?: boolean;
  actor?: CpActor;
  staff?: StaffDoc | null;
  comp?: Partial<CompetitionDoc>;
  now?: number;
  update?: CpActions['update'];
}

function editEnv(opts: DrawOpts = {}): CpInjectedEnv {
  const b = editBundle({ personal: opts.personal, locked: opts.locked });
  return {
    actor: opts.actor ?? hostActor,
    repo: createFakeCpRepo(),
    actions: { ...idleActions(), ...(opts.update ? { update: opts.update } : {}) },
    now: opts.now ?? NOW,
    bundle: {
      ...b,
      competition: { ...b.competition!, ...opts.comp },
      staff: opts.staff === undefined ? b.staff : opts.staff,
    },
  };
}

function draw(env: CpInjectedEnv, Page: ComponentType = NewCompetitionPage) {
  return render(
    <LocationProvider>
      <CpEnvProvider value={env}>
        <Page />
      </CpEnvProvider>
      <AppConfirmHost />
    </LocationProvider>,
  );
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const byId = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const row = () => document.querySelector('.cph-split') as HTMLElement;
const rowButton = (name: string) => [...row().querySelectorAll('button')].find((node) => node.textContent === name) as HTMLButtonElement;
const type = (id: string, value: string) => fireEvent.input(byId(id), { target: { value } });

async function press(node: HTMLElement): Promise<void> {
  fireEvent.click(node);
  await flush();
}

/** 第 1 步→第 2 步→第 3 步（每一步都過檢查）。 */
async function toStep(n: 2 | 3): Promise<void> {
  await press(rowButton('下一步'));
  if (n === 3) await press(rowButton('下一步'));
}

function spyUpdate() {
  const calls: CpHostUpdateInput[] = [];
  const update = vi.fn(async (input: CpHostUpdateInput) => {
    calls.push(input);
    return { cid: input.cid };
  });
  return { calls, update };
}

async function saveWith(update: CpActions['update']): Promise<void> {
  await toStep(3);
  await press(rowButton('儲存變更'));
  await waitFor(() => expect(update).toHaveBeenCalled());
}

describe('編輯賽事：預填', () => {
  it('俱樂部主辦：標題、名稱、分類、主辦身分（停用）、俱樂部（停用）、繳費說明、聯絡、四個時間、場地都帶入', () => {
    draw(editEnv());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('編輯賽事');
    expect(byId('cpf-name').value).toBe('示範盃');
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    const host = radios.filter((node) => node.value === 'personal' || node.value === 'club');
    expect(host.map((node) => [node.value, node.checked, node.disabled])).toEqual([['personal', false, true], ['club', true, true]]);
    const club = byId<HTMLSelectElement>('cpf-club');
    expect(club.disabled).toBe(true);
    expect(club.selectedOptions[0]?.label).toBe('示範俱樂部');
    expect(byId<HTMLTextAreaElement>('cpf-fee-note').value).toBe('每隊報名費 3,000 元，賽前於領隊會議現場繳交。');
    expect(byId('cpf-contact').value).toBe('LINE：@demo-cup');
    expect(byId('cp-reg-open').value).toBe(toDatetimeLocalValue(REG_OPEN));
    expect(byId('cp-reg-close').value).toBe(toDatetimeLocalValue(REG_CLOSE));
    expect(byId('cp-first').value).toBe(toDatetimeLocalValue(FIRST_MATCH));
    expect(byId('cp-last').value).toBe(toDatetimeLocalValue(LAST_MATCH));
    expect(byId('cpf-v0-name').value).toBe('示範球場');
    expect(byId('cpf-v0-address').value).toBe('示範路 1 號');
    expect(screen.getByText('已設定地圖座標')).toBeTruthy();
    // 建立才有的主辦名稱欄，俱樂部主辦不出現
    expect(byId('cpf-host-display')).toBeNull();
  });

  it('個人主辦：多一欄主辦名稱，沒有俱樂部與繳費說明', () => {
    draw(editEnv({ personal: true }));
    expect(byId('cpf-host-display').value).toBe('王示範');
    expect(byId('cpf-club')).toBeNull();
    expect(byId('cpf-fee-note')).toBeNull();
  });

  it('第 2 步組別照順序帶入（名稱、人制、隊數），第 3 步主鈕「儲存變更」、沒有草稿標籤與草稿說明', async () => {
    draw(editEnv());
    await toStep(2);
    expect(byId('cpf-d0-name').value).toBe('成人組');
    expect(byId('cpf-d1-name').value).toBe('新秀組');
    expect(byId('cpf-d1-maxTeams').textContent).toContain('6');
    await press(rowButton('下一步'));
    expect(screen.getByText('確認變更')).toBeTruthy();
    expect(rowButton('儲存變更')).toBeTruthy();
    expect(screen.queryByText('草稿')).toBeNull();
    expect(screen.queryByText('建立後是草稿，發布後才會公開招募')).toBeNull();
    expect(button('取消編輯')).toBeTruthy();
  });
});

describe('編輯賽事：只送有變的欄位', () => {
  it('只改名稱：只送 cid 與 name；成功跳「已儲存」並回到賽事頁', async () => {
    const { calls, update } = spyUpdate();
    const shown = vi.spyOn(toast, 'show');
    draw(editEnv({ update }));
    type('cpf-name', '示範盃改名');
    await saveWith(update);
    expect(calls).toEqual([{ cid: 'cup', name: '示範盃改名' }]);
    expect(shown).toHaveBeenCalledWith({ message: '已儲存' });
    await waitFor(() => expect(location.pathname).toBe('/competitions/cup'));
  });

  it('從報隊管理進來：儲存後退回報隊管理', async () => {
    history.replaceState(null, '', '/competitions/cup/manage');
    history.pushState(null, '', EDIT_URL);
    const { update } = spyUpdate();
    draw(editEnv({ update }));
    type('cpf-contact', '');
    await saveWith(update);
    await waitFor(() => expect(location.pathname).toBe('/competitions/cup/manage'));
  });

  it('只改報名截止：四個時間一起送，其他三個是原值', async () => {
    const { calls, update } = spyUpdate();
    draw(editEnv({ update }));
    type('cp-reg-close', '2026-12-25T20:00');
    await saveWith(update);
    expect(calls).toEqual([{
      cid: 'cup',
      schedule: { regOpenAt: REG_OPEN, regCloseAt: taipeiMs(2026, 12, 25, 20, 0), firstMatchAt: FIRST_MATCH, lastMatchAt: LAST_MATCH },
    }]);
  });

  it('清空聯絡文字送 null', async () => {
    const { calls, update } = spyUpdate();
    draw(editEnv({ update }));
    type('cpf-contact', '');
    await saveWith(update);
    expect(calls).toEqual([{ cid: 'cup', contactNote: null }]);
  });

  it('改組別名稱：送完整清單、保留 dvId 與原本規則', async () => {
    const { calls, update } = spyUpdate();
    draw(editEnv({ update }));
    await toStep(2);
    type('cpf-d1-name', '新秀 A 組');
    await press(rowButton('下一步'));
    await press(rowButton('儲存變更'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(calls[0]?.divisions?.map((d) => [d.dvId, d.name, d.maxTeams, d.feePerTeam])).toEqual([
      ['dv_adult', '成人組', 8, 1500],
      ['dv_rookie', '新秀 A 組', 6, 800],
    ]);
    expect(Object.keys(calls[0] ?? {})).toEqual(['cid', 'divisions']);
  });

  it('新增一組沒有 dvId；刪掉沒有報隊的組別就不在清單裡', async () => {
    const { calls, update } = spyUpdate();
    draw(editEnv({ update }));
    await toStep(2);
    await press(button('新增組別'));
    type('cpf-d2-name', '女子組');
    // 移除第 2 組（新秀組，沒有報隊）
    const trash = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="移除組別"]')];
    await press(trash[1]!);
    await press(rowButton('下一步'));
    await press(rowButton('儲存變更'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(calls[0]?.divisions?.map((d) => [d.dvId ?? null, d.name])).toEqual([['dv_adult', '成人組'], [null, '女子組']]);
  });

  it('沒有任何變動：不打後端、不跳已儲存，直接回去', async () => {
    const { update } = spyUpdate();
    const shown = vi.spyOn(toast, 'show');
    draw(editEnv({ update }));
    // 改了又改回原值也算沒變
    type('cpf-name', '示範盃X');
    type('cpf-name', '示範盃');
    await toStep(3);
    await press(rowButton('儲存變更'));
    await waitFor(() => expect(location.pathname).toBe('/competitions/cup'));
    expect(update).not.toHaveBeenCalled();
    expect(shown).not.toHaveBeenCalled();
  });

  it('送出中：主鈕轉圈、上一步與取消編輯停用；連按只送一次', async () => {
    const update = vi.fn(() => new Promise<{ cid: string }>(() => {}));
    draw(editEnv({ update }));
    type('cpf-name', '示範盃改名');
    await toStep(3);
    fireEvent.click(rowButton('儲存變更'));
    fireEvent.click(rowButton('儲存變更'));
    await flush();
    expect(update).toHaveBeenCalledTimes(1);
    expect(rowButton('上一步').disabled).toBe(true);
    expect(button('取消編輯').disabled).toBe(true);
  });
});

describe('編輯賽事：依狀態鎖欄位', () => {
  it('首場已過、非管理員：四個時間停用並說原因；其他欄位可改', () => {
    draw(editEnv({ now: LIVE_NOW }));
    for (const id of ['cp-reg-open', 'cp-reg-close', 'cp-first', 'cp-last']) expect(byId(id).disabled, id).toBe(true);
    expect(document.querySelector('[data-edit-lock="times"]')?.textContent).toBe('首場已開始，時間不能再改');
    expect(byId('cpf-name').disabled).toBe(false);
  });

  it('首場已過、管理員：時間照常可改', () => {
    draw(editEnv({ now: LIVE_NOW, actor: adminActor, staff: null }));
    expect(byId('cp-first').disabled).toBe(false);
    expect(document.querySelector('[data-edit-lock="times"]')).toBeNull();
  });

  it('報名已截止但時間沒改：可以直接儲存其他欄位（不擋報名截止已過）', async () => {
    const { calls, update } = spyUpdate();
    draw(editEnv({ update, now: taipeiMs(2026, 12, 22, 12, 0) }));
    type('cpf-name', '示範盃改名');
    await saveWith(update);
    expect(calls).toEqual([{ cid: 'cup', name: '示範盃改名' }]);
  });

  it('名單已鎖定：組別只能改名稱，增刪與規則停用；改名送完整清單', async () => {
    const { calls, update } = spyUpdate();
    draw(editEnv({ locked: true, update }));
    await toStep(2);
    expect(document.querySelector('[data-edit-lock="divisions"]')?.textContent).toBe('名單已鎖定，組別只能改名稱');
    expect(byId('cpf-d1-name').disabled).toBe(false);
    for (const node of document.querySelectorAll<HTMLButtonElement>('button[aria-label="移除組別"]')) expect(node.disabled).toBe(true);
    expect(button('新增組別').disabled).toBe(true);
    const card = byId('cpf-d1-name').closest('.cps-card') as HTMLElement;
    const controls = [...card.querySelectorAll<HTMLButtonElement>('.ui-chip button, .ui-stepper button, .ui-switch__button')];
    expect(controls.length).toBeGreaterThan(5);
    expect(controls.every((node) => node.disabled)).toBe(true);
    type('cpf-d1-name', '新秀 B 組');
    await press(rowButton('下一步'));
    await press(rowButton('儲存變更'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(calls[0]?.divisions?.map((d) => [d.dvId, d.name])).toEqual([['dv_adult', '成人組'], ['dv_rookie', '新秀 B 組']]);
  });

  it('有報隊的組別：刪除鈕停用、人制年齡實名報名費停用、隊數最少到已核准數；沒報隊的組別照常', async () => {
    draw(editEnv());
    await toStep(2);
    const trash = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="移除組別"]')];
    expect(trash.map((node) => node.disabled)).toEqual([true, false]);
    const adult = byId('cpf-d0-name').closest('.cps-card') as HTMLElement;
    const rookie = byId('cpf-d1-name').closest('.cps-card') as HTMLElement;
    expect(adult.querySelector('[data-edit-lock="rules"]')?.textContent).toBe('已有隊伍報名，部分規則不能改');
    expect(rookie.querySelector('[data-edit-lock="rules"]')).toBeNull();
    expect([...adult.querySelectorAll<HTMLButtonElement>('.ui-chip button, .ui-switch__button')].every((node) => node.disabled)).toBe(true);
    expect(byId('cpf-d0-feePerTeam').disabled).toBe(true);
    expect([...rookie.querySelectorAll<HTMLButtonElement>('.ui-chip button, .ui-switch__button')].some((node) => node.disabled)).toBe(false);
    expect(byId('cpf-d1-feePerTeam').disabled).toBe(false);
    // 隊數、名單人數仍可改（後端只鎖規則）
    expect(byId('cpf-d0-name').disabled).toBe(false);
  });
});

describe('編輯賽事：後端錯誤對回欄位', () => {
  async function failWith(reason: string, params: Record<string, unknown>, opts: DrawOpts = {}): Promise<void> {
    const update = vi.fn(async () => { throw new CpCallError(reason, params); });
    draw(editEnv({ ...opts, update }));
    if (opts.personal) type('cpf-host-display', '王示範二');
    else type('cpf-name', '示範盃改名');
    await saveWith(update);
    await flush();
  }

  it.each([
    ['COMPETITION_STARTED', { field: 'schedule' }, 'cp-reg-open', '賽事已開始，不能再改'],
    ['SCHEDULE_OUT_OF_RANGE', { field: 'schedule' }, 'cp-first', '比賽期間須涵蓋已排的場次'],
    ['SCHEDULE_PAST', { field: 'firstMatchAt' }, 'cp-first', '首場須晚於現在'],
  ])('%s → 回第 1 步，錯誤畫在 %s 並聚焦', async (reason, params, id, text) => {
    await failWith(reason, params);
    expect(screen.getByText('步驟 1／3')).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.id).toBe(id));
    expect(document.getElementById(`${id}-error`)?.textContent).toBe(text);
  });

  it.each([
    ['ROSTERS_LOCKED', { field: 'divisions' }, 'cpf-d0-name', '名單已鎖定，不能再修改'],
    ['DIVISION_HAS_ENTRIES', { field: 'divisions' }, 'cpf-d0-name', '已有報隊的組別不能刪除'],
    ['DIVISION_RULES_LOCKED', { field: 'divisions.1' }, 'cpf-d1-name', '已有隊伍報名，部分規則不能改'],
  ])('%s → 回第 2 步，錯誤畫在 %s 並聚焦', async (reason, params, id, text) => {
    await failWith(reason, params);
    expect(screen.getByText('步驟 2／3')).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.id).toBe(id));
    expect(document.getElementById(`${id}-error`)?.textContent).toBe(text);
  });

  it('個人主辦名稱含禁用字 → 畫在主辦名稱欄', async () => {
    await failWith('BANNED_WORD', { field: 'hostDisplay' }, { personal: true });
    await waitFor(() => expect(document.activeElement?.id).toBe('cpf-host-display'));
    expect(document.getElementById('cpf-host-display-error')?.textContent).toBe('名稱包含不允許的字詞');
  });

  it('沒有對應欄位（賽事剛被取消）：留在第 3 步整頁一句，鈕可再按', async () => {
    await failWith('COMPETITION_CLOSED', {});
    expect(screen.getByText('步驟 3／3')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('賽事目前的狀態不能修改');
    expect(rowButton('儲存變更').disabled).toBe(false);
  });
});

describe('編輯賽事：取消比對預填值', () => {
  it('沒改：不問，直接回賽事頁', async () => {
    draw(editEnv());
    await press(rowButton('取消'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(location.pathname).toBe('/competitions/cup');
  });

  it('改了又改回：視同沒改', async () => {
    draw(editEnv());
    type('cpf-contact', 'x');
    type('cpf-contact', 'LINE：@demo-cup');
    await press(rowButton('取消'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('改過：第 2 步「取消編輯」問放棄編輯；按放棄才回去，沒送任何東西', async () => {
    const { update } = spyUpdate();
    draw(editEnv({ update }));
    await toStep(2);
    type('cpf-d0-name', '成人 A 組');
    await press(button('取消編輯'));
    expect(screen.getByRole('alertdialog').textContent).toContain('變更不會保存，確定放棄編輯？');
    await press(document.getElementById('app-confirm-ok')!);
    await waitFor(() => expect(location.pathname).toBe('/competitions/cup'));
    expect(update).not.toHaveBeenCalled();
  });
});

describe('編輯賽事：誰能編輯（入口與直開網址）', () => {
  const host = { canHost: true, isAdmin: false };
  const base = competition();
  it.each([
    ['進行中的主辦', base, host, true],
    ['沒有主辦權', base, { canHost: false, isAdmin: false }, false],
    ['已取消', competition({ status: 'cancelled' }), host, false],
    ['已結束', competition({ endedAt: LAST_MATCH }), host, false],
    ['下架（主辦）', competition({ hidden: true }), host, false],
    ['下架（管理員）', competition({ hidden: true }), { canHost: true, isAdmin: true }, true],
    ['刪到一半', competition({ deletingAt: NOW }), host, false],
    ['草稿', competition({ status: 'draft' }), host, true],
  ] as const)('%s', (_label, doc, input, ok) => {
    expect(canEditCompetition(doc, input)).toBe(ok);
  });

  it.each([
    ['主辦（staff host）', hostActor, { uid: 'uid_host', roles: ['host'] }],
    ['共同主辦', coHostActor, { uid: 'uid_co', roles: ['coHost'] }],
    ['管理員', adminActor, null],
    ['俱樂部目前代表', clubRepActor, null],
  ] as const)('%s：直開網址看到表單', (_label, actor, staff) => {
    draw(editEnv({ actor, staff: staff as StaffDoc | null }));
    expect(byId('cpf-name').value).toBe('示範盃');
  });

  it.each([
    ['一般會員', { actor: memberActor, staff: null }],
    ['未登入', { actor: { ...memberActor, uid: null }, staff: null }],
    ['已取消', { comp: { status: 'cancelled' as const } }],
    ['已結束', { comp: { endedAt: LAST_MATCH } }],
    ['下架（主辦）', { comp: { hidden: true } }],
  ])('%s：直開網址顯示不能編輯', (_label, opts) => {
    draw(editEnv(opts as DrawOpts));
    expect(byId('cpf-name')).toBeNull();
    expect(document.querySelector('[data-cp-load="edit-denied"]')?.textContent).toBe('這場賽事目前不能編輯');
    expect(button('回賽事頁')).toBeTruthy();
  });

  it('沒注入資料：讀根文件、組別、staff 各一次（不讀報隊），讀到就預填', async () => {
    const repo = createFakeCpRepo({
      competitions: [competition()],
      divisions: { cup: editBundle().divisions },
      staff: { cup: [{ uid: 'uid_host', roles: ['host'] }] },
    });
    draw({ actor: hostActor, repo, actions: idleActions(), now: NOW });
    await waitFor(() => expect(byId('cpf-name')?.value).toBe('示範盃'));
    expect([...repo.calls()].sort()).toEqual(['getCompetition', 'getStaff', 'listDivisions']);
  });

  const doors = () => [...document.querySelectorAll('.cph-doors button')].map((node) => node.textContent);
  it('報隊管理：主辦區最後一顆「編輯賽事」，按了進編輯頁；快速「編輯賽事資訊」照舊', async () => {
    history.replaceState(null, '', '/competitions/cup/manage');
    draw(screenEnv('host-approved'), CompetitionManagePage);
    expect(doors()).toEqual(['排賽程', '賽程管理', '指派記分員', '編輯賽事']);
    expect(button('編輯賽事資訊')).toBeTruthy();
    await press(button('編輯賽事'));
    expect(`${location.pathname}${location.search}`).toBe(EDIT_URL);
  });

  it.each([
    ['共同主辦', coHostActor, { uid: 'uid_co', roles: ['coHost'] }, {}, true],
    ['管理員', adminActor, null, {}, true],
    ['已結束', hostActor, { uid: 'uid_host', roles: ['host'] }, { endedAt: LAST_MATCH }, false],
    ['已取消', hostActor, { uid: 'uid_host', roles: ['host'] }, { status: 'cancelled' }, false],
    ['下架（主辦）', hostActor, { uid: 'uid_host', roles: ['host'] }, { hidden: true }, false],
  ] as const)('報隊管理入口：%s', (_label, actor, staff, comp, shown) => {
    const b = manageBundle(staff as StaffDoc | null);
    draw({ ...screenEnv('host-approved'), actor, bundle: { ...b, competition: { ...b.competition!, ...comp } } }, CompetitionManagePage);
    expect(doors().includes('編輯賽事')).toBe(shown);
  });

  it('報隊管理入口：一般會員沒有主辦區', () => {
    draw({ ...screenEnv('host-approved'), actor: memberActor, bundle: manageBundle(null) }, CompetitionManagePage);
    expect(screen.queryByRole('button', { name: '編輯賽事' })).toBeNull();
  });

  it('詳情頁主辦卡：最後一列「編輯賽事」；一般會員看不到', async () => {
    history.replaceState(null, '', '/competitions/cup');
    draw(screenEnv('real-draft-host'), CompetitionDetailPage);
    await press(button('編輯賽事'));
    expect(`${location.pathname}${location.search}`).toBe(EDIT_URL);
    cleanup();
    draw(screenEnv('detail-member'), CompetitionDetailPage);
    expect(screen.queryByRole('button', { name: '編輯賽事' })).toBeNull();
  });
});

describe('建立模式不受影響', () => {
  it('/competitions/new（沒有 edit）：建立賽事標題、主辦身分可選、第 3 步「建立賽事」呼叫 create 不呼叫 update', async () => {
    history.replaceState(null, '', '/competitions/new');
    const create = vi.fn(async () => ({ cid: 'cup', dvIds: [] }));
    const update = vi.fn(async () => ({ cid: 'cup' }));
    draw({ ...screenEnv('wizard-1'), actions: { ...idleActions(), create, update } });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('建立賽事');
    expect([...document.querySelectorAll<HTMLInputElement>('input[value="personal"]')].every((node) => !node.disabled)).toBe(true);
    expect(byId('cpf-host-display')).toBeNull();
    await toStep(3);
    await press(rowButton('建立賽事'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
  });
});

describe('純函式：buildUpdateInput、step1Problem（編輯）、editErrorField', () => {
  const before: EditDraft = {
    name: '示範盃',
    category: 'league',
    hostType: 'personal',
    hostDisplay: '王示範',
    feeNote: '',
    contactNote: '',
    regOpen: '2026-12-01T09:00',
    regClose: '2026-12-20T23:59',
    firstMatch: '2027-01-09T08:00',
    lastMatch: '2027-01-10T18:00',
    venues: [{ name: '示範球場', address: '' }],
    divisions: [{ dvId: 'dv_a', name: '成人組', playersOnField: 5, maxTeams: 8, rosterMin: 7, rosterMax: 12, limitAge: false, minAge: 8, maxAge: 12, requireRealName: false, feePerTeam: 0 }],
    cover: null,
  };

  it('沒變回 null；個人主辦改主辦名稱只送 hostDisplay；換封面與移除封面', () => {
    expect(buildUpdateInput('cup', before, { ...before })).toBeNull();
    expect(buildUpdateInput('cup', before, { ...before, hostDisplay: ' 王二 ' })).toEqual({ cid: 'cup', hostDisplay: '王二' });
    const cover = { url: 'https://x/a', thumb: 'https://x/b' };
    expect(buildUpdateInput('cup', before, { ...before, cover })).toEqual({ cid: 'cup', cover });
    expect(buildUpdateInput('cup', { ...before, cover }, { ...before, cover: null })).toEqual({ cid: 'cup', cover: null });
  });

  it('個人主辦的組別報名費一律送 0；改分類只送 category', () => {
    const out = buildUpdateInput('cup', before, { ...before, divisions: [{ ...before.divisions[0]!, feePerTeam: 500, maxTeams: 10 }] });
    expect(out?.divisions).toEqual([{ dvId: 'dv_a', name: '成人組', playersOnField: 5, maxTeams: 10, rosterMin: 7, rosterMax: 12, requireRealName: false, feePerTeam: 0 }]);
    expect(buildUpdateInput('cup', before, { ...before, category: 'cup' })).toEqual({ cid: 'cup', category: 'cup' });
  });

  it('編輯的時間檢查：沒改不檢查；改了非管理員首場要在未來、管理員不擋；報名截止已過不擋', () => {
    const form = { ...before, hostTeamId: '' };
    const late = taipeiMs(2027, 1, 9, 12, 0);
    expect(step1Problem(form, late)).toEqual({ field: 'regCloseAt', reason: 'REG_CLOSED' });
    expect(step1Problem(form, late, { timesChanged: false, admin: false, hostDisplay: true })).toBeNull();
    expect(step1Problem(form, late, { timesChanged: true, admin: false, hostDisplay: true })).toEqual({ field: 'firstMatchAt', reason: 'SCHEDULE_PAST' });
    expect(step1Problem(form, late, { timesChanged: true, admin: true, hostDisplay: true })).toBeNull();
    expect(step1Problem({ ...form, hostDisplay: ' ' }, NOW, { timesChanged: false, admin: false, hostDisplay: true })).toEqual({ field: 'hostDisplay', reason: 'FIELD_REQUIRED' });
  });

  it('後端欄位對回畫面欄位', () => {
    expect(editErrorField('COMPETITION_STARTED', 'schedule')).toBe('regOpenAt');
    expect(editErrorField('SCHEDULE_OUT_OF_RANGE', 'schedule')).toBe('firstMatchAt');
    expect(editErrorField('ROSTERS_LOCKED', 'divisions')).toBe('divisions.0.name');
    expect(editErrorField('DIVISION_RULES_LOCKED', 'divisions.2')).toBe('divisions.2.name');
    expect(editErrorField('DIVISION_BELOW_APPROVED', 'divisions.1.maxTeams')).toBe('divisions.1.maxTeams');
    expect(editErrorField('BANNED_WORD', 'name')).toBe('name');
  });
});
