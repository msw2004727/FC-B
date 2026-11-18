// 同分比較、主辦裁定、撤銷裁定。說明入口只給主辦／共同主辦／管理員。
// 觀眾不呼叫 explainTie。裁定小標本身公開可點。

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { RadioGroup } from '@/ui/RadioGroup';
import { Textarea } from '@/ui/Textarea';
import { toast } from '@/ui/Toast';
import type { TieMethod } from '../data/cp-callables';
import { boundedReason, reasonProblem } from '../data/host-write';
import {
  criterionKey,
  explainTieFromRaw,
  isDiffCriterion,
  pendingGroupIds,
  samePointTeamIds,
  tieStepViews,
  type ExplainTieResult,
} from '../data/tie-present';
import type { DivisionDoc, EntryDoc, ManualOverride, StandingDoc, SummaryEntry, TieDecisionMethod } from '../data/types';
import { formatTaipeiDateTime, formatTaipeiShort } from '../format';
import type { CompetitionsT } from '../i18n';
import { errorOf, reasonText } from './feedback';
import { StandingsTable } from './schedule-board';
import { CpCard } from './shell';

function formatValue(criterion: string, value: number | null): string {
  if (value == null) return '—';
  if (isDiffCriterion(criterion) && value > 0) return `+${value}`;
  return String(value);
}

function criterionLabel(ct: CompetitionsT, criterion: string): string {
  const key = criterionKey(criterion);
  return key ? ct(key) : ct('tieWhen');
}

function methodLabel(ct: CompetitionsT, method: TieDecisionMethod | null): string {
  if (method === 'drawLots') return ct('drawLog');
  return ct('hostRuling');
}

function Grip(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="6" cy="4" r="1" /><circle cx="10" cy="4" r="1" />
      <circle cx="6" cy="8" r="1" /><circle cx="10" cy="8" r="1" />
      <circle cx="6" cy="12" r="1" /><circle cx="10" cy="12" r="1" />
    </svg>
  );
}

function nameOf(doc: StandingDoc, teamId: string): string {
  return doc.rows.find((row) => row.teamId === teamId)?.name ?? teamId;
}

function groupField(groupId: string): { groupId?: string } {
  return groupId ? { groupId } : {};
}

function move(order: readonly string[], index: number, delta: number): string[] {
  const next = [...order];
  const target = index + delta;
  const from = next[index];
  const to = next[target];
  if (!from || !to) return next;
  next[index] = to;
  next[target] = from;
  return next;
}

function applyLocalRuling(
  doc: StandingDoc,
  order: readonly string[],
  method: TieMethod,
  reason: string,
  at: number,
): StandingDoc {
  const ranks = doc.rows.filter((row) => order.includes(row.teamId)).map((row) => row.rank);
  const base = ranks.length > 0 ? Math.min(...ranks) : 1;
  const place = new Map(order.map((id, index) => [id, base + index]));
  return {
    ...doc,
    version: doc.version + 1,
    manualOverride: { method, reason, at },
    rows: doc.rows.map((row) => {
      const rank = place.get(row.teamId);
      if (rank == null) return row;
      return { ...row, rank, decidedBy: method, hasUnresolvedTie: false, tiedWith: [] };
    }),
  };
}

function applyLocalClear(doc: StandingDoc): StandingDoc {
  return {
    ...doc,
    version: doc.version + 1,
    manualOverride: null,
    rows: doc.rows.map((row) => (
      row.decidedBy ? { ...row, decidedBy: null, hasUnresolvedTie: true } : row
    )),
  };
}

interface Related {
  id: string;
  when: string;
  line: string;
}

function relatedOf(ids: readonly string[], summary: readonly SummaryEntry[]): Related[] {
  const byId = new Map(summary.map((entry) => [entry.id, entry]));
  return ids.flatMap((id) => {
    const entry = byId.get(id);
    if (!entry) return [];
    const when = entry.k == null ? '' : formatTaipeiShort(entry.k);
    const score = `${entry.s[0]}：${entry.s[1]}`;
    return [{ id, when, line: `${entry.h.n} ${score} ${entry.a.n}` }];
  });
}

