// 建立賽事：每一步按「下一步」就把必填與格式檢查完，沒過捲到那一欄並聚焦；後端回 params.field 時跳回那一欄的步驟。
// 條件照後端 functions-cp validate.ts／text.ts（cp4-integ2）。11-21 站長建賽在第 3 步被 FIELD_REQUIRED 擋下的根因：
// 只手打場地地址（沒在地圖選點）時，送出了 mapProvider: 'manual' 卻沒有座標，後端 venuesOf 回 venues.0.lat。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CpCallError } from '../data/cp-callables';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { setLocale } from '@/i18n/i18n';
import { loadCompetitionsDict } from '../i18n';
import { buildCreateInput, type WizardDraft } from '../payload';
import type { WizardSeed } from '../env';
import { idleActions, screenEnv, wizardSeed } from '../testing/screen-fixtures';
import { duplicateDivisionField, fieldSpot, step1Problem, step2Problem, type CheckForm } from './new-competition-check';
import NewCompetitionPage from './NewCompetitionPage';

const scrollIntoView = vi.fn();

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

beforeEach(() => {
  scrollIntoView.mockClear();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

type Seed = WizardSeed;

function draw(seedPatch: Partial<Seed> = {}, opts: { step?: 1 | 2 | 3; create?: CpInjectedEnv['actions']['create']; club?: boolean } = {}) {
  const create = vi.fn(opts.create ?? idleActions().create);
  const base = screenEnv(opts.club ? 'wizard-1-club' : 'wizard-1', { ...idleActions(), create });
  const env: CpInjectedEnv = {
    ...base,
    preview: { ...base.preview, wizardStep: opts.step ?? 1 },
    wizardSeed: { ...wizardSeed(), ...seedPatch },
  };
  const view = render(
    <LocationProvider>
      <CpEnvProvider value={env}>
        <NewCompetitionPage />
      </CpEnvProvider>
    </LocationProvider>,
  );
  return { view, create };
}

function next(): void {
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
}

function errorOf(id: string): string {
  return document.getElementById(`${id}-error`)?.textContent ?? '';
}

function expectFocused(id: string, text: string): void {
  expect(errorOf(id)).toBe(text);
  expect(document.activeElement?.id).toBe(id);
  // 顧問 §3.530：一律立即捲動（iPhone 上平滑捲動被聚焦打斷），不再用 smooth
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  expect(scrollIntoView).not.toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  // 整頁那一句不出現：錯誤只畫在欄位上
  expect(screen.queryByRole('alert')).toBeNull();
}

const division = wizardSeed().divisions[0]!;

describe('第 1 步：每一類必填與格式擋在第 1 步，捲到那一欄並聚焦', () => {
  it.each([
    ['賽事名稱空白', { name: '' }, 'cpf-name', '請填賽事名稱'],
    ['賽事名稱只有不可見字元', { name: '​​ㅤ' }, 'cpf-name', '請填賽事名稱'],
    ['賽事名稱太短', { name: '盃' }, 'cpf-name', '賽事名稱須 2～60 字'],
    ['聯絡文字有換行', { contactNote: '賽前集合\n找王示範' }, 'cpf-contact', '格式不正確'],
    ['報名開始沒填', { regOpen: '' }, 'cp-reg-open', '請填報名開始時間'],
    ['報名截止沒填', { regClose: '' }, 'cp-reg-close', '請填報名截止時間'],
    ['首場沒填', { firstMatch: '' }, 'cp-first', '請填首場時間'],
    ['最後一場沒填', { lastMatch: '' }, 'cp-last', '請填最後一場時間'],
    ['截止早於開始', { regClose: '2026-11-30T09:00' }, 'cp-reg-close', '截止須晚於開始'],
    ['首場早於截止', { firstMatch: '2026-12-19T09:00' }, 'cp-first', '首場不可早於報名截止'],
    ['最後一場早於首場', { lastMatch: '2027-01-08T09:00' }, 'cp-last', '最後一場不可早於首場'],
    ['報名期間超過 120 天', { regOpen: '2026-08-01T09:00' }, 'cp-reg-close', '報名期間最長 120 天'],
    ['比賽期間超過 180 天', { lastMatch: '2027-08-01T09:00' }, 'cp-last', '比賽期間最長 180 天'],
    ['最後一場超過兩年', { lastMatch: '2029-01-10T09:00', firstMatch: '2028-12-31T09:00' }, 'cp-last', '最後一場須在兩年內'],
    ['年份超出範圍', { regOpen: '2019-12-01T09:00' }, 'cp-reg-open', '時間不正確'],
    ['場地名稱空白', { venues: [{ name: '', address: '' }] }, 'cpf-v0-name', '請填場地名稱'],
    ['第二個場地名稱只有空白', { venues: [{ name: '甲場', address: '' }, { name: '   ', address: '' }] }, 'cpf-v1-name', '請填場地名稱'],
  ] as const)('%s', (_label, patch, id, text) => {
    draw(patch as Partial<Seed>);
    next();
    expect(screen.getByText('步驟 1／3')).toBeTruthy();
    expectFocused(id, text);
  });

  it('俱樂部主辦的繳費說明超過 500 字擋在第 1 步', () => {
    draw({ feeNote: '說'.repeat(501) }, { club: true });
    next();
    expect(screen.getByText('步驟 1／3')).toBeTruthy();
    expect(errorOf('cpf-fee-note')).toBe('繳費說明最多 500 字');
    expect(document.activeElement?.id).toBe('cpf-fee-note');
  });

  it('報名截止已過（站長 11-21 那筆：截止 11-21 00:59、早上才建立）：錯誤在截止欄', () => {
    draw({ regOpen: '2026-11-01T10:30', regClose: '2026-12-10T11:59', firstMatch: '2026-12-22T08:20', lastMatch: '2026-12-22T18:30' });
    next();
    expectFocused('cp-reg-close', '截止須晚於現在');
  });

  it('改了那一欄，欄位錯誤就收掉；全部填好才進第 2 步', () => {
    draw({ venues: [{ name: '', address: '' }] });
    next();
    expect(errorOf('cpf-v0-name')).toBe('請填場地名稱');
    fireEvent.input(document.getElementById('cpf-v0-name')!, { target: { value: '示範球場' } });
    expect(errorOf('cpf-v0-name')).toBe('');
    next();
    expect(screen.getByText('步驟 2／3')).toBeTruthy();
  });

  it('減少動態時也是立即捲到欄位（和一般情況相同）', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }),
    });
    draw({ name: '' });
    next();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  });

  it('時間欄只送 change（iOS 選擇器）也會寫進表單', () => {
    draw({ regOpen: '' });
    fireEvent.change(document.getElementById('cp-reg-open')!, { target: { value: '2026-12-01T09:00' } });
    next();
    expect(screen.getByText('步驟 2／3')).toBeTruthy();
  });
});

