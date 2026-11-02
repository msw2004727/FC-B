// 聊天室稽核頁籤（W2A-5）：全走既有 Callable、前端 Firestore 讀取 0；說明小字拿掉；搜尋 → 對話列表 → 對話內容 → Log。
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  callFn.mockReset();
  callFn.mockImplementation(async (name: string, req: Record<string, unknown>) => respond(name, req));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PmAuditPanel', () => {
  it('進頁籤：讀設定與 Log（Callable），Firestore 0 讀；設定卡沒有說明段落', async () => {
    const { container } = render(<PmAuditPanel />);
    await waitFor(() => expect(document.getElementById('pm-audit-settings-status')?.textContent).toBe('已關閉：僅管理員、向上層級或既有對話可私訊。'));
    expect(callsOf('getPrivateMessageSettings')).toHaveLength(1);
    expect(callsOf('getPmAuditLogs')).toEqual([{ action: '', limit: 50 }]);
    expect(firestoreTouched).not.toHaveBeenCalled();
    expect(container.querySelector('.pm-audit-setting-copy p')).toBeNull();
    expect(container.textContent).not.toContain('開啟後所有已登入');
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
