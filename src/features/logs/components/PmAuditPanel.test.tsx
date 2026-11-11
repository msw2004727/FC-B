// 聊天室稽核頁籤（W2A-5）：全走既有 Callable、前端 Firestore 讀取 0；設定卡說明照 A；搜尋 → 對話列表 → 對話內容 → Log。
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';

import { toast } from '@/ui/Toast';

import { PmAuditPanel } from './PmAuditPanel';

const callFn = vi.hoisted(() => vi.fn());
const firestoreTouched = vi.hoisted(() => vi.fn());

vi.mock('@/data/callables', () => ({ callFn }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('firebase/firestore', () => new Proxy({}, {
  get: (_target, prop) => {
    firestoreTouched(prop);
    return () => {
      throw new Error(`Firestore 不應被呼叫：${String(prop)}`);
    };
  },
}));

function respond(name: string, req: Record<string, unknown>): unknown {
  switch (name) {
    case 'getPrivateMessageSettings':
      return { ok: true, settings: { allowUserToUserPm: false } };
    case 'updatePrivateMessageSettings':
      return { ok: true, settings: { allowUserToUserPm: req['allowUserToUserPm'] === true } };
    case 'searchPmAuditUsers':
      return {
        ok: true,
        users: [
          { uid: 'Uaaaaaaaaaaaaaaaaaaaa1', name: '隊員甲', pictureUrl: 'javascript:alert(1)', role: 'user' },
          { uid: 'Ubbbbbbbbbbbbbbbbbbbb2', name: '教練丙', pictureUrl: 'https://example.com/a.png', role: 'coach' },
        ],
      };
    case 'listPmAuditThreads':
      return {
        ok: true,
        threads: [{
          id: 'c1',
          conversationId: 'c1',
          participants: ['Uaaaaaaaaaaaaaaaaaaaa1', 'Ubbbbbbbbbbbbbbbbbbbb2'],
          participantNames: { Uaaaaaaaaaaaaaaaaaaaa1: '隊員甲', Ubbbbbbbbbbbbbbbbbbbb2: '教練丙' },
          lastMessageBody: '週六幾點集合？',
          lastMessageAt: { _seconds: 1_762_090_680 },
        }],
      };
    case 'getPmAuditConversation':
      return {
        ok: true,
        messages: [
          { id: 'm1', senderName: '隊員甲', body: '<img src=x onerror=alert(1)>', createdAt: '2026-11-02T12:38:00Z' },
          { id: 'm2', senderName: '教練丙', body: '原文', status: 'recalled', createdAt: '2026-11-02T12:40:00Z' },
        ],
      };
    case 'getPmAuditLogs':
      return {
        ok: true,
        logs: [{ id: 'l1', action: 'send', actorUid: 'Uaaaaaaaaaaaaaaaaaaaa1', targetUid: 'Ubbbbbbbbbbbbbbbbbbbb2', createdAtIso: '2026-11-02T12:38:00Z' }],
        nextCursor: req['cursorCreatedAtMs'] ? null : { createdAtMs: 1_762_090_680_000 },
        hasMore: !req['cursorCreatedAtMs'],
      };
    default:
      throw new Error(`unexpected ${name}`);
  }
}

function callsOf(name: string): Record<string, unknown>[] {
  return callFn.mock.calls.filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>);
}

// 載入真正的繁中字典（照 ActivitiesPage.test）。
beforeAll(async () => {
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

beforeEach(() => {
  callFn.mockReset();
  callFn.mockImplementation(async (name: string, req: Record<string, unknown>) => respond(name, req));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PmAuditPanel', () => {
  it('進頁籤：讀設定與 Log（Callable），Firestore 0 讀；設定卡說明段落逐字照 A', async () => {
    const { container } = render(<PmAuditPanel />);
    await waitFor(() => expect(document.getElementById('pm-audit-settings-status')?.textContent).toBe('已關閉：僅管理員、向上層級或既有對話可私訊。'));
    expect(callsOf('getPrivateMessageSettings')).toHaveLength(1);
    expect(callsOf('getPmAuditLogs')).toEqual([{ action: '', limit: 50 }]);
    expect(firestoreTouched).not.toHaveBeenCalled();
    // 測試同步更新：照 A 恢復設定卡說明（Q11 拿掉說明只針對小遊戲與頭像檢測）。
    expect(container.querySelector('.pm-audit-setting-copy p')?.textContent).toBe('開啟後所有已登入且未受限角色可彼此開新私訊；關閉時僅管理員、向上層級或既有對話可私訊。');
    await waitFor(() => expect(container.querySelector('.pm-audit-log strong')?.textContent).toBe('send'));
    expect(container.querySelector('.pm-audit-log span')?.textContent).toBe('Uaaaaa...aaa1 -> Ubbbbb...bbb2');
  });

  it('開關：送出設定並以 settings_update 重新查 Log', async () => {
    render(<PmAuditPanel />);
    const toggle = document.getElementById('pm-user-pm-toggle') as HTMLInputElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));
    await act(async () => {
      toggle.checked = true;
      fireEvent.change(toggle);
    });
    await waitFor(() => expect(document.getElementById('pm-audit-settings-status')?.textContent).toBe('已開啟：所有角色都可以互相建立新私訊。'));
    expect(callsOf('updatePrivateMessageSettings')).toEqual([{ allowUserToUserPm: true }]);
    await waitFor(() => expect(callsOf('getPmAuditLogs').at(-1)).toEqual({ action: 'settings_update', limit: 50 }));
    expect(toast.show).toHaveBeenCalledWith({ message: '私訊設定已更新', tone: 'success' });
  });

  it('搜尋 → 對話列表 → 對話內容；不可信內容只當文字，頭像只收 https', async () => {
    const { container } = render(<PmAuditPanel />);
    const input = document.getElementById('pm-audit-user-query') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    expect(toast.show).toHaveBeenCalledWith({ message: '請輸入暱稱或識別碼', tone: 'warning' });
    expect(callsOf('searchPmAuditUsers')).toHaveLength(0);

    await act(async () => {
      input.value = '示意';
      fireEvent.input(input);
    });
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    await waitFor(() => expect(container.querySelectorAll('.pm-audit-user')).toHaveLength(2));
    expect(callsOf('searchPmAuditUsers')).toEqual([{ query: '示意' }]);
    const imgs = Array.from(container.querySelectorAll('.pm-audit-user img'));
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual(['https://example.com/a.png']);

    fireEvent.click(container.querySelectorAll<HTMLElement>('.pm-audit-user')[0]!);
    await waitFor(() => expect(container.querySelector('.pm-audit-thread strong')?.textContent).toBe('隊員甲 / 教練丙'));
    expect(callsOf('listPmAuditThreads')).toEqual([{ uid: 'Uaaaaaaaaaaaaaaaaaaaa1' }]);
    expect(container.querySelector('.pm-audit-thread small')?.textContent).not.toBe('');

    fireEvent.click(container.querySelector<HTMLElement>('.pm-audit-thread')!);
    await waitFor(() => expect(container.querySelectorAll('.pm-audit-message')).toHaveLength(2));
    expect(callsOf('getPmAuditConversation')).toEqual([{ conversationId: 'c1', limit: 100 }]);
    const bodies = Array.from(container.querySelectorAll('.pm-audit-message p')).map((p) => p.textContent);
    expect(bodies).toEqual(['<img src=x onerror=alert(1)>', '訊息已撤回']);
    expect(container.querySelector('.pm-audit-message img')).toBeNull();
    await waitFor(() => expect(callsOf('getPmAuditLogs').at(-1)).toEqual({ action: 'audit_view_conversation', limit: 50 }));
    expect(firestoreTouched).not.toHaveBeenCalled();
  });

  it('Log 加載更多：帶 cursorCreatedAtMs，最後顯示沒有更多', async () => {
    const { container } = render(<PmAuditPanel />);
    const more = await screen.findByRole('button', { name: '加載更多' });
    fireEvent.click(more);
    await waitFor(() => expect(container.querySelector('.pm-audit-log-end')?.textContent).toBe('沒有更多 log'));
    expect(callsOf('getPmAuditLogs').at(-1)).toEqual({ action: '', limit: 50, cursorCreatedAtMs: 1_762_090_680_000 });
    expect(container.querySelectorAll('.pm-audit-log')).toHaveLength(2);
  });

  it('四段載入中有圈與骨架和既有文字，完成後換成內容，失敗沿用既有失敗文字', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    type Waiter = { resolve: () => void; reject: (error: unknown) => void };
    const waiters: Record<string, Waiter[]> = {};
    const take = (name: string): Waiter => {
      const waiter = waiters[name]?.shift();
      if (!waiter) throw new Error(`missing ${name}`);
      return waiter;
    };
    callFn.mockImplementation((name: string, req: Record<string, unknown>) => new Promise((resolve, reject) => {
      (waiters[name] ??= []).push({
        resolve: () => resolve(respond(name, req)),
        reject,
      });
    }));
    render(<PmAuditPanel />);
    const logsBox = document.getElementById('pm-audit-logs')!;
    const usersBox = document.getElementById('pm-audit-users')!;
    const threadsBox = document.getElementById('pm-audit-threads')!;
    const convo = document.getElementById('pm-audit-conversation')!;
    const expectLoading = (box: HTMLElement, text: string): void => {
      const status = box.querySelector('.reg-loading');
      expect(status?.getAttribute('role')).toBe('status');
      expect(status?.getAttribute('aria-busy')).toBeNull();
      expect(status?.textContent).toBe(text);
      expect(box.querySelectorAll('.reg-loading-skeleton-row')).toHaveLength(3);
    };

    expectLoading(logsBox, '載入中...');
    await act(async () => {
      take('getPrivateMessageSettings').resolve();
      take('getPmAuditLogs').resolve();
    });
    await waitFor(() => expect(logsBox.querySelector('.pm-audit-log strong')?.textContent).toBe('send'));
    expect(logsBox.querySelector('.reg-loading')).toBeNull();

    const input = document.getElementById('pm-audit-user-query') as HTMLInputElement;
    await act(async () => {
      input.value = '示意';
      fireEvent.input(input);
    });
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    expectLoading(usersBox, '搜尋中...');
    await act(async () => { take('searchPmAuditUsers').resolve(); });
    await waitFor(() => expect(usersBox.querySelectorAll('.pm-audit-user')).toHaveLength(2));
    expect(usersBox.querySelector('.reg-loading')).toBeNull();

    fireEvent.click(usersBox.querySelectorAll<HTMLElement>('.pm-audit-user')[0]!);
    expectLoading(threadsBox, '載入中...');
    await act(async () => { take('listPmAuditThreads').resolve(); });
    await waitFor(() => expect(threadsBox.querySelector('.pm-audit-thread strong')?.textContent).toBe('隊員甲 / 教練丙'));
    expect(threadsBox.querySelector('.reg-loading')).toBeNull();

    fireEvent.click(threadsBox.querySelector<HTMLElement>('.pm-audit-thread')!);
    expectLoading(convo, '載入中...');
    await act(async () => { take('getPmAuditConversation').resolve(); });
    await waitFor(() => expect(convo.querySelectorAll('.pm-audit-message')).toHaveLength(2));
    expect(convo.querySelector('.reg-loading')).toBeNull();
    await waitFor(() => expect(logsBox.querySelector('.reg-loading')?.textContent).toBe('載入中...'));
    await act(async () => { take('getPmAuditLogs').resolve(); });
    await waitFor(() => expect(logsBox.querySelector('.pm-audit-log strong')?.textContent).toBe('send'));

    fireEvent.click(threadsBox.querySelector<HTMLElement>('.pm-audit-thread')!);
    expectLoading(convo, '載入中...');
    await act(async () => { take('getPmAuditConversation').reject(new Error('convo')); });
    await waitFor(() => expect(convo.textContent).toContain('載入對話內容失敗'));
    expect(convo.querySelector('.reg-loading')).toBeNull();

    fireEvent.click(usersBox.querySelectorAll<HTMLElement>('.pm-audit-user')[0]!);
    expectLoading(threadsBox, '載入中...');
    await act(async () => { take('listPmAuditThreads').reject(new Error('threads')); });
    await waitFor(() => expect(threadsBox.textContent).toContain('載入對話列表失敗'));
    expect(threadsBox.querySelector('.reg-loading')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    expectLoading(usersBox, '搜尋中...');
    await act(async () => { take('searchPmAuditUsers').reject(new Error('search')); });
    await waitFor(() => expect(usersBox.textContent).toContain('搜尋失敗'));
    expect(usersBox.querySelector('.reg-loading')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
    expectLoading(logsBox, '載入中...');
    await act(async () => { take('getPmAuditLogs').reject(new Error('logs')); });
    await waitFor(() => expect(logsBox.textContent).toContain('載入 log 失敗'));
    expect(logsBox.querySelector('.reg-loading')).toBeNull();
  });

  it('設定讀取失敗：顯示失敗狀態', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    callFn.mockImplementation(async (name: string, req: Record<string, unknown>) => {
      if (name === 'getPrivateMessageSettings') throw new Error('permission-denied');
      return respond(name, req);
    });
    render(<PmAuditPanel />);
    await waitFor(() => expect(document.getElementById('pm-audit-settings-status')?.textContent).toBe('設定載入失敗'));
  });
});
