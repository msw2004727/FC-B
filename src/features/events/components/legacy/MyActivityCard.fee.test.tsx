import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/preact';
import type { OperateContext } from '../../data/operate-permissions';
import type { EventDoc } from '../../data/types';

const loadManageFeeSummary = vi.fn();
vi.mock('../../data/manage-fee-summary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/manage-fee-summary')>()),
  loadManageFeeSummary: (...args: unknown[]) => loadManageFeeSummary(...args),
}));
vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => ({}),
  getCachedUserLevel: () => 0,
}));

const { MyActivityCard } = await import('./MyActivityCard');

const ctx: OperateContext = {
  uid: 'u-admin', role: 'super_admin', rolePermissions: [], userGrants: null, capabilities: [], customRoles: [],
};
const event = { id: 'ev1', _docId: 'ev1', title: '收費活動', fee: 200, status: 'open', date: '2999/01/01 10:00~12:00', creatorUid: 'u-admin' } as EventDoc;

function renderCard(showFeeSummary: boolean, ev: EventDoc = event) {
  return render(
    <MyActivityCard
      event={ev}
      nowMs={Date.now()}
      operateCtx={ctx}
      onEdit={() => {}}
      onLifecycle={() => {}}
      onDelete={() => {}}
      onPin={() => {}}
      onUnavailable={() => {}}
      onNavigate={() => {}}
      showFeeSummary={showFeeSummary}
    />,
  );
}

describe('MyActivityCard 總管費用摘要（A feeBox）', () => {
  afterEach(() => { cleanup(); loadManageFeeSummary.mockReset(); });

  it('總管：讀取並顯示應收／實收／短收', async () => {
    loadManageFeeSummary.mockResolvedValue({ expected: 1000, actual: 600, short: 400 });
    const { container } = renderCard(true);
    await waitFor(() => expect(container.textContent).toContain('應收$1000'));
    expect(container.textContent).toContain('實收$600');
    expect(container.textContent).toContain('短收$400');
    expect(loadManageFeeSummary).toHaveBeenCalledWith(event, 'ev1', expect.any(Number));
  });

  it('非總管：不讀取也不顯示', () => {
    const { container } = renderCard(false);
    expect(loadManageFeeSummary).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('應收');
  });

  it('沒有費用：不讀取', () => {
    renderCard(true, { ...event, fee: 0 } as EventDoc);
    expect(loadManageFeeSummary).not.toHaveBeenCalled();
  });
});
