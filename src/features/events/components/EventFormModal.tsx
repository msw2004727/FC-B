import '../legacy/activity.css';
import '@/styles/legacy/edu-info-btn.css';
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useLegacyT, useT } from '@/i18n/i18n';
import { pushOverlay } from '@/core/overlay-back';
import { lockBody } from '@/ui/Modal';
import { toast } from '@/ui/Toast';
import type { ViewerView } from '@/features/profile/data/viewer';
import {
  ADDON_UPSELL_MESSAGE,
  EventCreateError,
  createEvent,
  newEventId,
  updateEventBasics,
  type EventForEdit,
  type EventStatus,
} from '../data/event-create';
import { createEventContextFromViewer, operateContextFromViewer } from '../data/event-create-context';
import { canManageAllActivities, hasActivityManageEntry } from '../data/operate-permissions';
import {
  hasEventChangeNotificationDiff,
  loadEventNotifyRecipientUids,
  notifyEventChanged,
} from '../data/event-change-notify';
import {
  createDefaultFormState,
  formStateFromEvent,
  toCreateEventForm,
  validateEventForm,
  type EventFormState,
  canToggleEventRegion,
  resolveCreatorName,
} from '../data/event-form-model';
import type { EventDoc } from '../data/types';
import { EventFormFields } from './event-form/EventFormFields';
import { useCoverUpload } from './event-form/use-cover-upload';
import { useDelegatePicker } from './event-form/use-delegate-picker';

/** 建立／編輯後交給頁面執行 A 的後續流程。 */
export interface EventFormSavedResult {
  mode: 'create' | 'edit';
  eventId: string;
  title: string;
  count: number;
}

export interface EventFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  existing?: EventDoc;
  viewer: ViewerView;
  onClose(): void;
  onSaved(result: EventFormSavedResult): void;
}

// ASSUMPTION: 附件未提供標題上限常數的匯出位置，沿用既有表單的 16 字。
const EVENT_TITLE_LIMIT = 16;

function toEventForEdit(doc: EventDoc, fallbackId: string): EventForEdit {
  const ext = doc as EventDoc & {
    max?: unknown;
    current?: unknown;
    waitlist?: unknown;
  };
  const validStatuses: readonly EventStatus[] = ['upcoming', 'open', 'full', 'ended', 'cancelled'];
  const status = typeof doc.status === 'string' && (validStatuses as readonly string[]).includes(doc.status)
    ? (doc.status as EventStatus)
    : undefined;
  return {
    id: doc.id ?? doc._docId ?? doc.docId ?? fallbackId,
    docId: doc._docId ?? doc.docId ?? doc.id ?? fallbackId,
    title: doc.title,
    creatorUid: doc.creatorUid,
    ownerUid: doc.ownerUid,
    captainUid: doc.captainUid,
    delegateUids: doc.delegateUids,
    privateEvent: doc.privateEvent,
    status,
    current: typeof ext.current === 'number' ? ext.current : 0,
    waitlist: typeof ext.waitlist === 'number' ? ext.waitlist : 0,
    max: typeof ext.max === 'number' ? ext.max : undefined,
  };
}

