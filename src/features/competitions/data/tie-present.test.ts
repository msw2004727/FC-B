import { describe, expect, it } from 'vitest';
import type { StandingDoc, StandingRow } from './types';
import {
  explainTieFromRaw,
  pendingGroupIds,
  rankingRuleKeys,
  rowNeedsRuling,
  samePointTeamIds,
  tieStepViews,
} from './tie-present';

function row(partial: Partial<StandingRow> & Pick<StandingRow, 'teamId' | 'points' | 'rank'>): StandingRow {
  return {
    name: partial.teamId,
    played: 4,
    win: 1,
    draw: 1,
    loss: 2,
    goalsFor: 3,
    goalsAgainst: 3,
    goalDiff: 0,
    hasUnresolvedTie: false,
    tiedWith: [],
    decidedBy: null,
    ...partial,
  };
}

function doc(rows: StandingRow[], manualOverride: StandingDoc['manualOverride'] = null): StandingDoc {
  return {
    id: 'dv_1__group__A',
    divisionId: 'dv_1',
    groupId: 'A',
    rows,
    version: 4,
    hasUnresolvedTie: true,
    manualOverride,
    ranking: null,
    updatedAt: null,
  };
}

describe('同分待裁定', () => {
  it('decidedBy 有值就不是待裁定，trace 仍可含 unresolved@manual', () => {
    expect(rowNeedsRuling({ hasUnresolvedTie: true, decidedBy: null })).toBe(true);
    expect(rowNeedsRuling({ hasUnresolvedTie: true, decidedBy: 'host' })).toBe(false);
    expect(rowNeedsRuling({ hasUnresolvedTie: true, decidedBy: 'drawLots' })).toBe(false);
    expect(rowNeedsRuling({ hasUnresolvedTie: false, decidedBy: null })).toBe(false);
  });

  it('同分群含已分出名次的隊伍；待裁定群只收還沒裁定的', () => {
    const table = doc([
      row({ teamId: 'a', points: 5, rank: 2, hasUnresolvedTie: false }),
      row({ teamId: 'b', points: 5, rank: 3, hasUnresolvedTie: true, tiedWith: ['c'] }),
      row({ teamId: 'c', points: 5, rank: 4, hasUnresolvedTie: true, tiedWith: ['b'], decidedBy: 'host' }),
      row({ teamId: 'd', points: 1, rank: 5 }),
    ]);
    expect(samePointTeamIds(table, 'b')).toEqual(['a', 'b', 'c']);
    expect(samePointTeamIds(table, 'd')).toEqual([]);
    expect(pendingGroupIds(table, 'b')).toBeNull();
    const open = doc([
      row({ teamId: 'b', points: 5, rank: 3, hasUnresolvedTie: true, tiedWith: ['c'] }),
      row({ teamId: 'c', points: 5, rank: 4, hasUnresolvedTie: true, tiedWith: ['b'] }),
    ]);
    expect(pendingGroupIds(open, 'c')).toEqual(['b', 'c']);
  });

  it('排序說明依 ranking；缺設定用對戰優先', () => {
    expect(rankingRuleKeys('h2hFirst')).toEqual(['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6']);
    expect(rankingRuleKeys(null)).toEqual(['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6']);
    expect(rankingRuleKeys('goalDiffFirst')).toEqual(['rule1', 'ruleGdSame', 'rule5', 'ruleH2hLate', 'rule6']);
  });

  it('分出高下之後、同一群沒再用到的條件標 skip', () => {
    const parsed = explainTieFromRaw({
      dvId: 'dv_1',
      steps: [
        { criterion: 'points', teamIds: ['a', 'b'], values: [{ teamId: 'a', value: 5 }, { teamId: 'b', value: 5 }], split: false },
        { criterion: 'goalDiff', teamIds: ['a', 'b'], values: [{ teamId: 'a', value: 2 }, { teamId: 'b', value: -1 }], split: true },
        { criterion: 'goalsFor', teamIds: ['a', 'b'], values: [{ teamId: 'a', value: 8 }, { teamId: 'b', value: 5 }], split: false },
      ],
      pending: false,
      matchIds: ['mt_1'],
    });
    expect(parsed?.groupId).toBe('A');
    expect(tieStepViews(parsed!).map((view) => [view.criterion, view.hit, view.skip])).toEqual([
      ['points', false, false],
      ['goalDiff', true, false],
      ['goalsFor', false, true],
    ]);
    expect(explainTieFromRaw(null)).toBeNull();
  });
});
