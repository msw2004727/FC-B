import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installUi4TestLocale } from '@/ui/ui4-test-helpers';
import {
  S4_SCENE_LIVE,
  S4_SCENE_PICK_LONG,
  S4_SCENE_PK_START,
  S4_SCENE_PRE,
  S4_SCENE_TAKEOVER,
  S4_SCENE_UNAPPLIED,
} from '../testing/step4-fixtures';
import { LIVE_COPY } from './copy';
import { EventSheet } from './EventSheet';
import { ScorePad } from './ScorePad';

installUi4TestLocale();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function button(name: string | RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

const eventProps = {
  summary: "12' 進球 雷霆隊 9 劉冠廷",
  label: "12' 進球 雷霆隊 9 劉冠廷",
  kind: 'goal' as const,
  roster: [],
  goalKind: 'normal' as const,
  cardChoice: 'yellow' as const,
  playerId: null,
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

describe('記分頁面板（施工-第2批 卡 2-4）', () => {
  it('選球員面板掛 d2-panel 與主客隊記號；「不指定球員」帶釘底記號', () => {
    render(<ScorePad {...S4_SCENE_LIVE} />);
    fireEvent.click(button('雷霆隊 進球'));
    const sheet = document.querySelector('.s4-sheet')!;
    expect(sheet.classList.contains('d2-panel')).toBe(true);
    expect(sheet.classList.contains('s4-sheet--home')).toBe(true);
    expect(sheet.querySelector('.s4-unspecified')?.classList.contains('s4-unspecified--pin')).toBe(true);
  });

  it('長名單選球員面板仍帶 s4-sheet--long', () => {
    render(<ScorePad {...S4_SCENE_PICK_LONG} />);
    fireEvent.click(button('雷霆隊 進球'));
    const sheet = document.querySelector('.s4-sheet')!;
    expect(sheet.classList.contains('s4-sheet--long')).toBe(true);
    expect(sheet.classList.contains('d2-panel')).toBe(true);
    cleanup();
    render(<ScorePad {...S4_SCENE_PICK_LONG} />);
    fireEvent.click(button('海風隊 進球'));
    expect(document.querySelector('.s4-sheet')?.classList.contains('s4-sheet--away')).toBe(true);
  });

  it('事件面板：復原｜改判在底部按鈕列，復原在左；只能復原時只有一顆；原紀錄前有圖示', () => {
    render(<EventSheet {...eventProps} markKind="goal" markSide="home" />);
    const sheet = document.querySelector('.s4-sheet')!;
    expect(sheet.classList.contains('d2-panel')).toBe(true);
    const footer = sheet.querySelector('.ui-modal__footer')!;
    expect([...footer.querySelectorAll('button')].map((node) => (node.textContent ?? '').trim())).toEqual([LIVE_COPY.undo, LIVE_COPY.amend]);
    expect(footer.querySelector('button')?.classList.contains('ui-button--secondary')).toBe(true);
    expect(sheet.querySelector('.ui-modal__body .s4-amend-act')).toBeNull();
    const sum = sheet.querySelector('.s4-evsum')!;
    expect(sum.classList.contains('s4-evsum--home')).toBe(true);
    expect(sum.querySelector('.s4-mark--goal')).toBeTruthy();
    expect(sum.textContent).toBe(eventProps.summary);
    cleanup();
    render(<EventSheet {...eventProps} undoOnly />);
    expect(document.querySelectorAll('.s4-sheet .ui-modal__footer button')).toHaveLength(1);
    expect(document.querySelector('.s4-evsum .s4-mark')).toBeNull();
  });

  it('牌的事件面板：「看這張牌」留在內容區；牌色兩顆帶牌色記號', () => {
    render(<EventSheet {...eventProps} kind="card" playerId="pl_1" />);
    expect(document.querySelector('.s4-sheet .ui-modal__body [data-show-card]')).toBeTruthy();
    expect(document.querySelector('.s4-sheet .ui-modal__footer [data-show-card]')).toBeNull();
    expect(document.querySelector('.s4-kinds--card')).toBeTruthy();
  });

  it('未套用面板：掛 d2-panel；被拒那一列帶記號；捨棄是次要鈕', () => {
    render(<ScorePad {...S4_SCENE_UNAPPLIED} />);
    fireEvent.click(button(LIVE_COPY.unappliedTitle));
    const sheet = document.querySelector('.s4-sheet')!;
    expect(sheet.classList.contains('d2-panel')).toBe(true);
    const rejected = [...sheet.querySelectorAll('.s4-log--rejected')];
    expect(rejected.length).toBeGreaterThan(0);
    for (const li of rejected) {
      expect(li.className.split(' ')[0]).toBe('s4-log');
      const discard = [...li.querySelectorAll('button')].find((node) => (node.textContent ?? '').trim() === LIVE_COPY.discard);
      expect(discard?.classList.contains('ui-button--secondary')).toBe(true);
    }
  });

  it('確認框都掛 d2-panel；開始 PK、接手、兩張牌是危險確認，開賽不是', () => {
    vi.useFakeTimers();
    render(<ScorePad {...S4_SCENE_PK_START} confirmPk onStartPk={() => {}} />);
    fireEvent.click(button(LIVE_COPY.pkStart));
    let dialog = document.querySelector('.s4-dialog')!;
    expect(dialog.classList.contains('d2-panel')).toBe(true);
    expect(button(LIVE_COPY.pkConfirmGo).classList.contains('ui-button--danger')).toBe(true);
    cleanup();

    render(<ScorePad {...S4_SCENE_PRE} confirmKickoff onKickoff={() => {}} />);
    fireEvent.click(button(LIVE_COPY.kickoff));
    dialog = document.querySelector('.s4-dialog')!;
    expect(dialog.classList.contains('d2-panel')).toBe(true);
    const go = [...dialog.querySelectorAll('.ui-modal__footer button')].pop()!;
    expect(go.classList.contains('ui-button--danger')).toBe(false);
    expect(go.getAttribute('data-confirm-armed')).toBe('false');
    act(() => { vi.advanceTimersByTime(700); });
    cleanup();

    render(<ScorePad {...S4_SCENE_TAKEOVER} />);
    fireEvent.click(button(LIVE_COPY.takeoverEntry));
    dialog = document.querySelector('.s4-dialog')!;
    expect(dialog.classList.contains('d2-panel')).toBe(true);
    expect(button(LIVE_COPY.takeoverAction).classList.contains('ui-button--danger')).toBe(true);
  });

  it('球隊暫停選隊：面板掛 d2-panel；鈕的名稱仍是整句，畫面上隊名與「剩 N 次」分兩個節點', () => {
    render(<ScorePad {...S4_SCENE_LIVE} />);
    fireEvent.click(button(LIVE_COPY.matchMenu));
    fireEvent.click(button(LIVE_COPY.teamTimeout));
    const sheet = document.querySelector('.s4-sheet')!;
    expect(sheet.classList.contains('d2-panel')).toBe(true);
    const pick = button('雷霆隊 剩 1 次');
    expect(pick.querySelector('.ui-button__label')?.textContent).toBe('雷霆隊');
    expect(pick.querySelector('.s4-tp__left')?.textContent).toBe('剩 1 次');
  });
});

describe('記分頁面板樣式（字面）', () => {
  const live = readFileSync(join(process.cwd(), 'src/features/competitions/live/live.css'), 'utf8');
  const comp = readFileSync(join(process.cwd(), 'src/features/competitions/competitions.css'), 'utf8');

  it('長名單高度 700 以下放到 76；確認鈕剛跳出的空心框沿用第 0 批那一條；被外殼取代的舊規則已刪', () => {
    expect(live).toMatch(/@media \(max-height: 700px\)\s*\{\s*\.s4-sheet--long\.ui-bottom-sheet \.ui-modal__panel\s*\{[^}]*max-height:\s*76dvh/);
    expect(comp).toMatch(/\.d2-panel \.ui-button\[data-confirm-armed="false"\]::before\s*\{[^}]*inset 0 0 0 1\.5px var\(--d2-off-line\)/);
    expect(live).not.toMatch(/\.s4-amend-act/);
    expect(live).not.toMatch(/\.s4-sheet \.ui-button\[aria-disabled="true"\]/);
    expect(live).toMatch(/\.s4-sheet\.d2-panel \.ui-modal__body\s*\{[^}]*gap:\s*16px/);
  });
});
