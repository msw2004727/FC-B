/**
 * 日誌中心「操作日誌」頁籤（2026-11-16 改版：一般風格、排緊、時間區間＋每頁筆數；站長）。
 * - 讀取：依時間區間（日／週／月）一次讀該區間（上限 OPERATION_LOGS_RANGE_CAP），換區間才重讀；
 *   類型、關鍵字、操作者篩選與分頁都在前端，不另讀。取代原本「一開就讀最新 200 筆」。
 * - 每列「類型＋操作者暱稱＋UID 短碼＋時間」，內容一行；點列展開詳細與複製診斷包。
 * - 權限照舊（頁面 `admin.logs.entry`；Rules `operationLogs` read isAuth 不變）。
 */
import './pm-audit.css';

import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import { OPLOG_TYPE_GROUPS, filterOperationLogsList, paginateOperationLogs } from '../data/log-center-model';
import { INFINITE_CHUNK, rangeContaining, type LogRange, type PageSizeOption } from '../data/log-range';
import {
  buildOperationLogDiagnosticText,
  copyDiagnosticTextToClipboard,
  fetchOperationLogsInRange,
  getOperationLogActorUid,
  getOperationLogDocId,
  type OperationLogDoc,
  type OperationLogsRangeResult,
} from '../data/operation-logs';
import { shortUid } from '../data/pm-audit-view';
import { InfiniteSentinel } from './InfiniteSentinel';
import { LogPager, LogRangeBar } from './LogRangeBar';
import { OperationLogRow } from './OperationLogRow';

export interface OperationLogPanelProps {
  /** 測試／harness 注入。 */
  fetchRange?: (startMs: number, endMs: number) => Promise<OperationLogsRangeResult>;
  nowMs?: number;
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; docs: OperationLogDoc[]; truncated: boolean };

