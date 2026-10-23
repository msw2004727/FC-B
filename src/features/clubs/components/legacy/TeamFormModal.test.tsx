/**
 * TeamFormModal 畫面契約。
 * DOM 對照 A pages/team.html 建立俱樂部表單（.grok-input/A-team-form.html）。
 * hook 以假 TeamFormApi 取代，不碰寫入、權限或 Firestore。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { JSX } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pushOverlay } from '@/core/overlay-back';
import { lockBody } from '@/ui/Modal';
import { getToasts, toast } from '@/ui/Toast';

import { TEAM_CATEGORY_OPTIONS } from '../../data/team-form-model';
import type { TeamFormValues } from '../../data/team-form-model';
import type { StaffPickerApi } from './use-team-staff-picker';
import type { TeamFormApi, TeamFormProps } from './use-team-form';
import { useTeamForm } from './use-team-form';
import { TeamFormModal } from './TeamFormModal';

vi.mock('./use-team-form', () => ({
  useTeamForm: vi.fn(),
}));
vi.mock('@/ui/Modal', () => ({
  lockBody: vi.fn(() => vi.fn()),
}));
vi.mock('@/core/overlay-back', () => ({
  pushOverlay: vi.fn(() => vi.fn()),
}));
vi.mock('@/i18n/i18n', () => ({
  useLegacyT: () => (key: string, fallback?: string): string => fallback ?? key,
}));

const useTeamFormMock = vi.mocked(useTeamForm);
const lockMock = vi.mocked(lockBody);
const overlayMock = vi.mocked(pushOverlay);
const release = vi.fn();
const unlock = vi.fn();
const onClose = vi.fn();
const onSaved = vi.fn();

const FIELD_LABELS = [
  '俱樂部封面',
  '俱樂部標籤',
  '學員招募狀態',
  '運動類型 *必填',
  '俱樂部名稱（最多 15 字） *必填',
  '英文名稱',
  '國籍',
  '地區 *必填',
  '創立年份',
  '俱樂部經理 *必填',
  '俱樂部領隊 *必填',
  '聯繫方式',
  '社群聯繫按鈕',
  '教練（可多位）',
  '俱樂部簡介',
];

function makePicker(overrides: Partial<StaffPickerApi> = {}): StaffPickerApi {
  return {
    query: '',
    setQuery: vi.fn(),
    suggestions: [],
    pick: vi.fn(async () => null),
    verifying: false,
    ...overrides,
  };
}

function makeValues(overrides: Partial<TeamFormValues> = {}): TeamFormValues {
  return {
    type: 'competitive',
    sportTag: '',
    name: '',
    nameEn: '',
    nationality: '台灣',
    region: '',
    founded: '',
    contact: '',
    bio: '',
    eduAccepting: true,
    contactLinksEnabled: false,
    contactLinkDrafts: [],
    captain: { uid: 'me', name: '創立者' },
    leaders: [],
    coaches: [],
    unresolvedLeaderNames: [],
    unresolvedCoachNames: [],
    unresolvedCaptainName: '',
    ...overrides,
  };
}

function makeApi(overrides: Partial<TeamFormApi> = {}): TeamFormApi {
  const mode = overrides.mode ?? 'create';
  const create = mode === 'create';
  const values = makeValues();
  const region: TeamFormApi['region'] = {
    suggestions: [],
    open: false,
    onFocus: vi.fn(),
    onInput: vi.fn(),
    onBlur: vi.fn(),
    pick: vi.fn(),
  };
  const contactLinks: TeamFormApi['contactLinks'] = {
    drafts: [],
    setEnabled: vi.fn(),
    setDraft: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    canAdd: true,
    previews: [],
  };
  const captain: TeamFormApi['captain'] = {
    displayText: create ? '俱樂部經理（創立者）：創立者' : '目前俱樂部經理：原經理',
    lockedText: create ? '（創立者自動成為俱樂部經理）' : null,
    transferVisible: !create,
    transferPicker: makePicker(),
    selected: create ? { uid: 'me', name: '創立者' } : { uid: 'cap', name: '原經理' },
    pendingName: null,
    select: vi.fn(async () => undefined),
    clear: vi.fn(),
  };
  const leaders: TeamFormApi['leaders'] = {
    tags: [],
    picker: makePicker(),
    add: vi.fn(async () => undefined),
    remove: vi.fn(),
  };
  const coaches: TeamFormApi['coaches'] = {
    allowed: true,
    tags: [],
    picker: makePicker(),
    add: vi.fn(async () => undefined),
    remove: vi.fn(),
  };
  const image: TeamFormApi['image'] = {
    previewUrl: null,
    hasNew: false,
    pickFile: vi.fn(async () => undefined),
    cropper: null,
  };
  const api: TeamFormApi = {
    mode,
    title: create ? '新增俱樂部' : '編輯俱樂部',
    submitLabel: create ? '建立俱樂部' : '儲存變更',
    busyLabel: create ? '建立中...' : '儲存中...',
    values,
    setValue: vi.fn(),
    categoryOptions: TEAM_CATEGORY_OPTIONS,
    categoryHint: '競技標籤只作為俱樂部分類，賽事系統設定已預留。',
    showEduSettings: false,
    sportOptions: [
      { key: '', label: '未指定' },
      { key: 'football', label: '⚽ 足球' },
      { key: 'basketball', label: '🏀 籃球' },
    ],
    region,
    contactLinks,
    captain,
    leaders,
    coaches,
    image,
    busy: false,
    canSubmit: true,
    submit: vi.fn(async () => undefined),
  };
  return {
    ...api,
    ...overrides,
    mode,
    values: { ...api.values, ...overrides.values },
    region: { ...api.region, ...overrides.region },
    contactLinks: { ...api.contactLinks, ...overrides.contactLinks },
    captain: {
      ...api.captain,
      ...overrides.captain,
      transferPicker: {
        ...api.captain.transferPicker,
        ...overrides.captain?.transferPicker,
      },
    },
    leaders: {
      ...api.leaders,
      ...overrides.leaders,
      picker: { ...api.leaders.picker, ...overrides.leaders?.picker },
    },
    coaches: {
      ...api.coaches,
      ...overrides.coaches,
      picker: { ...api.coaches.picker, ...overrides.coaches?.picker },
    },
    image: { ...api.image, ...overrides.image },
  };
}

function formProps(api: TeamFormApi, open = true): TeamFormProps & { open: boolean } {
  return {
    open,
    mode: api.mode,
    viewer: {
      uid: 'me',
      displayName: '創立者',
      hasPermission: () => false,
    },
    onClose,
    onSaved,
  };
}

function renderModal(
  overrides: Partial<TeamFormApi> = {},
  open = true,
): { api: TeamFormApi; props: TeamFormProps & { open: boolean } } {
  const api = makeApi(overrides);
  useTeamFormMock.mockReturnValue(api);
  const props = formProps(api, open);
  render(<TeamFormModal {...props} />);
  return { api, props };
}

function visibleLabels(): string[] {
  return Array.from(document.querySelectorAll<HTMLLabelElement>('#create-team-modal label'))
    .filter((label) => {
      let node: HTMLElement | null = label;
      while (node && node.id !== 'create-team-modal') {
        if (node.style.display === 'none') return false;
        node = node.parentElement;
      }
      return (label.textContent ?? '').replace(/\s+/g, ' ').trim().length > 0;
    })
    .map((label) => (label.textContent ?? '').replace(/\s+/g, ' ').trim());
}

function setNativeValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
}

beforeEach(() => {
  release.mockReset();
  unlock.mockReset();
  onClose.mockReset();
  onSaved.mockReset();
  useTeamFormMock.mockReset();
  lockMock.mockReset();
  overlayMock.mockReset();
  lockMock.mockReturnValue(unlock);
  overlayMock.mockReturnValue(release);
});

afterEach(() => {
  toast.clear();
  cleanup();
});

describe('TeamFormModal', () => {
  it('教學模式依序顯示 15 個欄位標籤，label 的 for 都對得到控制項', () => {
    renderModal({
      showEduSettings: true,
      values: makeValues({ type: 'education' }),
      categoryHint: '教學標籤會啟用課程、學員與待審核功能。',
    });

    expect(visibleLabels()).toEqual(FIELD_LABELS);
    const labels = Array.from(
      document.querySelectorAll<HTMLLabelElement>('#create-team-modal label[for]'),
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const id = label.getAttribute('for');
      expect(id).toBeTruthy();
      expect(document.getElementById(id ?? '')).not.toBeNull();
    }
  });

  it('非教學不顯示學員招募；教學顯示開關、說明，並反映 eduAccepting', () => {
    const hidden = renderModal({ showEduSettings: false });
    expect(document.getElementById('ct-edu-settings')).toBeNull();
    expect(visibleLabels()).not.toContain('學員招募狀態');
    cleanup();

    renderModal({
      showEduSettings: true,
      values: makeValues({ type: 'education', eduAccepting: false }),
    });
    const box = document.getElementById('ct-edu-accepting');
    if (!(box instanceof HTMLInputElement)) throw new Error('找不到招募開關');
    expect(box.checked).toBe(false);
    expect(screen.getByText('接受新學員報名')).toBeTruthy();
    expect(screen.getByText(/已報名學員不受影響/)).toBeTruthy();
    expect(hidden.api.values.eduAccepting).toBe(true);
  });

  it('教學開關用原生 change 寫入 eduAccepting', () => {
    const { api } = renderModal({
      showEduSettings: true,
      values: makeValues({ type: 'education', eduAccepting: true }),
    });
    const box = document.getElementById('ct-edu-accepting');
    if (!(box instanceof HTMLInputElement)) throw new Error('找不到招募開關');
    act(() => {
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(api.setValue).toHaveBeenCalledWith('eduAccepting', false);
  });

  it('四顆標籤照 A 的文字、aria-pressed 與 active，點擊寫入 type', () => {
    const { api } = renderModal({
      values: makeValues({ type: 'competitive' }),
      categoryHint: '競技標籤只作為俱樂部分類，賽事系統設定已預留。',
    });
    const group = document.getElementById('ct-team-type-tags');
    const buttons = Array.from(group?.querySelectorAll('button') ?? []);
    expect(buttons.map((button) => button.getAttribute('data-team-type-option'))).toEqual([
      'none', 'competitive', 'education', 'leisure',
    ]);
    expect(buttons.map((button) => button.textContent?.replace(/\s+/g, ''))).toEqual([
      '無不顯示標籤',
      '競技賽事與戰績分類',
      '教學啟用課程功能',
      '休閒休閒交流分類',
    ]);
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1]?.classList.contains('active')).toBe(true);
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('ct-team-type-hint')?.textContent).toContain('賽事系統設定已預留');
    buttons[2]?.click();
    expect(api.setValue).toHaveBeenCalledWith('type', 'education');
  });

  it('新增模式顯示創立者經理與鎖定文案，不顯示轉移區', () => {
    renderModal({ mode: 'create' });
    expect(document.getElementById('ct-captain-display')?.textContent).toBe('俱樂部經理（創立者）：創立者');
    expect(screen.getByText('（創立者自動成為俱樂部經理）')).toBeTruthy();
    expect(document.getElementById('ct-captain-transfer')).toBeNull();
    expect(document.getElementById('ct-captain-search')).toBeNull();
  });

  it('編輯可轉移時顯示警告、提示與搜尋，不顯示鎖定文案', () => {
    renderModal({
      mode: 'edit',
      captain: {
        displayText: '目前俱樂部經理：原經理',
        lockedText: null,
        transferVisible: true,
        transferPicker: makePicker(),
        selected: { uid: 'cap', name: '原經理' },
        pendingName: null,
        select: vi.fn(async () => undefined),
        clear: vi.fn(),
      },
    });
    expect(document.getElementById('ct-captain-display')?.textContent).toBe('目前俱樂部經理：原經理');
    expect(screen.getByText(/原經理可能失去此俱樂部管理權限/)).toBeTruthy();
    expect(screen.getByText(/未選擇新用戶則維持目前經理/)).toBeTruthy();
    expect(document.getElementById('ct-captain-search')).not.toBeNull();
    expect(screen.queryByText('（僅俱樂部經理或管理員可轉移經理職位）')).toBeNull();
    const locked = document.getElementById('ct-captain-locked') as HTMLElement;
    expect(locked.style.display).toBe('none');
  });

  it('編輯不可轉移時顯示鎖定文案，不顯示轉移區', () => {
    renderModal({
      mode: 'edit',
      captain: {
        displayText: '目前俱樂部經理：原經理',
        lockedText: '（僅俱樂部經理或管理員可轉移經理職位）',
        transferVisible: false,
        transferPicker: makePicker(),
        selected: { uid: 'cap', name: '原經理' },
        pendingName: null,
        select: vi.fn(async () => undefined),
        clear: vi.fn(),
      },
    });
    expect(screen.getByText('（僅俱樂部經理或管理員可轉移經理職位）')).toBeTruthy();
    expect(document.getElementById('ct-captain-transfer')).toBeNull();
  });

  it('待轉移經理以 chip 顯示，✕ 呼叫 clear', () => {
    const clear = vi.fn();
    renderModal({
      mode: 'edit',
      captain: {
        displayText: '目前俱樂部經理：原經理',
        lockedText: null,
        transferVisible: true,
        transferPicker: makePicker(),
        selected: { uid: 'next', name: '姓名-next' },
        pendingName: '姓名-next',
        select: vi.fn(async () => undefined),
        clear,
      },
    });
    const selected = document.getElementById('ct-captain-selected');
    expect(selected?.textContent).toContain('姓名-next');
    const remove = selected?.querySelector('.team-tag-x');
    if (!(remove instanceof HTMLButtonElement)) throw new Error('找不到清除鈕');
    fireEvent.click(remove);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('領隊 chips 含未連結姓名 title，✕ 呼叫 remove', () => {
    const remove = vi.fn();
    renderModal({
      leaders: {
        tags: [
          { key: 'uid:leader', uid: 'leader', name: '最新領隊' },
          { key: 'legacy:0', uid: null, name: '舊領隊' },
        ],
        picker: makePicker(),
        add: vi.fn(async () => undefined),
        remove,
      },
    });
    const tags = Array.from(document.querySelectorAll('#ct-leaders-tags .team-tag'));
    expect(tags.map((tag) => tag.textContent?.replace('✕', '').trim())).toEqual([
      '最新領隊', '舊領隊',
    ]);
    expect(tags[0]?.getAttribute('title')).toBeNull();
    expect(tags[1]?.getAttribute('title')).toBe('舊資料尚未連結用戶');
    const button = tags[1]?.querySelector('.team-tag-x');
    if (!(button instanceof HTMLButtonElement)) throw new Error('找不到領隊移除鈕');
    fireEvent.click(button);
    expect(remove).toHaveBeenCalledWith('legacy:0');
  });

  it('教練 chips 含未連結姓名 title，✕ 呼叫 remove', () => {
    const remove = vi.fn();
    renderModal({
      coaches: {
        allowed: true,
        tags: [{ key: 'legacy:0', uid: null, name: '舊教練' }],
        picker: makePicker(),
        add: vi.fn(async () => undefined),
        remove,
      },
    });
    const tag = document.querySelector('#ct-coach-tags .team-tag');
    expect(tag?.textContent).toContain('舊教練');
    expect(tag?.getAttribute('title')).toBe('舊資料尚未連結用戶');
    const button = tag?.querySelector('.team-tag-x');
    if (!(button instanceof HTMLButtonElement)) throw new Error('找不到教練移除鈕');
    fireEvent.click(button);
    expect(remove).toHaveBeenCalledWith('legacy:0');
  });

  it('領隊建議用 mousedown 加入，click 不加入，姓名與 UID 是文字節點', () => {
    const add = vi.fn(async () => undefined);
    renderModal({
      leaders: {
        tags: [],
        picker: makePicker({
          suggestions: [{
            uid: 'leader-1',
            name: '領隊甲',
            displayName: '領隊甲',
            pictureUrl: '',
            role: 'user',
          }],
        }),
        add,
        remove: vi.fn(),
      },
    });
    const item = document.querySelector('#ct-leader-suggest .team-user-suggest-item');
    if (!(item instanceof HTMLButtonElement)) throw new Error('找不到領隊建議');
    expect(item.querySelector('.tus-name')?.textContent).toBe('領隊甲');
    expect(item.querySelector('.tus-uid')?.textContent).toBe('leader-1');
    expect(item.closest('.team-user-suggest')?.classList.contains('show')).toBe(true);
    fireEvent.click(item);
    expect(add).not.toHaveBeenCalled();
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => {
      item.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(add).toHaveBeenCalledWith('leader-1');
  });

  it('經理建議用 mousedown 呼叫 select', () => {
    const select = vi.fn(async () => undefined);
    renderModal({
      mode: 'edit',
      captain: {
        displayText: '目前俱樂部經理：原經理',
        lockedText: null,
        transferVisible: true,
        transferPicker: makePicker({
          suggestions: [{
            uid: 'next',
            name: '姓名-next',
            displayName: '姓名-next',
            pictureUrl: '',
            role: 'user',
          }],
        }),
        selected: { uid: 'cap', name: '原經理' },
        pendingName: null,
        select,
        clear: vi.fn(),
      },
    });
    const item = document.querySelector('#ct-captain-suggest .team-user-suggest-item');
    if (!(item instanceof HTMLButtonElement)) throw new Error('找不到經理建議');
    fireEvent.click(item);
    expect(select).not.toHaveBeenCalled();
    fireEvent.mouseDown(item);
    expect(select).toHaveBeenCalledWith('next');
  });

  it('地區建議用 mousedown 選取並 preventDefault，click 不選', () => {
    const pick = vi.fn();
    renderModal({
      region: {
        suggestions: ['台北市', '新北市'],
        open: true,
        onFocus: vi.fn(),
        onInput: vi.fn(),
        onBlur: vi.fn(),
        pick,
      },
    });
    const list = document.getElementById('ct-team-region-suggest');
    expect(list?.classList.contains('show')).toBe(true);
    const item = list?.querySelector('.team-user-suggest-item');
    if (!(item instanceof HTMLButtonElement)) throw new Error('找不到地區建議');
    expect(item.textContent).toBe('台北市');
    fireEvent.click(item);
    expect(pick).not.toHaveBeenCalled();
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => {
      item.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(pick).toHaveBeenCalledWith('台北市');
  });

  it('地區聚焦、輸入、失焦轉給 hook', () => {
    const onFocus = vi.fn();
    const onInput = vi.fn();
    const onBlur = vi.fn();
    renderModal({
      region: {
        suggestions: [],
        open: false,
        onFocus,
        onInput,
        onBlur,
        pick: vi.fn(),
      },
      values: makeValues({ region: '台' }),
    });
    const input = document.getElementById('ct-team-region');
    if (!(input instanceof HTMLInputElement)) throw new Error('找不到地區欄');
    // preact/compat 把 onFocus／onBlur 對到 focusin／focusout。
    act(() => {
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    fireEvent.input(input, { target: { value: '台北' } });
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledWith('台北');
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('聯絡連結列顯示預覽；滿五列停用新增；只剩一列停用移除', () => {
    const { api } = renderModal({
      values: makeValues({ contactLinksEnabled: true }),
      contactLinks: {
        drafts: ['https://line.me/a', '', '', '', ''],
        setEnabled: vi.fn(),
        setDraft: vi.fn(),
        add: vi.fn(),
        remove: vi.fn(),
        canAdd: false,
        previews: [
          { platform: 'line', label: 'LINE' },
          null,
          null,
          null,
          null,
        ],
      },
    });
    const rows = document.querySelectorAll('#ct-contact-links-list .ce-social-link-row');
    expect(rows).toHaveLength(5);
    expect(rows[0]?.querySelector('.ce-social-link-preview')?.textContent).toContain('LINE');
    expect(rows[1]?.querySelector('.ce-social-link-empty')?.textContent).toBe('待判斷');
    const add = document.getElementById('ct-contact-links-add');
    if (!(add instanceof HTMLButtonElement)) throw new Error('找不到新增連結');
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    expect(api.contactLinks.add).not.toHaveBeenCalled();
    expect(screen.getByText(/最多 5 個/)).toBeTruthy();
    cleanup();

    const one = renderModal({
      values: makeValues({ contactLinksEnabled: true }),
      contactLinks: {
        drafts: ['https://line.me/a'],
        setEnabled: vi.fn(),
        setDraft: vi.fn(),
        add: vi.fn(),
        remove: vi.fn(),
        canAdd: true,
        previews: [{ platform: 'line', label: 'LINE' }],
      },
    });
    const remove = document.querySelector('.ce-social-link-remove');
    if (!(remove instanceof HTMLButtonElement)) throw new Error('找不到移除連結');
    expect(remove.disabled).toBe(true);
    fireEvent.click(remove);
    expect(one.api.contactLinks.remove).not.toHaveBeenCalled();
  });

  it('聯絡連結可新增、刪除、改草稿，開關切換文案與顯示', () => {
    const { api } = renderModal({
      values: makeValues({ contactLinksEnabled: true }),
      contactLinks: {
        drafts: ['https://line.me/a', ''],
        setEnabled: vi.fn(),
        setDraft: vi.fn(),
        add: vi.fn(),
        remove: vi.fn(),
        canAdd: true,
        previews: [{ platform: 'line', label: 'LINE' }, null],
      },
    });
    expect(document.getElementById('ct-contact-links-label')?.textContent).toBe('開啟');
    const options = document.getElementById('ct-contact-links-options') as HTMLElement;
    expect(options.style.display).not.toBe('none');
    fireEvent.click(document.getElementById('ct-contact-links-add') as HTMLButtonElement);
    expect(api.contactLinks.add).toHaveBeenCalledTimes(1);
    const removes = document.querySelectorAll('.ce-social-link-remove');
    fireEvent.click(removes[1] as HTMLButtonElement);
    expect(api.contactLinks.remove).toHaveBeenCalledWith(1);
    const draft = document.querySelector('.ce-social-link-input');
    if (!(draft instanceof HTMLInputElement)) throw new Error('找不到連結輸入');
    fireEvent.input(draft, { target: { value: 'https://fb.com/x' } });
    expect(api.contactLinks.setDraft).toHaveBeenCalledWith(0, 'https://fb.com/x');

    const toggle = document.getElementById('ct-contact-links-enabled');
    if (!(toggle instanceof HTMLInputElement)) throw new Error('找不到社群開關');
    act(() => {
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(api.contactLinks.setEnabled).toHaveBeenCalledWith(false);
    cleanup();

    renderModal({
      values: makeValues({ contactLinksEnabled: false }),
    });
    expect(document.getElementById('ct-contact-links-label')?.textContent).toBe('關閉');
    expect((document.getElementById('ct-contact-links-options') as HTMLElement).style.display).toBe('none');
  });

  it('取消與 ✕ 關閉；點遮罩與對話框不關閉', () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: '新增俱樂部' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('ct-team-modal-title');
    expect(dialog.getAttribute('data-no-backdrop-close')).toBe('1');
    expect(dialog.id).toBe('create-team-modal');

    fireEvent.click(document.querySelector('.modal-overlay') as HTMLElement);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('返回鍵關閉，卸載時釋放捲動鎖與 overlay', () => {
    const { props } = renderModal();
    expect(lockMock).toHaveBeenCalledWith(document.body);
    const onBack = overlayMock.mock.calls[0]?.[0];
    if (!onBack) throw new Error('沒有登記返回鍵');
    expect(onBack()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);

    cleanup();
    render(<TeamFormModal {...props} open={false} />);
    expect(release).toHaveBeenCalled();
    expect(unlock).toHaveBeenCalled();
    expect(document.getElementById('create-team-modal')).toBeNull();
  });

  it('Escape 關閉', () => {
    renderModal();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('新增與編輯的送出文字不同', () => {
    renderModal({ mode: 'create' });
    expect(document.getElementById('ct-team-save-btn')?.textContent).toBe('建立俱樂部');
    expect(document.getElementById('ct-team-modal-title')?.textContent).toBe('新增俱樂部');
    cleanup();
    renderModal({ mode: 'edit' });
    expect(document.getElementById('ct-team-save-btn')?.textContent).toBe('儲存變更');
    expect(document.getElementById('ct-team-modal-title')?.textContent).toBe('編輯俱樂部');
  });

  it('busy 顯示 busyLabel 並停用；無法送出時也停用，且不呼叫 submit', () => {
    const { api } = renderModal({ busy: true, canSubmit: true });
    const busyBtn = document.getElementById('ct-team-save-btn');
    if (!(busyBtn instanceof HTMLButtonElement)) throw new Error('找不到送出鈕');
    expect(busyBtn.textContent).toBe('建立中...');
    expect(busyBtn.disabled).toBe(true);
    fireEvent.click(busyBtn);
    expect(api.submit).not.toHaveBeenCalled();
    cleanup();

    const blocked = renderModal({ busy: false, canSubmit: false });
    const blockedBtn = document.getElementById('ct-team-save-btn');
    if (!(blockedBtn instanceof HTMLButtonElement)) throw new Error('找不到送出鈕');
    expect(blockedBtn.textContent).toBe('建立俱樂部');
    expect(blockedBtn.disabled).toBe(true);
    fireEvent.click(blockedBtn);
    expect(blocked.api.submit).not.toHaveBeenCalled();
  });

  it('可送出時點主按鈕呼叫 submit', () => {
    const { api } = renderModal({ busy: false, canSubmit: true });
    fireEvent.click(document.getElementById('ct-team-save-btn') as HTMLButtonElement);
    expect(api.submit).toHaveBeenCalledTimes(1);
  });

  it('編輯 busy 顯示儲存中', () => {
    renderModal({ mode: 'edit', busy: true });
    expect(document.getElementById('ct-team-save-btn')?.textContent).toBe('儲存中...');
  });

  it('無封面顯示上傳文案；有封面加 has-image 與背景圖', () => {
    renderModal();
    const empty = document.getElementById('ct-team-preview');
    expect(empty?.classList.contains('has-image')).toBe(false);
    expect(empty?.textContent).toContain('+');
    expect(empty?.textContent).toContain('上傳俱樂部圖片');
    expect(empty?.textContent).toContain('一張原圖裁切封面 800 x 300 與卡片 800 x 800');
    cleanup();

    renderModal({
      image: {
        previewUrl: 'https://example.test/cover.jpg',
        hasNew: true,
        pickFile: vi.fn(async () => undefined),
        cropper: null,
      },
    });
    const preview = document.getElementById('ct-team-preview') as HTMLElement;
    expect(preview.classList.contains('has-image')).toBe(true);
    expect(preview.style.backgroundImage).toContain('https://example.test/cover.jpg');
    expect(preview.textContent).not.toContain('上傳俱樂部圖片');
  });

  it('點封面觸發隱藏檔案輸入，選檔呼叫 image.pickFile', () => {
    const { api } = renderModal();
    const input = document.getElementById('ct-team-image');
    if (!(input instanceof HTMLInputElement)) throw new Error('找不到檔案輸入');
    expect(input.accept).toBe('.jpg,.jpeg,.png,.webp');
    expect(input.hidden).toBe(true);
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    fireEvent.click(document.getElementById('ct-team-preview') as HTMLElement);
    expect(click).toHaveBeenCalledTimes(1);

    const file = new File(['img'], 'cover.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(api.image.pickFile).toHaveBeenCalledWith(file);
  });

  it('open=false 不渲染且不呼叫 hook', () => {
    useTeamFormMock.mockClear();
    const props = formProps(makeApi(), false);
    const { container } = render(<TeamFormModal {...props} />);
    expect(container.innerHTML).toBe('');
    expect(document.getElementById('create-team-modal')).toBeNull();
    expect(useTeamFormMock).not.toHaveBeenCalled();
    expect(lockMock).not.toHaveBeenCalled();
  });

  it('運動、名稱、簡介、年份的限制與輸入寫入 setValue', () => {
    const { api } = renderModal({
      values: makeValues({ nationality: '台灣', name: '雷', bio: '簡', founded: '2020' }),
    });
    const sport = document.getElementById('ct-team-sport-tag');
    const name = document.getElementById('ct-team-name');
    const bio = document.getElementById('ct-team-bio');
    const founded = document.getElementById('ct-team-founded');
    const contact = document.getElementById('ct-team-contact');
    if (!(sport instanceof HTMLSelectElement)) throw new Error('找不到運動');
    if (!(name instanceof HTMLInputElement)) throw new Error('找不到名稱');
    if (!(bio instanceof HTMLTextAreaElement)) throw new Error('找不到簡介');
    if (!(founded instanceof HTMLInputElement)) throw new Error('找不到年份');
    if (!(contact instanceof HTMLInputElement)) throw new Error('找不到聯繫方式');

    expect(sport.options[0]?.textContent).toBe('未指定');
    expect(name.maxLength).toBe(15);
    expect(name.placeholder).toBe('例：雷霆隊');
    expect(bio.maxLength).toBe(500);
    expect(bio.rows).toBe(3);
    expect(founded.min).toBe('1900');
    expect(founded.max).toBe('2099');
    expect(founded.type).toBe('number');
    expect(contact.maxLength).toBe(100);
    expect((document.getElementById('ct-team-nationality') as HTMLInputElement).value).toBe('台灣');

    act(() => {
      setNativeValue(sport, 'football');
      sport.dispatchEvent(new Event('change', { bubbles: true }));
    });
    fireEvent.input(name, { target: { value: '雷霆隊' } });
    fireEvent.input(bio, { target: { value: '週末踢球' } });
    fireEvent.input(founded, { target: { value: '2024' } });
    expect(api.setValue).toHaveBeenCalledWith('sportTag', 'football');
    expect(api.setValue).toHaveBeenCalledWith('name', '雷霆隊');
    expect(api.setValue).toHaveBeenCalledWith('bio', '週末踢球');
    expect(api.setValue).toHaveBeenCalledWith('founded', '2024');
  });

  it('裁切器節點由 image.cropper 掛上', () => {
    const cropper: JSX.Element = <div id="team-cropper-probe">裁切</div>;
    renderModal({
      image: {
        previewUrl: null,
        hasNew: false,
        pickFile: vi.fn(async () => undefined),
        cropper,
      },
    });
    expect(document.getElementById('team-cropper-probe')?.textContent).toBe('裁切');
  });

  it('搜尋框把字串交給對應 picker', () => {
    const setLeader = vi.fn();
    const setCoach = vi.fn();
    const setCaptain = vi.fn();
    renderModal({
      mode: 'edit',
      captain: {
        displayText: '目前俱樂部經理：原經理',
        lockedText: null,
        transferVisible: true,
        transferPicker: makePicker({ setQuery: setCaptain }),
        selected: { uid: 'cap', name: '原經理' },
        pendingName: null,
        select: vi.fn(async () => undefined),
        clear: vi.fn(),
      },
      leaders: {
        tags: [],
        picker: makePicker({ setQuery: setLeader }),
        add: vi.fn(async () => undefined),
        remove: vi.fn(),
      },
      coaches: {
        allowed: true,
        tags: [],
        picker: makePicker({ setQuery: setCoach }),
        add: vi.fn(async () => undefined),
        remove: vi.fn(),
      },
    });
    fireEvent.input(document.getElementById('ct-leader-search') as HTMLInputElement, {
      target: { value: '領' },
    });
    fireEvent.input(document.getElementById('ct-coach-search') as HTMLInputElement, {
      target: { value: '教' },
    });
    fireEvent.input(document.getElementById('ct-captain-search') as HTMLInputElement, {
      target: { value: '經' },
    });
    expect(setLeader).toHaveBeenCalledWith('領');
    expect(setCoach).toHaveBeenCalledWith('教');
    expect(setCaptain).toHaveBeenCalledWith('經');
  });

  it('busy 時 ✕、取消、Esc、返回鍵都不呼叫 onClose', () => {
    renderModal({ busy: true });

    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(getToasts()[0]?.message).toBe('資料儲存中，請稍候');
    toast.clear();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(getToasts()[0]?.message).toBe('資料儲存中，請稍候');
    toast.clear();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(getToasts()[0]?.message).toBe('資料儲存中，請稍候');
    toast.clear();

    const onBack = overlayMock.mock.calls[0]?.[0];
    if (!onBack) throw new Error('沒有登記返回鍵');
    expect(onBack()).toBe(false);
    expect(getToasts()[0]?.message).toBe('資料儲存中，請稍候');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('裁切器開啟時 Esc 不呼叫 onClose，關閉後才呼叫', () => {
    const cropper: JSX.Element = <div id="team-cropper-guard">裁切</div>;
    const image = {
      previewUrl: null,
      hasNew: false,
      pickFile: vi.fn(async () => undefined),
      cropper,
    };
    const openApi = makeApi({ image });
    useTeamFormMock.mockReturnValue(openApi);
    const view = render(<TeamFormModal {...formProps(openApi)} />);

    const escapeWhileOpen = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(escapeWhileOpen);
    });
    expect(escapeWhileOpen.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    const onBack = overlayMock.mock.calls[0]?.[0];
    if (!onBack) throw new Error('沒有登記返回鍵');
    expect(onBack()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    const closedApi = makeApi({ image: { ...image, cropper: null } });
    useTeamFormMock.mockReturnValue(closedApi);
    view.rerender(<TeamFormModal {...formProps(closedApi)} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('新增與編輯的經理名稱用 accent 標出，沒有全形冒號則整句原樣', () => {
    renderModal({ mode: 'create' });
    const created = document.getElementById('ct-captain-display');
    const createdName = created?.querySelector('span');
    expect(created?.textContent).toBe('俱樂部經理（創立者）：創立者');
    expect(createdName?.textContent).toBe('創立者');
    expect(createdName?.getAttribute('style')?.replace(/\s/g, '')).toContain('color:var(--accent)');
    expect(createdName?.querySelector('*')).toBeNull();
    cleanup();

    renderModal({ mode: 'edit' });
    const edited = document.getElementById('ct-captain-display');
    const editedName = edited?.querySelector('span');
    expect(edited?.textContent).toBe('目前俱樂部經理：原經理');
    expect(editedName?.textContent).toBe('原經理');
    expect(editedName?.getAttribute('style')?.replace(/\s/g, '')).toContain('color:var(--accent)');
    cleanup();

    renderModal({
      captain: {
        displayText: '目前俱樂部經理:原經理',
        lockedText: null,
        transferVisible: false,
        transferPicker: makePicker(),
        selected: { uid: 'cap', name: '原經理' },
        pendingName: null,
        select: vi.fn(async () => undefined),
        clear: vi.fn(),
      },
    });
    const plain = document.getElementById('ct-captain-display');
    expect(plain?.textContent).toBe('目前俱樂部經理:原經理');
    expect(plain?.querySelector('span')).toBeNull();
  });

  it('聯絡連結有編號 aria-label，必填欄有 aria-required 且沒有原生 required', () => {
    renderModal({
      values: makeValues({ contactLinksEnabled: true }),
      contactLinks: {
        drafts: ['https://line.me/a', ''],
        setEnabled: vi.fn(),
        setDraft: vi.fn(),
        add: vi.fn(),
        remove: vi.fn(),
        canAdd: true,
        previews: [null, null],
      },
    });
    const inputs = document.querySelectorAll('.ce-social-link-input');
    expect(Array.from(inputs).map((input) => input.getAttribute('aria-label'))).toEqual([
      '連結 1',
      '連結 2',
    ]);
    for (const id of ['ct-team-sport-tag', 'ct-team-name', 'ct-team-region']) {
      const field = document.getElementById(id);
      expect(field?.getAttribute('aria-required')).toBe('true');
      expect(field?.hasAttribute('required')).toBe(false);
    }
  });

  it('封面背景只接受 https、blob 與 data:image，其餘顯示空狀態', () => {
    for (const url of ['http://x', 'javascript:alert(1)', '//x']) {
      renderModal({
        image: {
          previewUrl: url,
          hasNew: true,
          pickFile: vi.fn(async () => undefined),
          cropper: null,
        },
      });
      const preview = document.getElementById('ct-team-preview');
      if (!(preview instanceof HTMLElement)) throw new Error('找不到封面');
      expect(preview.style.backgroundImage).toBe('');
      expect(preview.classList.contains('has-image')).toBe(false);
      expect(preview.querySelector('.ce-upload-icon')?.textContent).toBe('+');
      cleanup();
    }

    for (const url of [
      'https://cdn.example/cover.webp',
      'blob:https://cdn.example/cover',
      'data:image/webp;base64,xxx',
    ]) {
      renderModal({
        image: {
          previewUrl: url,
          hasNew: true,
          pickFile: vi.fn(async () => undefined),
          cropper: null,
        },
      });
      const preview = document.getElementById('ct-team-preview');
      if (!(preview instanceof HTMLElement)) throw new Error('找不到封面');
      expect(preview.style.backgroundImage).toContain(url);
      expect(preview.classList.contains('has-image')).toBe(true);
      expect(preview.querySelector('.ce-upload-icon')).toBeNull();
      cleanup();
    }
  });
});
