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
import { loadRelatedActivities } from './data/related-activities';
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
vi.mock('./data/attendance-summary', () => ({
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

vi.mock('@/ui/AppConfirm', () => ({
  appConfirm: vi.fn().mockResolvedValue(true),
}));

// 測試同步更新：照 A（M-127/M-128）夥伴卡改就地展開（LegacyCompanionsCard 獨立測試）、子女卡移除。
// 第 2 段其他卡片在本檔 mock 成空元件，各自有獨立測試。
vi.mock('./components/legacy/LegacyFavoritesCard', () => ({
  LegacyFavoritesCard: () => null,
}));
vi.mock('./components/legacy/LegacyApplicationsCard', () => ({
  LegacyApplicationsCard: () => null,
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

  it('顯示載入狀態', () => {
    vi.mocked(loadUserProfile).mockReturnValue(new Promise(() => {}));
    render(<ProfilePage />);
    expect(screen.getByRole('status').textContent).toContain(zh.loading);
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

    // 出席統計有值時顯示數字，徽章顯示 --
    await waitFor(() => {
      expect(document.getElementById('profile-stat-total')?.textContent).toBe('8');
      expect(document.getElementById('profile-stat-done')?.textContent).toBe('5');
      expect(document.getElementById('profile-stat-rate')?.textContent).toBe('75%');
      expect(document.getElementById('profile-stat-badges')?.textContent).toBe('--');
    });

    // 切換為 admin 後可看到原始 UID
    vi.mocked(useViewer).mockReturnValue(viewer('U-me', 'admin'));
    rerender(<ProfilePage />);
    expect(document.getElementById('profile-uid-wrap')?.textContent).toContain('U-me');
  });

  // 測試同步更新：照 A（M-121）；T-038 成就/稱號先關閉
  it('出席統計讀不到時顯示 --，場景鑰匙不存在，成就/稱號反灰且點擊只顯示尚未開放', async () => {
    vi.mocked(loadUserAttendanceSummary).mockResolvedValue(null);
    render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();

    expect(document.getElementById('profile-stat-total')?.textContent).toBe('--');
    expect(document.getElementById('profile-stat-done')?.textContent).toBe('--');
    expect(document.getElementById('profile-stat-rate')?.textContent).toBe('--');

    // 測試同步更新：照 A（M-169）場景鑰匙入口已移除。
    expect(document.getElementById('profile-slot-banner')).toBeNull();
    expect(document.querySelector('.profile-scene-key')).toBeNull();

    // T-038（2026-10-26）：成就/稱號系統先關閉（exp-achievements/availability.ts），
    // 原本照 A（M-121）導頁的快捷改為反灰＋「尚未開放」提示，不導頁。
    routeMock.mockClear();
    const toastSpy = vi.spyOn(toast, 'show');
    fireEvent.click(screen.getByText('成就/徽章'));
    fireEvent.click(screen.getByText('稱號'));
    expect(routeMock).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledTimes(2);
    for (const call of toastSpy.mock.calls) {
      expect(call[0]).toEqual({ message: expect.stringMatching(/exp-achievements\.closed|尚未開放/) });
    }
    toastSpy.mockRestore();
  });

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
    expect(screen.getAllByText('測試俱樂部').length).toBeGreaterThan(0);
    await waitFor(() => expect(loadRelatedActivities).toHaveBeenCalledWith('U-me'));

    // 測試同步更新：照 A（M-170）「我的報名」「我開的團」進頁預設收起，展開才渲染清單。
    const regCard = document.getElementById('profile-registered-activities-card');
    const regToggle = regCard?.querySelector('.profile-collapse-toggle') as HTMLElement;
    expect(regToggle.classList.contains('open')).toBe(false);
    expect(document.getElementById('profile-registered-activities-list')).toBeNull();
    await waitFor(() => expect(document.getElementById('profile-registered-activities-count')?.textContent).toBe('1'));

    fireEvent.click(regToggle);
    expect(regToggle.classList.contains('open')).toBe(true);
    expect(document.getElementById('profile-registered-activities-list')).not.toBeNull();
    // A 的活動卡整列可點（data-event-id），標題不另包連結。
    expect((await screen.findByText('週末足球')).closest('.profile-related-event-card')?.getAttribute('data-event-id'))
      .toBe('event-1');

    const hostedCard = document.getElementById('profile-hosted-activities-card');
    const hostedToggle = hostedCard?.querySelector('.profile-collapse-toggle') as HTMLElement;
    expect(hostedToggle.classList.contains('open')).toBe(false);
    expect(document.getElementById('profile-hosted-activities-list')).toBeNull();
    expect(document.getElementById('profile-hosted-activities-count')?.textContent).toBe('1');

    fireEvent.click(hostedToggle);
    expect(hostedToggle.classList.contains('open')).toBe(true);
    expect(document.getElementById('profile-hosted-activities-list')).not.toBeNull();
    expect(screen.getByText('晨間慢跑').closest('.profile-related-event-card')?.getAttribute('data-event-id'))
      .toBe('event-2');

    // 再點一次「我的報名」收起，清單從 DOM 移除。
    fireEvent.click(regToggle);
    expect(regToggle.classList.contains('open')).toBe(false);
    expect(document.getElementById('profile-registered-activities-list')).toBeNull();
  });

  it('我的資料卡支援行內編輯、地區清單選擇、取消與儲存', async () => {
    render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();

    const infoCard = document.getElementById('profile-info-card')!;
    const toggle = infoCard.querySelector('.profile-collapse-toggle') as HTMLElement;
    fireEvent.click(toggle);

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

    const infoCard = document.getElementById('profile-info-card')!;
    fireEvent.click(infoCard.querySelector('.profile-collapse-toggle') as HTMLElement);
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

  it('U-042：地區清單可用鍵盤選擇並以 Escape 收起', async () => {
    render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();
    const infoCard = document.getElementById('profile-info-card')!;
    fireEvent.click(infoCard.querySelector('.profile-collapse-toggle') as HTMLElement);
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

  it('U-040：「我的資料」標題可用 Enter 展開', async () => {
    render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();
    const infoCard = document.getElementById('profile-info-card')!;
    const title = infoCard.querySelector('.profile-collapse-toggle') as HTMLElement;
    expect(title.getAttribute('role')).toBe('button');
    expect(title.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(title.getAttribute('aria-expanded')).toBe('true');
  });

  it('M-121：「我的資料」的 ? 開啟說明視窗，了解後關閉且卡片不展開', async () => {
    render(<ProfilePage />);
    expect(await screen.findByText('王小明')).toBeTruthy();
    const infoCard = document.getElementById('profile-info-card')!;
    const title = infoCard.querySelector('.profile-collapse-toggle') as HTMLElement;
    expect(title.getAttribute('aria-expanded')).toBe('false');

    const infoBtn = infoCard.querySelector('.edu-info-btn') as HTMLElement;
    fireEvent.click(infoBtn);
    await waitFor(() => {
      expect(document.querySelector('.edu-info-dialog-title')?.textContent).toBe('我的資料');
    });
    expect(title.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: '了解' }));
    await waitFor(() => {
      expect(document.querySelector('.edu-info-dialog-title')).toBeNull();
    });
    expect(title.getAttribute('aria-expanded')).toBe('false');
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
    // 測試同步更新：照 A（M-133）改為 LegacyUserCard 的載入文字。
    expect(screen.getByText('載入中...')).toBeTruthy();
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
    expect(screen.getByRole('status').textContent).toContain(zh.qrLoading);
  });

  it('使用 raw UID；在 mock viewer／QR 資料層下不發出網路請求', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network forbidden')));
    vi.stubGlobal('fetch', fetchMock);
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const imageSource = vi.spyOn(HTMLImageElement.prototype, 'src', 'set');
    render(<QrPage />);

    expect(await screen.findByRole('img', { name: zh.qr })).toBeTruthy();
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
