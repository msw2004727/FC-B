import type { NameResolver } from '../data/pm-audit-names';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallableError } from '@/data/callables';
import { shortUid } from '../data/pm-audit-view';
import { PmAuditPanel } from './PmAuditPanel';

const dictHolder = vi.hoisted(() => ({ dict: {} as Record<string, string> }));

const mocks = vi.hoisted(() => ({
  mockCallFn: vi.fn(),
  mockCopyDiagnostic: vi.fn(),
  mockToastShow: vi.fn(),
}));

vi.mock('@/data/callables', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/callables')>();
  return {
    ...actual,
    callFn: (name: string, req: unknown) => mocks.mockCallFn(name, req),
  };
});

vi.mock('../data/operation-logs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/operation-logs')>();
  return {
    ...actual,
    copyDiagnosticTextToClipboard: (text: string) => mocks.mockCopyDiagnostic(text),
  };
});

vi.mock('@/ui/Toast', () => ({
  toast: {
    show: (arg: unknown) => mocks.mockToastShow(arg),
  },
}));

vi.mock('@/ui/BottomSheet', () => ({
  BottomSheet: (props: { open?: boolean; title?: string; children?: unknown }) => (
    props.open ? (
      <div data-testid="bottom-sheet">
        <div data-testid="sheet-title">{props.title}</div>
        {props.children as never}
      </div>
    ) : null
  ),
}));

vi.mock('./LogRangeBar', () => ({
  LogRangeBar: (props: {
    pageSize: unknown;
    onRange: (range: { unit: 'month'; startMs: number; endMs: number }) => void;
    onPageSize: (next: 10 | 20 | 30 | 'infinite') => void;
  }) => {
    const monthStart = Date.parse('2026-10-31T16:00:00Z');
    const monthEnd = Date.parse('2026-11-30T16:00:00Z');
    return (
      <div data-testid="range-bar">
        <button
          type="button"
          onClick={() => props.onRange({ unit: 'month', startMs: monthStart, endMs: monthEnd })}
        >
          月
        </button>
        <select
          aria-label="每頁筆數"
          value={String(props.pageSize)}
          onChange={(e) => {
            const v = e.currentTarget.value;
            props.onPageSize(v === 'infinite' ? 'infinite' : (Number(v) as 10 | 20 | 30));
          }}
        >
          <option value="10">10 筆</option>
          <option value="20">20 筆</option>
          <option value="30">30 筆</option>
          <option value="infinite">無限</option>
        </select>
      </div>
    );
  },
  LogPager: (props: {
    page: number;
    hasPrev: boolean;
    hasNext: boolean;
    onPrev: () => void;
    onNext: () => void;
  }) => (
    <div data-testid="pager">
      <span>{`第 ${props.page} 頁`}</span>
      <button type="button" onClick={props.onPrev} disabled={!props.hasPrev}>上一頁</button>
      <button type="button" onClick={props.onNext} disabled={!props.hasNext}>下一頁</button>
    </div>
  ),
}));

vi.mock('@/i18n/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    let tmpl = dictHolder.dict[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        tmpl = tmpl.replace(`{${k}}`, String(v));
      }
    }
    return tmpl;
  },
  formatNumber: (n: number) => String(n),
  getCurrentLocale: () => 'zh-TW',
}));

function flattenDict(
  obj: Record<string, unknown>,
  prefix: string,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = `${prefix}${k}`;
    if (v && typeof v === 'object') flattenDict(v as Record<string, unknown>, `${key}.`, out);
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}

const zhTwRelativePath = '../locales/zh-TW.json';
const zhTwDict = flattenDict(
  JSON.parse(readFileSync(new URL(zhTwRelativePath, import.meta.url), 'utf8')) as Record<string, unknown>,
  'logs.',
);
dictHolder.dict = zhTwDict;


