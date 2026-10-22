import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import {
  buildCompanionCancelWarn,
  CompanionCancelModal,
  formatCompanionCancelTargetList,
  getCompanionCancelTargetLabel,
  type CompanionCancelModalProps,
  type CompanionCancelTarget,
} from './CompanionCancelModal';

const { pushOverlayMock, releaseMock } = vi.hoisted(() => {
  const releaseMock = vi.fn();
  const pushOverlayMock = vi.fn(() => releaseMock);
  return { pushOverlayMock, releaseMock };
});

vi.mock('@/core/overlay-back', () => ({ pushOverlay: pushOverlayMock }));

const targets: CompanionCancelTarget[] = [
  { registrationId: 'r1', isSelf: true, name: '我', status: 'confirmed' },
  { registrationId: 'r2', isSelf: false, name: '小明', status: 'waitlisted' },
  { registrationId: 'r3', isSelf: true, name: '學生', status: 'confirmed', courseStudentId: 's1' },
];

function renderModal(overrides: Partial<CompanionCancelModalProps> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  const props: CompanionCancelModalProps = {
    open: true,
    targets,
    selectAll: true,
    busy: false,
    onClose,
    onConfirm,
    ...overrides,
  };
  const utils = render(<CompanionCancelModal {...props} />);
  return { ...utils, onClose, onConfirm };
}

function findButton(container: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((item) => item.textContent === text);
  if (!button) throw new Error(`button not found: ${text}`);
  return button as HTMLButtonElement;
}

describe('CompanionCancelModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('輸出 A 的 DOM 結構、清單與警告', () => {
    const { container } = renderModal();

    expect(container.querySelector('#companion-cancel-overlay')).not.toBeNull();
    expect(container.querySelector('#companion-cancel-title')?.textContent).toBe('取消報名');
    expect(container.querySelector('.modal-close')?.textContent).toBe('✕');
    expect(container.textContent).toContain('請選擇要取消的報名：');
    expect(findButton(container, '全選')).toBeTruthy();
    expect(findButton(container, '返回')).toBeTruthy();
    expect(findButton(container, '確認取消')).toBeTruthy();

    const rows = container.querySelectorAll('#companion-cancel-list label');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('我（本人）');
    expect(rows[1]?.textContent).toContain('小明');
    expect(rows[2]?.textContent).toContain('學生（課程學員）');

    const warn = container.querySelector('#companion-cancel-warn')?.textContent ?? '';
    expect(warn).toBe('注意：確認取消後將會取消本人、夥伴小明與課程學員「學生」');

    const confirmBtn = findButton(container, '確認取消');
    expect(confirmBtn.disabled).toBe(false);
  });

  it('取消勾選後警告與確認名單同步', () => {
    const { container, onConfirm } = renderModal();
    const r1 = container.querySelector('input[value="r1"]') as HTMLInputElement;
    fireEvent.click(r1);

    const warn = container.querySelector('#companion-cancel-warn')?.textContent ?? '';
    expect(warn).toBe('注意：確認取消後將會取消夥伴小明與課程學員「學生」');

    fireEvent.click(findButton(container, '確認取消'));
    expect(onConfirm).toHaveBeenCalledWith(['r2', 'r3']);
  });

  it('全部取消勾選時顯示至少勾選一位且確認鈕 disabled', () => {
    const { container } = renderModal();
    fireEvent.click(container.querySelector('input[value="r1"]') as HTMLInputElement);
    fireEvent.click(container.querySelector('input[value="r2"]') as HTMLInputElement);
    fireEvent.click(container.querySelector('input[value="r3"]') as HTMLInputElement);

    const warn = container.querySelector('#companion-cancel-warn')?.textContent ?? '';
    expect(warn).toBe('注意：請至少勾選一位要取消的對象');
    expect(findButton(container, '確認取消').disabled).toBe(true);
  });

  it('selectAll 為 false 時開啟不勾選，按全選才全部勾選', () => {
    const { container } = renderModal({ selectAll: false });

    for (const id of ['r1', 'r2', 'r3']) {
      expect((container.querySelector(`input[value="${id}"]`) as HTMLInputElement).checked).toBe(false);
    }
    expect(findButton(container, '確認取消').disabled).toBe(true);
    expect(container.querySelector('#companion-cancel-warn')?.textContent)
      .toBe('注意：請至少勾選一位要取消的對象');

    fireEvent.click(findButton(container, '全選'));

    for (const id of ['r1', 'r2', 'r3']) {
      expect((container.querySelector(`input[value="${id}"]`) as HTMLInputElement).checked).toBe(true);
    }
    expect(findButton(container, '確認取消').disabled).toBe(false);
    expect(container.querySelector('#companion-cancel-warn')?.textContent)
      .toBe('注意：確認取消後將會取消本人、夥伴小明與課程學員「學生」');
  });

  it('busy 時遮罩、✕、返回都不能關閉，確認鈕 disabled', () => {
    const { container, onClose } = renderModal({ busy: true });

    fireEvent.click(container.querySelector('#companion-cancel-overlay') as HTMLElement);
    fireEvent.click(container.querySelector('.modal-close') as HTMLButtonElement);
    fireEvent.click(findButton(container, '返回'));

    expect(onClose).not.toHaveBeenCalled();
    expect(findButton(container, '確認取消').disabled).toBe(true);
  });

  it('開啟時 pushOverlay，busy 時返回鍵回傳 false，busy 關閉回傳 true', async () => {
    const { rerender, onClose } = renderModal();
    await waitFor(() => expect(pushOverlayMock).toHaveBeenCalledTimes(1));
    const onBack = (pushOverlayMock.mock.calls[0] as unknown[] | undefined)?.[0] as (() => boolean) | undefined;
    expect(onBack).toBeTypeOf('function');
    expect(onBack?.()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <CompanionCancelModal
        open
        targets={targets}
        selectAll
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

  it('標籤、清單格式化與警告純函式照 A', () => {
    expect(getCompanionCancelTargetLabel(targets[0] as CompanionCancelTarget)).toBe('本人');
    expect(getCompanionCancelTargetLabel(targets[1] as CompanionCancelTarget)).toBe('夥伴小明');
    expect(getCompanionCancelTargetLabel(targets[2] as CompanionCancelTarget)).toBe('課程學員「學生」');
    expect(getCompanionCancelTargetLabel({
      registrationId: 'r4',
      isSelf: true,
      name: '',
      status: 'confirmed',
    })).toBe('本人');

    expect(formatCompanionCancelTargetList(['A'])).toBe('A');
    expect(formatCompanionCancelTargetList(['A', 'B'])).toBe('A與B');
    expect(formatCompanionCancelTargetList(['A', 'B', 'C'])).toBe('A、B與C');

    expect(buildCompanionCancelWarn(targets, new Set(['r1', 'r3'])))
      .toBe('注意：確認取消後將會取消本人與課程學員「學生」');
    expect(buildCompanionCancelWarn(targets, new Set()))
      .toBe('注意：請至少勾選一位要取消的對象');
  });
});
