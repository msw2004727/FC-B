/**
 * T-090h：俱樂部設定「轉移經理」區塊。
 * 兩步確認、requestId 重送沿用、錯誤對照、成功後 toast 與父層回呼。測試資料只用假 uid。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';

import { transferUserTeamViaCallable } from '../../data/team-transfer';
import type { TeamDoc } from '../../data/types';
import { TeamTransferSection, type TeamTransferSectionProps } from './TeamTransferSection';

vi.mock('@/i18n/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string>) =>
    params ? `${key}|${JSON.stringify(params)}` : key,
}));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('../../data/team-transfer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/team-transfer')>()),
  transferUserTeamViaCallable: vi.fn(),
}));

const confirmMock = vi.mocked(appConfirm);
const toastMock = vi.mocked(toast.show);
const callMock = vi.mocked(transferUserTeamViaCallable);

const team: TeamDoc = { id: 'tm_test_1', _docId: 'tm_test_1', createdVia: 'user_capability', captainUid: 'self' };
const candidates = [
  { uid: 'm1', name: '成員甲' },
  { uid: 'm2', name: '' },
];

function setup(overrides: Partial<TeamTransferSectionProps> = {}) {
  const props: TeamTransferSectionProps = {
    team,
    candidates,
    onTransferred: vi.fn(),
    ...overrides,
  };
  return { ...render(<TeamTransferSection {...props} />), props };
}

function select(): HTMLSelectElement {
  const node = screen.getByRole('combobox', { name: 'clubs.transfer.select' });
  if (!(node instanceof HTMLSelectElement)) throw new Error('找不到新經理下拉');
  return node;
}

function button(): HTMLButtonElement {
  const node = screen.getByRole('button', { name: 'clubs.transfer.title' });
  if (!(node instanceof HTMLButtonElement)) throw new Error('找不到轉移按鈕');
  return node;
}

function choose(uid: string): void {
  fireEvent.change(select(), { target: { value: uid } });
}

function reasonError(reason: string): Error {
  return Object.assign(new Error(reason), { code: 'failed-precondition' });
}

const ok = { ok: true as const, teamId: 'tm_test_1', newOwnerUid: 'm1', deduplicated: false, notification: null };

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(true);
  callMock.mockResolvedValue(ok);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('轉移經理區塊', () => {
  it('列出候選人（缺名補通用文案），未選人時按鈕停用', () => {
    setup();
    const options = [...select().options].map((option) => [option.value, option.textContent]);
    expect(options).toEqual([
      ['', 'clubs.transfer.placeholder'],
      ['m1', '成員甲'],
      ['m2', 'clubs.transfer.unnamed'],
    ]);
    expect(button().disabled).toBe(true);
    choose('m1');
    expect(button().disabled).toBe(false);
  });

  it('名單載入中與空名單：下拉停用並顯示對應文案', () => {
    const loading = setup({ candidates: null });
    expect(select().disabled).toBe(true);
    expect(select().options[0]?.textContent).toBe('clubs.transfer.loading');
    loading.unmount();

    setup({ candidates: [] });
    expect(select().disabled).toBe(true);
    expect(select().options[0]?.textContent).toBe('clubs.transfer.empty');
    expect(button().disabled).toBe(true);
  });

  it('disabled（刪除中）時停用下拉與按鈕', () => {
    setup({ disabled: true });
    expect(select().disabled).toBe(true);
    expect(button().disabled).toBe(true);
  });

  it('兩步確認都同意才呼叫 Callable；成功 toast 後呼叫父層', async () => {
    const order: string[] = [];
    toastMock.mockImplementation(() => { order.push('toast'); return 1; });
    const onTransferred = vi.fn(() => { order.push('onTransferred'); });
    setup({ onTransferred });
    choose('m1');
    fireEvent.click(button());

    await waitFor(() => expect(onTransferred).toHaveBeenCalledTimes(1));
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(confirmMock.mock.calls[0]?.[0]).toBe('clubs.transfer.confirm|{"name":"成員甲"}');
    expect(confirmMock.mock.calls[1]?.[0]).toBe('clubs.transfer.confirmFinal');
    expect(callMock).toHaveBeenCalledTimes(1);
    const input = callMock.mock.calls[0]?.[0];
    expect(input).toMatchObject({ teamId: 'tm_test_1', newOwnerUid: 'm1', newOwnerName: '成員甲' });
    expect(input?.requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(toastMock).toHaveBeenCalledWith({ message: 'clubs.transfer.success|{"name":"成員甲"}', tone: 'success' });
    expect(order).toEqual(['toast', 'onTransferred']);
  });

  it.each([
    ['第一步取消', [false]],
    ['第二步取消', [true, false]],
  ])('%s：不呼叫 Callable、不呼叫父層', async (_label, answers) => {
    for (const answer of answers) confirmMock.mockResolvedValueOnce(answer);
    const { props } = setup();
    choose('m1');
    fireEvent.click(button());

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(answers.length));
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(callMock).not.toHaveBeenCalled();
    expect(props.onTransferred).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('失敗後重送沿用同一個 requestId；換人才產生新的', async () => {
    callMock.mockRejectedValueOnce(reasonError('TRANSFER_USER_TEAM_RETRY'));
    callMock.mockRejectedValueOnce(new Error('network'));
    setup();
    choose('m1');

    fireEvent.click(button());
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button().disabled).toBe(false));
    fireEvent.click(button());
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button().disabled).toBe(false));
    const first = callMock.mock.calls[0]?.[0].requestId;
    expect(callMock.mock.calls[1]?.[0].requestId).toBe(first);

    choose('m2');
    fireEvent.click(button());
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(3));
    expect(callMock.mock.calls[2]?.[0]).toMatchObject({ newOwnerUid: 'm2', newOwnerName: '' });
    expect(callMock.mock.calls[2]?.[0].requestId).not.toBe(first);
  });

  it('取消確認後再按，仍沿用同一目標的 requestId', async () => {
    confirmMock.mockResolvedValueOnce(false);
    setup();
    choose('m1');
    fireEvent.click(button());
    await waitFor(() => expect(button().disabled).toBe(false));
    fireEvent.click(button());
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(1));
    expect(confirmMock).toHaveBeenCalledTimes(3);
  });

  it('TRANSFER_REQUEST_ID_CONFLICT 後下次重送換新 requestId', async () => {
    callMock.mockRejectedValueOnce(reasonError('TRANSFER_REQUEST_ID_CONFLICT'));
    setup();
    choose('m1');
    fireEvent.click(button());
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({
      message: 'clubs.transfer.error.conflict', tone: 'error',
    }));
    await waitFor(() => expect(button().disabled).toBe(false));
    fireEvent.click(button());
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(2));
    expect(callMock.mock.calls[1]?.[0].requestId).not.toBe(callMock.mock.calls[0]?.[0].requestId);
  });

  it.each([
    ['NEW_OWNER_TEAM_LIMIT', 'clubs.transfer.error.newOwnerLimit'],
    ['NEW_OWNER_NOT_MEMBER', 'clubs.transfer.error.notMember'],
    ['TEAM_NOT_USER_CREATED', 'clubs.transfer.error.notUserCreated'],
    ['TRANSFER_TO_SELF', 'clubs.transfer.error.toSelf'],
    ['TEAM_TRANSFER_DENIED', 'clubs.transfer.error.denied'],
  ])('伺服器回 %s 顯示 %s，不呼叫父層', async (reason, key) => {
    callMock.mockRejectedValueOnce(reasonError(reason));
    const { props } = setup();
    choose('m1');
    fireEvent.click(button());
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ message: key, tone: 'error' }));
    expect(props.onTransferred).not.toHaveBeenCalled();
  });

  it('未知錯誤只顯示通用文案，不露原始訊息', async () => {
    callMock.mockRejectedValueOnce(new Error('raw firestore detail'));
    setup();
    choose('m1');
    fireEvent.click(button());
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({
      message: 'clubs.transfer.error.failed', tone: 'error',
    }));
    expect(JSON.stringify(toastMock.mock.calls)).not.toContain('raw firestore detail');
  });

  it('進行中顯示轉移中並回報 busy；連點不重複觸發', async () => {
    let resolveCall!: (value: typeof ok) => void;
    callMock.mockReturnValueOnce(new Promise((resolve) => { resolveCall = resolve; }));
    const onBusyChange = vi.fn();
    setup({ onBusyChange });
    choose('m1');
    const target = button();
    fireEvent.click(target);
    fireEvent.click(target);
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'clubs.transfer.busy' }).hasAttribute('disabled')).toBe(true);
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(confirmMock).toHaveBeenCalledTimes(2);

    await act(async () => { resolveCall(ok); });
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  });

  it('父層重讀失敗不顯示轉移失敗', async () => {
    const onTransferred = vi.fn().mockRejectedValue(new Error('reload failed'));
    setup({ onTransferred });
    choose('m1');
    fireEvent.click(button());
    await waitFor(() => expect(onTransferred).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
  });
});
