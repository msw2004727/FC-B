// @vitest-environment jsdom
import type { ComponentType } from 'preact';
import { LocationProvider, Route, Router } from 'preact-iso';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import zh from './locales/zh-TW.json';
import ProfilePage from './pages/ProfilePage';
import PublicProfilePage from './pages/PublicProfilePage';
import QrPage from './pages/QrPage';
import { manifest } from './index';
import { loadUserProfile, type UserProfile } from './data/profile-model';
import { loadRelatedActivities, type RelatedActivities } from './data/related-activities';
import { loadUserAttendanceSummary } from './data/attendance-summary';
import { buildIdentityQrPayload, renderQrToCanvas } from './data/qr';
import {
  saveCompanions,
  saveEduChildren,
  saveFirstLoginProfile,
  saveSocialLink,
  clearSocialLink,
  commitIdentitySettings,
  commitSecondaryIdentityAvatar,
  updateProfileFields,
} from './data/profile-writes';
import { useViewer, type ViewerView } from './data/viewer';
import { useUserRoles } from '@/data/user-roles';

// 這組測試驗證「顯示經驗值」時的畫面；新版預設關閉（src/core/exp-display.ts），關閉時的行為另有測試。
vi.mock('@/core/exp-display', () => ({ SHOW_EXP: true }));

// 測試同步更新：照 A（M-121）成就/稱號快捷改導頁，需 stub useLocation().route 供斷言。
const { routeMock } = vi.hoisted(() => ({ routeMock: vi.fn() }));
vi.mock('preact-iso', async () => {
  const actual = await vi.importActual<typeof import('preact-iso')>('preact-iso');
  const stubLocation = {
    url: '/',
    path: '/',
    query: {} as Record<string, string>,
    previous: '/',
    route: routeMock,
  } as unknown as ReturnType<typeof actual.useLocation>;
  return {
    ...actual,
    useLocation: () => stubLocation,
  };
});

vi.mock('./data/viewer', () => ({ useViewer: vi.fn() }));
vi.mock('./data/profile-model', () => ({ loadUserProfile: vi.fn() }));
vi.mock('./data/related-activities', () => ({ loadRelatedActivities: vi.fn() }));
// 測試同步更新（站長 11-06 放鴿子／出席率 v2）：球員卡改用 deriveAttendanceDisplay，部分 mock 要保留真實匯出。
vi.mock('./data/attendance-summary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data/attendance-summary')>()),
  loadUserAttendanceSummary: vi.fn(),
}));
vi.mock('@/data/user-roles', () => ({
  useUserRoles: vi.fn(() => ({})),
  userLevelFromExp: (totalExp: number) => {
    if (!(totalExp > 0)) return 0;
    let level = Math.floor((-1 + Math.sqrt(1 + (4 * totalExp) / 50)) / 2);
    if (level < 0) level = 0;
    if (level > 999) level = 999;
    return level;
  },
  getCachedUserLevel: vi.fn(() => 0),
}));
vi.mock('./data/qr', () => ({
  buildIdentityQrPayload: vi.fn((uid: string) => uid.trim()),
  renderQrToCanvas: vi.fn(),
}));
vi.mock('./data/profile-writes', () => ({
  saveFirstLoginProfile: vi.fn(),
  saveCompanions: vi.fn(),
  saveEduChildren: vi.fn(),
  saveSocialLink: vi.fn(),
  clearSocialLink: vi.fn(),
  commitIdentitySettings: vi.fn(),
  commitSecondaryIdentityAvatar: vi.fn(),
  updateProfileFields: vi.fn(),
  normalizeLineContactUrl: (value: unknown) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    return /^https?:\/\//i.test(raw) || /^line:\/\//i.test(raw)
      ? raw
      : `https://line.me/ti/p/${encodeURIComponent(raw.replace(/^@/, ''))}`;
  },
}));

// 測試同步更新：照 A（M-123）LegacyIdentityCard/LegacyLineNotifyCard 依賴這兩支模組。
vi.mock('@/data/identity-settings', () => ({
  useIdentitySettings: () => null,
  getIdentitySettings: () => null,
  setIdentitySettingsLocal: vi.fn(),
  subscribeIdentitySettings: () => () => {},
  startIdentitySettings: vi.fn(),
  stopIdentitySettings: vi.fn(),
}));

vi.mock('@/features/events/data/line-notify-bind', () => ({
  bindLineNotify: vi.fn().mockResolvedValue(undefined),
  buildLineNotifyPayload: vi.fn(() => ({})),
}));

// 審查 P2-1 回歸測試用：LINE 推播寫入可控制完成時間（其餘函式照原檔）。
const { saveLineNotifyMock } = vi.hoisted(() => ({ saveLineNotifyMock: vi.fn() }));
vi.mock('./data/line-notify-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data/line-notify-settings')>()),
  saveLineNotify: saveLineNotifyMock,
}));

vi.mock('@/ui/AppConfirm', () => ({
  appConfirm: vi.fn().mockResolvedValue(true),
}));

// 測試同步更新：照 A（M-127/M-128）夥伴卡改就地展開（LegacyCompanionsCard 獨立測試）、子女卡移除。
// 第 2 段其他卡片在本檔 mock 成空元件，各自有獨立測試。
vi.mock('./components/legacy/LegacyFavoritesCard', () => ({
  LegacyFavoritesCard: () => null,
}));
// 測試同步更新：11-06 個人頁改版，頁面用 useMyTeamApplications 決定圖示列是否顯示「申請」。
const { useMyTeamApplicationsMock } = vi.hoisted(() => ({ useMyTeamApplicationsMock: vi.fn() }));
vi.mock('./components/legacy/LegacyApplicationsCard', () => ({
  LegacyApplicationsCard: () => null,
  useMyTeamApplications: useMyTeamApplicationsMock,
}));
vi.mock('./components/legacy/LegacyActivityRecordsCard', () => ({
  LegacyActivityRecordsCard: () => null,
}));

function flatten(value: Record<string, unknown>, prefix = 'profile'): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[`${prefix}.${key}`] = entry;
    else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      Object.assign(result, flatten(entry as Record<string, unknown>, `${prefix}.${key}`));
    }
  }
  return result;
}

function viewer(uid: string | null = 'U-me', role = 'user'): ViewerView {
  return {
    uid,
    role: uid ? role : 'guest',
    roleLevel: uid ? 1 : 0,
    teamIds: new Set<string>(),
    capabilities: [],
    displayName: null,
    pictureUrl: null,
    hasPermission: () => true,
  };
}

function profile(overrides: Record<string, unknown> = {}): UserProfile {
  return {
    uid: 'U-me',
    _docId: 'U-me',
    name: '王小明',
    lastActive: null,
    gender: '男',
    birthday: '2000/01/02',
    region: '台北市',
    role: 'user',
    teamName: '測試俱樂部',
    socialLinks: { ig: 'example' },
    companions: [],
    eduChildren: [],
    ...overrides,
  };
}

/** 區塊仍在 DOM，但所在的分頁容器被 hidden 藏起來。 */
function isHiddenPane(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) throw new Error(`pane content missing: ${id}`);
  return Boolean(el.closest('#profile-quick-panel > div')?.hasAttribute('hidden'));
}

function quickBtn(key: string): HTMLButtonElement {
  const el = document.getElementById(`profile-quick-btn-${key}`);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`quick button missing: ${key}`);
  return el;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function formScope() {
  // jsdom 的 <dialog> 沒有 open 時不算 accessible，直接用 class 找。
  const dialog = document.querySelector<HTMLElement>('dialog.ui-modal');
  return dialog ? within(dialog) : screen;
}

