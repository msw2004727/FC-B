import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermInfoPopup } from './PermInfoPopup';
import { RoleDiffConfirm } from './RoleDiffConfirm';
import { prepareRoleChange } from '../data/role-model';
import { prepareUserGrantChange } from '../data/user-grant-model';
import { rolesFixture } from '../data/role-test-fixtures';
vi.mock('@/i18n/i18n', () => ({
  useT: () => (key: string) => key.endsWith('.body') ? '<img src=x onerror="window.__rolesInjected=true">'
    : key.endsWith('.title') ? '<svg onload="window.__rolesInjected=true">' : key,
}));
afterEach(cleanup);

describe('T-079a 說明／確認框文字節點', () => {
  it('M16 說明中惡意 HTML 只顯示文字，無 img/svg 節點', () => {
    const close = vi.fn();
    render(<PermInfoPopup code="event.create" onClose={close} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('<img src=x');
    expect(dialog.querySelector('img, svg')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(close).toHaveBeenCalledOnce();
  });
  it('C14 權限調整的新增與移除各自列出對應項目', () => {
    const data = rolesFixture();
    data.permissions = [{ cat: '合成分類', items: [
      { code: 'synthetic.next', name: 'synthetic.next' }, { code: 'synthetic.previous', name: 'synthetic.previous' },
    ] }];
    data.rolePermissions['coach'] = { permissions: ['synthetic.previous'], defaultPermissions: ['synthetic.next'] };
    const preview = prepareRoleChange(data, 'coach', { kind: 'restore-defaults' }, 'test-actor');
    expect(preview.added).toEqual(['synthetic.next']); expect(preview.removed).toEqual(['synthetic.previous']);
    render(<RoleDiffConfirm preview={preview} catalog={data.permissions} expanded busy={false} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const rows = [...dialog.querySelectorAll('p')];
    const added = rows.find(row => row.textContent?.startsWith('roles.ui.added：'));
    const removed = rows.find(row => row.textContent?.startsWith('roles.ui.removed：'));
    expect(added?.textContent).toBe('roles.ui.added：synthetic.next');
    expect(removed?.textContent).toBe('roles.ui.removed：synthetic.previous');
    expect(added).not.toBe(removed);
  });
  it('C15 新建個別授權的確認狀態標示原文件缺少', () => {
    const preview = prepareUserGrantChange({ uid: 'test-target', targetName: '合成用戶', document: null },
      { kind: 'update_enabled' }, 'test-actor');
    render(<RoleDiffConfirm preview={preview} catalog={[]} expanded busy={false} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('roles.ui.before：roles.ui.missing').tagName).toBe('P');
    expect(screen.getByRole('dialog').textContent).toContain('合成用戶');
  });
  it('C16 變更前的更新時間以可讀時間顯示，不外露原始時間戳結構', () => {
    const document = { uid: 'test-target', permissions: ['event.create'], enabled: true, updatedAt: { seconds: 1761800000, nanoseconds: 123000000 } };
    const preview = prepareUserGrantChange({ uid: 'test-target', targetName: '合成用戶', document },
      { kind: 'update_enabled' }, 'test-actor');
    render(<RoleDiffConfirm preview={preview} catalog={[]} expanded busy={false} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).toContain('2025');
    expect(text).not.toContain('nanoseconds');
  });
  it.each([true, false])('旗標 %s 仍顯示全部欄位與無預設，取消與確認分離', expanded => {
    const preview = prepareRoleChange(rolesFixture(), 'user', { kind: 'capability', code: 'user.activity.basic_create' }, 'test-actor');
    const confirm = vi.fn(); const cancel = vi.fn();
    render(<RoleDiffConfirm preview={preview} catalog={[]} expanded={expanded} busy={false} onCancel={cancel} onConfirm={confirm} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('roles.ui.noDefaults');
    expect(dialog.textContent).toContain('20260505a');
    expect(dialog.textContent).toContain('defaultCapabilities');
    expect(dialog.textContent).toContain('roles.ui.serverTime');
    expect(dialog.textContent).not.toContain('test-actor');
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'roles.ui.cancel' }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });
});