// 動作標籤只在 log 列裡找（下拉選單的 <option> 也有同樣文字，不能用 screen 全頁找）。
function logTags(text: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#pm-audit-logs .pma-tag')).filter((el) => el.textContent === text);
}
function queryTag(text: string): HTMLElement | null {
  return logTags(text)[0] ?? null;
}
function getTag(text: string): HTMLElement {
  const el = queryTag(text);
  if (!el) throw new Error(`找不到動作標籤：${text}`);
  return el;
}
function getAllTags(text: string): HTMLElement[] {
  const els = logTags(text);
  if (els.length === 0) throw new Error(`找不到動作標籤：${text}`);
  return els;
}

const NOW_MS = Date.parse('2026-11-19T04:00:00Z');
const WEEK_START_MS = Date.parse('2026-11-15T16:00:00Z');
const WEEK_END_MS = Date.parse('2026-11-22T16:00:00Z');
const MONTH_END_MS = Date.parse('2026-11-30T16:00:00Z');

const UID_A = 'U1111aaaa2222bbbb3333cccc4444dddd';
const UID_B = 'U2222bbbb3333cccc4444dddd5555eeee';
const UID_C = 'U3333cccc4444dddd5555eeee6666ffff';
const UID_D = 'U4444dddd5555eeee6666ffff7777aaaa';

interface FakeLog {
  id: string;
  action: string;
  actorUid: string;
  targetUid: string;
  conversationId: string;
  createdAtIso: string;
  createdAt: unknown;
  createdAtMs: number;
}

let auditLogs: FakeLog[] = [];
let conversationResponse: unknown = { thread: { participants: [], participantNames: {} }, messages: [] };
let conversationError: unknown = null;
let settingsAllowPm = false;
let searchUsersResponse: unknown[] = [];
let listThreadsResponse: unknown[] = [];
let failNextLogsRequest = false;
let logSeq = 0;
let ioCallbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
let originalIO: typeof IntersectionObserver | undefined;

