/**
 * 日誌中心「稽核日誌」頁籤（2026-11-16 第二批；計畫書 1.1、3.3）。
 * 對舊站 A 的改善：篩選常駐一列（不用展開）；日／週／月＋‹ ›；每列一張細卡「動作 暱稱 UID短碼 → 對象・時間」，
 * 失敗用紅色標籤；完整 UID、meta、文件 ID 只在展開時看；meta 逐欄顯示。
 * 讀取見 audit-logs.ts（逐日查、一次最多往前 7 天、區間上限 500）。動作／關鍵字在已讀資料中篩（同 A）。
 * actorName 缺值才批次查 users 補名（同聊天室 NameResolver，只放記憶體）。不做「補齊操作者名稱」（寫入）。
 */
import './pm-audit.css';

import { Fragment, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

// 為什麼：稽核 meta 欄名改中文（顧問 §3.200 第 1 項）。
import { AUDIT_ACTIONS, auditActionLabel, auditMetaKeyLabel, auditMetaPairs, auditResultLabel, auditSearchText, auditSourceLabel, auditTargetLabel, taipeiDayKey, dayKeysDesc, type AuditEntry } from '../data/audit-log-model';
import { AUDIT_RANGE_CAP, fetchAuditPage, readAuditDay, type AuditCursor, type AuditDayReader } from '../data/audit-logs';
import { buildAuditDiagnostic } from '../data/log-diagnostics';
import { INFINITE_CHUNK, rangeContaining, type LogRange, type PageSizeOption } from '../data/log-range';
import { copyDiagnosticTextToClipboard } from '../data/operation-logs';
import { pmFormatTime } from '../data/pm-audit';
import { resolvePmUserNames, type NameResolver } from '../data/pm-audit-names';
import { shortUid } from '../data/pm-audit-view';
import { InfiniteSentinel } from './InfiniteSentinel';
import { LogPager, LogRangeBar } from './LogRangeBar';

export interface AuditLogPanelProps {
  readDay?: AuditDayReader;
  resolveNames?: NameResolver;
  nowMs?: number;
}

interface Pages {
  status: 'loading' | 'error' | 'ready';
  chunks: AuditEntry[][];
  cursor: AuditCursor;
  done: boolean;
  paused: boolean;
  truncated: boolean;
  busy: boolean;
}

const START: Pages = { status: 'loading', chunks: [], cursor: { dayIdx: 0, lastDoc: null }, done: false, paused: false, truncated: false, busy: false };

export function AuditLogPanel(props: AuditLogPanelProps): JSX.Element {
  const t = useT();
  const readDay = props.readDay ?? readAuditDay;
  const resolveNames = props.resolveNames ?? resolvePmUserNames;
  const nowMs = props.nowMs ?? Date.now();
  const [range, setRange] = useState<LogRange>(() => rangeContaining('week', nowMs));
  const [pageSize, setPageSize] = useState<PageSizeOption>(10);
  const [pageIdx, setPageIdx] = useState(0);
  const [action, setAction] = useState('');
  const [keyword, setKeyword] = useState('');
  const [openId, setOpenId] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [pages, setPages] = useState<Pages>(START);
  const seq = useRef(0);
  const ref = useRef(pages);
  ref.current = pages;
  // 依賴含「今天」日鍵：頁面開過午夜時，新的一天會納入（第二批審查 Flash P2）。
  const todayKey = taipeiDayKey(nowMs);
  const dayKeys = useMemo(() => dayKeysDesc(range.startMs, range.endMs, nowMs), [range.startMs, range.endMs, todayKey]);
  const want = pageSize === 'infinite' ? INFINITE_CHUNK : pageSize;

  async function load(first: boolean): Promise<boolean> {
    const cur = ref.current;
    if (!first && (cur.status !== 'ready' || cur.busy || (cur.done && !cur.paused))) return false;
    const mySeq = first ? ++seq.current : seq.current;
    const next = first ? START : { ...cur, busy: true };
    ref.current = next;
    setPages(next);
    try {
      // 區間累計上限 500：最後一批只抓剩餘額度，剛好停在上限（第二批審查 Flash P1）。
      const loaded = first ? 0 : cur.chunks.reduce((n, c) => n + c.length, 0);
      const res = await fetchAuditPage(dayKeys, first ? START.cursor : cur.cursor, Math.max(1, Math.min(want, AUDIT_RANGE_CAP - loaded)), taipeiDayKey(nowMs), readDay);
      if (mySeq !== seq.current) return false;
      const chunks = first ? [res.entries] : cur.chunks.concat([res.entries]);
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const capped = !res.done && total >= AUDIT_RANGE_CAP;
      const done: Pages = { status: 'ready', chunks, cursor: res.cursor, done: res.done || capped, paused: res.pausedAtDayLimit && !capped, truncated: capped, busy: false };
      ref.current = done;
      setPages(done);
      const missing = [...new Set(res.entries.filter((e) => !e.actorName && e.actorUid).map((e) => e.actorUid))];
      if (missing.length) {
        resolveNames(missing).then((found) => { if (mySeq === seq.current) setNames((p) => ({ ...p, ...found })); }).catch(() => undefined);
      }
      return true;
    } catch {
      if (mySeq !== seq.current) return false;
      const failed: Pages = first ? { ...START, status: 'error' } : { ...ref.current, busy: false };
      ref.current = failed;
      setPages(failed);
      return false;
    }
  }

  useEffect(() => {
    setPageIdx(0);
    load(true).catch(() => undefined);
    return () => { seq.current += 1; };
  }, [range.startMs, range.endMs, want]);

  const infinite = pageSize === 'infinite';
  const raw = infinite ? pages.chunks.flat() : (pages.chunks[pageIdx] ?? []);
  const nameOf = (e: AuditEntry) => e.actorName || names[e.actorUid] || '';
  const rows = raw.filter((e) => (!action || e.action === action) && (!keyword.trim() || auditSearchText(e, nameOf(e)).includes(keyword.trim().toLowerCase())));
  const moreAvailable = !pages.done || pages.paused;
  const ok = pages.chunks.flat().filter((e) => e.result === 'success').length;
  const bad = pages.chunks.flat().filter((e) => e.result === 'failure').length;

  async function nextPage(): Promise<void> {
    if (pageIdx + 1 < pages.chunks.length) { setPageIdx(pageIdx + 1); return; }
    if (await load(false)) setPageIdx(pageIdx + 1);
  }

  async function copy(e: AuditEntry): Promise<void> {
    try {
      await copyDiagnosticTextToClipboard(buildAuditDiagnostic(e, nameOf(e)));
      toast.show({ message: t('logs.audit.copied'), tone: 'success' });
    } catch {
      toast.show({ message: t('logs.audit.copyFailed'), tone: 'error' });
    }
  }

  return (
    <div class="pma-layout">
      <div class="pma-toolbar">
        <div class="pma-search">
          <svg class="pma-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2" /><path d="M16 16l4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
          <input type="search" value={keyword} placeholder={t('logs.audit.search')} aria-label={t('logs.audit.search')} onInput={(e) => setKeyword(e.currentTarget.value)} />
        </div>
      </div>
      <div class="pma-filters">
        <select class="pma-select" value={action} aria-label={t('logs.audit.allActions')} onChange={(e) => setAction(e.currentTarget.value)}>
          <option value="">{t('logs.audit.allActions')}</option>
          {AUDIT_ACTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {action || keyword ? <button type="button" class="pma-chip-clear" onClick={() => { setAction(''); setKeyword(''); }}>{t('logs.chat.clearFilter')}</button> : null}
        <button type="button" class="pma-icon-btn" aria-label={t('logs.chat.refresh')} onClick={() => { setPageIdx(0); load(true).catch(() => undefined); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>
      <LogRangeBar range={range} pageSize={pageSize} nowMs={nowMs} onRange={setRange} onPageSize={(n) => { setPageIdx(0); setPageSize(n); }} />

      {pages.status === 'loading' ? <div class="reg-loading" role="status">{t('logs.chat.loading')}</div> : null}
      {pages.status === 'error' ? (
        <div class="pma-note" role="alert"><span>{t('logs.audit.loadFailed')}</span><button type="button" class="pma-chip-clear" onClick={() => { load(true).catch(() => undefined); }}>{t('logs.chat.retry')}</button></div>
      ) : null}
      {/* 為什麼：成功／失敗統計只在區間全部讀完時顯示（顧問 §3.200 第 2 項）。 */}
      {pages.status === 'ready' && pages.done && !pages.paused && !pages.truncated ? (
        <div class="lc-summary"><span class="lc-dot is-ok" />{t('logs.audit.okCount', { n: ok })}<span class="lc-dot is-bad" />{t('logs.audit.badCount', { n: bad })}</div>
      ) : null}
      {pages.status === 'ready' && rows.length === 0 && !pages.busy ? <div class="pma-note">{t('logs.audit.empty')}</div> : null}
      {rows.length > 0 ? (
        <div class="pma-log-list" id="audit-log-list">
          {rows.map((e) => {
            const name = nameOf(e);
            const target = auditTargetLabel(e);
            const open = openId === e._docId;
            const meta = auditMetaPairs(e.meta);
            return (
              <div key={e._docId} class={`olc-row${open ? ' is-open' : ''}`} onClick={() => setOpenId(open ? '' : e._docId)}>
                <div class="olc-line">
                  <span class={`pma-tag ${e.result === 'failure' ? 'pma-tag-bad' : 'pma-tag-msg'}`}>{auditActionLabel(e.action)}</span>
                  <span class={`pma-person-name${name ? '' : ' is-unknown'}`} data-no-translate>{name || t('logs.chat.unknownUser')}</span>
                  <span class="pma-uid" data-no-translate>{shortUid(e.actorUid)}</span>
                  <small class="pma-time">{pmFormatTime(e.createdAtMs)}</small>
                  <span class="olc-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
                </div>
                {target ? <div class="olc-content" data-no-translate>{target}</div> : null}
                {open ? (
                  <div class="olc-detail" onClick={(ev) => ev.stopPropagation()}>
                    <dl>
                      <dt>{t('logs.audit.result')}</dt><dd>{auditResultLabel(e.result)}</dd>
                      <dt>{t('logs.audit.source')}</dt><dd>{auditSourceLabel(e.source)}</dd>
                      <dt>{t('logs.audit.actor')}</dt><dd data-no-translate>{`${name || t('logs.chat.unknownUser')} / ${e.actorUid || '-'}`}</dd>
                      {e.targetId ? (<><dt>{t('logs.audit.targetId')}</dt><dd class="is-mono">{e.targetId}</dd></>) : null}
                      {/* 為什麼：meta 欄名與 true／false 值顯示中文（顧問 §3.200 第 1 項）。 */}
                      {meta.map(([k, v]) => (<Fragment key={k}><dt>{auditMetaKeyLabel(k)}</dt><dd data-no-translate>{v === 'true' ? '是' : v === 'false' ? '否' : v}</dd></Fragment>))}
                      <dt>{t('logs.operation.detail.docId')}</dt><dd class="is-mono">{e._docId}</dd>
                    </dl>
                    <button type="button" class="pma-copy" onClick={() => { copy(e).catch(() => undefined); }}>{t('logs.operation.copyDiagnostic')}</button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {pages.status === 'ready' && pages.truncated ? <div class="pma-note lc-warn">{t('logs.range.truncated')}</div> : null}
      {pages.status === 'ready' && infinite && moreAvailable && !pages.truncated ? (
        <>
          <InfiniteSentinel enabled={!pages.busy && !pages.paused} onReach={() => { load(false).catch(() => undefined); }} />
          <div class="pm-audit-load-more-row">
            <button type="button" class="pma-more" disabled={pages.busy} onClick={() => { load(false).catch(() => undefined); }}>{pages.busy ? t('logs.chat.loading') : t('logs.chat.loadMore')}</button>
          </div>
        </>
      ) : null}
      {pages.status === 'ready' && !infinite ? (
        <LogPager page={pageIdx + 1} hasPrev={pageIdx > 0} hasNext={pageIdx + 1 < pages.chunks.length || moreAvailable} busy={pages.busy}
          onPrev={() => setPageIdx(Math.max(0, pageIdx - 1))} onNext={() => { nextPage().catch(() => undefined); }} />
      ) : null}
    </div>
  );
}
