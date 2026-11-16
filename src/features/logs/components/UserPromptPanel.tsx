/**
 * 日誌中心「用戶提示」頁籤（2026-11-16 第二批；計畫書 1.1）。
 * 資料：errorLogs 中 user-prompt／client-prompt／context.logType user_prompt（A `_isUserPromptLog`），
 * 與錯誤日誌頁共用同一次區間讀取（useErrorLogRange），不另讀。
 * 對舊站 A 的改善：預設依「提示文字」分組（×次數、影響人數、最近時間），點開看是誰、在哪一頁；
 * 每筆「暱稱＋UID 短碼」；來源、分類常駐篩選；英文「Toast」改中文。新站目前沒有寫入端（只看得到舊站寫的資料）。
 */
import './pm-audit.css';

import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';

import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import { errorMs, isUserPrompt, promptCategory, promptMessage, promptSurface, type ErrorLogDoc } from '../data/error-log-model';
import { buildErrorDiagnostic } from '../data/log-diagnostics';
// 為什麼：展開列頁面顯示中文名（顧問 §3.200 第 5 項）。
import { pageLabel } from '../data/page-names';
import { INFINITE_CHUNK, rangeContaining, type LogRange, type PageSizeOption } from '../data/log-range';
import { copyDiagnosticTextToClipboard } from '../data/operation-logs';
import { pmFormatTime } from '../data/pm-audit';
import { shortUid } from '../data/pm-audit-view';
import { InfiniteSentinel } from './InfiniteSentinel';
import { LogPager, LogRangeBar } from './LogRangeBar';
import { useErrorLogRange, type ErrorRangeFetcher } from './useErrorLogRange';

export interface UserPromptPanelProps {
  fetchRange?: ErrorRangeFetcher;
  nowMs?: number;
}

interface PromptGroup {
  key: string;
  message: string;
  category: string;
  logs: ErrorLogDoc[];
  users: number;
  lastMs: number;
}

