import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { h, actor, user, fixture, renderPage, openGrants, search, choose, input, toggle, confirm, settled } from './grants-page-test-fixtures';
import RolesAdminPage from './RolesAdminPage';
import { GrantsTab } from '../components/GrantsTab';
import { rolesFixture } from '../data/role-test-fixtures';
import type { UserGrantSnapshot } from '../data/user-grant-model';

describe('個別授權非同步回歸', () => {
  it('P11 搜尋載入失敗可重試，不反覆自動載入', async () => {
    h.users.mockRejectedValueOnce(new Error('synthetic-search'));
    renderPage(); await openGrants(); search();
    await screen.findByRole('alert'); expect(h.users).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '重試' })); await choose();
    expect(h.users).toHaveBeenCalledTimes(2);
  });
  it('P12 讀取失敗不當成新文件，重試成功才提供開關', async () => {
    h.read.mockRejectedValueOnce(new Error('synthetic-read'));
    renderPage(); await openGrants(); search();
    fireEvent.click(await screen.findByRole('button', { name: /合成用戶/ }));
    await screen.findByText('個別授權讀取失敗');
    expect(document.querySelector('#user-permission-grant-editor input')).toBeNull();
    expect(h.permission).not.toHaveBeenCalled(); expect(h.enabled).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await waitFor(() => expect(input('enabled').checked).toBe(true)); expect(h.read).toHaveBeenCalledTimes(2);
  });
  it('P13 快速選不同用戶，丟棄先選用戶的晚到結果', async () => {
    h.users.mockResolvedValue({ users: [user(), user('test-second', '合成第二')], done: true, partial: false, total: 2, lastId: 'test-second' });
    let finish!: (value: UserGrantSnapshot) => void;
    h.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage(); await openGrants(); search();
    fireEvent.click(await screen.findByRole('button', { name: /合成用戶/ }));
    await choose('合成第二');
    const old = fixture(); old.document!['enabled'] = false;
    await act(async () => finish(old));
    expect(document.querySelector('#user-permission-grant-editor')?.textContent).toContain('合成第二');
    expect(input('enabled').checked).toBe(true);
  });
  it('P14 換帳號後晚到寫入不得污染新頁面', async () => {
    let finish!: (value: { document: Record<string, unknown>; refreshFailed: boolean }) => void;
    h.permission.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderPage(); await openGrants(); search(); await choose(); toggle(); await confirm();
    const after = h.permission.mock.calls[0]?.[1].after;
    h.viewer = actor('super_admin', 'other-test'); h.knownUid = 'other-test';
    view.rerender(<RolesAdminPage />); await openGrants(); search(); await choose();
    await act(async () => finish({ document: after, refreshFailed: false }));
    expect(input().checked).toBe(false);
    expect(h.toast).not.toHaveBeenCalledWith(expect.objectContaining({ message: '個別授權已更新' }));
  });
  it('P15 降為 admin 後晚到載入不顯示；舊搜尋結果不留存', async () => {
    let finish!: (value: UserGrantSnapshot) => void;
    h.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderPage(); await openGrants(); search();
    fireEvent.click(await screen.findByRole('button', { name: /合成用戶/ }));
    h.viewer = actor('admin'); view.rerender(<RolesAdminPage />);
    await act(async () => finish(fixture()));
    expect(screen.getByRole('alert').textContent).toContain('權限不足');
    expect(document.querySelector('#user-permission-grant-editor')).toBeNull();
  });
  it('P16 已提交但重讀失敗保留新值並停寫', async () => {
    h.permission.mockImplementationOnce(async (_original, preview) => ({ document: preview.after, refreshFailed: true }));
    renderPage(); await openGrants(); search(); await choose(); toggle(); await confirm(); await settled();
    expect(input().checked).toBe(true); expect(input().disabled).toBe(true);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('已儲存') }));
  });
  it('P18 離頁後晚到寫入成功不發 toast', async () => {
    let finish!: (value: { document: Record<string, unknown>; refreshFailed: boolean }) => void;
    h.permission.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderPage(); await openGrants(); search(); await choose(); toggle(); await confirm();
    const after = h.permission.mock.calls[0]?.[1].after; view.unmount();
    await act(async () => finish({ document: after, refreshFailed: false }));
    expect(h.toast).not.toHaveBeenCalledWith(expect.objectContaining({ message: '個別授權已更新' }));
  });
  it('P19 隔離父頁重掛載後，寫入結果仍由 UID 比對拒收', async () => {
    let finish!: (value: { document: Record<string, unknown>; refreshFailed: boolean }) => void;
    h.permission.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const data = rolesFixture();
    const view = render(<GrantsTab active data={data} confirmEnabled />);
    search(); await choose(); toggle(); await confirm();
    h.viewer = actor('super_admin', 'other-test'); h.knownUid = 'other-test';
    view.rerender(<GrantsTab active data={data} confirmEnabled />);
    await act(async () => finish({ document: { ...fixture().document, permissions: [], enabled: false }, refreshFailed: false }));
    expect(input('enabled').checked).toBe(true); expect(input('event.create').checked).toBe(true);
    expect(h.toast).not.toHaveBeenCalledWith(expect.objectContaining({ message: '個別授權已更新' }));
  });
  it('P20 隔離父頁後，預覽確認期間降權仍不寫入', async () => {
    const data = rolesFixture(); const view = render(<GrantsTab active data={data} confirmEnabled />);
    search(); await choose(); toggle();
    h.viewer = actor('admin'); view.rerender(<GrantsTab active data={data} confirmEnabled />);
    await confirm(); await settled(); expect(h.permission).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ message: '權限不足' }));
  });
  it.each(['event.publish', 'enabled'])('P22 %s 預覽確認需維持操作者身分一致', async code => {
    const data = rolesFixture(); const view = render(<GrantsTab active data={data} confirmEnabled />);
    search(); await choose(); toggle(code);
    await screen.findByRole('dialog', { name: '確認權限變更' });
    h.viewer = actor('super_admin', 'other-test'); h.knownUid = 'other-test';
    view.rerender(<GrantsTab active data={data} confirmEnabled />);
    expect(screen.getByRole('dialog', { name: '確認權限變更' })).toBeTruthy();
    await confirm(); await settled();
    expect(h.permission).not.toHaveBeenCalled(); expect(h.enabled).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ message: '權限不足', tone: 'error' }));
  });
  it('P21 隔離父頁後，載入結果仍由 UID 比對拒收', async () => {
    let finish!: (value: UserGrantSnapshot) => void;
    h.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const data = rolesFixture(); const view = render(<GrantsTab active data={data} confirmEnabled />);
    search(); fireEvent.click(await screen.findByRole('button', { name: /合成用戶/ }));
    h.viewer = actor('super_admin', 'other-test'); view.rerender(<GrantsTab active data={data} confirmEnabled />);
    await act(async () => finish(fixture()));
    expect(document.querySelector('#user-permission-grant-editor input')).toBeNull();
  });
  it('P17 離頁後丟棄尚未完成的用戶搜尋', async () => {
    let finish!: (value: unknown) => void;
    h.users.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderPage(); await openGrants(); search();
    await waitFor(() => expect(h.users).toHaveBeenCalledOnce()); view.unmount();
    await act(async () => finish({ users: [user()], done: true, partial: false, total: 1, lastId: 'test-target' }));
    expect(document.querySelector('#user-permission-grant-results')).toBeNull(); expect(h.read).not.toHaveBeenCalled();
  });
});
