// 第 4 步 A（顧問 11-20）：不能復原的確認框防連點、開賽確認、被拒擋住提示、看這張牌不被事件面板蓋住。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installUi4TestLocale } from '@/ui/ui4-test-helpers';
import { S4_SCENE_LIVE, S4_SCENE_PK_START, S4_SCENE_PRE, S4_SCENE_TAKEOVER, S4_SCENE_UNAPPLIED } from '../testing/step4-fixtures';
import { blockedStep, heldQueued, heldRejected, LIVE_COPY } from './copy';
import { ScorePad } from './ScorePad';
import { CONFIRM_ARM_MS } from './score-states';

installUi4TestLocale();

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

function advance(ms: number): void {
  act(() => { vi.advanceTimersByTime(ms); });
}

/** 對話框底部按鈕的順序（文字）。 */
function footerOrder(): string[] {
  const footer = document.querySelector('.s4-dialog .ui-modal__footer');
  return [...(footer?.querySelectorAll('button') ?? [])].map((node) => (node.textContent ?? '').trim());
}

function expectArmCycle(confirmName: string, onConfirm: ReturnType<typeof vi.fn>): void {
  const confirm = button(confirmName);
  // 剛打開：停用（看得出來），按了沒作用。
  expect(confirm.disabled).toBe(true);
  expect(confirm.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(confirm);
  expect(onConfirm).not.toHaveBeenCalled();
  advance(CONFIRM_ARM_MS - 1);
  expect(button(confirmName).disabled).toBe(true);
  fireEvent.click(button(confirmName));
  expect(onConfirm).not.toHaveBeenCalled();
  // 時間到自動可按。
  advance(1);
  expect(button(confirmName).disabled).toBe(false);
  expect(button(confirmName).getAttribute('aria-disabled')).toBeNull();
  fireEvent.click(button(confirmName));
  expect(onConfirm).toHaveBeenCalledTimes(1);
}

describe('不能復原的確認框：取消在左、確認在右，打開後 600ms 內確認停用', () => {
  it('PK 大戰', () => {
    const start = vi.fn();
    render(<ScorePad {...S4_SCENE_PK_START} confirmPk onStartPk={start} />);
    fireEvent.click(button(LIVE_COPY.pkStart));
    expect(footerOrder()).toEqual([LIVE_COPY.pkConfirmCancel, LIVE_COPY.pkConfirmGo]);
    expectArmCycle(LIVE_COPY.pkConfirmGo, start);
  });

  it('PK 大戰：連點兩下（第二下落在確認鈕）不會開始', () => {
    const start = vi.fn();
    render(<ScorePad {...S4_SCENE_PK_START} confirmPk onStartPk={start} />);
    fireEvent.click(button(LIVE_COPY.pkStart));
    advance(120);
    fireEvent.click(button(LIVE_COPY.pkConfirmGo));
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText(LIVE_COPY.pkConfirmTitle)).toBeTruthy();
  });

  it('PK 大戰：有被拒項目擋住時不開確認框，直接送出（由工作階段回被擋提示）', () => {
    const start = vi.fn();
    render(<ScorePad {...S4_SCENE_PK_START} confirmPk pkStartBlocked onStartPk={start} heldLines={[{ key: 'held', text: blockedStep('pkStart'), alert: true }]} />);
    fireEvent.click(button(LIVE_COPY.pkStart));
    expect(screen.queryByText(LIVE_COPY.pkConfirmTitle)).toBeNull();
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByText('先處理沒送出的紀錄，才能開始 PK').closest('p')?.getAttribute('role')).toBe('alert');
  });

  it('開賽：正式頁先確認（標題、說明、取消在左）', () => {
    const kickoff = vi.fn();
    render(<ScorePad {...S4_SCENE_PRE} confirmKickoff onKickoff={kickoff} />);
    fireEvent.click(button(LIVE_COPY.kickoff));
    expect(kickoff).not.toHaveBeenCalled();
    expect(screen.getByText(LIVE_COPY.kickoffConfirmTitle)).toBeTruthy();
    expect(screen.getByText(LIVE_COPY.kickoffConfirmLine)).toBeTruthy();
    expect(footerOrder()).toEqual([LIVE_COPY.pkConfirmCancel, LIVE_COPY.kickoff]);
    const confirm = document.querySelector('.s4-dialog .ui-modal__footer button:last-child') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(kickoff).not.toHaveBeenCalled();
    advance(CONFIRM_ARM_MS);
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(kickoff).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(LIVE_COPY.kickoffConfirmTitle)).toBeNull();
  });

  it('開賽：取消不送；沒開 confirmKickoff（預覽）維持按了就送', () => {
    const kickoff = vi.fn();
    const { unmount } = render(<ScorePad {...S4_SCENE_PRE} confirmKickoff onKickoff={kickoff} />);
    fireEvent.click(button(LIVE_COPY.kickoff));
    fireEvent.click(button(LIVE_COPY.pkConfirmCancel));
    expect(kickoff).not.toHaveBeenCalled();
    expect(screen.queryByText(LIVE_COPY.kickoffConfirmTitle)).toBeNull();
    unmount();
    render(<ScorePad {...S4_SCENE_PRE} onKickoff={kickoff} />);
    fireEvent.click(button(LIVE_COPY.kickoff));
    expect(kickoff).toHaveBeenCalledTimes(1);
  });

  it('接手記分', () => {
    const takeover = vi.fn();
    render(<ScorePad {...S4_SCENE_TAKEOVER} onTakeover={takeover} />);
    fireEvent.click(button(LIVE_COPY.takeoverEntry));
    expect(footerOrder()).toEqual([LIVE_COPY.takeoverLater, LIVE_COPY.takeoverAction]);
    expectArmCycle(LIVE_COPY.takeoverAction, takeover);
  });

  it('復原被引用的第一張黃牌（連帶第二黃）', () => {
    const onUndo = vi.fn(() => true);
    render(<ScorePad {...S4_SCENE_LIVE} onUndo={onUndo} />);
    fireEvent.click(button("12' 黃牌 海風隊 4 周子維"));
    fireEvent.click(button(/^復原/));
    expect(footerOrder()).toEqual([LIVE_COPY.takeoverLater, LIVE_COPY.undoBothConfirm]);
    const confirm = button(LIVE_COPY.undoBothConfirm);
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onUndo).not.toHaveBeenCalled();
    advance(CONFIRM_ARM_MS);
    fireEvent.click(button(LIVE_COPY.undoBothConfirm));
    expect(onUndo).toHaveBeenCalledTimes(2);
  });
});

