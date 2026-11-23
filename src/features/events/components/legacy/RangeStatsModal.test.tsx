import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimalViewer } from '@/features/profile/data/viewer';
import type { DateRangeKeys, EventRoster } from '../../data/range-stats-model';
import type { EventDoc } from '../../data/types';

const data = vi.hoisted(() => ({
  loadRangeEvents: vi.fn(),
  loadRangeRosters: vi.fn(),
}));
vi.mock('../../data/range-stats', () => data);

import { RangeStatsModal } from './RangeStatsModal';

const NOW = Date.UTC(2026, 10, 23, 4);
const viewer = createMinimalViewer('me');

function ev(id: string, over: Record<string, unknown> = {}): EventDoc {
  return { id: `p-${id}`, _docId: `d-${id}`, status: 'ended', date: '2026/11/10 19:00', ...over } as EventDoc;
}

const EVENTS = [ev('a'), ev('b', { status: 'cancelled' })];
const ROSTERS: EventRoster[] = [
  {
    event: EVENTS[0]!,
    registrations: [
      { userId: 'u1', status: 'confirmed' },
      { userId: 'u2', status: 'confirmed' },
      { userId: 'u3', status: 'waitlisted' },
    ],
    attendance: [{ uid: 'u1', type: 'checkin' }, { uid: 'u1', type: 'checkout' }],
  },
  { event: EVENTS[1]!, registrations: [{ userId: 'u1', status: 'cancelled' }], attendance: [] },
];

function cell(metric: string, col: 1 | 2): string {
  const row = document.querySelector(`tr[data-metric="${metric}"]`);
  return row?.querySelectorAll('td')[col]?.textContent ?? '';
}

beforeEach(() => {
  data.loadRangeEvents.mockReset().mockResolvedValue(EVENTS);
  data.loadRangeRosters.mockReset().mockResolvedValue({ rosters: ROSTERS, failed: [] });
});
afterEach(() => cleanup());

function renderModal(canViewNoShow = true) {
  return render(
    <RangeStatsModal open viewer={viewer} manageAll={false} canViewNoShow={canViewNoShow} onClose={() => undefined} nowMs={NOW} />,
  );
}

