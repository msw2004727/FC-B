import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _setDictLoaderForTest, initLocale, t } from '@/i18n/i18n';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { EventDoc } from '../data/types';
import type { DirectoryUser } from '../data/user-directory';
import type { useCoverUpload } from './event-form/use-cover-upload';
import type { useDelegatePicker } from './event-form/use-delegate-picker';
import zhTW from '../locales/zh-TW.json';
import * as eventCreateMod from '../data/event-create';
import { EventFormModal } from './EventFormModal';

const mocks = vi.hoisted(() => ({
  cover: null as ReturnType<typeof useCoverUpload> | null,
  delegates: null as ReturnType<typeof useDelegatePicker> | null,
  coverReset: vi.fn(),
  delegateReset: vi.fn(),
  verify: vi.fn<ReturnType<typeof useDelegatePicker>['verifyForSubmit']>(),
  toast: vi.fn(),
  releaseBack: vi.fn(),
  onBack: null as (() => boolean) | null,
  notify: vi.fn(async () => 1),
  recipients: vi.fn(async (_docId: string) => ['U_reg_1']),
  users: [] as DirectoryUser[],
  loadDirectory: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
}));

vi.mock('@/ui/Toast', () => ({
  toast: { show: mocks.toast, clear: vi.fn() },
}));

vi.mock('@/core/overlay-back', () => ({
  pushOverlay: vi.fn((callback: () => boolean) => {
    mocks.onBack = callback;
    return mocks.releaseBack;
  }),
}));

vi.mock('./event-form/use-cover-upload', () => ({
  useCoverUpload: () => {
    if (!mocks.cover) throw new Error('missing cover mock');
    return mocks.cover;
  },
}));

vi.mock('./event-form/use-delegate-picker', () => ({
  useDelegatePicker: () => {
    if (!mocks.delegates) throw new Error('missing delegate mock');
    return mocks.delegates;
  },
}));

vi.mock('../data/event-create', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/event-create')>();
  return {
    ...actual,
    newEventId: vi.fn(() => 'ce_fixed_id_001'),
    createEvent: vi.fn(),
    updateEventBasics: vi.fn(),
  };
});

vi.mock('../data/event-change-notify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/event-change-notify')>();
  return {
    ...actual,
    loadEventNotifyRecipientUids: mocks.recipients,
    notifyEventChanged: mocks.notify,
  };
});

vi.mock('../data/user-directory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/user-directory')>();
  return {
    ...actual,
    getUserDirectory: () => mocks.users,
    loadUserDirectory: mocks.loadDirectory,
  };
});

const TEST_VIEWER = {
  uid: 'u_host_1',
  displayName: '測試團主',
  role: 'coach',
  roleLevel: 2,
  capabilities: ['user.activity.basic_create', 'user.activity.delegate_assign'],
  teamIds: new Set<string>(),
  hasPermission: () => true,
  permissionSources: {
    rolePermissions: ['activity.manage.entry', 'event.create', 'event.edit_self'],
    userGrants: [],
    customRoles: [],
  },
} as unknown as ViewerView;

const EXISTING = {
  id: 'ce_edit_99',
  _docId: 'document_edit_99',
  creatorUid: 'u_host_1',
  title: '既有活動名稱',
  type: 'camp',
  location: '台中市運動場',
  date: '2026/08/20 10:00~12:00',
  max: 30,
  current: 10,
  minAge: 15,
  notes: '既有注意事項',
  sportTag: 'basketball',
  regionEnabled: true,
  region: '中部',
  cities: ['台中市'],
  image: 'https://example.test/old-cover.jpg',
  delegates: [{ uid: 'delegate_a', name: '既有委託人' }],
} as unknown as EventDoc;

function flattenDict(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flattenDict(value as Record<string, unknown>, path));
    } else {
      out[path] = String(value);
    }
  }
  return out;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`missing element: ${selector}`);
  return result;
}

