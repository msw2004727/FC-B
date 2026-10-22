import './event-form.css';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { Switch } from '@/ui/Switch';
import { Text } from '@/ui/Text';
import { Textarea } from '@/ui/Textarea';
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
  type EventType,
} from '../data/event-create';
import { createEventContextFromViewer, operateContextFromViewer } from '../data/event-create-context';
import { canManageAllActivities, hasActivityManageEntry } from '../data/operate-permissions';
import {
  hasEventChangeNotificationDiff,
  loadEventNotifyRecipientUids,
  notifyEventChanged,
} from '../data/event-change-notify';
import {
  EVENT_TYPE_OPTIONS,
  REGION_KEYS,
  REGION_MAP,
  createDefaultFormState,
  formStateFromEvent,
  toCreateEventForm,
  validateEventForm,
  type EventFormState,
  canToggleEventRegion,
  resolveCreatorName,
  LEGACY_FRIENDLY_TYPE_OPTION,
  parseMinAge,
} from '../data/event-form-model';
import { SPORTS } from '../data/sports';
import type { EventDoc } from '../data/types';

/**
 * 送出成功後交給頁面的結果（T-013）：頁面依此做 A 的建立／編輯後流程（提示、刷新、分享詢問）。
 * count：這次建立的場數（多日期 > 1；編輯固定 1）。
 */
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