export function UserPromptPanel(props: UserPromptPanelProps): JSX.Element {
  const t = useT();
  const nowMs = props.nowMs ?? Date.now();
  const [range, setRange] = useState<LogRange>(() => rangeContaining('week', nowMs));
  const [pageSize, setPageSize] = useState<PageSizeOption>(10);
  const [page, setPage] = useState(1);
  const [shown, setShown] = useState(INFINITE_CHUNK);
  const [f, setF] = useState({ q: '', surface: '', category: '' });
  const [openKey, setOpenKey] = useState('');
  const { load, refresh } = useErrorLogRange(range, props.fetchRange);

  const prompts = useMemo(() => (load.status === 'ready' ? load.docs.filter(isUserPrompt) : []), [load]);
  const filtered = useMemo(() => prompts.filter((d) => {
    if (f.surface && promptSurface(d).label !== f.surface) return false;
    if (f.category && promptCategory(d).label !== f.category) return false;
    if (f.q.trim()) {
      const text = [d.userName, d.uid, d.page, promptMessage(d), promptSurface(d).label, promptCategory(d).label].join(' ').toLowerCase();
      if (!text.includes(f.q.trim().toLowerCase())) return false;
    }
    return true;
  }), [prompts, f]);
  const groups = useMemo(() => {
    const map = new Map<string, PromptGroup & { uids: Set<string> }>();
    for (const d of filtered) {
      const message = promptMessage(d) || '-';
      let g = map.get(message);
      if (!g) {
        g = { key: message, message, category: promptCategory(d).label, logs: [], users: 0, lastMs: 0, uids: new Set() };
        map.set(message, g);
      }
      g.logs.push(d);
      if (d.uid) g.uids.add(String(d.uid));
      g.lastMs = Math.max(g.lastMs, errorMs(d));
    }
    return [...map.values()].map(({ uids, ...g }) => ({ ...g, users: uids.size }))
      .sort((a, b) => (b.logs.length - a.logs.length) || (b.lastMs - a.lastMs));
  }, [filtered]);
  const infinite = pageSize === 'infinite';
  const size = infinite ? groups.length || 1 : pageSize;
  const totalPages = Math.max(1, Math.ceil(groups.length / size));
  const safePage = Math.min(page, totalPages);
  const rows = infinite ? groups.slice(0, shown) : groups.slice((safePage - 1) * size, safePage * size);
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(1); setShown(INFINITE_CHUNK); };
  const options = (fn: (d: ErrorLogDoc) => string) => [...new Set(prompts.map(fn).filter(Boolean))].sort();

  async function copy(d: ErrorLogDoc): Promise<void> {
    try {
      await copyDiagnosticTextToClipboard(buildErrorDiagnostic(d));
      toast.show({ message: t('logs.prompt.copied'), tone: 'success' });
    } catch {
      toast.show({ message: t('logs.error.copyFailed'), tone: 'error' });
    }
  }

  return (
    <div class="pma-layout">
      <div class="pma-toolbar">
        <div class="pma-search">
          <svg class="pma-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2" /><path d="M16 16l4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
          <input type="search" value={f.q} placeholder={t('logs.prompt.search')} aria-label={t('logs.prompt.search')} onInput={(e) => set('q', e.currentTarget.value)} />
        </div>
      </div>
      <div class="pma-filters">
        <select class="pma-select" value={f.surface} aria-label={t('logs.prompt.allSurface')} onChange={(e) => set('surface', e.currentTarget.value)}>
          <option value="">{t('logs.prompt.allSurface')}</option>
          {options((d) => promptSurface(d).label).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select class="pma-select" value={f.category} aria-label={t('logs.prompt.allCategory')} onChange={(e) => set('category', e.currentTarget.value)}>
          <option value="">{t('logs.prompt.allCategory')}</option>
          {options((d) => promptCategory(d).label).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <button type="button" class="pma-icon-btn" aria-label={t('logs.chat.refresh')} onClick={() => { setPage(1); refresh(); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>
      <LogRangeBar range={range} pageSize={pageSize} nowMs={nowMs} onRange={(r) => { setPage(1); setShown(INFINITE_CHUNK); setRange(r); }} onPageSize={(n) => { setPage(1); setShown(INFINITE_CHUNK); setPageSize(n); }} />

      {load.status === 'loading' ? <div class="reg-loading" role="status">{t('logs.chat.loading')}</div> : null}
      {load.status === 'error' ? (<div class="pma-note" role="alert"><span>{t('logs.error.loadFailed')}</span><button type="button" class="pma-chip-clear" onClick={refresh}>{t('logs.chat.retry')}</button></div>) : null}
      {load.status === 'ready' ? (
        <div class="lc-summary">
          <span>{t('logs.prompt.summary', { n: prompts.length, g: groups.length })}</span>
          {f.q || f.surface || f.category ? <button type="button" class="pma-chip-clear" onClick={() => setF({ q: '', surface: '', category: '' })}>{t('logs.chat.clearFilter')}</button> : null}
          {load.truncated ? <span class="lc-warn">{t('logs.range.truncated')}</span> : null}
        </div>
      ) : null}
      {load.status === 'ready' && rows.length === 0 ? <div class="pma-note">{t('logs.prompt.empty')}</div> : null}
      {rows.length > 0 ? (
        <div class="pma-log-list" id="user-prompt-log-list">
          {rows.map((g) => {
            const open = openKey === g.key;
            return (
              <div key={g.key} class={`olc-row${open ? ' is-open' : ''}`} onClick={() => setOpenKey(open ? '' : g.key)}>
                <div class="olc-line">
                  <span class="pma-tag lc-sev-prompt">{g.category}</span>
                  <span class="lc-count">{t('logs.error.times', { n: g.logs.length })}</span>
                  <span class="lc-count">{t('logs.error.people', { n: g.users })}</span>
                  <small class="pma-time">{pmFormatTime(g.lastMs)}</small>
                  <span class="olc-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
                </div>
                <div class="olc-content" data-no-translate>{g.message}</div>
                {open ? (
                  <div class="olc-detail" onClick={(e) => e.stopPropagation()}>
                    <div class="lc-sublist">
                      {g.logs.slice(0, 8).map((d, i) => (
                        <div key={`${g.key}#${i}`} class="olc-line lc-subrow">
                          <span class={`pma-person-name${d.userName ? '' : ' is-unknown'}`} data-no-translate>{d.userName || t('logs.chat.unknownUser')}</span>
                          <span class="pma-uid" data-no-translate>{shortUid(String(d.uid || ''))}</span>
                          {/* 為什麼：展開列只留頁面名且顯示中文，讓暱稱有寬度（顧問 §3.200 第 3、5 項）。 */}
                          <span class="lc-count lc-subrow-page" data-no-translate>{pageLabel(String(d.page || 'unknown'))}</span>
                          <small class="pma-time">{pmFormatTime(errorMs(d))}</small>
                          <button type="button" class="pma-copy" onClick={() => { copy(d).catch(() => undefined); }}>{t('logs.prompt.copyShort')}</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {infinite && shown < groups.length ? (
        <div class="pm-audit-load-more-row"><button type="button" class="pma-more" onClick={() => setShown((n) => n + INFINITE_CHUNK)}>{t('logs.chat.loadMore')}</button></div>
      ) : null}
      {infinite ? <InfiniteSentinel enabled={load.status === 'ready' && shown < groups.length} onReach={() => setShown((n) => n + INFINITE_CHUNK)} /> : null}
      {!infinite && load.status === 'ready' ? (
        <LogPager page={safePage} hasPrev={safePage > 1} hasNext={safePage < totalPages} busy={false} onPrev={() => setPage(safePage - 1)} onNext={() => setPage(safePage + 1)} />
      ) : null}
    </div>
  );
}