function renderForm(options: {
  mode?: 'create' | 'edit';
  existing?: EventDoc;
  viewer?: ViewerView;
  onClose?: () => void;
  onSaved?: (result: {
    mode: 'create' | 'edit';
    eventId: string;
    title: string;
    count: number;
  }) => void;
} = {}) {
  return render(
    <EventFormModal
      open
      mode={options.mode ?? 'create'}
      existing={options.existing}
      viewer={options.viewer ?? TEST_VIEWER}
      onClose={options.onClose ?? (() => undefined)}
      onSaved={options.onSaved ?? (() => undefined)}
    />,
  );
}

async function fillCreate(): Promise<void> {
  await act(async () => {
    fireEvent.input(element('#ce-title'), { target: { value: '週六足球團' } });
    fireEvent.input(element('#ce-location'), { target: { value: '大安森林公園' } });
    fireEvent.input(element('#ce-date'), { target: { value: '2099-12-31' } });
  });
  await act(async () => { fireEvent.click(element('#ce-sport-selected')); });
  await act(async () => {
    fireEvent.click(screen.getByRole('option', { name: '足球' }));
  });
}

async function submit(): Promise<void> {
  await act(async () => { fireEvent.click(element('#ce-submit-btn')); });
}

function createResult(): Awaited<ReturnType<typeof eventCreateMod.createEvent>> {
  return {
    eventId: 'ce_fixed_id_001',
    payload: {} as eventCreateMod.EventCreatePayload,
    alreadyExisted: false,
    addonsStripped: false,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  document.documentElement.lang = 'zh-TW';
  _setDictLoaderForTest(async () => flattenDict(zhTW, 'events'));
  await initLocale();
  document.documentElement.lang = 'zh-TW';

  mocks.onBack = null;
  mocks.users = [];
  mocks.loadDirectory.mockReset().mockResolvedValue(true);
  mocks.verify.mockReset().mockResolvedValue({ ok: true });
  mocks.cover = {
    view: { previewUrl: '', onPickFile: vi.fn() },
    cropper: <div data-testid="cover-cropper" />,
    value: { image: '' },
    reset: mocks.coverReset,
  };
  mocks.delegates = {
    view: {
      chips: [],
      canManage: true,
      query: '',
      results: [],
      dropdownOpen: false,
      dropdownStatus: '',
      placeholder: '搜尋用戶...',
      inputDisabled: false,
      onQuery: vi.fn(),
      onFocus: vi.fn(),
      onPick: vi.fn(),
      onRemove: vi.fn(),
    },
    value: [],
    reset: mocks.delegateReset,
    verifyForSubmit: mocks.verify,
  };

  vi.mocked(eventCreateMod.createEvent).mockReset().mockResolvedValue(createResult());
  vi.mocked(eventCreateMod.updateEventBasics).mockReset().mockResolvedValue({
    updates: {},
    capacityChange: null,
    addonsStripped: false,
  });
  mocks.recipients.mockReset().mockResolvedValue(['U_reg_1']);
  mocks.notify.mockReset().mockResolvedValue(1);
});