async function selectValue(label: string, value: string): Promise<void> {
  const element = formScope().getByLabelText(label);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Expected select: ${label}`);
  }
  expect(element.disabled).toBe(false);
  expect(Array.from(element.options).some((option) => option.value === value)).toBe(true);

  fireEvent.input(element, { target: { value } });
  await act(async () => {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await waitFor(() => {
    expect(formScope().getByLabelText(label)).toBe(element);
    expect(element.value).toBe(value);
  });
}

async function inputValue(label: string, value: string): Promise<void> {
  const element = formScope().getByLabelText(label);
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
    throw new Error(`Expected text input: ${label}`);
  }
  expect(element.disabled).toBe(false);
  fireEvent.input(element, { target: { value } });
  await waitFor(() => {
    expect(formScope().getByLabelText(label)).toBe(element);
    expect(element.value).toBe(value);
  });
}

async function clickButton(name: string): Promise<void> {
  const element = screen.getByRole('button', { name });
  if (element instanceof HTMLButtonElement) {
    expect(element.disabled).toBe(false);
  }
  fireEvent.click(element);
}

async function setCheckbox(name: string, checked: boolean): Promise<void> {
  const element = formScope().getByRole('checkbox', { name });
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected checkbox: ${name}`);
  }
  expect(element.disabled).toBe(false);

  if (element.checked !== checked) {
    fireEvent.click(element);
  }

  await waitFor(() => {
    expect(formScope().getByRole('checkbox', { name })).toBe(element);
    expect(element.checked).toBe(checked);
  });
}

function expectFormValid(buttonName: string): void {
  const element = screen.getByRole('button', { name: buttonName });
  if (!(element instanceof HTMLButtonElement) || !element.form) {
    throw new Error(`Expected submit button in form: ${buttonName}`);
  }
  expect(element.type).toBe('submit');
  expect(element.form.checkValidity()).toBe(true);
}