class MockIntersectionObserver {
  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    ioCallbacks.push(cb);
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

function makeFakeLog(createdAtMs: number, over: Partial<FakeLog> = {}): FakeLog {
  logSeq += 1;
  const iso = new Date(createdAtMs).toISOString();
  return {
    id: `log_${logSeq}`,
    action: 'send',
    actorUid: '',
    targetUid: '',
    conversationId: '',
    createdAtIso: iso,
    createdAt: { seconds: Math.floor(createdAtMs / 1000) },
    createdAtMs,
    ...over,
  };
}

function getAuditCalls(): Array<Record<string, unknown>> {
  return mocks.mockCallFn.mock.calls
    .filter(([name]) => name === 'getPmAuditLogs')
    .map(([, req]) => req as Record<string, unknown>);
}

function callsOf(name: string): unknown[] {
  return mocks.mockCallFn.mock.calls
    .filter(([n]) => n === name)
    .map(([, req]) => req);
}

function emitIntersection(isIntersecting: boolean): void {
  const entries = [{ isIntersecting }];
  for (const cb of ioCallbacks) cb(entries);
}

function renderPanel(overrides: { resolveNames?: NameResolver; nowMs?: number } = {}) {
  const resolveNames: NameResolver = overrides.resolveNames ?? vi.fn(async (): Promise<Record<string, string>> => ({}));
  const view = render(
    <PmAuditPanel resolveNames={resolveNames} nowMs={overrides.nowMs ?? NOW_MS} />,
  );
  return { view, resolveNames };
}

beforeEach(() => {
  vi.clearAllMocks();
  auditLogs = [];
  conversationResponse = { thread: { participants: [], participantNames: {} }, messages: [] };
  conversationError = null;
  settingsAllowPm = false;
  searchUsersResponse = [];
  listThreadsResponse = [];
  failNextLogsRequest = false;
  logSeq = 0;
  ioCallbacks = [];
  originalIO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
  mocks.mockCopyDiagnostic.mockResolvedValue(undefined);

  mocks.mockCallFn.mockImplementation(async (name: string, req: Record<string, unknown>) => {
    if (name === 'getPmAuditLogs') {
      if (failNextLogsRequest && req?.cursorCreatedAtMs !== WEEK_END_MS) {
        failNextLogsRequest = false;
        throw new Error('audit logs boom');
      }
      let list = auditLogs.slice();
      if (typeof req?.action === 'string' && req.action) {
        list = list.filter((log) => log.action === req.action);
      }
      if (typeof req?.actorUid === 'string' && req.actorUid) {
        list = list.filter((log) => log.actorUid === req.actorUid);
      }
      if (typeof req?.targetUid === 'string' && req.targetUid) {
        list = list.filter((log) =>
          log.targetUid.split(',').map((s) => s.trim()).includes(req.targetUid as string),
        );
      }
      list.sort((a, b) => b.createdAtMs - a.createdAtMs);
      if (typeof req?.cursorCreatedAtMs === 'number' && req.cursorCreatedAtMs) {
        list = list.filter((log) => log.createdAtMs < (req.cursorCreatedAtMs as number));
      }
      const limit = Number(req?.limit) || 50;
      const page = list.slice(0, limit);
      const hasMore = list.length > limit;
      const nextCursor = hasMore && page.length > 0
        ? { createdAtMs: page[page.length - 1]!.createdAtMs }
        : null;
      return {
        ok: true,
        logs: page.map((log) => ({
          id: log.id,
          action: log.action,
          actorUid: log.actorUid,
          targetUid: log.targetUid,
          conversationId: log.conversationId,
          createdAtIso: log.createdAtIso,
          createdAt: log.createdAt,
        })),
        nextCursor,
        hasMore,
      };
    }
    if (name === 'getPrivateMessageSettings') {
      return { ok: true, settings: { allowUserToUserPm: settingsAllowPm } };
    }
    if (name === 'updatePrivateMessageSettings') {
      settingsAllowPm = req?.allowUserToUserPm === true;
      return { ok: true, settings: { allowUserToUserPm: settingsAllowPm } };
    }
    if (name === 'getPmAuditConversation') {
      if (conversationError) throw conversationError;
      return conversationResponse;
    }
    if (name === 'searchPmAuditUsers') {
      return { ok: true, users: searchUsersResponse };
    }
    if (name === 'listPmAuditThreads') {
      return { ok: true, threads: listThreadsResponse };
    }
    return {};
  });
});

afterEach(() => {
  cleanup();
  for (const req of getAuditCalls()) {
    const present = ['action', 'actorUid', 'targetUid'].filter(
      (key) => req && Object.prototype.hasOwnProperty.call(req, key) && req[key] !== undefined,
    );
    expect(present.length).toBeLessThanOrEqual(1);
  }
  if (originalIO) globalThis.IntersectionObserver = originalIO;
  else delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  ioCallbacks = [];
});

describe('PmAuditPanel：聊天室稽核', () => {
  it('掛載只呼叫 getPmAuditLogs 一次，payload 為本週迄且未讀私訊設定', async () => {
    renderPanel();
    await screen.findByText('目前沒有 log');
    expect(getAuditCalls()).toHaveLength(1);
    expect(getAuditCalls()[0]).toEqual({ limit: 10, cursorCreatedAtMs: WEEK_END_MS });
    expect(callsOf('getPrivateMessageSettings')).toHaveLength(0);
  });

  it('按齒輪才呼叫 getPrivateMessageSettings 一次，切換開關呼叫 updatePrivateMessageSettings', async () => {
    renderPanel();
    await screen.findByText('目前沒有 log');
    fireEvent.click(screen.getByRole('button', { name: '私訊設定' }));
    await waitFor(() => expect(callsOf('getPrivateMessageSettings')).toHaveLength(1));
    const toggle = document.getElementById('pm-user-pm-toggle') as HTMLInputElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));
    fireEvent.click(toggle);
    await waitFor(() => expect(callsOf('updatePrivateMessageSettings')).toHaveLength(1));
    expect(callsOf('updatePrivateMessageSettings')[0]).toEqual({ allowUserToUserPm: true });
  });

