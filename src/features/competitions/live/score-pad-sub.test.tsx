// CP-PO-07 換人：選單 → 選隊 → 換下 → 換上 → 確認（0.6 秒防連點）才送出；換人列只顯示、不能點開復原。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installUi4TestLocale } from '@/ui/ui4-test-helpers';
import { S4_SCENE_HT, S4_SCENE_LIVE, S4_SCENE_PK, S4_SCENE_PRE, type S4ScoreScene } from '../testing/step4-fixtures';
import { loadingView, type ScoringView } from './data/session';
import type { ServerEvent, ServerMatch } from './data/types';
import { CONFIRM_ARM_MS } from './score-states';
import { ScorePad, type ScorePadProps } from './ScorePad';
import { scorePadPropsFrom } from './scoring-adapter';

installUi4TestLocale();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function pad(scene: S4ScoreScene, extra: Partial<ScorePadProps> = {}) {
  return render(<ScorePad {...scene} {...extra} />);
}

function button(name: string | RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

function openMenu(): void {
  fireEvent.click(button('選單'));
}

describe('換人入口', () => {
  it('沒傳 onSub 不顯示選單項', () => {
    pad(S4_SCENE_LIVE);
    openMenu();
    expect(screen.queryByRole('button', { name: '換人' })).toBeNull();
  });

  it('進行中與中場有「換人」，開賽前與 PK 沒有', () => {
    const onSub = vi.fn();
    pad(S4_SCENE_LIVE, { onSub });
    openMenu();
    expect(button('換人').disabled).toBe(false);
    cleanup();
    pad(S4_SCENE_HT, { onSub });
    openMenu();
    expect(button('換人')).toBeTruthy();
    cleanup();
    pad(S4_SCENE_PK, { onSub });
    if (screen.queryByRole('button', { name: '選單' })) openMenu();
    expect(screen.queryByRole('button', { name: '換人' })).toBeNull();
    cleanup();
    pad(S4_SCENE_PRE, { onSub });
    expect(screen.queryByRole('button', { name: '換人' })).toBeNull();
  });

  it('讀分頁（記分停用）時選單項停用', () => {
    pad(S4_SCENE_LIVE, { onSub: vi.fn(), scoringDisabled: true, onLeave: () => undefined });
    openMenu();
    expect(button('換人').disabled).toBe(true);
  });

  it('選隊 → 換下 → 換上（排除換下的人）→ 確認 0.6 秒後才送出', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onSub = vi.fn(() => true);
    pad(S4_SCENE_LIVE, { onSub });
    const home = S4_SCENE_LIVE.homeRoster;
    const [out, into] = [...home].sort((a, b) => a.number - b.number);
    if (!out || !into) throw new Error('fixture 名單至少要兩人');
    openMenu();
    fireEvent.click(button('換人'));
    fireEvent.click(button(S4_SCENE_LIVE.match.home.name));
    expect(screen.getByText(`${S4_SCENE_LIVE.match.home.name} 換人 換下`)).toBeTruthy();
    fireEvent.click(button(`${out.number} ${out.displayName}`));
    expect(screen.getByText(`${S4_SCENE_LIVE.match.home.name} 換人 換上`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: `${out.number} ${out.displayName}` })).toBeNull();
    fireEvent.click(button(`${into.number} ${into.displayName}`));
    expect(screen.getByText(`${out.number} ${out.displayName} 換下、${into.number} ${into.displayName} 換上`)).toBeTruthy();
    expect(screen.getByText('換人送出後不能作廢')).toBeTruthy();
    fireEvent.click(button('確認換人'));
    expect(onSub).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(CONFIRM_ARM_MS); });
    fireEvent.click(button('確認換人'));
    expect(onSub).toHaveBeenCalledTimes(1);
    expect(onSub).toHaveBeenCalledWith({ side: 'home', outPlId: out.id, inPlId: into.id });
    expect(screen.queryByText('換人送出後不能作廢')).toBeNull();
  });

  it('確認框開著時被接手（記分停用）：流程收掉，恢復後不會重開', () => {
    const onSub = vi.fn(() => true);
    const view = pad(S4_SCENE_LIVE, { onSub });
    const [out, into] = [...S4_SCENE_LIVE.homeRoster].sort((a, b) => a.number - b.number);
    if (!out || !into) throw new Error('fixture 名單至少要兩人');
    openMenu();
    fireEvent.click(button('換人'));
    fireEvent.click(button(S4_SCENE_LIVE.match.home.name));
    fireEvent.click(button(`${out.number} ${out.displayName}`));
    fireEvent.click(button(`${into.number} ${into.displayName}`));
    expect(screen.getByText('換人送出後不能作廢')).toBeTruthy();
    view.rerender(<ScorePad {...S4_SCENE_LIVE} onSub={onSub} takeoverOffered />);
    expect(screen.queryByText('換人送出後不能作廢')).toBeNull();
    view.rerender(<ScorePad {...S4_SCENE_LIVE} onSub={onSub} takeoverOffered={false} />);
    expect(screen.queryByText('換人送出後不能作廢')).toBeNull();
    expect(onSub).not.toHaveBeenCalled();
  });

  it('確認框按「先不要」不送出', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onSub = vi.fn(() => true);
    pad(S4_SCENE_LIVE, { onSub });
    const [out, into] = [...S4_SCENE_LIVE.awayRoster].sort((a, b) => a.number - b.number);
    if (!out || !into) throw new Error('fixture 客隊名單至少要兩人');
    openMenu();
    fireEvent.click(button('換人'));
    fireEvent.click(button(S4_SCENE_LIVE.match.away.name));
    fireEvent.click(button(`${out.number} ${out.displayName}`));
    fireEvent.click(button(`${into.number} ${into.displayName}`));
    act(() => { vi.advanceTimersByTime(CONFIRM_ARM_MS); });
    fireEvent.click(button('先不要'));
    expect(onSub).not.toHaveBeenCalled();
    expect(screen.queryByText('換人送出後不能作廢')).toBeNull();
  });
});

