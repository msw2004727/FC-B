import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import type { EventDoc } from '@/features/events/data/types';
import { createGuestViewer, createMinimalViewer } from '@/features/profile/data/viewer';
import { AUTH_HINT_KEY } from '@/data/auth-hint';
import type { NextActivityResult } from '../../data/next-activity';

// 寫入端延遲載入還沒完成時帳號已換：這次寫入要取消（審查 P1-a）。
// 用「載入要等閘門」的寫入端替身模擬慢網路；寫入端在元件模組內只載入一次，所以本檔只放一案。

const resolveNextActivity = vi.hoisted(() => vi.fn());
const writer = vi.hoisted(() => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { gate, open, write: vi.fn(), remove: vi.fn() };
});

vi.mock('../../data/next-activity', async () => {
  const actual = await vi.importActual<typeof import('../../data/next-activity')>('../../data/next-activity');
  return { ...actual, resolveNextActivity };
});

vi.mock('../../data/next-activity-snapshot-write', async () => {
  await writer.gate;
  return { writeNextActivitySnapshot: writer.write, removeNextActivitySnapshot: writer.remove };
});

import { HomeNextActivity } from './HomeNextActivity';

const handlers = {
  onViewAll: vi.fn(),
  onFindActivity: vi.fn(),
  onCreateEvent: vi.fn(),
  onOpenDetail: vi.fn(),
  onAddToCalendar: vi.fn(),
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('首頁我的下一場：寫入端還在載入時換帳號', () => {
  it('A 的結果確認後、寫入端載入前 A 登出：A 的寫入取消，不會寫成快照', async () => {
    localStorage.setItem(AUTH_HINT_KEY, '1');
    const event: EventDoc = { id: 'e1', title: 'A 的活動', date: '2099/06/01 19:00~21:00' };
    resolveNextActivity.mockResolvedValue({ event, registration: { status: 'confirmed' }, managedRole: '' } as NextActivityResult);

    const view = render(<HomeNextActivity viewer={createMinimalViewer('uA')} {...handlers} />);
    await view.findByText('A 的活動');
    // 等寫入 effect 執行（Preact 的 effect 在繪製後才跑），寫入端此時卡在閘門前。
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    });
    view.rerender(<HomeNextActivity viewer={createGuestViewer()} {...handlers} />);

    await act(async () => {
      writer.open();
      await writer.gate;
      // 讓寫入端模組載入完成、then 回呼跑完。
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    });
    await waitFor(() => expect(view.getByText('你目前還沒有報名活動')).toBeTruthy());
    expect(writer.write).not.toHaveBeenCalled();
    expect(writer.remove).not.toHaveBeenCalled();
  });
});
