import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { ViewerView } from '@/features/profile/data/viewer';
import { canCreateEvent } from '../../data/event-create-guard';
import { createEventContextFromViewer } from '../../data/event-create-context';
import './create-event-type-sheet.css';

export interface CreateEventTypeSheetProps {
  open: boolean;
  viewer: ViewerView;
  onClose(): void;
  onCustom(): void;
}

export function CreateEventTypeSheet({
  open,
  viewer,
  onClose,
  onCustom,
}: CreateEventTypeSheetProps): JSX.Element | null {
  const lt = useLegacyT();
  const current = useRef({ viewer, onClose, onCustom });
  current.current = { viewer, onClose, onCustom };

  const context = createEventContextFromViewer(viewer);
  const canCustom = context !== null && canCreateEvent(context);

  useLayoutEffect(() => {
    if (!open) return;
    if (!canCustom) {
      toast.show({
        message: lt('權限不足：需要建立活動權限', '權限不足：需要建立活動權限'),
      });
      current.current.onClose();
      return;
    }

    // 照 A _showCreateEventTypeSheet；返回鍵交給共用 overlay。
    return pushOverlay(() => {
      current.current.onClose();
      return true;
    });
  }, [open, canCustom, lt]);

  if (!open || !canCustom) return null;

  function openCustom(): void {
    // 照 A _canCreateBasicActivity；handler 再檢查同一 helper。
    const latest = current.current;
    const ctx = createEventContextFromViewer(latest.viewer);
    if (!ctx || !canCreateEvent(ctx)) {
      toast.show({
        message: lt('權限不足：需要建立活動權限', '權限不足：需要建立活動權限'),
      });
      latest.onClose();
      return;
    }
    latest.onClose();
    latest.onCustom();
  }

  return createPortal(
    <div class="legacy-ui">
      <div
        id="create-event-type-sheet"
        class="cets-overlay"
        onClick={(event) => {
          if (event.target === event.currentTarget) current.current.onClose();
        }}
      >
        <div class="cets-panel">
          <div class="cets-grab" />
          <div class="cets-title">
            {lt('選擇活動類型', '選擇活動類型')}
          </div>
          <button
            id="cets-custom"
            type="button"
            class="cets-option cets-option-main"
            onClick={openCustom}
          >
            <span class="cets-ico">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                <rect x="5" y="4.5" width="14" height="17" rx="2.5" />
                <path d="M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5" />
                <path d="M12 10v6M9 13h6" />
              </svg>
            </span>
            <span class="cets-tx">
              <b>{lt('自訂活動', '自訂活動')}</b>
              <small>{lt('建立可報名的活動（含人數、費用等設定）', '建立可報名的活動（含人數、費用等設定）')}</small>
            </span>
            <svg class="cets-chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          <button
            id="cets-external"
            type="button"
            class="cets-option cets-option-lock"
            aria-disabled="true"
            data-feature-locked="true"
            onClick={() => {
              toast.show({ message: lt('功能尚未開放', '功能尚未開放') });
            }}
          >
            <span class="cets-ico">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
                <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
              </svg>
            </span>
            <span class="cets-tx">
              <b>{lt('活動連結', '活動連結')}</b>
              <small>{lt('連結外部平台活動，點擊直接跳轉', '連結外部平台活動，點擊直接跳轉')}</small>
            </span>
            <svg class="cets-lock" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="11" width="14" height="10" rx="2.5" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </button>
          <button
            id="cets-cancel"
            type="button"
            class="cets-cancel"
            onClick={() => current.current.onClose()}
          >
            {lt('取消', '取消')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
