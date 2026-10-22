import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { EventFormFields } from './EventFormFields';
import { createDefaultFormState, type EventFormState } from '../../data/event-form-model';
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

  it('各列順序照 A：封面 → 名稱 → 類型 → 地區 → 地點 → 時間 → 開放報名 → 人數 → 年齡 → 委託人 → 注意事項 → 運動', () => {
    renderFields();
    const expectedIds = [
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
    });
  });

  it('? 開出對應 CE_INFO 標題（地點 →「活動地點」），點「了解」關閉', () => {
    renderFields();
    const btns = document.querySelectorAll<HTMLButtonElement>('.edu-info-btn');
    // 順序：title, type, region, location, time, regOpen, max, age, delegate, notes, sport
    expect(btns.length).toBe(11);
    fireEvent.click(btns[3]!);
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
