import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { h, actor, user, fixture, renderPage, openGrants, search, choose, input, toggle, dialog, confirm, settled } from './grants-page-test-fixtures';
import { RoleAdminGuardError } from '../data/role-errors';
import type { UserGrantPreview, UserGrantSnapshot } from '../data/user-grant-model';

describe('T-079b 個別授權頁面', () => {
  it.each(['admin', 'captain', 'coach', 'venue_owner', 'user', 'guest'])('P01 %s 有所有碼仍拒絕，不載入', role => {
    h.viewer = actor(role); renderPage();
    expect(screen.getByRole('alert').textContent).toContain('權限不足');
    expect(h.roles).not.toHaveBeenCalled(); expect(h.users).not.toHaveBeenCalled(); expect(h.read).not.toHaveBeenCalled();
  });
  it('P02 延遲到頁籤與首字；暱稱／UID 搜尋、清空與切頁不重載', async () => {
    renderPage(); await screen.findByRole('button', { name: '個別授權' });
    expect(h.users).not.toHaveBeenCalled(); await openGrants(); expect(h.users).not.toHaveBeenCalled();
    search('合成'); await choose(); expect(h.users).toHaveBeenCalledOnce();
    expect(h.read).toHaveBeenCalledExactlyOnceWith('test-target', '合成用戶');
    search('test-target'); expect(screen.getByRole('button', { name: /合成用戶/ })).toBeTruthy();
    search('missing'); expect(screen.queryByRole('button', { name: /合成用戶/ })).toBeNull();
    search(''); expect(screen.queryByRole('button', { name: /合成用戶/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '權限設定' })); await openGrants(); search();
    expect(h.users).toHaveBeenCalledOnce();
  });
  it('P02b 非作用中頁籤即使有搜尋字也不載入', async () => {
    renderPage(); await screen.findByRole('button', { name: '個別授權' });
    const hiddenSearch = document.querySelector<HTMLInputElement>('#user-permission-grant-search')!;
    fireEvent.input(hiddenSearch, { target: { value: '合成' } });
    await act(async () => { await Promise.resolve(); });
    expect(h.users).not.toHaveBeenCalled();
    await openGrants(); await choose(); expect(h.users).toHaveBeenCalledOnce();
  });
  it('P03 M-142 每頁 30 筆，先顯示更多本地結果再讀下一批', async () => {
    const batch = { users: Array.from({ length: 31 }, (_, i) => user('test-' + i, '合成' + String(i).padStart(2, '0'))),
      total: 6000, lastId: 'test-30', done: false, partial: true };
    h.users.mockResolvedValue(batch); h.more.mockResolvedValue({ ...batch, done: true, partial: false });
    renderPage(); await openGrants(); search();
    await screen.findByRole('button', { name: /合成00/ });
    expect(document.querySelectorAll('#user-permission-grant-results .permission-audit-issue')).toHaveLength(30);
    fireEvent.click(screen.getByRole('button', { name: '載入更多用戶' }));
    expect(document.querySelectorAll('#user-permission-grant-results .permission-audit-issue')).toHaveLength(31);
    expect(h.more).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '載入更多用戶' }));
    await waitFor(() => expect(h.more).toHaveBeenCalledExactlyOnceWith(batch));
  });
  it.each([true, false])('P04 確認旗標 %s 都顯示完整文件，取消不寫', async flag => {
    renderPage(flag); await openGrants(); search(); await choose(); toggle();
    const modal = await dialog();
    expect(modal.querySelector(flag ? '.role-diff-expanded' : '.role-diff-compact')).not.toBeNull();
    expect(modal.querySelector(flag ? '.role-diff-compact' : '.role-diff-expanded')).toBeNull();
    expect(modal.textContent).toContain('oldField'); expect(modal.textContent).toContain('合成舊欄位');
    expect(modal.textContent).toContain('updatedAt'); expect(modal.textContent).toContain('變更前'); expect(modal.textContent).toContain('變更後');
    expect(h.permission).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole('button', { name: '取消' }));
    expect(input().checked).toBe(false); expect(h.permission).not.toHaveBeenCalled();
  });
  it.each(['toggle_permission', 'update_enabled'])('P05 S4 %s 第一參數為載入原始文件，成功套回傳值', async kind => {
    const loaded = fixture(); const original = structuredClone(loaded); h.read.mockResolvedValueOnce(loaded);
    renderPage(); await openGrants(); search(); await choose(); toggle(kind === 'update_enabled' ? 'enabled' : 'event.publish'); await confirm();
    const write = kind === 'update_enabled' ? h.enabled : h.permission;
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    const [received, preview, proof] = write.mock.calls[0] as [UserGrantSnapshot, UserGrantPreview, string];
    expect(received).toEqual(original); expect(loaded).toEqual(original);
    expect(received.document).toEqual(preview.before); expect(received.document).not.toEqual(preview.after);
    expect(preview.action.kind).toBe(kind); expect(proof).toBe(preview.fingerprint);
    expect(kind === 'update_enabled' ? h.permission : h.enabled).not.toHaveBeenCalled();
    await settled(); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ message: '個別授權已更新' }));
    expect(input(kind === 'update_enabled' ? 'enabled' : 'event.publish').checked).toBe(kind !== 'update_enabled');
  });
  it.each(['toggle_permission', 'update_enabled'])('P06 %s 失敗回復，重試成功', async kind => {
    const write = kind === 'update_enabled' ? h.enabled : h.permission;
    const code = kind === 'update_enabled' ? 'enabled' : 'event.publish';
    write.mockRejectedValueOnce(new Error('synthetic-write'));
    renderPage(); await openGrants(); search(); await choose(); toggle(code); await confirm(); await settled();
    expect(input(code).checked).toBe(kind === 'update_enabled');
    toggle(code); await confirm(); await settled();
    expect(write).toHaveBeenCalledTimes(2); expect(write.mock.calls[1]?.[0]).toEqual(fixture());
    expect(input(code).checked).toBe(kind !== 'update_enabled');
  });
  it('P07 Q5 停用切碼禁用及提示，獨立啟用不改碼', async () => {
    const loaded = fixture(); loaded.document!['enabled'] = false; h.read.mockResolvedValueOnce(loaded);
    renderPage(); await openGrants(); search(); await choose();
    expect(screen.getByText('請先啟用此授權')).toBeTruthy(); expect(input().disabled).toBe(true);
    toggle(); expect(screen.queryByRole('dialog')).toBeNull(); expect(h.permission).not.toHaveBeenCalled();
    expect(input('enabled').disabled).toBe(false); toggle('enabled'); await confirm(); await settled();
    expect(h.enabled.mock.calls[0]?.[1].payload).toMatchObject({ permissions: ['event.create'], enabled: true });
    expect(h.permission).not.toHaveBeenCalled(); expect(input().disabled).toBe(false);
  });
  it('P08 stale 後停寫，重新選取才可讀新快照', async () => {
    h.permission.mockRejectedValueOnce(new RoleAdminGuardError('stale-document'));
    renderPage(); await openGrants(); search(); await choose(); toggle(); await confirm(); await settled();
    expect(input().checked).toBe(false); expect(input().disabled).toBe(true); expect(input('enabled').disabled).toBe(true);
    toggle(); expect(screen.queryByRole('dialog')).toBeNull(); expect(h.permission).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert').textContent).toContain('重新');
    await choose(); expect(h.read).toHaveBeenCalledTimes(2); expect(input().disabled).toBe(false);
  });
  it('P09 只顯示已有權限與同一說明彈窗，名稱以文字節點呈現', async () => {
    const name = '<img src=x onerror=alert(1)>合成';
    h.users.mockResolvedValue({ users: [user('test-target', name)], done: true, partial: false, total: 1, lastId: 'test-target' });
    renderPage(); await openGrants(); search(); await choose('合成');
    expect(document.querySelector('#user-permission-grant-editor img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '只顯示已有權限' }));
    expect(document.querySelector('#user-permission-grant-editor input[aria-label$="(event.publish)"]')).toBeNull();
    expect(input('event.create').checked).toBe(true);
    const info = document.querySelector<HTMLButtonElement>('#user-permission-grant-editor .perm-item .perm-info-btn')!;
    fireEvent.click(info); expect((await screen.findByRole('dialog')).textContent).toContain('建立活動');
    expect(h.permission).not.toHaveBeenCalled(); expect(h.enabled).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '了解' }));
    fireEvent.click(screen.getByRole('button', { name: '顯示全部權限' })); expect(input()).toBeTruthy();
  });
  it('P10 連點確認只寫一次', async () => {
    let finish!: (value: { document: Record<string, unknown>; refreshFailed: boolean }) => void;
    h.permission.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage(); await openGrants(); search(); await choose(); toggle();
    const button = within(await dialog()).getByRole('button', { name: '確定' });
    act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(h.permission).toHaveBeenCalledOnce(); expect(input().checked).toBe(true);
    await act(async () => finish({ document: h.permission.mock.calls[0]?.[1].after, refreshFailed: false })); await settled();
  });
});
