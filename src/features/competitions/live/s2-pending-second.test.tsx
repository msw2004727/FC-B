// S2 審查 P3（顧問 §3.863）：第二黃還在待送時，復原或改判第一黃也要先跳「一併復原第二黃」確認框。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installUi4TestLocale } from '@/ui/ui4-test-helpers';
import { loadingView, type ScoringView } from './data/session';
import type { ServerEvent, ServerMatch, UnappliedView } from './data/types';
import { LIVE_COPY } from './copy';
import { ScorePad } from './ScorePad';
import { CONFIRM_ARM_MS } from './score-states';
import { scorePadPropsFrom } from './scoring-adapter';

installUi4TestLocale();

const NOW = 1_763_510_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function button(name: string | RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

function serverMatch(): ServerMatch {
  return {
    id: 'mt-1',
    status: 'live',
    rev: 1,
    resetRev: 0,
    score: { home: 0, away: 0 },
    lock: { locked: false },
    clockBase: { startedAt: NOW, pausedSec: 120, running: true, period: 'h1' },
    finishedAt: null,
    home: { teamId: 'en_h', name: '雷霆隊', logo: null },
    away: { teamId: 'en_a', name: '海風隊', logo: null },
    divisionId: 'dv1',
    penaltyScore: null,
  };
}

const YELLOW: ServerEvent = {
  seq: 1, type: 'card', op: 'yellow-op-0000000001', sid: 'sid', side: 'home', plId: 'pl_th9',
  cardType: 'yellow', matchSecond: 60, createdAt: NOW,
};

function pendingSecond(): UnappliedView {
  return {
    op: 'second-op-0000000001',
    kind: 'card',
    state: 'pending',
    createdAt: NOW + 1,
    intent: { kind: 'card', side: 'home', plId: 'pl_th9', cardType: 'second_yellow', refSeq: 1, matchSecond: 90 },
    summary: '雷霆隊 第二黃',
  };
}

function scene(unapplied: UnappliedView[], actions: Partial<ScoringView['actions']>) {
  const base = loadingView();
  const view: ScoringView = {
    ...base,
    loading: false,
    match: serverMatch(),
    events: [YELLOW],
    unapplied,
    clock: { elapsedSec: 120, holdSec: null, period: 'h1' },
    score: { home: 0, away: 0, pendingCount: unapplied.length, server: { home: 0, away: 0 } },
    roster: {
      home: [{ id: 'pl_th9', enId: 'en_h', displayName: '劉冠廷', number: 9, position: 'FW', positionText: null, isMinor: false }],
      away: [],
    },
    control: { uid: 'u', sid: 's', localSid: 's', needsTakeover: false, takeoverSelf: false },
    actions: { ...base.actions, ...actions },
  };
  return scorePadPropsFrom(view, NOW);
}

/** 點已套用的第一黃那一列（待送的第二黃列不能點）。 */
function openFirstYellow(): void {
  const names = screen.getAllByRole('button').map((node) => node.getAttribute('aria-label') ?? (node.textContent ?? '').trim());
  const hit = names.find((name) => name.includes('黃牌') && name.includes('劉冠廷') && !name.includes(LIVE_COPY.secondYellowMark));
  if (!hit) throw new Error(`找不到第一黃列：${names.join(' | ')}`);
  fireEvent.click(button(hit));
}

describe('第二黃待送時，復原／改判第一黃先確認', () => {
  it('復原：跳出一併復原確認框，確認後只呼叫一次 undoFirstYellow', () => {
    const undoFirstYellow = vi.fn(async () => ({ status: 'applied' as const }));
    const voidEvent = vi.fn(async () => ({ status: 'applied' as const }));
    render(<ScorePad {...scene([pendingSecond()], { undoFirstYellow, voidEvent })} />);
    openFirstYellow();
    fireEvent.click(button(/^復原/));
    expect(undoFirstYellow).not.toHaveBeenCalled();
    expect(button(LIVE_COPY.undoBothConfirm)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(CONFIRM_ARM_MS); });
    fireEvent.click(button(LIVE_COPY.undoBothConfirm));
    expect(undoFirstYellow.mock.calls).toEqual([[{ seq: 1 }]]);
    expect(voidEvent).not.toHaveBeenCalled();
  });

  it('改判：跳出一併復原第二黃的提示與確認', () => {
    const amend = vi.fn(async () => ({ status: 'applied' as const }));
    render(<ScorePad {...scene([pendingSecond()], { amend })} />);
    openFirstYellow();
    fireEvent.click(button('紅牌'));
    fireEvent.click(button(/^改判/));
    expect(screen.getByText('會一併復原第二張黃牌')).toBeTruthy();
    expect(amend).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(CONFIRM_ARM_MS); });
    fireEvent.click(button('確定改判'));
    expect(amend).toHaveBeenCalledTimes(1);
  });

  it('待送第二黃自己已排了作廢：不算引用，直接復原', () => {
    const undoFirstYellow = vi.fn(async () => ({ status: 'applied' as const }));
    const voided: UnappliedView = {
      op: 'void-op-000000000001',
      kind: 'void',
      state: 'pending',
      createdAt: NOW + 2,
      intent: { kind: 'void', targetOp: 'second-op-0000000001', matchSecond: 95 },
      summary: '復原',
    };
    render(<ScorePad {...scene([pendingSecond(), voided], { undoFirstYellow })} />);
    openFirstYellow();
    fireEvent.click(button(/^復原/));
    expect(screen.queryByRole('button', { name: LIVE_COPY.undoBothConfirm })).toBeNull();
    expect(undoFirstYellow.mock.calls).toEqual([[{ seq: 1 }]]);
  });
});
