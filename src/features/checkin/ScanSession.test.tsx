import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperateContext } from '@/features/events/data/operate-permissions';
import type { EventDoc } from '@/features/events/data/types';
import type {
  AttendanceWritePayload,
  EventAttendanceEntry,
  ScanMode,
  ScanRegistration,
} from './data/attendance';
import type { ScanEventEntry } from './data/scan-events';
import type { ScanUser } from './data/scan-reads';
import type { QrScannerOptions, ScannerFailure } from './scanner';

const mocks = vi.hoisted(() => ({
  registrations: vi.fn<() => Promise<ScanRegistration[]>>(),
  user: vi.fn<(uid: string, operatorUid: string) => Promise<ScanUser | null>>(),
  attendance: vi.fn<() => Promise<EventAttendanceEntry[]>>(),
  batch: vi.fn<(docId: string, values: readonly AttendanceWritePayload[]) => Promise<string[]>>(),
  remove: vi.fn(),
  toast: vi.fn(),
  start: vi.fn<() => Promise<void>>(),
  stop: vi.fn(),
  options: null as QrScannerOptions | null,
  back: null as (() => boolean) | null,
  release: vi.fn(),
  pushOverlay: vi.fn(),
  vibrate: vi.fn(),
  callFnMock: vi.fn(),
}));

vi.mock('./data/scan-reads', async (original) => {
  const actual = await original<typeof import('./data/scan-reads')>();
  return {
    ...actual,
    loadScanRegistrations: mocks.registrations,
    findScanUser: mocks.user,
  };
});

vi.mock('./data/attendance', async (original) => {
  const actual = await original<typeof import('./data/attendance')>();
  return {
    ...actual,
    loadEventAttendance: mocks.attendance,
    commitAttendanceBatch: mocks.batch,
    removeAttendance: mocks.remove,
  };
});

vi.mock('@/ui/Toast', () => ({
  toast: { show: mocks.toast },
}));

vi.mock('@/core/overlay-back', () => ({
  pushOverlay: (onBack: () => boolean) => {
    mocks.pushOverlay(onBack);
    mocks.back = onBack;
    return () => {
      if (mocks.back === onBack) mocks.back = null;
      mocks.release();
    };
  },
}));

vi.mock('@/data/callables', () => ({
  callFn: mocks.callFnMock,
}));

vi.mock('./scanner', () => ({
  createQrScanner: (options: QrScannerOptions) => {
    mocks.options = options;
    return { start: mocks.start, stop: mocks.stop };
  },
  scannerFailure: (error: unknown): ScannerFailure => {
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'denied' || error.code === 'unsupported') return error.code;
    }
    return 'failed';
  },
}));

import { buildScanView, ScanSession } from './ScanSession';

let stored: EventAttendanceEntry[];
let regs: ScanRegistration[];
let context: OperateContext;

function eventA(): ScanEventEntry {
  const event = {
    id: 'evtA',
    _docId: 'evtA',
    title: 'evtA',
    delegateUids: ['operator'],
    current: 0,
    participants: [] as string[],
  } as unknown as EventDoc;
  return {
    value: 'evtA',
    eventId: 'evtA',
    docId: 'evtA',
    title: 'evtA',
    date: '2026/10/31',
    typeLabel: '',
    event,
  };
}

function makeEntry(current = 2, participants: string[] = ['Member']): ScanEventEntry {
  const event = {
    id: 'public-event',
    _docId: 'event-document',
    title: 'Training',
    delegateUids: ['operator'],
    current,
    participants,
  } as unknown as EventDoc;
  return {
    value: 'public-event',
    eventId: 'public-event',
    docId: 'event-document',
    title: 'Training',
    date: '2026/10/22',
    typeLabel: '',
    event,
  };
}

function record(
  overrides: Partial<EventAttendanceEntry> = {},
): EventAttendanceEntry {
  return {
    _docId: 'attendance-document',
    uid: 'member',
    userName: 'Member',
    companionId: null,
    companionName: null,
    displayName: 'Member',
    type: 'checkin',
    time: '2026/10/22 10:00',
    status: 'active',
    data: {},
    ...overrides,
  };
}

function familyRegistrations(): ScanRegistration[] {
  return [
    { userId: 'member', userName: 'Member', status: 'confirmed' },
    {
      userId: 'member',
      userName: 'Member',
      status: 'confirmed',
      companionId: 'child',
      companionName: 'Child',
    },
  ];
}

function batchPayloads(): AttendanceWritePayload[] {
  return mocks.batch.mock.calls.flatMap((call) => [...call[1]]);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`找不到 ${selector}`);
  return found;
}

function renderSession(mode: ScanMode = 'checkin', entry = makeEntry()) {
  return render(<ScanSession entry={entry} context={context} mode={mode} />);
}

