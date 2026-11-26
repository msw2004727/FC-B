// 賽事個資移除面板（設計 §4.8；顧問 §3.816②）。Callable 用替身，不連 Functions。
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import { getToasts, toast } from '@/ui/Toast';
import { CpCallError, type CpAdminRemovalDryRun, type CpDataRemovalResult } from '@/features/competitions/data/cp-callables';
import { CpRemovalModal, type CpRemovalApi } from './CpRemovalModal';
import { warningTexts } from './copy';

afterEach(() => {
  cleanup();
  _resetAppConfirmForTest();
  toast.clear();
});

const LIMIT = '只代填過球員、自己在賽事系統沒有任何紀錄的人，那幾場不會列在這裡。';

function summary(patch: Partial<CpAdminRemovalDryRun> = {}): CpAdminRemovalDryRun {
  return {
    dryRun: true,
    subject: 'u_3f9a0000',
    reasonCode: 'subject_request',
    generatedAt: '2026-12-01T04:00:00+08:00',
    confirmToken: 'dr_token',
    expiresAt: '2026-12-04T04:00:00+08:00',
    competitions: [
      {
        cid: 'cp_a', name: '示範盃', roles: ['player', 'scorer'], phase: 'started',
        now: { rosterDeidentify: 1, statsNameReplace: 2, staffNameClear: 1, rosterDelete: 0, mystery: 3 },
        later: { reasons: ['staff_active'], until: '指派到期' },
      },
      {
        cid: 'cp_b', name: '冬季聯賽', roles: ['rep'], phase: 'roster_open',
        now: { entryRegistrantClear: 1, cpMineDelete: 1 },
        later: null,
      },
    ],
    totals: { competitions: 2, writesNow: 6, writesLater: 1 },
    irreversible: ['真名', '記分員顯示名'],
    warnings: [],
    limitations: [LIMIT],
    ...patch,
  };
}

function draw(opts: { canRun: boolean; dry?: CpRemovalApi['dryRun']; run?: CpRemovalApi['run'] }) {
  const api = {
    dryRun: vi.fn(opts.dry ?? (async () => summary())),
    run: vi.fn(opts.run ?? (async (): Promise<CpDataRemovalResult> => ({ status: 'done', processed: 2, waiting: [] }))),
  };
  render(
    <>
      <CpRemovalModal uid="uid_target" name="王示範" canRun={opts.canRun} api={api} onClose={() => {}} />
      <AppConfirmHost />
    </>,
  );
  return api;
}

const dialog = () => screen.getByRole('dialog', { name: '賽事個資移除' });
const lastToast = () => getToasts().at(-1)?.message;

async function makeSummary(): Promise<void> {
  fireEvent.click(within(dialog()).getByRole('button', { name: '產生試算' }));
  await waitFor(() => expect(document.querySelector('[data-cp-removal-summary]')).not.toBeNull());
}

async function confirmRun(): Promise<void> {
  fireEvent.click(within(dialog()).getByRole('button', { name: '執行' }));
  const ask = await screen.findByRole('alertdialog');
  expect(ask.textContent).toContain('會永久移除這位會員的賽事個資，\n無法復原。確定執行？');
  fireEvent.click(within(ask).getAllByRole('button').at(-1)!);
}

