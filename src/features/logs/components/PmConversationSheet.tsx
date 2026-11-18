/**
 * 聊天室稽核：唯讀對話抽屜（2026-11-16 改版，顧問 §3.195 案 A）。
 * - 從 Log 列或對話列表點開；呼叫既有 `getPmAuditConversation`（後端照舊寫 audit_view_conversation）。
 * - 標題兩人「暱稱 ↔ 暱稱」；每人可複製完整 UID（只顯示在畫面、不進網址／console）。
 * - 每則訊息標寄件人暱稱＋UID 短碼、時間；撤回、編輯過另標。
 * - 稽核複本過保存期（not-found）顯示「已超過保存期限」，不當錯誤。
 */
import type { JSX } from 'preact';

import { useT } from '@/i18n/i18n';
import { BottomSheet } from '@/ui/BottomSheet';
import { toast } from '@/ui/Toast';

import { copyDiagnosticTextToClipboard } from '../data/operation-logs';
import { pmFormatTime, type PmAuditConversation } from '../data/pm-audit';
import { shortUid } from '../data/pm-audit-view';

export type ConversationBox =
  | { status: 'closed' }
  | { status: 'loading'; uids: string[] }
  | { status: 'error'; uids: string[] }
  | { status: 'ready'; uids: string[]; data: PmAuditConversation };

export interface PmConversationSheetProps {
  box: ConversationBox;
  names: Readonly<Record<string, string>>;
  onClose: () => void;
}

export function PmConversationSheet(props: PmConversationSheetProps): JSX.Element | null {
  const t = useT();
  const { box } = props;
  if (box.status === 'closed') return null;

  const ready = box.status === 'ready' ? box.data : null;
  const uids = ready && ready.participants.length ? ready.participants : box.uids;
  const nameOf = (uid: string): string =>
    ready?.participantNames[uid] || props.names[uid] || t('logs.chat.unknownUser');
  const title = uids.length ? uids.map(nameOf).join(' ↔ ') : t('logs.chat.conversationTitle');

  async function copyUid(uid: string): Promise<void> {
    try {
      await copyDiagnosticTextToClipboard(uid);
      toast.show({ message: t('logs.chat.uidCopied'), tone: 'success' });
    } catch {
      toast.show({ message: t('logs.chat.uidCopyFailed'), tone: 'error' });
    }
  }

  return (
    <BottomSheet open title={title} class="pma-sheet" onClose={props.onClose}>
      <div class="pma-sheet-people">
        {uids.map((uid) => (
          <div key={uid} class="pma-sheet-person">
            <span class="pma-person-name" data-no-translate>{nameOf(uid)}</span>
            <span class="pma-uid" data-no-translate>{shortUid(uid)}</span>
            <button type="button" class="pma-copy" onClick={() => void copyUid(uid)}>
              {t('logs.chat.copyUid')}
            </button>
          </div>
        ))}
      </div>
      <div class="pma-convo" id="pm-audit-conversation">
        {box.status === 'loading' ? <div class="pma-note" role="status">{t('logs.chat.loading')}</div> : null}
        {box.status === 'error' ? <div class="pma-note" role="alert">{t('logs.chat.conversationFailed')}</div> : null}
        {ready?.expired ? <div class="pma-note">{t('logs.chat.expired')}</div> : null}
        {ready && !ready.expired && ready.messages.length === 0 ? (
          <div class="pma-note">{t('logs.chat.conversationEmpty')}</div>
        ) : null}
        {ready && !ready.expired
          ? ready.messages.map((m) => {
            const side = uids[0] && m.fromUid === uids[0] ? 'left' : 'right';
            const sender = m.fromUid ? nameOf(m.fromUid) : m.senderLabel || t('logs.chat.unknownUser');
            return (
              <article key={m.key} class={`pma-msg is-${side}`}>
                <div class="pma-msg-head">
                  <span class="pma-person-name" data-no-translate>{sender}</span>
                  <span class="pma-uid" data-no-translate>{shortUid(m.fromUid)}</span>
                  <small class="pma-time">{pmFormatTime(m.createdAt)}</small>
                </div>
                <p class={m.recalled ? 'is-recalled' : undefined}>{m.recalled ? t('logs.chat.recalled') : m.body}</p>
                {m.edited ? <small class="pma-msg-flag">{t('logs.chat.edited')}</small> : null}
              </article>
            );
          })
          : null}
      </div>
    </BottomSheet>
  );
}
