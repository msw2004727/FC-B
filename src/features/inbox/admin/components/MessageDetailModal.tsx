/** 站內信詳情疊窗。DOM／行內樣式照 A `message-admin-list.js#viewMsgDetail` 與 `#msg-detail-modal`。 */
import type { JSX } from 'preact';

import { useT } from '@/i18n/i18n';

import { formatScheduleText, targetLabelOf, type AdminMessage } from '../data/admin-message-model';
import { AdminOverlay } from './AdminOverlay';

export function MessageDetailModal({ message, onClose }: { message: AdminMessage; onClose: () => void }): JSX.Element {
  const t = useT();
  const schedule = message.scheduledAt ? formatScheduleText(message.scheduledAt) : '';
  const statusKey = `inbox.admin.detailStatus.${message.status}`;
  const statusText = t(statusKey);
  return (
    <AdminOverlay
      id="msg-detail-modal"
      boxStyle="background:var(--bg-card);border-radius:var(--radius-lg);max-width:420px;width:90%;max-height:80vh;overflow-y:auto;padding:1.2rem;position:relative"
      closeOnBackdrop={false}
      labelledBy="msg-detail-title"
      onClose={onClose}
    >
      <button
        type="button"
        aria-label={t('inbox.admin.close')}
        style="position:absolute;top:.6rem;right:.8rem;background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--text-muted)"
        onClick={onClose}
      >
        ✕
      </button>
      <div id="msg-detail-content">
        <h3 id="msg-detail-title" style="margin:0 0 .6rem;font-size:1rem">{message.title}</h3>
        <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.5rem">
          {message.categoryName ? <div>{t('inbox.admin.detail.category', { value: message.categoryName })}</div> : null}
          <div>{t('inbox.admin.detail.target', { value: targetLabelOf(message) })}</div>
          <div>{t('inbox.admin.detail.time', { value: String(message.time ?? '') })}</div>
          {message.senderName ? (
            <div data-no-translate>{t('inbox.admin.detail.sender', { value: message.senderName })}</div>
          ) : null}
          {schedule ? <div>{t('inbox.admin.detail.schedule', { value: schedule })}</div> : null}
          <div>{t('inbox.admin.detail.status', { value: statusText === statusKey ? message.status : statusText })}</div>
        </div>
        <div style="font-size:.85rem;line-height:1.6;padding:.6rem;background:var(--bg-elevated);border-radius:var(--radius-sm);white-space:pre-wrap">
          {message.body}
        </div>
      </div>
    </AdminOverlay>
  );
}