// 測試同步更新：照 A（M-130）首次登入為 A DOM（#fl-* id），以 id 直接操作 select/input。
async function setSelectById(id: string, value: string): Promise<void> {
  const element = document.getElementById(id) as HTMLSelectElement | null;
  if (!element) throw new Error(`Expected select #${id}`);
  fireEvent.input(element, { target: { value } });
  await act(async () => {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitFor(() => {
    expect((document.getElementById(id) as HTMLSelectElement).value).toBe(value);
  });
}

async function setInputById(id: string, value: string): Promise<void> {
  const element = document.getElementById(id) as HTMLInputElement | null;
  if (!element) throw new Error(`Expected input #${id}`);
  fireEvent.input(element, { target: { value } });
  await waitFor(() => {
    expect((document.getElementById(id) as HTMLInputElement).value).toBe(value);
  });
}

async function setLegalConsent(checked: boolean): Promise<void> {
  const element = document.getElementById('fl-legal-consent') as HTMLInputElement | null;
  if (!element) throw new Error('Expected #fl-legal-consent');
  if (element.checked !== checked) fireEvent.click(element);
  await waitFor(() => {
    expect((document.getElementById('fl-legal-consent') as HTMLInputElement).checked).toBe(checked);
  });
}

async function fillFirstLogin(email = 'a@example.com'): Promise<void> {
  await setSelectById('fl-gender', '女');
  await setSelectById('fl-birthday-y', '1999');
  await setSelectById('fl-birthday-m', '03');
  await setSelectById('fl-birthday-d', '04');
  await setInputById('fl-region-input', '臺中市');
  await setInputById('fl-email', email);

  expect((document.getElementById('fl-gender') as HTMLSelectElement).value).toBe('女');
  expect((document.getElementById('fl-birthday-y') as HTMLSelectElement).value).toBe('1999');
  expect((document.getElementById('fl-birthday-m') as HTMLSelectElement).value).toBe('03');
  expect((document.getElementById('fl-birthday-d') as HTMLSelectElement).value).toBe('04');
  expect((document.getElementById('fl-region-input') as HTMLInputElement).value).toBe('臺中市');
  expect((document.getElementById('fl-email') as HTMLInputElement).value).toBe(email);
}

function expectNoWrites(): void {
  expect(saveFirstLoginProfile).not.toHaveBeenCalled();
  expect(saveCompanions).not.toHaveBeenCalled();
  expect(saveEduChildren).not.toHaveBeenCalled();
  expect(saveSocialLink).not.toHaveBeenCalled();
  expect(clearSocialLink).not.toHaveBeenCalled();
  expect(commitIdentitySettings).not.toHaveBeenCalled();
  expect(commitSecondaryIdentityAvatar).not.toHaveBeenCalled();
  expect(updateProfileFields).not.toHaveBeenCalled();
}

beforeEach(async () => {
  vi.resetAllMocks();
  toast.clear();
  vi.mocked(useViewer).mockReturnValue(viewer());
  vi.mocked(useUserRoles).mockReturnValue({});
  vi.mocked(loadUserProfile).mockResolvedValue(profile());
  vi.mocked(loadRelatedActivities).mockResolvedValue({
    registered: [],
    hosted: [],
    counts: { registered: 0, hosted: 0 },
  });
  vi.mocked(loadUserAttendanceSummary).mockResolvedValue(null);
  vi.mocked(buildIdentityQrPayload).mockImplementation((uid) => uid.trim());
  vi.mocked(renderQrToCanvas).mockResolvedValue(undefined);
  vi.mocked(saveFirstLoginProfile).mockResolvedValue(undefined);
  vi.mocked(saveCompanions).mockResolvedValue(undefined);
  vi.mocked(saveEduChildren).mockResolvedValue(undefined);
  vi.mocked(saveSocialLink).mockResolvedValue(undefined);
  vi.mocked(clearSocialLink).mockResolvedValue(undefined);
  vi.mocked(commitIdentitySettings).mockResolvedValue(undefined);
  vi.mocked(commitSecondaryIdentityAvatar).mockResolvedValue(undefined);
  vi.mocked(updateProfileFields).mockResolvedValue(undefined);
  _setDictLoaderForTest(async () => flatten(zh));
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  toast.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _setDictLoaderForTest(null);
  window.history.replaceState(null, '', '/');
});

describe('我的個人頁（A 版結構）', () => {
  it('未登入只顯示 #profile-login-prompt，不載入個人資料', () => {
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    render(<ProfilePage />);
    expect(document.getElementById('page-profile')).toBeTruthy();
    expect(document.getElementById('profile-login-prompt')).toBeTruthy();
    expect(screen.getByText('尚未登入')).toBeTruthy();
    expect(screen.getByText('LINE 登入')).toBeTruthy();
    expect(loadUserProfile).not.toHaveBeenCalled();
    expect(loadRelatedActivities).not.toHaveBeenCalled();
    expect(loadUserAttendanceSummary).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('顯示載入狀態', async () => {
    // 本檔字典只有 profile.*。PageSpinner 的圈下文案在 common.*，這裡補上既有兩句，不斷言新文案。
    _setDictLoaderForTest(async () => ({
      ...flatten(zh),
      'common.loading': zh.loading,
      'common.loadingHint': '不要催，已經在努力加載中！',
    }));
    await setLocale('zh-TW');
    let resolveLoad: (value: UserProfile | null) => void = () => {};
    vi.mocked(loadUserProfile).mockReturnValue(new Promise((resolve) => {
      resolveLoad = resolve;
    }));
    render(<ProfilePage />);
    const status = screen.getByRole('status');
    expect(status.querySelector('.ui-page-spinner__ring')).toBeTruthy();
    expect(status.getAttribute('aria-label')).toContain(zh.loading);
    expect(status.textContent).toContain('不要催，已經在努力加載中！');
    expect(document.getElementById('profile-content')).toBeNull();

    resolveLoad(profile());
    expect(await screen.findByText('王小明')).toBeTruthy();
    expect(document.querySelector('.ui-page-spinner')).toBeNull();
  });

  it('載入失敗沿用既有失敗畫面，不再轉圈', async () => {
    vi.mocked(loadUserProfile).mockRejectedValue(new Error('boom'));
    render(<ProfilePage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(zh.loadError)).toBeTruthy();
    expect(screen.getByRole('button', { name: zh.retry })).toBeTruthy();
    expect(document.querySelector('.ui-page-spinner')).toBeNull();
  });

  it('輸出 A 主要 id/class、等級計算、UID 權限控制與出席統計', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({
      exp: 350, // Lv.2: baseExp = 300, progress = 50, needed = 300, width = 17%
    }));
    vi.mocked(loadUserAttendanceSummary).mockResolvedValue({
      uid: 'U-me',
      exists: true,
      sourceVersion: 1,
      expectedCount: 8,
      attendedCount: 6,
      completedCount: 5,
      attendRate: 75,
      updatedAt: null,
    });

    const { rerender } = render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();

    expect(document.getElementById('profile-content')).toBeTruthy();
    expect(document.getElementById('profile-lv')?.textContent).toBe('Lv.2');
    expect(document.getElementById('profile-exp-text')?.textContent).toBe('50 / 300');
    expect((document.getElementById('profile-exp-fill') as HTMLElement).style.width).toBe('17%');

    // 一般用戶不顯示原始 UID 文字
    expect(document.getElementById('profile-uid-wrap')?.textContent).not.toContain('U-me');

    // 出席統計有值時顯示數字；徽章統計已隨成就系統移除
    await waitFor(() => {
      expect(document.getElementById('profile-stat-total')?.textContent).toBe('8');
      expect(document.getElementById('profile-stat-done')?.textContent).toBe('5');
      expect(document.getElementById('profile-stat-rate')?.textContent).toBe('75%');
    });
    expect(document.getElementById('profile-stat-badges')).toBeNull();

    // 切換為 admin 後可看到原始 UID
    vi.mocked(useViewer).mockReturnValue(viewer('U-me', 'admin'));
    rerender(<ProfilePage />);
    expect(document.getElementById('profile-uid-wrap')?.textContent).toContain('U-me');
  });

  // 測試同步更新：照 A（M-121）；成就／稱號／道具欄已移除（站長 2026-11-02）
  it('出席統計讀不到時顯示 --，場景鑰匙不存在，成就／稱號／道具欄不出現', async () => {
    vi.mocked(loadUserAttendanceSummary).mockResolvedValue(null);
    render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();

    expect(document.getElementById('profile-stat-total')?.textContent).toBe('--');
    expect(document.getElementById('profile-stat-done')?.textContent).toBe('--');
    expect(document.getElementById('profile-stat-rate')?.textContent).toBe('--');

    // 測試同步更新：照 A（M-169）場景鑰匙入口已移除。
    expect(document.getElementById('profile-slot-banner')).toBeNull();
    expect(document.querySelector('.profile-scene-key')).toBeNull();

    // 成就／徽章、稱號、道具欄已從新站移除（站長 2026-11-02）。
    expect(screen.queryByText('成就/徽章')).toBeNull();
    expect(screen.queryByText('稱號')).toBeNull();
    expect(screen.queryByText('道具欄')).toBeNull();
  });

  // 測試同步更新：11-06 個人頁改版，「我的報名」「我開的團」改成圖示列按鈕，展開區一次只開一個（仍是展開才渲染）。
  it('正常顯示俱樂部與活動連結，支援區塊收合', async () => {
    vi.mocked(loadRelatedActivities).mockResolvedValue({
      registered: [{
        event: { id: 'event-1', title: '週末足球' },
        registration: { userId: 'U-me' },
        registrationStatus: 'confirmed',
        effectiveStatus: 'open',
      }],
      hosted: [{ event: { id: 'event-2', title: '晨間慢跑' }, effectiveStatus: 'open' }],
      counts: { registered: 1, hosted: 1 },
    });
    render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();
    // 所屬俱樂部在「我的資料」展開區內（改版前是收折卡內的隱藏內容）。
    expect(screen.queryByText('測試俱樂部')).toBeNull();
    fireEvent.click(quickBtn('info'));
    expect(screen.getAllByText('測試俱樂部').length).toBeGreaterThan(0);
    fireEvent.click(quickBtn('info'));
    await waitFor(() => expect(loadRelatedActivities).toHaveBeenCalledWith('U-me'));

    const regBtn = quickBtn('reg');
    expect(regBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('profile-registered-activities-list')).toBeNull();
    await waitFor(() => expect(regBtn.querySelector('.profile-quick-badge')?.textContent).toBe('1'));

    fireEvent.click(regBtn);
    expect(regBtn.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('profile-registered-activities-list')).not.toBeNull();
    // A 的活動卡整列可點（data-event-id），標題不另包連結。
    expect((await screen.findByText('週末足球')).closest('.profile-related-event-card')?.getAttribute('data-event-id'))
      .toBe('event-1');

    const hostedBtn = quickBtn('host');
    expect(hostedBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('profile-hosted-activities-list')).toBeNull();
    expect(hostedBtn.querySelector('.profile-quick-badge')?.textContent).toBe('1');

    // 點另一個直接換：我的報名收起、我開的團展開。
    fireEvent.click(hostedBtn);
    expect(hostedBtn.getAttribute('aria-expanded')).toBe('true');
    expect(regBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('profile-registered-activities-list')).toBeNull();
    expect(document.getElementById('profile-hosted-activities-list')).not.toBeNull();
    expect(screen.getByText('晨間慢跑').closest('.profile-related-event-card')?.getAttribute('data-event-id'))
      .toBe('event-2');

    // 再點同一個收起，清單從 DOM 移除。
    fireEvent.click(hostedBtn);
    expect(hostedBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('profile-hosted-activities-list')).toBeNull();
    // 展開／切換不重讀：整個過程只讀一次。
    expect(loadRelatedActivities).toHaveBeenCalledTimes(1);
  });

  it('我的資料卡支援行內編輯、地區清單選擇、取消與儲存', async () => {
    render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();

    fireEvent.click(quickBtn('info'));

    const editBtn = document.getElementById('profile-edit-btn') as HTMLButtonElement;
    fireEvent.click(editBtn);

    const editBox = document.getElementById('profile-info-edit') as HTMLElement;
    expect(editBox.style.display).not.toBe('none');

    // 點擊取消回到顯示模式且不寫入
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(editBox.style.display).toBe('none');
    expect(updateProfileFields).not.toHaveBeenCalled();

    // 再次開啟編輯並修改欄位
    fireEvent.click(editBtn);
    await selectValue('性別', '女');
    await selectValue('生日年', '1995');
    await selectValue('生日月', '6');
    await selectValue('生日日', '15');

    const regionInput = document.getElementById('profile-edit-region') as HTMLInputElement;
    fireEvent.input(regionInput, { target: { value: '台中' } });
    const regionItem = document.querySelector('#profile-region-list [data-region="台中市"]') as HTMLElement;
    expect(regionItem).toBeTruthy();
    fireEvent.click(regionItem);
    expect(regionInput.value).toBe('台中市');

    const phoneInput = document.getElementById('profile-edit-phone') as HTMLInputElement;
    fireEvent.input(phoneInput, { target: { value: '0911-222-333' } });

    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(updateProfileFields).toHaveBeenCalledTimes(1));
    expect(updateProfileFields).toHaveBeenCalledWith('U-me', {
      gender: '女',
      birthday: '1995/06/15',
      region: '台中市',
      phone: '0911-222-333',
    });
    expect(document.getElementById('profile-gender')?.textContent).toBe('女');
    expect(document.getElementById('profile-region')?.textContent).toBe('台中市');
    expect(document.getElementById('profile-phone')?.textContent).toBe('0911-222-333');
  });

  it('U-041：儲存中按鈕 disabled 且連按只呼叫一次 updateProfileFields', async () => {
    vi.mocked(updateProfileFields).mockReturnValue(new Promise<void>(() => {}));
    render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();

    fireEvent.click(quickBtn('info'));
    fireEvent.click(document.getElementById('profile-edit-btn') as HTMLElement);

    const saveBtn = screen.getByRole('button', { name: '儲存' }) as HTMLButtonElement;
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveBtn.disabled).toBe(true);
      expect(saveBtn.textContent).toBe('儲存中...');
    });
    fireEvent.click(saveBtn);
    expect(updateProfileFields).toHaveBeenCalledTimes(1);
  });

  it('U-042：地區清單可用鍵盤選擇並以 Escape 收起（Escape 不收合展開區）', async () => {
    render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();
    fireEvent.click(quickBtn('info'));
    fireEvent.click(document.getElementById('profile-edit-btn') as HTMLElement);

    const regionInput = document.getElementById('profile-edit-region') as HTMLInputElement;
    fireEvent.input(regionInput, { target: { value: '台' } });
    await waitFor(() => {
      expect(document.querySelectorAll('#profile-region-list [data-region]').length).toBeGreaterThan(0);
    });

    fireEvent.keyDown(regionInput, { key: 'Escape' });
    await waitFor(() => {
      expect(document.querySelectorAll('#profile-region-list [data-region]').length).toBe(0);
    });
    // 輸入框內的 Escape 只收地區清單，「我的資料」展開區與編輯中的內容保留。
    expect(quickBtn('info').getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('profile-edit-region')).toBe(regionInput);

    fireEvent.input(regionInput, { target: { value: '台' } });
    await waitFor(() => {
      expect(document.querySelectorAll('#profile-region-list [data-region]').length).toBeGreaterThan(0);
    });
    const firstOption = document.querySelector('#profile-region-list [data-region]') as HTMLElement;
    const firstName = firstOption.getAttribute('data-region')!;
    fireEvent.keyDown(regionInput, { key: 'ArrowDown' });
    fireEvent.keyDown(regionInput, { key: 'Enter' });
    expect(regionInput.value).toBe(firstName);
  });

  // 測試同步更新：11-06 個人頁改版，「我的資料」標題列改成原生 button（Enter／Space 由瀏覽器觸發 click）。
  it('U-040：「我的資料」是原生按鈕，帶 aria-expanded／aria-controls', async () => {
    render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();
    const btn = quickBtn('info');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('profile-quick-panel');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  // 測試同步更新：11-06 個人頁改版，「?」移到展開區內（沒有標題列可誤觸展開）。
  it('M-121：「我的資料」的 ? 開啟說明視窗，了解後關閉且展開區維持', async () => {
    render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();
    const btn = quickBtn('info');
    fireEvent.click(btn);
    const infoCard = document.getElementById('profile-info-card')!;

    const infoBtn = infoCard.querySelector('.edu-info-btn') as HTMLElement;
    fireEvent.click(infoBtn);
    await waitFor(() => {
      expect(document.querySelector('.edu-info-dialog-title')?.textContent).toBe('我的資料');
    });
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '了解' }));
    await waitFor(() => {
      expect(document.querySelector('.edu-info-dialog-title')).toBeNull();
    });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  describe('11-06 改版：圖示列＋單一展開區', () => {
    it('圖示列在社群列下方、細線分隔；按鈕順序、兩字標籤與 aria 全名', async () => {
      render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();

      const social = document.getElementById('social-grid')!;
      const quick = document.querySelector('.profile-quick')!;
      expect(social.nextElementSibling).toBe(quick);
      expect(quick.querySelector('.profile-quick-sep')?.getAttribute('role')).toBe('separator');
      const group = quick.querySelector('[role="group"]')!;
      expect(group.getAttribute('aria-label')).toBe('個人設定');

      const buttons = Array.from(group.querySelectorAll('button'));
      expect(buttons.map((b) => b.dataset['key'])).toEqual(['reg', 'info', 'id2', 'line', 'host', 'mate']);
      expect(buttons.map((b) => b.querySelector('.profile-quick-lb')?.textContent))
        .toEqual(['報名', '資料', '身份', '推播', '開團', '夥伴']);
      for (const b of buttons) {
        expect(b.getAttribute('type')).toBe('button');
        expect(b.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
        expect(b.querySelector('.profile-quick-lb')?.getAttribute('aria-hidden')).toBe('true');
      }
      expect(quickBtn('info').getAttribute('aria-label')).toBe('我的資料');
      expect(quickBtn('id2').getAttribute('aria-label')).toBe('第二身份');
      expect(quickBtn('mate').getAttribute('aria-label')).toBe('我的運動夥伴');
      await waitFor(() => expect(quickBtn('reg').getAttribute('aria-label')).toBe('我的報名，0 筆'));
      expect(quickBtn('host').getAttribute('aria-label')).toBe('開團（我開的團），0 筆');

      // 收合時展開區存在但隱藏、沒有內容；報名紀錄仍是獨立區塊（本檔 mock 成空元件）。
      const panel = document.getElementById('profile-quick-panel')!;
      expect(panel.getAttribute('role')).toBe('region');
      expect(panel.hidden).toBe(true);
      expect(panel.childElementCount).toBe(0);
    });

    it('沒有 profile.secondary_identity 權限時不出現「身份」圖示', async () => {
      vi.mocked(useViewer).mockReturnValue({
        ...viewer(),
        hasPermission: (code: string) => code !== 'profile.secondary_identity',
      });
      render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();
      expect(document.getElementById('profile-quick-btn-id2')).toBeNull();
      expect(document.getElementById('profile-identity-card')).toBeNull();
      expect(document.querySelectorAll('.profile-quick-btn').length).toBe(5);
    });

    it('有申請紀錄才出現「申請」圖示（照 A _showApplicationsCard）', async () => {
      useMyTeamApplicationsMock.mockReturnValue([{ messageId: 'm1', teamName: '大安羽球社', status: 'pending' }]);
      render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();
      const apply = quickBtn('apply');
      expect(apply.getAttribute('aria-label')).toBe('我的俱樂部申請');
      expect(apply.querySelector('.profile-quick-lb')?.textContent).toBe('申請');
      expect(useMyTeamApplicationsMock).toHaveBeenCalledWith('U-me', expect.objectContaining({ uid: 'U-me' }));
    });

    it('一次只開一個：點另一個直接換、再點同一個收合', async () => {
      render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();
      const info = quickBtn('info');
      const line = quickBtn('line');
      const panel = document.getElementById('profile-quick-panel')!;

      fireEvent.click(info);
      expect(info.getAttribute('aria-expanded')).toBe('true');
      expect(panel.hidden).toBe(false);
      expect(panel.getAttribute('aria-labelledby')).toBe('profile-quick-btn-info');
      expect(document.getElementById('profile-info-card')).not.toBeNull();

      fireEvent.click(line);
      expect(info.getAttribute('aria-expanded')).toBe('false');
      expect(line.getAttribute('aria-expanded')).toBe('true');
      // 測試同步更新（審查 P2-1～P3-1）：打開過的區塊切走後保持掛載、只用 hidden 藏起來。
      expect(isHiddenPane('profile-info-card')).toBe(true);
      expect(isHiddenPane('profile-line-notify')).toBe(false);
      expect(document.querySelectorAll('.profile-quick-btn[aria-expanded="true"]').length).toBe(1);
      expect(panel.getAttribute('aria-labelledby')).toBe('profile-quick-btn-line');

      fireEvent.click(line);
      expect(line.getAttribute('aria-expanded')).toBe('false');
      expect(panel.hidden).toBe(true);
      expect(isHiddenPane('profile-line-notify')).toBe(true);
      // 沒打開過的區塊仍不掛載（展開才渲染）。
      expect(document.getElementById('my-companions-card')).toBeNull();
    });

    it('Esc 收合並把焦點還給該按鈕', async () => {
      render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();
      const mate = quickBtn('mate');
      fireEvent.click(mate);
      const addBtn = screen.getByRole('button', { name: '+ 新增同行者' });
      addBtn.focus();
      fireEvent.keyDown(addBtn, { key: 'Escape' });
      expect(mate.getAttribute('aria-expanded')).toBe('false');
      expect(document.getElementById('profile-quick-panel')!.hidden).toBe(true);
      expect(isHiddenPane('my-companions-card')).toBe(true);
      expect(document.activeElement).toBe(mate);

      // 收合狀態下再按 Esc 不出錯、不改狀態。
      fireEvent.keyDown(mate, { key: 'Escape' });
      expect(mate.getAttribute('aria-expanded')).toBe('false');
    });

    it('審查 P2-1：推播開關寫入中切到別的圖示，寫入完成後仍更新頁面資料（不會把舊 lineNotify 整包寫回）', async () => {
      vi.mocked(loadUserProfile).mockResolvedValue(profile({
        lineNotify: { bound: true, boundAt: '2025/03/14', settings: { activity: false, system: true } },
      }));
      const pending = deferred<void>();
      saveLineNotifyMock.mockReturnValueOnce(pending.promise);
      render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();

      fireEvent.click(quickBtn('line'));
      fireEvent.click(document.getElementById('line-toggle-activity') as HTMLInputElement);
      await waitFor(() => expect(saveLineNotifyMock).toHaveBeenCalledTimes(1));

      // 寫入還沒完成就切到「資料」。
      fireEvent.click(quickBtn('info'));
      expect(quickBtn('line').getAttribute('aria-expanded')).toBe('false');
      await act(async () => {
        pending.resolve();
        await pending.promise;
      });

      // onSaved 有執行：回到推播，開關是新值；之後再切別的開關，是以新值為基準寫入。
      fireEvent.click(quickBtn('line'));
      expect((document.getElementById('line-toggle-activity') as HTMLInputElement).checked).toBe(true);
      saveLineNotifyMock.mockResolvedValueOnce(undefined);
      fireEvent.click(document.getElementById('line-toggle-system') as HTMLInputElement);
      await waitFor(() => expect(saveLineNotifyMock).toHaveBeenCalledTimes(2));
      const written = saveLineNotifyMock.mock.calls[1]?.[1] as { settings: Record<string, boolean> };
      expect(written.settings).toMatchObject({ activity: true, system: false });
    });

    it('審查 P3-1：我的資料編輯到一半切走再回來，草稿還在', async () => {
      render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();
      fireEvent.click(quickBtn('info'));
      fireEvent.click(document.getElementById('profile-edit-btn') as HTMLElement);
      const phone = document.getElementById('profile-edit-phone') as HTMLInputElement;
      fireEvent.input(phone, { target: { value: '0900-000-000' } });
      fireEvent.click(quickBtn('mate'));
      fireEvent.click(quickBtn('info'));
      expect((document.getElementById('profile-edit-phone') as HTMLInputElement).value).toBe('0900-000-000');
      expect((document.getElementById('profile-info-edit') as HTMLElement).style.display).not.toBe('none');
    });

    it('報名、開團顯示筆數徽章；推播已綁定顯示綠點，未綁定不顯示', async () => {
      vi.mocked(loadRelatedActivities).mockResolvedValue({
        registered: [
          { event: { id: 'e1', title: 'A' }, registration: {}, registrationStatus: 'confirmed', effectiveStatus: 'open' },
          { event: { id: 'e2', title: 'B' }, registration: {}, registrationStatus: 'waitlisted', effectiveStatus: 'open' },
        ],
        hosted: [{ event: { id: 'e3', title: 'C' }, effectiveStatus: 'open' }],
        counts: { registered: 2, hosted: 1 },
      });
      vi.mocked(loadUserProfile).mockResolvedValue(profile({
        lineNotify: { bound: true, boundAt: '2025/03/14', settings: { activity: true } },
      }));
      render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();

      await waitFor(() => expect(quickBtn('reg').querySelector('.profile-quick-badge')?.textContent).toBe('2'));
      expect(quickBtn('reg').getAttribute('aria-label')).toBe('我的報名，2 筆');
      expect(quickBtn('host').querySelector('.profile-quick-badge')?.textContent).toBe('1');
      expect(quickBtn('host').getAttribute('aria-label')).toBe('開團（我開的團），1 筆');
      expect(quickBtn('line').querySelector('.profile-quick-dot')).not.toBeNull();
      expect(quickBtn('line').getAttribute('aria-label')).toBe('LINE 推播，已綁定');
      // 其他項目沒有徽章或綠點。
      for (const key of ['info', 'id2', 'mate']) {
        expect(quickBtn(key).querySelector('.profile-quick-badge, .profile-quick-dot')).toBeNull();
      }

      cleanup();
      vi.mocked(loadUserProfile).mockResolvedValue(profile());
      vi.mocked(loadRelatedActivities).mockResolvedValue({ registered: [], hosted: [], counts: { registered: 0, hosted: 0 } });
      render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();
      expect(quickBtn('line').querySelector('.profile-quick-dot')).toBeNull();
      expect(quickBtn('line').getAttribute('aria-label')).toBe('LINE 推播，未綁定');
      await waitFor(() => expect(quickBtn('reg').getAttribute('aria-label')).toBe('我的報名，0 筆'));
      expect(quickBtn('reg').querySelector('.profile-quick-badge')).toBeNull();
    });

    it('報名與開團讀取中有旋轉圈，讀完換成筆數', async () => {
      const pending = deferred<RelatedActivities>();
      vi.mocked(loadRelatedActivities).mockReturnValue(pending.promise);
      render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();

      const reg = quickBtn('reg');
      const host = quickBtn('host');
      expect(reg.querySelector('.profile-quick-spin')).not.toBeNull();
      expect(host.querySelector('.profile-quick-spin')).not.toBeNull();
      expect(reg.getAttribute('aria-busy')).toBe('true');
      expect(host.getAttribute('aria-busy')).toBe('true');
      expect(reg.getAttribute('aria-label')).toBe('我的報名，讀取中');
      expect(host.getAttribute('aria-label')).toBe('開團（我開的團），讀取中');
      expect(reg.querySelector('.profile-quick-badge:not(.profile-quick-badge--loading)')).toBeNull();
      expect(host.querySelector('.profile-quick-badge:not(.profile-quick-badge--loading)')).toBeNull();
      expect(quickBtn('info').hasAttribute('aria-busy')).toBe(false);

      fireEvent.click(reg);
      const loading = document.querySelector('#profile-registered-activities-list .reg-loading');
      expect(loading?.getAttribute('role')).toBe('status');
      expect(loading?.textContent).toContain(zh.loading);
      expect(document.querySelector('#profile-registered-activities-list .profile-state')).toBeNull();

      await act(async () => {
        pending.resolve({
          registered: [
            { event: { id: 'e1', title: '讀取後的報名' }, registration: {}, registrationStatus: 'confirmed', effectiveStatus: 'open' },
            { event: { id: 'e2', title: '第二筆報名' }, registration: {}, registrationStatus: 'waitlisted', effectiveStatus: 'open' },
          ],
          hosted: [{ event: { id: 'e3', title: '讀取後的開團' }, effectiveStatus: 'open' }],
          counts: { registered: 2, hosted: 1 },
        });
        await pending.promise;
      });
      await waitFor(() => expect(reg.querySelector('.profile-quick-badge')?.textContent).toBe('2'));
      expect(reg.querySelector('.profile-quick-spin')).toBeNull();
      expect(reg.hasAttribute('aria-busy')).toBe(false);
      expect(reg.getAttribute('aria-label')).toBe('我的報名，2 筆');
      expect(host.querySelector('.profile-quick-badge')?.textContent).toBe('1');
      expect(host.querySelector('.profile-quick-spin')).toBeNull();
      expect(host.getAttribute('aria-label')).toBe('開團（我開的團），1 筆');
      expect(document.querySelector('.reg-loading')).toBeNull();
      expect(screen.getByText('讀取後的報名')).toBeTruthy();
    });

    it('報名與開團讀取失敗不顯示圈也不顯示徽章，展開區沿用既有失敗畫面', async () => {
      vi.mocked(loadRelatedActivities).mockRejectedValue(new Error('offline'));
      render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();
      await waitFor(() => expect(quickBtn('reg').getAttribute('aria-label')).toBe('我的報名'));
      expect(quickBtn('reg').querySelector('.profile-quick-spin')).toBeNull();
      expect(quickBtn('reg').querySelector('.profile-quick-badge')).toBeNull();
      expect(quickBtn('reg').hasAttribute('aria-busy')).toBe(false);
      expect(quickBtn('host').getAttribute('aria-label')).toBe('開團（我開的團）');
      expect(quickBtn('host').querySelector('.profile-quick-spin')).toBeNull();
      expect(quickBtn('host').querySelector('.profile-quick-badge')).toBeNull();

      fireEvent.click(quickBtn('reg'));
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(document.querySelector('#profile-registered-activities-list .reg-loading')).toBeNull();
      expect(document.querySelector('#profile-registered-activities-list .profile-state')).not.toBeNull();
    });

    it('申請讀取中先畫鈕與旋轉圈，讀完 0 筆拿掉，有筆數才留鈕且不轉圈', async () => {
      useMyTeamApplicationsMock.mockReturnValue(null);
      const view = render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();
      const apply = quickBtn('apply');
      expect(apply.querySelector('.profile-quick-spin')).not.toBeNull();
      expect(apply.getAttribute('aria-busy')).toBe('true');
      expect(apply.getAttribute('aria-label')).toBe('我的俱樂部申請，讀取中');
      expect(apply.querySelector('.profile-quick-badge:not(.profile-quick-badge--loading)')).toBeNull();

      useMyTeamApplicationsMock.mockReturnValue([]);
      view.rerender(<ProfilePage />);
      await waitFor(() => expect(document.getElementById('profile-quick-btn-apply')).toBeNull());

      useMyTeamApplicationsMock.mockReturnValue([{ messageId: 'm1', teamName: '大安羽球社', status: 'pending' }]);
      view.rerender(<ProfilePage />);
      await waitFor(() => expect(quickBtn('apply').querySelector('.profile-quick-spin')).toBeNull());
      expect(quickBtn('apply').hasAttribute('aria-busy')).toBe(false);
      expect(quickBtn('apply').getAttribute('aria-label')).toBe('我的俱樂部申請');
    });

    it('展開才渲染：收合時各區塊內容都不在 DOM，相關活動只讀一次（重繪不重讀）', async () => {
      render(<ProfilePage />);
      expect(await screen.findByText('王小明')).toBeTruthy();
      for (const id of [
        'profile-registered-activities-list',
        'profile-hosted-activities-list',
        'profile-info-card',
        'profile-identity-card',
        'profile-line-notify',
        'my-companions-card',
      ]) {
        expect(document.getElementById(id)).toBeNull();
      }
      await waitFor(() => expect(loadRelatedActivities).toHaveBeenCalledTimes(1));
      // 多次切換與重繪後仍只讀一次。
      for (const key of ['info', 'reg', 'line', 'host', 'mate', 'id2', 'id2']) fireEvent.click(quickBtn(key));
      await new Promise((r) => setTimeout(r, 30));
      expect(loadRelatedActivities).toHaveBeenCalledTimes(1);
    });
  });

  it('第一次失敗後重試會重新呼叫 loader', async () => {
    vi.mocked(loadUserProfile)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(profile());
    render(<ProfilePage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    await clickButton(zh.retry);
    expect(await screen.findByText('王小明')).toBeTruthy();
    expect(loadUserProfile).toHaveBeenCalledTimes(2);
  });

  // 「查無資料／讀取失敗」的畫面測試在 pages/ProfilePage.load-failure.test.tsx：
  // 要走真的 loadUserProfile（它會吞掉 I/O 錯誤回 null），這個檔把 loadUserProfile 整個 mock 掉，無法表達那個行為（退修 2 P2-1）。

  it('首次表單只提交白名單；保留失敗輸入，允許重試', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({
      gender: '',
      birthday: '',
      region: '',
      role: 'super_admin',
      exp: 999,
      email: '',
    }));
    vi.mocked(saveFirstLoginProfile)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);

    render(<ProfilePage />);
    await waitFor(() => expect(document.getElementById('first-login-modal')).toBeTruthy());
    await fillFirstLogin();
    await setLegalConsent(true);
    fireEvent.click(screen.getByRole('button', { name: '同意並送出' }));

    await waitFor(() => expect(saveFirstLoginProfile).toHaveBeenCalledTimes(1));
    // 測試同步更新：照 A（M-130）錯誤訊息顯示在 #fl-error-msg，文字為 A 原文。
    await waitFor(() => expect(
      document.getElementById('fl-error-msg')?.textContent,
    ).toBe('儲存失敗，請檢查網路後重試。若持續失敗可重新整理頁面。'));
    expect((document.getElementById('fl-gender') as HTMLSelectElement).value).toBe('女');
    expect((document.getElementById('fl-birthday-y') as HTMLSelectElement).value).toBe('1999');
    expect((document.getElementById('fl-birthday-m') as HTMLSelectElement).value).toBe('03');
    expect((document.getElementById('fl-birthday-d') as HTMLSelectElement).value).toBe('04');
    expect((document.getElementById('fl-region-input') as HTMLInputElement).value).toBe('臺中市');
    expect((document.getElementById('fl-email') as HTMLInputElement).value).toBe('a@example.com');
    expect((document.getElementById('fl-legal-consent') as HTMLInputElement).checked).toBe(true);

    await waitFor(() => expect(
      (screen.getByRole('button', { name: '同意並送出' }) as HTMLButtonElement).disabled,
    ).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '同意並送出' }));
    await waitFor(() => expect(saveFirstLoginProfile).toHaveBeenCalledTimes(2));

    const expected = {
      gender: '女',
      birthday: '1999/03/04',
      region: '臺中市',
      email: 'a@example.com',
      legalConsent: true,
    };
    expect(saveFirstLoginProfile).toHaveBeenNthCalledWith(1, 'U-me', expected);
    expect(saveFirstLoginProfile).toHaveBeenNthCalledWith(2, 'U-me', expected);
    await waitFor(() => expect(document.getElementById('first-login-modal')).toBeNull());
    expect(commitIdentitySettings).not.toHaveBeenCalled();
    expect(commitSecondaryIdentityAvatar).not.toHaveBeenCalled();
  });

  it('首次表單未勾法律同意不能送出；email 可留白', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({ region: '', email: '' }));
    render(<ProfilePage />);
    await waitFor(() => expect(document.getElementById('first-login-modal')).toBeTruthy());
    await fillFirstLogin('');

    expect(screen.getByRole('link', { name: '服務條款' }).getAttribute('href')).toBe('/terms');
    expect(screen.getByRole('link', { name: '隱私權政策' }).getAttribute('href')).toBe('/privacy');
    expect((document.getElementById('fl-legal-consent') as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '同意並送出' }));
    expectNoWrites();
    expect(document.getElementById('first-login-modal')).toBeTruthy();

    await setLegalConsent(true);
    await setLegalConsent(false);
    fireEvent.click(screen.getByRole('button', { name: '同意並送出' }));
    expectNoWrites();
    expect(document.getElementById('first-login-modal')).toBeTruthy();

    await setLegalConsent(true);
    fireEvent.click(screen.getByRole('button', { name: '同意並送出' }));
    await waitFor(() => expect(saveFirstLoginProfile).toHaveBeenCalledTimes(1));
    expect(saveFirstLoginProfile).toHaveBeenCalledWith('U-me', {
      gender: '女',
      birthday: '1999/03/04',
      region: '臺中市',
      legalConsent: true,
    });
    await waitFor(() => expect(document.getElementById('first-login-modal')).toBeNull());
  });

  it('月份變更會清除不存在的日期，未補日期不得提交', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({ region: '' }));
    render(<ProfilePage />);
    await waitFor(() => expect(document.getElementById('first-login-modal')).toBeTruthy());
    await fillFirstLogin('');
    await setSelectById('fl-birthday-d', '31');
    await setSelectById('fl-birthday-m', '02');
    expect((document.getElementById('fl-birthday-d') as HTMLSelectElement).value).toBe('');
    await setLegalConsent(true);
    fireEvent.click(screen.getByRole('button', { name: '同意並送出' }));
    expectNoWrites();

    await setSelectById('fl-birthday-d', '28');
    fireEvent.click(screen.getByRole('button', { name: '同意並送出' }));
    await waitFor(() => expect(saveFirstLoginProfile).toHaveBeenCalledWith('U-me', {
      gender: '女',
      birthday: '1999/02/28',
      region: '臺中市',
      legalConsent: true,
    }));
  });

  it('首次表單可稍後填寫，不呼叫任何寫入', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({ region: '' }));
    render(<ProfilePage />);
    await waitFor(() => expect(document.getElementById('first-login-modal')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '稍後填寫' }));
    await waitFor(() => expect(document.getElementById('first-login-modal')).toBeNull());
    expectNoWrites();
  });

  // 測試同步更新：照 A（M-127）夥伴卡改就地展開＋CompanionModal；編輯保留既有 id 與未修改欄位。
  it('同行者可編輯，保留既有 ID 與未修改欄位', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({
      companions: [
        { id: 'c1', name: '小一', birthday: '2010/01/01', gender: '男', notes: '家人' },
      ],
    }));
    render(<ProfilePage />);
    await screen.findByText('王小明');
    fireEvent.click(screen.getByRole('button', { name: '我的運動夥伴' }));
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));

    const nameInput = document.getElementById('companion-modal-name') as HTMLInputElement | null;
    if (!nameInput) throw new Error('Expected #companion-modal-name');
    expect(nameInput.value).toBe('小一');
    await act(async () => {
      fireEvent.input(nameInput, { target: { value: '新名字' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    });

    await waitFor(() => expect(saveCompanions).toHaveBeenCalledTimes(1));
    // saveCompanion 只覆寫 name/gender/notes；birthday 等未修改欄位需原樣保留（A 對照）。
    expect(saveCompanions).toHaveBeenCalledWith('U-me', [
      { id: 'c1', name: '新名字', birthday: '2010/01/01', gender: '男', notes: '家人' },
    ]);
    expect(saveEduChildren).not.toHaveBeenCalled();
  });

  // 測試同步更新：照 A（M-127）連續新增兩名；ID 使用 generateId('comp_')，同一毫秒仍須不同，且不依賴 crypto。
  it('同一毫秒連續新增同行者仍得到不同的 comp_ ID（generateId），且不依賴 crypto', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1800000000000);
    vi.stubGlobal('crypto', {});

    render(<ProfilePage />);
    await screen.findByText('王小明');
    fireEvent.click(screen.getByRole('button', { name: '我的運動夥伴' }));

    fireEvent.click(screen.getByRole('button', { name: '+ 新增同行者' }));
    await waitFor(() => expect(document.getElementById('companion-modal-name')).toBeTruthy());
    await act(async () => {
      fireEvent.input(
        document.getElementById('companion-modal-name') as HTMLInputElement,
        { target: { value: '夥伴一' } },
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    });
    await waitFor(() => expect(saveCompanions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.getElementById('companion-modal-name')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '+ 新增同行者' }));
    await waitFor(() => expect(document.getElementById('companion-modal-name')).toBeTruthy());
    await act(async () => {
      fireEvent.input(
        document.getElementById('companion-modal-name') as HTMLInputElement,
        { target: { value: '夥伴二' } },
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    });
    await waitFor(() => expect(saveCompanions).toHaveBeenCalledTimes(2));

    const calls = vi.mocked(saveCompanions).mock.calls;
    const first = calls[0]?.[1] as Array<Record<string, unknown>> | undefined;
    const second = calls[1]?.[1] as Array<Record<string, unknown>> | undefined;
    if (!first || !second) throw new Error('Expected saveCompanions calls');
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);

    const id1 = first[0]?.['id'];
    const id2 = second[1]?.['id'];
    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');
    expect(id1).toMatch(/^comp_/);
    expect(id2).toMatch(/^comp_/);
    expect(id1).not.toBe(id2);
    expect(saveEduChildren).not.toHaveBeenCalled();
  });

  // 測試同步更新：照 A（M-128）子女卡已移除，個人頁不再渲染 #my-edu-children-card。
  it('照 A（M-128）個人頁不存在 #my-edu-children-card', async () => {
    render(<ProfilePage />);
    await screen.findByText('王小明');
    expect(document.getElementById('my-edu-children-card')).toBeNull();
  });

  // 測試同步更新：照 A（M-127）空姓名只 toast「請填寫姓名」，不呼叫任何寫入，彈窗保留。
  it('新增同行者未填姓名不得寫入', async () => {
    render(<ProfilePage />);
    await screen.findByText('王小明');
    fireEvent.click(screen.getByRole('button', { name: '我的運動夥伴' }));
    fireEvent.click(screen.getByRole('button', { name: '+ 新增同行者' }));
    await waitFor(() => expect(document.getElementById('companion-modal-name')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expectNoWrites();
    expect(document.getElementById('companion-modal-name')).toBeTruthy();
  });

  it('社群按鈕顯示 active 狀態並可開啟編輯器與清除', async () => {
    render(<ProfilePage />);
    const editLabel = `${zh.socialEdit}：Instagram`;
    const igBtn = await screen.findByRole('button', { name: editLabel });
    expect(igBtn.getAttribute('data-platform')).toBe('ig');
    expect(igBtn.classList.contains('active')).toBe(true);

    // 測試同步更新：照 A（M-130）社群編輯改為 #social-link-modal（#social-link-input、#social-clear-btn）。
    fireEvent.click(igBtn);
    await waitFor(() => expect(document.getElementById('social-link-modal')).toBeTruthy());
    const input = document.getElementById('social-link-input') as HTMLInputElement | null;
    if (!input) throw new Error('Expected #social-link-input');
    await act(async () => {
      fireEvent.input(input, { target: { value: 'new_account' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    });
    await waitFor(() => expect(saveSocialLink).toHaveBeenCalledWith('U-me', 'ig', 'new_account'));
    await waitFor(() => expect(document.getElementById('social-link-modal')).toBeNull());

    fireEvent.click(igBtn);
    await waitFor(() => expect(document.getElementById('social-link-modal')).toBeTruthy());
    await act(async () => {
      fireEvent.click(document.getElementById('social-clear-btn') as HTMLButtonElement);
    });
    await waitFor(() => expect(clearSocialLink).toHaveBeenCalledWith('U-me', 'ig'));
  });

  // 測試同步更新：照 A（M-123）IdentityEditor 移除，改由 LegacyIdentityCard.test.tsx 覆蓋；A 啟用時暱稱空白存「次身份」，不再擋提交。

  it('切換帳號立即隱藏舊資料，舊請求晚到不覆蓋新資料', async () => {
    const first = deferred<UserProfile | null>();
    const second = deferred<UserProfile | null>();
    vi.mocked(loadUserProfile).mockImplementation((uid) =>
      uid === 'U-one' ? first.promise : second.promise);

    vi.mocked(useViewer).mockReturnValue(viewer('U-one'));
    const result = render(<ProfilePage />);
    await waitFor(() => expect(loadUserProfile).toHaveBeenCalledWith('U-one'));

    vi.mocked(useViewer).mockReturnValue(viewer('U-two'));
    result.rerender(<ProfilePage />);
    await waitFor(() => expect(loadUserProfile).toHaveBeenCalledWith('U-two'));

    await act(async () => {
      second.resolve(profile({ uid: 'U-two', name: '新帳號' }));
      await second.promise;
    });
    expect(await screen.findByText('新帳號')).toBeTruthy();

    await act(async () => {
      first.resolve(profile({ uid: 'U-one', name: '舊帳號' }));
      await first.promise;
    });
    expect(screen.queryByText('舊帳號')).toBeNull();
    expect(screen.getByText('新帳號')).toBeTruthy();
  });
});

describe('公開名片', () => {
  it('未登入也可讀公開名片，只以路由 UID 查詢', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    vi.mocked(loadUserProfile).mockResolvedValue(profile({
      uid: 'U-public',
      name: '公開名稱',
      phone: '0912345678',
      email: 'private@example.com',
      birthday: '1990/02/03',
      companions: [{ name: '私密同行者' }],
    }));
    render(<PublicProfilePage uid="U-public" />);
    expect(await screen.findByText('公開名稱')).toBeTruthy();
    expect(loadUserProfile).toHaveBeenCalledWith('U-public');
    expect(screen.queryByText('0912345678')).toBeNull();
    expect(screen.queryByText('private@example.com')).toBeNull();
    expect(screen.queryByText('1990-02-03')).toBeNull();
    expect(screen.queryByText('私密同行者')).toBeNull();
    expect(loadRelatedActivities).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Instagram' }).getAttribute('href'))
      .toBe('https://www.instagram.com/example');
  });

  it('載入時顯示狀態', () => {
    vi.mocked(loadUserProfile).mockReturnValue(new Promise(() => {}));
    render(<PublicProfilePage uid="U-public" />);
    // 測試同步更新：照 A（M-133）改為 LegacyUserCard 的載入文字；圈用既有 .reg-loading。
    const status = screen.getByRole('status');
    expect(status.classList.contains('reg-loading')).toBe(true);
    expect(status.textContent).toContain('載入中...');
  });

  // 測試同步更新：照 A（M-133）LegacyUserCard 未提供重試按鈕，刪除「錯誤後可重試」測試。

  it('一般登入者看他人名片時 DOM 中沒有「聯繫方式」列與電話號碼', async () => {
    // 測試同步更新：照 A（M-133）站長改良：一般登入者不得看到他人聯繫方式。
    vi.mocked(useViewer).mockReturnValue(viewer('U-viewer', 'user'));
    vi.mocked(loadUserProfile).mockResolvedValue(profile({
      uid: 'U-public',
      name: '王小明',
      phone: '0912345678',
    }));
    render(<PublicProfilePage uid="U-public" />);
    expect(await screen.findByText('王小明')).toBeTruthy();
    expect(screen.queryByText('聯繫方式')).toBeNull();
    expect(screen.queryByText('0912345678')).toBeNull();
  });

  it('危險社群協定不產生連結', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({
      socialLinks: { ig: 'javascript:alert(1)', line: 'data:text/html,unsafe' },
    }));
    render(<PublicProfilePage uid="U-public" />);
    await screen.findByText('王小明');
    expect(screen.queryByRole('link', { name: 'Instagram' })).toBeNull();
    for (const anchor of document.querySelectorAll('a')) {
      expect(anchor.getAttribute('href')).not.toMatch(/^(javascript|data):/i);
    }
  });
});