describe('第 2 步：組別必填與格式擋在第 2 步', () => {
  it('第二個組別名稱空白：捲到第二組的名稱欄', () => {
    draw({ divisions: [division, { ...division, name: '' }] }, { step: 2 });
    next();
    expect(screen.getByText('步驟 2／3')).toBeTruthy();
    expectFocused('cpf-d1-name', '請填組別名稱');
  });

  it('組別名稱重複（去空白、全半形後相同）也擋', () => {
    draw({ divisions: [division, { ...division, name: ` ${division.name}　` }] }, { step: 2 });
    next();
    expectFocused('cpf-d1-name', '組別名稱不可重複');
  });

  it('開了年齡限制、最小年齡大於最大年齡：錯誤畫在控制列下面並聚焦最大年齡', () => {
    draw({ divisions: [{ ...division, limitAge: true, minAge: 15, maxAge: 12 }] }, { step: 2 });
    next();
    expectFocused('cpf-d0-maxAge', '最大年齡不可小於最小年齡');
  });

  it('俱樂部的每隊報名費不是整數也擋', () => {
    draw({ divisions: [{ ...division, feePerTeam: 1.5 }] }, { step: 2, club: true });
    next();
    expect(errorOf('cpf-d0-feePerTeam')).toBe('每隊報名費須介於 0～1000000');
    expect(document.activeElement?.id).toBe('cpf-d0-feePerTeam');
  });

  it('費用、年齡限制、聯絡文字都填了，可以一路建立（不擋送出）', async () => {
    const { create } = draw({
      contactNote: 'LINE：demo',
      divisions: [{ ...division, limitAge: true, minAge: 8, maxAge: 12, feePerTeam: 1500 }],
    }, { club: true });
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });
});