describe('RangeStatsModal', () => {
  it('portal 到 body 外包 .legacy-ui，並 import 自己與說明彈窗的樣式', async () => {
    renderModal();
    const overlay = document.body.querySelector('.edu-info-overlay');
    expect(overlay?.parentElement?.classList.contains('legacy-ui')).toBe(true);
    expect(overlay?.parentElement?.parentElement).toBe(document.body);
    const source = readFileSync(resolve(process.cwd(), 'src/features/events/components/legacy/RangeStatsModal.tsx'), 'utf8');
    expect(source).toContain("import './range-stats.css';");
    expect(source).toContain("import '@/styles/legacy/edu-info-btn.css';");
    await waitFor(() => expect(cell('registered', 1)).toBe('3'));
  });

  it('預設本月：顯示人次與不重複人數，放鴿子列依權限顯示', async () => {
    renderModal(true);
    await waitFor(() => expect(cell('confirmed', 1)).toBe('2'));
    const range = data.loadRangeEvents.mock.calls[0]![0] as DateRangeKeys;
    expect(range).toMatchObject({ startKey: '2026/11/01', endKey: '2026/12/01' });
    expect(cell('waitlisted', 2)).toBe('1');
    expect(cell('checkedPair', 1)).toBe('1');
    expect(cell('noShow', 1)).toBe('1');
    expect(cell('cancelled', 1)).toBe('1');
    expect(screen.getByText('2026 年 11 月')).toBeTruthy();
    expect((screen.getByRole('button', { name: '下一段' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('沒有放鴿子權限：不顯示放鴿子列與扇區', async () => {
    renderModal(false);
    await waitFor(() => expect(cell('confirmed', 1)).toBe('2'));
    expect(document.querySelector('tr[data-metric="noShow"]')).toBeNull();
    expect(screen.queryByText('放鴿子')).toBeNull();
  });

  it('取消勾選狀態只重算，不重讀', async () => {
    renderModal();
    await waitFor(() => expect(cell('cancelled', 1)).toBe('1'));
    fireEvent.click(within(document.querySelector('.mrs-chips')!).getByText('已取消'));
    await waitFor(() => expect(cell('cancelled', 1)).toBe('0'));
    expect(data.loadRangeRosters).toHaveBeenCalledTimes(1);
    expect(data.loadRangeEvents).toHaveBeenCalledTimes(1);
  });

  it('上一段換區間重讀；回到原區間用快取', async () => {
    renderModal();
    await waitFor(() => expect(cell('registered', 1)).toBe('3'));
    fireEvent.click(screen.getByRole('button', { name: '上一段' }));
    await waitFor(() => expect(data.loadRangeEvents).toHaveBeenCalledTimes(2));
    expect((data.loadRangeEvents.mock.calls[1]![0] as DateRangeKeys).startKey).toBe('2026/10/01');
    await waitFor(() => expect(screen.getByText('2026 年 10 月')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '下一段' }));
    await waitFor(() => expect(screen.getByText('2026 年 11 月')).toBeTruthy());
    expect(data.loadRangeEvents).toHaveBeenCalledTimes(2);
  });

  it('超過 3 個月先確認才讀名單', async () => {
    renderModal();
    await waitFor(() => expect(data.loadRangeRosters).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: '年' }));
    await waitFor(() => expect(screen.getByText('將讀取 2 場活動的名單')).toBeTruthy());
    expect(data.loadRangeRosters).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '繼續' }));
    await waitFor(() => expect(data.loadRangeRosters).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(cell('registered', 1)).toBe('3'));
  });

  it('有場次讀取失敗：標示並可重試，不當成 0', async () => {
    data.loadRangeRosters.mockResolvedValueOnce({ rosters: [ROSTERS[0]!], failed: [EVENTS[1]!] });
    renderModal();
    await waitFor(() => expect(screen.getByText('1 場名單讀取失敗，未列入統計')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await waitFor(() => expect(screen.queryByText('1 場名單讀取失敗，未列入統計')).toBeNull());
    expect(data.loadRangeRosters).toHaveBeenCalledTimes(2);
    expect(cell('cancelled', 1)).toBe('1');
  });

  it('活動清單讀取失敗顯示重試', async () => {
    data.loadRangeEvents.mockRejectedValueOnce(new Error('x'));
    renderModal();
    await waitFor(() => expect(screen.getByText('讀取失敗')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await waitFor(() => expect(cell('registered', 1)).toBe('3'));
  });

  it('自訂起訖：起大於訖顯示提示、不讀取', async () => {
    renderModal();
    await waitFor(() => expect(data.loadRangeEvents).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: '自訂' }));
    await waitFor(() => expect(data.loadRangeEvents).toHaveBeenCalledTimes(2));
    fireEvent.input(screen.getByLabelText('開始日期'), { target: { value: '2026-12-31' } });
    await waitFor(() => expect(screen.getByText('開始日期不能晚於結束日期')).toBeTruthy());
    expect(data.loadRangeEvents).toHaveBeenCalledTimes(2);
  });

  it('圓餅圖：出席分布顯示百分比，可切到活動狀態', async () => {
    renderModal();
    await waitFor(() => expect(cell('registered', 1)).toBe('3'));
    const legend = document.querySelector('.mrs-legend')!;
    // 已出席 1、正取未簽退 0、放鴿子 1、候補 1、取消 1 → 各 25%
    expect(within(legend as HTMLElement).getAllByText('25.0%')).toHaveLength(4);
    fireEvent.click(screen.getByRole('tab', { name: '活動狀態' }));
    await waitFor(() => expect(screen.getByText('已結束（場）')).toBeTruthy());
    expect(within(document.querySelector('.mrs-legend') as HTMLElement).getAllByText('50.0%')).toHaveLength(2);
  });
});
