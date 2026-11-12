import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperateContext } from '@/features/events/data/operate-permissions';
import type { EventDoc } from '@/features/events/data/types';
import type { ScanEventEntry } from './data/scan-events';
import type { ScanMode } from './data/attendance';

const mocks = vi.hoisted(() => ({
  context: {
    uid: 'operator',
    role: 'user',
    rolePermissions: [],
    userGrants: null,
    capabilities: [],
    customRoles: [],
  } as OperateContext,
  documents: vi.fn(),
  toast: vi.fn(),
  goBack: vi.fn(),
  location: { query: {} as Record<string, string> },
  loadEventDetail: vi.fn(),
  sessionRenders: [] as Array<{
    entry: ScanEventEntry;
    context: OperateContext;
    mode: ScanMode;
  }>,
  sessionMounts: 0,
}));

vi.mock('@/features/profile/data/viewer-operate', () => ({
  useOperateContext: () => mocks.context,
}));

vi.mock('./data/scan-reads', async (original) => {
  const actual = await original<typeof import('./data/scan-reads')>();
  return {
    ...actual,
    loadScanEventDocuments: mocks.documents,
  };
});

vi.mock('@/ui/Toast', () => ({
  toast: {
    show: mocks.toast,
    dismiss: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('@/core/back-guard', () => ({
  useGoBack: () => mocks.goBack,
}));

vi.mock('preact-iso', () => ({
  useLocation: () => mocks.location,
}));

vi.mock('@/features/events/data/event-detail', () => ({
  loadEventDetail: mocks.loadEventDetail,
}));

vi.mock('./ScanSession', () => ({
  ScanSession: (props: {
    entry: ScanEventEntry;
    context: OperateContext;
    mode: ScanMode;
  }) => {
    mocks.sessionRenders.push(props);
    useEffect(() => {
      mocks.sessionMounts += 1;
    }, []);
    return <div data-testid="scan-session" />;
  },
}));

import { addTaipeiDays, formatTaipei, taipeiStartOfDay } from '@/core/taipei-time';
import { setLocale } from '@/i18n/i18n';
import CheckinPage from './CheckinPage';

function dayOffset(offset: number): string {
  return formatTaipei(addTaipeiDays(taipeiStartOfDay(Date.now()), offset), 'YYYY/MM/DD');
}

function event(over: Partial<EventDoc>): EventDoc {
  return {
    id: 'event-public',
    _docId: 'event-doc',
    title: '活動',
    date: dayOffset(0),
    status: 'open',
    type: 'play',
    delegateUids: ['operator'],
    ...over,
  } as EventDoc;
}

function renderPage(): void {
  render(<CheckinPage />);
}

function optionTexts(): string[] {
  return Array.from(document.querySelectorAll('#scan-event-select option'))
    .map((option) => option.textContent ?? '');
}

describe('CheckinPage shell（卡 4-1）', () => {
  beforeAll(async () => {
    await setLocale('zh-TW');
  });

  beforeEach(() => {
    mocks.context = {
      uid: 'operator',
      role: 'user',
      rolePermissions: [],
      userGrants: null,
      capabilities: [],
      customRoles: [],
    };
    mocks.documents.mockReset();
    mocks.toast.mockReset();
    mocks.goBack.mockReset();
    mocks.loadEventDetail.mockReset();
    mocks.location.query = {};
    mocks.sessionRenders.length = 0;
    mocks.sessionMounts = 0;
    document.documentElement.lang = 'zh-TW';
  });

  afterEach(() => {
    cleanup();
  });

  it('輸出 A 頁首、日期頁籤順序與文字、第一個選項與類型前綴', async () => {
    mocks.documents.mockResolvedValue([
      event({ id: 'today-1', _docId: 'today-1', title: '今日活動', date: dayOffset(0), type: 'play' }),
      event({ id: 'future-1', _docId: 'future-1', title: '未來一', date: dayOffset(1), type: 'friendly' }),
      event({ id: 'future-2', _docId: 'future-2', title: '未來二', date: dayOffset(2), type: 'friendly' }),
    ]);

    renderPage();
    await screen.findByTestId('scan-session');

    expect(screen.getByRole('heading', { name: '掃碼簽到 / 簽退' })).toBeTruthy();
    const tabs = Array.from(document.querySelectorAll('#scan-date-filter .scan-date-tab'))
      .map((tab) => tab.textContent);
    expect(tabs).toEqual(['今日 (1)', '過期 (0)', '未來 (2)']);
    expect(optionTexts()[0]).toBe('— 請選擇活動 —');
    expect(optionTexts().some((text) => text.startsWith('[PLAY] '))).toBe(true);
  });

  it('載入時自動跳到第一個有活動的頁籤；使用者點空頁籤後停留不跳', async () => {
    mocks.documents.mockResolvedValue([
      event({ id: 'past-1', _docId: 'past-1', title: '過期活動', date: dayOffset(-1) }),
      event({ id: 'future-1', _docId: 'future-1', title: '未來一', date: dayOffset(1) }),
    ]);

    renderPage();
    await waitFor(() => {
      expect(document.querySelector('.scan-date-tab.active')?.textContent).toBe('過期 (1)');
    });

    fireEvent.click(screen.getByRole('button', { name: /今日 \(0\)/ }));
    await waitFor(() => {
      expect(document.querySelector('.scan-date-tab.active')?.textContent).toBe('今日 (0)');
    });
  });

  it('今日與過期都沒有活動時自動跳到未來', async () => {
    mocks.documents.mockResolvedValue([
      event({ id: 'future-1', _docId: 'future-1', title: '未來一', date: dayOffset(1) }),
    ]);

    renderPage();
    await waitFor(() => {
      expect(document.querySelector('.scan-date-tab.active')?.textContent).toBe('未來 (1)');
    });
  });

  it('cancelled / upcoming / 缺少 status 的活動不出現', async () => {
    const missing = event({ id: 'missing', _docId: 'missing', title: '缺少狀態', date: dayOffset(0) });
    delete (missing as { status?: string }).status;

    mocks.documents.mockResolvedValue([
      event({ id: 'open', _docId: 'open', title: '正常', date: dayOffset(0), status: 'open' }),
      event({ id: 'cancelled', _docId: 'cancelled', title: '取消', date: dayOffset(0), status: 'cancelled' }),
      event({ id: 'upcoming', _docId: 'upcoming', title: '未開放', date: dayOffset(0), status: 'upcoming' }),
      missing,
    ]);

    renderPage();
    await waitFor(() => expect(optionTexts().length).toBeGreaterThan(1));

    const texts = optionTexts();
    expect(texts.some((text) => text.includes('正常'))).toBe(true);
    expect(texts.some((text) => text.includes('取消'))).toBe(false);
    expect(texts.some((text) => text.includes('未開放'))).toBe(false);
    expect(texts.some((text) => text.includes('缺少狀態'))).toBe(false);
  });

  it('未選活動時顯示 A 靜態相機區且按鈕 disabled，不掛 ScanSession', async () => {
    mocks.documents.mockResolvedValue([
      event({ id: 'today-1', _docId: 'today-1', date: dayOffset(0) }),
      event({ id: 'today-2', _docId: 'today-2', date: dayOffset(0) }),
    ]);

    renderPage();
    await waitFor(() => expect(optionTexts().length).toBe(3));

    const cameraButton = document.querySelector('#scan-camera-btn') as HTMLButtonElement;
    expect(cameraButton.disabled).toBe(true);
    expect(cameraButton.textContent).toBe('開啟相機掃碼');
    expect(screen.queryByTestId('scan-session')).toBeNull();
  });

  it('目前頁籤只有一個活動時自動選中並掛 ScanSession', async () => {
    mocks.documents.mockResolvedValue([
      event({ id: 'today-1', _docId: 'today-1', date: dayOffset(0) }),
    ]);

    renderPage();
    await screen.findByTestId('scan-session');
    await waitFor(() => expect(mocks.sessionMounts).toBe(1));
  });

  it('切換簽到／簽退時 ScanSession 收到新 mode，但掛載次數不變', async () => {
    mocks.documents.mockResolvedValue([
      event({ id: 'today-1', _docId: 'today-1', date: dayOffset(0) }),
    ]);

    renderPage();
    await screen.findByTestId('scan-session');
    expect(mocks.sessionRenders[mocks.sessionRenders.length - 1]?.mode).toBe('checkin');

    fireEvent.click(screen.getByRole('button', { name: '簽退' }));
    await waitFor(() => {
      expect(mocks.sessionRenders[mocks.sessionRenders.length - 1]?.mode).toBe('checkout');
    });
    expect(mocks.sessionMounts).toBe(1);
  });

  it('帶入模式：活動在清單內時下拉 disabled、只有一個活動、日期頁籤隱藏', async () => {
    mocks.location.query = { eventId: 'preset-public' };
    mocks.documents.mockResolvedValue([
      event({
        id: 'preset-public',
        _docId: 'preset-doc',
        title: '帶入活動',
        date: dayOffset(0),
        type: 'play',
      }),
    ]);

    renderPage();
    await screen.findByTestId('scan-session');

    const select = document.querySelector('#scan-event-select') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.options.length).toBe(2);
    expect(select.value).toBe('preset-public');
    expect((document.querySelector('#scan-date-filter') as HTMLElement).style.display).toBe('none');
  });

  it('帶入模式：活動不在清單時呼叫 loadEventDetail', async () => {
    mocks.location.query = { eventId: 'preset-public' };
    mocks.documents.mockResolvedValue([]);
    mocks.loadEventDetail.mockResolvedValue({
      event: event({ id: 'preset-public', _docId: 'preset-doc', date: dayOffset(0) }),
      eventDocId: 'preset-doc',
    });

    renderPage();
    await waitFor(() => expect(mocks.loadEventDetail).toHaveBeenCalledWith('preset-public'));
    await screen.findByTestId('scan-session');
  });

  it('帶入模式：找不到或無權限時提示權限不足且不掛 ScanSession', async () => {
    mocks.location.query = { eventId: 'preset-public' };
    mocks.documents.mockResolvedValue([]);
    mocks.loadEventDetail.mockResolvedValue(null);

    renderPage();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('權限不足'));
    expect(screen.queryByTestId('scan-session')).toBeNull();

    const select = document.querySelector('#scan-event-select') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.options.length).toBe(1);
  });

  it('一般模式沒有可操作活動且無管理入口時提示權限不足', async () => {
    mocks.documents.mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('權限不足'));
  });

  it('訪客不提示權限不足', async () => {
    mocks.context = {
      uid: null,
      role: null,
      rolePermissions: null,
      userGrants: null,
      capabilities: [],
      customRoles: [],
    };

    renderPage();
    await Promise.resolve();
    expect(mocks.documents).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(document.querySelector('.reg-loading')).toBeNull();
  });

  it('已登入但角色為 null（users 文件不存在或讀取失敗）時不轉圈、不讀活動', async () => {
    // role 為 null 可能永遠不會到位且沒有重試，轉圈會變成永久載入，所以維持不轉圈。
    mocks.context = { ...mocks.context, role: null };

    renderPage();
    await Promise.resolve();
    expect(mocks.documents).not.toHaveBeenCalled();
    expect(document.querySelector('.reg-loading')).toBeNull();
  });

  it('活動文件未回時下拉旁有載入圈，下拉仍在原位；讀完換成選項', async () => {
    let release!: (events: EventDoc[]) => void;
    mocks.documents.mockReturnValue(new Promise((resolve) => {
      release = resolve;
    }));
    renderPage();
    const select = document.querySelector('#scan-event-select') as HTMLSelectElement;
    const slot = select.parentElement;
    const filter = document.querySelector('#scan-date-filter');
    const status = await screen.findByRole('status');
    expect(status.classList.contains('reg-loading')).toBe(true);
    expect(status.classList.contains('scan-event-loading')).toBe(true);
    expect(status.textContent).toContain('載入中…');
    expect(status.getAttribute('aria-busy')).toBeNull();
    expect((status as HTMLElement).style.position).toBe('absolute');
    expect(slot?.classList.contains('scan-event-slot')).toBe(true);
    expect(filter?.previousElementSibling).toBe(slot);
    expect(optionTexts()).toEqual(['— 請選擇活動 —']);
    release([event({ id: 'today-1', _docId: 'today-1', title: '今日活動', date: dayOffset(0) })]);
    await screen.findByTestId('scan-session');
    expect(document.querySelector('.reg-loading')).toBeNull();
    expect(filter?.previousElementSibling).toBe(select.parentElement);
    expect(optionTexts().length).toBeGreaterThan(1);
  });

  it('帶入活動還在讀時下拉旁有載入圈，失敗後沿用權限不足且圈收掉', async () => {
    mocks.location.query = { eventId: 'preset-public' };
    mocks.documents.mockResolvedValue([]);
    let release!: (value: unknown) => void;
    mocks.loadEventDetail.mockReturnValue(new Promise((resolve) => {
      release = resolve;
    }));
    renderPage();
    await waitFor(() => expect(mocks.loadEventDetail).toHaveBeenCalledWith('preset-public'));
    const select = document.querySelector('#scan-event-select') as HTMLSelectElement;
    const status = screen.getByRole('status');
    expect(status.classList.contains('scan-event-loading')).toBe(true);
    expect((status as HTMLElement).style.position).toBe('absolute');
    expect(select.disabled).toBe(true);
    expect(select.parentElement?.nextElementSibling?.id).toBe('scan-date-filter');
    release(null);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('權限不足'));
    expect(document.querySelector('.reg-loading')).toBeNull();
    expect(screen.queryByTestId('scan-session')).toBeNull();
  });

  // 自舊 CheckinPage.test.tsx 移入（B 獨有：活動清單讀取失敗可重試）。
  it('活動清單讀取失敗時顯示重試，重試後重新讀取', async () => {
    mocks.documents.mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce([event({ id: 'today-1', _docId: 'today-1', date: dayOffset(0) })]);

    renderPage();
    expect(await screen.findByRole('button', { name: '重試' })).toBeTruthy();
    expect(document.querySelector('.reg-loading')).toBeNull();
    expect(screen.getByText('無法載入最新資料，請重試。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await screen.findByTestId('scan-session');
    expect(mocks.documents).toHaveBeenCalledTimes(2);
  });
});
