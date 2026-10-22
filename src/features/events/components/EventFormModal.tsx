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
  createEventsBatch,
} from '../data/event-create';
import { createEventContextFromViewer, operateContextFromViewer } from '../data/event-create-context';
import {
  canManageAllActivities,
  canUseActivityAddons,
  hasActivityManageEntry,
} from '../data/operate-permissions';
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
  EVENT_TITLE_LIMIT,
  buildMultiDateForms,
} from '../data/event-form-model';
import type { EventDoc } from '../data/types';
import { EventFormFields } from './event-form/EventFormFields';
import { useCoverUpload } from './event-form/use-cover-upload';
import { useDelegatePicker } from './event-form/use-delegate-picker';
import { useEventLocation } from './event-form/use-event-location';
import { useMultiDate } from './event-form/use-multi-date';
import { useEventTemplates } from './event-form/use-event-templates';
import { generateId } from '@/data/ids';
import { useTeamOnlyPicker } from './event-form/use-team-only-picker';
import type { EventFormAddonState } from './event-form/form-types';

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

const ADDON_TOGGLE_KEYS = [
  'feeEnabled', 'teamOnly', 'genderRestrictionEnabled', 'privateEvent',
  'teamSplitEnabled', 'teamSplitBalanceCap', 'socialLinksEnabled', 'earlyBirdEnabled', 'gpsEnabled',
] as const;

/**
 * mapLocationUpdatedAt 寫回值：A 建立與選點一律寫 ISO 字串，正常資料都是字串、原樣保留。
 * 例外：快取序列化後的 Timestamp（有 toDate 或只剩 seconds）轉成 ISO 字串，避免寫回物件或把值弄丟。
 */