function CompareCard({
  ct,
  doc,
  result,
  summary,
}: {
  ct: CompetitionsT;
  doc: StandingDoc;
  result: ExplainTieResult;
  summary: readonly SummaryEntry[];
}): JSX.Element {
  const views = tieStepViews(result);
  const teamIds = views[0]?.values.map((item) => item.teamId) ?? result.naturalOrder;
  const names = teamIds.map((id) => nameOf(doc, id));
  const rels = relatedOf(result.matchIds, summary);
  const hit = views.some((view) => view.hit);
  return (
    <CpCard>
      <h3 class="cpm-h">{names.join('、')}</h3>
      <div class="cpm-cmp">
        <div
          class="cpm-cmp__r cpm-cmp__r--h"
          style={`grid-template-columns:minmax(0,1fr) repeat(${Math.max(names.length, 1)},4.5em)`}
        >
          <span />
          {names.map((name) => <span key={name}>{name}</span>)}
        </div>
        {views.map((view) => (
          <div
            key={view.criterion}
            class={`cpm-cmp__r${view.hit ? ' cpm-cmp__r--hit' : ''}${view.skip ? ' cpm-cmp__r--skip' : ''}`}
            style={`grid-template-columns:minmax(0,1fr) repeat(${Math.max(teamIds.length, 1)},4.5em)`}
          >
            <span class="cpm-cmp__k">{criterionLabel(ct, view.criterion)}</span>
            {teamIds.map((id) => {
              const found = view.values.find((item) => item.teamId === id);
              return <span key={id}>{formatValue(view.criterion, found?.value ?? null)}</span>;
            })}
          </div>
        ))}
      </div>
      {hit ? <p class="cpm-mark">{ct('tieHit')}</p> : null}
      {result.pending ? <p class="cpm-mark cpm-mark--wait">{ct('tieAllSame')}</p> : null}
      <h4 class="cpm-sec">{ct('tieRelated')}</h4>
      <ul class="cpm-rels">
        {rels.map((rel) => (
          <li key={rel.id}>
            {/* 相關場次目前只列出、不連到單場頁（Flash 初審 P3：避免看起來可點卻沒反應） */}
            <div class="cpm-rel">
              <span class="cpm-rel__t">{rel.when}</span>
              <span class="cpm-rel__n">{rel.line}</span>
            </div>
          </li>
        ))}
      </ul>
    </CpCard>
  );
}

function RulingForm({
  ct,
  doc,
  order,
  method,
  reason,
  message,
  busy,
  onMethod,
  onOrder,
  onReason,
  onSave,
}: {
  ct: CompetitionsT;
  doc: StandingDoc;
  order: readonly string[];
  method: TieMethod;
  reason: string;
  message: string | null;
  busy: boolean;
  onMethod: (value: TieMethod) => void;
  onOrder: (next: string[]) => void;
  onReason: (value: string) => void;
  onSave: () => void;
}): JSX.Element {
  return (
    <CpCard>
      <div class="cps-sheet-body">
        <div class="cpm-method">
          <RadioGroup
            label={ct('tieMethod')}
            value={method}
            orientation="horizontal"
            onValueChange={(value) => {
              if (value === 'host' || value === 'drawLots') onMethod(value);
            }}
            options={[
              { value: 'host', label: ct('hostRuling') },
              { value: 'drawLots', label: ct('drawLog') },
            ]}
          />
        </div>
        <div>
          <h3 class="cpm-sec cpm-sec--first">{ct('rankOrder')}</h3>
          <ol class="cpm-drag">
            {order.map((id, index) => {
              const name = nameOf(doc, id);
              return (
                <li key={id} class="cpm-drag__li">
                  <span class="cpm-grip"><Grip /></span>
                  <span class="cpm-drag__i">{index + 1}</span>
                  <span class="cpm-drag__n">{name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || index === 0}
                    aria-label={`${ct('moveUp')} ${name}`}
                    onClick={() => onOrder(move(order, index, -1))}
                  >{ct('moveUp')}</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || index === order.length - 1}
                    aria-label={`${ct('moveDown')} ${name}`}
                    onClick={() => onOrder(move(order, index, 1))}
                  >{ct('moveDown')}</Button>
                </li>
              );
            })}
          </ol>
        </div>
        <Textarea
          label={ct('ruleReason')}
          required
          value={reason}
          maxLength={200}
          rows={2}
          variant="fixed"
          onValueChange={onReason}
        />
        {message ? <p class="cps-note cps-warn" role="alert">{message}</p> : null}
        <Button variant="primary" disabled={busy} onClick={onSave}>{ct('saveRuling')}</Button>
      </div>
    </CpCard>
  );
}