afterEach(() => {
  cleanup();
  _setDictLoaderForTest(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.style.removeProperty('overflow');
});

describe('EventFormModal（1D）', () => {
  it('建立時輸出 A 外殼、各列與預設值，裁圖在表單外層', () => {
    renderForm();
    const dialog = element('#create-event-modal');
    expect(dialog.parentElement?.className).toBe('legacy-ui create-event-modal-open');
    expect(dialog.className).toBe('modal create-event-modal-v2-shell ce-v2-enabled open');
    expect(dialog.getAttribute('data-no-backdrop-close')).toBe('1');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('ce-modal-title');
    expect(element('#ce-modal-title').textContent).toBe('新增活動');
    expect(element('#ce-submit-btn').textContent).toBe('建立活動');
    expect(element<HTMLInputElement>('#ce-title').maxLength).toBe(16);
    expect(element<HTMLInputElement>('#ce-title').value).toBe('');
    expect(element<HTMLSelectElement>('#ce-type').value).toBe('play');
    expect(element<HTMLInputElement>('#ce-time-start').value).toBe('14:00');
    expect(element<HTMLInputElement>('#ce-time-end').value).toBe('16:00');
    expect(element<HTMLInputElement>('#ce-max').value).toBe('20');
    expect(screen.getByText('開啟 — 指定活動地區')).toBeTruthy();
    expect(screen.getByText('立即開放報名')).toBeTruthy();
    expect(screen.getByText('關閉 — 不限制年齡')).toBeTruthy();
    expect(screen.getByText('* 必選，未選擇運動 / 場景標籤將無法儲存活動')).toBeTruthy();
    expect(element('#ce-location-status').textContent).toBe('GPS功能未開啟');
    expect(element<HTMLButtonElement>('#ce-location-btn').disabled).toBe(true);
    expect(element('#ce-location-btn').textContent).toBe('設定地圖座標');
    expect(dialog.contains(screen.getByTestId('cover-cropper'))).toBe(false);
    expect(dialog.parentElement?.contains(screen.getByTestId('cover-cropper'))).toBe(true);
    expect(mocks.coverReset).toHaveBeenCalledWith({ image: '' });
    expect(mocks.delegateReset).toHaveBeenCalledWith([]);
  });

  it('委託人驗證先於一般欄位驗證；失敗時顯示訊息且不寫入', async () => {
    mocks.verify.mockResolvedValue({
      ok: false,
      message: '委託人資料已失效，請重新選擇後再送出',
    });
    renderForm();
    await submit();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: '委託人資料已失效，請重新選擇後再送出',
      tone: 'error',
    }));
    expect(eventCreateMod.createEvent).not.toHaveBeenCalled();
    expect(eventCreateMod.updateEventBasics).not.toHaveBeenCalled();
    expect(element<HTMLButtonElement>('#ce-submit-btn').disabled).toBe(false);
  });

  it('一般欄位驗證失敗不呼叫 createEvent', async () => {
    renderForm();
    await submit();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(eventCreateMod.createEvent).not.toHaveBeenCalled();
  });

  it('建立帶入封面、委託人、固定 public id 與完整 onSaved 參數', async () => {
    if (!mocks.cover || !mocks.delegates) throw new Error('missing mocks');
    const variants = {} as NonNullable<ReturnType<typeof useCoverUpload>['value']['imageVariants']>;
    mocks.cover.value = { image: 'data:image/jpeg;base64,cover', imageVariants: variants };
    mocks.delegates.value = [{ uid: 'delegate_a', name: '委託甲' }];
    const onSaved = vi.fn();
    renderForm({ onSaved });
    await fillCreate();
    await submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({
      mode: 'create',
      eventId: 'ce_fixed_id_001',
      title: '週六足球團',
      count: 1,
    }));
    expect(eventCreateMod.createEvent).toHaveBeenCalledTimes(1);
    const call = vi.mocked(eventCreateMod.createEvent).mock.calls[0];
    expect(call?.[0]).toMatchObject({
      image: 'data:image/jpeg;base64,cover',
      imageVariants: variants,
      delegates: [{ uid: 'delegate_a', name: '委託甲' }],
    });
    expect(call?.[2]).toBe('ce_fixed_id_001');
  });

  it('委託人驗證完成後使用最新名稱，不使用送出前的快照', async () => {
    if (!mocks.delegates) throw new Error('missing delegates');
    mocks.delegates.value = [{ uid: 'delegate_a', name: '舊名稱' }];
    mocks.verify.mockImplementation(async () => {
      if (!mocks.delegates) throw new Error('missing delegates');
      mocks.delegates = {
        ...mocks.delegates,
        value: [{ uid: 'delegate_a', name: '最新名稱' }],
      };
      return { ok: true };
    });
    renderForm();
    await fillCreate();
    await submit();
    await waitFor(() => expect(eventCreateMod.createEvent).toHaveBeenCalledTimes(1));
    expect(vi.mocked(eventCreateMod.createEvent).mock.calls[0]?.[0].delegates).toEqual([
      { uid: 'delegate_a', name: '最新名稱' },
    ]);
  });

  it('驗證及建立期間防連點、顯示建立中，取消／✕／返回鍵都不關', async () => {
    const verification = deferred<Awaited<ReturnType<typeof mocks.verify>>>();
    const creation = deferred<Awaited<ReturnType<typeof eventCreateMod.createEvent>>>();
    mocks.verify.mockReturnValue(verification.promise);
    vi.mocked(eventCreateMod.createEvent).mockReturnValue(creation.promise);
    const onClose = vi.fn();
    renderForm({ onClose });
    await fillCreate();

    await act(async () => {
      fireEvent.click(element('#ce-submit-btn'));
      fireEvent.click(element('#ce-submit-btn'));
    });
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(element('#ce-submit-btn').textContent).toBe('建立中...');
    expect(element<HTMLButtonElement>('#ce-submit-btn').disabled).toBe(true);
    expect(element('#ce-submit-btn').style.opacity).toBe('0.72');
    expect(element('#ce-submit-btn').style.cursor).toBe('not-allowed');

    await act(async () => {
      fireEvent.click(element('#modal-overlay'));
      fireEvent.click(element('#create-event-modal > .modal-actions .outline-btn'));
      fireEvent.click(element('#create-event-modal .modal-close'));
    });
    expect(mocks.onBack?.()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { verification.resolve({ ok: true }); });
    await waitFor(() => expect(eventCreateMod.createEvent).toHaveBeenCalledTimes(1));
    expect(element('#ce-submit-btn').textContent).toBe('建立中...');
    expect(mocks.onBack?.()).toBe(false);
    await act(async () => { creation.resolve(createResult()); });
    await waitFor(() => expect(element('#ce-submit-btn').textContent).toBe('建立活動'));
  });

  it('未送出時遮罩仍不關，取消／✕／返回鍵使用目前 callback', async () => {
    const onClose = vi.fn();
    const nextClose = vi.fn();
    const view = renderForm({ onClose });
    await act(async () => { fireEvent.click(element('#modal-overlay')); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(element('#create-event-modal > .modal-actions .outline-btn'));
      fireEvent.click(element('#create-event-modal .modal-close'));
    });
    expect(onClose).toHaveBeenCalledTimes(2);

    view.rerender(
      <EventFormModal open mode="create" viewer={TEST_VIEWER}
        onClose={nextClose} onSaved={() => undefined} />,
    );
    expect(mocks.onBack?.()).toBe(true);
    expect(nextClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(mocks.releaseBack).toHaveBeenCalledTimes(1);
  });

  it('鎖定並還原原 overflow 與 important priority', () => {
    document.body.style.setProperty('overflow', 'scroll', 'important');
    const view = renderForm();
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).toBe('scroll');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
  });

  it('原本沒有 overflow 時，關閉移除暫存樣式', () => {
    document.body.style.removeProperty('overflow');
    const view = renderForm();
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.getPropertyValue('overflow')).toBe('');
  });

  it('編輯預填既有值並只保留 addons，送出中顯示儲存中', async () => {
    const update = deferred<Awaited<ReturnType<typeof eventCreateMod.updateEventBasics>>>();
    vi.mocked(eventCreateMod.updateEventBasics).mockReturnValue(update.promise);
    const variants = {} as NonNullable<ReturnType<typeof useCoverUpload>['value']['imageVariants']>;
    const existing = { ...EXISTING, imageVariants: variants };
    const onSaved = vi.fn();
    renderForm({ mode: 'edit', existing, onSaved });

    expect(element('#ce-modal-title').textContent).toBe('編輯活動');
    // 測試同步更新：照 A（1D-1、C-003）。
    expect(element('#ce-submit-btn').textContent).toBe('儲存修改');
    expect(element<HTMLInputElement>('#ce-title').value).toBe('既有活動名稱');
    expect(element<HTMLInputElement>('#ce-location').value).toBe('台中市運動場');
    expect(element<HTMLInputElement>('#ce-date').value).toBe('2026-08-20');
    expect(mocks.coverReset).toHaveBeenCalledWith({
      image: EXISTING.image,
      imageVariants: variants,
    });
    expect(mocks.delegateReset).toHaveBeenCalledWith([
      { uid: 'delegate_a', name: '既有委託人' },
    ]);

    await submit();
    await waitFor(() => expect(eventCreateMod.updateEventBasics).toHaveBeenCalledTimes(1));
    expect(element('#ce-submit-btn').textContent).toBe('儲存中');
    const call = vi.mocked(eventCreateMod.updateEventBasics).mock.calls[0];
    expect(call?.[0]).toMatchObject({ id: 'ce_edit_99', docId: 'document_edit_99' });
    // 測試同步更新：照 A（1D-3），封面及委託人改由表單帶入。
    expect(call?.[3]).toEqual({ addons: true });

    await act(async () => {
      update.resolve({ updates: {}, capacityChange: null, addonsStripped: false });
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({
      mode: 'edit',
      eventId: 'ce_edit_99',
      title: '既有活動名稱',
      count: 1,
    }));
  });

  it('只在重新開啟時 reset，普通重繪不覆蓋使用者輸入', async () => {
    const view = renderForm();
    await act(async () => {
      fireEvent.input(element('#ce-title'), { target: { value: '尚未送出的標題' } });
    });
    view.rerender(
      <EventFormModal open mode="create" viewer={{ ...TEST_VIEWER }}
        onClose={() => undefined} onSaved={() => undefined} />,
    );
    expect(element<HTMLInputElement>('#ce-title').value).toBe('尚未送出的標題');
    expect(mocks.coverReset).toHaveBeenCalledTimes(1);
    expect(mocks.delegateReset).toHaveBeenCalledTimes(1);

    view.rerender(
      <EventFormModal open={false} mode="create" viewer={TEST_VIEWER}
        onClose={() => undefined} onSaved={() => undefined} />,
    );
    view.rerender(
      <EventFormModal open mode="create" viewer={TEST_VIEWER}
        onClose={() => undefined} onSaved={() => undefined} />,
    );
    expect(mocks.coverReset).toHaveBeenCalledTimes(2);
    expect(mocks.delegateReset).toHaveBeenCalledTimes(2);
    expect(element<HTMLInputElement>('#ce-title').value).toBe('');
  });

  it('無管理入口的主辦方不可將名額降至已正取人數以下', async () => {
    const viewer = {
      ...TEST_VIEWER,
      role: 'user',
      roleLevel: 0,
      hasPermission: () => false,
      permissionSources: {
        rolePermissions: ['event.create', 'event.edit_self'],
        userGrants: [],
        customRoles: [],
      },
    } as ViewerView;
    renderForm({ mode: 'edit', existing: EXISTING, viewer });
    await act(async () => {
      fireEvent.input(element('#ce-max'), { target: { value: '5' } });
    });
    await submit();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: t('events.form.error.maxBelowConfirmed'),
      tone: 'error',
    }));
    expect(eventCreateMod.updateEventBasics).not.toHaveBeenCalled();
  });

  it('通知欄位改變才通知，查收件人用文件 id，通知用 public id', async () => {
    vi.mocked(eventCreateMod.updateEventBasics).mockResolvedValueOnce({
      updates: { title: '新的活動名稱' },
      capacityChange: null,
      addonsStripped: false,
    });
    const view = renderForm({ mode: 'edit', existing: EXISTING });
    await act(async () => {
      fireEvent.input(element('#ce-title'), { target: { value: '新的活動名稱' } });
    });
    await submit();
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
    expect(mocks.recipients).toHaveBeenCalledWith('document_edit_99');
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'ce_edit_99',
      title: '新的活動名稱',
      recipientUids: ['U_reg_1'],
      senderUid: TEST_VIEWER.uid,
    }));
    view.unmount();

    mocks.notify.mockClear();
    mocks.recipients.mockClear();
    vi.mocked(eventCreateMod.updateEventBasics).mockResolvedValueOnce({
      updates: { image: '' },
      capacityChange: null,
      addonsStripped: false,
    });
    const onSaved = vi.fn();
    renderForm({ mode: 'edit', existing: EXISTING, onSaved });
    await submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.recipients).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('通知失敗仍回報儲存成功', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.recipients.mockRejectedValueOnce(new Error('offline'));
    vi.mocked(eventCreateMod.updateEventBasics).mockResolvedValueOnce({
      updates: { title: '異動標題' },
      capacityChange: null,
      addonsStripped: false,
    });
    const onSaved = vi.fn();
    renderForm({ mode: 'edit', existing: EXISTING, onSaved });
    await submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(warn).toHaveBeenCalled());
  });

  it.each([
    ['BASIC_CREATE_REQUIRED', 'events.form.error.createNotAllowed', 'create'],
    ['CREATE_NOT_ALLOWED', 'events.form.error.createNotAllowed', 'create'],
    ['EDIT_NOT_ALLOWED', 'events.form.error.editNotAllowed', 'edit'],
  ] as const)('權限錯誤 %s 顯示既有提示', async (code, key, mode) => {
    // ASSUMPTION: 附件未提供 EventCreateError 建構式；以既有 prototype 模擬資料層錯誤。
    const error = Object.assign(new Error(code), { code });
    Object.setPrototypeOf(error, eventCreateMod.EventCreateError.prototype);
    if (mode === 'edit') {
      vi.mocked(eventCreateMod.updateEventBasics).mockRejectedValueOnce(error);
    } else {
      vi.mocked(eventCreateMod.createEvent).mockRejectedValueOnce(error);
    }
    const onSaved = vi.fn();
    renderForm({ mode, existing: mode === 'edit' ? EXISTING : undefined, onSaved });
    if (mode === 'create') await fillCreate();
    await submit();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: t(key),
      tone: 'error',
    }));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('第一次寫入失敗可重試，沿用相同建立 id', async () => {
    vi.mocked(eventCreateMod.createEvent)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(createResult());
    const onSaved = vi.fn();
    renderForm({ onSaved });
    await fillCreate();
    await submit();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: t('events.form.error.submitFailed'),
      tone: 'error',
    }));
    await submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(eventCreateMod.createEvent).toHaveBeenCalledTimes(2);
    expect(vi.mocked(eventCreateMod.createEvent).mock.calls.map(call => call[2])).toEqual([
      'ce_fixed_id_001',
      'ce_fixed_id_001',
    ]);
  });

  it('卸載後晚到建立結果不 toast、不呼叫 onSaved', async () => {
    const creation = deferred<Awaited<ReturnType<typeof eventCreateMod.createEvent>>>();
    vi.mocked(eventCreateMod.createEvent).mockReturnValue(creation.promise);
    const onSaved = vi.fn();
    const view = renderForm({ onSaved });
    await fillCreate();
    await submit();
    await waitFor(() => expect(eventCreateMod.createEvent).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      creation.resolve({ ...createResult(), addonsStripped: true });
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('關閉再開啟時舊驗證結果不得送出新表單', async () => {
    const verification = deferred<Awaited<ReturnType<typeof mocks.verify>>>();
    mocks.verify.mockReturnValueOnce(verification.promise);
    const view = renderForm();
    await fillCreate();
    await submit();
    view.rerender(
      <EventFormModal open={false} mode="create" viewer={TEST_VIEWER}
        onClose={() => undefined} onSaved={() => undefined} />,
    );
    view.rerender(
      <EventFormModal open mode="create" viewer={TEST_VIEWER}
        onClose={() => undefined} onSaved={() => undefined} />,
    );
    await act(async () => { verification.resolve({ ok: true }); });
    expect(eventCreateMod.createEvent).not.toHaveBeenCalled();
    expect(element('#ce-submit-btn').textContent).toBe('建立活動');
  });

  it.each([
    '載入用戶資料…',
    '正在更新用戶資料…',
    '找不到符合的用戶',
    '用戶資料載入失敗，請稍後重試',
  ])('委託人下拉使用 A 狀態文字：%s', (message) => {
    if (!mocks.delegates) throw new Error('missing delegates');
    mocks.delegates.view = {
      ...mocks.delegates.view,
      dropdownOpen: true,
      dropdownStatus: message,
    };
    renderForm();
    const dropdown = element('#ce-delegate-dropdown');
    expect(dropdown.classList.contains('open')).toBe(true);
    expect(dropdown.textContent).toBe(message);
    expect(dropdown.firstElementChild?.getAttribute('style')).toContain('var(--text-muted)');
  });

  it('dropdownStatus 空字串不自行顯示找不到文字', () => {
    if (!mocks.delegates) throw new Error('missing delegates');
    mocks.delegates.view.dropdownOpen = true;
    mocks.delegates.view.dropdownStatus = '';
    renderForm();
    expect(element('#ce-delegate-dropdown').textContent).toBe('');
  });
});

describe('委託人真實 hook 的狀態文字（1D-4）', () => {
  // 測試同步更新：照 A（1D-4）；放在本卡有所有權的測試檔，其他 hook 測試檔不修改。
  async function actualHook() {
    return vi.importActual<typeof import('./event-form/use-delegate-picker')>(
      './event-form/use-delegate-picker',
    );
  }

  it('空目錄載入中，完成後顯示找不到', async () => {
    const actual = await actualHook();
    const loading = deferred<boolean>();
    mocks.loadDirectory.mockReturnValueOnce(loading.promise);
    const { result } = renderHook(() =>
      actual.useDelegatePicker({ viewer: TEST_VIEWER, existing: null }),
    );
    act(() => result.current.view.onQuery('找不到'));
    expect(result.current.view.dropdownStatus).toBe('載入用戶資料…');
    await act(async () => { loading.resolve(true); });
    expect(result.current.view.dropdownStatus).toBe('找不到符合的用戶');
  });

  it('有快取但無結果時顯示更新中；載入失敗顯示 A 原文', async () => {
    const actual = await actualHook();
    mocks.users = [{
      uid: 'cached',
      name: '快取',
      displayName: '快取',
      pictureUrl: '',
      role: 'user',
    }];
    const loading = deferred<boolean>();
    mocks.loadDirectory.mockReturnValueOnce(loading.promise);
    const { result } = renderHook(() =>
      actual.useDelegatePicker({ viewer: TEST_VIEWER, existing: null }),
    );
    act(() => result.current.view.onQuery('不存在'));
    expect(result.current.view.dropdownStatus).toBe('正在更新用戶資料…');
    await act(async () => { loading.resolve(false); });
    expect(result.current.view.dropdownStatus).toBe('用戶資料載入失敗，請稍後重試');
  });

  it('目錄拒絕後可以重新搜尋成功，清除失敗狀態', async () => {
    const actual = await actualHook();
    mocks.loadDirectory.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() =>
      actual.useDelegatePicker({ viewer: TEST_VIEWER, existing: null }),
    );
    await act(async () => { result.current.view.onQuery('甲'); });
    await waitFor(() =>
      expect(result.current.view.dropdownStatus).toBe('用戶資料載入失敗，請稍後重試'),
    );
    mocks.users = [{
      uid: 'a',
      name: '甲',
      displayName: '甲',
      pictureUrl: '',
      role: 'user',
    }];
    await act(async () => { result.current.view.onQuery('甲'); });
    expect(mocks.loadDirectory).toHaveBeenCalledTimes(2);
    expect(result.current.view.results.map(item => item.uid)).toEqual(['a']);
    expect(result.current.view.dropdownStatus).toBe('');
  });

  it('舊搜尋晚到不覆寫新查詢狀態，清空查詢隱藏狀態', async () => {
    const actual = await actualHook();
    const old = deferred<boolean>();
    const recent = deferred<boolean>();
    mocks.loadDirectory.mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
    const { result } = renderHook(() =>
      actual.useDelegatePicker({ viewer: TEST_VIEWER, existing: null }),
    );
    act(() => result.current.view.onQuery('舊'));
    act(() => result.current.view.onQuery('新'));
    await act(async () => { recent.resolve(true); });
    expect(result.current.view.dropdownStatus).toBe('找不到符合的用戶');
    await act(async () => { old.resolve(false); });
    expect(result.current.view.dropdownStatus).toBe('找不到符合的用戶');
    act(() => result.current.view.onQuery(''));
    expect(result.current.view.dropdownStatus).toBe('');
    expect(result.current.view.dropdownOpen).toBe(false);
  });
});
