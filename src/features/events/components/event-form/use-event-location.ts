import { h, type ComponentType, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { LocationControlView } from './form-types';
import type {
  EventLocationPickerProps,
  EventLocationSelection,
} from './EventLocationPicker';
import {
  formatPoint,
  isActivityMapLocationPickerEnabled,
  loadActivityMapLocationPickerEnabled,
  normalizeLocationText,
  normalizePoint,
  subscribeActivityMapFeature,
} from '../../data/activity-map-config';

export type EventLocationUpdatedAt = string | { toDate(): Date } | null;

export interface EventLocationValue {
  /** false 時呼叫端不得寫入八個地圖欄位。 */
  mapPickerEnabled: boolean;
  gpsEnabled: boolean;
  lat: number | null;
  lng: number | null;
  mapAddress: string | null;
  mapPlaceId: string | null;
  mapProvider: 'google' | 'manual' | null;
  mapLocationConfirmed: boolean;
  mapLocationUpdatedAt: EventLocationUpdatedAt;
}

export interface EventLocationDraft {
  lat: number | null;
  lng: number | null;
  mapAddress: string;
  mapPlaceId: string;
  mapProvider: 'google' | 'manual' | null;
  mapLocationConfirmed: boolean;
  mapLocationUpdatedAt: EventLocationUpdatedAt;
  sourceLocationText: string;
  isStale: boolean;
}

function preserveLocationUpdatedAt(value: unknown): EventLocationUpdatedAt {
  if (typeof value === 'string') return value || null;
  if (
    typeof value === 'object'
    && value !== null
    && 'toDate' in value
    && typeof value.toDate === 'function'
  ) {
    return value as { toDate(): Date };
  }
  return null;
}

export function emptyDraft(locationText: unknown): EventLocationDraft {
  return {
    lat: null,
    lng: null,
    mapAddress: '',
    mapPlaceId: '',
    mapProvider: null,
    mapLocationConfirmed: false,
    mapLocationUpdatedAt: null,
    sourceLocationText: normalizeLocationText(locationText),
    isStale: false,
  };
}

export function resetLocationDraft(
  eventRecord: Record<string, unknown> | null,
  locationText: string,
): EventLocationDraft {
  // 照 A _resetEventLocationDraft，既有 ISO 字串與 Timestamp 原樣保留。
  const sourceLocationText = normalizeLocationText(eventRecord?.location || locationText);
  const point = eventRecord?.mapLocationConfirmed === true
    ? normalizePoint(eventRecord)
    : null;
  if (!point || !eventRecord) return emptyDraft(sourceLocationText);
  return {
    ...point,
    mapAddress: normalizeLocationText(eventRecord.mapAddress || sourceLocationText),
    mapPlaceId: normalizeLocationText(eventRecord.mapPlaceId || ''),
    mapProvider: eventRecord.mapProvider === 'google' ? 'google' : 'manual',
    mapLocationConfirmed: true,
    mapLocationUpdatedAt: preserveLocationUpdatedAt(eventRecord.mapLocationUpdatedAt),
    sourceLocationText,
    isStale: false,
  };
}

export function markLocationStale(
  draft: EventLocationDraft,
  locationText: string,
): EventLocationDraft {
  if (!draft.mapLocationConfirmed
    || normalizeLocationText(locationText) === normalizeLocationText(draft.sourceLocationText)) {
    return draft;
  }
  return {
    ...draft,
    mapLocationConfirmed: false,
    isStale: true,
    sourceLocationText: normalizeLocationText(draft.sourceLocationText),
  };
}

export function buildEventLocationValue(
  draft: EventLocationDraft,
  locationText: string,
  gpsEnabled: boolean,
  mapPickerEnabled: boolean,
  now: Date,
): EventLocationValue {
  // 照 A _buildEventLocationPayload；mapPickerEnabled 是呼叫端的寫入閘門。
  const cleared: EventLocationValue = {
    mapPickerEnabled,
    gpsEnabled,
    lat: null,
    lng: null,
    mapAddress: null,
    mapPlaceId: null,
    mapProvider: null,
    mapLocationConfirmed: false,
    mapLocationUpdatedAt: null,
  };
  if (!mapPickerEnabled || !gpsEnabled) return cleared;
  const point = draft.mapLocationConfirmed ? normalizePoint(draft) : null;
  const currentLocation = normalizeLocationText(locationText);
  if (!point || draft.isStale
    || currentLocation !== normalizeLocationText(draft.sourceLocationText)) {
    return cleared;
  }
  return {
    mapPickerEnabled,
    gpsEnabled,
    ...point,
    mapAddress: draft.mapAddress || currentLocation || null,
    mapPlaceId: draft.mapPlaceId || null,
    mapProvider: draft.mapProvider || 'manual',
    mapLocationConfirmed: true,
    mapLocationUpdatedAt: draft.mapLocationUpdatedAt || now.toISOString(),
  };
}

export function locationControlState(
  draft: EventLocationDraft,
  featureEnabled: boolean,
  gpsEnabled: boolean,
): Omit<LocationControlView, 'onOpenPicker' | 'onClear'> {
  // 照 A _syncEventLocationUi。
  const point = draft.mapLocationConfirmed ? normalizePoint(draft) : null;
  const result = {
    statusText: '尚未設定地圖座標',
    statusState: 'empty',
    buttonText: point ? '重新設定地圖座標' : '設定地圖座標',
    buttonDisabled: !featureEnabled,
    buttonLooksDisabled: !(featureEnabled && gpsEnabled),
    summary: '',
    showClear: false,
  };
  if (!gpsEnabled) {
    return { ...result, statusText: 'GPS功能未開啟', statusState: 'disabled' };
  }
  if (!featureEnabled) {
    return { ...result, statusText: '地圖定位未開啟', statusState: 'disabled' };
  }
  if (point) {
    return {
      ...result,
      statusText: '已設定地圖座標',
      statusState: 'ready',
      summary: draft.mapAddress || formatPoint(point),
      showClear: true,
    };
  }
  if (draft.isStale) {
    return {
      ...result,
      statusText: '地點文字已變更，請重新確認',
      statusState: 'stale',
    };
  }
  return result;
}

export function useEventLocation(input: {
  locationText: string;
  gpsEnabled: boolean;
}): {
  view: LocationControlView;
  picker: JSX.Element | null;
  reset(eventRecord: Record<string, unknown> | null): void;
  buildValue(now: Date): EventLocationValue;
} {
  const lt = useLegacyT();
  const inputRef = useRef(input);
  inputRef.current = input;
  const draftRef = useRef(emptyDraft(input.locationText));
  // 同步標記，避免 effect 執行前送出，或文字改回後意外恢復確認。
  draftRef.current = markLocationStale(draftRef.current, input.locationText);
  const [, rerender] = useState(0);
  const [feature, setFeature] = useState(isActivityMapLocationPickerEnabled);
  const [Picker, setPicker] = useState<ComponentType<EventLocationPickerProps> | null>(null);
  const [open, setOpen] = useState(false);
  const alive = useRef(false);
  const requestId = useRef(0);

  useEffect(() => {
    alive.current = true;
    const update = (): void => {
      if (alive.current) setFeature(isActivityMapLocationPickerEnabled());
    };
    const unsubscribe = subscribeActivityMapFeature(update);
    update();
    loadActivityMapLocationPickerEnabled().then(update).catch(update);
    return () => {
      alive.current = false;
      requestId.current += 1;
      unsubscribe();
    };
  }, []);

  function validateOpen(): boolean {
    const current = inputRef.current;
    if (!current.gpsEnabled) {
      const message = '請先至【進階功能】開啟GPS功能';
      toast.show({ message: lt(message, message) });
      return false;
    }
    if (!normalizeLocationText(current.locationText)) {
      const message = '請先輸入地點文字';
      toast.show({ message: lt(message, message) });
      document.getElementById('ce-location')?.focus();
      return false;
    }
    if (!isActivityMapLocationPickerEnabled()) {
      const message = '地圖定位功能尚未開啟';
      toast.show({ message: lt(message, message) });
      return false;
    }
    return true;
  }

  async function openPicker(): Promise<void> {
    const request = ++requestId.current;
    if (!validateOpen()) return;
    try {
      const module = await import('./EventLocationPicker');
      if (!alive.current || request !== requestId.current) return;
      if (!validateOpen()) return;
      const LoadedPicker = module.EventLocationPicker;
      setPicker(() => LoadedPicker);
      setOpen(true);
    } catch {
      if (alive.current && request === requestId.current) {
        const message = '地圖定位工具載入失敗';
        toast.show({ message: lt(message, message) });
      }
    }
  }

  function onClear(): void {
    draftRef.current = emptyDraft(inputRef.current.locationText);
    rerender((version) => version + 1);
  }

  function reset(eventRecord: Record<string, unknown> | null): void {
    requestId.current += 1;
    draftRef.current = resetLocationDraft(eventRecord, inputRef.current.locationText);
    setOpen(false);
    rerender((version) => version + 1);
  }

  function onConfirm(selection: EventLocationSelection): void {
    if (!alive.current) return;
    const currentLocation = normalizeLocationText(inputRef.current.locationText);
    draftRef.current = {
      ...selection,
      mapAddress: normalizeLocationText(selection.mapAddress || currentLocation),
      mapPlaceId: normalizeLocationText(selection.mapPlaceId),
      mapLocationConfirmed: true,
      sourceLocationText: currentLocation,
      isStale: false,
    };
    rerender((version) => version + 1);
    const message = '已設定活動地圖座標';
    toast.show({ message: lt(message, message) });
  }

  const state = locationControlState(draftRef.current, feature, input.gpsEnabled);
  const pickerElement = open && Picker
    ? h(Picker, {
      locationText: input.locationText,
      initial: draftRef.current,
      onConfirm,
      onClose: () => setOpen(false),
    })
    : null;

  return {
    view: {
      ...state,
      statusText: lt(state.statusText, state.statusText),
      buttonText: lt(state.buttonText, state.buttonText),
      onOpenPicker: () => {
        openPicker().catch(() => {
          if (alive.current) {
            const message = '地圖定位工具載入失敗';
            toast.show({ message: lt(message, message) });
          }
        });
      },
      onClear,
    },
    picker: pickerElement,
    reset,
    buildValue: (now) => buildEventLocationValue(
      draftRef.current,
      inputRef.current.locationText,
      inputRef.current.gpsEnabled,
      isActivityMapLocationPickerEnabled(),
      now,
    ),
  };
}