const REGION_LABEL_KEY: Readonly<Record<string, string>> = {
  '北部': 'events.form.regionNorth',
  '中部': 'events.form.regionCentral',
  '南部': 'events.form.regionSouth',
  '東部&外島': 'events.form.regionEastIslands',
};

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
  const t = useT();
  const [formState, setFormState] = useState<EventFormState>(() => createDefaultFormState());
  const [generatedEventId, setGeneratedEventId] = useState<string | null>(null);
  const [sportDropdownOpen, setSportDropdownOpen] = useState(false);
  const [sportSearch, setSportSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);
  const canToggleRegion = canToggleEventRegion(viewer.hasPermission);
  const [cityShake, setCityShake] = useState(0);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      setSportDropdownOpen(false);
      setSportSearch('');
      setSubmitting(false);
      submitInFlightRef.current = false;
      return;
    }

    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    const now = new Date();
    if (mode === 'edit' && existing) {
      const nextState = formStateFromEvent(existing);
      setFormState(nextState);
      setGeneratedEventId(nextState.eventId);
    } else {
      const nextState = createDefaultFormState(now);
      setFormState(nextState);
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
  }, [open, mode, existing, viewer]);

  const typeOptions = useMemo(
    () =>
      [
        ...EVENT_TYPE_OPTIONS,
        ...(formState.type === 'friendly' ? [LEGACY_FRIENDLY_TYPE_OPTION] : []),
      ].map((opt) => ({
        value: opt.value,
        label: t(opt.labelKey),
      })),
    [t, formState.type],
  );

  const regionRadioOptions = useMemo(
    () =>
      REGION_KEYS.map((key) => ({
        value: key,
        label: t(REGION_LABEL_KEY[key] ?? key),
      })),
    [t],
  );

  const selectedRegionCities = useMemo(() => {
    if (!formState.regionEnabled || !formState.region) return [];
    return REGION_MAP[formState.region] ?? [];
  }, [formState.regionEnabled, formState.region]);

  const selectedSportItem = useMemo(
    () => SPORTS.find((s) => s.sportTag === formState.sportTag) ?? null,
    [formState.sportTag],
  );

  const filteredSports = useMemo(() => {
    const q = sportSearch.trim().toLocaleLowerCase();
    if (!q) return SPORTS;
    return SPORTS.filter((item) => {
      const label = t(`events.sport.${item.key}`).toLocaleLowerCase();
      return label.includes(q) || item.sportTag.toLocaleLowerCase().includes(q);
    });
  }, [sportSearch, t]);

  function handleRegionSelect(nextRegion: string): void {
    const defaultCities = REGION_MAP[nextRegion] ? [...REGION_MAP[nextRegion]!] : [];
    setFormState((prev) => ({
      ...prev,
      region: nextRegion,
      cities: defaultCities,
    }));
  }

  function handleCityToggle(city: string, checked: boolean): void {
    setFormState((prev) => {
      if (checked) {
        if (prev.cities.includes(city)) return prev;
        return { ...prev, cities: [...prev.cities, city] };
      }
      // 照 A a-region-form.js：至少保留一個勾選（取消最後一個時晃動提示）
      if (prev.cities.length <= 1) {
        setCityShake((n) => n + 1);
        return prev;
      }
      return { ...prev, cities: prev.cities.filter((c) => c !== city) };
    });
  }

  const timeSummaryText = useMemo(() => {
    const start = formState.startTime;
    const end = formState.endTime;
    // A `_updateCreateTimeSummary`：起訖任一未選就提示選擇。
    if (!start || !end) return t('events.form.timeSummaryUnselected');
    if (formState.dateVal) {
      return t('events.form.timeSummaryWithDate', {
        date: formState.dateVal.replace(/-/g, '/'),
        start,
        end,
      });
    }
    return t('events.form.timeSummary', { start, end });
  }, [formState.dateVal, formState.startTime, formState.endTime, t]);

  const regOpenSummaryText = useMemo(() => {
    if (!formState.regOpenEnabled) {
      return t('events.form.regOpenSummaryImmediate');
    }
    if (formState.regOpenDate && formState.regOpenClock) {
      return t('events.form.regOpenSummaryScheduled', {
        date: formState.regOpenDate.replace(/-/g, '/'),
        time: formState.regOpenClock,
      });
    }
    return t('events.form.regOpenSummaryPending');
  }, [formState.regOpenEnabled, formState.regOpenDate, formState.regOpenClock, t]);

  async function handleSubmit(): Promise<void> {
    if (submitInFlightRef.current || submitting) return;

    const now = new Date();
    const stateForValidation: EventFormState = {
      ...formState,
      eventId: mode === 'edit' ? (formState.eventId ?? existing?.id ?? 'edit') : null,
    };
    const validation = validateEventForm(stateForValidation, now);
    if (!validation.ok) {
      toast.show({ message: t(validation.messageKey, validation.params), tone: 'error' });
      return;
    }

    const ctx = createEventContextFromViewer(viewer, now);
    if (!ctx) {
      toast.show({ message: t('events.form.error.createNotAllowed'), tone: 'error' });
      return;
    }

    const creatorName = resolveCreatorName(
      viewer.displayName,
      viewer.role,
      viewer.permissionSources?.customRoles ?? [],
    );
    // A：沒有地區開關權限的人一律開啟地區。
    const stateForSubmit = canToggleRegion ? formState : { ...formState, regionEnabled: true };
    const payloadForm = toCreateEventForm(stateForSubmit, creatorName);

    submitInFlightRef.current = true;
    setSubmitting(true);
    try {
      if (mode === 'edit' && existing) {
        const targetId = formState.eventId ?? existing.id ?? existing._docId ?? existing.docId ?? '';
        const existingForEdit = toEventForEdit(existing, targetId);
        // A：沒有活動管理入口、也不能管理全部活動的主辦方，名額不可小於已正取人數。
        const opCtx = operateContextFromViewer(viewer);
        if (
          !hasActivityManageEntry(opCtx)
          && !canManageAllActivities(opCtx)
          && payloadForm.max > 0
          && payloadForm.max < (existingForEdit.current ?? 0)
        ) {
          toast.show({ message: t('events.form.error.maxBelowConfirmed'), tone: 'error' });
          return;
        }
        // T-013 修補：表單還沒有加值／委託人／封面欄位，編輯時保留原值，不送預設值覆寫。
        const result = await updateEventBasics(existingForEdit, payloadForm, ctx, {
          addons: true,
          delegates: true,
          image: true,
        });
        if (result.addonsStripped) {
          toast.show({ message: ADDON_UPSELL_MESSAGE, tone: 'info' });
        }
        // A：儲存成功後，通知欄位有變才對未取消的報名者送「活動變更通知」；非關鍵、失敗不影響儲存。
        const changes: Record<string, unknown> = { ...result.updates };
        if (result.capacityChange !== null) changes.max = result.capacityChange;
        const before = existing as unknown as Record<string, unknown>;
        if (hasEventChangeNotificationDiff(before, changes)) {
          void (async () => {
            const recipientUids = await loadEventNotifyRecipientUids(existingForEdit.docId ?? existingForEdit.id);
            await notifyEventChanged({
              eventId: existingForEdit.id,
              title: payloadForm.title,
              date: String(changes.date ?? existing.date ?? ''),
              location: payloadForm.location,
              recipientUids,
              eventData: { ...before, ...changes },
              senderUid: viewer.uid,
            });
          })().catch((err: unknown) => {
            console.warn('[EventFormModal] event_changed notify failed', err);
          });
        }
        onSaved({ mode: 'edit', eventId: existingForEdit.id, title: payloadForm.title, count: 1 });
      } else {
        let targetEventId = generatedEventId;
        if (!targetEventId) {
          targetEventId = newEventId(ctx);
          setGeneratedEventId(targetEventId);
        }
        const result = await createEvent(payloadForm, ctx, targetEventId);
        if (result.addonsStripped) {
          toast.show({ message: ADDON_UPSELL_MESSAGE, tone: 'info' });
        }
        onSaved({ mode: 'create', eventId: result.eventId, title: payloadForm.title, count: 1 });
      }
    } catch (error) {
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
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  const modalTitle = mode === 'edit' ? t('events.form.editTitle') : t('events.form.createTitle');
  const submitLabel = mode === 'edit' ? t('events.form.saveChanges') : t('events.form.submitCreate');

  return (
    <Modal
      open={open}
      title={modalTitle}
      size="lg"
      closeOnOverlay={false}
      onClose={onClose}
      footer={
        <div class="modal-actions ce-modal-actions">
          <Button
            variant="secondary"
            class="outline-btn"
            disabled={submitting}
            onClick={onClose}
          >
            {t('events.form.cancel')}
          </Button>
          <Button
            id="ce-submit-btn"
            variant="primary"
            class="primary-btn"
            loading={submitting}
            disabled={submitting}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {submitLabel}
          </Button>
        </div>
      }
    >
      <div class="ce-form ce-form-v2">
        {/* 1. 活動名稱 */}
        <div class="ce-row">
          <div class="ce-label-row">
            <label for="ce-title"><Text>{t('events.form.titleLabel')}</Text></label>
            <span class="required ce-required"><Text>{t('events.form.required')}</Text></span>
          </div>
          <Input
            id="ce-title"
            label={t('events.form.titleLabel')}
            value={formState.title}
            maxLength={16}
            placeholder={t('events.form.titlePlaceholder')}
            onValueChange={(val) => setFormState((prev) => ({ ...prev, title: val }))}
          />
        </div>

        {/* 2. 活動類型 */}
        <div class="ce-row">
          <div class="ce-label-row">
            <label for="ce-type"><Text>{t('events.form.typeLabel')}</Text></label>
          </div>
          <Select
            id="ce-type"
            label={t('events.form.typeLabel')}
            value={formState.type}
            options={typeOptions}
            onValueChange={(val) =>
              setFormState((prev) => ({ ...prev, type: val as EventType }))
            }
          />
        </div>

        {/* 3. 活動地區 */}
        <div class="ce-row" id="ce-region-row">
          <div class="ce-label-row">
            <label for="ce-region-enabled"><Text>{t('events.form.regionLabel')}</Text></label>
            <span class="required ce-required"><Text>{t('events.form.required')}</Text></span>
          </div>
          <div id="ce-region-toggle-row" class="ce-toggle-control" hidden={!canToggleRegion}>
            <Switch
              id="ce-region-enabled"
              label={t('events.form.regionLabel')}
              checked={formState.regionEnabled}
              onCheckedChange={(checked) =>
                setFormState((prev) => ({
                  ...prev,
                  regionEnabled: checked,
                }))
              }
            />
            <span id="ce-region-enabled-label" class="ce-toggle-status">
              <Text>
                {formState.regionEnabled
                  ? t('events.form.regionEnabledStatus')
                  : t('events.form.regionDisabledStatus')}
              </Text>
            </span>
          </div>
          {formState.regionEnabled && (
            <div id="ce-region-options" class="ce-region-options">
              <div id="ce-region-radios" class="ce-region-radios">
                <RadioGroup
                  name="ce-region"
                  label={t('events.form.regionLabel')}
                  orientation="horizontal"
                  value={formState.region}
                  options={regionRadioOptions}
                  onValueChange={handleRegionSelect}
                />
              </div>
              {selectedRegionCities.length > 0 && (
                <div
                  id="ce-region-cities"
                  key={`cities-${cityShake}`}
                  class={`ce-region-cities${cityShake > 0 ? ' ce-region-cities--shake' : ''}`}
                >
                  <div class="ce-region-cities-wrap">
                    {selectedRegionCities.map((city) => (
                      <Checkbox
                        key={city}
                        name="ce-region-city"
                        value={city}
                        label={city}
                        checked={formState.cities.includes(city)}
                        class="ce-city-chip"
                        onCheckedChange={(checked) => handleCityToggle(city, checked)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. 地點 */}
        <div class="ce-row">
          <div class="ce-label-row">
            <label for="ce-location"><Text>{t('events.form.locationLabel')}</Text></label>
            <span class="required ce-required"><Text>{t('events.form.required')}</Text></span>
          </div>
          <Input
            id="ce-location"
            label={t('events.form.locationLabel')}
            value={formState.location}
            placeholder={t('events.form.locationPlaceholder')}
            onValueChange={(val) => setFormState((prev) => ({ ...prev, location: val }))}
          />
        </div>

        {/* 5. 活動時間 */}
        <div class="ce-row">
          <div class="ce-label-row">
            <span class="ce-field-label"><Text>{t('events.form.timeLabel')}</Text></span>
            <span class="required ce-required"><Text>{t('events.form.required')}</Text></span>
          </div>
          <div class="ce-time-row">
            <label class="ce-time-field ce-time-field-date" for="ce-date">
              <span class="ce-time-field-label"><Text>{t('events.form.dateFieldLabel')}</Text></span>
              <input
                type="date"
                id="ce-date"
                class="ce-time-date"
                value={formState.dateVal}
                placeholder={t('events.form.datePlaceholder')}
                onInput={(e) =>
                  setFormState((prev) => ({ ...prev, dateVal: e.currentTarget.value }))
                }
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, dateVal: e.currentTarget.value }))
                }
              />
            </label>
            <label class="ce-time-field ce-time-field-start" for="ce-time-start">
              <span class="ce-time-field-label"><Text>{t('events.form.startTimeFieldLabel')}</Text></span>
              <input
                type="time"
                id="ce-time-start"
                class="ce-time-clock ce-time-start"
                step={1800}
                value={formState.startTime}
                placeholder={t('events.form.startTimePlaceholder')}
                onInput={(e) =>
                  setFormState((prev) => ({ ...prev, startTime: e.currentTarget.value }))
                }
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, startTime: e.currentTarget.value }))
                }
              />
            </label>
            <span class="ce-time-separator" aria-hidden="true"><Text>~</Text></span>
            <label class="ce-time-field ce-time-field-end" for="ce-time-end">
              <span class="ce-time-field-label"><Text>{t('events.form.endTimeFieldLabel')}</Text></span>
              <input
                type="time"
                id="ce-time-end"
                class="ce-time-clock ce-time-end"
                step={1800}
                value={formState.endTime}
                placeholder={t('events.form.endTimePlaceholder')}
                onInput={(e) =>
                  setFormState((prev) => ({ ...prev, endTime: e.currentTarget.value }))
                }
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, endTime: e.currentTarget.value }))
                }
              />
            </label>
          </div>
          <div id="ce-time-summary" class="ce-time-summary" aria-live="polite">
            <Text>{timeSummaryText}</Text>
          </div>
        </div>

        {/* 6. 開放報名時間 */}
        <div class="ce-row">
          <div class="ce-label-row">
            <label for="ce-reg-open-enabled"><Text>{t('events.form.regOpenLabel')}</Text></label>
          </div>
          <div class="ce-toggle-control ce-reg-open-toggle-control">
            <Switch
              id="ce-reg-open-enabled"
              label={t('events.form.regOpenLabel')}
              checked={formState.regOpenEnabled}
              onCheckedChange={(checked) =>
                setFormState((prev) => ({ ...prev, regOpenEnabled: checked }))
              }
            />
            <span id="ce-reg-open-enabled-label" class="ce-toggle-status">
              <Text>
                {formState.regOpenEnabled
                  ? t('events.form.regOpenScheduledStatus')
                  : t('events.form.regOpenImmediateStatus')}
              </Text>
            </span>
          </div>
          <div
            id="ce-reg-open-fields"
            class="ce-reg-open-fields"
            hidden={!formState.regOpenEnabled}
          >
            <div id="ce-reg-open-absolute" class="ce-reg-open-row">
              <label class="ce-time-field ce-reg-open-field" for="ce-reg-open-date">
                <span class="ce-time-field-label"><Text>{t('events.form.regOpenDateLabel')}</Text></span>
                <input
                  type="date"
                  id="ce-reg-open-date"
                  class="ce-reg-open-date"
                  value={formState.regOpenDate}
                  placeholder={t('events.form.regOpenDatePlaceholder')}
                  onInput={(e) =>
                    setFormState((prev) => ({ ...prev, regOpenDate: e.currentTarget.value }))
                  }
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, regOpenDate: e.currentTarget.value }))
                  }
                />
              </label>
              <label class="ce-time-field ce-reg-open-field" for="ce-reg-open-clock">
                <span class="ce-time-field-label"><Text>{t('events.form.regOpenTimeLabel')}</Text></span>
                <input
                  type="time"
                  id="ce-reg-open-clock"
                  class="ce-reg-open-clock"
                  step={1800}
                  value={formState.regOpenClock}
                  placeholder={t('events.form.regOpenTimePlaceholder')}
                  onInput={(e) =>
                    setFormState((prev) => ({ ...prev, regOpenClock: e.currentTarget.value }))
                  }
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, regOpenClock: e.currentTarget.value }))
                  }
                />
              </label>
            </div>
          </div>
          <div id="ce-reg-open-summary" class="ce-time-summary ce-time-summary-muted" aria-live="polite">
            <Text>{regOpenSummaryText}</Text>
          </div>
          <div id="ce-reg-open-hint" class="ce-reg-open-hint">
            <Text>{t('events.form.regOpenHint')}</Text>
          </div>
          <div id="ce-reg-open-early-bird-hint" class="ce-early-bird-reg-hint">
            <Text>{t('events.form.regOpenEarlyBirdHint')}</Text>
          </div>
        </div>

        {/* 7. 人數上限 */}
        <div class="ce-row">
          <div class="ce-label-row">
            <label for="ce-max"><Text>{t('events.form.maxLabel')}</Text></label>
            <span class="required ce-required"><Text>{t('events.form.required')}</Text></span>
          </div>
          <Input
            id="ce-max"
            type="number"
            label={t('events.form.maxLabel')}
            value={formState.max}
            placeholder="20"
            onValueChange={(val) => setFormState((prev) => ({ ...prev, max: val }))}
          />
        </div>

        {/* 8. 年齡限制 */}
        <div class="ce-row">
          <div class="ce-label-row">
            <label for="ce-age-limit-enabled"><Text>{t('events.form.ageLimitLabel')}</Text></label>
            <span class="ce-label-suffix"><Text>{t('events.form.ageLimitSuffix')}</Text></span>
          </div>
          <div class="ce-age-limit-wrap">
            <div class="ce-age-limit-header">
              <Switch
                id="ce-age-limit-enabled"
                label={t('events.form.ageLimitLabel')}
                checked={formState.ageLimitEnabled}
                onCheckedChange={(checked) =>
                  setFormState((prev) => ({
                    ...prev,
                    ageLimitEnabled: checked,
                    minAge: checked ? prev.minAge : '0',
                  }))
                }
              />
              <span id="ce-age-limit-label" class="ce-toggle-status">
                <Text>
                  {!formState.ageLimitEnabled
                    ? t('events.form.ageLimitDisabledStatus')
                    : parseMinAge(formState.minAge) > 0
                      ? t('events.form.ageLimitEnabledWithAge', { age: parseMinAge(formState.minAge) })
                      : t('events.form.ageLimitEnabledPending')}
                </Text>
              </span>
            </div>
            {formState.ageLimitEnabled && (
              <div id="ce-min-age-wrap" class="ce-age-limit-input-wrap">
                <Input
                  id="ce-min-age"
                  type="number"
                  label={t('events.form.ageLimitLabel')}
                  min={0}
                  placeholder="0"
                  value={formState.minAge}
                  onValueChange={(val) => setFormState((prev) => ({ ...prev, minAge: val }))}
                />
              </div>
            )}
            <div class="ce-field-note">
              <Text>{t('events.form.ageLimitNote')}</Text>
            </div>
          </div>
        </div>

        {/* 9. 注意事項 */}
        <div class="ce-row">
          <div class="ce-label-row">
            <label for="ce-notes"><Text>{t('events.form.notesLabel')}</Text></label>
            <span class="ce-label-suffix"><Text>{t('events.form.notesSuffix')}</Text></span>
          </div>
          <Textarea
            id="ce-notes"
            label={t('events.form.notesLabel')}
            rows={3}
            maxLength={500}
            value={formState.notes}
            placeholder={t('events.form.notesPlaceholder')}
            onValueChange={(val) => setFormState((prev) => ({ ...prev, notes: val }))}
          />
        </div>

        {/* 10. 運動 / 場景標籤 */}
        <div class="ce-row">
          <div class="ce-label-row">
            <label for="ce-sport-selected"><Text>{t('events.form.sportLabel')}</Text></label>
            <span class="required ce-required"><Text>{t('events.form.requiredSelect')}</Text></span>
          </div>
          <div class="ce-sport-picker" id="ce-sport-picker">
            <button
              type="button"
              id="ce-sport-selected"
              class={`ce-sport-selected${sportDropdownOpen ? ' open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={sportDropdownOpen}
              onClick={() => setSportDropdownOpen((o) => !o)}
            >
              <span class="ce-sport-selected-inner" id="ce-sport-selected-inner">
                {selectedSportItem ? (
                  <span class="ce-sport-value">
                    <span class="sport-emoji" aria-hidden="true">
                      <Text>{selectedSportItem.symbol}</Text>
                    </span>
                    <Text>{t(`events.sport.${selectedSportItem.key}`)}</Text>
                  </span>
                ) : (
                  <span class="ce-sport-placeholder">
                    <Text>{t('events.form.sportPlaceholder')}</Text>
                  </span>
                )}
              </span>
              <span class="ce-sport-arrow" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>
            <div
              id="ce-sport-dropdown"
              class={`ce-sport-dropdown${sportDropdownOpen ? ' open' : ''}`}
            >
              <input
                type="text"
                id="ce-sport-search"
                class="ce-sport-search"
                value={sportSearch}
                placeholder={t('events.form.sportSearchPlaceholder')}
                onInput={(e) => setSportSearch(e.currentTarget.value)}
              />
              <div id="ce-sport-list" class="ce-sport-list" role="listbox">
                {filteredSports.length === 0 ? (
                  <div class="ce-sport-empty">
                    <Text>{t('events.form.sportEmpty')}</Text>
                  </div>
                ) : (
                  filteredSports.map((item) => {
                    const isActive = item.sportTag === formState.sportTag;
                    return (
                      <button
                        type="button"
                        key={item.key}
                        role="option"
                        aria-selected={isActive}
                        class={`ce-sport-option${isActive ? ' active' : ''}`}
                        onClick={() => {
                          setFormState((prev) => ({ ...prev, sportTag: item.sportTag }));
                          setSportDropdownOpen(false);
                        }}
                      >
                        <span class="sport-emoji" aria-hidden="true">
                          <Text>{item.symbol}</Text>
                        </span>
                        <Text>{t(`events.sport.${item.key}`)}</Text>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <input type="hidden" id="ce-sport-tag" value={formState.sportTag} />
          </div>
          <div class="ce-sport-required-tip">
            <Text>{t('events.form.sportRequiredTip')}</Text>
          </div>
        </div>
      </div>
    </Modal>
  );
}