function DecisionCard({
  ct,
  override,
  canHost,
  clearReason,
  message,
  busy,
  onClearReason,
  onClear,
}: {
  ct: CompetitionsT;
  override: ManualOverride | null;
  canHost: boolean;
  clearReason: string;
  message: string | null;
  busy: boolean;
  onClearReason: (value: string) => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <CpCard>
      <p class="cpm-h">{methodLabel(ct, override?.method ?? null)}</p>
      {override?.reason ? <p class="cpm-reason"><b>{ct('reasonPrefix')}</b>　{override.reason}</p> : null}
      {override?.at != null ? <p class="cpm-reason"><b>{ct('tieWhen')}</b>　{formatTaipeiDateTime(override.at)}</p> : null}
      {canHost ? (
        <div class="cps-sheet-body">
          <Textarea
            label={ct('clearReason')}
            required
            value={clearReason}
            maxLength={200}
            rows={2}
            variant="fixed"
            onValueChange={onClearReason}
          />
          {message ? <p class="cps-note cps-warn" role="alert">{message}</p> : null}
          <Button variant="secondary" disabled={busy} onClick={onClear}>{ct('clearRuling')}</Button>
        </div>
      ) : null}
    </CpCard>
  );
}

export function TieWorkspace({
  ct,
  docs,
  crests,
  divisions,
  canHost,
  cid,
  actions,
  summary,
  injected,
  now,
  onStandings,
  reload,
}: {
  ct: CompetitionsT;
  docs: readonly StandingDoc[];
  crests: readonly EntryDoc[];
  divisions: readonly DivisionDoc[];
  canHost: boolean;
  cid: string;
  actions: {
    explainTie(input: { cid: string; dvId: string; groupId?: string; teamIds: string[] }): Promise<unknown>;
    resolveTie(input: {
      cid: string;
      dvId: string;
      groupId?: string;
      order: string[];
      method: TieMethod;
      reason: string;
      expectedVersion: number;
    }): Promise<unknown>;
    clearTieDecision(input: {
      cid: string;
      dvId: string;
      groupId?: string;
      reason: string;
      expectedVersion: number;
    }): Promise<unknown>;
  };
  summary: readonly SummaryEntry[];
  /** 注入賽程時只改本地積分，不重讀（避免蓋掉測試資料）。 */
  injected: boolean;
  now: number;
  onStandings: (docs: StandingDoc[]) => void;
  reload: () => Promise<void>;
}): JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [result, setResult] = useState<ExplainTieResult | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [method, setMethod] = useState<TieMethod>('host');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [clearReason, setClearReason] = useState('');
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = docs.find((doc) => doc.id === activeId) ?? null;
  const decision = docs.find((doc) => doc.id === decisionId) ?? null;

  function replaceDoc(next: StandingDoc): void {
    onStandings(docs.map((doc) => (doc.id === next.id ? next : doc)));
  }

  async function explain(doc: StandingDoc, teamId: string): Promise<void> {
    // Flash 初審 P2：查詢中不重複送出
    if (busy) return;
    const teamIds = samePointTeamIds(doc, teamId);
    if (teamIds.length < 2) return;
    setBusy(true);
    setMessage(null);
    setExists(false);
    setActiveId(doc.id);
    setDecisionId(null);
    setResult(null);
    const pending = pendingGroupIds(doc, teamId) ?? [];
    setOrder(pending);
    setReason('');
    try {
      const raw = await actions.explainTie({ cid, dvId: doc.divisionId, ...groupField(doc.groupId), teamIds });
      const parsed = explainTieFromRaw(raw);
      if (!parsed) {
        const text = reasonText(ct, 'UNKNOWN');
        toast.show({ message: text, tone: 'error' });
        setMessage(text);
        return;
      }
      setResult(parsed);
    } catch (err) {
      const info = errorOf(err);
      const text = reasonText(ct, info.reason, info.params);
      toast.show({ message: text, tone: 'error' });
      setMessage(text);
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (!active || busy) return;
    const problem = reasonProblem(reason);
    if (problem) {
      const params = problem === 'FIELD_LENGTH' ? { min: 1, max: 200 } : undefined;
      const text = reasonText(ct, problem, params);
      toast.show({ message: text, tone: 'error' });
      setMessage(text);
      return;
    }
    if (order.length < 2) {
      const text = reasonText(ct, 'TIE_NOT_PENDING');
      toast.show({ message: text, tone: 'error' });
      setMessage(text);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const text = reason.trim();
      await actions.resolveTie({
        cid,
        dvId: active.divisionId,
        ...groupField(active.groupId),
        order: [...order],
        method,
        reason: text,
        expectedVersion: active.version,
      });
      if (injected) replaceDoc(applyLocalRuling(active, order, method, text, now));
      else await reload();
      setActiveId(null);
      setResult(null);
      setExists(false);
    } catch (err) {
      const info = errorOf(err);
      if (info.reason === 'TIE_DECISION_EXISTS') {
        setExists(true);
        setMessage(ct('tieExistsHint'));
        toast.show({ message: ct('tieExistsHint'), tone: 'error' });
        return;
      }
      const text = reasonText(ct, info.reason, info.params);
      toast.show({ message: text, tone: 'error' });
      setMessage(text);
    } finally {
      setBusy(false);
    }
  }

  async function clearDecision(doc: StandingDoc): Promise<void> {
    if (busy) return;
    const problem = boundedReason(clearReason, 1, 200);
    if (problem) {
      const params = problem === 'FIELD_LENGTH' ? { min: 1, max: 200 } : undefined;
      const text = reasonText(ct, problem, params);
      toast.show({ message: text, tone: 'error' });
      setMessage(text);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await actions.clearTieDecision({
        cid,
        dvId: doc.divisionId,
        ...groupField(doc.groupId),
        reason: clearReason.trim(),
        expectedVersion: doc.version,
      });
      if (injected) replaceDoc(applyLocalClear(doc));
      else await reload();
      setDecisionId(null);
      setExists(false);
      setClearReason('');
    } catch (err) {
      const info = errorOf(err);
      const text = reasonText(ct, info.reason, info.params);
      toast.show({ message: text, tone: 'error' });
      setMessage(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="cps-stack">
      <StandingsTable
        ct={ct}
        docs={docs}
        crests={crests}
        divisions={divisions}
        canExplain={canHost}
        onExplain={(doc, teamId) => { void explain(doc, teamId); }}
        onDecision={(doc) => {
          setDecisionId(doc.id);
          setActiveId(null);
          setMessage(null);
          setClearReason('');
        }}
      />
      {active && result ? <CompareCard ct={ct} doc={active} result={result} summary={summary} /> : null}
      {message && active && !result ? <p class="cps-note cps-warn" role="alert">{message}</p> : null}
      {active && canHost && order.length >= 2 ? (
        <RulingForm
          ct={ct}
          doc={active}
          order={order}
          method={method}
          reason={reason}
          message={exists ? ct('tieExistsHint') : message}
          busy={busy}
          onMethod={setMethod}
          onOrder={setOrder}
          onReason={setReason}
          onSave={() => { void save(); }}
        />
      ) : null}
      {exists && active ? (
        <CpCard>
          <p class="cpm-hint">{ct('tieExistsHint')}</p>
          <div class="cps-sheet-body">
            <Textarea
              label={ct('clearReason')}
              required
              value={clearReason}
              maxLength={200}
              rows={2}
              variant="fixed"
              onValueChange={setClearReason}
            />
            <Button variant="secondary" disabled={busy} onClick={() => { void clearDecision(active); }}>{ct('clearRuling')}</Button>
          </div>
        </CpCard>
      ) : null}
      {decision ? (
        <DecisionCard
          ct={ct}
          override={decision.manualOverride}
          canHost={canHost}
          clearReason={clearReason}
          message={message}
          busy={busy}
          onClearReason={setClearReason}
          onClear={() => { void clearDecision(decision); }}
        />
      ) : null}
    </div>
  );
}