const NOW = 1_763_510_400_000;

function serverMatch(): ServerMatch {
  return {
    id: 'mt-1',
    status: 'live',
    rev: 2,
    resetRev: 0,
    score: { home: 0, away: 0 },
    lock: { locked: false },
    clockBase: { startedAt: NOW, pausedSec: 600, running: true, period: 'h1' },
    finishedAt: null,
    home: { teamId: 'en_h', name: '雷霆隊', logo: null },
    away: { teamId: 'en_a', name: '海風隊', logo: null },
    divisionId: 'dv1',
    penaltyScore: null,
  };
}

function view(partial: Partial<ScoringView> = {}): ScoringView {
  const base = loadingView();
  return {
    ...base,
    loading: false,
    match: serverMatch(),
    clock: { elapsedSec: 600, holdSec: null, period: 'h1' },
    roster: {
      home: [
        { id: 'pl_7', enId: 'en_h', displayName: '王小明', number: 7, position: null, positionText: null, isMinor: false },
        { id: 'pl_12', enId: 'en_h', displayName: '李大華', number: 12, position: null, positionText: null, isMinor: false },
      ],
      away: [],
    },
    ...partial,
    actions: { ...base.actions, ...partial.actions },
  };
}

describe('換人接到工作階段與紀錄列', () => {
  it('onSub 呼叫 actions.sub，不帶 matchSecond（由工作階段取當下）', () => {
    const sub = vi.fn(async () => ({ status: 'applied' as const }));
    const props = scorePadPropsFrom(view({ actions: { ...loadingView().actions, sub } }), NOW);
    expect(props.onSub?.({ side: 'home', outPlId: 'pl_7', inPlId: 'pl_12' })).toBe(true);
    expect(sub).toHaveBeenCalledWith({ side: 'home', outPlId: 'pl_7', inPlId: 'pl_12' });
  });

  it('伺服器的換人與待送的換人都進紀錄列，照 seq 新到舊；換人列不能點開', () => {
    const goal: ServerEvent = {
      seq: 1, type: 'goal', op: 'goal-op-000000000001', sid: 'sid', side: 'home', plId: 'pl_7',
      goalKind: 'normal', matchSecond: 60, createdAt: NOW,
    };
    const subEvent = {
      seq: 2, type: 'sub', op: 'sub-op-0000000000002', sid: 'sid', side: 'home', outPlId: 'pl_7', inPlId: 'pl_12',
      matchSecond: 5 * 60, createdAt: NOW,
    } as unknown as ServerEvent;
    const props = scorePadPropsFrom(view({
      events: [goal, subEvent],
      unapplied: [{
        op: 'pend-sub-00000000001',
        kind: 'sub',
        state: 'pending',
        createdAt: NOW + 1,
        intent: { kind: 'sub', side: 'home', outPlId: 'pl_12', inPlId: 'pl_7', matchSecond: 9 * 60 },
        summary: '主隊 換人',
      }] as unknown as ScoringView['unapplied'],
    }), NOW);
    const feed = props.feed ?? [];
    expect(feed.map((row) => [row.kind, row.seq, row.pending])).toEqual([
      ['sub', -1, true],
      ['sub', 2, false],
      ['goal', 1, false],
    ]);
    expect(feed[1]?.text).toBe("5' 雷霆隊 7 王小明 換下、12 李大華 換上");
    expect(feed[1]?.label).toBe("5' 換人 雷霆隊 7 王小明 換下、12 李大華 換上");
    render(<ScorePad {...props} />);
    // 進球列可點（按鈕），換人列不是按鈕。
    expect(screen.queryByRole('button', { name: "5' 換人 雷霆隊 7 王小明 換下、12 李大華 換上" })).toBeNull();
    expect(screen.getByText("5' 雷霆隊 7 王小明 換下、12 李大華 換上")).toBeTruthy();
  });
});
