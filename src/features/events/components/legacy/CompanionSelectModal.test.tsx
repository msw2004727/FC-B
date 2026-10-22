import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import {
  CompanionSelectModal,
  computeCompanionSelection,
  type CompanionSelectItem,
  type CompanionSelectModalProps,
} from './CompanionSelectModal';

const { pushOverlayMock, releaseMock } = vi.hoisted(() => {
  const releaseMock = vi.fn();
  const pushOverlayMock = vi.fn(() => releaseMock);
  return { pushOverlayMock, releaseMock };
});

vi.mock('@/core/overlay-back', () => ({ pushOverlay: pushOverlayMock }));

const items: CompanionSelectItem[] = [
  {
    id: 'c1',
    name: '小明',
    gender: '男',
    notes: '喜歡拍照',
    registered: true,
    registrationId: 'r1',
    status: 'confirmed',
    genderAllowed: true,
  },
  {
    id: 'c2',
    name: '小華',
    gender: '女',
    registered: false,
    genderAllowed: true,
  },
  {
    id: 'c3',
    name: '小美',
    gender: '女',
    registered: false,
    genderAllowed: false,
  },
];

function renderModal(overrides: Partial<CompanionSelectModalProps> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  const props: CompanionSelectModalProps = {
    open: true,
    eventTitle: '活動 A',
    feeEnabled: true,
    fee: 100,
    remaining: 2,
    max: 10,
    genderDetailText: '限女生',
    items,
    busy: false,
    onClose,
    onConfirm,
    ...overrides,
  };
  const utils = render(<CompanionSelectModal {...props} />);
  return { ...utils, onClose, onConfirm };
}