export function EventFormModal({
  open,
  mode,
  existing,
  viewer,
  onClose,
  onSaved,
}: EventFormModalProps): JSX.Element | null {
  const lt = useLegacyT();
  // 保留既有資料層驗證訊息 key；A 外殼與新增文字使用 lt。
  const t = useT();
  const [formState, setFormState] = useState<EventFormState>(() => createDefaultFormState());
  const [generatedEventId, setGeneratedEventId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [, setSubmitRevision] = useState(0);
  const submitInFlightRef = useRef(false);
  const wasOpenRef = useRef(false);
  const mountedRef = useRef(false);
  const sessionRef = useRef(0);
  const afterRenderRef = useRef<(() => void) | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canToggleRegion = canToggleEventRegion(viewer.hasPermission);
  const existingForPicker = mode === 'edit' && existing
    ? toEventForEdit(existing, existing.id ?? existing._docId ?? existing.docId ?? '')
    : null;
  const cover = useCoverUpload();
  const delegates = useDelegatePicker({ viewer, existing: existingForPicker });

  const latestRef = useRef({ open, mode, existing, viewer, formState, cover, delegates, onSaved });
  latestRef.current = { open, mode, existing, viewer, formState, cover, delegates, onSaved };

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const requestCloseRef = useRef<() => boolean>(() => false);
  requestCloseRef.current = () => {
    if (submitInFlightRef.current || submitting) return false;
    closeRef.current();
    return true;
  };

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      const resolve = afterRenderRef.current;
      afterRenderRef.current = null;
      resolve?.();
    };
  }, []);

  // 照 A formSession：關閉、換帳號或換活動後，舊送出結果不得更新目前表單。
  useLayoutEffect(() => {
    sessionRef.current += 1;
    submitInFlightRef.current = false;
    setSubmitting(false);
    return () => {
      sessionRef.current += 1;
      const resolve = afterRenderRef.current;
      afterRenderRef.current = null;
      resolve?.();
    };
  }, [open, mode, viewer.uid, existing?.id, existing?._docId, existing?.docId]);

  useLayoutEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    const now = new Date();
    if (mode === 'edit' && existing) {
      const nextState = formStateFromEvent(existing);
      setFormState(nextState);
      setGeneratedEventId(nextState.eventId);
      cover.reset({ image: existing.image ?? '', imageVariants: existing.imageVariants });
      // 照 A openEditEvent：既有委託人只取 UID 與名稱。
      delegates.reset(Array.isArray(existing.delegates)
        ? existing.delegates.flatMap((item: unknown) => {
          if (!item || typeof item !== 'object') return [];
          const record = item as Record<string, unknown>;
          const uid = typeof record.uid === 'string' ? record.uid.trim() : '';
          if (!uid) return [];
          return [{
            uid,
            name: typeof record.name === 'string' ? record.name.trim() : '',
          }];
        })
        : []);
    } else {
      setFormState(createDefaultFormState(now));
      cover.reset({ image: '' });
      delegates.reset([]);
      const ctx = createEventContextFromViewer(viewer, now);
      if (ctx) {
        try {
          setGeneratedEventId(newEventId(ctx));
        } catch {
          setGeneratedEventId(null);
        }
      } else {
        setGeneratedEventId(null);
      }
    }
  }, [open, mode, existing, viewer, cover.reset, delegates.reset]);

  // 照 A 委託人送出驗證：等待重繪後讀取 hook 更新的最新名稱，避免使用舊 render 快照。
  useLayoutEffect(() => {
    const resolve = afterRenderRef.current;
    afterRenderRef.current = null;
    resolve?.();
  });

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const root = rootRef.current;
    if (!panel || !root) return;

    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const unlock = lockBody(document.body);
    panel.querySelector<HTMLButtonElement>('.modal-close')?.focus({ preventScroll: true });

    const preventBackgroundTouch = (event: TouchEvent): void => {
      if (!(event.target instanceof Node) || !bodyRef.current?.contains(event.target)) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
      }
    };
    root.addEventListener('touchmove', preventBackgroundTouch, { passive: false });

    // 照 A／CompanionSelectModal：callback 放 ref，送出中返回 false。
    const releaseBack = pushOverlay(() => requestCloseRef.current());

    return () => {
      releaseBack();
      const active = document.activeElement;
      const shouldRestore = active === document.body || active === null || root.contains(active);
      root.removeEventListener('touchmove', preventBackgroundTouch);
      unlock();
      if (shouldRestore && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  async function handleSubmit(): Promise<void> {
    if (!open || !mountedRef.current || submitInFlightRef.current || submitting) return;

    const submitSession = sessionRef.current;
    const isCurrent = (): boolean =>
      mountedRef.current && latestRef.current.open && sessionRef.current === submitSession;

    // 照 A handleCreateEvent：驗證委託人前即鎖定送出，避免驗證期間重複建立。
    submitInFlightRef.current = true;
    setSubmitting(true);
    try {
      const verification = await delegates.verifyForSubmit();
      if (!isCurrent()) return;
      if (!verification.ok) {
        toast.show({ message: verification.message, tone: 'error' });
        return;
      }

      await new Promise<void>((resolve) => {
        afterRenderRef.current = resolve;
        setSubmitRevision(value => value + 1);
      });
      if (!isCurrent()) return;

      const current = latestRef.current;
      const now = new Date();
      const stateForValidation: EventFormState = {
        ...current.formState,
        eventId: mode === 'edit'
          ? (current.formState.eventId ?? existing?.id ?? 'edit')
          : null,
      };
      const validation = validateEventForm(stateForValidation, now);
      if (!validation.ok) {
        toast.show({ message: t(validation.messageKey, validation.params), tone: 'error' });
        return;
      }

      const ctx = createEventContextFromViewer(current.viewer, now);
      if (!ctx) {
        toast.show({ message: t('events.form.error.createNotAllowed'), tone: 'error' });
        return;
      }
      const creatorName = resolveCreatorName(
        current.viewer.displayName,
        current.viewer.role,
        current.viewer.permissionSources?.customRoles ?? [],
      );
      // 照 A bindRegionToggle：沒有地區開關權限時一律開啟。
      const stateForSubmit = canToggleEventRegion(current.viewer.hasPermission)
        ? current.formState
        : { ...current.formState, regionEnabled: true };
      const payloadForm = toCreateEventForm(stateForSubmit, creatorName, {
        image: current.cover.value.image,
        imageVariants: current.cover.value.imageVariants,
        delegates: current.delegates.value,
      });

      if (mode === 'edit' && existing) {
        const targetId = current.formState.eventId ?? existing.id ?? existing._docId ?? existing.docId ?? '';
        const existingForEdit = toEventForEdit(existing, targetId);
        const opCtx = operateContextFromViewer(current.viewer);
        if (
          !hasActivityManageEntry(opCtx)
          && !canManageAllActivities(opCtx)
          && payloadForm.max > 0
          && payloadForm.max < (existingForEdit.current ?? 0)
        ) {
          toast.show({ message: t('events.form.error.maxBelowConfirmed'), tone: 'error' });
          return;
        }

        // T-013 修補：封面／委託人已接入並預填；第 2 段前只保留既有加值欄位。
        const result = await updateEventBasics(existingForEdit, payloadForm, ctx, { addons: true });
        if (!isCurrent()) return;
        if (result.addonsStripped) {
          toast.show({ message: ADDON_UPSELL_MESSAGE, tone: 'info' });
        }

        // 照 A：只有通知欄位異動才通知；通知失敗不影響儲存結果。
        const changes: Record<string, unknown> = { ...result.updates };
        if (result.capacityChange !== null) changes.max = result.capacityChange;
        const before = existing as unknown as Record<string, unknown>;
        if (hasEventChangeNotificationDiff(before, changes)) {
          const notify = async (): Promise<void> => {
            const recipientUids = await loadEventNotifyRecipientUids(
              existingForEdit.docId ?? existingForEdit.id,
            );
            if (!isCurrent()) return;
            await notifyEventChanged({
              eventId: existingForEdit.id,
              title: payloadForm.title,
              date: String(changes.date ?? existing.date ?? ''),
              location: payloadForm.location,
              recipientUids,
              eventData: { ...before, ...changes },
              senderUid: current.viewer.uid,
            });
          };
          notify().catch((error: unknown) => {
            console.warn('[EventFormModal] event_changed notify failed', error);
          });
        }
        current.onSaved({
          mode: 'edit',
          eventId: existingForEdit.id,
          title: payloadForm.title,
          count: 1,
        });
      } else {
        let targetEventId = generatedEventId;
        if (!targetEventId) {
          targetEventId = newEventId(ctx);
          setGeneratedEventId(targetEventId);
        }
        const result = await createEvent(payloadForm, ctx, targetEventId);
        if (!isCurrent()) return;
        if (result.addonsStripped) {
          toast.show({ message: ADDON_UPSELL_MESSAGE, tone: 'info' });
        }
        current.onSaved({
          mode: 'create',
          eventId: result.eventId,
          title: payloadForm.title,
          count: 1,
        });
      }
    } catch (error: unknown) {
      if (!isCurrent()) return;
      if (error instanceof EventCreateError) {
        if (error.code === 'BASIC_CREATE_REQUIRED' || error.code === 'CREATE_NOT_ALLOWED') {
          toast.show({ message: t('events.form.error.createNotAllowed'), tone: 'error' });
        } else if (error.code === 'EDIT_NOT_ALLOWED') {
          toast.show({ message: t('events.form.error.editNotAllowed'), tone: 'error' });
        } else {
          toast.show({ message: t('events.form.error.submitFailed'), tone: 'error' });
        }
      } else {
        toast.show({ message: t('events.form.error.submitFailed'), tone: 'error' });
      }
    } finally {
      if (isCurrent()) {
        submitInFlightRef.current = false;
        setSubmitting(false);
      }
    }
  }

  if (!open || typeof document === 'undefined') return null;

  const modalTitle = mode === 'edit'
    ? lt('編輯活動', '編輯活動')
    : lt('新增活動', '新增活動');
  const submitLabel = submitting
    ? mode === 'edit'
      ? lt('儲存中', '儲存中')
      : lt('建立中...', '建立中...')
    : mode === 'edit'
      ? lt('儲存修改', '儲存修改')
      : lt('建立活動', '建立活動');

  return createPortal(
    <div class="legacy-ui create-event-modal-open" ref={rootRef}>
      <div id="modal-overlay" class="modal-overlay open" />
      <div
        class="modal create-event-modal-v2-shell ce-v2-enabled open"
        id="create-event-modal"
        data-no-backdrop-close="1"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ce-modal-title"
        aria-busy={submitting || undefined}
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            requestCloseRef.current();
            return;
          }
          if (event.key !== 'Tab') return;
          const panel = panelRef.current;
          if (!panel) return;
          // 照 B Modal：Tab 留在目前表單，隱藏列不列入焦點。
          const elements = Array.from(panel.querySelectorAll<HTMLElement>(
            'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
          )).filter(element =>
            element.tabIndex >= 0
            && !element.matches(':disabled')
            && !element.closest('[hidden], [inert], [aria-hidden="true"]')
            && element.getClientRects().length > 0,
          );
          const first = elements[0];
          const last = elements[elements.length - 1];
          if (!first || !last) {
            event.preventDefault();
            panel.focus();
          } else if (event.shiftKey && (
            document.activeElement === first
            || document.activeElement === panel
            || !panel.contains(document.activeElement)
          )) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && (
            document.activeElement === last
            || document.activeElement === panel
            || !panel.contains(document.activeElement)
          )) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div class="modal-header">
          <h3 id="ce-modal-title">{modalTitle}</h3>
          <button
            type="button"
            class="modal-close"
            onClick={() => { requestCloseRef.current(); }}
          >
            ✕
          </button>
        </div>
        <div class="modal-body ce-modal-body-v2" ref={bodyRef}>
          <EventFormFields
            mode={mode}
            state={formState}
            onPatch={patch => setFormState(previous => ({ ...previous, ...patch }))}
            titleLimit={EVENT_TITLE_LIMIT}
            canToggleRegion={canToggleRegion}
            cover={cover.view}
            delegates={delegates.view}
            location={{
              statusText: lt('GPS功能未開啟', 'GPS功能未開啟'),
              statusState: 'disabled',
              buttonText: lt('設定地圖座標', '設定地圖座標'),
              buttonDisabled: true,
              buttonLooksDisabled: true,
              summary: '',
              showClear: false,
              // 第 2 段：GPS／地圖座標接 featureFlags
              onOpenPicker: () => undefined,
              onClear: () => undefined,
            }}
          />
        </div>
        <div class="modal-actions">
          <button
            type="button"
            class="outline-btn"
            onClick={() => { requestCloseRef.current(); }}
          >
            {lt('取消', '取消')}
          </button>
          <button
            type="button"
            class="primary-btn"
            id="ce-submit-btn"
            disabled={submitting}
            style={submitting ? 'opacity:.72;cursor:not-allowed' : undefined}
            onClick={() => {
              handleSubmit().catch(() => {
                if (mountedRef.current) {
                  toast.show({ message: t('events.form.error.submitFailed'), tone: 'error' });
                }
              });
            }}
          >
            {submitLabel}
          </button>
        </div>
      </div>
      {cover.cropper}
    </div>,
    document.body,
  );
}
