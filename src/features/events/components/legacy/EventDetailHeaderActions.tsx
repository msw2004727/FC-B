import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { lt } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import {
  canEditOwnActivityBasic,
  canManageTeamOnlyVisibility,
  canViewEventOperationLog,
  type OperateContext,
} from '../../data/operate-permissions';
import { saveEventPublic } from '../../data/event-public-toggle';
import type { LegacyDetailEvent } from './EventDetailMainView';

/** 照 A `_canEditExternalActivity`：既有活動直接使用基本編輯 helper。 */
function canEditExternalActivity(context: OperateContext, event: LegacyDetailEvent): boolean {
  return canEditOwnActivityBasic(context, event);
}

/** 照 A `_renderEventDetailEditButton`；顯示與 handler 共用。 */
export function canEditDetailActivity(
  context: OperateContext,
  event: LegacyDetailEvent | null | undefined,
): boolean {
  if (!context.uid || !event || !(event.id || event._docId || event.docId)) return false;
  return event.type === 'external'
    ? canEditExternalActivity(context, event)
    : canEditOwnActivityBasic(context, event);
}

export interface EventDetailHeaderActionsProps {
  context: OperateContext;
  event: LegacyDetailEvent;
  eventDocId: string;
  staffTeamIds: ReadonlySet<string>;
  viewCount: number;
  onReload(): void;
  onRefresh(): Promise<void>;
  onOpenLog(): void;
}

/** 照 A 頁首四個 wrap；編輯按鈕仍由封面輸出。 */
export function EventDetailHeaderActions(props: EventDetailHeaderActionsProps): JSX.Element | null {
  const { context, event, eventDocId, staffTeamIds, viewCount } = props;
  const [publicValue, setPublicValue] = useState(!!event.isPublic);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(false);
  const pending = useRef(false);
  const refreshPending = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!pending.current) setPublicValue(!!event.isPublic);
  }, [event.isPublic, eventDocId]);

  const canToggle = !!context.uid && canManageTeamOnlyVisibility(context, event, staffTeamIds);
  const canLog = !!context.uid && canViewEventOperationLog(context, event);

  async function togglePublic(next: boolean): Promise<void> {
    const current = latest.current;
    if (!current.context.uid
      || !canManageTeamOnlyVisibility(current.context, current.event, current.staffTeamIds)) {
      toast.show({ message: '您沒有修改公開狀態的權限' });
      return;
    }
    if (pending.current) return;
    const previous = publicValue;
    const documentId = current.eventDocId;
    pending.current = true;
    setSaving(true);
    setPublicValue(next);
    try {
      await saveEventPublic(documentId, next);
      if (!alive.current || latest.current.eventDocId !== documentId) return;
      toast.show({ message: next ? '已開啟活動公開' : '已關閉活動公開' });
      latest.current.onReload();
    } catch (error) {
      if (!alive.current || latest.current.eventDocId !== documentId) return;
      setPublicValue(previous);
      toast.show({
        message: error instanceof Error && error.message ? error.message : '更新公開狀態失敗',
      });
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
  }

  async function refreshDetail(): Promise<void> {
    if (refreshPending.current) return;
    // 訪客沒有名單與本人紀錄可重讀：照 A 重新讀活動即可（重新載入本頁）。
    if (!latest.current.context.uid) {
      latest.current.onReload();
      return;
    }
    refreshPending.current = true;
    setRefreshing(true);
    try {
      await latest.current.onRefresh();
    } catch {
      if (alive.current) toast.show({ message: '刷新失敗，請稍後再試' });
    } finally {
      refreshPending.current = false;
      if (alive.current) setRefreshing(false);
    }
  }

  function openLog(): void {
    const current = latest.current;
    if (!current.context.uid || !canViewEventOperationLog(current.context, current.event)) {
      toast.show({ message: '權限不足' });
      return;
    }
    current.onOpenLog();
  }

  // 指揮官 2026-10-22 決定（M-090）：預覽文字「訪客不顯示」與 A 不符，照 A——瀏覽數與重新整理鈕對所有人顯示，
  // 只有 +1（incrementEventViewCount）限登入者觸發；活動公開與 Log 仍依權限（訪客無）。
  return (
    <>
      <div id="detail-public-toggle-wrap" style={canToggle ? 'flex-shrink:0' : 'display:none;flex-shrink:0'}>
        {canToggle && (
          <span style="display:inline-flex;align-items:center;gap:.35rem;user-select:none">
            <span style="font-size:.72rem;color:var(--text-muted);font-weight:600">活動公開</span>
            <label class={`toggle-switch ${publicValue ? 'active' : ''}`} style="transform:scale(.9);transform-origin:right center">
              <input
                type="checkbox"
                id="detail-event-public-toggle"
                aria-label="活動公開"
                checked={publicValue}
                disabled={saving}
                onChange={change => {
                  togglePublic(change.currentTarget.checked).catch(() => {});
                }}
              />
              <span class="toggle-slider" />
            </label>
          </span>
        )}
      </div>
      <div
        id="detail-view-count-wrap"
        class="event-view-count"
        style="flex-shrink:0"
        aria-label={lt('瀏覽次數', '瀏覽次數')}
        title={lt('瀏覽次數', '瀏覽次數')}
        data-i18n-aria-label="瀏覽次數"
        data-i18n-title="瀏覽次數"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span id="detail-view-count-num">{viewCount.toLocaleString()}</span>
      </div>
      <div id="detail-refresh-btn-wrap" style="flex-shrink:0">
        <button
          type="button"
          class={`event-detail-refresh-btn${refreshing ? ' spinning' : ''}`}
          title="重新整理"
          aria-label="重新整理"
          disabled={refreshing}
          onClick={() => { refreshDetail().catch(() => {}); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 4v6h6" />
            <path d="M23 20v-6h-6" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
        </button>
      </div>
      <div id="detail-log-btn-wrap" style={canLog ? 'flex-shrink:0' : 'display:none;flex-shrink:0'}>
        {canLog && <button type="button" class="event-reg-log-btn" onClick={openLog}>Log</button>}
      </div>
    </>
  );
}
