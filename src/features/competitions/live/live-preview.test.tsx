import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installUi4TestLocale } from '@/ui/ui4-test-helpers';
import {
  S4_CONFIRMED,
  S4_DETAIL_ROWS,
  S4_NOW,
  S4_PEOPLE,
  S4_SCENE_FT,
  S4_SCENE_HT,
  S4_SCENE_LIVE,
  S4_SCENE_OFFLINE,
  S4_SCENE_PRE,
  S4_SCENE_UNAPPLIED,
  type S4ScoreScene,
} from '../testing/step4-fixtures';
import { CardFlash } from './CardFlash';
import { stageLabel } from './clock';
import { LiveDetailList } from './LiveDetailList';
import { LiveMatchView } from './LiveMatchView';
import { LiveScoreBadge } from './LiveScoreBadge';
import { ScorePad, type ScorePadProps } from './ScorePad';
import { ScorersTable } from './ScorersTable';
import { derivePublicTable } from './stats';

installUi4TestLocale();

afterEach(() => {
  cleanup();
});

function pad(scene: S4ScoreScene, extra: Partial<ScorePadProps> = {}) {
  return render(<ScorePad {...scene} {...extra} />);
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

    render(<LiveDetailList rows={S4_DETAIL_ROWS} />);
    expect(screen.getAllByText('即時')).toHaveLength(2);
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
    fireEvent.click(screen.getByRole('button', { name: "12' 黃牌 4 周子維" }));
    const yellow = view.container.querySelector('.s4-flash');
    expect(yellow?.classList.contains('s4-flash--yellow')).toBe(true);
    expect(yellow?.textContent).toContain('4');
    expect(yellow?.textContent).toContain('周子維');
    expect(yellow?.textContent).toContain('黃牌');
    expect(yellow?.textContent).not.toContain('第二張黃牌');

    fireEvent.click(screen.getByRole('button', { name: "31' 第二張黃牌 4 周子維" }));
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

  it('未套用清單的重新套用與捨棄各觸發一次', () => {
    const onReapply = vi.fn();
    const onDiscard = vi.fn();
    pad(S4_SCENE_UNAPPLIED, { onReapply, onDiscard });
    fireEvent.click(screen.getByRole('button', { name: '未套用的動作' }));
    const reapply = screen.getAllByRole('button', { name: '重新套用' });
    const discard = screen.getAllByRole('button', { name: '捨棄' });
    const firstReapply = reapply[0];
    const firstDiscard = discard[0];
    if (!firstReapply || !firstDiscard) throw new Error('找不到重新套用或捨棄');
    fireEvent.click(firstReapply);
    fireEvent.click(firstDiscard);
    expect(onReapply).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
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
    expect(screen.getByText(/劉冠廷/)).toBeTruthy();
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

  it('補時階段顯示 20+2\'', () => {
    expect(stageLabel({ elapsedSec: 20 * 60, period: 'h1', addedMin: 2 })).toBe("20+2'");
    pad(S4_SCENE_LIVE);
    cleanup();
    render(
      <ScorePad
        {...S4_SCENE_LIVE}
        clock={{ elapsedSec: 20 * 60 + 30, period: 'h1', addedMin: 2 }}
      />,
    );
    expect(screen.getByText("20+2'")).toBeTruthy();
    expect(screen.getByText('20:30')).toBeTruthy();
  });
});
