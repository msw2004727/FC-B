import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { copyToClipboard } from '@/features/events/data/activity-share';
import { toast } from '@/ui/Toast';

import { OpsShell, ReadFailed, StatusNote, useOpsGate } from '../components/OpsShell';
import {
  PARTICIPANT_PAGE_SIZE,
  defaultQueryRange,
  fetchUserNames,
  participantsAsOf,
  participantsPath,
  queryParticipants,
  validateQuery,
  type ParticipantOutcome,
  type ParticipantQuery,
  type QueryErrorKey,
} from '../data/participants-data';
import { useOpsT } from '../ops-strings';

type RunState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'done'; query: ParticipantQuery; outcome: ParticipantOutcome };

type NamesState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; names: Record<string, string> };

/** 分享網址的條件；缺的日期用預設區間補上。網址沒有任何條件回 null（不自動查）。 */
function readUrlQuery(query: Record<string, string> | undefined, nowMs: number): ParticipantQuery | null {
  const keyword = query?.['q'] ?? '';
  const from = query?.['from'] ?? '';
  const to = query?.['to'] ?? '';
  if (!keyword && !from && !to) return null;
  const fallback = defaultQueryRange(nowMs);
  return { keyword, from: from || fallback.from, to: to || fallback.to };
}

/**
 * 活動參與查詢（路由 `/admin/ops/participants`，分享網址同一頁）。
 * 網址只帶關鍵字與日期（`?q=&from=&to=`），開啟者要登入且有 `admin.dashboard.entry`，進頁重新查詢；不存任何分享文件。
 */
