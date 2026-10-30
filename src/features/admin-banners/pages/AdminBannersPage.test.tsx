import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import zhTw from '../locales/zh-TW.json';
import { BannerWriteError } from '../data/banner-admin';
import type { BannerSlot } from '../data/banner-model';
import AdminBannersPage, { BANNER_TRANSITION_INTERVAL_MS } from './AdminBannersPage';

// ── i18n：直接用 zh-TW 字典，確保文案與 A 一致 ─────────────
function flatten(obj: Record<string, unknown>, prefix: string, out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}.${key}`;
    if (value && typeof value === 'object') flatten(value as Record<string, unknown>, path, out);
    else out[path] = String(value);
  }
  return out;
}
const dict = flatten(zhTw as Record<string, unknown>, 'admin-banners');
/** 個別案例覆寫某個字串（例如驗證「資料裡的預設名稱不隨語系翻譯」）；afterEach 會清掉。 */
const dictOverrides: Record<string, string> = {};

vi.mock('@/i18n/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    let text = dictOverrides[key] ?? dict[key] ?? key;
    for (const [k, v] of Object.entries(params ?? {})) text = text.replace(`{${k}}`, String(v));
    return text;
  },
  lt: (_key: string, fallback?: string) => fallback ?? _key,
  useLegacyT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

const mockGoBack = vi.fn();
vi.mock('@/core/back-guard', () => ({ useGoBack: () => mockGoBack }));

const mockUseViewer = vi.fn<() => ViewerView>();
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: () => mockUseViewer() }));

const mockLoad = vi.fn<() => Promise<BannerSlot[]>>();
const mockApplyDue = vi.fn();
const mockSave = vi.fn();
const mockDelist = vi.fn();
const mockRelist = vi.fn();
const mockClear = vi.fn();
vi.mock('../data/banner-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/banner-admin')>();
  return {
    ...actual,
    loadBannerSlots: () => mockLoad(),
    applyDueBannerTransitions: (...args: unknown[]) => mockApplyDue(...args),
    saveBanner: (...args: unknown[]) => mockSave(...args),
    delistBanner: (...args: unknown[]) => mockDelist(...args),
    relistBanner: (...args: unknown[]) => mockRelist(...args),
    clearBannerSlot: (...args: unknown[]) => mockClear(...args),
  };
});

const mockUpload = vi.fn();
vi.mock('../data/banner-upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/banner-upload')>();
  return { ...actual, uploadBannerImage: (...args: unknown[]) => mockUpload(...args) };
});

const mockConfirm = vi.fn<(message: string) => Promise<boolean>>();
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: (message: string) => mockConfirm(message) }));

const mockToast = vi.fn();
vi.mock('@/ui/Toast', () => ({ toast: { show: (options: unknown) => mockToast(options) } }));

// vi.mock 會被提升到 import 之前，工廠內改用動態 import 取 h，避免 JSX runtime 尚未初始化。
vi.mock('@/ui/EmptyState', async () => {
  const { h } = await import('preact');
  return {
    EmptyState: ({ title, body }: { title: string; body?: string }) =>
      h('div', { 'data-testid': 'empty-state' }, title, body),
  };
});

vi.mock('@/features/events/components/event-form/ImageCropper', async () => {
  const { h } = await import('preact');
  return {
    ImageCropper: ({ onConfirm, onCancel }: { onConfirm(dataUrl: string): void; onCancel(): void }) =>
      h(
        'div',
        { 'data-testid': 'cropper' },
        h('button', { type: 'button', onClick: () => onConfirm('data:image/webp;base64,CROPPED') }, 'cropper-ok'),
        h('button', { type: 'button', onClick: () => onCancel() }, 'cropper-cancel'),
      ),
  };
});

// ── 測試資料 ────────────────────────────────────────────
function slot(overrides: Partial<BannerSlot>): BannerSlot {
  return {
    id: 'ban1',
    docId: 'ban1',
    slot: '1',
    slotName: '春季聯賽',
    title: '報名開跑',
    subtitle: '',
    titleColor: '#ffffff',
    subtitleColor: '#e5edf8',
    image: 'https://example.com/a.webp',
    linkUrl: '',
    status: 'active',
    publishAt: '2026/10/20 09:00',
    unpublishAt: '',
    clicks: 5,
    ...overrides,
  };
}
const ACTIVE = slot({});
const SCHEDULED = slot({
  id: 'ban2',
  docId: 'ban2',
  slot: '2',
  slotName: '週末活動',
  title: '',
  status: 'scheduled',
  publishAt: '2026/11/01 09:00',
  unpublishAt: '2026/11/30 00:00',
  clicks: 0,
});
const EMPTY = slot({
  id: 'ban3',
  docId: 'ban3',
  slot: '3',
  slotName: '',
  title: '',
  image: '',
  status: 'empty',
  publishAt: '',
  clicks: 0,
});
const EXPIRED = slot({
  id: 'ban4',
  docId: 'ban4',
  slot: '4',
  slotName: '舊廣告',
  status: 'expired',
  unpublishAt: '2099/01/01 00:00',
});

function viewer(overrides: Partial<ViewerView> = {}): ViewerView {
  return {
    uid: 'u_admin',
    role: 'admin',
    roleLevel: 3,
    teamIds: new Set(),
    capabilities: [],
    displayName: '管理員',
    pictureUrl: null,
    hasPermission: (code: string) => code === 'admin.banners.entry',
    ...overrides,
  };
}

function card(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-banner-id="${id}"]`);
  if (!el) throw new Error(`card ${id} not found`);
  return el;
}
function actionsOf(id: string): string[] {
  return Array.from(card(id).querySelectorAll('[data-banner-action]')).map(
    (el) => el.getAttribute('data-banner-action') ?? '',
  );
}
function button(id: string, action: string): HTMLButtonElement {
  const el = card(id).querySelector<HTMLButtonElement>(`[data-banner-action="${action}"]`);
  if (!el) throw new Error(`button ${id}/${action} not found`);
  return el;
}
function input(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`input #${id} not found`);
  return el;
}
function toasts(): string[] {
  return mockToast.mock.calls.map((call) => String((call[0] as { message: string }).message));
}

