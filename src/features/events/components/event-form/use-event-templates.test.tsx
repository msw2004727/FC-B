import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ViewerView } from '@/features/profile/data/viewer';
import { createDefaultFormState } from '../../data/event-form-model';
import {
  buildTemplateFromForm,
  type EventTemplateDoc,
} from '../../data/event-templates';
import type { EventLocationValue } from './use-event-location';
import { EventFormFields, type EventFormFieldsProps } from './EventFormFields';
import { useEventTemplates, type EventTemplatesView } from './use-event-templates';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  show: vi.fn(),
  generateId: vi.fn(),
}));

vi.mock('@/data/ids', () => ({ generateId: mocks.generateId }));

vi.mock('../../data/event-templates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/event-templates')>();
  return {
    ...actual,
    loadEventTemplates: mocks.load,
    saveEventTemplate: mocks.save,
    deleteEventTemplate: mocks.remove,
  };
});
vi.mock('@/ui/Toast', () => ({ toast: { show: mocks.show } }));
vi.mock('./CeInfoDialog', () => ({
  CeInfoDialog: ({ infoKey }: { infoKey: string | null }) => (
    <output data-testid="info-key">{infoKey}</output>
  ),
}));
vi.mock('@/ui/SportIcon', () => ({ SportIcon: () => null }));
vi.mock('@/ui/UserTag', () => ({ UserTag: () => null }));
vi.mock('./EventFormAddons', () => ({ EventFormAddons: () => null }));

const location: EventLocationValue = {
  mapPickerEnabled: false,
  gpsEnabled: false,
  lat: null,
  lng: null,
  mapAddress: null,
  mapPlaceId: null,
  mapProvider: null,
  mapLocationConfirmed: false,
  mapLocationUpdatedAt: null,
};

function viewer(uid = 'u'): ViewerView {
  // ASSUMPTION: 未附 ViewerContext 全型別；替身只提供本 hook 使用的欄位。
  return {
    uid,
    role: 'user',
    displayName: '甲',
    pictureUrl: null,
    capabilities: [],
  } as unknown as ViewerView;
}

function template(id = 'tpl_1'): EventTemplateDoc {
  return {
    ...buildTemplateFromForm({
      name: '週六',
      state: createDefaultFormState(),
      image: null,
      location,
      canUseAddons: false,
      generateId: () => id,
      now: new Date('2026-10-22T00:00:00.000Z'),
    }),
    ownerUid: 'u',
    ownerName: '甲',
    _docId: `doc-${id}`,
    createdAt: null,
    updatedAt: null,
  };
}

type HookResult = ReturnType<typeof useEventTemplates>;
type HookInput = Parameters<typeof useEventTemplates>[0];

