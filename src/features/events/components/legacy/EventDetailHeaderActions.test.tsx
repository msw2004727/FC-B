import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canEditDetailActivity, EventDetailHeaderActions, type EventDetailHeaderActionsProps } from './EventDetailHeaderActions';
import type { OperateContext } from '../../data/operate-permissions';

const mocks = vi.hoisted(() => ({ save: vi.fn(), toast: vi.fn() }));
vi.mock('../../data/event-public-toggle', () => ({ saveEventPublic: mocks.save }));
vi.mock('@/ui/Toast', () => ({ toast: { show: mocks.toast } }));
vi.mock('@/i18n/i18n', async (o) => ({
  ...(await o<typeof import('@/i18n/i18n')>()),
  lt: (_key: string, fallback: string) => fallback,
}));

const user: OperateContext = {
  uid: 'u', role: 'user', rolePermissions: [], userGrants: null,
  capabilities: [], customRoles: [],
};
function props(context: OperateContext = user): EventDetailHeaderActionsProps {
  return {
    context,
    event: { id: 'public', creatorUid: 'owner', teamOnly: true, isPublic: false },
    eventDocId: 'doc',
    staffTeamIds: new Set(),
    viewCount: 10,
    onReload: vi.fn(),
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onOpenLog: vi.fn(),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

// 測試同步更新：照 A（M-090，指揮官 2026-10-22 決定，預覽文字與 A 不符）訪客也顯示瀏覽數與重新整理。
it('訪客顯示瀏覽數與重新整理（按下重新載入）、無公開與 Log；一般 user 只有 refresh 與不可點擊計數', () => {
  const guestProps = props({ ...user, uid: null, role: null });
  const view = render(<EventDetailHeaderActions {...guestProps} />);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByTitle('瀏覽次數')).toBeTruthy();
  expect(screen.queryByText('Log')).toBeNull();
  expect(screen.queryByLabelText('活動公開')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  expect(guestProps.onReload).toHaveBeenCalledOnce();
  expect(guestProps.onRefresh).not.toHaveBeenCalled();
  view.rerender(<EventDetailHeaderActions {...props()} />);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '重新整理' }).querySelector('svg')).toBeTruthy();
  fireEvent.click(screen.getByTitle('瀏覽次數'));
  expect(mocks.toast).not.toHaveBeenCalled();
});

it('owner 編輯能力與現場操作權獨立；external 走相同 A 基本編輯語意', () => {
  const owner = { ...user, capabilities: ['user.activity.own_edit_basic'] };
  expect(canEditDetailActivity(owner, { id: 'e', creatorUid: 'u' })).toBe(true);
  expect(canEditDetailActivity(owner, { id: 'e', creatorUid: 'u', type: 'external' })).toBe(true);
  expect(canEditDetailActivity({ ...user, capabilities: ['user.activity.site_operate'] },
    { id: 'e', creatorUid: 'u' })).toBe(false);
});

it('scoped coach 顯示公開與 Log；一般 owner 不因 owner 自動取得 Log', () => {
  const view = render(<EventDetailHeaderActions {...props({ ...user, uid: 'owner' })} />);
  expect(screen.queryByText('Log')).toBeNull();
  view.rerender(<EventDetailHeaderActions {...props({ ...user, uid: 'owner', role: 'coach' })} />);
  expect(screen.getByText('Log')).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: '活動公開' })).toBeTruthy();
});

it('公開樂觀更新、disabled、失敗還原、重試成功 reload', async () => {
  let reject!: (reason: Error) => void;
  mocks.save.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  const inputProps = props({ ...user, uid: 'owner', role: 'coach' });
  render(<EventDetailHeaderActions {...inputProps} />);
  const input = screen.getByRole('checkbox', { name: '活動公開' }) as HTMLInputElement;
  act(() => {
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(input.checked).toBe(true);
  expect(input.disabled).toBe(true);
  expect(mocks.save).toHaveBeenCalledWith('doc', true);
  reject(new Error('denied'));
  await waitFor(() => expect(input.disabled).toBe(false));
  expect(input.checked).toBe(false);
  expect(mocks.toast).toHaveBeenCalledWith({ message: 'denied' });
  act(() => {
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitFor(() => expect(inputProps.onReload).toHaveBeenCalledOnce());
  expect(mocks.toast).toHaveBeenCalledWith({ message: '已開啟活動公開' });
});

it('handler 重新檢查同一 helper，權限撤回後不開 Log', () => {
  const context = { ...user, uid: 'owner', role: 'coach' };
  const inputProps = props(context);
  render(<EventDetailHeaderActions {...inputProps} />);
  context.role = 'user';
  fireEvent.click(screen.getByText('Log'));
  expect(inputProps.onOpenLog).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledWith({ message: '權限不足' });
});

it('refresh disabled 與 spinning，失敗顯示 A 文案', async () => {
  let reject!: (reason: Error) => void;
  const inputProps = props();
  inputProps.onRefresh = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  render(<EventDetailHeaderActions {...inputProps} />);
  const button = screen.getByRole('button', { name: '重新整理' }) as HTMLButtonElement;
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  expect(button.classList.contains('spinning')).toBe(true);
  reject(new Error('offline'));
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(button.classList.contains('spinning')).toBe(false);
  expect(mocks.toast).toHaveBeenCalledWith({ message: '刷新失敗，請稍後再試' });
});
