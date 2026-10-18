// @vitest-environment jsdom
// Text 可能插入分詞節點；整段文案透過語意容器的 textContent 驗證。
// 本次依附件更新測試，未執行命令；194 項既有測試與新增案例仍須由執行環境驗證。
import type { ComponentType } from 'preact';
import { LocationProvider, Route, Router } from 'preact-iso';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import zh from './locales/zh-TW.json';
import ProfilePage from './pages/ProfilePage';
import PublicProfilePage from './pages/PublicProfilePage';
import QrPage from './pages/QrPage';
import { manifest } from './index';
import { loadUserProfile, type UserProfile } from './data/profile-model';
import { loadRelatedActivities } from './data/related-activities';
import { buildIdentityQrPayload, renderQrToCanvas } from './data/qr';
import {
  saveCompanions,
  saveEduChildren,
  saveFirstLoginProfile,
  saveSocialLink,
  clearSocialLink,
  commitIdentitySettings,
  commitSecondaryIdentityAvatar,
} from './data/profile-writes';
import { useViewer, type ViewerView } from './data/viewer';

vi.mock('./data/viewer', () => ({ useViewer: vi.fn() }));
vi.mock('./data/profile-model', () => ({ loadUserProfile: vi.fn() }));
vi.mock('./data/related-activities', () => ({ loadRelatedActivities: vi.fn() }));
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
  normalizeLineContactUrl: (value: unknown) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    return /^https?:\/\//i.test(raw) || /^line:\/\//i.test(raw)
      ? raw
      : `https://line.me/ti/p/${encodeURIComponent(raw.replace(/^@/, ''))}`;
  },
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

function viewer(uid: string | null = 'U-me'): ViewerView {
  return {
    uid,
    role: uid ? 'user' : 'guest',
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
    birthday: '2000-01-02',
    region: '臺北市',
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

// @testing-library/preact 的 fireEvent 已包裝同步 act。
// 每次操作完成後再進行下一次互動，不額外以 async act 包住同步事件。
// 不 mock validity、不直接 submit、不使用第二次 target 賦值掩蓋受控值回復。
async function selectValue(label: string, value: string): Promise<void> {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Expected select: ${label}`);
  }
  expect(element.disabled).toBe(false);
  expect(Array.from(element.options).some((option) => option.value === value)).toBe(true);

  // 原生 select 選取會先更新 value，再依序產生 input 與 change。
  // @testing-library/preact 偵測到 preact/compat（Modal 的 createPortal）後，會把 fireEvent.change
  // 改送 input 事件；但 compat 只把 input／textarea 的 onChange 轉成 onInput，select 仍聽原生 change，
  // 所以這裡直接派送原生 change（瀏覽器實際行為）。
  fireEvent.input(element, { target: { value } });
  await act(async () => {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await waitFor(() => {
    expect(screen.getByLabelText(label)).toBe(element);
    expect(element.value).toBe(value);
  });
}

async function inputValue(label: string, value: string): Promise<void> {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
    throw new Error(`Expected text input: ${label}`);
  }
  expect(element.disabled).toBe(false);
  fireEvent.input(element, { target: { value } });
  await waitFor(() => {
    expect(screen.getByLabelText(label)).toBe(element);
    expect(element.value).toBe(value);
  });
}

async function clickButton(name: string): Promise<void> {
  const element = screen.getByRole('button', { name });
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Expected button: ${name}`);
  }
  expect(element.disabled).toBe(false);
  // 保留原生 click 的送出行為；submit 之後的非同步結果由各案例等待。
  fireEvent.click(element);
}