function setup(overrides: Partial<HookInput> = {}) {
  let result: HookResult | undefined;
  const input: HookInput = {
    viewer: viewer(),
    mode: 'create',
    collect: () => ({
      state: createDefaultFormState(),
      image: null,
      location,
      canUseAddons: false,
    }),
    onApply: vi.fn(),
    ...overrides,
  };

  function Harness(props: HookInput) {
    result = useEventTemplates(props);
    return null;
  }

  const rendered = render(<Harness {...input} />);
  return {
    ...rendered,
    input,
    current(): HookResult {
      if (!result) throw new Error('HOOK_NOT_RENDERED');
      return result;
    },
    update(next: Partial<HookInput>) {
      Object.assign(input, next);
      rendered.rerender(<Harness {...input} />);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function ready(harness: ReturnType<typeof setup>) {
  await waitFor(() => expect(harness.current().view.loading).toBe(false));
}

function setName(harness: ReturnType<typeof setup>, name: string) {
  act(() => harness.current().view.onSaveNameChange(name));
}

function fieldsProps(
  mode: 'create' | 'edit',
  templates?: EventTemplatesView,
): EventFormFieldsProps {
  // ASSUMPTION: form-types 未附全文；替身依 EventFormFields 實際使用的欄位提供。
  return {
    mode,
    state: createDefaultFormState(),
    onPatch: vi.fn(),
    titleLimit: 16,
    canToggleRegion: false,
    cover: {
      previewUrl: null,
      onPickFile: vi.fn(),
    },
    location: {
      statusState: 'empty',
      statusText: '',
      buttonLooksDisabled: false,
      buttonDisabled: false,
      buttonText: '定位',
      onOpenPicker: vi.fn(),
      summary: '',
      showClear: false,
      onClear: vi.fn(),
    },
    delegates: {
      chips: [],
      canManage: false,
      onRemove: vi.fn(),
      query: '',
      placeholder: '',
      inputDisabled: false,
      onQuery: vi.fn(),
      onFocus: vi.fn(),
      dropdownOpen: false,
      dropdownStatus: '',
      results: [],
      onPick: vi.fn(),
    },
    ...(templates ? { templates } : {}),
  } as unknown as EventFormFieldsProps;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.lang = 'zh-TW';
  mocks.generateId.mockReset().mockImplementation((prefix: string) => `${prefix}generated`);
  mocks.load.mockReset().mockResolvedValue([]);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.save.mockReset().mockImplementation(async (input: {
    template: Omit<EventTemplateDoc, '_docId' | 'createdAt' | 'updatedAt'>;
  }) => ({
    ...input.template,
    _docId: 'saved-document',
    createdAt: null,
    updatedAt: null,
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useEventTemplates', () => {
  it.each(['create', 'edit'] as const)('%s 模式掛載即載入清單', async (mode) => {
    mocks.load.mockResolvedValue([template()]);
    const harness = setup({ mode });

    await ready(harness);
    expect(mocks.load).toHaveBeenCalledWith('u');
    expect(harness.current().view.templates).toEqual([
      expect.objectContaining({ id: 'tpl_1', name: '週六' }),
    ]);
  });

  it('空名稱及未選限定性別不寫入', async () => {
    const harness = setup();
    await ready(harness);

    act(() => harness.current().view.onSave());
    expect(mocks.show).toHaveBeenLastCalledWith('請輸入範本名稱');

    harness.update({
      collect: () => ({
        state: {
          ...createDefaultFormState(),
          genderRestrictionEnabled: true,
          allowedGender: '',
        },
        image: null,
        location,
        canUseAddons: true,
      }),
    });
    setName(harness, '範本');
    act(() => harness.current().view.onSave());

    await waitFor(() => {
      expect(mocks.show).toHaveBeenLastCalledWith('請先選擇限定性別，再儲存範本');
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('全部類型合計 30 組不新增；29 組可新增，連按只送出一次', async () => {
    const visible = [template('tpl_event')];
    let allTemplates: EventTemplateDoc[] = [
      ...visible,
      ...Array.from({ length: 29 }, (_, index) => ({
        ...template(`tpl_course_${index}`),
        templateType: 'course',
      })),
    ];
    mocks.load.mockImplementation(async (
      _ownerUid: string,
      options?: { includeAllTypes?: boolean },
    ) => options?.includeAllTypes ? allTemplates : visible);

    const harness = setup();
    await ready(harness);
    expect(harness.current().view.templates).toEqual(visible);
    setName(harness, '週六');

    act(() => harness.current().view.onSave());
    await ready(harness);

    expect(mocks.load).toHaveBeenNthCalledWith(2, 'u', { includeAllTypes: true });
    expect(mocks.show).toHaveBeenLastCalledWith('範本數量已達上限 30 組');
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.generateId).not.toHaveBeenCalled();
    expect(harness.current().view.templates).toEqual(visible);
    expect(harness.current().view.saveName).toBe('週六');

    allTemplates = allTemplates.slice(0, 29);
    act(() => {
      harness.current().view.onSave();
      harness.current().view.onSave();
    });

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    await ready(harness);

    expect(mocks.load).toHaveBeenNthCalledWith(3, 'u', { includeAllTypes: true });
    expect(mocks.load).toHaveBeenNthCalledWith(4, 'u');
    expect(mocks.load).toHaveBeenCalledTimes(4);
    expect(mocks.generateId).toHaveBeenCalledTimes(1);
    expect(mocks.generateId).toHaveBeenCalledWith('tpl_');
    expect(mocks.show).toHaveBeenLastCalledWith('範本「週六」已儲存到雲端');
    expect(harness.current().view.saveName).toBe('');
    expect(harness.current().view.templates).toEqual(visible);
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
      ownerUid: 'u',
      ownerName: '甲',
      template: { id: 'tpl_generated' },
    });
  });

  it('圖片被省略時顯示 A 圖片提示', async () => {
    mocks.save.mockResolvedValue(template());
    const harness = setup({
      collect: () => ({
        state: createDefaultFormState(),
        image: 'data:image/png;base64,AA==',
        location,
        canUseAddons: false,
      }),
    });
    await ready(harness);
    setName(harness, '週六');
    act(() => harness.current().view.onSave());

    await waitFor(() => {
      expect(mocks.show).toHaveBeenLastCalledWith('圖片太大，已省略圖片後儲存範本');
    });
  });

  it('儲存失敗保留名稱，可再次儲存，且不使用 localStorage', async () => {
    const localWrite = vi.spyOn(Storage.prototype, 'setItem');
    mocks.save.mockRejectedValueOnce(new Error('offline'));
    const harness = setup();
    await ready(harness);
    setName(harness, '週六');

    act(() => harness.current().view.onSave());
    await ready(harness);
    expect(mocks.show).toHaveBeenLastCalledWith('範本儲存失敗');
    expect(harness.current().view.saveName).toBe('週六');

    act(() => harness.current().view.onSave());
    await ready(harness);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.show).toHaveBeenLastCalledWith('範本「週六」已儲存到雲端');
    expect(localWrite).not.toHaveBeenCalled();
  });

  it('儲存已成功但重讀失敗仍保留收據，不誤報儲存失敗', async () => {
    mocks.load
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('refresh failed'));
    const harness = setup();
    await ready(harness);
    setName(harness, '週六');

    act(() => harness.current().view.onSave());
    await ready(harness);

    expect(harness.current().view.templates).toHaveLength(1);
    expect(mocks.show).toHaveBeenLastCalledWith('範本「週六」已儲存到雲端');
  });

  it('套用時重新讀取加值權限，傳回 upsell 及 A 提示', async () => {
    mocks.load.mockResolvedValue([{
      ...template(),
      feeEnabled: true,
      fee: 100,
    }]);
    const apply = vi.fn();
    const harness = setup({ onApply: apply });
    await ready(harness);

    act(() => harness.current().view.onLoad('tpl_1'));

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        upsell: true,
        patch: expect.objectContaining({ feeEnabled: false, fee: '0' }),
      }),
      '週六',
    );
    expect(mocks.show).toHaveBeenLastCalledWith('已載入範本「週六」');
  });

  it('刪除不確認，失敗保留 chip，重試成功後移除', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    mocks.load.mockResolvedValue([template()]);
    mocks.remove.mockRejectedValueOnce(new Error('offline'));
    const harness = setup();
    await ready(harness);

    act(() => harness.current().view.onDelete('tpl_1'));
    await ready(harness);
    expect(mocks.show).toHaveBeenLastCalledWith('雲端刪除失敗');
    expect(harness.current().view.templates).toHaveLength(1);

    mocks.load.mockResolvedValue([]);
    act(() => harness.current().view.onDelete('tpl_1'));
    await ready(harness);

    expect(mocks.remove).toHaveBeenLastCalledWith(
      expect.objectContaining({ _docId: 'doc-tpl_1' }),
    );
    expect(harness.current().view.templates).toEqual([]);
    expect(mocks.show).toHaveBeenLastCalledWith('範本已刪除');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('載入失敗保留舊清單，下一次 reload 重新呼叫 loader', async () => {
    mocks.load.mockResolvedValueOnce([template()]);
    const harness = setup();
    await ready(harness);

    mocks.load.mockRejectedValueOnce(new Error('offline'));
    act(() => harness.current().reload());
    await ready(harness);
    expect(harness.current().view.templates).toHaveLength(1);
    expect(mocks.show).toHaveBeenLastCalledWith('範本載入失敗，請稍後重試');

    mocks.load.mockResolvedValueOnce([template('tpl_new')]);
    act(() => harness.current().reload());
    await ready(harness);
    expect(harness.current().view.templates[0]?.id).toBe('tpl_new');
    expect(mocks.load).toHaveBeenCalledTimes(3);
  });

  it('兩次 reload 交錯時只接受最新結果', async () => {
    const first = deferred<EventTemplateDoc[]>();
    const second = deferred<EventTemplateDoc[]>();
    mocks.load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const harness = setup();

    act(() => harness.current().reload());
    await act(async () => {
      second.resolve([template('new')]);
      await second.promise;
    });
    await act(async () => {
      first.resolve([template('old')]);
      await first.promise;
    });

    expect(harness.current().view.templates[0]?.id).toBe('new');
  });

  it('切換帳號立即隔離清單，舊帳號晚回來不得覆寫', async () => {
    const old = deferred<EventTemplateDoc[]>();
    mocks.load.mockReturnValueOnce(old.promise);
    mocks.load.mockResolvedValueOnce([template('account-b')]);
    const harness = setup();

    harness.update({ viewer: viewer('b') });
    expect(harness.current().view.templates).toEqual([]);
    await ready(harness);
    expect(harness.current().view.templates[0]?.id).toBe('account-b');

    await act(async () => {
      old.resolve([template('account-a')]);
      await old.promise;
    });
    expect(harness.current().view.templates[0]?.id).toBe('account-b');
  });

  it('卸載後不套用非同步清單，也不顯示失敗提示', async () => {
    const pending = deferred<EventTemplateDoc[]>();
    mocks.load.mockReturnValueOnce(pending.promise);
    const harness = setup();
    harness.unmount();

    await act(async () => {
      pending.reject(new Error('offline'));
      await pending.promise.catch(() => undefined);
    });
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('等待上限查詢時卸載，不再開始寫入', async () => {
    mocks.load.mockResolvedValueOnce([]);
    const pending = deferred<EventTemplateDoc[]>();
    mocks.load.mockReturnValueOnce(pending.promise);
    const harness = setup();
    await ready(harness);
    setName(harness, '週六');
    act(() => harness.current().view.onSave());
    harness.unmount();

    await act(async () => {
      pending.resolve([]);
      await pending.promise;
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe('EventFormFields 範本 DOM', () => {
  it.each(['create', 'edit'] as const)('%s 模式都有兩列、空清單及 A 文字', (mode) => {
    const { container } = render(<EventFormFields {...fieldsProps(mode)} />);

    expect(container.querySelector('#ce-template-area')).not.toBeNull();
    expect(screen.getByText('從範本建立')).not.toBeNull();
    expect(screen.getByText('尚無範本')).not.toBeNull();
    expect(screen.getByText('儲存為範本')).not.toBeNull();
    expect(screen.getByRole('button', { name: '儲存' })).not.toBeNull();

    const input = screen.getByPlaceholderText('範本名稱（例：週六友誼賽）');
    expect(input.getAttribute('id')).toBe('ce-template-name');
    expect(input.getAttribute('maxlength')).toBe('20');
    const selector = container.querySelector<HTMLElement>('#ce-template-selector');
    expect(selector).not.toBeNull();
    if (!selector || !(input instanceof HTMLInputElement)) {
      throw new Error('缺少範本清單或名稱輸入框');
    }

    // 使用同一 DOM CSS parser 正規化，逐項保留原本全部樣式斷言。
    const expectedStyles: Array<[HTMLElement, string]> = [
      [selector, 'display:flex;gap:.3rem;flex-wrap:wrap;align-items:center'],
      [
        input,
        'flex:1;min-width:0;font-size:.78rem;padding:.3rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary)',
      ],
    ];
    for (const [element, cssText] of expectedStyles) {
      const expectedStyle = document.createElement('div').style;
      expectedStyle.cssText = cssText;
      expect(expectedStyle.length).toBeGreaterThan(0);
      expect(element.style.length).toBe(expectedStyle.length);
      for (let index = 0; index < expectedStyle.length; index += 1) {
        const property = expectedStyle.item(index);
        expect(element.style.getPropertyValue(property))
          .toBe(expectedStyle.getPropertyValue(property));
        expect(element.style.getPropertyPriority(property))
          .toBe(expectedStyle.getPropertyPriority(property));
      }
    }
  });

  it('chip 名稱安全顯示，刪除阻止冒泡，輸入及儲存交給 view', () => {
    const view: EventTemplatesView = {
      templates: [{ id: 'tpl_x', name: '<img src=x onerror=alert(1)>' }],
      loading: false,
      onLoad: vi.fn(),
      onDelete: vi.fn(),
      saveName: '',
      onSaveNameChange: vi.fn(),
      onSave: vi.fn(),
    };

    const { container } = render(<EventFormFields {...fieldsProps('create', view)} />);
    const chip = screen.getByText('<img src=x onerror=alert(1)>');
    expect(container.querySelector('#ce-template-selector img')).toBeNull();

    fireEvent.click(chip);
    expect(view.onLoad).toHaveBeenCalledWith('tpl_x');

    vi.mocked(view.onLoad).mockClear();
    fireEvent.click(screen.getByTitle('刪除範本'));
    expect(view.onDelete).toHaveBeenCalledWith('tpl_x');
    expect(view.onLoad).not.toHaveBeenCalled();

    fireEvent.input(screen.getByPlaceholderText('範本名稱（例：週六友誼賽）'), {
      target: { value: '週六' },
    });
    expect(view.onSaveNameChange).toHaveBeenCalledWith('週六');

    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(view.onSave).toHaveBeenCalledTimes(1);
  });

  it('兩個問號分別開啟 template 與 saveTemplate 說明', () => {
    const { container } = render(<EventFormFields {...fieldsProps('edit')} />);
    const templateInfo = container.querySelector('#ce-template-area .edu-info-btn');
    const saveInput = container.querySelector('#ce-template-name');
    const saveInfo = saveInput?.closest('.ce-row')?.querySelector('.edu-info-btn');

    if (!templateInfo || !saveInfo) throw new Error('缺少範本說明按鈕');

    fireEvent.click(templateInfo);
    expect(screen.getByTestId('info-key').textContent).toBe('template');

    fireEvent.click(saveInfo);
    expect(screen.getByTestId('info-key').textContent).toBe('saveTemplate');
  });
});