  it('每列顯示中文動作與「暱稱 UID 短碼 → 暱稱 UID 短碼」', async () => {
    auditLogs = [
      makeFakeLog(NOW_MS - 1_000, {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: 'c1',
      }),
    ];
    const resolveNames = vi.fn(async () => ({
      [UID_A]: '王小明',
      [UID_B]: '陳大華',
    }));
    renderPanel({ resolveNames });
    await screen.findByText('送出');
    expect(screen.getByText('王小明')).toBeTruthy();
    expect(screen.getByText('陳大華')).toBeTruthy();
    expect(screen.getByText(shortUid(UID_A))).toBeTruthy();
    expect(screen.getByText(shortUid(UID_B))).toBeTruthy();
    const row = document.querySelector('.pma-log') as HTMLElement;
    expect(row.textContent).toContain('送出');
    expect(row.textContent).toContain(shortUid(UID_A));
    expect(row.textContent).toContain('→');
    expect(row.textContent).toContain(shortUid(UID_B));
  });

  it('resolveNames 回空字串顯示「未知用戶」，且只收到該頁 UID（a,b 拆開）', async () => {
    auditLogs = [
      makeFakeLog(NOW_MS - 1_000, {
        action: 'send',
        actorUid: 'c',
        targetUid: 'a,b',
        conversationId: 'c1',
      }),
    ];
    const resolveNames = vi.fn(async () => ({}));
    renderPanel({ resolveNames });
    await waitFor(() => expect(resolveNames).toHaveBeenCalledTimes(1));
    expect(resolveNames).toHaveBeenCalledWith(['c', 'a', 'b']);
    await waitFor(() => expect(screen.getAllByText('未知用戶')).toHaveLength(3));
  });

  it('點操作者、對象與清除會分別送出單一篩選鍵，並顯示對應標籤', async () => {
    auditLogs = [
      makeFakeLog(NOW_MS - 1_000, {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: 'c1',
      }),
    ];
    const resolveNames = vi.fn(async () => ({
      [UID_A]: '王小明',
      [UID_B]: '陳大華',
    }));
    renderPanel({ resolveNames });
    await screen.findByText('王小明');
    expect(getAuditCalls()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '只看此人操作：王小明' }));
    await waitFor(() => expect(getAuditCalls()).toHaveLength(2));
    expect(getAuditCalls()[1]).toEqual({
      actorUid: UID_A,
      limit: 10,
      cursorCreatedAtMs: WEEK_END_MS,
    });
    await screen.findByText(`操作者：王小明 ${shortUid(UID_A)}`);