export default function OpsParticipantsPage(): JSX.Element {
  const t = useOpsT();
  const gate = useOpsGate();
  const { route, query } = useLocation();
  const asOf = useMemo(() => participantsAsOf(Date.now()), []);
  const fromUrl = useMemo(() => readUrlQuery(query, Date.now()), []);
  const initial = useMemo(() => fromUrl ?? { keyword: '', ...defaultQueryRange(Date.now()) }, [fromUrl]);
  const [form, setForm] = useState<ParticipantQuery>(initial);
  const [formError, setFormError] = useState<QueryErrorKey | null>(null);
  const [run, setRun] = useState<RunState>({ kind: 'idle' });
  const [page, setPage] = useState(0);
  const [names, setNames] = useState<NamesState>({ kind: 'loading' });
  const runSeq = useRef(0);
  const nameSeq = useRef(0);
  const autoRan = useRef(false);

  const search = useCallback(async (q: ParticipantQuery): Promise<void> => {
    const error = validateQuery(q, asOf);
    setFormError(error);
    if (error) return;
    const clean = { keyword: q.keyword.trim(), from: q.from, to: q.to };
    try {
      history.replaceState(history.state, '', participantsPath(clean));
    } catch {
      // 歷史紀錄受限時只是網址不更新，不影響查詢。
    }
    const seq = ++runSeq.current;
    setRun({ kind: 'loading' });
    try {
      const outcome = await queryParticipants(clean);
      if (seq !== runSeq.current) return;
      setPage(0);
      setRun({ kind: 'done', query: clean, outcome });
    } catch (err: unknown) {
      if (seq !== runSeq.current) return;
      // eslint-disable-next-line no-console
      console.error('[ops-dashboard] participants query failed', err);
      setRun({ kind: 'error' });
    }
  }, [asOf]);

  // 分享網址：權限確認後依網址條件自動查一次。
  useEffect(() => {
    if (gate !== 'allowed' || autoRan.current) return;
    autoRan.current = true;
    if (fromUrl) void search(fromUrl);
  }, [gate]);

  useEffect(() => () => {
    runSeq.current += 1;
    nameSeq.current += 1;
  }, []);

  const rows = run.kind === 'done' && run.outcome.kind === 'ok' ? run.outcome.rows : null;
  const pageRows = useMemo(
    () => (rows ? rows.slice(page * PARTICIPANT_PAGE_SIZE, (page + 1) * PARTICIPANT_PAGE_SIZE) : []),
    [rows, page],
  );

  const loadNames = useCallback(async (): Promise<void> => {
    const seq = ++nameSeq.current;
    if (pageRows.length === 0) return;
    setNames({ kind: 'loading' });
    try {
      const result = await fetchUserNames(pageRows.map((r) => r.uid));
      if (seq === nameSeq.current) setNames({ kind: 'ok', names: result });
    } catch (err: unknown) {
      if (seq !== nameSeq.current) return;
      // eslint-disable-next-line no-console
      console.error('[ops-dashboard] participant names failed', err);
      setNames({ kind: 'error' });
    }
  }, [pageRows]);

  useEffect(() => {
    void loadNames();
  }, [loadNames]);

  async function copyLink(q: ParticipantQuery): Promise<void> {
    const ok = await copyToClipboard(new URL(participantsPath(q), location.origin).toString());
    toast.show({ message: t(ok ? 'copied' : 'copyFailed'), tone: ok ? 'success' : 'error' });
  }

  const busy = run.kind === 'loading';
  const totalPages = rows ? Math.max(1, Math.ceil(rows.length / PARTICIPANT_PAGE_SIZE)) : 1;

  function onSubmit(e: Event): void {
    e.preventDefault();
    void search(form);
  }

  let result: JSX.Element | null = null;
  if (run.kind === 'loading') {
    result = <StatusNote role="status" text={t('searching')} />;
  } else if (run.kind === 'error') {
    result = <ReadFailed onRetry={() => void search(form)} />;
  } else if (run.kind === 'done') {
    const { outcome } = run;
    if (outcome.kind === 'noData') {
      result = <StatusNote text={t('noData')} />;
    } else if (outcome.kind === 'tooMany') {
      result = <StatusNote role="alert" text={t('tooMany', { count: outcome.matched })} />;
    } else {
      const stats: [string, number][] = [
        [t('matchedEvents'), outcome.matchedEvents],
        [t('participants'), outcome.rows.length],
        [t('participations'), outcome.participations],
      ];
      result = (
        <>
          <div class="od-qsum">
            {stats.map(([label, value]) => (
              <div class="od-kpi" key={label}>
                <div class="od-kpi-label">{label}</div>
                <div class="od-kpi-row"><span class="od-num">{value.toLocaleString('en-US')}</span></div>
              </div>
            ))}
          </div>
          {outcome.rows.length > 0 && (
            <section class="od-card">
              {names.kind === 'error' ? (
                <ReadFailed onRetry={() => void loadNames()} />
              ) : (
                <ol class="od-rank" start={page * PARTICIPANT_PAGE_SIZE + 1}>
                  {pageRows.map((row, i) => {
                    const name = names.kind === 'ok' ? names.names[row.uid] ?? t('unknownUser') : '';
                    return (
                      <li key={row.uid}>
                        <button type="button" class="od-rank-row" onClick={() => route(`/profile/${encodeURIComponent(row.uid)}`)}>
                          <span class="od-rank-no">{page * PARTICIPANT_PAGE_SIZE + i + 1}</span>
                          <span class="od-avatar" aria-hidden="true">{name.charAt(0)}</span>
                          <span class="od-rank-title">{name}</span>
                          <span class="od-rank-val">{t('times', { count: row.count })}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
              {totalPages > 1 && (
                <div class="od-pager">
                  <button type="button" class="od-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('prev')}</button>
                  <span class="od-pager-at">{`${page + 1}/${totalPages}`}</span>
                  <button type="button" class="od-btn" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>{t('next')}</button>
                </div>
              )}
            </section>
          )}
        </>
      );
    }
  }

  const shareQuery = run.kind === 'done' ? run.query : null;

  return (
    <OpsShell id="page-admin-ops-participants" title={t('queryTitle')} backTo="/admin/ops" gate={gate}>
      <form class="od-card od-form" onSubmit={onSubmit} noValidate>
        <label class="od-field od-field-kw">
          <span>{t('keyword')}</span>
          <input
            type="search"
            value={form.keyword}
            maxLength={40}
            disabled={busy}
            onInput={(e) => setForm({ ...form, keyword: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>
        <label class="od-field">
          <span>{t('from')}</span>
          <input
            type="date"
            value={form.from}
            max={asOf}
            disabled={busy}
            onInput={(e) => setForm({ ...form, from: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>
        <label class="od-field">
          <span>{t('to')}</span>
          <input
            type="date"
            value={form.to}
            max={asOf}
            disabled={busy}
            onInput={(e) => setForm({ ...form, to: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>
        {formError && <div class="od-form-error" role="alert">{t(formError, { date: asOf })}</div>}
        <div class="od-actions">
          <button type="submit" class="od-btn primary" disabled={busy}>{busy ? t('searching') : t('search')}</button>
          {shareQuery && (
            <button type="button" class="od-btn" onClick={() => void copyLink(shareQuery)}>{t('copyLink')}</button>
          )}
        </div>
      </form>
      {result}
    </OpsShell>
  );
}
