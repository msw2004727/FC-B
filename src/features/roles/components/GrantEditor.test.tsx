import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserPermissionGrantAllowedCodes } from '@/features/profile/data/permissions';
import type { UserGrantSnapshot } from '../data/user-grant-model';
import { GrantEditor } from './GrantEditor';

vi.mock('@/features/profile/data/permissions', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/profile/data/permissions')>();
  return { ...actual, getUserPermissionGrantAllowedCodes: vi.fn() };
});
vi.mock('@/i18n/i18n', () => ({ useT: () => (key: string) => key }));
beforeEach(() => {
  vi.mocked(getUserPermissionGrantAllowedCodes).mockReturnValue(['activity.manage.entry', 'event.create']);
});
afterEach(cleanup);
const snapshot = (permissions: string[]): UserGrantSnapshot => ({ uid: 'test-target', targetName: '合成用戶',
  document: { uid: 'test-target', permissions, enabled: true } });
function checkbox(code: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[aria-label$="(' + code + ')"]');
}

describe('個別授權項目呈現', () => {
  it('P23 權限調整僅提供允許清單內的開關', () => {
    vi.mocked(getUserPermissionGrantAllowedCodes).mockReturnValue(['event.create']);
    render(<GrantEditor snapshot={snapshot([])} busy={false} onAction={vi.fn()} onInfo={vi.fn()}
      catalog={[{ cat: '合成分類', items: [{ code: 'admin.roles.entry', name: '合成入口' }] }]} />);
    expect(checkbox('event.create')).not.toBeNull();
    expect(checkbox('event.publish')).toBeNull();
    expect(checkbox('activity.manage.entry')).toBeNull();
    expect(checkbox('admin.roles.entry')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });
  it.each([
    { selected: 'event.create', hidden: 'activity.manage.entry' },
    { selected: 'activity.manage.entry', hidden: 'event.create' },
  ])('P24 僅顯示已勾選項目時保留 $selected', ({ selected, hidden }) => {
    render(<GrantEditor snapshot={snapshot([selected])} catalog={[]} busy={false} onAction={vi.fn()} onInfo={vi.fn()} />);
    expect(checkbox(selected)?.checked).toBe(true); expect(checkbox(hidden)?.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'roles.ui.checkedOnly' }));
    expect(checkbox(selected)?.checked).toBe(true); expect(checkbox(hidden)).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'roles.ui.showAll' }));
    expect(checkbox(hidden)?.checked).toBe(false);
  });
});
