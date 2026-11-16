/**
 * 操作日誌一列（2026-11-16 改版：一般風格、排緊）。
 * 第一行：[類型] 操作者暱稱 UID短碼 … 時間 ▾；第二行：內容（一行，過長省略）；點列展開詳細與複製診斷包。
 * 點暱稱＝只看這位操作者（呼叫端在前端篩 actorUid）。
 */
import type { JSX } from 'preact';

import { useT } from '@/i18n/i18n';

import {
  formatOperationLogCreatedAt,
  formatOperationLogShortTime,
  getOperationLogActorUid,
  getOperationLogDocId,
  getOperationLogToneClass,
  type OperationLogDoc,
} from '../data/operation-logs';
import { shortUid } from '../data/pm-audit-view';

export interface OperationLogRowProps {
  log: OperationLogDoc;
  open: boolean;
  onToggle: () => void;
  onFilterActor: (uid: string, name: string) => void;
  onCopy: (docId: string) => void;
}

export function OperationLogRow({ log, open, onToggle, onFilterActor, onCopy }: OperationLogRowProps): JSX.Element {
  const t = useT();
  const unmarked = t('logs.operation.unmarked');
  const tone = getOperationLogToneClass(log.type);
  const docId = getOperationLogDocId(log);
  const actorUid = getOperationLogActorUid(log);
  const type = String(log.type || '').trim();
  const typeName = String(log.typeName || type || t('logs.operation.uncategorized')).trim();
  const operator = String(log.operator || '').trim();
  const content = String(log.content || unmarked).trim();
  const eventId = String(log.eventId || '').trim();

  return (
    <div class={`olc-row${open ? ' is-open' : ''}`} onClick={onToggle}>
      <div class="olc-line">
        <span class={`olc-type log-type ${tone}`}>{typeName}</span>
        {actorUid ? (
          <button
            type="button"
            class="pma-person"
            aria-label={`${t('logs.chat.filterByActor')}：${operator || unmarked}`}
            onClick={(e) => {
              e.stopPropagation();
              onFilterActor(actorUid, operator);
            }}
          >
            <span class={`pma-person-name${operator ? '' : ' is-unknown'}`} data-no-translate>{operator || unmarked}</span>
            <span class="pma-uid" data-no-translate>{shortUid(actorUid)}</span>
          </button>
        ) : (
          <span class={`pma-person-name${operator ? '' : ' is-unknown'}`} data-no-translate>{operator || unmarked}</span>
        )}
        <small class="pma-time">{formatOperationLogShortTime(log)}</small>
        <span class="olc-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </div>
      <div class="olc-content" data-no-translate>{content}</div>
      {open ? (
        <div class="olc-detail" onClick={(e) => e.stopPropagation()}>
          <dl>
            <dt>{t('logs.operation.detail.time')}</dt><dd>{formatOperationLogCreatedAt(log, unmarked)}</dd>
            <dt>{t('logs.operation.detail.type')}</dt><dd>{`${typeName}${type ? `（${type}）` : ''}`}</dd>
            <dt>{t('logs.operation.detail.operator')}</dt><dd data-no-translate>{`${operator || unmarked} / ${actorUid || unmarked}`}</dd>
            {eventId ? (<><dt>{t('logs.operation.detail.eventId')}</dt><dd class="is-mono">{eventId}</dd></>) : null}
            {docId ? (<><dt>{t('logs.operation.detail.docId')}</dt><dd class="is-mono">{docId}</dd></>) : null}
          </dl>
          {docId ? (
            <button type="button" class="pma-copy" onClick={() => onCopy(docId)}>{t('logs.operation.copyDiagnostic')}</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
