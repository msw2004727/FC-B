/**
 * 建立／編輯活動表單的各列（T-013 UI 第 5 批）。
 * 行為與 DOM 照 A `pages/activity.html#282-673` 與各 JS；純顯示元件：
 * 所有值與變更從 props 進出，只有 UI 狀態（說明視窗、地區晃動、運動下拉、搜尋字串）在內部。
 */
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLegacyT } from '@/i18n/i18n';
import { UserTag } from '@/ui/UserTag';
import type { UserRole } from '@/ui/Avatar';
import type { EventType } from '../../data/event-create';
import {
  REGION_KEYS,
  REGION_MAP,
  LEGACY_FRIENDLY_TYPE_OPTION,
  parseMinAge,
  roleLabelOf,
  type EventFormState,
} from '../../data/event-form-model';
import { SPORTS } from '../../data/sports';
import type { CoverUploadView, DelegatePickerView, LocationControlView } from './form-types';
import type { CeInfoKey } from './ce-info';
import { CeInfoDialog } from './CeInfoDialog';

export interface EventFormFieldsProps {
  mode: 'create' | 'edit';
  state: EventFormState;
  onPatch(patch: Partial<EventFormState>): void;
  titleLimit: number;
  canToggleRegion: boolean;
  cover: CoverUploadView;
  location: LocationControlView;
  delegates: DelegatePickerView;
}

/** A `_userTag(name, role)` 的 role class 只認內建角色；未知值退回 user（避免渲染錯誤角色樣式）。 */
function toUserRole(raw: string): UserRole {
  switch (raw) {
    case 'coach':
    case 'captain':
    case 'team_leader':
    case 'venue_owner':
    case 'admin':
    case 'super_admin':
      return raw;
    default:
      return 'user';
  }
}

function regionLabelStyle(checked: boolean): JSX.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '.3rem',
    fontSize: '.8rem',
    cursor: 'pointer',
    padding: '.35rem .6rem',
    borderRadius: '8px',
    border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
    background: checked ? 'var(--accent-bg,rgba(13,148,136,.08))' : 'var(--bg-card)',
    whiteSpace: 'nowrap',
  };
}

const CITY_CHECKED_STYLE: JSX.CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: '.25rem',
  fontSize: '.78rem',
  cursor: 'pointer',
  padding: '.25rem .5rem',
  borderRadius: '6px',
  border: '1px solid rgba(139,92,246,.4)',
  background: 'rgba(139,92,246,.1)',
  whiteSpace: 'nowrap',
};

const CITY_UNCHECKED_STYLE: JSX.CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: '.25rem',
  fontSize: '.78rem',
  cursor: 'pointer',
  padding: '.25rem .5rem',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'transparent',
  whiteSpace: 'nowrap',
};

const SMALL_CHECK_STYLE: JSX.CSSProperties = {
  margin: 0,
  flexShrink: 0,
  width: '14px',
  height: '14px',
};

