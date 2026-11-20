import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installUi4TestLocale } from '@/ui/ui4-test-helpers';
import { CONFIRM_ARM_MS } from './score-states';
import {
  S4_ACTION_LOG,
  S4_CONFIRMED,
  S4_CREST_URL,
  S4_NOW,
  S4_PEOPLE,
  S4_SCENE_FT,
  S4_SCENE_HT,
  S4_SCENE_LIVE,
  S4_SCENE_OFFLINE,
  S4_SCENE_PAUSED,
  S4_ROSTER_HOME_LONG,
  S4_SCENE_PK,
  S4_SCENE_PK_START,
  S4_SCENE_PRE,
  S4_SCENE_TIMEOUT,
  S4_SCENE_TIMEOUT_COLLAPSED,
  S4_SCENE_UNAPPLIED,
  s4Match,
  type S4ScoreScene,
} from '../testing/step4-fixtures';
import { CardFlash } from './CardFlash';
import { stageLabel } from './clock';
import { LiveMatchView } from './LiveMatchView';
import { LiveScoreBadge } from './LiveScoreBadge';
import { EVENT_MAX, EVENT_RESERVE, EVENT_WARN, PAUSE_MAX, SCORING_RESERVE, TEAM_TIMEOUT_PER_HALF, TEAM_TIMEOUT_SEC, eventLines, linesIfOpen, pauseHeldForScoring, rejectText, shootoutOffered } from './present';
import { ScorePad, type ScorePadProps } from './ScorePad';
import { ScorersTable } from './ScorersTable';
import { derivePublicTable } from './stats';
import type { TimelineEvent } from './types';

