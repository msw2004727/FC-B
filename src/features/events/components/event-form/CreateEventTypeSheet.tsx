import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { ViewerView } from '@/features/profile/data/viewer';
import { canCreateEvent } from '../../data/event-create';
import { createEventContextFromViewer } from '../../data/event-create-context';

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
        style="position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center"
        onClick={(event) => {
          if (event.target === event.currentTarget) current.current.onClose();
        }}
      >
        <div style="background:var(--bg-card);border-radius:var(--radius-lg) var(--radius-lg) 0 0;width:100%;max-width:440px;padding:1rem 1rem .6rem;animation:slideUp .25s ease-out">
          <div style="font-weight:700;font-size:.92rem;margin-bottom:.8rem;text-align:center">
            {lt('選擇活動類型', '選擇活動類型')}
          </div>
          <button
            id="cets-custom"
            style={`width:100%;padding:.7rem;margin-bottom:.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elevated);color:var(--text-primary);font-size:.85rem;font-weight:600;cursor:pointer;text-align:left;display:${canCustom ? 'flex' : 'none'};align-items:center;gap:.6rem`}
            onClick={openCustom}
          >
            <span style="font-size:1.3rem">📋</span>
            <span>
              <div>{lt('自訂活動', '自訂活動')}</div>
              <div style="font-size:.72rem;font-weight:400;color:var(--text-muted);margin-top:.15rem">
                {lt('建立可報名的活動（含人數、費用等設定）', '建立可報名的活動（含人數、費用等設定）')}
              </div>
            </span>
          </button>
          <button
            id="cets-external"
            aria-disabled="true"
            data-feature-locked="true"
            style="width:100%;padding:.7rem;margin-bottom:.6rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elevated);color:var(--text-muted);font-size:.85rem;font-weight:600;cursor:not-allowed;text-align:left;display:flex;align-items:center;gap:.6rem;opacity:.62;filter:grayscale(1)"
            onClick={() => {
              toast.show({ message: lt('功能尚未開放', '功能尚未開放') });
            }}
          >
            <span style="font-size:1.3rem">🔗</span>
            <span>
              <div>{lt('活動連結', '活動連結')}</div>
              <div style="font-size:.72rem;font-weight:400;color:var(--text-muted);margin-top:.15rem">
                {lt('連結外部平台活動，點擊直接跳轉', '連結外部平台活動，點擊直接跳轉')}
              </div>
            </span>
          </button>
          <button
            id="cets-cancel"
            style="width:100%;padding:.55rem;border:none;border-radius:var(--radius);background:transparent;color:var(--text-muted);font-size:.82rem;cursor:pointer"
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
