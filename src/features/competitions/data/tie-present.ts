// 同分查詢、裁定與排序說明的純函式。不讀時鐘、不打網路。
// 待裁定以列上 decidedBy 優先：有 host／drawLots 就不是待裁定，
// 即使 hasUnresolvedTie 或 tieBreakTrace 仍含 unresolved@manual。

import type { StandingDoc, StandingRanking, StandingRow, TieDecisionMethod } from './types';

export interface ExplainTieValue {
  teamId: string;
  value: number | null;
}

export interface ExplainTieStep {
  teamIds: string[];
  criterion: string;
  values: ExplainTieValue[];
  split: boolean;
}

export interface ExplainTieSplit {
  criterion: string;
  aboveTeamIds: string[];
  belowTeamIds: string[];
}

export interface ExplainTieDecision {
  active: boolean;
  method: TieDecisionMethod | null;
  reason: string | null;
  decidedAt: number | null;
  order: string[] | null;
  by: string | null;
}

export interface ExplainTieMark {
  teamId: string;
  rank: number;
  decidedBy: TieDecisionMethod | null;
}

export interface ExplainTieResult {
  dvId: string;
  groupId: string;
  naturalOrder: string[];
  steps: ExplainTieStep[];
  splits: ExplainTieSplit[];
  decidedCriterion: string | null;
  pending: boolean;
  pendingCriterion: 'manual' | 'drawLots' | 'exhausted' | null;
  matchIds: string[];
  decision: ExplainTieDecision | null;
  marks: ExplainTieMark[];
}

/** 有 decidedBy 就已經套上裁定，不再當待裁定。 */
export function rowNeedsRuling(row: Pick<StandingRow, 'hasUnresolvedTie' | 'decidedBy'>): boolean {
  if (row.decidedBy === 'host' || row.decidedBy === 'drawLots') return false;
  return row.hasUnresolvedTie === true;
}

/**
 * 還有列上的同分沒裁定。文件上的 hasUnresolvedTie 不單獨算：
 * 列上 decidedBy 已寫（即使 hasUnresolvedTie 仍是 true）就不是待裁定。
 */
export function hasPendingTie(docs: readonly StandingDoc[]): boolean {
  return docs.some((doc) => doc.rows.some(rowNeedsRuling));
}

/** 這一列積分與同表至少另一列相同。已分出名次的也算。 */
export function samePointTeamIds(doc: StandingDoc, teamId: string): string[] {
  const self = doc.rows.find((row) => row.teamId === teamId);
  if (!self) return [];
  const ids = doc.rows.filter((row) => row.points === self.points).map((row) => row.teamId);
  return ids.length >= 2 ? ids : [];
}

/**
 * 待裁定那一群。從這一列的 tiedWith 閉合收集，而且每一列都還需要裁定。
 * decidedBy 已寫上的列不收。湊不滿兩隊就回 null。
 */
export function pendingGroupIds(doc: StandingDoc, teamId: string): string[] | null {
  const byId = new Map(doc.rows.map((row) => [row.teamId, row]));
  const start = byId.get(teamId);
  if (!start || !rowNeedsRuling(start)) return null;
  const seen = new Set<string>([teamId]);
  const queue = [teamId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) continue;
    const row = byId.get(id);
    if (!row) continue;
    for (const other of row.tiedWith) {
      if (seen.has(other)) continue;
      const peer = byId.get(other);
      if (!peer || !rowNeedsRuling(peer)) continue;
      seen.add(other);
      queue.push(other);
    }
  }
  if (seen.size < 2) return null;
  return doc.rows.filter((row) => seen.has(row.teamId)).map((row) => row.teamId);
}

/**
 * h2hFirst 對預覽的六行。goalDiffFirst 照契約條件：
 * points、goalDiff、goalsFor、headToHeadPoints、manual。
 * 缺設定時用 h2hFirst（產生賽程可以不送 ranking，公開說明先用對戰優先）。
 */
export function rankingRuleKeys(ranking: StandingRanking | null | undefined): string[] {
  if (ranking === 'goalDiffFirst') return ['rule1', 'ruleGdSame', 'rule5', 'ruleH2hLate', 'rule6'];
  return ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6'];
}