export function OperationLogPanel(props: OperationLogPanelProps): JSX.Element {
  const t = useT();
  const fetchRange = props.fetchRange ?? fetchOperationLogsInRange;
  const nowMs = props.nowMs ?? Date.now();
  const [range, setRange] = useState<LogRange>(() => rangeContaining('week', nowMs));
  const [pageSize, setPageSize] = useState<PageSizeOption>(10);
  const [page, setPage] = useState(1);
  const [shown, setShown] = useState(INFINITE_CHUNK);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [actor, setActor] = useState<{ uid: string; name: string } | null>(null);
  const [openId, setOpenId] = useState('');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const seq = useRef(0);

  async function reload(r: LogRange): Promise<void> {
    const mySeq = ++seq.current;
    setLoad({ status: 'loading' });
    try {
      const res = await fetchRange(r.startMs, r.endMs);
      if (mySeq === seq.current) setLoad({ status: 'ready', docs: res.docs, truncated: res.truncated });
    } catch {
      if (mySeq === seq.current) setLoad({ status: 'error' });
    }
  }

  useEffect(() => {
    reload(range).catch(() => undefined);
    return () => {
      seq.current += 1;
    };
  }, [range.startMs, range.endMs]);

  const all = load.status === 'ready' ? load.docs : [];
  const filtered = useMemo(() => {
    const list = filterOperationLogsList(all, { keyword, typeFilter });
    return actor ? list.filter((l) => getOperationLogActorUid(l) === actor.uid) : list;
  }, [all, keyword, typeFilter, actor]);
  const infinite = pageSize === 'infinite';
  const paged = useMemo(
    () => paginateOperationLogs(filtered, infinite ? 1 : page, infinite ? Math.max(1, filtered.length) : pageSize),
    [filtered, page, pageSize, infinite],
  );
  const rows = infinite ? paged.sorted.slice(0, shown) : paged.pageItems;

  function resetPaging(): void {
    setPage(1);
    setShown(INFINITE_CHUNK);
  }

  async function copy(docId: string): Promise<void> {
    const log = filtered.find((l) => getOperationLogDocId(l) === docId);
    if (!log) {
      toast.show({ message: t('logs.operation.copyNotFound'), tone: 'error' });
      return;
    }
    const text = buildOperationLogDiagnosticText(log, {
      header: t('logs.operation.diagnostic.header'),
      timeLabel: t('logs.operation.detail.time'),
      typeLabel: t('logs.operation.detail.type'),
      operatorLabel: t('logs.operation.detail.operator'),
      contentLabel: t('logs.operation.detail.content'),
      eventIdLabel: t('logs.operation.detail.eventId'),
      docIdLabel: t('logs.operation.detail.docId'),
      uncategorized: t('logs.operation.uncategorized'),
      unmarked: t('logs.operation.unmarked'),
      none: t('logs.operation.none'),
    });
    try {
      await copyDiagnosticTextToClipboard(text);
      toast.show({ message: t('logs.operation.copySuccess'), tone: 'success' });
    } catch {
      toast.show({ message: t('logs.operation.copyError'), tone: 'error' });
    }
  }

  return (
    <div class="pma-layout">
      <div class="pma-toolbar">
        <div class="pma-search">
          <svg class="pma-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2" />
            <path d="M16 16l4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
          <input
            id="oplog-search"
            type="search"
            value={keyword}
            placeholder={t('logs.operation.searchShort')}
            aria-label={t('logs.operation.searchPlaceholder')}
            onInput={(e) => { setKeyword(e.currentTarget.value); resetPaging(); }}
          />
        </div>
      </div>
      <div class="pma-filters">
        <select
          id="oplog-type-filter"
          class="pma-select"
          value={typeFilter}
          aria-label={t('logs.operation.allTypes')}
          onChange={(e) => { setTypeFilter(e.currentTarget.value); resetPaging(); }}
        >
          <option value="">{t('logs.operation.allTypes')}</option>
          {OPLOG_TYPE_GROUPS.map((group) => (
            <optgroup key={group.groupKey} label={t(group.labelKey)}>
              {group.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button type="button" class="pma-icon-btn" aria-label={t('logs.chat.refresh')} onClick={() => { resetPaging(); reload(range).catch(() => undefined); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>

      <LogRangeBar
        range={range}
        pageSize={pageSize}
        nowMs={nowMs}
        onRange={(next) => { resetPaging(); setRange(next); }}
        onPageSize={(next) => { resetPaging(); setPageSize(next); }}
      />

      {actor ? (
        <div class="pma-active-filter">
          <span class="pma-chip is-active" data-no-translate>
            {t('logs.chat.filterActorChip', { name: `${actor.name || t('logs.chat.unknownUser')} ${shortUid(actor.uid)}` })}
          </span>
          <button type="button" class="pma-chip-clear" onClick={() => { setActor(null); resetPaging(); }}>{t('logs.chat.clearFilter')}</button>
        </div>
      ) : null}

      {load.status === 'loading' ? <div class="reg-loading" role="status">{t('logs.operation.loading')}</div> : null}
      {load.status === 'error' ? (
        <div class="pma-note" role="alert">
          <span>{t('logs.operation.loadError')}</span>
          <button type="button" class="pma-chip-clear" onClick={() => { reload(range).catch(() => undefined); }}>{t('logs.operation.retry')}</button>
        </div>
      ) : null}
      {load.status === 'ready' ? (
        <>
          <div class="lc-summary">
            <span>{t('logs.range.total', { n: paged.totalCount })}</span>
            {load.truncated ? <span class="lc-warn">{t('logs.range.truncated')}</span> : null}
          </div>
          {rows.length === 0 ? <div class="pma-note">{t('logs.operation.empty')}</div> : (
            <div class="pma-log-list" id="operation-log-list">
              {rows.map((log, idx) => {
                const id = getOperationLogDocId(log) || `oplog-${idx}`;
                return (
                  <OperationLogRow
                    key={id}
                    log={log}
                    open={openId === id}
                    onToggle={() => setOpenId(openId === id ? '' : id)}
                    onFilterActor={(uid, name) => { setActor({ uid, name }); resetPaging(); }}
                    onCopy={(docId) => { copy(docId).catch(() => undefined); }}
                  />
                );
              })}
            </div>
          )}
          {infinite && shown < paged.sorted.length ? (
            <div class="pm-audit-load-more-row">
              <button type="button" class="pma-more" onClick={() => setShown((n) => n + INFINITE_CHUNK)}>{t('logs.chat.loadMore')}</button>
            </div>
          ) : null}
          {!infinite ? (
            <LogPager
              page={paged.safePage}
              hasPrev={paged.safePage > 1}
              hasNext={paged.safePage < paged.totalPages}
              busy={false}
              onPrev={() => setPage(paged.safePage - 1)}
              onNext={() => setPage(paged.safePage + 1)}
            />
          ) : null}
        </>
      ) : null}
      {/* 觸發點放在讀取狀態分支外：重新整理時不卸載重掛，避免重整後自動多顯示一批（第三輪 Flash P2）；
          清單太短、觸發點一直在畫面內時改由上方「加載更多」手動接。 */}
      {infinite ? (
        <InfiniteSentinel
          enabled={load.status === 'ready' && shown < paged.sorted.length}
          onReach={() => setShown((n) => n + INFINITE_CHUNK)}
        />
      ) : null}
    </div>
  );
}