describe('CompanionSelectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('輸出 A 的 DOM 結構與活動資訊、同行者狀態', () => {
    const { container } = renderModal();

    expect(container.querySelector('#companion-select-overlay')).not.toBeNull();
    expect(container.querySelector('h3')?.textContent).toBe('幫夥伴報名');
    expect(container.querySelector('.modal-close')?.textContent).toBe('×');
    expect(container.querySelector('.outline-btn')?.textContent).toBe('取消');
    expect(container.querySelector('#companion-select-confirm-btn')?.textContent).toBe('確認');

    const info = container.querySelector('#companion-select-event-info')?.textContent ?? '';
    expect(info).toContain('活動 A');
    expect(info).toContain('費用：NT$100/人');
    expect(info).toContain('剩餘名額：2/10');
    expect(info).toContain('性別限制：限女生');

    const rows = container.querySelectorAll('.companion-toggle-row');
    expect(rows).toHaveLength(3);

    const first = rows[0] as HTMLElement;
    expect(first.classList.contains('is-selected')).toBe(true);
    expect(first.textContent).toContain('小明');
    expect(first.textContent).toContain('男');
    expect(first.textContent).toContain('喜歡拍照');
    expect(first.textContent).toContain('已報名');

    const third = rows[2] as HTMLElement;
    expect(third.classList.contains('is-disabled')).toBe(true);
    expect(third.textContent).toContain('不符限制');
    const thirdCheckbox = third.querySelector('input') as HTMLInputElement;
    expect(thirdCheckbox.disabled).toBe(true);

    const summary = container.querySelector('#companion-select-summary')?.textContent ?? '';
    expect(summary).toContain('已勾選 1');
    expect(summary).toContain('新增 0');
    expect(summary).toContain('取消 0');
    expect(summary).toContain('剩餘 2');

    const confirmBtn = container.querySelector('#companion-select-confirm-btn') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it('勾選與取消勾選會同步摘要與確認鈕', () => {
    const { container } = renderModal();
    const c2 = container.querySelector('input[data-companion-id="c2"]') as HTMLInputElement;
    const c1 = container.querySelector('input[data-companion-id="c1"]') as HTMLInputElement;
    const summary = () => container.querySelector('#companion-select-summary')?.textContent ?? '';
    const confirmBtn = container.querySelector('#companion-select-confirm-btn') as HTMLButtonElement;

    fireEvent.click(c2);
    expect(summary()).toContain('已勾選 2');
    expect(summary()).toContain('新增 1');
    expect(summary()).toContain('取消 0');
    expect(confirmBtn.disabled).toBe(false);

    fireEvent.click(c1);
    expect(summary()).toContain('已勾選 1');
    expect(summary()).toContain('新增 1');
    expect(summary()).toContain('取消 1');
    expect(confirmBtn.disabled).toBe(false);
  });

  it('確認時照 A 分批回傳加報與取消報名的 ID', () => {
    const { container, onConfirm } = renderModal();
    const c2 = container.querySelector('input[data-companion-id="c2"]') as HTMLInputElement;
    const c1 = container.querySelector('input[data-companion-id="c1"]') as HTMLInputElement;

    fireEvent.click(c2);
    fireEvent.click(c1);
    fireEvent.click(container.querySelector('#companion-select-confirm-btn') as HTMLButtonElement);

    expect(onConfirm).toHaveBeenCalledWith({
      addCompanionIds: ['c2'],
      cancelRegistrationIds: ['r1'],
    });
  });

  it('性別不符且未報名者 disabled，不可勾選', () => {
    const { container } = renderModal();
    const c3 = container.querySelector('input[data-companion-id="c3"]') as HTMLInputElement;
    expect(c3.disabled).toBe(true);

    fireEvent.click(c3);
    const summary = container.querySelector('#companion-select-summary')?.textContent ?? '';
    expect(summary).toContain('已勾選 1');
    expect(summary).toContain('新增 0');
  });

  it('busy 時遮罩、×、取消都不能關閉，確認鈕 disabled', () => {
    const { container, onClose } = renderModal({ busy: true });

    fireEvent.click(container.querySelector('#companion-select-overlay') as HTMLElement);
    fireEvent.click(container.querySelector('.modal-close') as HTMLButtonElement);
    fireEvent.click(container.querySelector('.outline-btn') as HTMLButtonElement);

    expect(onClose).not.toHaveBeenCalled();
    const confirmBtn = container.querySelector('#companion-select-confirm-btn') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it('開啟時 pushOverlay，busy 時返回鍵回傳 false，busy 關閉回傳 true', async () => {
    const { rerender, onClose } = renderModal();
    await waitFor(() => expect(pushOverlayMock).toHaveBeenCalledTimes(1));
    const onBack = (pushOverlayMock.mock.calls[0] as unknown[] | undefined)?.[0] as (() => boolean) | undefined;
    expect(onBack).toBeTypeOf('function');
    expect(onBack?.()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <CompanionSelectModal
        open
        eventTitle="活動 A"
        feeEnabled
        fee={100}
        remaining={2}
        max={10}
        genderDetailText="限女生"
        items={items}
        busy
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );
    const busyOnBack = (pushOverlayMock.mock.calls[0] as unknown[] | undefined)?.[0] as (() => boolean) | undefined;
    expect(busyOnBack?.()).toBe(false);
  });

  it('關閉或卸載時呼叫 pushOverlay 的釋放函式', async () => {
    const { unmount } = renderModal();
    await waitFor(() => expect(pushOverlayMock).toHaveBeenCalledTimes(1));
    unmount();
    await waitFor(() => expect(releaseMock).toHaveBeenCalled());
  });

  it('computeCompanionSelection 純函式照 A 分批', () => {
    const result = computeCompanionSelection(items, new Set(['c1', 'c2']));
    expect(result.selected).toBe(2);
    expect(result.toRegister).toBe(1);
    expect(result.toCancel).toBe(0);
    expect(result.addCompanionIds).toEqual(['c2']);
    expect(result.cancelRegistrationIds).toEqual([]);

    const second = computeCompanionSelection(items, new Set(['c2']));
    expect(second.selected).toBe(1);
    expect(second.toRegister).toBe(1);
    expect(second.toCancel).toBe(1);
    expect(second.addCompanionIds).toEqual(['c2']);
    expect(second.cancelRegistrationIds).toEqual(['r1']);
  });
});