const CRITERION_KEY: Readonly<Record<string, string>> = {
  points: 'critPts',
  headToHeadPoints: 'critH2hPts',
  h2hPoints: 'critH2hPts',
  headToHeadGoalDiff: 'critH2hGd',
  headToHeadGd: 'critH2hGd',
  h2hGoalDiff: 'critH2hGd',
  goalDiff: 'critGd',
  goalsFor: 'critGf',
  manual: 'hostRuling',
  drawLots: 'drawLog',
  exhausted: 'tieAllSame',
};

/** 已知條件回文案鍵。不認得就回 null，呼叫端顯示原代碼以外的通用字。 */
export function criterionKey(criterion: string): string | null {
  return CRITERION_KEY[criterion] ?? null;
}

export function isDiffCriterion(criterion: string): boolean {
  return criterion === 'goalDiff'
    || criterion === 'headToHeadGoalDiff'
    || criterion === 'headToHeadGd'
    || criterion === 'h2hGoalDiff';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function methodOf(value: unknown): TieDecisionMethod | null {
  return value === 'host' || value === 'drawLots' ? value : null;
}

function stepOf(value: unknown): ExplainTieStep | null {
  if (!isRecord(value)) return null;
  const teamIds = ids(value.teamIds);
  const criterion = str(value.criterion);
  if (!criterion) return null;
  const values = Array.isArray(value.values)
    ? value.values.flatMap((item) => {
      if (!isRecord(item)) return [];
      const teamId = str(item.teamId);
      if (!teamId) return [];
      return [{ teamId, value: num(item.value) }];
    })
    : [];
  return { teamIds, criterion, values, split: value.split === true };
}

/** 後端 explainTie 的回傳。形狀不對就 null，呼叫端顯示通用失敗。 */
export function explainTieFromRaw(raw: unknown): ExplainTieResult | null {
  if (!isRecord(raw)) return null;
  const dvId = str(raw.dvId);
  const groupId = str(raw.groupId) ?? 'A';
  if (!dvId) return null;
  const pendingCriterion = raw.pendingCriterion === 'manual'
    || raw.pendingCriterion === 'drawLots'
    || raw.pendingCriterion === 'exhausted'
    ? raw.pendingCriterion
    : null;
  const decision = isRecord(raw.decision)
    ? {
      active: raw.decision.active === true,
      method: methodOf(raw.decision.method),
      reason: str(raw.decision.reason),
      decidedAt: num(raw.decision.decidedAt),
      order: ids(raw.decision.order),
      by: str(raw.decision.by),
    }
    : null;
  return {
    dvId,
    groupId,
    naturalOrder: ids(raw.naturalOrder),
    steps: Array.isArray(raw.steps)
      ? raw.steps.map(stepOf).filter((step): step is ExplainTieStep => step != null)
      : [],
    splits: Array.isArray(raw.splits)
      ? raw.splits.flatMap((item) => {
        if (!isRecord(item)) return [];
        const criterion = str(item.criterion);
        if (!criterion) return [];
        return [{ criterion, aboveTeamIds: ids(item.aboveTeamIds), belowTeamIds: ids(item.belowTeamIds) }];
      })
      : [],
    decidedCriterion: str(raw.decidedCriterion),
    pending: raw.pending === true,
    pendingCriterion,
    matchIds: ids(raw.matchIds),
    decision,
    marks: Array.isArray(raw.marks)
      ? raw.marks.flatMap((item) => {
        if (!isRecord(item)) return [];
        const teamId = str(item.teamId);
        const rank = num(item.rank);
        if (!teamId || rank == null) return [];
        return [{ teamId, rank, decidedBy: methodOf(item.decidedBy) }];
      })
      : [],
  };
}

export interface TieStepView {
  criterion: string;
  values: ExplainTieValue[];
  hit: boolean;
  skip: boolean;
}

/**
 * 分出高下的那一列用 hit。它後面、同一群、沒有再拆開的列用 skip（引擎若仍帶回未使用的條件）。
 * 子群重比（隊伍較少且又拆開）不當 skip。
 */
export function tieStepViews(result: ExplainTieResult): TieStepView[] {
  const hitAt = result.steps.findIndex((step) => step.split);
  const full = result.steps[0]?.teamIds ?? [];
  return result.steps.map((step, index) => {
    const sameSet = step.teamIds.length === full.length && step.teamIds.every((id) => full.includes(id));
    return {
      criterion: step.criterion,
      values: step.values,
      hit: step.split,
      skip: hitAt >= 0 && index > hitAt && !step.split && sameSet,
    };
  });
}