describe('顧問 §3.459 (a)：紅色提示整行可點', () => {
  const lines = [
    { key: 'held', text: heldRejected(1), alert: false },
    { key: 'queued', text: heldQueued(2), alert: false },
  ] as const;
  it('點紅色那行會開「未套用的動作」面板（和原本那顆鈕同一個）；誤點不送出也不刪除', () => {
    const onReapply = vi.fn();
    const onDiscard = vi.fn();
    render(<ScorePad {...S4_SCENE_LIVE} heldLines={lines} onReapply={onReapply} onDiscard={onDiscard} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const tap = screen.getByRole('button', { name: heldRejected(1) });
    expect(tap.closest('p')?.className).toContain('s4-banner--held');
    fireEvent.click(tap);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent ?? '').toContain(LIVE_COPY.unappliedTitle);
    expect(onReapply).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });
  it('黃色那行不可點；紅色那行只多 s4-banner--tap（方案 B 拿掉 s4-banner--tapq，有沒有第二行都一樣）', () => {
    const { rerender } = render(<ScorePad {...S4_SCENE_LIVE} heldLines={lines} />);
    const yellow = screen.getByText(heldQueued(2));
    expect(yellow.tagName).toBe('P');
    expect(yellow.querySelector('button')).toBeNull();
    // 施工-第2批 3.11：第二行帶自己的 class，高度 700 以下用樣式藏（s4-banner--saved 留著）。
    expect(yellow.className.split(' ')).toContain('s4-banner--queued');
    expect(yellow.className.split(' ')).toContain('s4-banner--saved');
    const red = screen.getByRole('button', { name: heldRejected(1) }).closest('p') as HTMLElement;
    expect(red.className.split(' ').sort()).toEqual(['s4-banner', 's4-banner--held', 's4-banner--tap'].sort());
    rerender(<ScorePad {...S4_SCENE_LIVE} heldLines={[lines[0]]} />);
    const solo = screen.getByRole('button', { name: heldRejected(1) }).closest('p') as HTMLElement;
    expect(solo.className.split(' ').sort()).toEqual(['s4-banner', 's4-banner--held', 's4-banner--tap'].sort());
  });
  it('方案 B：有紅色列時紀錄區不再重複那顆「未套用的動作」，沒有紅色列時照舊', () => {
    const { rerender } = render(<ScorePad {...S4_SCENE_UNAPPLIED} heldLines={lines} />);
    expect(document.querySelector('.s4-extra')).toBeNull();
    rerender(<ScorePad {...S4_SCENE_UNAPPLIED} />);
    expect(document.querySelector('.s4-extra')?.textContent).toContain(LIVE_COPY.unappliedTitle);
    rerender(<ScorePad {...S4_SCENE_UNAPPLIED} heldLines={[lines[1]]} />);
    expect(document.querySelector('.s4-extra')?.textContent).toContain(LIVE_COPY.unappliedTitle);
  });
  it('提示區順序：離線紀錄無法保存在紅色列之上、鎖定提醒在最後', () => {
    render(
      <ScorePad
        {...S4_SCENE_LIVE}
        events={[]}
        heldLines={lines}
        link={{ online: false, pendingCount: 2, storageUnavailable: true, wakeLock: false }}
      />,
    );
    const order = [...document.querySelector('.s4-alerts')!.children].map((node) => node.className.split(' ').slice(1).join(' ') || node.className);
    expect(order[0]).toBe('s4-banner--danger');
    expect(order[1]).toContain('s4-banner--held');
    expect(order[2]).toContain('s4-banner--queued');
    expect(order[order.length - 1]).toBe('s4-wake');
  });
  it('紅色列的樣式：44px 列、沒有往外延伸的 ::after；高度 700 以下藏第二行與讓位的一般級提示', () => {
    const css = readFileSync(join(process.cwd(), 'src/features/competitions/live/live.css'), 'utf8');
    expect(css).not.toMatch(/s4-banner__tap::after/);
    expect(css).not.toMatch(/s4-banner--tapq/);
    expect(css).toMatch(/\.s4-root \.s4-alerts \.s4-banner--tap\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/@media \(max-height: 700px\)\s*\{[^@]*\.s4-alerts \.s4-banner--queued[^{]*\{[^}]*display:\s*none/);
  });
  it('被接手（記分區停用）時紅色那行的按鈕停用，點了不開面板', () => {
    render(<ScorePad {...S4_SCENE_TAKEOVER} heldLines={lines} />);
    const tap = screen.getByText(heldRejected(1)).closest('button') as HTMLButtonElement;
    expect(tap.disabled).toBe(true);
    const before = screen.queryAllByRole('dialog').length;
    fireEvent.click(tap);
    // 被接手時可能開著接手對話框；點紅色那行不會多開「未套用的動作」面板（P3-3：直接數對話框、查面板文字）。
    expect(screen.queryAllByRole('dialog')).toHaveLength(before);
    expect(screen.queryAllByRole('dialog').some((d) => (d.textContent ?? '').includes(LIVE_COPY.unappliedTitle))).toBe(false);
  });
});

describe('被拒擋住送出的提示', () => {
  it('常駐兩行：哪一筆沒送出、之後記的幾筆先存在手機；剛被擋的階段動作用 alert', () => {
    const { rerender } = render(
      <ScorePad
        {...S4_SCENE_LIVE}
        heldLines={[
          { key: 'held', text: heldRejected(1), alert: false },
          { key: 'queued', text: heldQueued(2), alert: false },
        ]}
      />,
    );
    // 顧問 §3.459 (a)：紅色那行的文字包在按鈕裡，role 與樣式在外層 <p>。
    const first = screen.getByText(heldRejected(1)).closest('p') as HTMLElement;
    expect(first.getAttribute('role')).toBe('status');
    expect(first.className).toContain('s4-banner--held');
    expect(screen.getByText(heldQueued(2)).className).toContain('s4-banner--saved');
    rerender(
      <ScorePad
        {...S4_SCENE_LIVE}
        heldLines={[{ key: 'held', text: blockedStep('resume'), alert: true }]}
      />,
    );
    expect(screen.getByText(blockedStep('resume')).closest('p')?.getAttribute('role')).toBe('alert');
    expect(screen.queryByText(heldQueued(2))).toBeNull();
  });

  it('提示文字沒有代號或技術字', () => {
    const texts = [heldRejected(1), heldRejected(3), heldQueued(4),
      blockedStep('kickoff'), blockedStep('halftime'), blockedStep('resume'), blockedStep('fulltime'), blockedStep('undoFinish')];
    for (const text of texts) expect(text).not.toMatch(/佇列|同步|queue|sync|rejected|blocked|[A-Za-z]{3,}/);
    expect(blockedStep('resume')).toBe('先處理沒送出的紀錄，才能開始下半場');
  });
});

describe('看這張牌：先收起事件面板再亮牌，關掉亮牌後面板開回來', () => {
  it('亮牌期間這筆被作廢（他機復原）：關掉亮牌後不開回不存在的面板', () => {
    const { rerender } = render(<ScorePad {...S4_SCENE_LIVE} />);
    fireEvent.click(button("12' 黃牌 海風隊 4 周子維"));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${LIVE_COPY.showCard}`) }));
    const target = S4_SCENE_LIVE.events.find((event) => event.type === 'card' && event.cardType === 'yellow' && Math.floor(event.matchSecond / 60) === 12);
    expect(target).toBeTruthy();
    rerender(<ScorePad {...S4_SCENE_LIVE} voids={[...S4_SCENE_LIVE.voids, { targetSeq: target?.seq ?? -1, seq: 99, createdAt: 1 }]} />);
    fireEvent.click(document.querySelector('.s4-flash') as HTMLElement);
    expect(document.querySelector('.s4-flash')).toBeNull();
    expect(document.querySelector('.s4-sheet')).toBeNull();
  });

  it('亮牌出現時事件面板已關閉、亮牌可互動；關閉後面板回來、焦點回到「看這張牌」', () => {
    render(<ScorePad {...S4_SCENE_LIVE} />);
    fireEvent.click(button("12' 黃牌 海風隊 4 周子維"));
    expect(document.querySelector('.s4-sheet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${LIVE_COPY.showCard}`) }));
    // 事件面板（showModal 的 top layer，背景 inert）不在了，亮牌才不會被蓋住。
    expect(document.querySelector('.s4-sheet')).toBeNull();
    const flash = document.querySelector('.s4-flash') as HTMLElement;
    expect(flash).toBeTruthy();
    expect(flash.closest('[inert]')).toBeNull();
    fireEvent.click(flash);
    expect(document.querySelector('.s4-flash')).toBeNull();
    expect(document.querySelector('.s4-sheet')).toBeTruthy();
    advance(1);
    expect((document.activeElement?.textContent ?? '').trim()).toBe(LIVE_COPY.showCard);
  });
});
