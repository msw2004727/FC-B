import type { JSX } from 'preact';

import { useLegacyT } from '@/i18n/i18n';

import {
  RECORDS_PAGE_SIZE,
  type ActivityRecordItem,
} from '../../data/activity-records';

export interface ActivityRecordListProps {
  items: ActivityRecordItem[];
  page: number;
  onPage(p: number): void;
}

/**
 * 照 A `leaderboard.js#_renderRecordListHtml` 輸出清單（`.mini-activity`）與分頁（`‹ p / total ›`）。
 * 由父層卡片包在 `#my-activity-records.mini-activity-list` 內；本元件不輸出該 wrapper。
 * 他人名片會共用此元件，因此對 props 不做任何 session／uid 假設。
 */
export function ActivityRecordList(props: ActivityRecordListProps): JSX.Element {
  const { items, page, onPage } = props;
  const lt = useLegacyT();

  const totalPages = Math.max(1, Math.ceil(items.length / RECORDS_PAGE_SIZE));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const start = (currentPage - 1) * RECORDS_PAGE_SIZE;
  const pageItems = items.slice(start, start + RECORDS_PAGE_SIZE);

  // 照 A `statusLabel` 對照表；查不到顯示原始 ds。
  const statusLabel = (key: string): string => {
    switch (key) {
      case 'completed':
        return lt('完成', '完成');
      case 'cancelled':
        return lt('取消', '取消');
      case 'registered':
        return lt('已報名', '已報名');
      case 'waitlisted':
        return lt('候補中', '候補中');
      case 'missed':
        return lt('未出席', '未出席');
      // T-039（B 專屬，A 沒有）：只簽到沒簽退。A 翻譯包無此鍵，同 '未出席' 做法用原文 fallback。
      case 'incomplete':
        return lt('未完成', '未完成');
      default:
        return key;
    }
  };

  if (pageItems.length === 0) {
    return (
      <div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">
        {lt('點擊頁籤查看紀錄', '點擊頁籤查看紀錄')}
      </div>
    );
  }

  return (
    <>
      {pageItems.map((r, idx) => {
        const ds = String(r._displayStatus ?? r.status ?? '');
        const key = r._docId ?? `${String(r.eventId ?? 'r')}-${idx}`;
        return (
          <div class="mini-activity" key={key}>
            <span class={`mini-activity-status ${ds}`} />
            <span class="mini-activity-name">{String(r.name ?? '')}</span>
            <span class={`mini-activity-tag ${ds}`}>{statusLabel(ds)}</span>
            <span class="mini-activity-date">{String(r.date ?? '')}</span>
          </div>
        );
      })}
      {totalPages > 1 ? (
        <div style="display:flex;justify-content:center;align-items:center;gap:.5rem;padding:.5rem 0;font-size:.75rem">
          <button
            type="button"
            class="outline-btn"
            style="font-size:.72rem;padding:.2rem .5rem"
            onClick={() => onPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            ‹
          </button>
          <span style="color:var(--text-muted)">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            class="outline-btn"
            style="font-size:.72rem;padding:.2rem .5rem"
            onClick={() => onPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            ›
          </button>
        </div>
      ) : null}
    </>
  );
}