describe('根因：只手打地址、沒在地圖選點', () => {
  it('送出的場地不帶地圖來源與地點編號（後端 venuesOf：沒座標帶了就回 FIELD_REQUIRED venues.0.lat）', async () => {
    const { create } = draw({ venues: [{ name: '示範球場', address: '' }] });
    fireEvent.input(screen.getByLabelText('地址（選填）'), { target: { value: '台北市中山區示範路 1 號' } });
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const input = create.mock.calls[0]?.[0];
    expect(input?.venues[0]).toEqual({ name: '示範球場', address: '台北市中山區示範路 1 號' });
  });

  it('有座標時地點編號與來源照送', () => {
    const draft = { ...baseDraft(), venues: [{ name: '甲', address: '', lat: 25, lng: 121, mapPlaceId: 'p_1', mapProvider: 'google' as const }] };
    expect(buildCreateInput(draft).venues[0]).toEqual({ name: '甲', lat: 25, lng: 121, mapPlaceId: 'p_1', mapProvider: 'google' });
  });

  it('座標狀態照建立活動的地點欄：手打地址仍是「尚未設定地圖座標」，有座標才是「已設定」與「重新設定」', () => {
    draw({ venues: [{ name: '甲', address: '' }, { name: '乙', address: '', lat: 25, lng: 121, mapPlaceId: 'p_1', mapProvider: 'google' }] });
    fireEvent.input(screen.getAllByLabelText('地址（選填）')[0]!, { target: { value: '台北市中山區示範路 1 號' } });
    expect(screen.getAllByText('尚未設定地圖座標')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '設定地圖座標' })).toHaveLength(1);
    expect(screen.getAllByText('已設定地圖座標')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '重新設定地圖座標' })).toHaveLength(1);
  });

  it('個人主辦不送 hostDisplay：顯示名稱空白或只有不可見字元也不會被後端擋（後端改讀主站顯示名，退回「主辦」）', () => {
    expect(buildCreateInput({ ...baseDraft(), hostDisplay: '' })).not.toHaveProperty('hostDisplay');
    expect(buildCreateInput({ ...baseDraft(), hostDisplay: '​' })).not.toHaveProperty('hostDisplay');
  });
});