describe('賽事個資移除面板：試算', () => {
  it('會員名、原因選擇；試算帶 uid 與原因；逐場只列非 0 項目、之後、合計、不可復原、限制說明、期限', async () => {
    const api = draw({ canRun: true });
    expect(dialog().querySelector('[data-cp-member]')?.textContent).toBe('王示範');
    const select = dialog().querySelector('select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['本人申請', '帳號刪除']);
    act(() => {
      select.value = 'account_deleted';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // 試算前沒有執行鈕
    expect(within(dialog()).queryByRole('button', { name: '執行' })).toBeNull();
    await makeSummary();
    expect(api.dryRun).toHaveBeenCalledWith({ uid: 'uid_target', reasonCode: 'account_deleted' });

    const a = dialog().querySelector('[data-cid="cp_a"]')!;
    expect(a.textContent).toContain('示範盃');
    expect(a.textContent).toContain('球員、記分員・已開賽');
    expect([...a.querySelectorAll('span')].map((el) => el.textContent)).toEqual(['名單去識別 1', '數據名字改「球員」 2', '記分員顯示名清除 1']);
    expect(a.textContent).not.toContain('名單移除');
    expect(a.textContent).not.toContain('mystery');
    expect(a.querySelector('[data-cp-later]')?.textContent).toBe('之後：指派到期後處理');
    const b = dialog().querySelector('[data-cid="cp_b"]')!;
    expect(b.textContent).toContain('隊伍代表・報名中');
    expect(b.querySelector('[data-cp-later]')).toBeNull();
    expect(dialog().querySelector('[data-cp-totals]')?.textContent).toBe('合計：2 場・現在處理 6 筆・之後處理 1 場');
    expect([...dialog().querySelectorAll('[data-cp-irreversible] span')].map((el) => el.textContent)).toEqual(['不可復原：', '真名', '記分員顯示名']);
    expect(dialog().querySelector('[data-cp-limitations]')?.textContent).toContain(LIMIT);
    expect(dialog().querySelector('[data-cp-warnings]')).toBeNull();
    expect(dialog().querySelector('[data-cp-expires]')?.textContent).toBe('確認碼有效到 2026/12/04 04:00');
  });

  it('換原因會清掉試算（確認碼綁原因）', async () => {
    draw({ canRun: true });
    await makeSummary();
    const select = dialog().querySelector('select') as HTMLSelectElement;
    act(() => {
      select.value = 'account_deleted';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.querySelector('[data-cp-removal-summary]')).toBeNull();
  });

  it('warnings 用白話顯示、不露代碼；摘要被截斷時執行鈕停用', async () => {
    draw({ canRun: true, dry: async () => summary({ warnings: ['SUMMARY_TRUNCATED', 'QUERY_FAILED:cp_x', 'QUERY_FAILED:cp_y'] }) });
    await makeSummary();
    const box = dialog().querySelector('[data-cp-warnings]')!;
    expect(box.textContent).toContain('資料太多，試算只列出一部分，這次不能執行');
    expect(box.textContent).toContain('2 場查詢失敗，結果可能不完整');
    expect(box.textContent).not.toContain('cp_x');
    expect((within(dialog()).getByRole('button', { name: '執行' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('warningTexts：缺索引、超過 200 場、其他代碼', () => {
    expect(warningTexts(['INDEX_MISSING:a', 'PENDING_TRUNCATED', 'WHATEVER'])).toEqual([
      '賽事超過 200 場，只列出前 200 場',
      '1 場查詢失敗（缺索引），請先處理再執行',
      '另有 1 項提醒，請找工程確認',
    ]);
  });
});

describe('賽事個資移除面板：執行權限', () => {
  it('一般管理員：看得到試算，沒有執行鈕，顯示「執行需由站長本人操作」', async () => {
    const api = draw({ canRun: false });
    await makeSummary();
    expect(within(dialog()).queryByRole('button', { name: '執行' })).toBeNull();
    expect(dialog().querySelector('[data-cp-admin-only]')?.textContent).toBe('執行需由站長本人操作');
    expect(api.run).not.toHaveBeenCalled();
  });

  it('super_admin：沒有那句提示，有執行鈕', async () => {
    draw({ canRun: true });
    await makeSummary();
    expect(dialog().querySelector('[data-cp-admin-only]')).toBeNull();
    expect(within(dialog()).getByRole('button', { name: '執行' })).toBeTruthy();
  });
});

describe('賽事個資移除面板：執行', () => {
  it('確認框取消不送；確定後帶確認碼送一次，處理中轉圈不可重按，完成提示並清掉試算', async () => {
    let finish: (v: CpDataRemovalResult) => void = () => {};
    const api = draw({ canRun: true, run: () => new Promise<CpDataRemovalResult>((resolve) => { finish = resolve; }) });
    await makeSummary();
    fireEvent.click(within(dialog()).getByRole('button', { name: '執行' }));
    const ask = await screen.findByRole('alertdialog');
    expect(within(ask).getAllByRole('button').at(-1)!.textContent).toBe('永久移除');
    fireEvent.click(within(ask).getAllByRole('button')[0]!);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.run).not.toHaveBeenCalled();

    await confirmRun();
    const busy = await screen.findByRole('button', { name: '處理中…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.querySelector('svg')).not.toBeNull();
    fireEvent.click(busy);
    expect(api.run).toHaveBeenCalledTimes(1);
    expect(api.run).toHaveBeenCalledWith({ uid: 'uid_target', reasonCode: 'subject_request', confirmToken: 'dr_token' });
    await act(async () => { finish({ status: 'done', processed: 2, waiting: [] }); });
    await waitFor(() => expect(lastToast()).toBe('已移除這位會員的賽事個資'));
    expect(document.querySelector('[data-cp-removal-summary]')).toBeNull();
  });

  it('waiting：N＝不同賽事數', async () => {
    draw({
      canRun: true,
      run: async () => ({ status: 'waiting', processed: 1, waiting: [{ cid: 'cp_a', reason: 'staff_active' }, { cid: 'cp_a', reason: 'invite_open' }] }),
    });
    await makeSummary();
    await confirmRun();
    await waitFor(() => expect(lastToast()).toBe('已移除大部分資料，\n其餘 1 場會在賽事結束或指派到期後自動處理'));
  });

  it('DRY_RUN_STALE：提示重新產生試算，並清掉舊試算', async () => {
    draw({ canRun: true, run: async () => { throw new CpCallError('DRY_RUN_STALE', {}); } });
    await makeSummary();
    await confirmRun();
    await waitFor(() => expect(lastToast()).toBe('資料已變更或試算已過期，請重新產生試算'));
    expect(getToasts().at(-1)?.tone).toBe('error');
    expect(document.querySelector('[data-cp-removal-summary]')).toBeNull();
  });

  it.each([
    ['SUPER_ADMIN_ONLY', '執行需由站長本人操作'],
    ['SUMMARY_TOO_LARGE', '資料太多，這次無法執行'],
    ['DRY_RUN_REQUIRED', '請先產生試算'],
    ['INTERNAL', '操作失敗，請稍後再試'],
  ])('%s → %s', async (reason, text) => {
    draw({ canRun: true, run: async () => { throw new CpCallError(reason, {}); } });
    await makeSummary();
    await confirmRun();
    await waitFor(() => expect(lastToast()).toBe(text));
  });

  it('試算失敗也用白話提示', async () => {
    draw({ canRun: true, dry: async () => { throw new CpCallError('ADMIN_ONLY', {}); } });
    fireEvent.click(within(dialog()).getByRole('button', { name: '產生試算' }));
    await waitFor(() => expect(lastToast()).toBe('操作失敗，請稍後再試'));
  });
});
