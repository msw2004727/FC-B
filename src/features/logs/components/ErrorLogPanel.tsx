/**
 * 日誌中心「錯誤日誌」頁籤（2026-11-16 第二批；計畫書 1.1）。
 * 對舊站 A 的改善：依區間由新到舊讀（A 是任意 200 筆無排序）；頂端一行「嚴重・警告・共」取代 5 個數字方塊；
 * 預設「依類型分組」：同類收成一列（×次數、影響人數、最近時間），點開才看每筆；展開欄位全中文；
 * 每筆「暱稱＋UID 短碼」；篩選常駐（嚴重度、類型），頁面／裝置／版本收在「更多」。
 * 用戶提示（errorCode user-prompt 等）不在本頁，見 UserPromptPanel（同一次讀取）。不做「清除 30 天前」。
 */
import './pm-audit.css';

import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';

import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import { chineseMessage, codeLabel, deviceLabel, errorMs, errorWhere, groupErrors, isUserPrompt, severityOf, type ErrorGroup, type ErrorLogDoc, type Severity } from '../data/error-log-model';
import { buildErrorDiagnostic, buildErrorGroupDiagnostic } from '../data/log-diagnostics';
import { INFINITE_CHUNK, rangeContaining, type LogRange, type PageSizeOption } from '../data/log-range';
import { copyDiagnosticTextToClipboard } from '../data/operation-logs';
import { pmFormatTime } from '../data/pm-audit';
// 為什麼：逐筆列 UID 改後四碼、頁面顯示中文名（顧問 §3.200 第 4、5 項）。
import { pageLabel } from '../data/page-names';
import { shortUid, uidTail } from '../data/pm-audit-view';
import { InfiniteSentinel } from './InfiniteSentinel';
import { LogPager, LogRangeBar } from './LogRangeBar';
import { useErrorLogRange, type ErrorRangeFetcher } from './useErrorLogRange';

export interface ErrorLogPanelProps {
  fetchRange?: ErrorRangeFetcher;
  nowMs?: number;
}

const SEV: Severity[] = ['critical', 'warn', 'info'];

function uniq(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))].sort();
}

