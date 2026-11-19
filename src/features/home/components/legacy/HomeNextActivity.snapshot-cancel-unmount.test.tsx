import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import type { EventDoc } from '@/features/events/data/types';
import { createMinimalViewer } from '@/features/profile/data/viewer';
import { AUTH_HINT_KEY } from '@/data/auth-hint';
import type { NextActivityResult } from '../../data/next-activity';

// 寫入端延遲載入還沒完成時情況已變：這次寫入／刪除要取消（初審 P1-a、交叉審 P3-2）。
// 寫入端在元件模組內只載入一次，要模擬「載入很慢」只能每個情境一個檔（各自獨立的模組載入）。
// 正向對照：最後斷言寫入端確實載入過（writer.loaded），證明不是因為根本沒走到寫入才沒呼叫。

const resolveNextActivity = vi.hoisted(() => vi.fn());
const writer = vi.hoisted(() => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { gate, open, loaded: false, write: vi.fn(), remove: vi.fn(), removeOthers: vi.fn() };
});

vi.mock('../../data/next-activity', async () => {
  const actual = await vi.importActual<typeof import('../../data/next-activity')>('../../data/next-activity');
  return { ...actual, resolveNextActivity };
});

vi.mock('../../data/next-activity-snapshot-write', async () => {
  await writer.gate;
  writer.loaded = true;
  return {
    writeNextActivitySnapshot: writer.write,
    removeNextActivitySnapshot: writer.remove,
    removeNextActivitySnapshotOfOthers: writer.removeOthers,
  };
});

import { HomeNextActivity } from './HomeNextActivity';

const handlers = {
  onViewAll: vi.fn(),
  onFindActivity: vi.fn(),
  onCreateEvent: vi.fn(),
  onOpenDetail: vi.fn(),
  onAddToCalendar: vi.fn(),
};

const resultOf = (title: string): NextActivityResult => ({
  event: { id: 'e1', title, date: '2099/06/01 19:00~21:00' } as EventDoc,
  registration: { status: 'confirmed' } as NextActivityResult['registration'],
  managedRole: '',
});

const tick = (ms = 50): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function openGate(): Promise<void> {
  await act(async () => {
    writer.open();
    await writer.gate;
    await tick();
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('首頁我的下一場：寫入端還在載入時離開首頁', () => {
  it('元件卸載：這次寫入取消', async () => {
    localStorage.setItem(AUTH_HINT_KEY, '1');
    resolveNextActivity.mockResolvedValue(resultOf('A 的活動'));

    const view = render(<HomeNextActivity viewer={createMinimalViewer('uA')} {...handlers} />);
    await view.findByText('A 的活動');
    await act(async () => {
      await tick();
    });
    view.unmount();

    await openGate();
    expect(writer.loaded).toBe(true);
    expect(writer.write).not.toHaveBeenCalled();
    expect(writer.remove).not.toHaveBeenCalled();
  });
});
