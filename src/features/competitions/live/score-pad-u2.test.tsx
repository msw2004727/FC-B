import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installUi4TestLocale } from '@/ui/ui4-test-helpers';
import { S4_SCENE_LIVE, S4_SCENE_PK_START, S4_SCENE_TAKEOVER } from '../testing/step4-fixtures';
import { LIVE_COPY } from './copy';
import { EventSheet } from './EventSheet';
import { ScorePad, type ScoreFeedRow } from './ScorePad';

installUi4TestLocale();

afterEach(() => cleanup());

const row: ScoreFeedRow = {
  key: 'op-pend-1',
  seq: 9,
  pending: true,
  text: '33 雷霆隊 9 劉冠廷',
  label: "33' 進球 雷霆隊 9 劉冠廷",
  kind: 'goal',
  secondYellow: false,
  voided: false,
};

describe('記分板新狀態', () => {
  it('待送小標出現，同一列落地後消失', () => {
    const view = render(<ScorePad {...S4_SCENE_LIVE} feed={[row]} />);
    expect(screen.getByText(LIVE_COPY.pending)).toBeTruthy();
    expect(document.querySelector('.s4-pending')?.textContent).toBe(LIVE_COPY.pending);
    view.rerender(<ScorePad {...S4_SCENE_LIVE} feed={[{ ...row, pending: false }]} />);
    expect(screen.queryByText(LIVE_COPY.pending)).toBeNull();
    expect(screen.getByText(row.text)).toBeTruthy();
  });

  it('離線小標的筆數就是 pendingCount', () => {
    render(<ScorePad {...S4_SCENE_LIVE} link={{ online: false, pendingCount: 2, storageUnavailable: false, wakeLock: true }} />);
    expect(screen.getByText('離線・2 筆待送')).toBeTruthy();
  });

  it('儲存不可用時，有網路也顯示既有警告', () => {
    render(<ScorePad
      {...S4_SCENE_LIVE}
      storageBanner
      link={{ online: true, pendingCount: 0, storageUnavailable: false, wakeLock: true }}
    />);
    expect(screen.getByText(LIVE_COPY.offlineUnstored)).toBeTruthy();
  });

  it('PK 確認框取消不送，確認才呼叫', () => {
    const start = vi.fn();
    render(<ScorePad {...S4_SCENE_PK_START} confirmPk onStartPk={start} />);
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.pkStart }));
    expect(screen.getByText(LIVE_COPY.pkConfirmTitle)).toBeTruthy();
    expect(screen.getByText(LIVE_COPY.pkConfirmLine1)).toBeTruthy();
    expect(screen.getByText(LIVE_COPY.pkConfirmLine2)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.pkConfirmCancel }));
    expect(start).not.toHaveBeenCalled();
    expect(screen.queryByText(LIVE_COPY.pkConfirmTitle)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.pkStart }));
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.pkConfirmGo }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('PK 期間一般進球的復原與改判停用', () => {
    render(<ScorePad {...S4_SCENE_LIVE} lockRegularGoals />);
    fireEvent.click(screen.getByRole('button', { name: /5' 進球/ }));
    const undo = screen.getByRole('button', { name: /復原/ });
    const amend = screen.getByRole('button', { name: /改判/ });
    expect((undo as HTMLButtonElement).disabled).toBe(true);
    expect((amend as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(LIVE_COPY.pkGoalLocked)).toBeTruthy();
    expect(document.querySelector('.s4-evsum')).toBeTruthy();
    expect(document.querySelector('.s4-kinds')).toBeNull();
    expect(document.querySelector('.s4-pick')).toBeNull();
    expect(screen.queryByText(LIVE_COPY.amendNote)).toBeNull();
    expect(screen.queryByRole('button', { name: LIVE_COPY.goalNormal })).toBeNull();
    expect(screen.queryByRole('button', { name: LIVE_COPY.goalPenalty })).toBeNull();
    expect(screen.queryByRole('button', { name: LIVE_COPY.goalOwn })).toBeNull();
    expect(screen.queryByRole('button', { name: LIVE_COPY.unspecified })).toBeNull();
  });

  it('牌與 PK 腳的復原不受鎖影響', () => {
    const sheet = {
      summary: '一張牌',
      label: '一張牌',
      roster: [],
      goalKind: 'normal' as const,
      cardChoice: 'yellow' as const,
      playerId: 'pl_a',
      blocked: false,
      onGoalKind: () => {},
      onCardChoice: () => {},
      onPlayer: () => {},
      onUnspecified: () => {},
      onUndo: () => {},
      onAmend: () => {},
      onShowCard: () => {},
      onClose: () => {},
    };
    const card = render(<EventSheet {...sheet} kind="card" goalLocked />);
    expect(screen.getByRole('button', { name: LIVE_COPY.yellow })).toBeTruthy();
    expect(document.querySelector('.s4-kinds')).toBeTruthy();
    expect((screen.getByRole('button', { name: /復原/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /改判/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(LIVE_COPY.pkGoalLocked)).toBeNull();
    card.rerender(<EventSheet {...sheet} kind="goal" undoOnly goalLocked />);
    expect((screen.getByRole('button', { name: /復原/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: /改判/ })).toBeNull();
    expect(screen.queryByText(LIVE_COPY.pkGoalLocked)).toBeNull();
  });

  it('讀分頁時記分按鈕停用，頂部顯示分頁提示', () => {
    render(<ScorePad {...S4_SCENE_LIVE} scoringDisabled topBanner="這場已在另一個分頁記分" />);
    expect(screen.getByText('這場已在另一個分頁記分')).toBeTruthy();
    const root = document.querySelector('.s4-root');
    const buttons = [...(root?.querySelectorAll('button') ?? [])];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('正式頁倒數跟著 timeoutView，收合留在同一段，重整後仍在', () => {
    const startedAt = 1_700_000_000_000;
    const timeoutView = { side: 'home' as const, leftSec: 47, startedAt };
    const first = render(<ScorePad {...S4_SCENE_LIVE} timeoutControlled timeoutView={timeoutView} />);
    expect(screen.getByText('雷霆隊暫停 0:47')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.collapseTimeout }));
    first.rerender(<ScorePad {...S4_SCENE_LIVE} timeoutControlled timeoutView={{ ...timeoutView, leftSec: 46 }} />);
    expect(document.querySelector('.s4-timeout--mini')).toBeTruthy();
    expect(screen.getByRole('button', { name: '雷霆隊暫停 0:46' })).toBeTruthy();
    first.unmount();
    render(<ScorePad {...S4_SCENE_LIVE} timeoutControlled timeoutView={timeoutView} />);
    expect(screen.getByText('雷霆隊暫停 0:47')).toBeTruthy();
  });

  it('倒數到 0 顯示繼續計時，資料走完後仍留到結束暫停', () => {
    const onClock = vi.fn();
    const startedAt = 1_700_000_000_000;
    const view = render(
      <ScorePad
        {...S4_SCENE_LIVE}
        timeoutControlled
        onClock={onClock}
        timeoutView={{ side: 'home', leftSec: 0, startedAt }}
      />,
    );
    expect(document.querySelector('.s4-timeout__text')?.textContent).toBe(LIVE_COPY.resumeClock);
    view.rerender(<ScorePad {...S4_SCENE_LIVE} timeoutControlled onClock={onClock} />);
    expect(document.querySelector('.s4-timeout__text')?.textContent).toBe(LIVE_COPY.resumeClock);
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.endTimeout }));
    expect(onClock).not.toHaveBeenCalled();
    expect(document.querySelector('.s4-timeout')).toBeNull();
  });

  it('沒有本機 sid 時按鈕寫接手記分', () => {
    render(<ScorePad {...S4_SCENE_LIVE} takeoverOffered takeoverSelf />);
    expect(screen.getByRole('button', { name: LIVE_COPY.takeoverAction })).toBeTruthy();
    expect(screen.queryByText(LIVE_COPY.takeoverEntry)).toBeNull();
  });

  it('別的裝置仍寫其他裝置記分中', () => {
    render(<ScorePad {...S4_SCENE_TAKEOVER} />);
    expect(screen.getByRole('button', { name: LIVE_COPY.takeoverEntry })).toBeTruthy();
    expect(screen.queryByRole('button', { name: LIVE_COPY.takeoverAction })).toBeNull();
  });
});