async function renderLoaded(slots: BannerSlot[] = [ACTIVE, SCHEDULED, EMPTY]) {
  mockLoad.mockResolvedValue(slots);
  const utils = render(<AdminBannersPage />);
  await waitFor(() => expect(document.querySelector('.banner-manage-card')).not.toBeNull());
  return utils;
}

async function openEditor(id: string) {
  await act(async () => {
    fireEvent.click(button(id, 'edit'));
  });
  await screen.findByRole('dialog');
}

/**
 * 等裁切元件出現後再按「確認」。注意 `findBy*` 必須在 `act` 外面等：Preact 的 act 會把渲染延到離開 act 才做，
 * 把 findBy 包在 `act(async …)` 裡會等不到元件出現（CI 的 3 個失敗案例就是這個原因）。
 */
async function confirmCrop() {
  const ok = await screen.findByText('cropper-ok');
  await act(async () => {
    fireEvent.click(ok);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseViewer.mockReturnValue(viewer());
  mockLoad.mockResolvedValue([ACTIVE, SCHEDULED, EMPTY]);
  mockApplyDue.mockResolvedValue({ applied: [], failed: 0 });
  mockSave.mockResolvedValue(undefined);
  mockDelist.mockResolvedValue(undefined);
  mockRelist.mockResolvedValue(undefined);
  mockClear.mockResolvedValue(undefined);
  mockConfirm.mockResolvedValue(true);
  mockUpload.mockResolvedValue('https://storage.example/new.webp');
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  for (const key of Object.keys(dictOverrides)) delete dictOverrides[key];
  vi.useRealTimers();
});

describe('權限', () => {
  it('沒有 admin.banners.entry：顯示權限不足，不讀資料也不做轉換', () => {
    mockUseViewer.mockReturnValue(viewer({ role: 'coach', hasPermission: () => false }));
    render(<AdminBannersPage />);
    expect(screen.getByTestId('empty-state').textContent).toContain('權限不足');
    expect(mockLoad).not.toHaveBeenCalled();
    expect(mockApplyDue).not.toHaveBeenCalled();
  });

  it('uid 還沒到位（null）即使權限碼為真也不放行', () => {
    mockUseViewer.mockReturnValue(viewer({ uid: null, hasPermission: () => true }));
    render(<AdminBannersPage />);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('L-43：uid／權限延後出現才載入，且只載入一次', async () => {
    mockUseViewer.mockReturnValue(viewer({ uid: null, hasPermission: () => false }));
    const { rerender } = render(<AdminBannersPage />);
    expect(mockLoad).not.toHaveBeenCalled();
    mockUseViewer.mockReturnValue(viewer());
    rerender(<AdminBannersPage />);
    await waitFor(() => expect(document.querySelector('.banner-manage-card')).not.toBeNull());
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockApplyDue).toHaveBeenCalledTimes(1);
  });
});

describe('載入與顯示（照 A renderBannerManage）', () => {
  it('頁首、折疊區塊預設收合，點擊展開', async () => {
    await renderLoaded();
    expect(screen.getByText('首頁管理')).toBeTruthy();
    const toggle = screen.getByText('Banner 廣告（3 個廣告位）').closest('.ad-collapse-toggle') as HTMLElement;
    const content = document.querySelector<HTMLElement>('.ad-collapse-content')!;
    expect(content.style.display).toBe('none');
    expect(toggle.classList.contains('open')).toBe(false);
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(content.style.display).not.toBe('none');
    expect(toggle.classList.contains('open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('三張廣告位卡：名稱、標題、狀態徽章、時間、剩餘、點擊數', async () => {
    await renderLoaded();
    const active = card('ban1');
    expect(active.querySelector('.banner-manage-title')?.textContent).toBe('春季聯賽 — 報名開跑');
    expect(active.querySelector('.banner-manage-status')?.textContent).toBe('啟用中');
    expect(active.querySelector('.banner-manage-status')?.classList.contains('status-active')).toBe(true);
    expect(active.textContent).toContain('2026/10/20 09:00 ~ 永久 ・ 永久 ・ 點擊 5 次');
    expect(active.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.webp');

    const scheduled = card('ban2');
    expect(scheduled.querySelector('.banner-manage-status')?.textContent).toBe('已排程');
    expect(scheduled.textContent).toContain('2026/11/01 09:00 ~ 2026/11/30 00:00');

    const empty = card('ban3');
    expect(empty.querySelector('.banner-manage-title')?.textContent).toBe('廣告位 3');
    expect(empty.querySelector('.banner-manage-status')?.textContent).toBe('空白');
    expect(empty.textContent).toContain('尚未設定廣告');
    expect(empty.querySelector('.banner-thumb-empty')?.textContent).toContain('1200');
  });

  it('管理員開頁時做一次惰性轉換，傳入讀到的位與目前使用者', async () => {
    await renderLoaded();
    expect(mockApplyDue).toHaveBeenCalledTimes(1);
    const [slots, actor] = mockApplyDue.mock.calls[0] as [BannerSlot[], ViewerView];
    expect(slots.map((s) => s.docId)).toEqual(['ban1', 'ban2', 'ban3']);
    expect(actor.uid).toBe('u_admin');
  });

  it('有轉換時以伺服器為準重讀一次', async () => {
    mockApplyDue.mockResolvedValue({ applied: [{ docId: 'ban2' }], failed: 0 });
    await renderLoaded();
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
  });

  it('讀取失敗顯示重試，重試成功後顯示卡片（L-30）', async () => {
    mockLoad.mockRejectedValueOnce(new Error('offline'));
    render(<AdminBannersPage />);
    const retry = await screen.findByText('重試');
    expect(screen.getByText('橫幅載入失敗，請稍後重試')).toBeTruthy();
    mockLoad.mockResolvedValue([ACTIVE]);
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => expect(document.querySelector('.banner-manage-card')).not.toBeNull());
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });
});

describe('按鈕規則（A _adActionBtns）', () => {
  it('各狀態的按鈕與文案', async () => {
    await renderLoaded([ACTIVE, SCHEDULED, EMPTY, EXPIRED]);
    expect(actionsOf('ban1')).toEqual(['edit', 'delist', 'clear']);
    expect(actionsOf('ban2')).toEqual(['edit', 'clear']);
    expect(actionsOf('ban3')).toEqual(['edit']);
    expect(actionsOf('ban4')).toEqual(['edit', 'relist', 'clear']);
    expect(button('ban1', 'edit').textContent).toBe('編輯');
    expect(button('ban1', 'delist').textContent).toBe('下架');
    expect(button('ban1', 'clear').textContent).toBe('刪除');
    expect(button('ban3', 'edit').textContent).toBe('設定');
    expect(button('ban4', 'relist').textContent).toBe('重新上架');
  });

  it('已下架且結束時間已過：沒有重新上架', async () => {
    await renderLoaded([slot({ id: 'ban5', docId: 'ban5', status: 'expired', unpublishAt: '2020/01/01 00:00' })]);
    expect(actionsOf('ban5')).toEqual(['edit', 'clear']);
  });
});

describe('下架／重新上架／刪除（清空欄位）', () => {
  it('下架：寫入 → 提示 → 重讀', async () => {
    await renderLoaded();
    await act(async () => {
      fireEvent.click(button('ban1', 'delist'));
    });
    await waitFor(() => expect(mockDelist).toHaveBeenCalledTimes(1));
    // 寫入函式收到整個廣告位（寫入用 docId，日誌用名稱與公開 id）。
    expect(mockDelist.mock.calls[0]![0]).toMatchObject({ docId: 'ban1', id: 'ban1', slotName: '春季聯賽' });
    expect(mockDelist.mock.calls[0]![1]).toMatchObject({ uid: 'u_admin' });
    await waitFor(() => expect(toasts()).toContain('廣告已下架'));
    expect(mockLoad).toHaveBeenCalledTimes(2);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('重新上架', async () => {
    await renderLoaded([EXPIRED]);
    await act(async () => {
      fireEvent.click(button('ban4', 'relist'));
    });
    await waitFor(() =>
      expect(mockRelist).toHaveBeenCalledWith(
        expect.objectContaining({ docId: 'ban4' }),
        expect.objectContaining({ uid: 'u_admin' }),
      ),
    );
    await waitFor(() => expect(toasts()).toContain('廣告已重新上架'));
  });

  it('刪除：先確認（逐字照 A），取消就不寫', async () => {
    await renderLoaded();
    mockConfirm.mockResolvedValue(false);
    await act(async () => {
      fireEvent.click(button('ban1', 'clear'));
    });
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('確定要刪除此廣告？將清空所有設定。'));
    expect(mockClear).not.toHaveBeenCalled();
    expect(toasts()).not.toContain('廣告已刪除');
  });

  it('刪除：確認後呼叫清空，提示「廣告已刪除」', async () => {
    await renderLoaded();
    await act(async () => {
      fireEvent.click(button('ban2', 'clear'));
    });
    await waitFor(() =>
      expect(mockClear).toHaveBeenCalledWith(
        expect.objectContaining({ docId: 'ban2' }),
        expect.objectContaining({ uid: 'u_admin' }),
      ),
    );
    await waitFor(() => expect(toasts()).toContain('廣告已刪除'));
  });

  it('寫入失敗：顯示錯誤提示，按鈕恢復可用，不重讀', async () => {
    await renderLoaded();
    mockDelist.mockRejectedValueOnce(new Error('permission-denied'));
    await act(async () => {
      fireEvent.click(button('ban1', 'delist'));
    });
    await waitFor(() => expect(toasts()).toContain('操作失敗，請稍後重試'));
    expect(mockLoad).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button('ban1', 'delist').disabled).toBe(false));
  });
});

describe('編輯表單', () => {
  it('帶入原值；標題依狀態顯示「編輯」或「設定」', async () => {
    await renderLoaded();
    await openEditor('ban1');
    expect(document.getElementById('banner-form-title')?.textContent).toBe('編輯 春季聯賽');
    expect(input('banner-slot-display').value).toBe('春季聯賽');
    expect(input('banner-input-title').value).toBe('報名開跑');
    expect(input('banner-input-title').maxLength).toBe(18);
    expect(input('banner-input-subtitle').maxLength).toBe(32);
    expect(input('banner-slot-display').maxLength).toBe(12);
    expect((document.getElementById('banner-input-mode') as HTMLSelectElement).value).toBe('now');
    expect(document.getElementById('banner-publish-row')).toBeNull();
    expect(document.querySelector('#banner-preview img')?.getAttribute('src')).toBe('https://example.com/a.webp');
    cleanup();

    await renderLoaded();
    await openEditor('ban3');
    expect(document.getElementById('banner-form-title')?.textContent).toBe('設定 廣告位 3');
    expect(document.querySelector('#banner-preview .ce-upload-hint')?.textContent).toBe(
      '建議尺寸 1200 x 545 px，JPG / PNG，5MB 內',
    );
  });

  it('取消與 Esc 都能關閉，並還原 body 捲動', async () => {
    await renderLoaded();
    await openEditor('ban1');
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => {
      fireEvent.click(screen.getByText('取消'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');

    await openEditor('ban1');
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    ['titleTooLong', 'banner-input-title', 'a'.repeat(19), 'Banner 大標題不可超過 18 字'],
    ['subtitleTooLong', 'banner-input-subtitle', 'b'.repeat(33), 'Banner 小標題不可超過 32 字'],
    ['slotNameRequired', 'banner-slot-display', '   ', '請輸入廣告位名稱'],
    ['slotNameTooLong', 'banner-slot-display', 'c'.repeat(13), '廣告位名稱不可超過 12 字'],
    ['linkInvalid', 'banner-input-link', 'javascript:alert(1)', '跳轉連結需以 http:// 或 https:// 開頭'],
  ])('驗證 %s：提示且不寫入', async (_name, id, value, message) => {
    await renderLoaded();
    await openEditor('ban1');
    await act(async () => {
      fireEvent.input(input(id), { target: { value } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('儲存'));
    });
    expect(toasts()).toContain(message);
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('立即啟用（沿用原圖）：不上傳，寫入固定欄位，關閉並重讀', async () => {
    await renderLoaded();
    await openEditor('ban1');
    await act(async () => {
      fireEvent.click(screen.getByText('儲存'));
    });
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    const [target, write, actor] = mockSave.mock.calls[0] as [BannerSlot, Record<string, unknown>, ViewerView];
    expect(target).toMatchObject({ docId: 'ban1', id: 'ban1' });
    expect(actor.uid).toBe('u_admin');
    expect(write).toMatchObject({
      title: '報名開跑',
      slotName: '春季聯賽',
      image: 'https://example.com/a.webp',
      status: 'active',
      unpublishAt: null,
    });
    expect(String(write.publishAt)).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(Object.keys(write).sort()).toEqual(
      ['title', 'subtitle', 'titleColor', 'subtitleColor', 'slotName', 'linkUrl', 'image', 'publishAt', 'unpublishAt', 'status'].sort(),
    );
    expect(mockUpload).not.toHaveBeenCalled();
    await waitFor(() => expect(toasts()).toContain('Banner 已更新並立即啟用'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });

  it('預約啟用：切換後出現啟用時間；沒填被擋；填了以 scheduled 寫入', async () => {
    await renderLoaded();
    await openEditor('ban1');
    const mode = document.getElementById('banner-input-mode') as HTMLSelectElement;
    await act(async () => {
      mode.value = 'scheduled';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.getElementById('banner-publish-row')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText('儲存'));
    });
    expect(toasts()).toContain('請選擇啟用時間');
    expect(mockSave).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.input(input('banner-input-publish'), { target: { value: '2026-11-05T10:00' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('儲存'));
    });
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0]![1]).toMatchObject({ status: 'scheduled', publishAt: '2026/11/05 10:00' });
    await waitFor(() => expect(toasts()).toContain('Banner 已排程，將於 2026/11/05 10:00 啟用'));
  });

  it('已排程的位開啟時帶入預約模式與時間（台北牆鐘往返）', async () => {
    await renderLoaded();
    await openEditor('ban2');
    expect((document.getElementById('banner-input-mode') as HTMLSelectElement).value).toBe('scheduled');
    expect(input('banner-input-publish').value).toBe('2026-11-01T09:00');
    expect(input('banner-input-unpublish').value).toBe('2026-11-30T00:00');
  });
});

describe('圖片上傳流程', () => {
  async function pickFile(file: File) {
    const fileInput = input('banner-image');
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  const PNG = () => new File([new Uint8Array([1, 2, 3])], 'banner.png', { type: 'image/png' });

  it('選檔 → 裁切 → 儲存：先上傳（帶 banner id 與目前使用者），再把網址寫進文件', async () => {
    await renderLoaded();
    await openEditor('ban1');
    await pickFile(PNG());
    const ok = await screen.findByText('cropper-ok');
    await act(async () => {
      fireEvent.click(ok);
    });
    expect(document.querySelector('#banner-preview img')?.getAttribute('src')).toBe('data:image/webp;base64,CROPPED');

    await act(async () => {
      fireEvent.click(screen.getByText('儲存'));
    });
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    expect(mockUpload.mock.calls[0]![0]).toBe('data:image/webp;base64,CROPPED');
    expect(mockUpload.mock.calls[0]![1]).toBe('ban1');
    expect(mockUpload.mock.calls[0]![2]).toMatchObject({ uid: 'u_admin' });
    expect(toasts()).toContain('圖片上傳中...');
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0]![1]).toMatchObject({ image: 'https://storage.example/new.webp' });
    // base64 不得寫進 Firestore。
    expect(JSON.stringify(mockSave.mock.calls[0]![1])).not.toContain('data:');
  });

  it('上傳失敗（回 null）：不寫文件，表單留著；不另外重複提示', async () => {
    await renderLoaded();
    mockUpload.mockResolvedValue(null);
    await openEditor('ban1');
    await pickFile(PNG());
    await confirmCrop();
    await act(async () => {
      fireEvent.click(screen.getByText('儲存'));
    });
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByText('儲存') as HTMLButtonElement).disabled).toBe(false));
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    // 失敗提示由 uploadImageDataUrl 負責（這裡被 mock 掉），頁面不另外重複提示。
    expect(toasts()).toEqual(['圖片上傳中...']);
  });

  it('壓縮後仍太大／處理失敗：顯示對應提示', async () => {
    const { BannerImageError } = await import('../data/banner-upload');
    await renderLoaded();
    await openEditor('ban1');
    await pickFile(PNG());
    await confirmCrop();
    mockUpload.mockRejectedValueOnce(new BannerImageError('too-large', 'x'));
    await act(async () => {
      fireEvent.click(screen.getByText('儲存'));
    });
    await waitFor(() => expect(toasts()).toContain('圖片太大，請換一張較小的圖片'));
    mockUpload.mockRejectedValueOnce(new BannerImageError('process-failed', 'x'));
    const retrySave = await screen.findByText('儲存');
    await act(async () => {
      fireEvent.click(retrySave);
    });
    await waitFor(() => expect(toasts()).toContain('圖片處理失敗，請重試'));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('檔案檢查：非圖片類型、超過 5MB 被擋，不開裁切', async () => {
    await renderLoaded();
    await openEditor('ban1');
    await pickFile(new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(toasts()).toContain('請上傳 JPG / PNG / WebP 圖片');
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await pickFile(big);
    expect(toasts()).toContain('圖片太大，不能超過 5MB');
    expect(screen.queryByTestId('cropper')).toBeNull();
  });

  it('裁切取消：維持原圖', async () => {
    await renderLoaded();
    await openEditor('ban1');
    await pickFile(PNG());
    const cancel = await screen.findByText('cropper-cancel');
    await act(async () => {
      fireEvent.click(cancel);
    });
    expect(screen.queryByTestId('cropper')).toBeNull();
    expect(document.querySelector('#banner-preview img')?.getAttribute('src')).toBe('https://example.com/a.webp');
  });
});

describe('儲存失敗與重複送出', () => {
  it('寫入失敗：顯示儲存失敗，表單保留可再試', async () => {
    await renderLoaded();
    mockSave.mockRejectedValueOnce(new Error('permission-denied'));
    await openEditor('ban1');
    await act(async () => {
      fireEvent.click(screen.getByText('儲存'));
    });
    await waitFor(() => expect(toasts()).toContain('儲存失敗，請稍後重試'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it('送出中連點只送一次', async () => {
    await renderLoaded();
    let release: () => void = () => undefined;
    mockSave.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await openEditor('ban1');
    const save = screen.getByText('儲存') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

// ── 退修 1（Opus 一審 findings）────────────────────────────
async function pickPng() {
  const fileInput = input('banner-image');
  const file = new File([new Uint8Array([1, 2, 3])], 'banner.png', { type: 'image/png' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  await act(async () => {
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function clickSave() {
  await act(async () => {
    fireEvent.click(screen.getByText('儲存'));
  });
}

describe('F5：儲存／上架後的重讀要套用轉換；重新上架用按下當下的時間', () => {
  it('儲存後再做一次轉換（初次載入 1 次＋儲存後 1 次）', async () => {
    await renderLoaded();
    expect(mockApplyDue).toHaveBeenCalledTimes(1);
    await openEditor('ban1');
    await clickSave();
    await waitFor(() => expect(mockApplyDue).toHaveBeenCalledTimes(2));
  });

  it('重新上架後也套用轉換；下架、刪除後的重讀不套用', async () => {
    await renderLoaded([ACTIVE, EXPIRED]);
    await act(async () => {
      fireEvent.click(button('ban1', 'delist'));
    });
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
    expect(mockApplyDue).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(button('ban4', 'relist'));
    });
    await waitFor(() => expect(mockApplyDue).toHaveBeenCalledTimes(2));
  });

  it('重新上架被擋（結束時間已過，relist-expired）：提示該先改結束時間，並重讀讓按鈕跟上現況', async () => {
    await renderLoaded([EXPIRED]);
    mockRelist.mockRejectedValueOnce(new BannerWriteError('relist-expired', 'x'));
    await act(async () => {
      fireEvent.click(button('ban4', 'relist'));
    });
    await waitFor(() => expect(toasts()).toContain('結束時間已過，請先編輯結束時間再上架'));
    expect(toasts()).not.toContain('操作失敗，請稍後重試');
    expect(toasts()).not.toContain('廣告已重新上架');
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
  });

  it('「重新上架」按鈕依 render 當下的時間顯示（頁面開很久之後不會還留著）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T04:00:00Z')); // 台北 12:00
    const expiring = slot({ id: 'ban4', docId: 'ban4', slotName: '舊廣告', status: 'expired', unpublishAt: '2026/10/27 12:30' });
    await renderLoaded([expiring]);
    expect(actionsOf('ban4')).toContain('relist');

    vi.setSystemTime(new Date('2026-10-27T05:00:00Z')); // 台北 13:00，結束時間已過
    const toggle = screen.getByText('Banner 廣告（3 個廣告位）').closest('.ad-collapse-toggle') as HTMLElement;
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(actionsOf('ban4')).toEqual(['edit', 'clear']);
  });
});

describe('F5：表單的結束時間驗證（B 進化項）', () => {
  it('結束時間不得早於或等於現在', async () => {
    await renderLoaded();
    await openEditor('ban1');
    await act(async () => {
      fireEvent.input(input('banner-input-unpublish'), { target: { value: '2020-01-01T00:00' } });
    });
    await clickSave();
    expect(toasts()).toContain('結束時間必須晚於現在');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('預約啟用時，結束時間不得早於或等於啟用時間；之後的時間可以存', async () => {
    await renderLoaded();
    await openEditor('ban1');
    const mode = document.getElementById('banner-input-mode') as HTMLSelectElement;
    await act(async () => {
      mode.value = 'scheduled';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      fireEvent.input(input('banner-input-publish'), { target: { value: '2099-01-02T00:00' } });
      fireEvent.input(input('banner-input-unpublish'), { target: { value: '2099-01-01T00:00' } });
    });
    await clickSave();
    expect(toasts()).toContain('結束時間必須晚於啟用時間');
    expect(mockSave).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.input(input('banner-input-unpublish'), { target: { value: '2099-01-03T00:00' } });
    });
    await clickSave();
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0]![1]).toMatchObject({
      status: 'scheduled',
      publishAt: '2099/01/02 00:00',
      unpublishAt: '2099/01/03 00:00',
    });
  });
});

describe('F2：跳轉連結不可含引號等字元', () => {
  it.each([
    ["https://example.com/a'b"],
    ['https://example.com/a"b'],
    ['https://example.com/a b'],
    ['https://example.com/<x>'],
    ['https://example.com/a`b'],
    ['https://example.com/a\\b'],
  ])('「%s」被擋，不上傳、不寫入', async (linkUrl) => {
    await renderLoaded();
    await openEditor('ban1');
    await act(async () => {
      fireEvent.input(input('banner-input-link'), { target: { value: linkUrl } });
    });
    await clickSave();
    expect(toasts()).toContain('跳轉連結不可包含空白、引號、< >、反引號或反斜線');
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('F9：寫入成功但重讀失敗，不要再說「失敗」', () => {
  it('儲存成功＋重讀失敗：顯示已儲存，彈窗關閉，列表區顯示載入失敗與重試', async () => {
    await renderLoaded();
    await openEditor('ban1');
    mockLoad.mockRejectedValueOnce(new Error('offline'));
    await clickSave();
    await waitFor(() => expect(toasts()).toContain('Banner 已更新並立即啟用'));
    await screen.findByText('橫幅載入失敗，請稍後重試');
    expect(toasts()).not.toContain('儲存失敗，請稍後重試');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // 原本的卡片還在（不因重讀失敗而清空）。
    expect(document.querySelector('[data-banner-id="ban1"]')).not.toBeNull();
  });

  it('下架成功＋重讀失敗：不顯示「操作失敗」', async () => {
    await renderLoaded();
    mockLoad.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      fireEvent.click(button('ban1', 'delist'));
    });
    await waitFor(() => expect(toasts()).toContain('廣告已下架'));
    await screen.findByText('橫幅載入失敗，請稍後重試');
    expect(toasts()).not.toContain('操作失敗，請稍後重試');
  });
});

describe('F10：圖片上傳成功後，後面寫文件失敗再重試，不重傳', () => {
  it('第二次儲存直接用第一次上傳得到的網址', async () => {
    await renderLoaded();
    await openEditor('ban1');
    await pickPng();
    await confirmCrop();
    mockSave.mockRejectedValueOnce(new Error('denied'));
    await clickSave();
    await waitFor(() => expect(toasts()).toContain('儲存失敗，請稍後重試'));
    expect(mockUpload).toHaveBeenCalledTimes(1);

    const again = await screen.findByText('儲存');
    await act(async () => {
      fireEvent.click(again);
    });
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[1]![1]).toMatchObject({ image: 'https://storage.example/new.webp' });
  });

  it('關掉彈窗再重開，快取清掉，要重新上傳（不會把舊圖網址帶到別次編輯）', async () => {
    await renderLoaded();
    await openEditor('ban1');
    await pickPng();
    await confirmCrop();
    mockSave.mockRejectedValueOnce(new Error('denied'));
    await clickSave();
    await waitFor(() => expect(toasts()).toContain('儲存失敗，請稍後重試'));

    // mock 的裁切元件永遠回同一個 data URL，所以這裡驗的是「關掉彈窗就清掉快取」。
    await screen.findByText('儲存');
    await act(async () => {
      fireEvent.click(screen.getByText('取消'));
    });
    await openEditor('ban1');
    await pickPng();
    await confirmCrop();
    await clickSave();
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
  });
});

describe('F11／F12／F13：預設名稱、既有圖片值、開啟聚焦', () => {
  it('F11：空位的預設名稱，顯示隨語系翻譯，寫進資料的固定是中文「廣告位 {slot}」', async () => {
    dictOverrides['admin-banners.card.defaultSlotName'] = 'Slot {slot}';
    await renderLoaded();
    expect(card('ban3').querySelector('.banner-manage-title')?.textContent).toBe('Slot 3');
    await openEditor('ban3');
    expect(document.getElementById('banner-form-title')?.textContent).toBe('設定 Slot 3');
    expect(input('banner-slot-display').value).toBe('廣告位 3');
    await clickSave();
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0]![1]).toMatchObject({ slotName: '廣告位 3' });
  });

  it('F12：既有圖片值不是 http(s) 時不顯示，但沒換圖就原樣寫回（不變成 null）', async () => {
    const legacy = slot({ id: 'ban5', docId: 'ban5', image: 'images/banners/old.png' });
    await renderLoaded([legacy]);
    expect(card('ban5').querySelector('img')).toBeNull();
    expect(card('ban5').querySelector('.banner-thumb-empty')).not.toBeNull();
    await openEditor('ban5');
    expect(document.querySelector('#banner-preview img')).toBeNull();
    await clickSave();
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0]![1]).toMatchObject({ image: 'images/banners/old.png' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('F13：彈窗開啟後聚焦第一個輸入框（廣告位名稱）', async () => {
    await renderLoaded();
    await openEditor('ban1');
    await waitFor(() => expect(document.activeElement).toBe(input('banner-slot-display')));
  });

  it('F13：圖片處理失敗的文案對 A（圖片處理失敗，請重試）', async () => {
    const { BannerImageError } = await import('../data/banner-upload');
    await renderLoaded();
    await openEditor('ban1');
    await pickPng();
    await confirmCrop();
    mockUpload.mockRejectedValueOnce(new BannerImageError('process-failed', 'x'));
    await clickSave();
    await waitFor(() => expect(toasts()).toContain('圖片處理失敗，請重試'));
  });
});

// ── 顧問 2026-10-27 裁定（D1 觸發面）：頁面開著每 60 秒重跑一次惰性轉換 ─────────────
// 不用 vi.useFakeTimers：Testing Library 的 waitFor 會用 setInterval(50ms) 輪詢，整個假掉會讓所有 waitFor 卡住。
// 改成攔截「60 秒」那一個 setInterval（其他呼叫照舊交給真的），測試手動呼叫它的回呼，等同時間走了 60 秒。
interface CapturedInterval {
  id: number;
  fn: () => void;
  ms: number;
  cleared: boolean;
}
let captured: CapturedInterval[] = [];
let intervalSpies: Array<{ mockRestore(): void }> = [];

function captureIntervals() {
  captured = [];
  // 假的計時器代號取很大的數，萬一被交給真的 clearInterval 也不會誤清別的計時器。
  let nextId = 2_000_000_000;
  const realSet = globalThis.setInterval.bind(globalThis);
  const realClear = globalThis.clearInterval.bind(globalThis);
  const setSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((
    fn: TimerHandler,
    ms?: number,
    ...rest: unknown[]
  ) => {
    if (ms === BANNER_TRANSITION_INTERVAL_MS) {
      const entry: CapturedInterval = { id: ++nextId, fn: fn as () => void, ms, cleared: false };
      captured.push(entry);
      return entry.id as unknown as ReturnType<typeof setInterval>;
    }
    return realSet(fn as never, ms, ...(rest as []));
  }) as unknown as typeof setInterval);
  const clearSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id?: number) => {
    const entry = captured.find((e) => e.id === id);
    if (entry) {
      entry.cleared = true;
      return;
    }
    realClear(id as never);
  }) as typeof clearInterval);
  intervalSpies = [setSpy, clearSpy];
}
function restoreIntervals() {
  for (const spy of intervalSpies) spy.mockRestore();
  intervalSpies = [];
}
function activeIntervals(): CapturedInterval[] {
  return captured.filter((e) => !e.cleared);
}
async function fireInterval(index = 0) {
  const entry = captured[index];
  if (!entry) throw new Error('interval not registered');
  await act(async () => {
    entry.fn();
  });
}
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

describe('定時轉換（每 60 秒，只在這個管理員頁）', () => {
  beforeEach(() => {
    captureIntervals();
  });
  afterEach(() => {
    // 先卸載（讓頁面的 clearInterval 還走被攔截的版本），再還原真的計時器函式。
    cleanup();
    restoreIntervals();
    // 還原 jsdom 預設的 document.hidden。
    delete (document as unknown as { hidden?: boolean }).hidden;
  });

  it('間隔是 60 秒（來源：A 的 _autoExpireAds 每 60 秒）', () => {
    expect(BANNER_TRANSITION_INTERVAL_MS).toBe(60_000);
  });

  it('管理員進頁就註冊一個 60 秒計時器；沒有權限的人不註冊', async () => {
    await renderLoaded();
    expect(activeIntervals()).toHaveLength(1);
    expect(captured[0]!.ms).toBe(60_000);
    cleanup();
    captured.length = 0;

    mockUseViewer.mockReturnValue(viewer({ role: 'coach', hasPermission: () => false }));
    render(<AdminBannersPage />);
    expect(captured).toHaveLength(0);
  });

  it('時間到：讀一次、套用轉換一次；有轉換就重讀並更新畫面', async () => {
    await renderLoaded();
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockApplyDue).toHaveBeenCalledTimes(1);

    const activated = slot({ ...SCHEDULED, status: 'active', unpublishAt: '' });
    mockLoad.mockResolvedValueOnce([ACTIVE, SCHEDULED, EMPTY]).mockResolvedValueOnce([ACTIVE, activated, EMPTY]);
    mockApplyDue.mockResolvedValueOnce({ applied: [{ docId: 'ban2' }], failed: 0 });
    await fireInterval();

    await waitFor(() =>
      expect(card('ban2').querySelector('.banner-manage-status')?.textContent).toBe('啟用中'),
    );
    expect(mockLoad).toHaveBeenCalledTimes(3);
    expect(mockApplyDue).toHaveBeenCalledTimes(2);
    // 定時轉換是背景動作，不彈任何提示。
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('冪等：沒有要轉換的（0 套用）就只讀一次，不重讀、不提示、不動日誌或快照', async () => {
    await renderLoaded();
    localStorage.setItem('fcb:home-banners:v1', '{"v":1}');
    await fireInterval();
    await waitFor(() => expect(mockApplyDue).toHaveBeenCalledTimes(2));
    expect(mockLoad).toHaveBeenCalledTimes(2);
    expect(mockToast).not.toHaveBeenCalled();
    expect(localStorage.getItem('fcb:home-banners:v1')).toBe('{"v":1}');
    localStorage.removeItem('fcb:home-banners:v1');
  });

  it('分頁隱藏時仍照常執行（A 的 _autoExpireAds 不管是否隱藏；背景分頁的計時器由瀏覽器自己節流）', async () => {
    await renderLoaded();
    setHidden(true);
    await fireInterval();
    await waitFor(() => expect(mockApplyDue).toHaveBeenCalledTimes(2));
    expect(mockLoad).toHaveBeenCalledTimes(2);

    setHidden(false);
    await fireInterval();
    await waitFor(() => expect(mockApplyDue).toHaveBeenCalledTimes(3));
  });

  it('R-2：下架成功到重讀完成之間，卡片按鈕維持停用、定時輪不插入；重讀完成後恢復', async () => {
    await renderLoaded();
    let release: (list: BannerSlot[]) => void = () => undefined;
    mockLoad.mockImplementationOnce(
      () =>
        new Promise<BannerSlot[]>((resolve) => {
          release = resolve;
        }),
    );
    await act(async () => {
      fireEvent.click(button('ban1', 'delist'));
    });
    await waitFor(() => expect(toasts()).toContain('廣告已下架'));
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2)); // 重讀已發出、還沒完成

    // 寫入已成功，但重讀還沒回來：按鈕仍停用。
    for (const id of ['ban1', 'ban2', 'ban3']) {
      for (const action of actionsOf(id)) expect(button(id, action).disabled).toBe(true);
    }
    // 定時輪在這段期間不插入（否則會讓這次重讀作廢）。
    const loads = mockLoad.mock.calls.length;
    const dues = mockApplyDue.mock.calls.length;
    await fireInterval();
    expect(mockLoad).toHaveBeenCalledTimes(loads);
    expect(mockApplyDue).toHaveBeenCalledTimes(dues);

    await act(async () => {
      release([ACTIVE, SCHEDULED, EMPTY]);
    });
    await waitFor(() => expect(button('ban1', 'delist').disabled).toBe(false));

    // 重讀完成後定時輪恢復。
    await fireInterval();
    await waitFor(() => expect(mockApplyDue).toHaveBeenCalledTimes(dues + 1));
  });

  it('R-2：儲存成功到重讀完成之間，卡片按鈕也維持停用、定時輪不插入', async () => {
    await renderLoaded();
    await openEditor('ban1');
    let release: (list: BannerSlot[]) => void = () => undefined;
    mockLoad.mockImplementationOnce(
      () =>
        new Promise<BannerSlot[]>((resolve) => {
          release = resolve;
        }),
    );
    await clickSave();
    await waitFor(() => expect(toasts()).toContain('Banner 已更新並立即啟用'));
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    for (const id of ['ban1', 'ban2', 'ban3']) {
      for (const action of actionsOf(id)) expect(button(id, action).disabled).toBe(true);
    }
    const loads = mockLoad.mock.calls.length;
    const dues = mockApplyDue.mock.calls.length;
    await fireInterval();
    expect(mockLoad).toHaveBeenCalledTimes(loads);
    expect(mockApplyDue).toHaveBeenCalledTimes(dues);

    await act(async () => {
      release([ACTIVE, SCHEDULED, EMPTY]);
    });
    // 儲存後的重讀會再套用轉換（F5），等它做完、按鈕恢復後，定時輪才恢復。
    await waitFor(() => expect(button('ban1', 'edit').disabled).toBe(false));
    const afterSave = mockApplyDue.mock.calls.length;
    expect(afterSave).toBe(dues + 1);
    await fireInterval();
    await waitFor(() => expect(mockApplyDue).toHaveBeenCalledTimes(afterSave + 1));
  });

  it('R-2：寫入失敗不會一直停用（沒有重讀可等）', async () => {
    await renderLoaded();
    mockDelist.mockRejectedValueOnce(new Error('permission-denied'));
    await act(async () => {
      fireEvent.click(button('ban1', 'delist'));
    });
    await waitFor(() => expect(toasts()).toContain('操作失敗，請稍後重試'));
    await waitFor(() => expect(button('ban1', 'delist').disabled).toBe(false));
    const dues = mockApplyDue.mock.calls.length;
    await fireInterval();
    await waitFor(() => expect(mockApplyDue).toHaveBeenCalledTimes(dues + 1));
  });

  it('上一輪還沒結束不重疊；結束後下一輪才跑', async () => {
    await renderLoaded();
    let release: (value: { applied: never[]; failed: number }) => void = () => undefined;
    mockApplyDue.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await fireInterval();
    await waitFor(() => expect(mockApplyDue).toHaveBeenCalledTimes(2));
    expect(mockLoad).toHaveBeenCalledTimes(2);

    // 上一輪卡在套用轉換：再觸發兩次都不該開始新的一輪。
    await fireInterval();
    await fireInterval();
    expect(mockLoad).toHaveBeenCalledTimes(2);
    expect(mockApplyDue).toHaveBeenCalledTimes(2);

    await act(async () => {
      release({ applied: [], failed: 0 });
    });
    await act(async () => {
      await Promise.resolve();
    });
    await fireInterval();
    await waitFor(() => expect(mockApplyDue).toHaveBeenCalledTimes(3));
    expect(mockLoad).toHaveBeenCalledTimes(3);
  });

  it('卸載後清除計時器；就算回呼被呼叫也不再讀寫', async () => {
    const { unmount } = await renderLoaded();
    expect(activeIntervals()).toHaveLength(1);
    const before = { load: mockLoad.mock.calls.length, due: mockApplyDue.mock.calls.length };
    unmount();
    expect(activeIntervals()).toHaveLength(0);
    expect(captured[0]!.cleared).toBe(true);

    await fireInterval();
    expect(mockLoad).toHaveBeenCalledTimes(before.load);
    expect(mockApplyDue).toHaveBeenCalledTimes(before.due);
  });

  it('權限消失（或換帳號）後清除計時器，回呼不再讀寫', async () => {
    const { rerender } = await renderLoaded();
    expect(activeIntervals()).toHaveLength(1);
    mockUseViewer.mockReturnValue(viewer({ role: 'user', hasPermission: () => false }));
    rerender(<AdminBannersPage />);
    expect(captured[0]!.cleared).toBe(true);
    expect(activeIntervals()).toHaveLength(0);

    const calls = mockApplyDue.mock.calls.length;
    await fireInterval();
    expect(mockApplyDue).toHaveBeenCalledTimes(calls);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
  });

  it('失敗只 warn，不改變頁面（不出現載入失敗），下一輪恢復', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await renderLoaded();
      mockLoad.mockRejectedValueOnce(new Error('offline'));
      await fireInterval();
      await waitFor(() =>
        expect(warn).toHaveBeenCalledWith('[banners] periodic transition failed', expect.any(Error)),
      );
      expect(screen.queryByText('橫幅載入失敗，請稍後重試')).toBeNull();
      expect(document.querySelector('[data-banner-id="ban1"]')).not.toBeNull();

      await fireInterval();
      await waitFor(() => expect(mockApplyDue).toHaveBeenCalledTimes(2));
    } finally {
      warn.mockRestore();
    }
  });

  it('轉換寫入失敗（applyDue 丟錯）也只 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await renderLoaded();
      mockApplyDue.mockRejectedValueOnce(new Error('aborted'));
      await fireInterval();
      await waitFor(() =>
        expect(warn).toHaveBeenCalledWith('[banners] periodic transition failed', expect.any(Error)),
      );
      expect(screen.queryByText('橫幅載入失敗，請稍後重試')).toBeNull();
      expect(mockToast).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('使用者正在儲存時略過這一輪', async () => {
    await renderLoaded();
    let release: () => void = () => undefined;
    mockSave.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await openEditor('ban1');
    await clickSave();
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    const loads = mockLoad.mock.calls.length;

    await fireInterval();
    expect(mockLoad).toHaveBeenCalledTimes(loads);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('先前載入失敗（顯示重試）時，定時那輪成功就恢復顯示卡片', async () => {
    mockLoad.mockRejectedValueOnce(new Error('offline'));
    render(<AdminBannersPage />);
    await screen.findByText('橫幅載入失敗，請稍後重試');
    await fireInterval();
    await waitFor(() => expect(document.querySelector('.banner-manage-card')).not.toBeNull());
    await waitFor(() => expect(screen.queryByText('橫幅載入失敗，請稍後重試')).toBeNull());
  });
});
