/**
 * 聊天室稽核 Log 列表（2026-11-16 改版，顧問 §3.195 案 A）。
 * - 每列：動作標籤＋時間；下一行「暱稱 UID短碼 → 暱稱 UID短碼」。
 * - 點暱稱＝只篩該人當「操作者」或「對象」其中一種（一次一個查詢，畫面用篩選標籤講清楚）。
 * - 有對話編號的列：點整列（或右側箭頭）直接開唯讀對話。
 * - 文字不折行：名稱過長以省略號截斷，UID 短碼固定不截。
 */
import type { JSX } from 'preact';

import { useT } from '@/i18n/i18n';

import { pmFormatTime, type PmAuditLog } from '../data/pm-audit';
import { actionTone, canOpenConversation, shortUid, splitTargetUids } from '../data/pm-audit-view';

export interface PmAuditLogListProps {
  logs: readonly PmAuditLog[];
  names: Readonly<Record<string, string>>;
  onFilterActor: (uid: string) => void;
  onFilterTarget: (uid: string) => void;
  onOpenConversation: (log: PmAuditLog) => void;
}

function Person(props: {
  uid: string;
  names: Readonly<Record<string, string>>;
  role: 'actor' | 'target';
  onPick: (uid: string) => void;
}): JSX.Element {
  const t = useT();
  const name = props.names[props.uid];
  const label = name || t('logs.chat.unknownUser');
  const hint = props.role === 'actor' ? t('logs.chat.filterByActor') : t('logs.chat.filterByTarget');
  return (
    <button
      type="button"
      class="pma-person"
      aria-label={`${hint}：${label}`}
      onClick={(e) => {
        e.stopPropagation();
        props.onPick(props.uid);
      }}
    >
      <span class={`pma-person-name${name ? '' : ' is-unknown'}`} data-no-translate>{label}</span>
      <span class="pma-uid" data-no-translate>{shortUid(props.uid)}</span>
    </button>
  );
}

export function PmAuditLogList(props: PmAuditLogListProps): JSX.Element {
  const t = useT();
  return (
    <div class="pma-log-list" id="pm-audit-logs">
      {props.logs.map((log) => {
        const targets = splitTargetUids(log);
        const openable = canOpenConversation(log);
        const time = pmFormatTime(log.createdAtIso) || pmFormatTime(log.createdAt);
        const actionKey = `logs.chat.actions.${log.action}`;
        const actionText = t(actionKey) === actionKey ? t('logs.chat.actions.other') : t(actionKey);
        return (
          <div
            key={log.key}
            class={`pma-log${openable ? ' is-openable' : ''}`}
            data-action={log.action}
            onClick={openable ? () => props.onOpenConversation(log) : undefined}
          >
            <div class="pma-log-people">
              <span class={`pma-tag pma-tag-${actionTone(log.action)}`}>{actionText}</span>
              {log.actorUid ? (
                <Person uid={log.actorUid} names={props.names} role="actor" onPick={props.onFilterActor} />
              ) : (
                <span class="pma-person-name is-unknown">{t('logs.chat.unknownUser')}</span>
              )}
              {targets.map((uid, i) => (
                <span key={`${uid}-${i}`} class="pma-unit">
                  <span class="pma-arrow" aria-hidden="true">{i === 0 ? '→' : '↔'}</span>
                  <Person uid={uid} names={props.names} role="target" onPick={props.onFilterTarget} />
                </span>
              ))}
            </div>
            <small class="pma-time">{time}</small>
            {openable ? (
              <button
                type="button"
                class="pma-open"
                aria-label={t('logs.chat.openConversation')}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onOpenConversation(log);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            ) : <span class="pma-open-spacer" aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}
