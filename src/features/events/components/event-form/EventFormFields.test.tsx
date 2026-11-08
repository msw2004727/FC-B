import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { EventFormFields } from './EventFormFields';
import { createDefaultFormState, type EventFormState } from '../../data/event-form-model';
import { formatTaipei } from '@/core/taipei-time';
import type { CoverUploadView, DelegatePickerView, LocationControlView } from './form-types';

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
});

afterEach(() => {
  cleanup();
});

function makeCover(previewUrl = ''): CoverUploadView {
  return { previewUrl, onPickFile: vi.fn() };
}

function makeLocation(): LocationControlView {
  return {
    statusText: '尚未設定地圖座標',
    statusState: 'empty',
    buttonText: '設定地圖座標',
    buttonDisabled: false,
    buttonLooksDisabled: false,
    summary: '',
    showClear: false,
    onOpenPicker: vi.fn(),
    onClear: vi.fn(),
  };
}

function makeDelegates(): DelegatePickerView {
  return {
    chips: [],
    canManage: true,
    query: '',
    results: [],
    dropdownOpen: false,
    dropdownStatus: '',
    placeholder: '搜尋用戶...',
    inputDisabled: false,
    onQuery: vi.fn(),
    onFocus: vi.fn(),
    onPick: vi.fn(),
    onRemove: vi.fn(),
  };
}

function renderFields(overrides: Partial<Parameters<typeof EventFormFields>[0]> = {}) {
  const props: Parameters<typeof EventFormFields>[0] = {
    mode: 'create',
    state: createDefaultFormState(),
    onPatch: vi.fn(),
    titleLimit: 16,
    canToggleRegion: true,
    cover: makeCover(),
    location: makeLocation(),
    delegates: makeDelegates(),
    ...overrides,
  };
  return { props, ...render(<EventFormFields {...props} />) };
}

