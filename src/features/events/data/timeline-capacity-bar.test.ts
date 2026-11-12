import { describe, expect, it } from 'vitest';
import { buildRegCapacityBar } from './reg-capacity-bar';
import {
  TEAM_OPEN_COLOR,
  TIMELINE_BAR_MIN_WAIT_GLOW,
  timelineBarBackground,
  timelineBarStyle,
} from './timeline-capacity-bar';

const team = (reserved: number, used: number) => [{
  reservedSlots: reserved, usedSlots: used, remainingSlots: Math.max(0, reserved - used),
}];

function model(over: Partial<Parameters<typeof buildRegCapacityBar>[0]> = {}) {
  const m = buildRegCapacityBar({
    teamReservationSummaries: [],
    confirmedCount: 0,
    reservedRemainingCount: 0,
    waitlistCount: 0,
    maxCount: 20,
    ...over,
  });
  if (!m) throw new Error('model null');
  return m;
}

/** 取主條（最後一層）的色標。 */
function mainStops(bg: string): string[] {
  const layers = bg.split('linear-gradient(90deg, ').slice(1);
  const main = layers[layers.length - 1] ?? '';
  // 依括號深度切逗號（color-mix(...) 內的逗號不切）。
  const body = main.replace(/\)$/, '');
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

describe('timelineBarBackground（活動列表卡計量條，風格 A）', () => {
  it('未滿：一般已報到 50% 後漸層進透明（空名額露出軌道），沒有候補光暈', () => {
    const bg = timelineBarBackground(model({ confirmedCount: 10 }), 20);
    expect(mainStops(bg)).toEqual(['var(--accent) 0%', 'var(--accent) 44%', 'transparent 56%', 'transparent 100%']);
    expect(bg).not.toContain('--color-waitlist');
  });

  it('各段比例同詳情頁：一般 10、團隊已報 4、團隊未報 4（上限 20），段間漸層銜接不留硬邊', () => {
    const bg = timelineBarBackground(model({
      confirmedCount: 14, reservedRemainingCount: 4, teamReservationSummaries: team(8, 4),
    }), 20);
    // 一般 0–50%、團隊 50–70%、未報 70–90%；每個交界前後各留半個漸層寬（最多 6%，不超過該段一半）。
    expect(mainStops(bg)).toEqual([
      'var(--accent) 0%', 'var(--accent) 44%',
      'var(--info) 56%', 'var(--info) 64%',
      `${TEAM_OPEN_COLOR} 76%`, `${TEAM_OPEN_COLOR} 84%`,
      'transparent 96%', 'transparent 100%',
    ]);
  });

  it('額滿（正取＋團隊未報＝上限）：最後一段畫到 100%，條是滿的', () => {
    const full = timelineBarBackground(model({ confirmedCount: 20 }), 20);
    expect(mainStops(full).slice(-2)).toEqual(['var(--accent) 100%', 'transparent 100%']);
    const byTeam = timelineBarBackground(model({
      confirmedCount: 16, reservedRemainingCount: 4, teamReservationSummaries: team(8, 4),
    }), 20);
    expect(byTeam).toContain(`${TEAM_OPEN_COLOR} 100%`);
  });

  it('候補：只在有候補時疊紫色光暈在條尾，寬度最少 10%、最多 30%，主條比例不變', () => {
    const few = timelineBarBackground(model({ confirmedCount: 20, waitlistCount: 1 }), 20);
    expect(few.startsWith(`linear-gradient(90deg, transparent ${100 - TIMELINE_BAR_MIN_WAIT_GLOW}%, var(--color-waitlist) 100%)`)).toBe(true);
    const many = timelineBarBackground(model({ confirmedCount: 20, waitlistCount: 50 }), 20);
    expect(many.startsWith('linear-gradient(90deg, transparent 70%, var(--color-waitlist) 100%)')).toBe(true);
    expect(mainStops(many).slice(-2)).toEqual(['var(--accent) 100%', 'transparent 100%']);
    expect(timelineBarBackground(model({ confirmedCount: 20 }), 20)).not.toContain('--color-waitlist');
  });

  it('是否畫滿看人數不看百分比：199／200 不畫滿（條尾仍漸層進透明），200／200 才畫滿', () => {
    const almost = timelineBarBackground(model({ confirmedCount: 199, maxCount: 200 }), 200);
    expect(almost).not.toContain('var(--accent) 100%');
    expect(mainStops(almost).slice(-2)).toEqual(['transparent 100%', 'transparent 100%']);
    const full = timelineBarBackground(model({ confirmedCount: 200, maxCount: 200 }), 200);
    expect(mainStops(full).slice(-2)).toEqual(['var(--accent) 100%', 'transparent 100%']);
  });

  it('超收（正取＋團隊未報 > 上限）：畫滿，所有色標都在 0～100%', () => {
    const over = timelineBarBackground(model({
      confirmedCount: 21, reservedRemainingCount: 3, waitlistCount: 2, teamReservationSummaries: team(7, 4),
    }), 20);
    // 含 color-mix 的 38%，全部百分比都必須落在 0～100。
    const positions = [...over.matchAll(/(-?[\d.]+)%/g)].map((m) => Number(m[1]));
    expect(positions.length).toBeGreaterThan(4);
    for (const p of positions) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
    expect(over).toContain(`${TEAM_OPEN_COLOR} 100%`);
  });

  it('沒有人報名：整條透明露出軌道', () => {
    expect(timelineBarBackground(model(), 20)).toBe('linear-gradient(90deg, transparent 0%, transparent 100%)');
  });
});

describe('timelineBarStyle', () => {
  it('有團隊未報時先寫舊瀏覽器版本（同色藍），再寫 color-mix 版本；Safari < 16.2 丟棄後一條、退回同色', () => {
    const style = timelineBarStyle(model({
      confirmedCount: 14, reservedRemainingCount: 4, teamReservationSummaries: team(8, 4),
    }), 20);
    const [fallback, modern] = (style ?? '').split(';');
    expect(fallback).toMatch(/^background-image:/);
    expect(fallback).not.toContain('color-mix');
    expect(modern).toContain('color-mix(in srgb, var(--info) 38%, transparent)');
  });

  it('沒有團隊未報時只寫一條；沒有上限（model null）時不寫，只剩軌道', () => {
    expect(timelineBarStyle(model({ confirmedCount: 5 }), 20)?.split(';')).toHaveLength(1);
    expect(timelineBarStyle(null, 0)).toBeUndefined();
  });
});
