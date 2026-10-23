/**
 * 驗證 A team-detail.js:1362-1434 職務確認框 DOM 與文案。
 * 覆蓋 B 的 JSX 安全輸出、獨立 ID、busy、返回鍵與焦點生命週期。
 * 不進行角色寫入、members 重算或剔除；動作層另測 best-effort 與備註硬上限。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TeamRoleConfirmDialog } from './TeamRoleConfirmDialog';
import type { TeamRoleConfirmDialogProps } from './TeamRoleConfirmDialog';

const mocks = vi.hoisted(() => ({
  pushOverlay: vi.fn(),
  releaseBack: vi.fn(),
  lockBody: vi.fn(),
  unlock: vi.fn(),
}));

vi.mock('@/core/overlay-back', () => ({ pushOverlay: mocks.pushOverlay }));
vi.mock('@/ui/Modal', () => ({ lockBody: mocks.lockBody }));

function makeProps(
  overrides: Partial<TeamRoleConfirmDialogProps> = {},
): TeamRoleConfirmDialogProps {
  return {
    memberName: '王小明',
    currentRole: 'coach',
    target: { key: 'leader', level: 2, direction: 'promote' },
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`找不到 ${selector}`);
  return found;
}

function backHandler(): () => boolean {
  const handler: unknown = mocks.pushOverlay.mock.calls[0]?.[0];
  if (typeof handler !== 'function') throw new Error('未註冊返回鍵');
  return handler as () => boolean;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pushOverlay.mockReturnValue(mocks.releaseBack);
  mocks.lockBody.mockReturnValue(mocks.unlock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('職務確認對話框', () => {
  it('晉升 DOM、portal、class、無障礙名稱與文案逐項符合 A', () => {
    const { container } = render(<TeamRoleConfirmDialog {...makeProps()} />);
    const overlay = element('#team-role-confirm-modal');
    const dialog = screen.getByRole('dialog', { name: '俱樂部成員層級調整' });

    expect(container.childElementCount).toBe(0);
    expect(overlay.parentElement?.className).toBe('legacy-ui');
    expect(overlay.parentElement?.parentElement).toBe(document.body);
    expect(overlay.className).toBe('app-confirm-overlay open td-role-confirm-open');
    expect(document.getElementById('app-confirm-modal')).toBeNull();
    expect(dialog.className).toBe('app-confirm-box td-role-confirm-box');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(element('.app-confirm-msg > .td-role-confirm-card')).toBeTruthy();
    expect(element('.td-role-confirm-heading > .td-role-confirm-kicker').textContent)
      .toBe('俱樂部成員層級調整');
    expect(element('.td-role-confirm-action').className)
      .toBe('td-role-confirm-action promote');
    expect(element('.td-role-confirm-action').textContent).toBe('晉升確認');

    const flow = element('.td-role-confirm-flow');
    expect(flow.children).toHaveLength(4);
    expect(flow.children.item(0)?.className).toBe('td-role-confirm-name-pill role-coach');
    expect(flow.children.item(0)?.textContent).toBe('王小明');
    expect(flow.children.item(0)?.hasAttribute('data-no-translate')).toBe(true);
    expect(flow.children.item(1)?.className).toBe('td-role-confirm-role-pill role-coach');
    expect(flow.children.item(1)?.textContent).toBe('目前 教練');
    expect(flow.children.item(2)?.className).toBe('td-role-confirm-arrow promote');
    expect(flow.children.item(2)?.getAttribute('aria-hidden')).toBe('true');
    expect(flow.children.item(2)?.textContent).toBe('→');
    expect(flow.children.item(3)?.className).toBe('td-role-confirm-role-pill role-leader');
    expect(flow.children.item(3)?.textContent).toBe('晉升為 領隊');
    expect(element('.td-role-confirm-meta').textContent)
      .toBe('確認後將立即同步更新成員名單與俱樂部設定。');
    expect(element('.app-confirm-btns').children).toHaveLength(2);
    expect(screen.getByRole('button', { name: '取消' }).className).toBe('app-confirm-cancel');
    expect(screen.getByRole('button', { name: '確認晉升' }).className).toBe('app-confirm-ok');
  });

  it('降級文案、方向與目標配色符合 A', () => {
    render(<TeamRoleConfirmDialog {...makeProps({
      currentRole: 'leader',
      target: { key: 'coach', level: 1, direction: 'demote' },
    })} />);
    expect(element('.td-role-confirm-action').className).toBe('td-role-confirm-action demote');
    expect(element('.td-role-confirm-action').textContent).toBe('降級確認');
    expect(element('.td-role-confirm-arrow').className).toBe('td-role-confirm-arrow demote');
    expect(screen.getByText('目前 領隊').className).toBe('td-role-confirm-role-pill role-leader');
    expect(screen.getByText('降級為 教練').className).toBe('td-role-confirm-role-pill role-coach');
    expect(screen.getByRole('button', { name: '確認降級' })).toBeTruthy();
  });

  it('降為隊員顯示隊員文字與預設配色', () => {
    render(<TeamRoleConfirmDialog {...makeProps({
      target: { key: 'member', level: 0, direction: 'demote' },
    })} />);
    expect(screen.getByText('降級為 隊員').className).toBe('td-role-confirm-role-pill role-default');
  });

  const roles: Array<{
    role: TeamRoleConfirmDialogProps['currentRole'];
    label: string;
    className: string;
  }> = [
    { role: 'captain', label: '球經', className: 'role-manager' },
    { role: 'leader', label: '領隊', className: 'role-leader' },
    { role: 'coach', label: '教練', className: 'role-coach' },
    { role: 'member', label: '隊員', className: 'role-default' },
  ];

  it.each(roles)('目前 $label 的名稱與角色 pill 使用 $className', ({
    role, label, className,
  }) => {
    render(<TeamRoleConfirmDialog {...makeProps({ currentRole: role })} />);
    expect(element('.td-role-confirm-name-pill').className)
      .toBe(`td-role-confirm-name-pill ${className}`);
    expect(screen.getByText(`目前 ${label}`).className)
      .toBe(`td-role-confirm-role-pill ${className}`);
  });

  it('確認只呼叫確認回呼，取消鈕只呼叫取消回呼', () => {
    const props = makeProps();
    render(<TeamRoleConfirmDialog {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '確認晉升' }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it.each(['Escape', '遮罩', '返回鍵'])('%s 可取消', (method) => {
    const props = makeProps();
    render(<TeamRoleConfirmDialog {...props} />);
    if (method === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    if (method === '遮罩') fireEvent.click(element('#team-role-confirm-modal'));
    if (method === '返回鍵') {
      act(() => {
        expect(backHandler()()).toBe(true);
      });
    }
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('點擊對話框內容不視為遮罩取消', () => {
    const props = makeProps();
    render(<TeamRoleConfirmDialog {...props} />);
    fireEvent.click(screen.getByText('王小明'));
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('busy 時忽略 Esc、遮罩、返回鍵與取消，確認鈕停用', () => {
    const props = makeProps({ busy: true });
    render(<TeamRoleConfirmDialog {...props} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(element('#team-role-confirm-modal'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    act(() => {
      expect(backHandler()()).toBe(false);
    });
    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: '確認晉升' });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('重新渲染後返回鍵使用最新 busy 與回呼，不重複註冊', () => {
    const props = makeProps();
    const nextCancel = vi.fn();
    const { rerender } = render(<TeamRoleConfirmDialog {...props} />);
    const back = backHandler();

    rerender(<TeamRoleConfirmDialog {...props} busy onCancel={nextCancel} />);
    act(() => {
      expect(back()).toBe(false);
    });
    rerender(<TeamRoleConfirmDialog {...props} busy={false} onCancel={nextCancel} />);
    act(() => {
      expect(back()).toBe(true);
    });

    expect(nextCancel).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(mocks.pushOverlay).toHaveBeenCalledTimes(1);
  });

  it('初始焦點在取消，Tab 與 Shift+Tab 在兩顆按鈕間循環', () => {
    render(<TeamRoleConfirmDialog {...makeProps()} />);
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '確認晉升' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('busy 時焦點循環跳過停用的確認鈕', () => {
    render(<TeamRoleConfirmDialog {...makeProps({ busy: true })} />);
    const cancel = screen.getByRole('button', { name: '取消' });
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it('卸載時釋放返回鍵與 body lock、移除事件並還原焦點', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const props = makeProps();
    const { unmount } = render(<TeamRoleConfirmDialog {...props} />);
    expect(mocks.lockBody).toHaveBeenCalledExactlyOnceWith(document.body);
    unmount();

    expect(mocks.releaseBack).toHaveBeenCalledTimes(1);
    expect(mocks.unlock).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    expect(document.getElementById('team-role-confirm-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCancel).not.toHaveBeenCalled();
    trigger.remove();
  });

  it('成員名稱中的 HTML 只以文字顯示', () => {
    render(<TeamRoleConfirmDialog {...makeProps({ memberName: '<b>x</b>' })} />);
    expect(element('.td-role-confirm-name-pill').textContent).toBe('<b>x</b>');
    expect(screen.getByRole('dialog').querySelector('b')).toBeNull();
  });
});