describe('後端回 params.field：跳回那一欄的步驟、捲過去並顯示欄位錯誤', () => {
  it.each([
    ['FIELD_REQUIRED', 'venues.0.lat', '步驟 1／3', 'cpf-v0-address', '請重新在地圖選點'],
    ['FIELD_REQUIRED', 'venues.0.name', '步驟 1／3', 'cpf-v0-name', '請填場地名稱'],
    ['FIELD_LENGTH', 'name', '步驟 1／3', 'cpf-name', '賽事名稱須 2～60 字'],
    ['SCHEDULE_ORDER', 'firstMatchAt', '步驟 1／3', 'cp-first', '首場不可早於報名截止'],
    ['SCHEDULE_PAST', 'firstMatchAt', '步驟 1／3', 'cp-first', '首場須晚於現在'],
    ['FIELD_REQUIRED', 'divisions.1.name', '步驟 2／3', 'cpf-d1-name', '請填組別名稱'],
    ['FIELD_RANGE', 'divisions.0.rosterMin', '步驟 2／3', 'cpf-d0-rosterMin', '名單下限須介於 1～12'],
  ] as const)('%s %s', async (reason, field, stepText, id, text) => {
    const params = reason === 'FIELD_LENGTH' ? { field, min: 2, max: 60 } : reason === 'FIELD_RANGE' ? { field, min: 1, max: 12 } : { field };
    draw({}, { step: 3, create: async () => { throw new CpCallError(reason, params); } });
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await waitFor(() => expect(screen.getByText(stepText)).toBeTruthy());
    await waitFor(() => expect(document.activeElement?.id).toBe(id));
    expect(errorOf(id)).toBe(text);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hostDisplay：表單改不到，留在第 3 步給去個人資料的指引', async () => {
    draw({}, { step: 3, create: async () => { throw new CpCallError('FIELD_REQUIRED', { field: 'hostDisplay' }); } });
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('請到個人資料設定顯示名稱');
    expect(alert.querySelector('a')?.getAttribute('href')).toBe('/profile');
    expect(screen.getByText('步驟 3／3')).toBeTruthy();
  });

  it('沒帶欄位或畫面沒有的欄位：整頁顯示後端給的原因', async () => {
    draw({}, { step: 3, create: async () => { throw new CpCallError('HOST_QUOTA_30D', { max: 3 }); } });
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    expect((await screen.findByRole('alert')).textContent).toBe('30 天內建立的賽事已達上限');
    cleanup();
    draw({}, { step: 3, create: async () => { throw new CpCallError('FIELD_REQUIRED', { field: 'rules' }); } });
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    expect((await screen.findByRole('alert')).textContent).toBe('還有必填項目沒填');
    expect(screen.getByText('步驟 3／3')).toBeTruthy();
  });
});

describe('建立賽事照記分頁全幅：隱藏 App 頂欄與底部導覽', () => {
  it('掛載時 <html> 加 cp-score-full（與記分頁 SCORE_FULLSCREEN_CLASS 同名），離開頁面後移除', async () => {
    const { SCORE_FULLSCREEN_CLASS } = await import('./ScoringPage');
    const { view } = draw();
    expect(document.documentElement.classList.contains(SCORE_FULLSCREEN_CLASS)).toBe(true);
    view.unmount();
    expect(document.documentElement.classList.contains(SCORE_FULLSCREEN_CLASS)).toBe(false);
  });
});

describe('找不到欄位與刪除列', () => {
  it('俱樂部清單還在讀（下拉沒畫）時按下一步：退回整頁錯誤，不會按了沒反應', async () => {
    const base = screenEnv('wizard-1-club');
    const env: CpInjectedEnv = {
      ...base,
      actor: { ...base.actor, repClubs: [], repClubsPending: true },
      wizardSeed: { ...wizardSeed(), hostType: 'club', hostTeamId: '' },
      preview: { wizardStep: 1, wizardClub: true },
    };
    render(<LocationProvider><CpEnvProvider value={env}><NewCompetitionPage /></CpEnvProvider></LocationProvider>);
    next();
    expect((await screen.findByRole('alert')).textContent).toBe('請選俱樂部');
    expect(screen.getByText('步驟 1／3')).toBeTruthy();
  });

  it('刪除場地後錯誤清掉（索引會位移）', () => {
    draw({ venues: [{ name: '甲場', address: '' }, { name: '', address: '' }] });
    next();
    expect(errorOf('cpf-v1-name')).toBe('請填場地名稱');
    fireEvent.click(screen.getAllByRole('button', { name: '移除場地' })[1]!);
    expect(document.querySelectorAll('[data-field-error]')).toHaveLength(0);
  });

  it('改加減器就收掉這一組的年齡錯誤', () => {
    draw({ divisions: [{ ...division, limitAge: true, minAge: 15, maxAge: 12 }] }, { step: 2 });
    next();
    expect(errorOf('cpf-d0-maxAge')).toBe('最大年齡不可小於最小年齡');
    fireEvent.click(document.getElementById('cpf-d0-minAge')!.closest('.ui-stepper')!.querySelector('.ui-stepper__decrease')!);
    expect(errorOf('cpf-d0-maxAge')).toBe('');
  });
});