async function setCheckbox(name: string, checked: boolean): Promise<void> {
  const element = screen.getByRole('checkbox', { name });
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected checkbox: ${name}`);
  }
  expect(element.disabled).toBe(false);

  // 使用原生 click 切換 checked 並產生 input/change，避免 DOM 與 state 分離。
  // 不手動設定 checked，也不補送可能隱藏事件綁定錯誤的 fallback 事件。
  if (element.checked !== checked) {
    fireEvent.click(element);
  }

  await waitFor(() => {
    expect(screen.getByRole('checkbox', { name })).toBe(element);
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

async function fillFirstLogin(email = 'a@example.com'): Promise<void> {
  await selectValue(zh.gender, '女');
  await selectValue(zh.year, '1999');
  await selectValue(zh.month, '3');
  await selectValue(zh.day, '4');
  await inputValue(zh.region, '臺中市');
  await inputValue(zh.email, email);

  // 在後續欄位造成重繪後重驗，避免只驗事件當下被手動設定的 DOM 值。
  expect((screen.getByLabelText(zh.gender) as HTMLSelectElement).value).toBe('女');
  expect((screen.getByLabelText(zh.year) as HTMLSelectElement).value).toBe('1999');
  expect((screen.getByLabelText(zh.month) as HTMLSelectElement).value).toBe('3');
  expect((screen.getByLabelText(zh.day) as HTMLSelectElement).value).toBe('4');
  expect((screen.getByLabelText(zh.region) as HTMLInputElement).value).toBe('臺中市');
  expect((screen.getByLabelText(zh.email) as HTMLInputElement).value).toBe(email);
}

function expectNoWrites(): void {
  expect(saveFirstLoginProfile).not.toHaveBeenCalled();
  expect(saveCompanions).not.toHaveBeenCalled();
  expect(saveEduChildren).not.toHaveBeenCalled();
  expect(saveSocialLink).not.toHaveBeenCalled();
  expect(clearSocialLink).not.toHaveBeenCalled();
  expect(commitIdentitySettings).not.toHaveBeenCalled();
  expect(commitSecondaryIdentityAvatar).not.toHaveBeenCalled();
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(useViewer).mockReturnValue(viewer());
  vi.mocked(loadUserProfile).mockResolvedValue(profile());
  vi.mocked(loadRelatedActivities).mockResolvedValue({
    registered: [],
    hosted: [],
    counts: { registered: 0, hosted: 0 },
  });
  vi.mocked(buildIdentityQrPayload).mockImplementation((uid) => uid.trim());
  vi.mocked(renderQrToCanvas).mockResolvedValue(undefined);
  vi.mocked(saveFirstLoginProfile).mockResolvedValue(undefined);
  vi.mocked(saveCompanions).mockResolvedValue(undefined);
  vi.mocked(saveEduChildren).mockResolvedValue(undefined);
  vi.mocked(saveSocialLink).mockResolvedValue(undefined);
  vi.mocked(clearSocialLink).mockResolvedValue(undefined);
  vi.mocked(commitIdentitySettings).mockResolvedValue(undefined);
  vi.mocked(commitSecondaryIdentityAvatar).mockResolvedValue(undefined);
  _setDictLoaderForTest(async () => flatten(zh));
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _setDictLoaderForTest(null);
  window.history.replaceState(null, '', '/');
});

describe('我的個人頁', () => {
  it('未登入只顯示登入引導，不載入個人資料', () => {
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    render(<ProfilePage />);
    expect(screen.getByText(zh.guest)).toBeTruthy();
    expect(loadUserProfile).not.toHaveBeenCalled();
    expect(loadRelatedActivities).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('顯示載入狀態', () => {
    vi.mocked(loadUserProfile).mockReturnValue(new Promise(() => {}));
    render(<ProfilePage />);
    expect(screen.getByRole('status').textContent).toContain(zh.loading);
  });

  it('正常顯示俱樂部與活動連結', async () => {
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
    expect(screen.getByText('測試俱樂部')).toBeTruthy();
    expect((await screen.findByRole('link', { name: '週末足球' })).getAttribute('href'))
      .toBe('/events/event-1');
    expect(screen.getByRole('link', { name: '晨間慢跑' }).getAttribute('href'))
      .toBe('/events/event-2');
    expect(loadRelatedActivities).toHaveBeenCalledWith('U-me');
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
    await screen.findByRole('dialog');
    await fillFirstLogin();
    await setCheckbox(zh.legalConsent, true);
    expectFormValid(zh.agreeSubmit);
    await clickButton(zh.agreeSubmit);

    await waitFor(() => expect(saveFirstLoginProfile).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole('alert')).textContent).toBe(zh.saveError);
    expect((screen.getByLabelText(zh.gender) as HTMLSelectElement).value).toBe('女');
    expect((screen.getByLabelText(zh.year) as HTMLSelectElement).value).toBe('1999');
    expect((screen.getByLabelText(zh.month) as HTMLSelectElement).value).toBe('3');
    expect((screen.getByLabelText(zh.day) as HTMLSelectElement).value).toBe('4');
    expect((screen.getByLabelText(zh.region) as HTMLInputElement).value).toBe('臺中市');
    expect((screen.getByLabelText(zh.email) as HTMLInputElement).value).toBe('a@example.com');
    expect((screen.getByRole('checkbox', { name: zh.legalConsent }) as HTMLInputElement).checked)
      .toBe(true);

    await waitFor(() => expect(
      (screen.getByRole('button', { name: zh.agreeSubmit }) as HTMLButtonElement).disabled,
    ).toBe(false));
    expectFormValid(zh.agreeSubmit);
    await clickButton(zh.agreeSubmit);
    await waitFor(() => expect(saveFirstLoginProfile).toHaveBeenCalledTimes(2));

    const expected = {
      gender: '女',
      birthday: '1999-03-04',
      region: '臺中市',
      email: 'a@example.com',
      legalConsent: true,
    };
    expect(saveFirstLoginProfile).toHaveBeenNthCalledWith(1, 'U-me', expected);
    expect(saveFirstLoginProfile).toHaveBeenNthCalledWith(2, 'U-me', expected);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(commitIdentitySettings).not.toHaveBeenCalled();
    expect(commitSecondaryIdentityAvatar).not.toHaveBeenCalled();
  });

  it('首次表單未勾法律同意不能送出；email 可留白', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({ region: '', email: '' }));
    render(<ProfilePage />);
    await screen.findByRole('dialog');
    await fillFirstLogin('');

    expect(screen.getByRole('link', { name: zh.terms }).getAttribute('href')).toBe('/terms');
    expect(screen.getByRole('link', { name: zh.privacy }).getAttribute('href')).toBe('/privacy');
    expect((screen.getByRole('checkbox', { name: zh.legalConsent }) as HTMLInputElement).checked)
      .toBe(false);
    await clickButton(zh.agreeSubmit);
    expectNoWrites();
    expect(screen.getByRole('dialog')).toBeTruthy();

    // 先勾選再取消，確認取消也同步至驗證與 state，而非永遠保留 true。
    await setCheckbox(zh.legalConsent, true);
    expectFormValid(zh.agreeSubmit);
    await setCheckbox(zh.legalConsent, false);
    await clickButton(zh.agreeSubmit);
    expectNoWrites();
    expect(screen.getByRole('dialog')).toBeTruthy();

    await setCheckbox(zh.legalConsent, true);
    expectFormValid(zh.agreeSubmit);
    await clickButton(zh.agreeSubmit);
    await waitFor(() => expect(saveFirstLoginProfile).toHaveBeenCalledTimes(1));
    expect(saveFirstLoginProfile).toHaveBeenCalledWith('U-me', {
      gender: '女',
      birthday: '1999-03-04',
      region: '臺中市',
      legalConsent: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('月份變更會清除不存在的日期，未補日期不得提交', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({ region: '' }));
    render(<ProfilePage />);
    await screen.findByRole('dialog');
    await fillFirstLogin('');
    await selectValue(zh.day, '31');
    await selectValue(zh.month, '2');
    expect((screen.getByLabelText(zh.day) as HTMLSelectElement).value).toBe('');
    await setCheckbox(zh.legalConsent, true);
    await clickButton(zh.agreeSubmit);
    expectNoWrites();

    await selectValue(zh.day, '28');
    expectFormValid(zh.agreeSubmit);
    await clickButton(zh.agreeSubmit);
    await waitFor(() => expect(saveFirstLoginProfile).toHaveBeenCalledWith('U-me', {
      gender: '女',
      birthday: '1999-02-28',
      region: '臺中市',
      legalConsent: true,
    }));
  });

  it('首次表單可稍後填寫，不呼叫任何寫入', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({ region: '' }));
    render(<ProfilePage />);
    await screen.findByRole('button', { name: zh.later });
    await clickButton(zh.later);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expectNoWrites();
  });

  it('同行者可編輯、刪除、新增，保留既有 ID 與未修改欄位', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({
      companions: [
        { id: 'c1', name: '小一', birthday: '2010-01-01', gender: '男', notes: '家人' },
        { id: 'c2', name: '小二', custom: 'keep' },
        { id: 'c3', name: '小三', custom: 'untouched' },
      ],
    }));
    render(<ProfilePage />);
    await screen.findByRole('button', { name: zh.companions });
    await clickButton(zh.companions);
    await inputValue(`${zh.name} 1`, '新名字');
    await selectValue(`${zh.gender} 1`, '女');
    await inputValue(`${zh.notes} 1`, '朋友');
    await clickButton(`${zh.remove} 2`);
    await clickButton(zh.add);
    await inputValue(`${zh.name} 3`, '新夥伴');

    expect((screen.getByLabelText(`${zh.name} 1`) as HTMLInputElement).value).toBe('新名字');
    expect((screen.getByLabelText(`${zh.gender} 1`) as HTMLSelectElement).value).toBe('女');
    expect((screen.getByLabelText(`${zh.notes} 1`) as HTMLTextAreaElement).value).toBe('朋友');
    expect((screen.getByLabelText(`${zh.name} 3`) as HTMLInputElement).maxLength).toBe(20);
    expect((screen.getByLabelText(`${zh.notes} 3`) as HTMLTextAreaElement).maxLength).toBe(50);
    expectFormValid(zh.save);
    await clickButton(zh.save);
    await waitFor(() => expect(saveCompanions).toHaveBeenCalledTimes(1));
    expect(saveCompanions).toHaveBeenCalledWith('U-me', [
      { id: 'c1', name: '新名字', birthday: '2010-01-01', gender: '女', notes: '朋友' },
      { id: 'c3', name: '小三', custom: 'untouched' },
      { id: expect.stringMatching(/^comp_\d+_[a-z0-9]+$/), name: '新夥伴', gender: '', notes: '' },
    ]);
    expect(saveEduChildren).not.toHaveBeenCalled();
  });

  it('同一毫秒連續新增同行者仍得到不同的 comp_ ID（generateId），且不依賴 crypto', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1800000000000);
    vi.stubGlobal('crypto', {});

    render(<ProfilePage />);
    await screen.findByRole('button', { name: zh.companions });
    await clickButton(zh.companions);
    await clickButton(zh.add);
    await inputValue(`${zh.name} 1`, '夥伴一');
    await clickButton(zh.add);
    await inputValue(`${zh.name} 2`, '夥伴二');
    expectFormValid(zh.save);
    await clickButton(zh.save);

    await waitFor(() => expect(saveCompanions).toHaveBeenCalledTimes(1));
    expect(saveCompanions).toHaveBeenCalledWith('U-me', [
      { id: expect.stringMatching(/^comp_\d+_[a-z0-9]+$/), name: '夥伴一', gender: '', notes: '' },
      { id: expect.stringMatching(/^comp_\d+_[a-z0-9]+$/), name: '夥伴二', gender: '', notes: '' },
    ]);

    const call = vi.mocked(saveCompanions).mock.calls[0];
    if (!call) throw new Error('Expected saveCompanions call');
    const ids = call[1].map((value) => {
      if (value === null || typeof value !== 'object' || !('id' in value)) {
        throw new Error('Expected companion with id');
      }
      if (typeof value.id !== 'string') throw new Error('Expected string companion id');
      return value.id;
    });
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(saveEduChildren).not.toHaveBeenCalled();
  });

  it('子女只顯示姓名與俱樂部；解除綁定後原樣保存剩餘物件', async () => {
    const removed = Object.freeze({
      id: 'student-remove',
      name: '孩子一',
      teamId: 'team-one',
      teamName: '第一俱樂部',
    });
    const kept = Object.freeze({
      id: 'student-keep',
      name: '  孩子二  ',
      teamId: 'team-two',
      teamName: '第二俱樂部',
      custom: Object.freeze({ source: 'education', tags: Object.freeze(['keep']) }),
      gender: '其他',
      notes: '原始資料',
    });
    const another = Object.freeze({
      id: 'student-another',
      name: '孩子三',
      teamId: 'team-three',
      teamName: '第三俱樂部',
      unknownField: null,
    });
    vi.mocked(loadUserProfile).mockResolvedValue(profile({
      eduChildren: [removed, kept, another],
    }));

    render(<ProfilePage />);
    await screen.findByRole('button', { name: zh.children });
    await clickButton(zh.children);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('孩子一');
    expect(dialog.textContent).toContain('第一俱樂部');
    expect(dialog.textContent).toContain('孩子二');
    expect(dialog.textContent).toContain('第二俱樂部');
    expect(dialog.textContent).toContain('孩子三');
    expect(dialog.textContent).toContain('第三俱樂部');
    expect(dialog.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: zh.add })).toBeNull();
    expect(screen.getAllByRole('button', { name: new RegExp(`^${zh.unlinkChild} \\d+$`) }))
      .toHaveLength(3);

    await clickButton(`${zh.unlinkChild} 1`);
    expect(dialog.textContent).not.toContain('孩子一');
    expect(dialog.textContent).not.toContain('第一俱樂部');
    expect(dialog.textContent).toContain('孩子二');
    expect(dialog.textContent).toContain('孩子三');
    expectNoWrites();
    expectFormValid(zh.save);
    await clickButton(zh.save);

    await waitFor(() => expect(saveEduChildren).toHaveBeenCalledTimes(1));
    expect(saveEduChildren).toHaveBeenCalledWith('U-me', [kept, another]);
    const call = vi.mocked(saveEduChildren).mock.calls[0];
    if (!call) throw new Error('Expected saveEduChildren call');
    expect(call[1][0]).toBe(kept);
    expect(call[1][1]).toBe(another);
    expect(saveCompanions).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await clickButton(zh.children);
    expect(screen.getByRole('dialog').textContent).not.toContain('孩子一');
    expect(screen.getByRole('dialog').textContent).toContain('第二俱樂部');
    expect(screen.getByRole('dialog').querySelectorAll('input, select, textarea')).toHaveLength(0);
  });

  it('空子女列表說明教育課程審核後自動綁定，不提供新增或輸入欄', async () => {
    render(<ProfilePage />);
    await screen.findByRole('button', { name: zh.children });
    await clickButton(zh.children);

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(zh.emptyChildren);
    expect(dialog.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: zh.add })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(`^${zh.unlinkChild}`) })).toBeNull();
    expectNoWrites();
  });

  it('解除最後一名子女後儲存空陣列', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({
      eduChildren: [{ id: 'student-only', name: '孩子', teamId: 'team-one', teamName: '第一俱樂部' }],
    }));
    render(<ProfilePage />);
    await screen.findByRole('button', { name: zh.children });
    await clickButton(zh.children);
    await clickButton(`${zh.unlinkChild} 1`);
    expect(screen.getByRole('dialog').textContent).toContain(zh.emptyChildren);
    expectNoWrites();
    expectFormValid(zh.save);
    await clickButton(zh.save);

    await waitFor(() => expect(saveEduChildren).toHaveBeenCalledWith('U-me', []));
    expect(saveEduChildren).toHaveBeenCalledTimes(1);
    expect(saveCompanions).not.toHaveBeenCalled();
  });

  it('子女解除綁定儲存失敗後保留剩餘原始資料並可重試', async () => {
    const kept = Object.freeze({
      id: 'student-keep',
      name: '留下的孩子',
      teamId: 'team-keep',
      teamName: '保留俱樂部',
      custom: Object.freeze({ keep: true }),
    });
    vi.mocked(loadUserProfile).mockResolvedValue(profile({
      eduChildren: [
        { id: 'student-remove', name: '解除的孩子', teamId: 'team-remove', teamName: '原俱樂部' },
        kept,
      ],
    }));
    vi.mocked(saveEduChildren)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);

    render(<ProfilePage />);
    await screen.findByRole('button', { name: zh.children });
    await clickButton(zh.children);
    await clickButton(`${zh.unlinkChild} 1`);
    await clickButton(zh.save);

    expect((await screen.findByRole('alert')).textContent).toBe(zh.saveError);
    expect(screen.getByRole('dialog').textContent).toContain('留下的孩子');
    expect(screen.getByRole('dialog').textContent).not.toContain('解除的孩子');
    expect(screen.getByRole('dialog').querySelectorAll('input, select, textarea')).toHaveLength(0);
    await waitFor(() => expect(
      (screen.getByRole('button', { name: zh.save }) as HTMLButtonElement).disabled,
    ).toBe(false));
    await clickButton(zh.save);

    await waitFor(() => expect(saveEduChildren).toHaveBeenCalledTimes(2));
    expect(saveEduChildren).toHaveBeenNthCalledWith(1, 'U-me', [kept]);
    expect(saveEduChildren).toHaveBeenNthCalledWith(2, 'U-me', [kept]);
    for (const call of vi.mocked(saveEduChildren).mock.calls) {
      expect(call[1][0]).toBe(kept);
    }
    expect(saveCompanions).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('新增同行者未填姓名不得寫入', async () => {
    render(<ProfilePage />);
    await screen.findByRole('button', { name: zh.companions });
    await clickButton(zh.companions);
    await clickButton(zh.add);
    await clickButton(zh.save);
    expectNoWrites();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('社群編輯與清除走指定方法', async () => {
    render(<ProfilePage />);
    const editLabel = `${zh.socialEdit}：Instagram`;
    await screen.findByRole('button', { name: editLabel });
    await clickButton(editLabel);
    await inputValue(zh.socialValue, 'new_account');
    expectFormValid(zh.save);
    await clickButton(zh.save);
    await waitFor(() => expect(saveSocialLink).toHaveBeenCalledWith('U-me', 'ig', 'new_account'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await clickButton(editLabel);
    await clickButton(zh.clear);
    await waitFor(() => expect(clearSocialLink).toHaveBeenCalledWith('U-me', 'ig'));
  });

  it('身分設定只傳明確表單欄位', async () => {
    // 此測試驗證 UI 專用 input；A 的 wire payload 由資料層 buildIdentitySettingsRequest 轉換。
    vi.mocked(loadUserProfile).mockResolvedValue(profile({
      role: 'super_admin',
      exp: 999,
      secondaryEnabled: false,
      secondaryDisplayName: '',
    }));
    render(<ProfilePage />);
    await screen.findByRole('button', { name: zh.identity });
    await clickButton(zh.identity);
    await setCheckbox(zh.enableIdentity, true);
    expect((screen.getByLabelText(zh.identityName) as HTMLInputElement).required).toBe(true);
    await inputValue(zh.identityName, '第二名字');
    expect((screen.getByRole('checkbox', { name: zh.enableIdentity }) as HTMLInputElement).checked)
      .toBe(true);
    expectFormValid(zh.save);
    await clickButton(zh.save);
    await waitFor(() => expect(commitIdentitySettings).toHaveBeenCalledTimes(1));
    expect(commitIdentitySettings).toHaveBeenCalledWith({
      secondaryEnabled: true,
      secondaryDisplayName: '第二名字',
    });
    expect(saveFirstLoginProfile).not.toHaveBeenCalled();
    expect(commitSecondaryIdentityAvatar).not.toHaveBeenCalled();
  });

  it('啟用次身分但名稱空白不得提交', async () => {
    render(<ProfilePage />);
    await screen.findByRole('button', { name: zh.identity });
    await clickButton(zh.identity);
    await setCheckbox(zh.enableIdentity, true);
    expect((screen.getByLabelText(zh.identityName) as HTMLInputElement).required).toBe(true);
    await inputValue(zh.identityName, '   ');
    await clickButton(zh.save);
    expectNoWrites();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('次身分頭像入口只提示稍後開放，不呼叫任何寫入或建立檔案輸入', async () => {
    render(<ProfilePage />);
    await screen.findByRole('button', { name: zh.identity });
    await clickButton(zh.identity);
    await clickButton(zh.secondaryAvatar);
    await waitFor(() => expect(
      screen.getAllByRole('status').some((element) => element.textContent === zh.comingSoon),
    ).toBe(true));
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expectNoWrites();
  });

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
      birthday: '1990-02-03',
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
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('錯誤後可重試', async () => {
    vi.mocked(loadUserProfile).mockRejectedValueOnce(new Error('offline'));
    render(<PublicProfilePage uid="U-public" />);
    await screen.findByRole('alert');
    await clickButton(zh.retry);
    expect(await screen.findByText('王小明')).toBeTruthy();
    expect(loadUserProfile).toHaveBeenCalledTimes(2);
  });

  it('明確私密資料不放入 DOM', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(profile({
      isPrivate: true,
      name: '不可顯示',
    }));
    render(<PublicProfilePage uid="U-private" />);
    expect(await screen.findByText(zh.unavailable)).toBeTruthy();
    expect(screen.queryByText('不可顯示')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
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
    expect(screen.getByText(zh.guest)).toBeTruthy();
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
    expect(await screen.findByText('U-new')).toBeTruthy();

    await act(async () => {
      oldRender.resolve(undefined);
      await oldRender.promise;
    });
    expect(screen.queryByText('U-old')).toBeNull();
    expect(screen.getByText('U-new')).toBeTruthy();
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
