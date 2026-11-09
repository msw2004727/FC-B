// 活動：`event_comment`（活動留言通知）的收件匣「前往活動」動作（計畫書 v3 §3.7、顧問 §3.48②）。
//
// 留言通知不是審核：不檢查權限，只要 meta 帶活動 id 就給按鈕。
// id 以 `meta.eventDocId` 優先（文件直讀最省），缺才用 `meta.eventId`（詳情頁兩種都能解析）；兩者都缺不顯示按鈕。
// 寫入端：FC `functions/event-comment-notify.js` 的 buildInboxMessageDoc（actionStatus 固定 null）。

import {
  registerMessageAction,
  type InboxMessageLike,
  type MessageActionHandler,
} from '@/core/action-registry';

export function resolveCommentEventId(message: InboxMessageLike): string {
  const meta = message?.meta ?? {};
  for (const value of [meta.eventDocId, meta.eventId]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

const handler: MessageActionHandler = {
  canAct: (_viewer, message) => resolveCommentEventId(message) !== '',
  actions: [
    {
      key: 'openEvent',
      labelKey: 'inbox.actions.openEvent',
      async run(message, _viewer, ctx): Promise<void> {
        const id = resolveCommentEventId(message);
        if (!id || !ctx) throw new Error('event_comment: event id and navigate are required');
        ctx.navigate(`/events/${encodeURIComponent(id)}`);
      },
    },
  ],
};

registerMessageAction('event_comment', handler);