describe('檢查函式', () => {
  it('欄位路徑對應：地圖座標落在地址欄，畫面沒有的欄位回 null', () => {
    expect(fieldSpot('venues.2.mapProvider')).toEqual({ step: 1, field: 'venues.2.address', id: 'cpf-v2-address' });
    expect(fieldSpot('divisions.0.playersOnField')).toEqual({ step: 2, field: 'divisions.0.name', id: 'cpf-d0-name' });
    expect(fieldSpot('hostDisplay')).toBeNull();
    expect(fieldSpot('rules')).toBeNull();
    expect(fieldSpot(undefined)).toBeNull();
  });

  it('重複組別名稱找第一個重複的那一組', () => {
    expect(duplicateDivisionField([division, { ...division, name: 'U12' }, { ...division, name: `${division.name} ` }])).toBe('divisions.2.name');
    expect(duplicateDivisionField([division])).toBeNull();
  });

  it('預設種子兩步都過', () => {
    const form: CheckForm = { ...wizardSeed(), contactNote: '' };
    expect(step1Problem(form, Date.UTC(2026, 11, 10))).toBeNull();
    expect(step2Problem(form)).toBeNull();
  });
});

describe('必填標記（站長 11-21：必填要有標記）', () => {
  // 標記字來自全站字典（ui.input.required／ui.select.required），這一組先載入繁中
  beforeAll(async () => {
    await setLocale('zh-TW');
  });
  const mark = (id: string): string | undefined => document.querySelector(`label[for="${id}"] small`)?.textContent ?? undefined;

  it('第 1 步：賽事名稱、四個時間、每個場地名稱都有「* 必填」；地址與聯絡文字是選填、沒有標記', () => {
    draw({ venues: [{ name: '甲', address: '' }, { name: '乙', address: '' }] });
    for (const id of ['cpf-name', 'cp-reg-open', 'cp-reg-close', 'cp-first', 'cp-last', 'cpf-v0-name', 'cpf-v1-name']) expect(mark(id), id).toBe('* 必填');
    for (const id of ['cpf-v0-address', 'cpf-contact']) expect(mark(id), id).toBeUndefined();
  });

  it('俱樂部主辦：俱樂部欄有必填標記（繳費說明是選填）', () => {
    draw({}, { club: true });
    expect(mark('cpf-club')).toBe('* 必填');
    expect(mark('cpf-fee-note')).toBeUndefined();
  });

  it('第 2 步：每個組別名稱都有必填標記', () => {
    draw({}, { step: 2 });
    expect(mark('cpf-d0-name')).toBe('* 必填');
    expect(mark('cpf-d1-name')).toBe('* 必填');
  });

  it('頁面沒有 <form>：必填欄位帶 required 也不會跳出瀏覽器內建的驗證泡泡，空白照樣走我們自己的檢查', () => {
    draw({ venues: [{ name: '', address: '' }] });
    expect(document.querySelector('form')).toBeNull();
    expect((document.getElementById('cpf-v0-name') as HTMLInputElement).required).toBe(true);
    next();
    expect(errorOf('cpf-v0-name')).toBe('請填場地名稱');
    expect(document.activeElement?.id).toBe('cpf-v0-name');
  });
});

function baseDraft(): WizardDraft {
  return {
    name: '示範盃',
    category: 'league',
    hostType: 'personal',
    hostTeamId: '',
    hostDisplay: '王示範',
    feeNote: '',
    regOpenAt: 1,
    regCloseAt: 2,
    firstMatchAt: 3,
    lastMatchAt: 4,
    venues: [{ name: '甲', address: '' }],
    divisions: [{ ...division }],
  };
}