export function EventFormFields(props: EventFormFieldsProps): JSX.Element {
  const { state, onPatch, titleLimit, canToggleRegion, cover, location, delegates } = props;
  const lt = useLegacyT();

  const [activeInfoKey, setActiveInfoKey] = useState<CeInfoKey | null>(null);
  const [cityShakeCount, setCityShakeCount] = useState(0);
  const [sportDropdownOpen, setSportDropdownOpen] = useState(false);
  const [sportSearch, setSportSearch] = useState('');

  const sportPickerRef = useRef<HTMLDivElement | null>(null);
  const citiesRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCloseInfo = useCallback(() => {
    setActiveInfoKey(null);
  }, []);

  // 照 A bindRegionToggle：非管理員不顯示 toggle，地區一律視為開啟。
  const effectiveRegionEnabled = canToggleRegion ? state.regionEnabled : true;

  // 照 A _updateCityCheckboxes：取消最後一個縣市時對容器晃動（reset animation 再重播）。
  useEffect(() => {
    if (cityShakeCount === 0) return;
    const el = citiesRef.current;
    if (!el) return;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'region-shake .4s ease';
  }, [cityShakeCount]);

  // 照 A event-create-sport-picker.js：點擊外部關閉下拉。
  useEffect(() => {
    if (!sportDropdownOpen) return;
    const handler = (ev: MouseEvent): void => {
      const picker = sportPickerRef.current;
      if (picker && picker.contains(ev.target as Node)) return;
      setSportDropdownOpen(false);
    };
    document.addEventListener('click', handler);
    return () => {
      document.removeEventListener('click', handler);
    };
  }, [sportDropdownOpen]);

  // 照 A image-upload.js `_initImageUpload`：用原生 change 事件讀取檔案（compat 下 onChange 綁 input）。
  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;
    const handler = (): void => {
      const file = input.files?.[0];
      if (file) cover.onPickFile(file);
      // 清空 value 讓同一檔可再選（照 A）。
      input.value = '';
    };
    input.addEventListener('change', handler);
    return () => {
      input.removeEventListener('change', handler);
    };
  }, [cover]);

  function handleRegionSelect(nextRegion: string): void {
    const defaultCities = REGION_MAP[nextRegion] ? [...REGION_MAP[nextRegion]!] : [];
    onPatch({ region: nextRegion, cities: defaultCities });
  }

  function handleCityToggle(city: string, checked: boolean): void {
    if (checked) {
      if (state.cities.includes(city)) return;
      onPatch({ cities: [...state.cities, city] });
      return;
    }
    // 照 A：至少保留一個勾選（取消最後一個時晃動提示）。
    if (state.cities.length <= 1) {
      setCityShakeCount((n) => n + 1);
      return;
    }
    onPatch({ cities: state.cities.filter((c) => c !== city) });
  }

  const selectedRegionCities = useMemo(() => {
    if (!effectiveRegionEnabled || !state.region) return [];
    return REGION_MAP[state.region] ? [...REGION_MAP[state.region]!] : [];
  }, [effectiveRegionEnabled, state.region]);

  const selectedSport = SPORTS.find((s) => s.sportTag === state.sportTag) ?? null;

  const filteredSports = useMemo(() => {
    // 照 A _renderSportPickerOptions：只比對原始 label（中文）與 query。
    const q = sportSearch.trim().toLowerCase();
    if (!q) return SPORTS;
    return SPORTS.filter((item) => item.label.toLowerCase().includes(q));
  }, [sportSearch]);

  // 照 A _updateCreateTimeSummary（單日期模式）。
  const dateLabel = state.dateVal ? state.dateVal.replace(/-/g, '/') : '';
  const datePrefix = dateLabel ? `${dateLabel} ` : '';
  const timeSummaryText = state.startTime && state.endTime
    ? lt(
      '已選時間：{prefix}{start} ～ {end}',
      '已選時間：{prefix}{start} ～ {end}',
      { prefix: datePrefix, start: state.startTime, end: state.endTime },
    )
    : lt('已選時間：請選擇開始與結束時間（24 小時制）');

  let regOpenSummaryText: string;
  if (!state.regOpenEnabled) {
    regOpenSummaryText = lt('報名開放：建立後立即開放報名');
  } else if (state.regOpenDate && state.regOpenClock) {
    regOpenSummaryText = lt(
      '報名開放：{date} {time} 後可報名',
      '報名開放：{date} {time} 後可報名',
      { date: state.regOpenDate.replace(/-/g, '/'), time: state.regOpenClock },
    );
  } else {
    regOpenSummaryText = lt('報名開放：請選擇完整的開放日期與時間');
  }

  const regOpenHint = !state.regOpenEnabled
    ? lt('關閉時建立後立即開放報名；開啟後可指定開放日期與時間。')
    : lt('報名時間未到會顯示「即將開放」，到達時間後自動開放報名。');

  // 照 A _updateEventAgeLimitUI。
  const minAgeNum = parseMinAge(state.minAge);
  let ageLabelText: string;
  let ageLabelColor: string;
  if (!state.ageLimitEnabled) {
    ageLabelText = lt('關閉 — 不限制年齡');
    ageLabelColor = 'var(--text-muted)';
  } else if (minAgeNum > 0) {
    ageLabelText = lt('已開啟 — {age} 歲以上', '已開啟 — {age} 歲以上', { age: minAgeNum });
    ageLabelColor = 'var(--accent)';
  } else {
    ageLabelText = lt('已開啟 — 請填最低年齡');
    ageLabelColor = 'var(--warning)';
  }

  const renderInfoBtn = (key: CeInfoKey): JSX.Element => (
    <button
      type="button"
      class="edu-info-btn"
      title={lt('說明')}
      onClick={() => setActiveInfoKey(key)}
    >
      ?
    </button>
  );

  return (
    <div class="ce-form ce-form-v2">
      {/* 第 3 段：從範本建立（ce-template-area） */}
      {/* 封面圖片（A #ce-upload-area） */}
      <div class="ce-row">
        <label>{lt('活動封面圖片')}</label>
        <div class="ce-upload" id="ce-upload-area">
          <input
            type="file"
            id="ce-image"
            accept="image/*"
            hidden
            ref={fileInputRef}
          />
          <div
            class={`ce-upload-placeholder${cover.previewUrl ? ' has-image' : ''}`}
            id="ce-upload-preview"
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            {cover.previewUrl ? (
              <img
                src={cover.previewUrl}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  borderRadius: 'var(--radius-sm)',
                }}
              />
            ) : (
              <>
                <span class="ce-upload-icon">+</span>
                <span class="ce-upload-text">{lt('點擊上傳圖片')}</span>
                <span class="ce-upload-hint">{lt('建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB')}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 活動名稱 */}
      <div class="ce-row">
        <div class="ce-label-row">
          {renderInfoBtn('title')}
          <label for="ce-title">{lt('活動名稱')}</label>{' '}
          <span class="required">{lt('*必填')}</span>
        </div>
        <input
          type="text"
          id="ce-title"
          placeholder={lt('例：週六足球友誼賽')}
          maxLength={titleLimit}
          value={state.title}
          onInput={(e) => onPatch({ title: e.currentTarget.value })}
        />
      </div>

      {/* 活動類型 */}
      <div class="ce-row">
        <div class="ce-label-row">
          {renderInfoBtn('type')}
          <label for="ce-type">{lt('活動類型')}</label>
        </div>
        <select
          id="ce-type"
          value={state.type}
          onChange={(e) => onPatch({ type: e.currentTarget.value as EventType })}
        >
          <option value="play">{lt('PLAY')}</option>
          <option value="camp">{lt('教學')}</option>
          <option value="watch">{lt('觀賽')}</option>
          {state.type === 'friendly' && (
            <option value={LEGACY_FRIENDLY_TYPE_OPTION.value}>{lt('友誼')}</option>
          )}
        </select>
      </div>

      {/* 活動地區（A #ce-region-row） */}
      <div class="ce-row" id="ce-region-row">
        <div class="ce-label-row">
          {renderInfoBtn('region')}
          <label>{lt('活動地區')}</label>{' '}
          <span class="required">{lt('*必填')}</span>
        </div>
        {canToggleRegion && (
          <div
            id="ce-region-toggle-row"
            style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}
          >
            <label class="toggle-switch" style={{ margin: 0 }}>
              <input
                type="checkbox"
                id="ce-region-enabled"
                checked={state.regionEnabled}
                onChange={(e) => onPatch({ regionEnabled: e.currentTarget.checked })}
              />
              <span class="toggle-slider"></span>
            </label>
            <span
              id="ce-region-enabled-label"
              style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}
            >
              {state.regionEnabled
                ? lt('開啟 — 指定活動地區')
                : lt('關閉 — 所有地區頁籤都顯示')}
            </span>
          </div>
        )}
        <div
          id="ce-region-options"
          style={{ marginTop: '.6rem', display: effectiveRegionEnabled ? undefined : 'none' }}
        >
          <div
            id="ce-region-radios"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}
          >
            {REGION_KEYS.map((key) => {
              const checked = state.region === key;
              return (
                <label key={key} style={regionLabelStyle(checked)}>
                  <input
                    type="radio"
                    name="ce-region"
                    value={key}
                    style={SMALL_CHECK_STYLE}
                    checked={checked}
                    onChange={() => handleRegionSelect(key)}
                  />
                  <span style={{ fontWeight: 500 }}>{lt(key, key)}</span>
                </label>
              );
            })}
          </div>
          {selectedRegionCities.length > 0 ? (
            <div
              id="ce-region-cities"
              ref={citiesRef}
              style={{
                marginTop: '.5rem',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '.5rem .6rem',
                background: 'var(--bg-card)',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
                {selectedRegionCities.map((city) => {
                  const checked = state.cities.includes(city);
                  return (
                    <label key={city} style={checked ? CITY_CHECKED_STYLE : CITY_UNCHECKED_STYLE}>
                      <input
                        type="checkbox"
                        style={SMALL_CHECK_STYLE}
                        name="ce-region-city"
                        value={city}
                        checked={checked}
                        onChange={(e) => handleCityToggle(city, e.currentTarget.checked)}
                      />
                      <span>{lt(city, city)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <div id="ce-region-cities" ref={citiesRef}></div>
          )}
        </div>
      </div>

      {/* 地點 */}
      <div class="ce-row">
        <div class="ce-label-row">
          {renderInfoBtn('location')}
          <label for="ce-location">{lt('地點')}</label>{' '}
          <span class="required">{lt('*必填')}</span>
        </div>
        <input
          type="text"
          id="ce-location"
          placeholder={lt('例：台北市大安運動中心')}
          value={state.location}
          onInput={(e) => onPatch({ location: e.currentTarget.value })}
        />
        <div class="event-location-control" data-prefix="ce">
          <div class="event-location-state-row">
            <span
              id="ce-location-status"
              class="event-location-status"
              data-state={location.statusState}
            >
              {location.statusText}
            </span>
            <button
              type="button"
              id="ce-location-btn"
              class={`outline-btn small${location.buttonLooksDisabled ? ' event-location-btn-disabled' : ''}`}
              aria-disabled={location.buttonLooksDisabled ? 'true' : undefined}
              disabled={location.buttonDisabled}
              onClick={location.onOpenPicker}
            >
              {location.buttonText}
            </button>
          </div>
          <div id="ce-location-summary" class="event-location-summary">{location.summary}</div>
          <button
            type="button"
            id="ce-location-clear"
            class="event-location-clear"
            style={location.showClear ? {} : { display: 'none' }}
            onClick={location.onClear}
          >
            {lt('清除定位')}
          </button>
        </div>
      </div>

      {/* 活動時間 */}
      <div class="ce-row">
        <div class="ce-label-row">
          {renderInfoBtn('time')}
          <label>{lt('活動時間')}</label>{' '}
          <span class="required">{lt('*必填')}</span>
        </div>
        <div class="ce-time-row">
          <label class="ce-time-field ce-time-field-date">
            <span class="ce-time-field-label">{lt('活動日期')}</span>
            <input
              type="date"
              id="ce-date"
              class="ce-time-date"
              placeholder={lt('選擇日期')}
              value={state.dateVal}
              onInput={(e) => onPatch({ dateVal: e.currentTarget.value })}
            />
          </label>
          <label class="ce-time-field ce-time-field-start">
            <span class="ce-time-field-label">{lt('開始時間')}</span>
            <input
              type="time"
              id="ce-time-start"
              class="ce-time-clock ce-time-start"
              step={1800}
              placeholder={lt('開始')}
              value={state.startTime}
              onInput={(e) => onPatch({ startTime: e.currentTarget.value })}
            />
          </label>
          <span class="ce-time-separator">~</span>
          <label class="ce-time-field ce-time-field-end">
            <span class="ce-time-field-label">{lt('結束時間')}</span>
            <input
              type="time"
              id="ce-time-end"
              class="ce-time-clock ce-time-end"
              step={1800}
              placeholder={lt('結束')}
              value={state.endTime}
              onInput={(e) => onPatch({ endTime: e.currentTarget.value })}
            />
          </label>
        </div>
        <div id="ce-time-summary" class="ce-time-summary" aria-live="polite">
          {timeSummaryText}
        </div>
        <div id="ce-multi-date-area" style={{ display: 'none' }}>
          <div id="ce-multi-date-tags" class="ce-multi-date-tags"></div>
          <div id="ce-multi-date-count" class="ce-multi-date-count"></div>
        </div>
      </div>

      {/* 開放報名時間 */}
      <div class="ce-row">
        <div class="ce-label-row">
          {renderInfoBtn('regOpen')}
          <label for="ce-reg-open-enabled">{lt('開放報名時間')}</label>
        </div>
        <div class="ce-toggle-control ce-reg-open-toggle-control">
          <label class="toggle-switch" style={{ margin: 0 }}>
            <input
              type="checkbox"
              id="ce-reg-open-enabled"
              checked={state.regOpenEnabled}
              onChange={(e) => {
                const enabled = e.currentTarget.checked;
                if (enabled) {
                  onPatch({ regOpenEnabled: true });
                } else {
                  // 照 A _handleEventRegOpenToggle：關閉時清空開放日期與時間。
                  onPatch({ regOpenEnabled: false, regOpenDate: '', regOpenClock: '' });
                }
              }}
            />
            <span class="toggle-slider"></span>
          </label>
          <span
            id="ce-reg-open-enabled-label"
            class="ce-toggle-status"
            style={{ color: state.regOpenEnabled ? 'var(--accent)' : 'var(--text-muted)' }}
          >
            {state.regOpenEnabled ? lt('指定開放時間') : lt('立即開放報名')}
          </span>
        </div>
        <div id="ce-reg-open-fields" class="ce-reg-open-fields" hidden={!state.regOpenEnabled}>
          <div
            id="ce-reg-open-absolute"
            class="ce-reg-open-row"
            style={{ display: state.regOpenEnabled ? undefined : 'none' }}
          >
            <label class="ce-time-field ce-reg-open-field">
              <span class="ce-time-field-label">{lt('開放日期')}</span>
              <input
                type="date"
                id="ce-reg-open-date"
                class="ce-reg-open-date"
                placeholder={lt('報名開放日期')}
                disabled={!state.regOpenEnabled}
                value={state.regOpenDate}
                onInput={(e) => onPatch({ regOpenDate: e.currentTarget.value })}
              />
            </label>
            <label class="ce-time-field ce-reg-open-field">
              <span class="ce-time-field-label">{lt('開放時間')}</span>
              <input
                type="time"
                id="ce-reg-open-clock"
                class="ce-reg-open-clock"
                step={1800}
                placeholder={lt('報名開放時間')}
                disabled={!state.regOpenEnabled}
                value={state.regOpenClock}
                onInput={(e) => onPatch({ regOpenClock: e.currentTarget.value })}
              />
            </label>
          </div>
          <div id="ce-reg-open-relative" class="ce-reg-open-relative" style={{ display: 'none' }}>
            <span class="ce-reg-rel-label">{lt('活動開始前')}</span>
            <select id="ce-reg-rel-days" class="ce-reg-rel-select"></select>
            <span>{lt('日')}</span>
            <select id="ce-reg-rel-hours" class="ce-reg-rel-select"></select>
            <span>{lt('時')}</span>
          </div>
        </div>
        <div id="ce-reg-open-summary" class="ce-time-summary ce-time-summary-muted" aria-live="polite">
          {regOpenSummaryText}
        </div>
        <div id="ce-reg-open-hint" class="ce-reg-open-hint">{regOpenHint}</div>
        <div id="ce-reg-open-early-bird-hint" class="ce-early-bird-reg-hint">
          {lt('如需在正式開放前提供早鳥報名，請到「進階功能」開啟早鳥報名並設定消耗積分。')}
        </div>
      </div>

      {/* 第 2 段：進階功能（ce-value-section） */}

      {/* 人數上限 */}
      <div class="ce-row">
        <div class="ce-label-row">
          {renderInfoBtn('max')}
          <label for="ce-max">{lt('人數上限')}</label>{' '}
          <span class="required">{lt('*必填')}</span>
        </div>
        <input
          type="number"
          id="ce-max"
          placeholder="20"
          value={state.max}
          onInput={(e) => onPatch({ max: e.currentTarget.value })}
        />
      </div>
      <input type="hidden" id="ce-waitlist" value="0" />

      {/* 年齡限制 */}
      <div class="ce-row">
        <div class="ce-label-row">
          {renderInfoBtn('age')}
          <label for="ce-age-limit-enabled">{lt('年齡限制')}</label>
          {lt('（歲以上，0 為不限）')}
        </div>
        <div class="ce-age-limit-wrap">
          <div class="ce-age-limit-header">
            <label class="toggle-switch" style={{ margin: 0 }}>
              <input
                type="checkbox"
                id="ce-age-limit-enabled"
                aria-controls="ce-min-age-wrap"
                checked={state.ageLimitEnabled}
                onChange={(e) => {
                  const checked = e.currentTarget.checked;
                  onPatch({
                    ageLimitEnabled: checked,
                    minAge: checked ? state.minAge : '0',
                  });
                }}
              />
              <span class="toggle-slider"></span>
            </label>
            <span id="ce-age-limit-label" class="ce-toggle-status" style={{ color: ageLabelColor }}>
              {ageLabelText}
            </span>
          </div>
          <div
            id="ce-min-age-wrap"
            class="ce-age-limit-input-wrap"
            style={{ display: state.ageLimitEnabled ? undefined : 'none' }}
          >
            <input
              type="number"
              id="ce-min-age"
              placeholder="0"
              min={0}
              inputMode="numeric"
              disabled={!state.ageLimitEnabled}
              value={state.ageLimitEnabled ? state.minAge : '0'}
              onInput={(e) => onPatch({ minAge: e.currentTarget.value })}
            />
          </div>
          <div class="ce-field-note">{lt('開啟後填寫最低年齡；關閉送出 0 表示不限。')}</div>
        </div>
      </div>

      {/* 委託人 */}
      <div class="ce-row">
        <div class="ce-label-row">
          {renderInfoBtn('delegate')}
          <label for="ce-delegate-search">{lt('委託人')}</label>
          {lt('（最多 3 人）')}
        </div>
        <div class="ce-delegate-wrap">
          <div class="ce-delegate-tags" id="ce-delegate-tags">
            {delegates.chips.map((chip) => (
              <span class="ce-delegate-tag" key={chip.uid}>
                <UserTag
                  uid={chip.uid}
                  name={chip.name}
                  role={toUserRole(chip.role)}
                  // 名片功能由 EventFormModal/頁面承接；純顯示元件給 noop。
                  onOpenProfile={() => undefined}
                />
                {delegates.canManage && (
                  <span
                    class="ce-delegate-remove"
                    role="button"
                    tabIndex={0}
                    aria-label={lt('移除委託人')}
                    onClick={() => delegates.onRemove(chip.uid)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        delegates.onRemove(chip.uid);
                      }
                    }}
                  >
                    ✕
                  </span>
                )}
              </span>
            ))}
          </div>
          <input
            type="text"
            id="ce-delegate-search"
            placeholder={delegates.placeholder}
            autocomplete="off"
            disabled={delegates.inputDisabled}
            value={delegates.query}
            onInput={(e) => delegates.onQuery(e.currentTarget.value)}
            onFocus={delegates.onFocus}
          />
          <div
            class={`ce-delegate-dropdown${delegates.dropdownOpen ? ' open' : ''}`}
            id="ce-delegate-dropdown"
          >
            {delegates.dropdownOpen && delegates.results.length === 0 && (
              <div style={{ padding: '.4rem .6rem', fontSize: '.78rem', color: 'var(--text-muted)' }}>
                {lt('找不到符合的用戶')}
              </div>
            )}
            {delegates.dropdownOpen && delegates.results.map((chip) => {
              const roleLabel = roleLabelOf(chip.role) ?? chip.role;
              return (
                <div
                  class="ce-delegate-item"
                  key={chip.uid}
                  data-uid={chip.uid}
                  data-name={chip.name}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    delegates.onPick(chip.uid);
                  }}
                >
                  <span class="ce-delegate-item-name">{chip.name}</span>
                  <span class="ce-delegate-item-meta">
                    {[chip.uid, roleLabel].filter(Boolean).join(' · ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 注意事項 */}
      <div class="ce-row">
        <div class="ce-label-row">
          {renderInfoBtn('notes')}
          <label for="ce-notes">{lt('注意事項')}</label>
          {lt('（上限 500 字）')}
        </div>
        <textarea
          id="ce-notes"
          rows={3}
          maxLength={500}
          placeholder={lt('例如：請自備球鞋、飲用水，遲到15分鐘以上視為缺席...')}
          value={state.notes}
          onInput={(e) => onPatch({ notes: e.currentTarget.value })}
        />
      </div>

      {/* 運動 / 場景標籤 */}
      <div class="ce-row">
        <div class="ce-label-row">
          {renderInfoBtn('sport')}
          <label for="ce-sport-selected">{lt('運動 / 場景標籤')}</label>{' '}
          <span class="required">{lt('*必選')}</span>
        </div>
        <div class="ce-sport-picker" id="ce-sport-picker" ref={sportPickerRef}>
          <button
            type="button"
            class={`ce-sport-selected${sportDropdownOpen ? ' open' : ''}`}
            id="ce-sport-selected"
            aria-haspopup="listbox"
            aria-expanded={sportDropdownOpen}
            onClick={() => setSportDropdownOpen((v) => !v)}
          >
            <span class="ce-sport-selected-inner" id="ce-sport-selected-inner">
              {selectedSport ? (
                <span class="ce-sport-value">
                  <span class="sport-emoji" aria-hidden="true">{selectedSport.symbol}</span>
                  <span>{lt(selectedSport.label, selectedSport.label)}</span>
                </span>
              ) : (
                <span class="ce-sport-placeholder">{lt('請選擇運動 / 場景標籤')}</span>
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
                <path d="M6 9l6 6 6-6"></path>
              </svg>
            </span>
          </button>
          <div
            class={`ce-sport-dropdown${sportDropdownOpen ? ' open' : ''}`}
            id="ce-sport-dropdown"
          >
            <input
              type="text"
              id="ce-sport-search"
              class="ce-sport-search"
              placeholder={lt('搜尋運動 / 場景標籤')}
              value={sportSearch}
              onInput={(e) => setSportSearch(e.currentTarget.value)}
            />
            <div id="ce-sport-list" class="ce-sport-list" role="listbox">
              {filteredSports.length === 0 ? (
                <div class="ce-sport-empty">{lt('找不到符合的運動')}</div>
              ) : (
                filteredSports.map((item) => {
                  const isActive = item.sportTag === state.sportTag;
                  return (
                    <button
                      type="button"
                      key={item.key}
                      class={`ce-sport-option${isActive ? ' active' : ''}`}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        onPatch({ sportTag: item.sportTag });
                        setSportDropdownOpen(false);
                      }}
                    >
                      <span class="sport-emoji" aria-hidden="true">{item.symbol}</span>
                      <span>{lt(item.label, item.label)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <input type="hidden" id="ce-sport-tag" value={state.sportTag} />
        </div>
        <div class="ce-sport-required-tip">
          {lt('* 必選，未選擇運動 / 場景標籤將無法儲存活動')}
        </div>
      </div>

      {/* 第 3 段：儲存為範本（ce-template-name） */}

      <CeInfoDialog infoKey={activeInfoKey} onClose={handleCloseInfo} />
    </div>
  );
}