describe('EventFormFields', () => {
  it('非管理員不輸出 ce-region-toggle-row；管理員有', () => {
    const first = renderFields({ canToggleRegion: false });
    expect(document.querySelector('#ce-region-toggle-row')).toBeNull();
    first.unmount();
    cleanup();

    renderFields({ canToggleRegion: true });
    expect(document.querySelector('#ce-region-toggle-row')).not.toBeNull();
  });

  it('各列順序照 A：範本 → 封面 → 名稱 → 類型 → 地區 → 地點 → 時間 → 開放報名 → 人數 → 年齡 → 委託人 → 注意事項 → 運動', () => {
    renderFields();
    const expectedIds = [
      'ce-template-area',
      'ce-upload-area',
      'ce-title',
      'ce-type',
      'ce-region-row',
      'ce-location',
      'ce-date',
      'ce-reg-open-enabled',
      'ce-max',
      'ce-age-limit-enabled',
      'ce-delegate-search',
      'ce-notes',
      'ce-sport-picker',
    ];
    const elements = expectedIds.map((id) => document.getElementById(id));
    for (const el of elements) expect(el).not.toBeNull();
    for (let i = 1; i < elements.length; i += 1) {
      const prev = elements[i - 1]!;
      const next = elements[i]!;
      const rel = prev.compareDocumentPosition(next);
      expect(Boolean(rel & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    }
  });

  it('多日期時報名開放摘要照 A：每場活動開始前 N 日 M 小時 開放（PM 補測）', () => {
    const multiDate = { dates: ['2026-11-01', '2026-11-08'], isMultiDate: true, countText: '已選 2 個日期（上限 30）', onRemove: vi.fn() };
    renderFields({ multiDate, state: { ...createDefaultFormState(), regOpenEnabled: true, regRelDays: '1', regRelHours: '3' } });
    expect(document.querySelector('#ce-reg-open-summary')?.textContent).toBe('報名開放：每場活動開始前 1 日 3 小時 開放');
    cleanup();
    renderFields({ multiDate, state: { ...createDefaultFormState(), regOpenEnabled: true } });
    expect(document.querySelector('#ce-reg-open-summary')?.textContent).toBe('報名開放：未指定提前時間，建立後立即開放報名');
  });

  it('開放報名開關關閉時 onPatch 收到清空日期與時間', () => {
    const onPatch = vi.fn();
    const state: EventFormState = {
      ...createDefaultFormState(),
      regOpenEnabled: true,
      regOpenDate: '2030-01-01',
      regOpenClock: '10:00',
    };
    renderFields({ state, onPatch });
    const toggle = document.getElementById('ce-reg-open-enabled') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(onPatch).toHaveBeenCalledWith({
      regOpenEnabled: false,
      regOpenDate: '',
      regOpenClock: '',
      // 測試同步更新：照 A _handleEventRegOpenToggle 關閉時相對天／時也歸 0（第 3 段）。
      regRelDays: '0',
      regRelHours: '0',
    });
  });

  it('? 開出對應 CE_INFO 標題（地點 →「活動地點」），點「了解」關閉', () => {
    renderFields();
    expect(document.querySelectorAll('.edu-info-btn')).toHaveLength(14);
    // ASSUMPTION: 地點輸入與其說明按鈕維持在同一個 .ce-row，以欄位鍵定位。
    const locationRow = document.getElementById('ce-location')?.closest('.ce-row');
    const buttons = locationRow?.querySelectorAll<HTMLButtonElement>('.edu-info-btn');
    expect(buttons).toHaveLength(1);
    const locationInfo = locationRow?.querySelector<HTMLButtonElement>('.edu-info-btn');
    if (!locationInfo) throw new Error('缺少活動地點說明按鈕');
    fireEvent.click(locationInfo);
    const title = document.querySelector('.edu-info-dialog-title');
    expect(title?.textContent).toBe('活動地點');
    const closeBtn = document.querySelector('.edu-info-dialog .primary-btn') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn);
    expect(document.querySelector('.edu-info-dialog')).toBeNull();
  });

  it('封面 previewUrl 有值時出現 has-image 與 <img>', () => {
    renderFields({ cover: makeCover('https://example.com/x.png') });
    const preview = document.getElementById('ce-upload-preview');
    expect(preview?.classList.contains('has-image')).toBe(true);
    const img = preview?.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.com/x.png');
  });

  it('封面選檔呼叫 onPickFile', () => {
    const onPickFile = vi.fn();
    renderFields({ cover: { previewUrl: '', onPickFile } });
    const input = document.getElementById('ce-image') as HTMLInputElement;
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent(input, new Event('change', { bubbles: true }));
    expect(onPickFile).toHaveBeenCalledWith(file);
  });

  it('委託人 canManage=false 時輸入停用、沒有 ✕', () => {
    renderFields({
      delegates: {
        ...makeDelegates(),
        canManage: false,
        inputDisabled: true,
        chips: [{ uid: 'u1', name: 'Alice', role: 'user' }],
      },
    });
    const input = document.getElementById('ce-delegate-search') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(document.querySelector('.ce-delegate-remove')).toBeNull();
  });

  it('委託人 canManage=true 時 ✕ 呼叫 onRemove', () => {
    const onRemove = vi.fn();
    renderFields({
      delegates: {
        ...makeDelegates(),
        canManage: true,
        onRemove,
        chips: [{ uid: 'u1', name: 'Alice', role: 'user' }],
      },
    });
    const removeBtn = document.querySelector('.ce-delegate-remove') as HTMLElement | null;
    expect(removeBtn).not.toBeNull();
    fireEvent.click(removeBtn!);
    expect(onRemove).toHaveBeenCalledWith('u1');
  });

  it('state.type === "friendly" 時下拉多一個友誼選項', () => {
    const state: EventFormState = { ...createDefaultFormState(), type: 'friendly' };
    renderFields({ state });
    const select = document.getElementById('ce-type') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('friendly');
    expect(select.value).toBe('friendly');
  });
});

describe('團隊預留自動釋出列', () => {
  const NOW = Date.parse('2026-06-01T10:00:00+08:00');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const select = (): HTMLSelectElement => document.getElementById('ce-team-release-hours') as HTMLSelectElement;
  const note = (): Element | null => document.getElementById('ce-team-release-note');

  it('放在人數上限下面；選項與預設 12、時間充裕不顯示提示', () => {
    renderFields({ state: { ...createDefaultFormState(), dateVal: '2026-06-05' } });
    const max = document.getElementById('ce-max')!;
    expect(Boolean(max.compareDocumentPosition(select()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Array.from(select().options).map(option => option.textContent)).toEqual([
      '不自動釋出', '開始前 3 小時', '開始前 6 小時', '開始前 12 小時', '開始前 24 小時', '開始前 48 小時', '開始前 72 小時',
    ]);
    expect(select().value).toBe('12');
    expect(select().disabled).toBe(false);
    expect(note()).toBeNull();
  });

  it('剩 11 小時自動降到 6；不足 3 小時落到不自動釋出', () => {
    renderFields({ state: { ...createDefaultFormState(), dateVal: '2026-06-01', startTime: '21:00' } });
    expect(select().value).toBe('6');
    expect(note()?.textContent).toBe('距開始剩 11 小時，已改為開始前 6 小時');
    cleanup();
    renderFields({ state: { ...createDefaultFormState(), dateVal: '2026-06-01', startTime: '12:00' } });
    expect(select().value).toBe('0');
    expect(note()?.textContent).toBe('距開始不足 3 小時，預設不自動釋出');
  });

  it('手動選擇送出 hours 並標記非自動；手動超過剩餘時間顯示 warning', () => {
    const startMs = NOW + 5 * 3_600_000 + 10 * 60_000;
    const onPatch = vi.fn();
    const state = {
      ...createDefaultFormState(),
      dateVal: formatTaipei(startMs, 'YYYY-MM-DD'),
      startTime: formatTaipei(startMs, 'HH:mm'),
    };
    renderFields({ state, onPatch });
    // preact testing-library 的 fireEvent.change 在 compat 下會改送 input；select 需原生 change（同 use-team-reservation.test）。
    select().value = '12';
    fireEvent(select(), new Event('change', { bubbles: true }));
    expect(onPatch).toHaveBeenCalledWith({ teamReservationReleaseHours: 12, teamReservationReleaseAuto: false });
    cleanup();
    renderFields({ state: { ...state, teamReservationReleaseHours: 12, teamReservationReleaseAuto: false } });
    expect(select().value).toBe('12');
    expect(note()?.textContent).toBe('距開始已不足 12 小時，儲存後會立即釋出');
    expect((note() as HTMLElement).style.color).toBe('var(--warning)');
  });

  it('編輯舊活動顯示不自動釋出；已釋出時鎖住並說明', () => {
    renderFields({
      mode: 'edit',
      state: { ...createDefaultFormState(), eventId: 'e1', dateVal: '2026-06-01', startTime: '21:00', teamReservationReleaseHours: 0, teamReservationReleaseAuto: false },
    });
    expect(select().value).toBe('0');
    expect(note()).toBeNull();
    cleanup();
    renderFields({
      mode: 'edit',
      state: {
        ...createDefaultFormState(),
        eventId: 'e2',
        dateVal: '2026-06-01',
        startTime: '21:00',
        teamReservationReleaseHours: 12,
        teamReservationReleaseAuto: false,
        teamReservationReleased: true,
      },
    });
    expect(select().disabled).toBe(true);
    expect(select().value).toBe('12');
    expect(note()?.textContent).toBe('已釋出（每場只執行一次；之後手動預留不會再自動釋出）');
  });
});
