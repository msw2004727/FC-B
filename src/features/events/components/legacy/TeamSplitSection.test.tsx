import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamBatchButtons, TeamInfoCards, TeamSelectUI } from './TeamSplitSection';
import type { OperateContext } from '../../data/operate-permissions';

vi.mock('@/i18n/i18n', async o => ({
  ...(await o<typeof import('@/i18n/i18n')>()),
  lt: (_key: string, fallback: string) => fallback,
}));

const event = {
  creatorUid: 'owner',
  max: 2,
  teamSplit: {
    enabled: true,
    mode: 'self-select',
    balanceCap: true,
    teams: [
      { key: 'A', color: '#EF4444', name: '紅隊' },
      { key: 'B', color: '#FFFFFF', name: '白隊' },
    ],
  },
};
const context: OperateContext = {
  uid: 'owner',
  role: 'user',
  rolePermissions: [],
  capabilities: ['user.activity.addons_use'],
  userGrants: null,
  customRoles: [],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('M-092 legacy 分隊 UI', () => {
  it('資訊卡只計正取，超額警告與球衣 DOM 照 A', () => {
    const { container } = render(<TeamInfoCards event={event} registrations={[
      { status: 'confirmed', teamKey: 'A' },
      { status: 'confirmed', teamKey: 'A' },
      { status: 'waitlisted', teamKey: 'B' },
    ]} />);
    expect(container.querySelectorAll('.team-stat-card')).toHaveLength(2);
    expect(container.querySelector('.team-stat-text')?.textContent).toBe('2/1 人');
    expect(container.querySelector('.team-stat-text')?.getAttribute('style'))
      .toContain('var(--warning)');
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 32 28');
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });

  it('滿隊點擊 shake 300ms，不改選隊；空隊可選，卸載清除 timer', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const view = render(<TeamSelectUI
      event={event}
      registrations={[{ status: 'confirmed', teamKey: 'A' }]}
      selectedKey="B"
      onSelect={onSelect}
    />);
    const full = screen.getByText('紅隊').closest('.team-select-card')!;
    expect(full.classList.contains('full')).toBe(true);
    fireEvent.click(full);
    expect(full.classList.contains('shake')).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(full.classList.contains('shake')).toBe(false);

    const available = screen.getByText('白隊').closest('.team-select-card')!;
    expect(available.classList.contains('selected')).toBe(true);
    fireEvent.click(available);
    expect(onSelect).toHaveBeenCalledWith('B');

    fireEvent.click(full);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('批次鈕依具體權限 helper，三個 action 與 A 文字一致', () => {
    const onAction = vi.fn();
    const view = render(<TeamBatchButtons event={event} context={context} onAction={onAction} />);
    fireEvent.click(screen.getByText('隨機'));
    fireEvent.click(screen.getByText('補齊'));
    fireEvent.click(screen.getByText('重置'));
    expect(onAction.mock.calls).toEqual([['random'], ['fill'], ['reset']]);
    view.rerender(<TeamBatchButtons
      event={event}
      context={{ ...context, uid: 'other' }}
      onAction={onAction}
    />);
    expect(screen.queryByText('隨機')).toBeNull();
  });

  it('停用時沒有資訊卡、批次鈕或選隊區', () => {
    const disabled = { ...event, teamSplit: { ...event.teamSplit, enabled: false } };
    const { container } = render(<>
      <TeamInfoCards event={disabled} registrations={[]} />
      <TeamBatchButtons event={disabled} context={context} onAction={() => {}} />
      <TeamSelectUI event={disabled} registrations={[]} selectedKey={null} onSelect={() => {}} />
    </>);
    expect(container.childElementCount).toBe(0);
  });
});
