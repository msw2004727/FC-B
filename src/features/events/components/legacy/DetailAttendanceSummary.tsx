import type { JSX } from 'preact';

export interface DetailAttendanceSummaryProps {
  eventId: string;
  confirmedCount: number;
  waitlistCount: number;
  max: number;
  canManage: boolean;
  canViewRecords: boolean;
  onOpen: () => void;
}

/**
 * 照舊版 A `event-detail.js#_renderDetailAttendanceSummaryShell`（第 142～163 行）。
 */
export function DetailAttendanceSummary({
  eventId,
  confirmedCount,
  waitlistCount,
  max,
  canManage,
  canViewRecords,
  onOpen,
}: DetailAttendanceSummaryProps): JSX.Element {
  const safeId = String(eventId || '').trim();
  const title = canManage || canViewRecords ? '出席管理' : '出席名單';
  const actionLabel = canManage
    ? '管理名單 / 出席紀錄'
    : canViewRecords
      ? '查看出席紀錄'
      : '查看出席名單';

  return (
    <div
      class="detail-attendance-summary"
      data-attendance-on-demand="true"
      style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;padding:.55rem .75rem;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface, var(--bg-card));"
    >
      <div style="min-width:0;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
        <div
          class="detail-section-title"
          style="margin:0;border-bottom:0;padding-bottom:0;"
        >
          {title}
        </div>
        <span style="font-size:.9rem;font-weight:700;color:var(--text-primary);font-variant-numeric:tabular-nums;white-space:nowrap;">
          {`${Math.max(0, confirmedCount)}/${Math.max(0, max)}`}
        </span>
        {waitlistCount > 0 && (
          <span style="font-size:.78rem;color:var(--text-secondary);background:var(--bg-elevated, var(--bg-card));border-radius:999px;padding:.1rem .45rem;white-space:nowrap;">
            {`候補 ${waitlistCount}`}
          </span>
        )}
      </div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap">
        <button
          type="button"
          class="detail-toolbar-btn"
          data-detail-attendance-open-button={safeId}
          onClick={onOpen}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

/** 照舊版 A `event-detail.js#_renderDetailAttendanceLoadingHtml`（第 165～172 行，結構與文字原樣）。 */
export function DetailAttendanceLoading(_props: { canManage: boolean; canViewRecords: boolean }): JSX.Element {
  return (
    <div
      class="detail-attendance-summary"
      data-attendance-loading="true"
      aria-live="polite"
      aria-busy="true"
      style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;padding:.75rem;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);"
    >
      <div style="min-width:0">
        <div class="detail-section-title" style="margin:0 0 .25rem">出席名單</div>
        <div class="reg-loading" style="padding:0;text-align:left">名單載入中...</div>
      </div>
    </div>
  );
}