export function ErrorLogPanel(props: ErrorLogPanelProps): JSX.Element {
  const t = useT();
  const nowMs = props.nowMs ?? Date.now();
  const [range, setRange] = useState<LogRange>(() => rangeContaining('week', nowMs));
  const [pageSize, setPageSize] = useState<PageSizeOption>(10);
  const [page, setPage] = useState(1);
  const [shown, setShown] = useState(INFINITE_CHUNK);
  const [grouped, setGrouped] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [f, setF] = useState({ q: '', sev: '', type: '', page: '', device: '', version: '' });
  const [openKey, setOpenKey] = useState('');
  const { load, refresh } = useErrorLogRange(range, props.fetchRange);

  const errors = useMemo(() => (load.status === 'ready' ? load.docs.filter((d) => !isUserPrompt(d)) : []), [load]);
  const filtered = useMemo(() => errors.filter((d) => {
    if (f.sev && severityOf(d) !== f.sev) return false;
    if (f.type && codeLabel(d) !== f.type) return false;
    if (f.page && String(d.page || 'unknown') !== f.page) return false;
    if (f.device && deviceLabel(d) !== f.device) return false;
    if (f.version && String(d.appVersion || '') !== f.version) return false;
    if (f.q.trim()) {
      const text = [d.userName, d.uid, d.page, errorWhere(d), codeLabel(d), chineseMessage(d), d.errorMessage, d.appVersion, deviceLabel(d), d.url].join(' ').toLowerCase();
      if (!text.includes(f.q.trim().toLowerCase())) return false;
    }
    return true;
  }), [errors, f]);
  const groups = useMemo(() => groupErrors(filtered), [filtered]);
  const items: Array<ErrorGroup | ErrorLogDoc> = grouped ? groups : [...filtered].sort((a, b) => errorMs(b) - errorMs(a));
  const infinite = pageSize === 'infinite';
  const size = infinite ? items.length || 1 : pageSize;
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const safePage = Math.min(page, totalPages);
  const rows = infinite ? items.slice(0, shown) : items.slice((safePage - 1) * size, safePage * size);
  const count = (s: Severity) => errors.filter((d) => severityOf(d) === s).length;
  const active = Object.values(f).some(Boolean);
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(1); setShown(INFINITE_CHUNK); };

  async function copy(text: string): Promise<void> {
    try {
      await copyDiagnosticTextToClipboard(text);
      toast.show({ message: t('logs.error.copied'), tone: 'success' });
    } catch {
      toast.show({ message: t('logs.error.copyFailed'), tone: 'error' });
    }
  }

  const sevTag = (s: Severity) => <span class={`pma-tag lc-sev-${s}`}>{t(`logs.error.sev.${s}`)}</span>;

  function renderLog(d: ErrorLogDoc, key: string, inGroup: boolean): JSX.Element {
    const open = openKey === key;
    // 為什麼：逐筆列 UID 顯示末四碼，群組內列仍用短碼（顧問 §3.200 第 4 項）。
    const displayUid = inGroup ? shortUid(String(d.uid || '')) : uidTail(String(d.uid || ''));
    return (
      <div key={key} class={`olc-row${open ? ' is-open' : ''}${inGroup ? ' is-sub' : ''}`} onClick={(e) => { e.stopPropagation(); setOpenKey(open ? '' : key); }}>
        <div class="olc-line">
          {inGroup ? null : sevTag(severityOf(d))}
          {/* 為什麼：逐筆列類型不可截斷（顧問 §3.200 第 4 項）。 */}
          {inGroup ? null : <span class="olc-type lc-type-full">{codeLabel(d)}</span>}
          {/* 為什麼：逐筆列暱稱限寬、UID 顯示末四碼（顧問 §3.200 第 4 項）。 */}
          <span class={`pma-person-name${inGroup ? '' : ' lc-name-short'}${d.userName ? '' : ' is-unknown'}`} data-no-translate>{d.userName || t('logs.chat.unknownUser')}</span>
          <span class="pma-uid" data-no-translate>{displayUid}</span>
          <small class="pma-time">{pmFormatTime(errorMs(d))}</small>
          <span class="olc-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </div>
        {inGroup ? null : <div class="olc-content">{chineseMessage(d)}</div>}
        {open ? (
          <div class="olc-detail" onClick={(e) => e.stopPropagation()}>
            <dl>
              {/* 為什麼：發生位置保留原字並用等寬、頁面顯示中文（顧問 §3.200 第 5 項）。 */}
              <dt>{t('logs.error.where')}</dt><dd class="is-mono" data-no-translate>{errorWhere(d) || '-'}</dd>
              <dt>{t('logs.error.page')}</dt><dd data-no-translate>{pageLabel(String(d.page || 'unknown'))}</dd>
              <dt>{t('logs.error.device')}</dt><dd data-no-translate>{`${deviceLabel(d)}${d.appVersion ? ` · ${d.appVersion}` : ''}`}</dd>
              <dt>{t('logs.error.user')}</dt><dd data-no-translate>{`${d.userName || t('logs.chat.unknownUser')} / ${d.uid || '-'}`}</dd>
              <dt>{t('logs.error.raw')}</dt><dd class="is-mono" data-no-translate>{d.errorMessage || '-'}</dd>
              {d.url ? (<><dt>{t('logs.error.url')}</dt><dd class="is-mono" data-no-translate>{d.url}</dd></>) : null}
            </dl>
            <button type="button" class="pma-copy" onClick={() => { copy(buildErrorDiagnostic(d)).catch(() => undefined); }}>{t('logs.operation.copyDiagnostic')}</button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div class="pma-layout">
      <div class="pma-toolbar">
        <div class="pma-search">
          <svg class="pma-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2" /><path d="M16 16l4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
          <input type="search" value={f.q} placeholder={t('logs.error.search')} aria-label={t('logs.error.search')} onInput={(e) => set('q', e.currentTarget.value)} />
        </div>
        <div class="lc-seg" role="group" aria-label={t('logs.error.view')}>
          <button type="button" class={`lc-seg-btn${grouped ? ' is-on' : ''}`} aria-pressed={grouped} onClick={() => { setGrouped(true); setPage(1); }}>{t('logs.error.grouped')}</button>
          <button type="button" class={`lc-seg-btn${grouped ? '' : ' is-on'}`} aria-pressed={!grouped} onClick={() => { setGrouped(false); setPage(1); }}>{t('logs.error.each')}</button>
        </div>
      </div>
      <div class="pma-filters">
        <select class="pma-select" value={f.sev} aria-label={t('logs.error.allSev')} onChange={(e) => set('sev', e.currentTarget.value)}>
          <option value="">{t('logs.error.allSev')}</option>
          {SEV.map((s) => <option key={s} value={s}>{t(`logs.error.sev.${s}`)}</option>)}
        </select>
        <select class="pma-select" value={f.type} aria-label={t('logs.error.allTypes')} onChange={(e) => set('type', e.currentTarget.value)}>
          <option value="">{t('logs.error.allTypes')}</option>
          {uniq(errors.map(codeLabel)).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <button type="button" class={`pma-chip${moreOpen ? ' is-on' : ''}`} aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>{t('logs.error.more')}</button>
        <button type="button" class="pma-icon-btn" aria-label={t('logs.chat.refresh')} onClick={() => { setPage(1); refresh(); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>
      {moreOpen ? (
        <div class="pma-filters">
          {(['page', 'device', 'version'] as const).map((k) => (
            <select key={k} class="pma-select" value={f[k]} aria-label={t(`logs.error.all_${k}`)} onChange={(e) => set(k, e.currentTarget.value)}>
              <option value="">{t(`logs.error.all_${k}`)}</option>
              {/* 為什麼：頁面下拉選項顯示中文名，value 仍保留原始代碼（顧問 §3.200 第 5 項）。 */}
              {uniq(errors.map((d) => (k === 'page' ? String(d.page || 'unknown') : k === 'device' ? deviceLabel(d) : String(d.appVersion || '')))).map((v) => <option key={v} value={v}>{k === 'page' ? pageLabel(v) : v}</option>)}
            </select>
          ))}
        </div>
      ) : null}
      <LogRangeBar range={range} pageSize={pageSize} nowMs={nowMs} onRange={(r) => { setPage(1); setShown(INFINITE_CHUNK); setRange(r); }} onPageSize={(n) => { setPage(1); setShown(INFINITE_CHUNK); setPageSize(n); }} />

      {load.status === 'loading' ? <div class="reg-loading" role="status">{t('logs.chat.loading')}</div> : null}
      {load.status === 'error' ? (<div class="pma-note" role="alert"><span>{t('logs.error.loadFailed')}</span><button type="button" class="pma-chip-clear" onClick={refresh}>{t('logs.chat.retry')}</button></div>) : null}
      {load.status === 'ready' ? (
        <div class="lc-summary">
          <span class="lc-dot is-bad" />{t('logs.error.criticalN', { n: count('critical') })}
          <span class="lc-dot is-warn" />{t('logs.error.warnN', { n: count('warn') })}
          <span>{t('logs.range.total', { n: errors.length })}</span>
          {active ? <button type="button" class="pma-chip-clear" onClick={() => setF({ q: '', sev: '', type: '', page: '', device: '', version: '' })}>{t('logs.chat.clearFilter')}</button> : null}
          {load.truncated ? <span class="lc-warn">{t('logs.range.truncated')}</span> : null}
        </div>
      ) : null}
      {load.status === 'ready' && rows.length === 0 ? <div class="pma-note">{t('logs.error.empty')}</div> : null}
      {rows.length > 0 ? (
        <div class="pma-log-list" id="error-log-list">
          {rows.map((item) => {
            if (!grouped) return renderLog(item as ErrorLogDoc, String((item as ErrorLogDoc)._docId), false);
            const g = item as ErrorGroup;
            const open = openKey === g.key;
            return (
              <div key={g.key} class={`olc-row${open ? ' is-open' : ''}`} onClick={() => setOpenKey(open ? '' : g.key)}>
                <div class="olc-line">
                  {sevTag(g.severity)}
                  <span class="olc-type">{g.label}</span>
                  <span class="lc-count">{t('logs.error.times', { n: g.logs.length })}</span>
                  <span class="lc-count">{t('logs.error.people', { n: g.users })}</span>
                  <small class="pma-time">{pmFormatTime(g.lastMs)}</small>
                  <span class="olc-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
                </div>
                <div class="olc-content">{g.message}</div>
                {open ? (
                  <div class="olc-detail" onClick={(e) => e.stopPropagation()}>
                    <dl>
                      {/* 為什麼：分組展開的頁面顯示中文名、發生位置保留原字並用等寬（顧問 §3.200 第 5 項）。 */}
                      <dt>{t('logs.error.page')}</dt><dd data-no-translate>{pageLabel(g.page)}</dd>
                      <dt>{t('logs.error.where')}</dt><dd class="is-mono" data-no-translate>{g.where || '-'}</dd>
                    </dl>
                    <div class="lc-sublist">{g.logs.slice(0, 5).map((d, i) => renderLog(d, `${g.key}#${i}`, true))}</div>
                    {g.logs.length > 5 ? <div class="pma-note">{t('logs.error.restN', { n: g.logs.length - 5 })}</div> : null}
                    <button type="button" class="pma-copy" onClick={() => { copy(buildErrorGroupDiagnostic(g)).catch(() => undefined); }}>{t('logs.error.copyGroup')}</button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {infinite && shown < items.length ? (
        <div class="pm-audit-load-more-row"><button type="button" class="pma-more" onClick={() => setShown((n) => n + INFINITE_CHUNK)}>{t('logs.chat.loadMore')}</button></div>
      ) : null}
      {infinite ? <InfiniteSentinel enabled={load.status === 'ready' && shown < items.length} onReach={() => setShown((n) => n + INFINITE_CHUNK)} /> : null}
      {!infinite && load.status === 'ready' ? (
        <LogPager page={safePage} hasPrev={safePage > 1} hasNext={safePage < totalPages} busy={false} onPrev={() => setPage(safePage - 1)} onNext={() => setPage(safePage + 1)} />
      ) : null}
    </div>
  );
}