async function ready(): Promise<void> {
  await waitFor(() => expect(mocks.attendance).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function startCamera(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
  await screen.findByRole('button', { name: '關閉相機' });
  await waitFor(() => expect(mocks.start).toHaveBeenCalled());
}

async function scan(uid = 'member'): Promise<void> {
  const options = mocks.options;
  if (!options) throw new Error('掃描器尚未啟動');
  await act(async () => { await options.onScan(uid); });
}

async function failCamera(code: ScannerFailure = 'denied'): Promise<void> {
  mocks.start.mockRejectedValueOnce({ code });
  fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
  await screen.findByPlaceholderText('輸入用戶識別碼');
}

async function confirmFamily(): Promise<void> {
  fireEvent.click(element('#scan-family-confirm-btn'));
  await waitFor(() => expect(document.querySelector('#scan-result-modal')).not.toBeNull());
}

describe('ScanSession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    document.documentElement.lang = 'zh-TW';
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: mocks.vibrate,
    });
    mocks.options = null;
    mocks.back = null;
    context = {
      uid: 'operator',
      role: 'user',
      rolePermissions: [],
      userGrants: null,
      capabilities: [],
      customRoles: [],
    };
    stored = [];
    regs = [{ userId: 'member', userName: 'Member', status: 'confirmed' }];
    mocks.attendance.mockImplementation(async () => [...stored]);
    mocks.registrations.mockImplementation(async () => [...regs]);
    mocks.user.mockImplementation(async (uid) => ({
      uid,
      name: uid === 'member' ? 'Member' : 'Other',
    }));
    mocks.start.mockResolvedValue(undefined);
    mocks.batch.mockImplementation(async (_docId, values) => {
      const ids: string[] = [];
      for (const value of values) {
        const docId = `written-${stored.length}`;
        stored.push(record({
          _docId: docId,
          uid: value.uid,
          userName: value.userName,
          companionId: value.companionId ?? null,
          companionName: value.companionName ?? null,
          displayName: value.companionName || value.userName,
          type: value.type,
          time: value.time,
        }));
        ids.push(docId);
      }
      return ids;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  // 測試同步更新：照 A（M-105、M-108）。
  it('keeps scanning with a result open and replaces its content', async () => {
    regs.push({ userId: 'other', userName: 'Other', status: 'confirmed' });
    renderSession();
    await ready();
    await startCamera();
    const stops = mocks.stop.mock.calls.length;

    await scan();
    expect(element('#scan-result-box').classList.contains('success')).toBe(true);
    expect(element('#scan-result-title').textContent).toBe('Member 簽到成功');
    expect(element('#scan-result-name').textContent).toBe('Training');
    expect(mocks.stop).toHaveBeenCalledTimes(stops);

    await scan('other');
    expect(element('#scan-result-title').textContent).toBe('Other 簽到成功');
    expect(mocks.batch).toHaveBeenCalledTimes(2);
    expect(mocks.stop).toHaveBeenCalledTimes(stops);
    expect(mocks.pushOverlay).toHaveBeenCalledOnce();
  });

  it('ignores camera scans while a family menu is open', async () => {
    regs = familyRegistrations();
    renderSession();
    await ready();
    await startCamera();
    const stops = mocks.stop.mock.calls.length;
    await scan();
    expect(element('#scan-family-title').textContent).toBe('👨‍👩‍👧 家庭簽到（Member）');

    await scan('other');
    expect(mocks.user).toHaveBeenCalledOnce();
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledTimes(stops);
  });

  it('ignores scans while a lookup is pending', async () => {
    const pending = deferred<ScanUser | null>();
    mocks.user.mockReturnValueOnce(pending.promise);
    renderSession();
    await ready();
    await startCamera();
    const options = mocks.options;
    if (!options) throw new Error('缺少掃描器');

    let first: Promise<void> | void;
    await act(async () => {
      first = options.onScan('member');
      await Promise.resolve();
      await options.onScan('other');
    });
    expect(mocks.user).toHaveBeenCalledOnce();

    await act(async () => {
      pending.resolve({ uid: 'member', name: 'Member' });
      await first;
    });
    expect(mocks.batch).toHaveBeenCalledOnce();
  });

  // 測試同步更新：照 A（M-105）。
  it('uses the latest mode after rerender without restarting the camera', async () => {
    const entry = makeEntry();
    const view = renderSession('checkin', entry);
    await ready();
    await startCamera();
    view.rerender(<ScanSession entry={entry} context={context} mode="checkout" />);
    await scan();

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.batch).toHaveBeenCalledOnce();
    expect(batchPayloads().map((value) => value.type))
      .toEqual(['checkin', 'checkout']);
    expect(element('#scan-result-title').textContent)
      .toBe('Member 未簽到，已自動完成簽到與簽退');
  });

  it('uses a mode changed while the user lookup is pending', async () => {
    const pending = deferred<ScanUser | null>();
    mocks.user.mockReturnValueOnce(pending.promise);
    const entry = makeEntry();
    const view = renderSession('checkin', entry);
    await ready();
    await startCamera();
    const options = mocks.options;
    if (!options) throw new Error('缺少掃描器');
    let work: Promise<void> | void;
    await act(async () => {
      work = options.onScan('member');
      await Promise.resolve();
    });
    view.rerender(<ScanSession entry={entry} context={context} mode="checkout" />);
    await act(async () => {
      pending.resolve({ uid: 'member', name: 'Member' });
      await work;
    });
    expect(mocks.batch).toHaveBeenCalledOnce();
    expect(batchPayloads().map((value) => value.type))
      .toEqual(['checkin', 'checkout']);
  });

  // 測試同步更新：照 A（M-106）。
  it.each([
    ['denied', '相機權限被拒絕，請在瀏覽器設定中允許相機存取'],
    ['unsupported', '此瀏覽器環境不支援相機存取'],
    ['failed', '無法開啟相機，請確認權限或改用手動輸入'],
  ] as const)('shows %s failures in the reader and toast', async (code, message) => {
    renderSession();
    await ready();
    expect(document.querySelector('#scan-manual-section')).toBeNull();
    await failCamera(code);
    const reader = element('#scan-qr-reader');
    expect(reader.textContent).toBe(message);
    expect(reader.querySelector('span')?.getAttribute('style')).toContain('var(--danger)');
    expect(mocks.toast).toHaveBeenCalledWith(message);

    await startCamera();
    expect(document.querySelector('#scan-manual-section')).not.toBeNull();
  });

  it('shows HTTPS preflight failure without starting a scanner', async () => {
    vi.stubGlobal('isSecureContext', false);
    renderSession();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
    await screen.findByPlaceholderText('輸入用戶識別碼');

    expect(element('#scan-qr-reader').textContent).toBe('相機需在 HTTPS 安全連線下使用');
    expect(mocks.toast).toHaveBeenCalledWith('相機需在 HTTPS 安全連線下使用');
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('classifies runtime failures in LINE on Android', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android Line/15.0');
    renderSession();
    await ready();
    await startCamera();
    act(() => { mocks.options?.onError('failed'); });
    expect(element('#scan-qr-reader').textContent)
      .toBe('LINE 內建瀏覽器相機受限，請改用手機 Chrome 開啟');
    expect(mocks.toast).toHaveBeenCalledWith(
      'LINE 內建瀏覽器相機受限，請改用手機 Chrome 開啟',
    );
    expect(document.querySelector('#scan-manual-section')).not.toBeNull();
  });

  // 測試同步更新：照 A（M-106）。
  it('validates, trims and clears manual input without deduplicating it', async () => {
    renderSession();
    await ready();
    await failCamera();
    const input = screen.getByPlaceholderText<HTMLInputElement>('輸入用戶識別碼');
    const manual = within(element('#scan-manual-section'));
    fireEvent.input(input, { target: { value: '   ' } });
    fireEvent.click(manual.getByRole('button', { name: '確認' }));
    expect(mocks.toast).toHaveBeenCalledWith('請輸入識別碼');
    expect(mocks.user).not.toHaveBeenCalled();

    fireEvent.input(input, { target: { value: ' member ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(element('#scan-result-title').textContent)
      .toBe('Member 簽到成功'));
    expect(mocks.user).toHaveBeenCalledWith('member', 'operator');
    expect(input.value).toBe('');

    fireEvent.click(within(element('#scan-result-modal')).getByRole('button', { name: '確認' }));
    fireEvent.input(input, { target: { value: 'member' } });
    fireEvent.click(manual.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(element('#scan-result-title').textContent)
      .toBe('Member 已完成簽到'));
    expect(mocks.user).toHaveBeenCalledTimes(2);
  });

  // 測試同步更新：照 A（M-108）。
  it('renders A results, statistics, tags and UID privacy without removal', async () => {
    regs = familyRegistrations();
    stored = [
      record({ time: '2026/10/22 10:01' }),
      record({
        _docId: 'child-out',
        companionId: 'child',
        companionName: 'Child',
        type: 'checkout',
        time: '2026/10/22 10:02',
      }),
      record({
        _docId: 'unreg',
        uid: 'guest',
        userName: '',
        type: 'unreg',
        time: '2026/10/22 10:03',
      }),
      record({
        _docId: 'guest-out',
        uid: 'guest',
        userName: '',
        type: 'checkout',
        time: '2026/10/22 10:04',
      }),
      record({
        _docId: 'cancelled',
        userName: 'Cancelled',
        status: 'cancelled',
        time: '2026/10/22 10:05',
      }),
    ];
    const entry = makeEntry();
    const view = renderSession('checkin', entry);
    await ready();

    expect(element('#scan-results').firstElementChild?.textContent).toBe('用戶 簽退成功');
    expect(element('#scan-results').textContent).toContain('用戶 未報名此活動');
    expect(element('#scan-results').textContent).not.toContain('Cancelled');
    expect(element('#scan-results').children).toHaveLength(4);
    expect(element('#scan-stats').textContent)
      .toBe('報名：2已簽到：1已簽退：1未報名：1出席率：50%');
    expect(element('#scan-registered-section h4').textContent).toBe('已報名（1）');
    expect(element('#scan-registered-section .scan-user-tag').textContent)
      .toContain('Member *2');
    expect(document.querySelector('#scan-registered-section .scan-check-in')).not.toBeNull();
    expect(document.querySelector('#scan-registered-section .scan-check-out-ok')).not.toBeNull();
    expect(document.querySelector('#scan-unreg-section .scan-check-out-unreg')).not.toBeNull();
    expect(element('#scan-unreg-section h4').textContent).toBe('未報名（1）');
    expect(screen.queryByText('取消出席')).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();

    context = { ...context, role: 'admin' };
    view.rerender(<ScanSession entry={entry} context={context} mode="checkin" />);
    expect(element('#scan-results').textContent).toContain('guest 簽退成功');
    expect(element('#scan-unreg-section .scan-user-tag').textContent).toContain('guest');
    expect(element('#scan-results .scan-result').hasAttribute('data-no-translate')).toBe(true);
  });

  it('renders the empty registered section and an empty unregistered wrapper', async () => {
    renderSession();
    await ready();
    expect(element('#scan-registered-section h4').textContent).toBe('已報名（0）');
    expect(element('#scan-registered-section .scan-user-tags').textContent).toBe('尚無');
    expect(element('#scan-unreg-section').children).toHaveLength(0);
  });

  // 測試同步更新：照 A（M-108）。
  it('disables completed family members and preserves companion payload fields', async () => {
    regs = familyRegistrations();
    stored = [record()];
    renderSession();
    await ready();
    await startCamera();
    await scan();

    expect(element('#scan-family-title').textContent).toBe('👨‍👩‍👧 家庭簽到（Member）');
    expect(element('#scan-family-confirm-btn').textContent).toBe('確認簽到');
    const checks = within(element('#scan-family-list')).getAllByRole<HTMLInputElement>('checkbox');
    const self = checks[0];
    const child = checks[1];
    if (!self || !child) throw new Error('缺少家庭成員');
    expect(self.disabled).toBe(true);
    expect(self.checked).toBe(false);
    expect(child.checked).toBe(true);
    expect(element('#scan-family-list').textContent).toContain('📍 已簽到');

    fireEvent.change(child, { target: { checked: false } });
    fireEvent.click(element('#scan-family-confirm-btn'));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('請選擇要處理的成員'));
    expect(mocks.batch).not.toHaveBeenCalled();

    fireEvent.change(child, { target: { checked: true } });
    await confirmFamily();
    expect(mocks.batch).toHaveBeenCalledOnce();
    expect(mocks.batch.mock.calls[0]).toEqual([
      'event-document',
      [expect.objectContaining({
        eventId: 'public-event',
        uid: 'member',
        userName: 'Member',
        type: 'checkin',
        participantType: 'companion',
        companionId: 'child',
        companionName: 'Child',
      })],
    ]);
    expect(element('#scan-result-title').textContent).toBe('Member 等 1 人簽到成功');
  });

  // Codex 第二審 P1：照 A `companionName || userName`，同行者名字空白時寫入報名者名字。
  it('writes the registrant name when a companion name is blank like A', async () => {
    regs = [
      { userId: 'member', userName: 'Member', status: 'confirmed' },
      { userId: 'member', userName: 'Member', status: 'confirmed', companionId: 'child', companionName: '' },
    ];
    stored = [record()];
    renderSession();
    await ready();
    await startCamera();
    await scan();
    await confirmFamily();
    expect(mocks.batch).toHaveBeenCalledOnce();
    expect(mocks.batch.mock.calls[0]).toEqual([
      'event-document',
      [expect.objectContaining({
        participantType: 'companion',
        companionId: 'child',
        companionName: 'Member',
      })],
    ]);
  });

  it('freezes the family mode while the parent mode changes', async () => {
    regs = familyRegistrations();
    const entry = makeEntry();
    const view = renderSession('checkin', entry);
    await ready();
    await startCamera();
    await scan();
    view.rerender(<ScanSession entry={entry} context={context} mode="checkout" />);
    expect(element('#scan-family-confirm-btn').textContent).toBe('確認簽到');
    await confirmFamily();
    expect(mocks.batch).toHaveBeenCalledOnce();
    expect(batchPayloads().map((value) => value.type))
      .toEqual(['checkin', 'checkin']);
    expect(element('#scan-result-title').textContent).toBe('Member 等 2 人簽到成功');
  });

  it('detects family registration changes before writing', async () => {
    regs = familyRegistrations();
    renderSession();
    await ready();
    await startCamera();
    await scan();
    regs = [{ userId: 'member', userName: 'Member', status: 'confirmed' }];
    fireEvent.click(element('#scan-family-confirm-btn'));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(
      '家庭報名資料已變更，請取消後重新掃描。',
    ));
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(document.querySelector('#scan-family-modal')).not.toBeNull();
  });

  it('vibrates for success, warning and unknown-user error', async () => {
    renderSession();
    await ready();
    await startCamera();
    await scan();
    expect(mocks.vibrate).toHaveBeenLastCalledWith(80);
    await scan();
    expect(mocks.vibrate).toHaveBeenLastCalledWith(300);
    expect(element('#scan-result-box').classList.contains('warning')).toBe(true);

    mocks.user.mockResolvedValueOnce(null);
    await scan('unknown');
    expect(element('#scan-result-title').textContent).toBe('查無此用戶');
    expect(element('#scan-result-box').classList.contains('error')).toBe(true);
    expect(mocks.vibrate).toHaveBeenLastCalledWith(300);
  });

  it('works without vibration support and when vibration throws', async () => {
    Reflect.deleteProperty(navigator, 'vibrate');
    renderSession();
    await ready();
    await startCamera();
    await scan();
    expect(element('#scan-result-title').textContent).toBe('Member 簽到成功');

    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: () => { throw new Error('unsupported'); },
    });
    await scan();
    expect(element('#scan-result-title').textContent).toBe('Member 已完成簽到');
  });

  it.each(['checkout', 'auto', 'family'] as const)(
    'never grants EXP during %s checkout (M-110)',
    async (scenario) => {
      if (scenario === 'checkout') stored = [record()];
      if (scenario === 'family') regs = familyRegistrations();
      renderSession('checkout');
      await ready();
      await startCamera();
      await scan();
      if (scenario === 'family') await confirmFamily();

      const payloads = batchPayloads();
      expect(mocks.batch).toHaveBeenCalledOnce();
      expect(payloads.map((value) => value.type)).toEqual(
        scenario === 'checkout'
          ? ['checkout']
          : scenario === 'auto'
            ? ['checkin', 'checkout']
            : ['checkin', 'checkout', 'checkin', 'checkout'],
      );
      if (scenario === 'family') {
        expect(payloads).toContainEqual(expect.objectContaining({
          participantType: 'self',
          companionId: null,
          companionName: null,
          type: 'checkout',
        }));
      }
      for (const [docId, values] of mocks.batch.mock.calls) {
        expect(docId).toBe('event-document');
        for (const value of values) {
          expect(value.eventId).toBe('public-event');
          expect(value.uid).toBe('member');
          expect(Object.keys(value).sort()).toEqual(
            (scenario === 'family'
              ? ['id', 'eventId', 'uid', 'userName', 'type', 'time',
                'participantType', 'companionId', 'companionName']
              : ['id', 'eventId', 'uid', 'userName', 'type', 'time']).sort(),
          );
        }
      }
      expect(mocks.callFnMock).not.toHaveBeenCalled();
    },
  );

  it('keeps results open on backdrop click, blocks backdrop touch and handles back', async () => {
    renderSession();
    await ready();
    await startCamera();
    await scan();
    const overlay = element('#scan-result-modal');
    fireEvent.click(overlay);
    expect(document.querySelector('#scan-result-modal')).not.toBeNull();

    const touch = new Event('touchmove', { bubbles: true, cancelable: true });
    act(() => { overlay.dispatchEvent(touch); });
    expect(touch.defaultPrevented).toBe(true);
    const insideTouch = new Event('touchmove', { bubbles: true, cancelable: true });
    act(() => { element('#scan-result-title').dispatchEvent(insideTouch); });
    expect(insideTouch.defaultPrevented).toBe(false);

    act(() => { expect(mocks.back?.()).toBe(true); });
    expect(document.querySelector('#scan-result-modal')).toBeNull();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('refuses family back navigation while writing', async () => {
    regs = familyRegistrations();
    const pending = deferred<string[]>();
    mocks.batch.mockReturnValueOnce(pending.promise);
    renderSession();
    await ready();
    await startCamera();
    await scan();
    fireEvent.click(element('#scan-family-confirm-btn'));
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledOnce());
    act(() => { expect(mocks.back?.()).toBe(false); });
    expect(document.querySelector('#scan-family-modal')).not.toBeNull();

    await act(async () => { pending.resolve(['first']); });
    await waitFor(() => expect(document.querySelector('#scan-result-modal')).not.toBeNull());
  });

  it('stops the scanner and releases the overlay on unmount', async () => {
    const view = renderSession();
    await ready();
    await startCamera();
    await scan();
    const stops = mocks.stop.mock.calls.length;
    view.unmount();
    expect(mocks.stop).toHaveBeenCalledTimes(stops + 1);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('does not write after unmount during a lookup', async () => {
    const pending = deferred<ScanUser | null>();
    mocks.user.mockReturnValueOnce(pending.promise);
    const view = renderSession();
    await ready();
    await startCamera();
    const options = mocks.options;
    if (!options) throw new Error('缺少掃描器');
    let work: Promise<void> | void;
    await act(async () => {
      work = options.onScan('member');
      await Promise.resolve();
    });
    view.unmount();
    await act(async () => {
      pending.resolve({ uid: 'member', name: 'Member' });
      await work;
    });
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('stops pending work after operator or permission changes', async () => {
    const pending = deferred<ScanUser | null>();
    mocks.user.mockReturnValueOnce(pending.promise);
    const entry = makeEntry();
    const view = renderSession('checkin', entry);
    await ready();
    await startCamera();
    const options = mocks.options;
    if (!options) throw new Error('缺少掃描器');
    let work: Promise<void> | void;
    await act(async () => {
      work = options.onScan('member');
      await Promise.resolve();
    });
    context = { ...context, uid: 'not-delegated' };
    view.rerender(<ScanSession entry={entry} context={context} mode="checkin" />);
    await act(async () => {
      pending.resolve({ uid: 'member', name: 'Member' });
      await work;
    });
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(document.querySelector('#scan-camera-btn')).toBeNull();
    expect(mocks.stop).toHaveBeenCalled();
  });

  it('ignores an initial read that finishes after newer scan data', async () => {
    const pending = deferred<EventAttendanceEntry[]>();
    mocks.attendance.mockReturnValueOnce(pending.promise);
    renderSession();
    await waitFor(() => expect(mocks.attendance).toHaveBeenCalledOnce());
    await startCamera();
    await scan();
    expect(element('#scan-results').textContent).toContain('Member 簽到成功');

    await act(async () => {
      pending.resolve([record({ userName: 'Stale' })]);
    });
    expect(element('#scan-results').textContent).not.toContain('Stale');
    expect(element('#scan-results').textContent).toContain('Member 簽到成功');
  });

  it('toasts write failure, restores the session and allows a successful retry', async () => {
    mocks.batch.mockRejectedValueOnce(new Error('offline'));
    renderSession();
    await ready();
    await startCamera();
    const reads = mocks.attendance.mock.calls.length;
    await scan();
    expect(mocks.toast).toHaveBeenCalledWith('寫入失敗：請確認登入狀態與網路');
    expect(mocks.attendance.mock.calls.length).toBeGreaterThan(reads + 1);
    expect(element('#scan-results').textContent).not.toContain('Member 簽到成功');
    expect(document.querySelector('#scan-result-modal')).toBeNull();

    await scan();
    expect(element('#scan-result-title').textContent).toBe('Member 簽到成功');
    expect(mocks.batch).toHaveBeenCalledTimes(2);
  });

  it('reports read failure separately and recovers on the next scan', async () => {
    mocks.attendance.mockRejectedValueOnce(new Error('unavailable'));
    renderSession();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(
      '無法載入最新資料，請重試。',
    ));
    await startCamera();
    await scan();
    expect(element('#scan-result-title').textContent).toBe('Member 簽到成功');
    expect(mocks.toast).not.toHaveBeenCalledWith('寫入失敗：請確認登入狀態與網路');
  });

  // 測試同步更新：照 A（M-108／R-STAT）：A `_processAttendance` 的 userRegsForCheck 以 userId 或 userName 比對 confirmed 報名，
  // 判定在鎖定域 attendance.ts#decideScanAction，UI 不得自行縮窄成只認 UID。
  it('treats a confirmed same-name registration as registered like A', async () => {
    regs = [{ userId: 'someone-else', userName: 'Member', status: 'confirmed' }];
    renderSession();
    await ready();
    await startCamera();
    await scan();
    expect(batchPayloads().map((value) => value.type))
      .toEqual(['checkin']);
    expect(element('#scan-result-title').textContent).toBe('Member 簽到成功');
  });

  it('excludes cancelled attendance from scan decisions', async () => {
    stored = [record({ status: 'cancelled' })];
    renderSession();
    await ready();
    await startCamera();
    await scan();
    expect(mocks.batch).toHaveBeenCalledOnce();
    expect(element('#scan-result-title').textContent).toBe('Member 簽到成功');
  });

  it('reads a check-in and a registration that landed after the session opened', async () => {
    regs = [];
    mocks.user.mockResolvedValue({ uid: 'uidA', name: 'targetA' });
    renderSession('checkin', eventA());
    await ready();
    await startCamera();
    const reads = mocks.attendance.mock.calls.length;
    const regReads = mocks.registrations.mock.calls.length;
    stored = [record({
      _docId: 'remote',
      uid: 'uidA',
      userName: 'targetA',
      displayName: 'targetA',
    })];
    regs = [{ userId: 'uidA', userName: 'targetA', status: 'confirmed' }];

    await scan('uidA');
    expect(mocks.attendance.mock.calls.length).toBeGreaterThan(reads);
    expect(mocks.registrations.mock.calls.length).toBeGreaterThan(regReads);
    expect(element('#scan-result-title').textContent).toBe('targetA 已完成簽到');
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('shows each of two different people before either write settles', async () => {
    regs = [
      { userId: 'uidA', userName: 'targetA', status: 'confirmed' },
      { userId: 'uidB', userName: 'uidB', status: 'confirmed' },
    ];
    mocks.user.mockImplementation(async (uid) => ({
      uid,
      name: uid === 'uidA' ? 'targetA' : 'uidB',
    }));
    const firstWrite = deferred<string[]>();
    const secondWrite = deferred<string[]>();
    mocks.batch
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    renderSession('checkin', eventA());
    await ready();
    await startCamera();
    const reads = mocks.attendance.mock.calls.length;
    const regReads = mocks.registrations.mock.calls.length;
    const options = mocks.options;
    if (!options) throw new Error('缺少掃描器');

    let firstWriteSettled = false;
    let secondWriteSettled = false;
    void firstWrite.promise.then(() => { firstWriteSettled = true; });
    void secondWrite.promise.then(() => { secondWriteSettled = true; });

    // 掃描器會 await onScan。這個 Promise 在寫入仍 pending 時就要 resolve，鏡頭才能接下一碼。
    let firstSettled = false;
    const firstScan = Promise.resolve(options.onScan('uidA')).then(() => { firstSettled = true; });
    await act(async () => { await firstScan; });
    expect(firstSettled).toBe(true);
    expect(firstWriteSettled).toBe(false);
    expect(element('#scan-result-title').textContent).toBe('targetA 簽到成功');
    expect(mocks.batch).toHaveBeenCalledTimes(1);

    let secondSettled = false;
    const secondScan = Promise.resolve(options.onScan('uidB')).then(() => { secondSettled = true; });
    await act(async () => { await secondScan; });
    expect(secondSettled).toBe(true);
    expect(firstWriteSettled).toBe(false);
    expect(secondWriteSettled).toBe(false);
    expect(element('#scan-result-title').textContent).toBe('uidB 簽到成功');
    expect(element('#scan-results').textContent).toContain('targetA 簽到成功');
    expect(element('#scan-results').textContent).toContain('uidB 簽到成功');
    expect(mocks.batch).toHaveBeenCalledTimes(2);
    expect(mocks.attendance.mock.calls.length).toBeGreaterThan(reads);
    expect(mocks.registrations.mock.calls.length).toBeGreaterThan(regReads);

    firstWrite.resolve(['doc-a']);
    secondWrite.resolve(['doc-b']);
    await act(async () => {
      await firstWrite.promise;
      await secondWrite.promise;
    });
    expect(firstWriteSettled).toBe(true);
    expect(secondWriteSettled).toBe(true);
  });

  it('does not write the same person again while the first write is open', async () => {
    regs = [{ userId: 'uidA', userName: 'targetA', status: 'confirmed' }];
    mocks.user.mockResolvedValue({ uid: 'uidA', name: 'targetA' });
    const pending = deferred<string[]>();
    mocks.batch.mockReturnValueOnce(pending.promise);
    renderSession('checkin', eventA());
    await ready();
    await startCamera();
    const options = mocks.options;
    if (!options) throw new Error('缺少掃描器');

    let first: Promise<void> | void;
    await act(async () => {
      first = options.onScan('uidA');
      await Promise.resolve();
    });
    await waitFor(() => expect(element('#scan-result-title').textContent).toBe('targetA 簽到成功'));

    await act(async () => { await options.onScan('uidA'); });
    expect(element('#scan-result-title').textContent).toBe('targetA 已完成簽到');
    expect(mocks.batch).toHaveBeenCalledTimes(1);

    pending.resolve(['doc-a']);
    await act(async () => { await first; });
  });

  it('shows an unregistered check-in before one merged batch settles', async () => {
    regs = [];
    mocks.user.mockResolvedValue({ uid: 'uidA', name: 'targetA' });
    const pending = deferred<string[]>();
    mocks.batch.mockReturnValueOnce(pending.promise);
    renderSession('checkin', eventA());
    await ready();
    await startCamera();
    const options = mocks.options;
    if (!options) throw new Error('缺少掃描器');

    let work: Promise<void> | void;
    await act(async () => {
      work = options.onScan('uidA');
      await Promise.resolve();
    });
    await waitFor(() => expect(element('#scan-result-title').textContent)
      .toBe('targetA 未報名，簽到成功'));
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.batch.mock.calls[0]?.[0]).toBe('evtA');
    expect((mocks.batch.mock.calls[0]?.[1] as AttendanceWritePayload[]).map((value) => value.type))
      .toEqual(['unreg', 'checkin']);
    expect(element('#scan-results').textContent).toContain('targetA 簽到成功');
    expect(element('#scan-results').textContent).toContain('targetA 未報名此活動');

    await act(async () => { await options.onScan('uidA'); });
    expect(element('#scan-result-title').textContent).toBe('targetA 未報名，已完成簽到');
    expect(mocks.batch).toHaveBeenCalledTimes(1);

    pending.resolve(['doc-u', 'doc-c']);
    await act(async () => { await work; });
  });

  it('removes the optimistic result when the merged write fails', async () => {
    regs = [{ userId: 'uidA', userName: 'targetA', status: 'confirmed' }];
    mocks.user.mockResolvedValue({ uid: 'uidA', name: 'targetA' });
    const pending = deferred<string[]>();
    mocks.batch.mockReturnValueOnce(pending.promise);
    renderSession('checkin', eventA());
    await ready();
    await startCamera();
    const reads = mocks.attendance.mock.calls.length;
    const options = mocks.options;
    if (!options) throw new Error('缺少掃描器');

    let settled = false;
    const scanPromise = Promise.resolve(options.onScan('uidA')).then(() => { settled = true; });
    await act(async () => { await scanPromise; });
    expect(settled).toBe(true);
    expect(element('#scan-result-title').textContent).toBe('targetA 簽到成功');

    pending.reject(new Error('offline'));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.toast).toHaveBeenCalledWith('寫入失敗：請確認登入狀態與網路');
    expect(document.querySelector('#scan-result-modal')).toBeNull();
    expect(element('#scan-results').textContent).not.toContain('targetA 簽到成功');
    expect(mocks.attendance.mock.calls.length).toBeGreaterThan(reads + 1);

    await act(async () => { await options.onScan('uidA'); });
    expect(element('#scan-result-title').textContent).toBe('targetA 簽到成功');
    expect(mocks.batch).toHaveBeenCalledTimes(2);
  });

  it('toasts a write failure once after the session unmounts', async () => {
    regs = [{ userId: 'uidA', userName: 'targetA', status: 'confirmed' }];
    mocks.user.mockResolvedValue({ uid: 'uidA', name: 'targetA' });
    const pending = deferred<string[]>();
    mocks.batch.mockReturnValueOnce(pending.promise);
    const view = renderSession('checkin', eventA());
    await ready();
    await startCamera();
    const options = mocks.options;
    if (!options) throw new Error('缺少掃描器');

    await act(async () => { await options.onScan('uidA'); });
    expect(element('#scan-result-title').textContent).toBe('targetA 簽到成功');
    expect(mocks.toast).not.toHaveBeenCalledWith('寫入失敗：請確認登入狀態與網路');

    view.unmount();
    pending.reject(new Error('offline'));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.toast.mock.calls.filter((call) =>
      call[0] === '寫入失敗：請確認登入狀態與網路')).toHaveLength(1);
  });

  it('keeps the shown check-in when the success handler throws', async () => {
    regs = [{ userId: 'uidA', userName: 'targetA', status: 'confirmed' }];
    mocks.user.mockResolvedValue({ uid: 'uidA', name: 'targetA' });
    const pending = deferred<string[]>();
    mocks.batch.mockReturnValueOnce(pending.promise);
    renderSession('checkin', eventA());
    await ready();
    await startCamera();
    const reads = mocks.attendance.mock.calls.length;
    const options = mocks.options;
    if (!options) throw new Error('缺少掃描器');

    await act(async () => { await options.onScan('uidA'); });
    expect(element('#scan-result-title').textContent).toBe('targetA 簽到成功');

    // 寫入 Promise 已完成，但讀取回傳 id 時丟例外。這不是寫入失敗。
    let threw = false;
    const ids = new Proxy(['doc-a'], {
      get(target, prop, receiver) {
        if (prop === '0') {
          threw = true;
          throw new Error('rename failed');
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await act(async () => {
      pending.resolve(ids);
      await pending.promise;
      await Promise.resolve();
    });

    expect(threw).toBe(true);
    expect(mocks.toast).not.toHaveBeenCalledWith('寫入失敗：請確認登入狀態與網路');
    expect(document.querySelector('#scan-result-modal')).not.toBeNull();
    expect(element('#scan-results').textContent).toContain('targetA 簽到成功');
    expect(mocks.attendance.mock.calls.length).toBe(reads + 1);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });
});

describe('buildScanView', () => {
  afterEach(() => {
    cleanup();
  });

  it('filters inactive records, sorts results and trims display names', () => {
    const input = [
      record({ _docId: 'old', userName: '  Member  ', time: '2026/10/22 09:00' }),
      record({
        _docId: 'new',
        companionId: 'child',
        companionName: ' Child ',
        time: '2026/10/22 10:00',
      }),
      record({ _docId: 'removed', status: 'removed' }),
      record({ _docId: 'cancelled', status: 'cancelled' }),
    ];
    const result = buildScanView(makeEntry(), input, [], 'user', '用戶');
    expect(result.results.map((row) => row.record._docId)).toEqual(['new', 'old']);
    expect(result.results.map((row) => row.name)).toEqual(['Child', 'Member']);
    expect(input).toHaveLength(4);
    expect(result.registered).toHaveLength(1);
    expect(result.checkins).toBe(2);
    expect(result.rate).toBe(100);
  });

  it.each(['admin', 'super_admin'])('allows raw UID fallback only for %s', (role) => {
    const result = buildScanView(
      makeEntry(),
      [record({ uid: ' raw-uid ', userName: '  ' })],
      [],
      role,
      '用戶',
    );
    expect(result.results[0]?.name).toBe('raw-uid');
  });

  it.each(['user', 'coach', null])('hides raw UID fallback for %s', (role) => {
    const result = buildScanView(
      makeEntry(),
      [record({ uid: 'raw-uid', userName: '  ' })],
      [],
      role,
      '用戶',
    );
    expect(result.results[0]?.name).toBe('用戶');
  });

  it('uses document current, confirmed count, then legacy participant count', () => {
    const confirmed = familyRegistrations();
    expect(buildScanView(makeEntry(9), [], confirmed, 'user', '用戶').total).toBe(9);
    expect(buildScanView(makeEntry(0), [], confirmed, 'user', '用戶').total).toBe(2);
    expect(buildScanView(makeEntry(0, ['A', 'B', 'C']), [], [], 'user', '用戶').total)
      .toBe(3);
    const empty = buildScanView(makeEntry(0, []), [], [], 'user', '用戶');
    expect(empty.total).toBe(0);
    expect(empty.rate).toBe(0);
  });

  it('groups registered checks by UID but counts attendance per person', () => {
    const result = buildScanView(makeEntry(), [
      record(),
      record({
        _docId: 'child',
        companionId: 'child',
        companionName: 'Child',
        type: 'checkout',
      }),
      record({ _docId: 'guest-unreg', uid: 'guest', userName: 'Guest', type: 'unreg' }),
      record({ _docId: 'guest-in', uid: 'guest', userName: 'Guest', type: 'checkin' }),
    ], familyRegistrations(), 'user', '用戶');
    expect(result.counts.get('member')).toBe(2);
    expect(result.registered).toHaveLength(1);
    expect(result.registered[0]).toMatchObject({ checkin: true, checkout: true });
    expect(result.checkins).toBe(1);
    expect(result.checkouts).toBe(1);
    expect(result.unregistered).toHaveLength(1);
    expect(result.rate).toBe(50);
  });

  it('sorts both tag sections by displayed name', () => {
    const result = buildScanView(makeEntry(), [
      record({ _docId: 'z', uid: 'z', userName: 'Zed' }),
      record({ _docId: 'a', uid: 'a', userName: 'Amy' }),
      record({ _docId: 'uz', uid: 'uz', userName: 'Zoe', type: 'unreg' }),
      record({ _docId: 'ua', uid: 'ua', userName: 'Ann', type: 'unreg' }),
    ], [], 'user', '用戶');
    expect(result.registered.map((person) => person.name)).toEqual(['Amy', 'Zed']);
    expect(result.unregistered.map((person) => person.name)).toEqual(['Ann', 'Zoe']);
  });
});
