import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installUi4TestLocale } from '@/ui/ui4-test-helpers';
import { s4Match, S4_SCENE_LIVE, S4_SCENE_PK, S4_SCENE_PK_START, S4_SCENE_TAKEOVER } from '../testing/step4-fixtures';
import { LIVE_COPY, teamAction } from './copy';
import { EventSheet } from './EventSheet';
import { PlayerSheet } from './PlayerSheet';
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

  it('沒有本機 sid 時按鈕寫接手記分，記分鈕停用', () => {
    render(<ScorePad {...S4_SCENE_LIVE} takeoverOffered takeoverSelf />);
    const take = screen.getByRole('button', { name: LIVE_COPY.takeoverAction }) as HTMLButtonElement;
    expect(take.disabled).toBe(false);
    expect(screen.queryByText(LIVE_COPY.takeoverEntry)).toBeNull();
    const goal = screen.getByRole('button', { name: teamAction('雷霆隊', LIVE_COPY.goal) }) as HTMLButtonElement;
    expect(goal.disabled).toBe(true);
    expect(goal.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(goal);
    expect(screen.queryByRole('button', { name: LIVE_COPY.unspecified })).toBeNull();
  });

  it('別的裝置仍寫其他裝置記分中，記分鈕停用', () => {
    render(<ScorePad {...S4_SCENE_TAKEOVER} />);
    const entry = screen.getByRole('button', { name: LIVE_COPY.takeoverEntry }) as HTMLButtonElement;
    expect(entry.disabled).toBe(false);
    expect(screen.queryByRole('button', { name: LIVE_COPY.takeoverAction })).toBeNull();
    const goal = screen.getByRole('button', { name: teamAction('雷霆隊', LIVE_COPY.goal) }) as HTMLButtonElement;
    expect(goal.disabled).toBe(true);
  });

  it('需要接手時 PK 進沒進與終場停用', () => {
    render(<ScorePad {...S4_SCENE_PK} takeoverOffered takeoverSelf />);
    const take = screen.getByRole('button', { name: LIVE_COPY.takeoverAction }) as HTMLButtonElement;
    expect(take.disabled).toBe(false);
    for (const name of [
      teamAction('雷霆隊', LIVE_COPY.pkIn),
      teamAction('雷霆隊', LIVE_COPY.pkMiss),
      teamAction('海風隊', LIVE_COPY.pkIn),
      teamAction('海風隊', LIVE_COPY.pkMiss),
      LIVE_COPY.fulltime,
    ]) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
    }
  });
});

describe('P1-A 中場改判與 P2-B 空名單牌', () => {
  it('中場點開進球：改判停用、只留復原，出現說明；live 時照常', () => {
    const view = render(<ScorePad {...S4_SCENE_LIVE} halftimeGoalUndoOnly />);
    fireEvent.click(screen.getByRole('button', { name: /5' 進球/ }));
    expect((screen.getByRole('button', { name: /復原/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /改判/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(LIVE_COPY.halftimeGoalUndoOnly)).toBeTruthy();
    expect(screen.queryByText(LIVE_COPY.amendNote)).toBeNull();
    expect(document.querySelector('.s4-pick')).toBeNull();
    view.unmount();
    cleanup();
    render(<ScorePad {...S4_SCENE_LIVE} />);
    fireEvent.click(screen.getByRole('button', { name: /5' 進球/ }));
    expect((screen.getByRole('button', { name: /改判/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(LIVE_COPY.halftimeGoalUndoOnly)).toBeNull();
    expect(screen.getByText(LIVE_COPY.amendNote)).toBeTruthy();
  });

  it('中場鎖只對進球：牌照常可改判', () => {
    render(
      <EventSheet
        summary="一張牌"
        label="一張牌"
        kind="card"
        roster={[]}
        goalKind="normal"
        cardChoice="yellow"
        playerId="pl_a"
        blocked={false}
        halftimeGoal
        onGoalKind={() => {}}
        onCardChoice={() => {}}
        onPlayer={() => {}}
        onUnspecified={() => {}}
        onUndo={() => {}}
        onAmend={() => {}}
        onShowCard={() => {}}
        onClose={() => {}}
      />,
    );
    expect((screen.getByRole('button', { name: /改判/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(LIVE_COPY.halftimeGoalUndoOnly)).toBeNull();
  });

  it('牌面板該隊名單 0 人時顯示提示；進球與有名單時不顯示', () => {
    const base = {
      open: true,
      teamName: '雷霆隊',
      minute: 5,
      goalKind: 'normal' as const,
      onGoalKind: () => {},
      onPick: () => {},
      onClose: () => {},
    };
    const view = render(<PlayerSheet {...base} action="yellow" roster={[]} />);
    expect(screen.getByText(LIVE_COPY.cardNoRoster)).toBeTruthy();
    view.rerender(<PlayerSheet {...base} action="red" roster={[]} />);
    expect(screen.getByText(LIVE_COPY.cardNoRoster)).toBeTruthy();
    expect(screen.queryByRole('button', { name: LIVE_COPY.unspecified })).toBeNull();
    view.rerender(<PlayerSheet {...base} action="goal" roster={[]} />);
    expect(screen.queryByText(LIVE_COPY.cardNoRoster)).toBeNull();
    view.rerender(
      <PlayerSheet
        {...base}
        action="yellow"
        roster={[{ id: 'pl_a', enId: 'en_h', displayName: '劉冠廷', number: 9, position: 'FW', positionText: null, isMinor: false }]}
      />,
    );
    expect(screen.queryByText(LIVE_COPY.cardNoRoster)).toBeNull();
  });
});

describe('半場鈕只在上半場', () => {
  const halftimeBtn = () => screen.queryByRole('button', { name: LIVE_COPY.halftime });

  it('h1 顯示、h2 不顯示、PK 不顯示', () => {
    const view = render(<ScorePad {...S4_SCENE_LIVE} />);
    expect(S4_SCENE_LIVE.match.clockBase.period).toBe('h1');
    expect(halftimeBtn()).toBeTruthy();
    view.unmount();
    cleanup();
    const h2 = s4Match({
      status: 'live',
      clockBase: { ...S4_SCENE_LIVE.match.clockBase, period: 'h2' },
    });
    render(<ScorePad {...S4_SCENE_LIVE} match={h2} clock={{ ...S4_SCENE_LIVE.clock, period: 'h2' }} pkCanStart={false} />);
    expect(halftimeBtn()).toBeNull();
    cleanup();
    render(<ScorePad {...S4_SCENE_PK} />);
    expect(halftimeBtn()).toBeNull();
  });
});
