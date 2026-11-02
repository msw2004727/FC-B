import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import zhTw from '../locales/zh-TW.json';
import type { TournamentCard } from '../data/card-model';
import TournamentsPage from './TournamentsPage';

// ── i18n：直接用 zh-TW 字典 ────────────────────────────
function flatten(obj: Record<string, unknown>, prefix: string, out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}.${key}`;
    if (value && typeof value === 'object') flatten(value as Record<string, unknown>, path, out);
    else out[path] = String(value);
  }
  return out;
}
const dict = flatten(zhTw as Record<string, unknown>, 'tournaments');

vi.mock('@/i18n/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    let text = dict[key] ?? key;
    for (const [k, v] of Object.entries(params ?? {})) text = text.replace(`{${k}}`, String(v));
    return text;
  },
  lt: (_key: string, fallback?: string) => fallback ?? _key,
  useLegacyT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

const mockUseViewer = vi.fn<() => ViewerView>();
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: () => mockUseViewer() }));

// ── Firestore SDK 層：用來斷言「進頁只發 1 個查詢、切頁籤／開關不重讀」────
const sdk = {
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn((_db: unknown, name: string) => ({ collection: name })),
  orderBy: vi.fn((field: string, dir: string) => ({ orderBy: [field, dir] })),
  limit: vi.fn((n: number) => ({ limit: n })),
  query: vi.fn((c: unknown, ...rest: unknown[]) => ({ c, rest })),
};
vi.mock('@/data/firestore-sdk', () => ({ loadFirestoreSdk: async () => sdk }));
vi.mock('@/data/firebase', () => ({
  getFirebase: async () => ({ db: {} }),
  shouldUseEmulator: () => false,
}));

const mockSave = vi.fn();
const mockDelete = vi.fn();
const mockUpload = vi.fn();
vi.mock('../data/cards-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/cards-repo')>();
  return {
    ...actual,
    newTournamentCardId: () => 'tc_new',
    saveTournamentCard: (...args: unknown[]) => mockSave(...args),
    deleteTournamentCard: (...args: unknown[]) => mockDelete(...args),
    uploadTournamentCardImage: (...args: unknown[]) => mockUpload(...args),
  };
});

const mockConfirm = vi.fn<(message: string) => Promise<boolean>>();
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: (message: string) => mockConfirm(message) }));

const mockToast = vi.fn();
vi.mock('@/ui/Toast', () => ({ toast: { show: (options: unknown) => mockToast(options) } }));

vi.mock('@/features/events/components/event-form/ImageCropper', async () => {
  const { h } = await import('preact');
  return {
    ImageCropper: ({ onConfirm }: { onConfirm(dataUrl: string): void }) =>
      h('button', { type: 'button', onClick: () => onConfirm('data:image/webp;base64,CROPPED') }, 'cropper-ok'),
  };
});

// ── 測試資料（今天＝台北 2026-11-02）────────────────────
const DOCS = [
  { id: 'tc_league', data: { name: '2027 春季聯賽', type: 'league', startDate: '2027-03-06', endDate: '2027-05-29', url: 'https://league.example.com/' } },
  { id: 'tc_feda', data: { name: 'FEDA CUP 2026 飛達盃', type: 'cup', startDate: '2026-10-09', endDate: '2026-10-11', url: 'https://cup.toosterx.com/', image: 'https://storage.example/feda.webp', imagePath: 'tournamentCards/tc_feda/cover_1.webp' } },
  { id: 'tc_friendly', data: { name: '週末友誼賽', type: 'friendly', startDate: '2026-11-15', endDate: '2026-11-15', url: 'https://friendly.example.com/' } },
];

function viewer(overrides: Partial<ViewerView> = {}): ViewerView {
  return {
    uid: 'u_user',
    role: 'user',
    roleLevel: 0,
    teamIds: new Set(),
    capabilities: [],
    displayName: '用戶',
    pictureUrl: null,
    hasPermission: () => false,
    ...overrides,
  };
}
const MANAGER = viewer({
  uid: 'u_admin',
  role: 'admin',
  hasPermission: (code: string) => code === 'admin.tournaments.entry',
});

function names(): string[] {
  return Array.from(document.querySelectorAll('.tc-card-name')).map((el) => el.textContent ?? '');
}

async function renderLoaded(): Promise<void> {
  render(<TournamentsPage />);
  await waitFor(() => expect(names().length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T04:00:00Z'));
  sdk.getDocs.mockResolvedValue({ docs: DOCS.map((d) => ({ id: d.id, data: () => d.data })) });
  mockUseViewer.mockReturnValue(viewer());
  mockConfirm.mockResolvedValue(true);
  mockDelete.mockResolvedValue(undefined);
  mockUpload.mockResolvedValue({ url: 'https://storage.example/new.webp', path: 'tournamentCards/tc_new/cover_1.webp' });
  mockSave.mockImplementation(async (input: { existing: TournamentCard | null; id: string; write: Record<string, string>; image: { url: string; path: string } | null }) => ({
    id: input.existing ? input.existing.id : input.id,
    ...input.write,
    image: input.image?.url ?? input.existing?.image ?? '',
    imagePath: input.image?.path ?? input.existing?.imagePath ?? '',
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('清單與讀取預算', () => {
  it('進頁只發 1 個查詢，開始日新→舊', async () => {
    await renderLoaded();
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
    expect(sdk.getDoc).not.toHaveBeenCalled();
    expect(sdk.collection).toHaveBeenCalledWith(expect.anything(), 'tournamentCards');
    expect(sdk.orderBy).toHaveBeenCalledWith('startDate', 'desc');
    expect(sdk.limit).toHaveBeenCalledWith(100);
    expect(names()).toEqual(['2027 春季聯賽', '週末友誼賽', 'FEDA CUP 2026 飛達盃']);
  });

  it('頁籤與「顯示已結束」都在前端篩，不重讀', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('tab', { name: '盃賽' }));
    expect(names()).toEqual(['FEDA CUP 2026 飛達盃']);
    expect(screen.getByRole('tab', { name: '盃賽' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: '聯賽' }));
    expect(names()).toEqual(['2027 春季聯賽']);

    fireEvent.click(screen.getByRole('tab', { name: '全部' }));
    const toggle = document.getElementById('tc-show-ended') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(names()).toEqual(['2027 春季聯賽', '週末友誼賽']);

    fireEvent.click(screen.getByRole('tab', { name: '盃賽' }));
    expect(names()).toEqual([]);
    expect(screen.getByText('目前沒有賽事')).toBeTruthy();

    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  it('已結束卡片套 ended（灰階）；未結束不套', async () => {
    await renderLoaded();
    expect(document.querySelector('[data-card-id="tc_feda"]')?.classList.contains('ended')).toBe(true);
    expect(document.querySelector('[data-card-id="tc_friendly"]')?.classList.contains('ended')).toBe(false);
  });

  it('整張卡片是新分頁連結（noopener）；日期與類型標籤', async () => {
    await renderLoaded();
    const link = document.querySelector('[data-card-id="tc_feda"] a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://cup.toosterx.com/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain('2026/10/09～2026/10/11');
    expect(link.textContent).toContain('盃賽');
    expect((link.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe('https://storage.example/feda.webp');
  });

  it('載入失敗顯示重試，按下才重讀', async () => {
    sdk.getDocs.mockRejectedValueOnce(new Error('offline'));
    render(<TournamentsPage />);
    await waitFor(() => expect(screen.getByText('載入失敗，請稍後重試')).toBeTruthy());
    fireEvent.click(screen.getByText('重試'));
    await waitFor(() => expect(names().length).toBe(3));
    expect(sdk.getDocs).toHaveBeenCalledTimes(2);
  });
});

describe('管理按鈕（與寫入同一個判斷）', () => {
  it('一般用戶看不到「＋ 新增賽事」與鉛筆', async () => {
    await renderLoaded();
    expect(screen.queryByText('＋ 新增賽事')).toBeNull();
    expect(document.querySelectorAll('.tc-edit').length).toBe(0);
  });

  it('沒有權限碼的 coach 也看不到', async () => {
    mockUseViewer.mockReturnValue(viewer({ uid: 'u_coach', role: 'coach' }));
    await renderLoaded();
    expect(screen.queryByText('＋ 新增賽事')).toBeNull();
    expect(document.querySelectorAll('.tc-edit').length).toBe(0);
  });

  it.each([
    ['持有 admin.tournaments.entry', MANAGER],
    ['總管', viewer({ uid: 'u_super', role: 'super_admin' })],
  ])('%s 看得到新增與每張卡片的鉛筆', async (_label, v) => {
    mockUseViewer.mockReturnValue(v);
    await renderLoaded();
    expect(screen.getByText('＋ 新增賽事')).toBeTruthy();
    expect(document.querySelectorAll('.tc-edit').length).toBe(3);
  });
});

describe('新增、編輯、刪除', () => {
  beforeEach(() => {
    mockUseViewer.mockReturnValue(MANAGER);
  });

  function fill(id: string, value: string): void {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
    if (el instanceof HTMLSelectElement) {
      el.value = value;
      fireEvent.change(el);
    } else {
      fireEvent.input(el, { target: { value } });
    }
  }

  it('新增（無圖片）：驗證不過不送；合格後送出並加進清單，不重讀', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText('＋ 新增賽事'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByText('刪除')).toBeNull();

    fill('tc-name', '冬季盃');
    fill('tc-type', 'cup');
    fill('tc-start', '2026-12-20');
    fill('tc-end', '2026-12-21');
    fill('tc-url', 'http://winter.example.com/');
    fireEvent.click(screen.getByText('儲存'));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ message: '連結網址需以 https:// 開頭', tone: 'error' }));
    expect(mockSave).not.toHaveBeenCalled();

    fill('tc-url', 'https://winter.example.com/');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSave.mock.calls[0]?.[0]).toEqual({
      existing: null,
      id: 'tc_new',
      write: { name: '冬季盃', type: 'cup', startDate: '2026-12-20', endDate: '2026-12-21', url: 'https://winter.example.com/' },
      image: null,
    });
    expect(mockSave.mock.calls[0]?.[1]).toBe(MANAGER);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(names()).toEqual(['2027 春季聯賽', '冬季盃', '週末友誼賽', 'FEDA CUP 2026 飛達盃']);
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  it('新增（有圖片）：裁切後先上傳再寫文件', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText('＋ 新增賽事'));
    const input = document.getElementById('tc-image') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'cover.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    fireEvent.click(await screen.findByText('cropper-ok'));

    fill('tc-name', '冬季盃');
    fill('tc-type', 'league');
    fill('tc-start', '2026-12-20');
    fill('tc-end', '2026-12-20');
    fill('tc-url', 'https://winter.example.com/');
    fireEvent.click(screen.getByText('儲存'));

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockUpload).toHaveBeenCalledWith('tc_new', 'data:image/webp;base64,CROPPED', MANAGER);
    expect(mockSave.mock.calls[0]?.[0]).toMatchObject({
      id: 'tc_new',
      image: { url: 'https://storage.example/new.webp', path: 'tournamentCards/tc_new/cover_1.webp' },
    });
  });

  it('上傳失敗：不寫文件、彈窗不關', async () => {
    mockUpload.mockResolvedValueOnce(null);
    await renderLoaded();
    fireEvent.click(screen.getByText('＋ 新增賽事'));
    const input = document.getElementById('tc-image') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })] });
    fireEvent.change(input);
    fireEvent.click(await screen.findByText('cropper-ok'));
    fill('tc-name', '冬季盃');
    fill('tc-type', 'cup');
    fill('tc-start', '2026-12-20');
    fill('tc-end', '2026-12-20');
    fill('tc-url', 'https://winter.example.com/');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('儲存')).toBeTruthy());
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('鉛筆開同一份表單帶入原值；編輯送出', async () => {
    await renderLoaded();
    fireEvent.click(document.querySelector('[data-card-id="tc_feda"] .tc-edit') as HTMLElement);
    expect(screen.getByText('編輯賽事')).toBeTruthy();
    expect((document.getElementById('tc-name') as HTMLInputElement).value).toBe('FEDA CUP 2026 飛達盃');
    expect((document.getElementById('tc-type') as HTMLSelectElement).value).toBe('cup');
    expect((document.getElementById('tc-start') as HTMLInputElement).value).toBe('2026-10-09');
    expect((document.getElementById('tc-end') as HTMLInputElement).value).toBe('2026-10-11');
    expect((document.getElementById('tc-url') as HTMLInputElement).value).toBe('https://cup.toosterx.com/');

    fill('tc-name', '飛達盃 2026');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0]?.[0]).toMatchObject({ existing: { id: 'tc_feda' }, image: null });
    await waitFor(() => expect(names()).toContain('飛達盃 2026'));
    expect(names()).not.toContain('FEDA CUP 2026 飛達盃');
  });

  it('刪除要確認；取消不刪，確定才刪並移出清單', async () => {
    await renderLoaded();
    fireEvent.click(document.querySelector('[data-card-id="tc_feda"] .tc-edit') as HTMLElement);

    mockConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByText('刪除'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('確定要刪除「FEDA CUP 2026 飛達盃」嗎？'));
    expect(mockDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('刪除'));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
    expect(mockDelete.mock.calls[0]?.[0]).toMatchObject({ id: 'tc_feda' });
    await waitFor(() => expect(names()).not.toContain('FEDA CUP 2026 飛達盃'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });
});