    fireEvent.click(screen.getByRole('button', { name: '只看對此人：陳大華' }));
    await waitFor(() => expect(getAuditCalls()).toHaveLength(3));
    expect(getAuditCalls()[2]).toEqual({
      targetUid: UID_B,
      limit: 10,
      cursorCreatedAtMs: WEEK_END_MS,
    });
    await screen.findByText(`對象：陳大華 ${shortUid(UID_B)}`);

    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    await waitFor(() => expect(getAuditCalls()).toHaveLength(4));
    expect(getAuditCalls()[3]).toEqual({ limit: 10, cursorCreatedAtMs: WEEK_END_MS });
    expect(screen.queryByText(/操作者：/)).toBeNull();
    expect(screen.queryByText(/對象：/)).toBeNull();
  });

  it('動作下拉選 send 只送 action，且隱藏稽核查詢開關停用', async () => {
    auditLogs = [
      makeFakeLog(NOW_MS - 1_000, {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: 'c1',
      }),
    ];
    renderPanel();
    await screen.findByText('送出');
    const select = document.getElementById('pm-audit-action') as HTMLSelectElement;
    await act(async () => {
      select.value = 'send';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(getAuditCalls()).toHaveLength(2));
    expect(getAuditCalls()[1]).toEqual({
      action: 'send',
      limit: 10,
      cursorCreatedAtMs: WEEK_END_MS,
    });
    const hideCheckbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(hideCheckbox.disabled).toBe(true);
  });

  it('「隱藏稽核查詢」預設隱藏自查紀錄，關閉後全顯示且不重新呼叫', async () => {
    const actions = [
      'settings_view',
      'audit_search_logs',
      'search_user',
      'audit_view_thread',
      'audit_view_conversation',
    ];
    auditLogs = actions.map((action, index) =>
      makeFakeLog(NOW_MS - index * 1_000, {
        action,
        actorUid: UID_A,
        targetUid: '',
        conversationId: action === 'audit_view_conversation' ? 'c1' : '',
      }),
    );
    renderPanel();
    await waitFor(() => expect(getTag('查看對話內容')).toBeTruthy());
    expect(screen.getByText('已隱藏 4 筆稽核查詢')).toBeTruthy();
    expect(queryTag('查看設定')).toBeNull();
    expect(queryTag('查詢 log')).toBeNull();
    expect(queryTag('搜尋用戶')).toBeNull();
    expect(queryTag('查看對話列表')).toBeNull();
    expect(getAuditCalls()).toHaveLength(1);

    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(getTag('查看設定')).toBeTruthy());
    expect(getTag('查詢 log')).toBeTruthy();
    expect(getTag('搜尋用戶')).toBeTruthy();
    expect(getTag('查看對話列表')).toBeTruthy();
    expect(screen.queryByText(/已隱藏/)).toBeNull();
    expect(getAuditCalls()).toHaveLength(1);
  });

  it('早於本週起的 log 被丟棄且沒有下一頁', async () => {
    const early = makeFakeLog(WEEK_START_MS - 60_000, {
      action: 'send',
      actorUid: UID_A,
      targetUid: UID_B,
      conversationId: 'c0',
    });
    const inside = makeFakeLog(NOW_MS, {
      action: 'read',
      actorUid: UID_A,
      targetUid: UID_B,
      conversationId: 'c1',
    });
    auditLogs = [early, inside];
    renderPanel();
    await screen.findByText('已讀');
    expect(queryTag('送出')).toBeNull();
    const nextBtn = screen.getByRole('button', { name: '下一頁' }) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
    expect(getAuditCalls()).toHaveLength(1);
  });

  it('按「月」重新呼叫 cursor 為 12/1 台北；每頁筆數選 30 送 limit 30', async () => {
    renderPanel();
    await screen.findByText('目前沒有 log');
    expect(getAuditCalls()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '月' }));
    await waitFor(() => expect(getAuditCalls()).toHaveLength(2));
    expect(getAuditCalls()[1]).toEqual({ limit: 10, cursorCreatedAtMs: MONTH_END_MS });

    const select = screen.getByLabelText('每頁筆數') as HTMLSelectElement;
    await act(async () => {
      select.value = '30';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(getAuditCalls()).toHaveLength(3));
    expect(getAuditCalls()[2]).toEqual({ limit: 30, cursorCreatedAtMs: MONTH_END_MS });
  });

  it('分頁：下一頁使用上一頁 nextCursor，上一頁不重新呼叫', async () => {
    auditLogs = Array.from({ length: 15 }, (_, index) =>
      makeFakeLog(NOW_MS - index * 60_000, {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: `c${index}`,
      }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText('第 1 頁')).toBeTruthy());
    expect(getAuditCalls()).toHaveLength(1);
    const firstNextCursor = auditLogs[9]!.createdAtMs;

    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    await waitFor(() => expect(screen.getByText('第 2 頁')).toBeTruthy());
    expect(getAuditCalls()).toHaveLength(2);
    expect(getAuditCalls()[1]).toEqual({ limit: 10, cursorCreatedAtMs: firstNextCursor });

    fireEvent.click(screen.getByRole('button', { name: '上一頁' }));
    await waitFor(() => expect(screen.getByText('第 1 頁')).toBeTruthy());
    expect(getAuditCalls()).toHaveLength(2);
  });

  it('無限模式：limit 100，IntersectionObserver 進入畫面只自動抓一次', async () => {
    auditLogs = Array.from({ length: 300 }, (_, index) =>
      makeFakeLog(NOW_MS - index * 1_000, {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: `c${index}`,
      }),
    );
    renderPanel();
    await waitFor(() => expect(getAllTags('送出')).toHaveLength(10));

    const select = screen.getByLabelText('每頁筆數') as HTMLSelectElement;
    await act(async () => {
      select.value = 'infinite';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(getAuditCalls()).toHaveLength(2));
    expect(getAuditCalls()[1]).toMatchObject({ limit: 100 });
    await waitFor(() => expect(getAllTags('送出')).toHaveLength(100));
    const afterInfinite = getAuditCalls().length;

    await act(async () => emitIntersection(true));
    await waitFor(() => expect(getAuditCalls()).toHaveLength(afterInfinite + 1));
    await waitFor(() => expect(getAllTags('送出')).toHaveLength(200));

    await act(async () => emitIntersection(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getAuditCalls()).toHaveLength(afterInfinite + 1);

    await act(async () => emitIntersection(false));
    await act(async () => emitIntersection(true));
    await waitFor(() => expect(getAuditCalls()).toHaveLength(afterInfinite + 2));
  });

  it('最後一批全是自我稽核時進入畫面不自動抓，按「加載更多」才抓', async () => {
    const selfLogs = Array.from({ length: 100 }, (_, index) =>
      makeFakeLog(NOW_MS - index * 1_000, {
        action: 'settings_view',
        actorUid: UID_A,
        targetUid: '',
        conversationId: '',
      }),
    );
    const normalLogs = Array.from({ length: 100 }, (_, index) =>
      makeFakeLog(NOW_MS - (index + 100) * 1_000, {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: `c${index}`,
      }),
    );
    auditLogs = [...selfLogs, ...normalLogs];
    renderPanel();
    await screen.findByText('目前沒有 log');

    const select = screen.getByLabelText('每頁筆數') as HTMLSelectElement;
    await act(async () => {
      select.value = 'infinite';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(getAuditCalls()).toHaveLength(2));
    await screen.findByText('已隱藏 100 筆稽核查詢');
    const before = getAuditCalls().length;

    await act(async () => emitIntersection(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getAuditCalls()).toHaveLength(before);

    fireEvent.click(screen.getByRole('button', { name: '加載更多' }));
    await waitFor(() => expect(getAuditCalls()).toHaveLength(before + 1));
    await waitFor(() => expect(getAllTags('送出').length).toBeGreaterThan(0));
  });

  it('無限模式累計 500 筆後停止並提示縮小區間', async () => {
    auditLogs = Array.from({ length: 600 }, (_, index) =>
      makeFakeLog(NOW_MS - index * 1_000, {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: `c${index}`,
      }),
    );
    renderPanel();
    await waitFor(() => expect(getAuditCalls()).toHaveLength(1));

    const select = screen.getByLabelText('每頁筆數') as HTMLSelectElement;
    await act(async () => {
      select.value = 'infinite';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(getAuditCalls()).toHaveLength(2));
    await waitFor(() => expect(getAllTags('送出')).toHaveLength(100));

    for (let i = 0; i < 4; i += 1) {
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: '加載更多' }) as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
      });
      fireEvent.click(screen.getByRole('button', { name: '加載更多' }));
      await waitFor(() => expect(getAuditCalls()).toHaveLength(3 + i));
    }

    await screen.findByText('超過 500 筆，請縮小區間');
    expect(getAuditCalls()).toHaveLength(6);
    expect(screen.queryByRole('button', { name: '加載更多' })).toBeNull();
  });

  it('第二頁請求失敗仍停在第 1 頁、不顯示空頁；之後成功才到第 2 頁', async () => {
    auditLogs = Array.from({ length: 15 }, (_, index) =>
      makeFakeLog(NOW_MS - index * 60_000, {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: `c${index}`,
      }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText('第 1 頁')).toBeTruthy());
    expect(getAuditCalls()).toHaveLength(1);

    failNextLogsRequest = true;
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    await waitFor(() => expect(getAuditCalls()).toHaveLength(2));
    await waitFor(() => {
      const nextBtn = screen.getByRole('button', { name: '下一頁' }) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(false);
    });
    expect(screen.getByText('第 1 頁')).toBeTruthy();
    expect(screen.queryByText('第 2 頁')).toBeNull();
    expect(screen.queryByText('目前沒有 log')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    await waitFor(() => expect(screen.getByText('第 2 頁')).toBeTruthy());
    expect(getAuditCalls()).toHaveLength(3);
  });

  it('時間顯示為台北 24 小時制', async () => {
    auditLogs = [
      makeFakeLog(Date.parse('2026-11-16T12:31:00.000Z'), {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: 'c1',
      }),
    ];
    renderPanel();
    // 2026-11-16 是週一（本週起點），這筆在本週內。
    await screen.findByText('11/16 20:31');
  });

  it('點列開對話只呼叫一次，標題與訊息標記正確，且不重載 log', async () => {
    auditLogs = [
      makeFakeLog(NOW_MS, {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: 'c1',
      }),
    ];
    conversationResponse = {
      thread: {
        participants: [UID_A, UID_B],
        participantNames: { [UID_A]: '王小明', [UID_B]: '陳大華' },
      },
      messages: [
        { id: 'm1', fromUid: UID_A, senderName: '王小明', createdAt: NOW_MS - 1_000, body: '哈囉' },
        { id: 'm2', fromUid: UID_B, senderName: '陳大華', createdAt: NOW_MS - 2_000, body: '掰掰', status: 'recalled' },
        { id: 'm3', fromUid: UID_A, senderName: '王小明', createdAt: NOW_MS - 3_000, body: '改過', status: 'edited' },
      ],
    };
    const resolveNames = vi.fn(async () => ({
      [UID_A]: '王小明',
      [UID_B]: '陳大華',
    }));
    renderPanel({ resolveNames });
    await screen.findByText('送出');
    const logCallsBefore = getAuditCalls().length;
    const row = document.querySelector('.pma-log') as HTMLElement;
    fireEvent.click(row);
    fireEvent.click(row);
    await waitFor(() => expect(callsOf('getPmAuditConversation')).toHaveLength(1));
    await screen.findByText('王小明 ↔ 陳大華');
    const sheet = screen.getByTestId('bottom-sheet');
    expect(within(sheet).getByText('哈囉')).toBeTruthy();
    expect(within(sheet).getByText('訊息已撤回')).toBeTruthy();
    expect(within(sheet).getByText('已編輯')).toBeTruthy();
    expect(within(sheet).getAllByText(shortUid(UID_A)).length).toBeGreaterThan(0);
    expect(getAuditCalls()).toHaveLength(logCallsBefore);
  });

  it('對話 not-found 顯示「已超過保存期限」', async () => {
    auditLogs = [
      makeFakeLog(NOW_MS, {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: 'c1',
      }),
    ];
    conversationError = new CallableError('functions/not-found', 'x');
    renderPanel();
    await screen.findByText('送出');
    fireEvent.click(document.querySelector('.pma-log') as HTMLElement);
    await screen.findByText('已超過保存期限');
    expect(screen.queryByText('載入對話內容失敗')).toBeNull();
  });

  it('對話其他錯誤顯示「載入對話內容失敗」', async () => {
    auditLogs = [
      makeFakeLog(NOW_MS, {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: 'c1',
      }),
    ];
    conversationError = new Error('boom');
    renderPanel();
    await screen.findByText('送出');
    fireEvent.click(document.querySelector('.pma-log') as HTMLElement);
    await screen.findByText('載入對話內容失敗');
    expect(screen.queryByText('已超過保存期限')).toBeNull();
  });

  it('複製 UID 以完整 UID 呼叫並 toast，不把 UID 印到 console', async () => {
    auditLogs = [
      makeFakeLog(NOW_MS, {
        action: 'send',
        actorUid: UID_A,
        targetUid: UID_B,
        conversationId: 'c1',
      }),
    ];
    conversationResponse = {
      thread: {
        participants: [UID_A, UID_B],
        participantNames: { [UID_A]: '王小明', [UID_B]: '陳大華' },
      },
      messages: [],
    };
    const resolveNames = vi.fn(async () => ({
      [UID_A]: '王小明',
      [UID_B]: '陳大華',
    }));
    renderPanel({ resolveNames });
    await screen.findByText('送出');
    fireEvent.click(document.querySelector('.pma-log') as HTMLElement);
    const sheet = await screen.findByTestId('bottom-sheet');
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ];
    const copyBtn = within(sheet).getAllByRole('button', { name: '複製 UID' })[0]!;
    fireEvent.click(copyBtn);
    await waitFor(() => expect(mocks.mockCopyDiagnostic).toHaveBeenCalledWith(UID_A));
    await waitFor(() => expect(mocks.mockToastShow).toHaveBeenCalledWith({ message: '已複製 UID', tone: 'success' }));
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(UID_A);
      }
      spy.mockRestore();
    }
    expect(document.body.textContent).not.toContain(UID_A);
  });

  it('找人空字串送出 toast warning 且不呼叫搜尋', async () => {
    renderPanel();
    await screen.findByText('目前沒有 log');
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(mocks.mockToastShow).toHaveBeenCalledWith({ message: '請輸入暱稱或識別碼', tone: 'warning' }));
    expect(callsOf('searchPmAuditUsers')).toHaveLength(0);
  });

  it('找人：搜尋、點人載入對話列表、點對話開抽屜；缺暱稱以 UID 短碼呈現且不露完整 UID', async () => {
    searchUsersResponse = [{ uid: UID_A, name: '王小明', pictureUrl: '', role: 'user' }];
    listThreadsResponse = [
      {
        conversationId: 'c1',
        participants: [UID_A, UID_C],
        participantNames: { [UID_A]: '王小明' },
        lastMessageBody: '嗨',
        lastMessageAt: NOW_MS,
      },
    ];
    conversationResponse = {
      thread: {
        participants: [UID_A, UID_C],
        participantNames: { [UID_A]: '王小明' },
      },
      messages: [],
    };
    renderPanel();
    await screen.findByText('目前沒有 log');

    const input = document.getElementById('pm-audit-user-query') as HTMLInputElement;
    await act(async () => {
      input.value = '王';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(callsOf('searchPmAuditUsers')).toHaveLength(1));
    expect(callsOf('searchPmAuditUsers')[0]).toEqual({ query: '王' });
    await screen.findByText('王小明');

    fireEvent.click(screen.getByRole('button', { name: /王小明/ }));
    await waitFor(() => expect(callsOf('listPmAuditThreads')).toHaveLength(1));
    expect(callsOf('listPmAuditThreads')[0]).toEqual({ uid: UID_A });

    const threadTitle = `王小明 / ${shortUid(UID_C)}`;
    await screen.findByText(threadTitle);
    expect(document.body.textContent).not.toContain(UID_C);
    expect(document.body.textContent).not.toContain(UID_A);

    fireEvent.click(screen.getByText(threadTitle).closest('button')!);
    await waitFor(() => expect(callsOf('getPmAuditConversation')).toHaveLength(1));
    expect(callsOf('getPmAuditConversation')[0]).toEqual({ conversationId: 'c1', limit: 100 });
    await screen.findByTestId('bottom-sheet');
  });
});