function toIsoOrNull(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as { toDate?: unknown; seconds?: unknown };
    const date = typeof record.toDate === 'function'
      ? (record as { toDate(): Date }).toDate()
      : typeof record.seconds === 'number' ? new Date(record.seconds * 1000) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

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
  const canUseAddons = canUseActivityAddons(operateContextFromViewer(viewer), existingForPicker);
  const cover = useCoverUpload();
  const delegates = useDelegatePicker({ viewer, existing: existingForPicker });

  function patch(value: Partial<EventFormState>): void {
    // 照 A handleCreateEvent：送出期間固定本次表單，避免非同步驗證與 payload 不一致。
    if (!mountedRef.current || submitInFlightRef.current) return;
    setFormState(previous => ({ ...previous, ...value }));
  }

  // 照 A event-location-draft.js：地點的地圖座標（GPS 開關在進階功能）。
  const location = useEventLocation({ locationText: formState.location, gpsEnabled: formState.gpsEnabled });

  // 照 A event-create-multidate.js：建立模式選 2 個以上日期即一次建立多場。
  const multiDate = useMultiDate({ mode, dateVal: formState.dateVal, onDateValChange: value => patch({ dateVal: value }) });
  // 多日期每個日期的活動 id 與整批 batchGroupId 在本次開表單期間固定（重送時沿用，冪等）。
  const batchIdsRef = useRef(new Map<string, string>());
  const batchGroupIdRef = useRef<string | null>(null);

  // 照 A event-create-template.js：從範本建立／儲存為範本。
  const templates = useEventTemplates({
    viewer,
    mode,
    onApply: (result) => {
      // 照 A _loadEventTemplate：無加值權限且範本含加值時先提示。
      if (result.upsell) toast.show({ message: ADDON_UPSELL_MESSAGE, tone: 'info' });
      patch(result.patch);
      if (result.image) cover.reset({ image: result.image });
      // 照 A _restoreEventLocationTemplateDraft：範本無座標（或無加值權限）時也重置定位草稿。
      const templateLocation = result.patch.location ?? latestRef.current.formState.location;
      location.reset(result.locationTemplate
        ? { ...result.locationTemplate, location: templateLocation }
        : { location: templateLocation, mapLocationConfirmed: false });
    },
    collect: () => ({
      // 與送出一致：無地區開關權限者地區一律視為開啟（A 隱藏 toggle 強制勾選）。
      state: canToggleEventRegion(latestRef.current.viewer.hasPermission)
        ? latestRef.current.formState
        : { ...latestRef.current.formState, regionEnabled: true },
      image: latestRef.current.cover.value.image || null,
      location: latestRef.current.location.buildValue(new Date()),
      canUseAddons,
    }),
  });

  const teamOnly = useTeamOnlyPicker({
    viewer,
    existing: mode === 'edit' ? existing ?? null : null,
    mode,
    enabled: formState.teamOnly,
    selectedIds: formState.teamOnlyTeamIds,
    onChange: ids => patch({ teamOnlyTeamIds: ids }),
  });

  const latestRef = useRef({ open, mode, existing, viewer, formState, cover, delegates, teamOnly, location, multiDate, templates, onSaved });
  latestRef.current = { open, mode, existing, viewer, formState, cover, delegates, teamOnly, location, multiDate, templates, onSaved };

  function guardAddon(): boolean {
    // 照 A _guardActivityAddonToggle：handler 與畫面使用同一個權限 helper。
    const current = latestRef.current;
    const target = current.mode === 'edit' && current.existing
      ? toEventForEdit(current.existing, current.formState.eventId ?? '')
      : null;
    if (canUseActivityAddons(operateContextFromViewer(current.viewer), target)) return true;
    toast.show({ message: lt(ADDON_UPSELL_MESSAGE, ADDON_UPSELL_MESSAGE) });
    return false;
  }

  function patchAddon(value: Partial<EventFormAddonState>): void {
    if (!mountedRef.current || submitInFlightRef.current) return;
    // 照 A _guardActivityAddonToggle：只有把加值開關「打開」才守門（EventFormAddons 已先問過，這裡是後盾）；
    // 關閉、或修改已打開欄位的子值（費用金額、社群網址…）不檢查（Gemini 審 P2：原寫法每次輸入都跳提示）。
    const turningOn = ADDON_TOGGLE_KEYS.some(key => value[key] === true);
    if (turningOn && !guardAddon()) return;
    patch(value);
  }

  function onReservedClick(): void {
    // 照 A _handleReservedActivityAddonClick：只有提示，不修改表單。
    toast.show({ message: lt(ADDON_UPSELL_MESSAGE, ADDON_UPSELL_MESSAGE) });
  }

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
      const nextState = formStateFromEvent(existing, { canUseAddons });
      setFormState(nextState);
      setGeneratedEventId(nextState.eventId);
      const teamFields = existing as unknown as Record<string, unknown>;
      const teamNames = Array.isArray(teamFields.creatorTeamNames)
        ? teamFields.creatorTeamNames.filter((name): name is string => typeof name === 'string')
        : [];
      teamOnly.reset(
        nextState.teamOnlyTeamIds,
        teamNames.length
          ? teamNames
          : typeof teamFields.creatorTeamName === 'string' && teamFields.creatorTeamName
            ? [teamFields.creatorTeamName]
            : [],
      );
      cover.reset({ image: existing.image ?? '', imageVariants: existing.imageVariants });
      // 照 A _resetEventLocationDraft('ce', e)。
      location.reset(existing as unknown as Record<string, unknown>);
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
      location.reset(null);
      delegates.reset([]);
      teamOnly.reset([], []);
      multiDate.reset();
      batchIdsRef.current = new Map();
      batchGroupIdRef.current = null;
      // 照 A openCreateEventModal：清空範本名稱並重新載入範本。
      latestRef.current.templates.reset();
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
  }, [open, mode, existing, viewer, cover.reset, delegates.reset, teamOnly.reset, location.reset, canUseAddons]);

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

      let current = latestRef.current;
      const now = new Date();
      const addonTarget = current.mode === 'edit' && current.existing
        ? toEventForEdit(current.existing, current.formState.eventId ?? '')
        : null;
      const submitCanUseAddons = canUseActivityAddons(
        operateContextFromViewer(current.viewer),
        addonTarget,
      );
      const stateForValidation: EventFormState = {
        ...current.formState,
        regionEnabled: canToggleEventRegion(current.viewer.hasPermission)
          ? current.formState.regionEnabled
          : true,
        eventId: current.mode === 'edit'
          ? (current.formState.eventId ?? current.existing?.id ?? 'edit')
          : null,
      };
      const submitDates = current.mode === 'create' && current.multiDate.view.isMultiDate
        ? current.multiDate.dates
        : undefined;
      const validation = validateEventForm(stateForValidation, now, {
        canUseAddons: submitCanUseAddons,
        ...(submitDates ? { dates: submitDates } : {}),
      });
      if (!validation.ok) {
        toast.show({
          message: 'message' in validation
            ? lt(validation.message, validation.message)
            : t(validation.messageKey, validation.params),
          tone: 'error',
        });
        return;
      }

      // 照 A handleCreateEvent：地區之後才驗證限定俱樂部。
      // 無加值權限時由資料層移除加值 updates，不因既有限定俱樂部阻擋基本編輯。
      if (submitCanUseAddons) {
        // 照 A eventCreateHasOnlyTeamScopedAddon：告知選擇器俱樂部限定以外是否還有其他加值欄位開啟。
        const fs = current.formState;
        const otherAddonsEnabled = fs.feeEnabled || fs.genderRestrictionEnabled || fs.privateEvent
          || fs.teamSplitEnabled || fs.socialLinksEnabled || fs.earlyBirdEnabled || fs.gpsEnabled;
        const teamValidation = await current.teamOnly.validateForSubmit({ otherAddonsEnabled });
        if (!isCurrent()) return;
        if (!teamValidation.ok) {
          toast.show({
            message: lt(teamValidation.message, teamValidation.message),
            tone: 'error',
          });
          return;
        }

        // 照 A 限定俱樂部驗證：等待 hook 提交最新目錄名稱後才組 payload。
        await new Promise<void>((resolve) => {
          afterRenderRef.current = resolve;
          setSubmitRevision(value => value + 1);
        });
        if (!isCurrent()) return;
        current = latestRef.current;
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
      const locationValue = current.location.buildValue(new Date());
      const payloadForm = {
        ...toCreateEventForm(stateForSubmit, creatorName, {
          image: current.cover.value.image,
          imageVariants: current.cover.value.imageVariants,
          delegates: current.delegates.value,
          teamOnlySelection: current.teamOnly.resolveSelection(),
        }),
        // 照 A _buildEventLocationPayload('ce', location)：功能未開時 mapPickerEnabled=false，8 個地圖欄位都不寫。
        ...locationValue,
        // A 建立時一律寫 ISO 字串；既有資料若是 Timestamp 也轉成 ISO 字串，避免寫回物件改變型別。
        mapLocationUpdatedAt: toIsoOrNull(locationValue.mapLocationUpdatedAt),
      };

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

        // 照 A handleCreateEvent：加值欄位由表單送出，資料層依權限移除 updates。
        const result = await updateEventBasics(existingForEdit, payloadForm, ctx);
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
      } else if (submitDates) {
        // 照 A handleCreateEvent 多日期分支＋addEventsAtomic：一次 transaction 建立多場。
        const ids = submitDates.map((date) => {
          const known = batchIdsRef.current.get(date);
          if (known) return known;
          const id = newEventId(ctx);
          batchIdsRef.current.set(date, id);
          return id;
        });
        batchGroupIdRef.current ??= generateId('batch_');
        const forms = buildMultiDateForms(payloadForm, submitDates, stateForSubmit);
        const result = await createEventsBatch(forms, ctx, ids, batchGroupIdRef.current);
        if (!isCurrent()) return;
        if (result.addonsStripped) {
          toast.show({ message: ADDON_UPSELL_MESSAGE, tone: 'info' });
        }
        // 照 A：成功提示「已建立 N 場「X」活動！」、分享詢問用第一場。
        current.onSaved({
          mode: 'create',
          eventId: result.eventIds[0] ?? ids[0] ?? '',
          title: payloadForm.title,
          count: result.eventIds.length,
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
            onPatch={patch}
            titleLimit={EVENT_TITLE_LIMIT}
            canToggleRegion={canToggleRegion}
            cover={cover.view}
            delegates={delegates.view}
            addons={{
              state: formState,
              onPatch: patchAddon,
              guardAddon,
              onReservedClick,
              teamPicker: teamOnly.picker,
              teamOnlyToggleDisabled: teamOnly.toggleDisabled,
              teamOnlyLabel: teamOnly.label,
            }}
            location={location.view}
            multiDate={multiDate.view}
            dateInputHandlers={multiDate.dateInputHandlers}
            templates={templates.view}
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
      {location.picker}
    </div>,
    document.body,
  );
}