describe('本機 QR', () => {
  it('未登入不產生 QR', () => {
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    render(<QrPage />);
    // 測試同步更新（R-QA-005）：站長決定訪客改顯示登入提示（M-029＋U-006）。
    expect(screen.getByText('登入後即可顯示簽到 QR Code')).toBeTruthy();
    expect(renderQrToCanvas).not.toHaveBeenCalled();
  });

  it('產生中顯示狀態', () => {
    vi.mocked(renderQrToCanvas).mockReturnValue(new Promise(() => {}));
    render(<QrPage />);
    const box = document.getElementById('page-qr-canvas');
    expect(box?.querySelector('.line-avatar-spinner')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(zh.qrLoading);
  });

  it('使用 raw UID；在 mock viewer／QR 資料層下不發出網路請求', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network forbidden')));
    vi.stubGlobal('fetch', fetchMock);
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const imageSource = vi.spyOn(HTMLImageElement.prototype, 'src', 'set');
    render(<QrPage />);

    expect(await screen.findByRole('img', { name: zh.qr })).toBeTruthy();
    expect(document.querySelector('.line-avatar-spinner')).toBeNull();
    expect(buildIdentityQrPayload).toHaveBeenCalledWith('U-me');
    expect(renderQrToCanvas).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 'U-me');
    expect(loadUserProfile).not.toHaveBeenCalled();
    expect(loadRelatedActivities).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(imageSource).not.toHaveBeenCalled();
    expect(document.querySelector('img')).toBeNull();
  });

  it('失敗顯示錯誤，重試本機 renderer，不建立外部圖片', async () => {
    vi.mocked(renderQrToCanvas)
      .mockRejectedValueOnce(new Error('canvas failed'))
      .mockResolvedValueOnce(undefined);
    render(<QrPage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(document.querySelector('.line-avatar-spinner')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    await clickButton(zh.retry);
    expect(await screen.findByRole('img', { name: zh.qr })).toBeTruthy();
    expect(renderQrToCanvas).toHaveBeenCalledTimes(2);
  });

  it('舊 UID 的晚到 canvas 不覆蓋新 UID', async () => {
    const oldRender = deferred<void>();
    vi.mocked(renderQrToCanvas).mockImplementation((_canvas, payload) =>
      payload === 'U-old' ? oldRender.promise : Promise.resolve());

    vi.mocked(useViewer).mockReturnValue(viewer('U-old'));
    const result = render(<QrPage />);
    await waitFor(() => expect(renderQrToCanvas).toHaveBeenCalledTimes(1));

    vi.mocked(useViewer).mockReturnValue(viewer('U-new'));
    result.rerender(<QrPage />);
    // 測試同步更新（R-QA-005）：照 A，一般用戶不顯示 UID 文字（M-026），改以產生 QR 的呼叫判斷。
    await waitFor(() =>
      expect(renderQrToCanvas).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), 'U-new'));

    await act(async () => {
      oldRender.resolve(undefined);
      await oldRender.promise;
    });
    expect(screen.queryByText('U-old')).toBeNull();
    expect(renderQrToCanvas).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), 'U-new');
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('/profile/qr 路由早於動態路由，實際 Router 不查詢 uid=qr', async () => {
    const routes = manifest.routes ?? [];
    const qrIndex = routes.findIndex((route) => route.path === '/profile/qr');
    const publicIndex = routes.findIndex((route) => route.path === '/profile/:uid');
    expect(qrIndex).toBeGreaterThanOrEqual(0);
    expect(publicIndex).toBeGreaterThan(qrIndex);

    const loaded = await Promise.all(routes.map(async (route) => {
      const PageComponent = (await route.load()).default as ComponentType<{ uid?: string }>;
      function RouteComponent(props: unknown) {
        const uid = props !== null
          && typeof props === 'object'
          && 'uid' in props
          && typeof props.uid === 'string'
          ? props.uid
          : undefined;
        return uid === undefined ? <PageComponent /> : <PageComponent uid={uid} />;
      }
      return { path: route.path, component: RouteComponent };
    }));

    window.history.replaceState(null, '', '/profile/qr');
    render(
      <LocationProvider>
        <Router>
          {loaded.map((route) => (
            <Route key={route.path} path={route.path} component={route.component} />
          ))}
        </Router>
      </LocationProvider>,
    );
    expect(await screen.findByRole('img', { name: zh.qr })).toBeTruthy();
    expect(loadUserProfile).not.toHaveBeenCalled();
  });

  it('直接傳入保留參數 qr 也不讀取使用者文件', async () => {
    render(<PublicProfilePage uid="qr" />);
    expect(await screen.findByRole('img', { name: zh.qr })).toBeTruthy();
    expect(loadUserProfile).not.toHaveBeenCalled();
  });
});
