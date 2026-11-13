import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/preact';
import type { EventDoc, RegistrationDoc } from '../../data/types';

const loadEventRegistrations = vi.fn();
vi.mock('../../data/event-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/event-detail')>()),
  loadEventRegistrations: (...args: unknown[]) => loadEventRegistrations(...args),
}));

const { MyActivityDetailModal } = await import('./MyActivityModals');

// 顧問 §3.136 ②：應收不可用 event.current（Functions 寫入的 current＝realCurrent＋團隊未報），
// 要用實際正取（detail-model#actualConfirmedCount）。
const team = (reservedSlots: number, remainingSlots: number) => ({ teamId: 't1', reservedSlots, remainingSlots });
const reg = (userId: string, status = 'confirmed'): RegistrationDoc => ({ userId, status }) as RegistrationDoc;
const base = { id: 'ev1', _docId: 'ev1', title: '收費活動', status: 'open', date: '2999/01/01 10:00~12:00' };

async function renderFee(extra: Record<string, unknown>, regs: RegistrationDoc[] = []) {
  loadEventRegistrations.mockResolvedValue(regs);
  const view = render(
    <MyActivityDetailModal event={{ ...base, ...extra } as EventDoc} isSuperAdmin nowMs={Date.now()} onClose={() => {}} />,
  );
  await waitFor(() => expect(loadEventRegistrations).toHaveBeenCalled());
  await waitFor(() => expect(view.container.querySelector('.reg-loading')).toBeNull());
  return view.container.querySelector('#detail-fee-summary')?.textContent ?? '';
}

describe('MyActivityDetailModal 應收（實際正取）', () => {
  afterEach(() => { cleanup(); loadEventRegistrations.mockReset(); });

  it('有團隊保留：應收＝費用×realCurrent，不含團隊未報', async () => {
    const text = await renderFee({ fee: 200, current: 18, realCurrent: 14, teamReservationSummaries: [team(8, 4)] });
    expect(text).toContain('應收 $2800');
    expect(text).not.toContain('$3600');
  });

  it('realCurrent 與「current 扣團隊未報」不同時以 realCurrent 為準', async () => {
    const text = await renderFee({ fee: 100, current: 18, realCurrent: 10, teamReservationSummaries: [team(8, 4)] });
    expect(text).toContain('應收 $1000');
    expect(text).not.toContain('$1400');
    expect(text).not.toContain('$1800');
  });

  it('缺 realCurrent：current 扣團隊未報', async () => {
    const text = await renderFee({ fee: 100, current: 18, teamReservationSummaries: [team(8, 4)] });
    expect(text).toContain('應收 $1400');
  });

  it('realCurrent 為 0 且沒有報名：應收 0，不退回含保留的 current', async () => {
    const text = await renderFee({ fee: 100, current: 4, realCurrent: 0, teamReservationSummaries: [team(4, 4)] });
    expect(text).toContain('應收 $0');
  });

  it('realCurrent 為 0 但讀到正取報名：照 A 退回報名數', async () => {
    const text = await renderFee({ fee: 100, current: 4, realCurrent: 0 }, [reg('u1'), reg('u2'), reg('u3', 'waitlisted')]);
    expect(text).toContain('應收 $200');
  });

  it('免費活動：不顯示費用摘要', async () => {
    const text = await renderFee({ fee: 0, current: 5, realCurrent: 5 });
    expect(text).not.toContain('應收');
  });
});
