import { act, fireEvent, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { h, user, renderPage, openGrants, search, choose, toggle, dialog, confirm, settled } from './grants-page-test-fixtures';

describe('個別授權搜尋與確認狀態', () => {
  it('P26 關鍵字變更後從前 30 筆重新顯示', async () => {
    const users = Array.from({ length: 61 }, (_, i) => user('test-' + i, '合成用戶' + String(i).padStart(2, '0')));
    h.users.mockResolvedValue({ users, total: 61, lastId: 'test-60', done: true, partial: false });
    renderPage(); await openGrants(); search('合成');
    await screen.findByRole('button', { name: /合成用戶00/ });
    const rows = () => document.querySelectorAll('#user-permission-grant-results .permission-audit-issue');
    expect(rows()).toHaveLength(30);
    fireEvent.click(screen.getByRole('button', { name: '載入更多用戶' }));
    expect(rows()).toHaveLength(60);
    expect(screen.getByRole('button', { name: /合成用戶59/ })).toBeTruthy();
    search('用戶');
    await waitFor(() => expect(rows()).toHaveLength(30));
    expect([...rows()].map(row => row.querySelector('.permission-audit-issue-title')?.textContent))
      .toEqual(users.slice(0, 30).map(user => user.name));
    expect(screen.queryByRole('button', { name: /合成用戶30/ })).toBeNull();
    expect(screen.getByRole('button', { name: '載入更多用戶' })).toBeTruthy();
    expect(h.users).toHaveBeenCalledOnce(); expect(h.more).not.toHaveBeenCalled();
  });
  it('P27 待確認與寫入期間用戶選擇按鈕停用，完成後恢復', async () => {
    h.users.mockResolvedValue({ users: [user(), user('test-second', '合成第二')], total: 2,
      lastId: 'test-second', done: true, partial: false });
    let finish!: (value: { document: Record<string, unknown>; refreshFailed: boolean }) => void;
    h.permission.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage(); await openGrants(); search(); await choose();
    const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('#user-permission-grant-results .permission-audit-issue')];
    expect(buttons()).toHaveLength(2); expect(buttons().every(button => !button.disabled)).toBe(true);
    toggle(); await dialog();
    expect(buttons().every(button => button.disabled)).toBe(true); expect(h.permission).not.toHaveBeenCalled();
    await confirm(); await waitFor(() => expect(h.permission).toHaveBeenCalledOnce());
    try {
      expect(buttons().every(button => button.disabled)).toBe(true);
      expect(h.read).toHaveBeenCalledOnce();
    } finally {
      await act(async () => finish({ document: h.permission.mock.calls[0]?.[1].after, refreshFailed: false }));
    }
    await settled(); expect(buttons().every(button => !button.disabled)).toBe(true);
  });
});