installUi4TestLocale();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function button(name: string | RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

function expectOff(name: string | RegExp, off: boolean): void {
  const node = button(name);
  expect(node.disabled).toBe(off);
  expect(node.getAttribute('aria-disabled')).toBe(off ? 'true' : null);
}

function pad(scene: S4ScoreScene, extra: Partial<ScorePadProps> = {}) {
  // 預覽元件測試照舊驗「修正時鐘」選項：給一個 onCorrectClock（正式頁未接上時選項不顯示，另有測試）。
  return render(<ScorePad onCorrectClock={() => undefined} {...scene} {...extra} />);
}


function armConfirm(): void {
  act(() => { vi.advanceTimersByTime(CONFIRM_ARM_MS); });
}

describe('第 4 步預覽元件', () => {
  it('各畫面用假資料渲染不丟錯', () => {
    pad(S4_SCENE_PRE);
    expect(screen.getByRole('button', { name: '開賽' })).toBeTruthy();
    expect(screen.getByText('00:00')).toBeTruthy();
    cleanup();

    pad(S4_SCENE_LIVE);
    expect(screen.getByText('34:00')).toBeTruthy();
    expect(screen.getByText('上半場')).toBeTruthy();
    expect(screen.getByText('已連線')).toBeTruthy();
    expect(screen.getByRole('button', { name: '雷霆隊 進球' })).toBeTruthy();
    cleanup();

    pad(S4_SCENE_HT);
    expect(screen.getByText('中場休息')).toBeTruthy();
    expect(screen.getByRole('button', { name: '下半場開始' })).toBeTruthy();
    cleanup();

    render(
      <>
        <LiveScoreBadge kind="live" />
        <LiveScoreBadge kind="corrected" />
      </>,
    );
    expect(screen.getByText('即時')).toBeTruthy();
    expect(screen.getByText('比分已更正')).toBeTruthy();
    cleanup();

    const { match, clock, events, voids, homeRoster, awayRoster } = S4_SCENE_LIVE;
    render(<LiveMatchView match={match} clock={clock} events={events} voids={voids} homeRoster={homeRoster} awayRoster={awayRoster} />);
    expect(screen.getByRole('button', { name: '比賽紀錄' })).toBeTruthy();
    cleanup();

    const table = derivePublicTable(S4_CONFIRMED, S4_PEOPLE);
    render(<ScorersTable scorers={table.scorers} cards={table.cards} />);
    expect(screen.getByText('劉冠廷')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '紅黃牌' })).toBeTruthy();
  });

  it('背號選擇點下回傳該員 plId', () => {
    const onRecord = vi.fn();
    pad(S4_SCENE_LIVE, { onRecord });
    fireEvent.click(screen.getByRole('button', { name: '雷霆隊 進球' }));
    const pick = document.querySelector('.s4-pick');
    expect(pick?.querySelector('.s4-grid')?.nextElementSibling?.classList.contains('s4-unspecified')).toBe(true);
    const css = readFileSync(join(process.cwd(), 'src/features/competitions/live/live.css'), 'utf8');
    expect(css).toMatch(/\.s4-pick\s*\{[^}]*gap:\s*16px/);
    fireEvent.click(screen.getByRole('button', { name: '9 劉冠廷' }));
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onRecord).toHaveBeenCalledWith({
      side: 'home',
      action: 'goal',
      plId: 'pl_th9',
      goalKind: 'normal',
      minute: 34,
    });
  });

  it('亮牌顯示事件裡的背號與名字；第二張黃牌是紅底', () => {
    const view = pad(S4_SCENE_LIVE);
    fireEvent.click(screen.getByRole('button', { name: "12' 黃牌 海風隊 4 周子維" }));
    fireEvent.click(screen.getByRole('button', { name: /^看這張牌/ }));
    const yellow = view.container.querySelector('.s4-flash');
    expect(yellow?.classList.contains('s4-flash--yellow')).toBe(true);
    expect(yellow?.getAttribute('role')).toBe('dialog');
    expect(yellow?.textContent).toContain('4');
    expect(yellow?.textContent).toContain('周子維');
    expect(yellow?.textContent).toContain('黃牌');
    expect(yellow?.textContent).not.toContain('第二張黃牌');

    fireEvent.click(screen.getByRole('button', { name: "31' 第二張黃牌 海風隊 4 周子維" }));
    fireEvent.click(screen.getByRole('button', { name: /^看這張牌/ }));
    const red = view.container.querySelector('.s4-flash');
    expect(red?.classList.contains('s4-flash--red')).toBe(true);
    expect(red?.textContent).toContain('4');
    expect(red?.textContent).toContain('周子維');
    expect(red?.textContent).toContain('第二張黃牌 → 紅牌');
  });

  it('直接渲染的第二張黃牌也是紅底文字', () => {
    const view = render(
      <CardFlash number={4} name="周子維" tone="red" secondYellow onClose={() => {}} />,
    );
    const flash = view.container.querySelector('.s4-flash');
    expect(flash?.classList.contains('s4-flash--red')).toBe(true);
    expect(flash?.textContent).toContain('第二張黃牌 → 紅牌');
  });

  it('未套用清單的重新套用與捨棄各觸發一次，場次已鎖不能重新套用', () => {
    const onReapply = vi.fn();
    const onDiscard = vi.fn();
    pad(S4_SCENE_UNAPPLIED, { onReapply, onDiscard });
    fireEvent.click(screen.getByRole('button', { name: '未套用的動作' }));
    const reapply = screen.getAllByRole('button', { name: /^重新套用/ });
    const discard = screen.getAllByRole('button', { name: /^捨棄/ });
    expect(reapply).toHaveLength(2);
    expect(discard).toHaveLength(3);
    expect(screen.queryByRole('button', { name: "重新套用 雷霆 8 號 33' 黃牌" })).toBeNull();
    expect(screen.getByRole('button', { name: "重新套用 海風 10 號 33' 進球" })).toBeTruthy();
    expect(screen.getByRole('button', { name: "捨棄 雷霆 8 號 33' 黃牌" })).toBeTruthy();
    const firstReapply = reapply[0];
    const firstDiscard = discard[0];
    if (!firstReapply || !firstDiscard) throw new Error('找不到重新套用或捨棄');
    fireEvent.click(firstReapply);
    fireEvent.click(firstDiscard);
    expect(onReapply).toHaveBeenCalledTimes(1);
    expect(onReapply).toHaveBeenCalledWith('a5');
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledWith('a6');
  });

  it('撤回倒數由 finishedAt 算出', () => {
    pad(S4_SCENE_FT);
    expect(screen.getByText('2:41 內可撤回')).toBeTruthy();
    cleanup();
    render(
      <ScorePad
        {...S4_SCENE_FT}
        match={{ ...S4_SCENE_FT.match, finishedAt: S4_NOW - 60_000 }}
      />,
    );
    expect(screen.getByText('2:00 內可撤回')).toBeTruthy();
  });

  it('觀眾紀錄預設收起，展開後不顯示作廢進球', () => {
    const { match, clock, events, voids, homeRoster, awayRoster } = S4_SCENE_LIVE;
    render(<LiveMatchView match={match} clock={clock} events={events} voids={voids} homeRoster={homeRoster} awayRoster={awayRoster} />);
    expect(screen.queryByText(/劉冠廷/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '比賽紀錄' }));
    expect(screen.getAllByText(/劉冠廷/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/張宇軒/)).toBeNull();
  });

  it('射手榜未成年只顯示姓氏', () => {
    render(
      <ScorersTable
        scorers={[{ rank: 1, plId: 'pl_cat15', displayName: '陳小弟', isMinor: true, teamName: '山貓隊', goals: 1 }]}
        cards={[]}
      />,
    );
    expect(screen.getByText('陳')).toBeTruthy();
    expect(screen.queryByText('陳小弟')).toBeNull();
  });

  it('離線儲存不可用是醒目警告；儲存可用則寫已存幾筆', () => {
    pad(S4_SCENE_OFFLINE);
    expect(screen.getByRole('alert').textContent).toContain('離線紀錄無法保存，斷網時記的動作重整後會消失');
    expect(screen.getByText('請關閉手機自動鎖定')).toBeTruthy();
    expect(screen.getByText('離線・2 筆待送')).toBeTruthy();
    cleanup();
    render(
      <ScorePad
        {...S4_SCENE_OFFLINE}
        link={{ ...S4_SCENE_OFFLINE.link, storageUnavailable: false }}
      />,
    );
    expect(screen.getByText('離線中，已存 2 筆，恢復網路會自動送出')).toBeTruthy();
  });

  it('補時基準固定，秒數再走階段文字也不變', () => {
    expect(stageLabel({ elapsedSec: 20 * 60, period: 'h1', addedMin: 2 })).toBe("45+2'");
    expect(stageLabel({ elapsedSec: 46 * 60 + 10, period: 'h1', addedMin: 2 })).toBe("45+2'");
    expect(stageLabel({ elapsedSec: 20 * 60 + 30, period: 'h1', addedMin: 2, periodBaseMin: 20 })).toBe("20+2'");
    render(
      <ScorePad
        {...S4_SCENE_LIVE}
        match={{
          ...S4_SCENE_LIVE.match,
          clockBase: {
            startedAt: S4_NOW - (20 * 60 + 30) * 1000,
            pausedSec: 0,
            running: true,
            period: 'h1',
          },
        }}
        clock={{ elapsedSec: 20 * 60 + 30, period: 'h1', addedMin: 2, periodBaseMin: 20 }}
      />,
    );
    expect(screen.getByText("20+2'")).toBeTruthy();
    expect(screen.getByText('20:30')).toBeTruthy();
  });

  it('比分列與兩隊欄位：有網址的隊顯示圖，沒有的顯示首字', () => {
    const view = pad(S4_SCENE_LIVE);
    // 比分列與進球上方隊名標籤各一組隊徽，規則相同。
    for (const zone of ['.s4-top', '.s4-tags']) {
      const box = view.container.querySelector(zone)!;
      const imgs = [...box.querySelectorAll('img.cp3-crest')];
      expect(imgs).toHaveLength(1);
      expect(imgs.every((img) => img.getAttribute('src') === S4_CREST_URL)).toBe(true);
      const initials = [...box.querySelectorAll('.cp3-crest--txt')].map((node) => node.textContent);
      expect(initials.filter((text) => text === '海')).toHaveLength(1);
      expect(initials.includes('雷')).toBe(false);
    }
    cleanup();

    const { match, clock, events, voids, homeRoster, awayRoster, crests } = S4_SCENE_LIVE;
    const page = render(
      <LiveMatchView
        match={match}
        clock={clock}
        events={events}
        voids={voids}
        homeRoster={homeRoster}
        awayRoster={awayRoster}
        crests={crests}
      />,
    );
    expect(page.container.querySelectorAll('img.cp3-crest')).toHaveLength(1);
    expect(page.container.querySelector('.cp3-crest--txt')?.textContent).toBe('海');
  });

  it('停錶凍結主時鐘，已停錶每秒加 1，繼續只改 clockBase', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const onClock = vi.fn();
    const onRecord = vi.fn();
    pad(S4_SCENE_LIVE, { onClock, onRecord });
    fireEvent.click(button('停錶・剩20'));
    expect(onClock).toHaveBeenCalledWith({
      startedAt: S4_NOW,
      pausedSec: 34 * 60,
      running: false,
      period: 'h1',
    });
    expect(onRecord).not.toHaveBeenCalled();
    expect(screen.getByText('34:00')).toBeTruthy();
    expect(screen.getByText('已停錶 00:00')).toBeTruthy();
    expect(button('繼續計時')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('34:00')).toBeTruthy();
    expect(screen.getByText('已停錶 00:01')).toBeTruthy();
  });

  it('停錶中畫面是 34:00 與已停錶 01:23，繼續後恢復走時', () => {
    const onClock = vi.fn();
    pad(S4_SCENE_PAUSED, { onClock });
    expect(screen.getByText('34:00')).toBeTruthy();
    expect(screen.getByText('已停錶 01:23')).toBeTruthy();
    expect(screen.queryByText(/已休息/)).toBeNull();
    fireEvent.click(button('繼續計時'));
    expect(onClock).toHaveBeenCalledWith({
      startedAt: S4_NOW,
      pausedSec: 34 * 60,
      running: true,
      period: 'h1',
    });
    expect(button('停錶・剩20')).toBeTruthy();
    expect(screen.queryByText(/已停錶/)).toBeNull();
  });

  it('中場進球停用、牌可按，並顯示已休息', () => {
    const view = pad(S4_SCENE_HT);
    expect(screen.getByText('45:00')).toBeTruthy();
    expect(screen.getByText('已休息 08:00')).toBeTruthy();
    expectOff('雷霆隊 進球', true);
    expectOff('海風隊 進球', true);
    expectOff('雷霆隊 黃牌', false);
    expectOff('雷霆隊 紅牌', false);
    expect(screen.queryByRole('button', { name: '繼續計時' })).toBeNull();
    expect(screen.queryByRole('button', { name: '終場' })).toBeNull();
    const ctrl = [...view.container.querySelector('.s4-ctrl')!.children].map((node) => {
      if (node.classList.contains('s4-menu-wrap')) return 'menu';
      return (node.textContent || '').trim();
    });
    expect(ctrl).toEqual(['下半場開始', 'menu']);
    fireEvent.click(button('雷霆隊 進球'));
    expect(screen.queryByText('不指定球員')).toBeNull();
    fireEvent.click(button('雷霆隊 黃牌'));
    expect(screen.getByRole('button', { name: '4 林志遠' })).toBeTruthy();
  });

  it('改判先復原再記新的；只成功一半就列入未套用', () => {
    const onUndo = vi.fn(() => true);
    const onRecord = vi.fn(() => false);
    pad(S4_SCENE_LIVE, { onUndo, onRecord });
    fireEvent.click(button("5' 進球 雷霆隊 9 劉冠廷"));
    expect(screen.getByText('會先復原原紀錄，再記新的')).toBeTruthy();
    fireEvent.click(button('點球'));
    fireEvent.click(button('10 蔡明哲'));
    fireEvent.click(button(/^改判/));
    expect(onUndo).toHaveBeenCalledWith(2);
    expect(onRecord).toHaveBeenCalledWith({
      side: 'home',
      action: 'goal',
      plId: 'pl_th10',
      goalKind: 'penalty',
      minute: 5,
      matchSecond: 5 * 60 + 12,
    });
    expect(screen.getByRole('alert').textContent).toContain('原紀錄已復原，新紀錄未送出');
    fireEvent.click(button('未套用的動作'));
    expect(screen.getByText("雷霆隊 10 號 5' 點球")).toBeTruthy();
  });

  it('改判被引用的第一張黃牌先確認，再依序復原第二黃、第一黃、記新的', () => {
    // 不能復原的確認框打開後 CONFIRM_ARM_MS 內確認鈕停用（防連點），這裡用假時鐘走過去。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onUndo = vi.fn(() => true);
    const onRecord = vi.fn(() => true);
    pad(S4_SCENE_LIVE, { onUndo, onRecord });
    fireEvent.click(button("12' 黃牌 海風隊 4 周子維"));
    fireEvent.click(button('紅牌'));
    fireEvent.click(button(/^改判/));
    expect(screen.getByText('會一併復原第二張黃牌')).toBeTruthy();
    expect(onUndo).not.toHaveBeenCalled();
    expect(onRecord).not.toHaveBeenCalled();
    armConfirm();
    fireEvent.click(button('確定改判'));
    expect(onUndo.mock.calls).toEqual([[7], [3]]);
    expect(onRecord).toHaveBeenCalledWith({
      side: 'away',
      action: 'red',
      plId: 'pl_hf4',
      goalKind: null,
      minute: 12,
      refSeq: null,
      matchSecond: 12 * 60 + 40,
    });
    cleanup();

    const failSecond = vi.fn(() => false);
    const noRecord = vi.fn();
    pad(S4_SCENE_LIVE, { onUndo: failSecond, onRecord: noRecord });
    fireEvent.click(button("12' 黃牌 海風隊 4 周子維"));
    fireEvent.click(button(/^改判/));
    armConfirm();
    fireEvent.click(button('確定改判'));
    expect(failSecond.mock.calls).toEqual([[7]]);
    expect(noRecord).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('第二張黃牌沒有復原');
    cleanup();

    const failFirst = vi.fn((seq: number) => seq === 7);
    pad(S4_SCENE_LIVE, { onUndo: failFirst, onRecord: noRecord });
    fireEvent.click(button("12' 黃牌 海風隊 4 周子維"));
    fireEvent.click(button(/^改判/));
    armConfirm();
    fireEvent.click(button('確定改判'));
    expect(failFirst.mock.calls).toEqual([[7], [3]]);
    expect(noRecord).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('第二張黃牌已復原，第一張黃牌仍在');
  });

  it('同人還有未被引用的黃牌才亮第二張黃牌，並帶回 refSeq', () => {
    const pending = S4_ACTION_LOG.find((entry) => entry.id === 'a3');
    const onRecord = vi.fn();
    pad(S4_SCENE_LIVE, { onRecord, actionLog: pending ? [pending] : [] });
    fireEvent.click(button('雷霆隊 黃牌'));
    fireEvent.click(button('5 黃柏翰'));
    expect(onRecord).toHaveBeenCalledWith({
      side: 'home',
      action: 'yellow',
      plId: 'pl_th5',
      goalKind: null,
      minute: 34,
      refSeq: 8,
    });
    const flash = document.querySelector('.s4-flash');
    expect(flash?.classList.contains('s4-flash--red')).toBe(true);
    expect(flash?.textContent).toContain('第二張黃牌 → 紅牌');
    cleanup();

    const onRecordPlain = vi.fn();
    pad(S4_SCENE_LIVE, { onRecord: onRecordPlain });
    fireEvent.click(button('海風隊 黃牌'));
    fireEvent.click(button('4 周子維'));
    expect(onRecordPlain).toHaveBeenCalledWith({
      side: 'away',
      action: 'yellow',
      plId: 'pl_hf4',
      goalKind: null,
      minute: 34,
      refSeq: null,
    });
    expect(document.querySelector('.s4-flash')?.classList.contains('s4-flash--yellow')).toBe(true);
  });

  it('復原被引用的第一張黃牌先確認，依序復原第二黃再第一黃', () => {
    // 不能復原的確認框打開後 CONFIRM_ARM_MS 內確認鈕停用（防連點），這裡用假時鐘走過去。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onUndo = vi.fn();
    pad(S4_SCENE_LIVE, { onUndo });
    fireEvent.click(button("12' 黃牌 海風隊 4 周子維"));
    fireEvent.click(button(/^復原/));
    expect(screen.getByText('會一併復原第二張黃牌')).toBeTruthy();
    expect(onUndo).not.toHaveBeenCalled();
    armConfirm();
    fireEvent.click(button('確定復原'));
    expect(onUndo.mock.calls).toEqual([[7], [3]]);
    cleanup();

    const onUndoHalf = vi.fn((seq: number) => seq === 7);
    pad(S4_SCENE_LIVE, { onUndo: onUndoHalf });
    fireEvent.click(button("12' 黃牌 海風隊 4 周子維"));
    fireEvent.click(button(/^復原/));
    armConfirm();
    fireEvent.click(button('確定復原'));
    expect(onUndoHalf.mock.calls).toEqual([[7], [3]]);
    expect(screen.getByRole('alert').textContent).toContain('第二張黃牌已復原，第一張黃牌仍在');
    cleanup();

    const failFirstStep = vi.fn(() => false);
    pad(S4_SCENE_LIVE, { onUndo: failFirstStep });
    fireEvent.click(button("12' 黃牌 海風隊 4 周子維"));
    fireEvent.click(button(/^復原/));
    armConfirm();
    fireEvent.click(button('確定復原'));
    expect(failFirstStep.mock.calls).toEqual([[7]]);
    expect(screen.getByRole('alert').textContent).toContain('第二張黃牌沒有復原');
  });

  it('129 還能停錶，131 起為記分停用停錶', () => {
    expect(EVENT_MAX).toBe(200);
    expect(EVENT_WARN).toBe(180);
    expect(EVENT_RESERVE).toBe(190);
    expect(SCORING_RESERVE).toBe(70);
    expect(PAUSE_MAX).toBe(20);
    expect(pauseHeldForScoring(129)).toBe(false);
    expect(pauseHeldForScoring(130)).toBe(false);
    expect(pauseHeldForScoring(131)).toBe(true);

    pad(S4_SCENE_LIVE, { eventCount: 129 });
    expect(screen.queryByText('為保留記分額度，停錶已停用')).toBeNull();
    expect(screen.queryByText('本場紀錄接近上限')).toBeNull();
    expectOff('停錶・剩20', false);
    expectOff('雷霆隊 進球', false);
    cleanup();

    pad(S4_SCENE_LIVE, { eventCount: 131 });
    expect(screen.getByText('為保留記分額度，停錶已停用')).toBeTruthy();
    expect(screen.queryByText('本場紀錄接近上限')).toBeNull();
    expect(screen.queryByText('紀錄已達上限，請由主辦在賽後登錄比分')).toBeNull();
    expectOff('停錶・剩20', true);
    expectOff('雷霆隊 進球', false);
    expectOff('雷霆隊 黃牌', false);
    expectOff('半場', false);
    expectOff('終場', false);
    cleanup();

    pad(S4_SCENE_PAUSED, { eventCount: 131 });
    expectOff('繼續計時', false);
  });

  it('179／180 接近上限仍可記，189／190 起只留比賽控制，199／200 連比賽控制也停', () => {
    pad(S4_SCENE_LIVE, { eventCount: 179 });
    expect(screen.queryByText('本場紀錄接近上限')).toBeNull();
    expectOff('雷霆隊 進球', false);
    expectOff('停錶・剩20', true);
    cleanup();

    pad(S4_SCENE_LIVE, { eventCount: 180 });
    expect(screen.getByText('本場紀錄接近上限')).toBeTruthy();
    expect(screen.getByText('為保留記分額度，停錶已停用')).toBeTruthy();
    expect(screen.queryByText('紀錄已達上限，請由主辦在賽後登錄比分')).toBeNull();
    expectOff('雷霆隊 進球', false);
    expectOff('雷霆隊 黃牌', false);
    expectOff('停錶・剩20', true);
    cleanup();

    pad(S4_SCENE_LIVE, { eventCount: 189 });
    expect(screen.getByText('本場紀錄接近上限')).toBeTruthy();
    expect(screen.queryByText('紀錄已達上限，請由主辦在賽後登錄比分')).toBeNull();
    expectOff('海風隊 紅牌', false);
    cleanup();

    pad(S4_SCENE_LIVE, { eventCount: 190 });
    expect(screen.queryByText('本場紀錄接近上限')).toBeNull();
    expect(screen.getByText('紀錄已達上限，請由主辦在賽後登錄比分')).toBeTruthy();
    expect(screen.getByText('為保留記分額度，停錶已停用')).toBeTruthy();
    expectOff('雷霆隊 進球', true);
    expectOff('雷霆隊 黃牌', true);
    expectOff('雷霆隊 紅牌', true);
    expectOff('半場', false);
    expectOff('終場', false);
    expectOff('停錶・剩20', true);
    fireEvent.click(button('選單'));
    expectOff('修正時鐘', true);
    fireEvent.click(button("5' 進球 雷霆隊 9 劉冠廷"));
    expectOff(/^復原/, true);
    expectOff(/^改判/, true);
    cleanup();

    pad(S4_SCENE_LIVE, { eventCount: 199 });
    expectOff('半場', false);
    expectOff('終場', false);
    expectOff('選單', false);
    expectOff('雷霆隊 進球', true);
    cleanup();

    pad(S4_SCENE_LIVE, { eventCount: 200 });
    expectOff('半場', true);
    expectOff('終場', true);
    expectOff('停錶・剩20', true);
    expectOff('選單', true);
    fireEvent.click(button("12' 黃牌 海風隊 4 周子維"));
    expectOff(/^看這張牌/, false);
    cleanup();

    pad(S4_SCENE_PRE, { eventCount: 200 });
    expectOff('開賽', true);
    cleanup();

    pad(S4_SCENE_FT, { eventCount: 190 });
    expectOff('撤回終場', false);
    cleanup();
    pad(S4_SCENE_FT, { eventCount: 200 });
    expectOff('撤回終場', true);
    cleanup();

    pad(S4_SCENE_LIVE, { match: s4Match({ rev: 210, resetRev: 30 }) });
    expect(screen.getByText('本場紀錄接近上限')).toBeTruthy();
    cleanup();
    pad(S4_SCENE_LIVE, { match: s4Match({ rev: 200, resetRev: 69 }) });
    expect(screen.getByText('為保留記分額度，停錶已停用')).toBeTruthy();
    expectOff('停錶・剩20', true);
  });

  it('停錶用到第 20 次後停用，繼續不扣次數', () => {
    const onClock = vi.fn();
    pad(S4_SCENE_LIVE, { onClock });
    for (let left = PAUSE_MAX; left >= 1; left -= 1) {
      fireEvent.click(button(`停錶・剩${left}`));
      expect(button('繼續計時').disabled).toBe(false);
      fireEvent.click(button('繼續計時'));
    }
    expect(onClock).toHaveBeenCalledTimes(PAUSE_MAX * 2);
    expectOff('停錶・剩0', true);
    onClock.mockClear();
    fireEvent.click(button('停錶・剩0'));
    expect(onClock).not.toHaveBeenCalled();
    cleanup();

    pad(S4_SCENE_LIVE, { pauseUses: 20 });
    expectOff('停錶・剩0', true);
    cleanup();
    const resume = vi.fn();
    pad(S4_SCENE_PAUSED, { pauseUses: 20, onClock: resume });
    expectOff('繼續計時', false);
    fireEvent.click(button('繼續計時'));
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ running: true }));
  });

  it('由上到下是頂列、紀錄、進球、牌、底欄', () => {
    const view = pad(S4_SCENE_LIVE);
    const order = [...view.container.querySelector('.s4-root')!.children].map((node) => node.className.split(' ')[0]);
    expect(order).toEqual(['s4-top', 's4-feed', 's4-pad', 's4-dock']);
    const padOrder = [...view.container.querySelector('.s4-pad')!.children].map((node) => node.className.split(' ')[0]);
    expect(padOrder).toEqual(['s4-tags', 's4-goals', 's4-cards', 's4-pad__rule']);
    expect(view.container.querySelector('.s4-root')?.className).toBe('s4-root');
    expect(view.container.querySelectorAll('.s4-feed .s4-ev')).toHaveLength(5);
    expect(view.container.querySelector('.s4-ev .ui-button')).toBeNull();
    expect(screen.queryByRole('button', { name: /^復原/ })).toBeNull();
    const ctrl = [...view.container.querySelector('.s4-ctrl')!.children].map((node) => {
      if (node.classList.contains('s4-ctrl__gap')) return 'gap';
      if (node.classList.contains('s4-menu-wrap')) return 'menu';
      return (node.textContent || '').trim();
    });
    expect(ctrl).toEqual(['半場', '停錶・剩20', 'menu', 'gap', '終場']);
    expect(view.container.querySelector('.s4-ctrl .s4-end')?.textContent).toBe('終場');
    cleanup();

    const off = pad(S4_SCENE_OFFLINE);
    const offOrder = [...off.container.querySelector('.s4-root')!.children].map((node) => node.className.split(' ')[0]);
    expect(offOrder).toEqual(['s4-top', 's4-alerts', 's4-feed', 's4-pad', 's4-dock']);
    cleanup();

    const pre = pad(S4_SCENE_PRE);
    const kick = pre.container.querySelector('.s4-kickoff');
    expect(kick?.textContent).toBe('開賽');
    expect(pre.container.querySelector('.s4-ctrl')?.textContent).not.toContain('開賽');
    cleanup();

    const css = readFileSync(join(process.cwd(), 'src/features/competitions/live/live.css'), 'utf8');
    expect(css).not.toMatch(/s4-root--thumb/);
    expect(css).toMatch(/\.s4-top\s*\{[^}]*max-height:\s*96px/);
    // 觀眾即時頁共用的舊規則不動（32／22）；記分頁的板子掛在 .s4-top 底下，比分與時鐘 40px（站長已同意字級破例，施工-第2批 3.1）。
    expect(css).toMatch(/\.s4-clock\s*\{[^}]*font-size:\s*32px/);
    expect(css).toMatch(/\.s4-score\s*\{[^}]*font-size:\s*22px/);
    expect(css).toMatch(/\.s4-top \.s4-clock\s*\{[^}]*font-size:\s*40px/);
    expect(css).toMatch(/\.s4-top \.s4-score\s*\{[^}]*font-size:\s*40px/);
    expect(css).toMatch(/\.s4-goals\s*\{[^}]*height:\s*104px/);
    expect(css).toMatch(/\.s4-hit--goal,\s*\n\.s4-hit--pk\s*\{[^}]*height:\s*104px/);
    expect(css).toMatch(/\.s4-cards\s*\{[^}]*height:\s*56px/);
    expect(css).toMatch(/\.s4-hit--card\s*\{[^}]*height:\s*56px/);
    expect(css).toMatch(/\.s4-ev\s*\{[^}]*min-height:\s*48px/);
    expect(css).toMatch(/\.s4-ctrl\s*\{[^}]*height:\s*56px/);
    expect(css).toMatch(/\.s4-ctrl \.ui-button\s*\{[^}]*min-height:\s*48px/);
    expect(css).toMatch(/\.s4-root \.ui-button \.ui-text,\s*\n\.s4-page \.ui-button \.ui-text,\s*\n\.s4-sheet \.ui-button \.ui-text,\s*\n\.s4-dialog \.ui-button \.ui-text\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.s4-hold\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.s4-banner,\s*\n\.s4-wake\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.s4-ctrl__gap\s*\{[^}]*min-width:\s*16px/);
    expect(css).toMatch(/\.s4-feed\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.s4-kickoff\s*\{[^}]*width:\s*100%[^}]*height:\s*104px/);
    expect(css).toMatch(/\.s4-timeout\s*\{[^}]*min-height:\s*48px/);
    // 收合條 24 改 30px、高度 600 以下 32px（施工-第2批 3.14；顧問同意），可點延伸等於區塊間距、合計 44 以上。
    expect(css).toMatch(/\.s4-timeout--mini\s*\{[^}]*height:\s*30px/);
    expect(css).toMatch(/@media \(max-height: 600px\)\s*\{[^@]*\.s4-timeout--mini\s*\{[^}]*height:\s*32px/);
    expect(css).not.toMatch(/\.s4-timeout\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/\.s4-sheet--long\.ui-bottom-sheet \.ui-modal__panel\s*\{[^}]*max-height:\s*58dvh/);
  });

  it('超過 8 人的背號面板才加長卷類名', () => {
    pad(S4_SCENE_LIVE);
    fireEvent.click(button('雷霆隊 進球'));
    expect(document.querySelector('.s4-sheet')?.classList.contains('s4-sheet--long')).toBe(false);
    cleanup();

    pad(S4_SCENE_LIVE, { homeRoster: S4_ROSTER_HOME_LONG });
    fireEvent.click(button('雷霆隊 進球'));
    expect(document.querySelector('.s4-sheet')?.classList.contains('s4-sheet--long')).toBe(true);
    expect(button('18 董禾')).toBeTruthy();
    expect(button('不指定球員')).toBeTruthy();
    const numbers = [...document.querySelectorAll('.s4-pl__no')].map((node) => Number(node.textContent));
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it('已確認場次不能撤回終場', () => {
    pad(S4_SCENE_FT, { match: { ...S4_SCENE_FT.match, status: 'confirmed' } });
    expect(screen.queryByRole('button', { name: '撤回終場' })).toBeNull();
    expect(screen.queryByText('終場已送出')).toBeNull();
    cleanup();
    pad(S4_SCENE_FT);
    expect(button('撤回終場')).toBeTruthy();
  });

  it('選單是 disclosure，Esc 關閉', () => {
    pad(S4_SCENE_LIVE);
    const menu = button('選單');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(button('修正時鐘')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '修正時鐘' })).toBeNull();
    expect(button('選單').getAttribute('aria-expanded')).toBe('false');
  });

  it('亮牌是對話框，Esc 關閉後焦點回到原按鈕', async () => {
    pad(S4_SCENE_LIVE);
    const yellow = button('雷霆隊 黃牌');
    yellow.focus();
    fireEvent.click(yellow);
    fireEvent.click(button('4 林志遠'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toContain('黃牌');
    expect(document.activeElement).toBe(dialog);
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(false);
    expect(fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(yellow);
  });

  it('未知拒因顯示被拒', () => {
    expect(rejectText('mystery')).toBe('被拒');
    expect(rejectText(undefined)).toBe('被拒');
    pad(S4_SCENE_LIVE, {
      actionLog: [{
        id: 'ax',
        intent: "雷霆 8 號 33' 黃牌",
        state: 'rejected',
        rejectReason: 'mystery',
        at: S4_NOW - 1000,
      }],
    });
    fireEvent.click(button('未套用的動作'));
    expect(screen.getByText('被拒')).toBeTruthy();
    expect(screen.queryByText('被拒：已被接手')).toBeNull();
  });

  it('觀眾時間軸依比賽秒數再依 seq；收起時不計算', () => {
    const events: TimelineEvent[] = [
      { seq: 1, type: 'goal', side: 'home', plId: 'pl_th9', goalKind: 'normal', matchSecond: 10 * 60, createdAt: 1 },
      { seq: 2, type: 'goal', side: 'away', plId: 'pl_hf10', goalKind: 'normal', matchSecond: 20 * 60, createdAt: 2 },
      { seq: 3, type: 'goal', side: 'home', plId: 'pl_th10', goalKind: 'normal', matchSecond: 60, createdAt: 3 },
    ];
    const recent = eventLines({
      events,
      voids: [],
      homeName: '雷霆隊',
      awayName: '海風隊',
      homeRoster: S4_SCENE_LIVE.homeRoster,
      awayRoster: S4_SCENE_LIVE.awayRoster,
      hideVoided: false,
      order: 'recent',
    }).map((line) => line.seq);
    expect(recent).toEqual([3, 2, 1]);
    const timeline = eventLines({
      events,
      voids: [],
      homeName: '雷霆隊',
      awayName: '海風隊',
      homeRoster: S4_SCENE_LIVE.homeRoster,
      awayRoster: S4_SCENE_LIVE.awayRoster,
      hideVoided: true,
      order: 'timeline',
    }).map((line) => line.seq);
    expect(timeline).toEqual([3, 1, 2]);

    const { match, clock, homeRoster, awayRoster } = S4_SCENE_LIVE;
    const view = render(
      <LiveMatchView
        match={match}
        clock={clock}
        events={events}
        voids={[]}
        homeRoster={homeRoster}
        awayRoster={awayRoster}
      />,
    );
    expect(screen.queryByText(/蔡明哲/)).toBeNull();
    fireEvent.click(button('比賽紀錄'));
    // 新外觀卡 3-5：事件列換成觀眾頁自己的 .cp-ev（原本 .s4-ev__main）
    const rows = [...view.container.querySelectorAll('.cp-ev')].map((node) => node.textContent);
    expect(rows.map((text) => text?.includes('蔡明哲'))).toEqual([true, false, false]);
    expect(rows.map((text) => text?.includes('劉冠廷'))).toEqual([false, true, false]);
    expect(rows.map((text) => text?.includes('謝東霖'))).toEqual([false, false, true]);
    expect(view.container.querySelector('.s4-sr')?.textContent).toContain('進球');
    cleanup();

    const trap = new Proxy([] as TimelineEvent[], {
      get() {
        throw new Error('收起時不該讀事件');
      },
    });
    expect(linesIfOpen(false, {
      events: trap,
      voids: [],
      homeName: '雷霆隊',
      awayName: '海風隊',
      homeRoster: [],
      awayRoster: [],
      hideVoided: true,
      order: 'timeline',
    })).toEqual([]);
    expect(() => render(
      <LiveMatchView
        match={match}
        clock={clock}
        events={trap}
        voids={[]}
        homeRoster={homeRoster}
        awayRoster={awayRoster}
      />,
    )).not.toThrow();
  });

  it('開賽前、終場撤回與已確認不能點開復原或改判', () => {
    const pre = pad(S4_SCENE_PRE, { events: S4_SCENE_LIVE.events, voids: S4_SCENE_LIVE.voids });
    expect(screen.queryByRole('button', { name: "5' 進球 雷霆隊 9 劉冠廷" })).toBeNull();
    const mains = [...pre.container.querySelectorAll('.s4-ev__main')].map((node) => node.textContent ?? '');
    const sr = [...pre.container.querySelectorAll('.s4-sr')].map((node) => node.textContent ?? '');
    expect(mains.some((text) => text.includes('劉冠廷'))).toBe(true);
    expect(sr.some((text) => text.includes("5' 進球 雷霆隊 9 劉冠廷"))).toBe(true);
    cleanup();

    pad(S4_SCENE_FT);
    expect(screen.queryByRole('button', { name: "5' 進球 雷霆隊 9 劉冠廷" })).toBeNull();
    cleanup();

    pad(S4_SCENE_FT, { match: { ...S4_SCENE_FT.match, status: 'confirmed' } });
    expect(screen.queryByRole('button', { name: "5' 進球 雷霆隊 9 劉冠廷" })).toBeNull();
    cleanup();

    pad(S4_SCENE_HT);
    fireEvent.click(button("5' 進球 雷霆隊 9 劉冠廷"));
    expect(button(/^復原/)).toBeTruthy();
    expect(button(/^改判/)).toBeTruthy();
  });

  it('球隊暫停倒數在紀錄上方，結束與歸零都不改時鐘', async () => {
    expect(TEAM_TIMEOUT_PER_HALF).toBe(1);
    expect(TEAM_TIMEOUT_SEC).toBe(60);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const onClock = vi.fn();
    const onRecord = vi.fn();
    pad(S4_SCENE_LIVE, { onClock, onRecord });
    fireEvent.click(button('選單'));
    fireEvent.click(button('球隊暫停'));
    expect(screen.getByText('每半場重新計算')).toBeTruthy();
    expect(button('雷霆隊 剩 1 次')).toBeTruthy();
    expect(button('海風隊 剩 1 次')).toBeTruthy();
    fireEvent.click(button('雷霆隊 剩 1 次'));
    expect(screen.getByText('雷霆隊暫停 1:00')).toBeTruthy();
    expect(button('結束暫停')).toBeTruthy();
    expect(button('收合')).toBeTruthy();
    fireEvent.click(button('雷霆隊 黃牌'));
    expect(button('4 林志遠')).toBeTruthy();
    fireEvent.click(button("5' 進球 雷霆隊 9 劉冠廷"));
    expect(screen.getByText('會先復原原紀錄，再記新的')).toBeTruthy();
    fireEvent.click(button('收合'));
    expect(screen.queryByRole('button', { name: '結束暫停' })).toBeNull();
    fireEvent.click(button('雷霆隊暫停 1:00'));
    expect(button('結束暫停')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('繼續計時')).toBeTruthy();
    expect(onClock).not.toHaveBeenCalled();
    expect(onRecord).not.toHaveBeenCalled();
    fireEvent.click(button('結束暫停'));
    expect(screen.queryByText('繼續計時')).toBeNull();

    fireEvent.click(button('選單'));
    fireEvent.click(button('球隊暫停'));
    expect(screen.getByText('已超過規則次數（由主辦現場判斷）')).toBeTruthy();
    expect(button('雷霆隊 剩 0 次').disabled).toBe(false);
    fireEvent.click(button('雷霆隊 剩 0 次'));
    expect(screen.getByText('雷霆隊暫停 1:00')).toBeTruthy();
    // 顧問 §3.498：暫停條不再多「已超過規則次數」那一行（選隊面板裡那一句照舊，見上面）
    expect(screen.queryByText('已超過規則次數（由主辦現場判斷）')).toBeNull();
    cleanup();

    const again = pad(S4_SCENE_LIVE);
    fireEvent.click(button('選單'));
    fireEvent.click(button('球隊暫停'));
    fireEvent.click(button('雷霆隊 剩 1 次'));
    again.rerender(
      <ScorePad
        {...S4_SCENE_LIVE}
        match={{
          ...S4_SCENE_LIVE.match,
          clockBase: { ...S4_SCENE_LIVE.match.clockBase, period: 'h2' },
        }}
      />,
    );
    fireEvent.click(button('結束暫停'));
    fireEvent.click(button('選單'));
    fireEvent.click(button('球隊暫停'));
    expect(button('雷霆隊 剩 1 次')).toBeTruthy();
    expect(screen.queryByText('已超過規則次數（由主辦現場判斷）')).toBeNull();
  });

  it('暫停預覽畫面是 0:47，收合只剩一行', () => {
    pad(S4_SCENE_TIMEOUT);
    expect(screen.getByText('雷霆隊暫停 0:47')).toBeTruthy();
    expect(button('結束暫停')).toBeTruthy();
    const banner = document.querySelector('.s4-timeout');
    expect(banner?.classList.contains('s4-timeout--mini')).toBe(false);
    const root = document.querySelector('.s4-root');
    const order = [...(root?.children ?? [])].map((node) => node.className.split(' ')[0]);
    expect(order.indexOf('s4-timeout')).toBeLessThan(order.indexOf('s4-feed'));
    expect(order.indexOf('s4-feed')).toBeLessThan(order.indexOf('s4-pad'));
    cleanup();

    pad(S4_SCENE_TIMEOUT_COLLAPSED);
    expect(button('雷霆隊暫停 0:47')).toBeTruthy();
    expect(document.querySelector('.s4-timeout--mini')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '結束暫停' })).toBeNull();
  });

  it('下半場結束且平手才出現 PK，進行中只記進與沒進', () => {
    expect(shootoutOffered({ live: true, running: false, period: 'h2', home: 2, away: 2 })).toBe(true);
    expect(shootoutOffered({ live: true, running: true, period: 'h2', home: 2, away: 2 })).toBe(false);
    expect(shootoutOffered({ live: true, running: false, period: 'h1', home: 2, away: 2 })).toBe(false);
    expect(shootoutOffered({ live: true, running: false, period: 'et', home: 1, away: 1 })).toBe(true);
    expect(shootoutOffered({ live: false, running: false, period: 'h2', home: 2, away: 2 })).toBe(false);

    const onStartPk = vi.fn();
    const onClock = vi.fn();
    const start = pad(S4_SCENE_PK_START, { onStartPk, onClock });
    expect(screen.getByText('2:2')).toBeTruthy();
    expect(screen.getByText('40:00')).toBeTruthy();
    expect(screen.getByText('下半場')).toBeTruthy();
    expect(button('PK 大戰')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /停錶|暫停/ })).toBeNull();
    // 同分停錶可進 PK 時仍有「繼續計時」，與「PK 大戰」並存（顧問 staging 複驗 P1-C）。
    expect(button('繼續計時')).toBeTruthy();
    const startCtrl = [...start.container.querySelector('.s4-ctrl')!.children].map((node) => {
      if (node.classList.contains('s4-ctrl__gap')) return 'gap';
      if (node.classList.contains('s4-menu-wrap')) return 'menu';
      return (node.textContent || '').trim();
    });
    expect(startCtrl).toEqual(['PK 大戰', '繼續計時', 'menu', 'gap', '終場']);
    fireEvent.click(button('PK 大戰'));
    expect(onStartPk).toHaveBeenCalledTimes(1);
    expect(onClock).not.toHaveBeenCalled();
    cleanup();

    const onRecord = vi.fn();
    const onUndo = vi.fn();
    const view = pad(S4_SCENE_PK, { onRecord, onUndo });
    // 施工-第2批 3.2（顧問已裁定 PK 不放時鐘）：上排正規比分拆三格、下排是 PK 比分加小標，右邊是第幾輪。
    expect(view.container.querySelector('.s4-top .s4-score')?.textContent).toBe('2:2');
    expect(view.container.querySelector('.s4-clockrow > .s4-pk')?.textContent).toBe('PK3:2');
    expect(view.container.querySelector('.s4-top .s4-clock')).toBeNull();
    expect(screen.queryByText('40:00')).toBeNull();
    expect(screen.getByText('PK')).toBeTruthy();
    expect(view.container.querySelector('.s4-clockrow > .s4-round')?.textContent).toBe('第4輪');
    expect(screen.queryByRole('button', { name: '雷霆隊 進球' })).toBeNull();
    expect(screen.queryByRole('button', { name: '海風隊 進球' })).toBeNull();
    expect(button('雷霆隊 進')).toBeTruthy();
    expect(button('雷霆隊 沒進')).toBeTruthy();
    expect(button('海風隊 進')).toBeTruthy();
    expect(button('海風隊 沒進')).toBeTruthy();
    expect(button('雷霆隊 黃牌')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /停錶|暫停/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '半場' })).toBeNull();
    const ctrl = [...view.container.querySelector('.s4-ctrl')!.children].map((node) => {
      if (node.classList.contains('s4-ctrl__gap')) return 'gap';
      if (node.classList.contains('s4-menu-wrap')) return 'menu';
      return (node.textContent || '').trim();
    });
    expect(ctrl).toEqual(['menu', 'gap', '終場']);
    expect(screen.getByText('第1輪 雷霆隊 9 劉冠廷 進')).toBeTruthy();
    expect(screen.getByText('第2輪 海風隊 11 郭建宏 沒進')).toBeTruthy();
    const pkLines = [...view.container.querySelectorAll('.s4-ev__main')].map((node) => (node.textContent || '').trim());
    expect(pkLines).toEqual([
      '第4輪 雷霆隊 8 吳承恩 進',
      '第3輪 海風隊 1 王大同 進',
      '第3輪 雷霆隊 7 張宇軒 進',
      '第2輪 海風隊 11 郭建宏 沒進',
      '第2輪 雷霆隊 10 蔡明哲 進',
      '第1輪 海風隊 10 謝東霖 進',
      '第1輪 雷霆隊 9 劉冠廷 進',
    ]);
    expect(pkLines.findIndex((line) => line.startsWith('第4輪'))).toBeLessThan(
      pkLines.findIndex((line) => line.startsWith('第3輪 海風隊')),
    );
    expect(view.container.querySelector('.s4-ev--void .s4-ev__tag')?.textContent).toBe('已復原');
    fireEvent.click(button('雷霆隊 沒進'));
    fireEvent.click(button('不指定球員'));
    expect(onRecord).toHaveBeenCalledWith({
      side: 'home',
      action: 'pk-miss',
      plId: null,
      goalKind: null,
      minute: 40,
      round: 4,
    });
    fireEvent.click(button('第1輪 雷霆隊 9 劉冠廷 進'));
    expect(screen.queryByRole('button', { name: /^改判/ })).toBeNull();
    fireEvent.click(button(/^復原/));
    expect(onUndo).toHaveBeenCalledWith(1);
    fireEvent.click(button('選單'));
    expect(screen.queryByRole('button', { name: '球隊暫停' })).toBeNull();
    expect(button('修正時鐘')).toBeTruthy();
  });
});
