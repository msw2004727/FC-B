/**
 * 驗證 A team-detail.js:1642-1683 活動備註框 DOM、初始值與 trim。
 * 覆蓋 B 的 120 字 JS 硬上限、JSX 安全輸出、busy 與焦點生命週期；
 * 使用原生 input 語意，避免 review-lessons L-42 的 change 事件陷阱。
 * 本框不寫 members／opLog、不提供剔除；角色 best-effort 另由動作層驗證。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TeamMemberNoteDialog } from './TeamMemberNoteDialog';
import type { TeamMemberNoteDialogProps } from './TeamMemberNoteDialog';

const mocks = vi.hoisted(() => ({
  pushOverlay: vi.fn(),
  releaseBack: vi.fn(),
  lockBody: vi.fn(),
  unlock: vi.fn(),
}));

vi.mock('@/core/overlay-back', () => ({ pushOverlay: mocks.pushOverlay }));
vi.mock('@/ui/Modal', () => ({ lockBody: mocks.lockBody }));

function makeProps(
  overrides: Partial<TeamMemberNoteDialogProps> = {},
): TeamMemberNoteDialogProps {
  return {
    memberName: '王小明',
    initialNote: '現有備註',
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`找不到 ${selector}`);
  return found;
}

function editor(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>('textbox', { name: '備註' });
}

function backHandler(): () => boolean {
  const handler: unknown = mocks.pushOverlay.mock.calls[0]?.[0];
  if (typeof handler !== 'function') throw new Error('未註冊返回鍵');
  return handler as () => boolean;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pushOverlay.mockReturnValue(mocks.releaseBack);
  mocks.lockBody.mockReturnValue(mocks.unlock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('活動備註對話框', () => {
  it('DOM、portal、文案與 textarea 的三個屬性逐項符合 A', () => {
    const { container } = render(<TeamMemberNoteDialog {...makeProps()} />);
    const overlay = element('#team-member-note-modal');
    const dialog = screen.getByRole('dialog', { name: '編輯活動備註' });
    const form = element('.app-confirm-msg > .td-member-match-form');

    expect(container.childElementCount).toBe(0);
    expect(overlay.parentElement?.className).toBe('legacy-ui');
    expect(overlay.parentElement?.parentElement).toBe(document.body);
    expect(overlay.className).toBe('app-confirm-overlay open');
    expect(document.getElementById('app-confirm-modal')).toBeNull();
    expect(dialog.className).toBe('app-confirm-box');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('.td-role-confirm-open')).toBeNull();
    expect(document.querySelector('.td-role-confirm-box')).toBeNull();
    expect(form.children).toHaveLength(3);
    expect(form.children.item(0)?.tagName).toBe('STRONG');
    expect(form.children.item(0)?.textContent).toBe('編輯活動備註');
    expect(form.children.item(1)?.tagName).toBe('SPAN');
    expect(form.children.item(1)?.textContent).toBe('王小明');
    expect(form.children.item(2)?.tagName).toBe('LABEL');
    expect(editor().parentElement).toBe(form.children.item(2));
    expect(editor().getAttributeNames().sort()).toEqual(['id', 'maxlength', 'rows']);
    expect(editor().id).toBe('td-member-note-editor');
    expect(editor().rows).toBe(3);
    expect(editor().maxLength).toBe(120);
    expect(editor().value).toBe('現有備註');
    expect(element('.app-confirm-btns').children).toHaveLength(2);
    expect(screen.getByRole('button', { name: '取消' }).className).toBe('app-confirm-cancel');
    expect(screen.getByRole('button', { name: '儲存' }).className).toBe('app-confirm-ok');
  });

  it.each([
    ['-', ''],
    ['', ''],
    ['現有備註', '現有備註'],
    ['  保留初始空白  ', '  保留初始空白  '],
  ])('初始值 %j 顯示為 %j', (initialNote, expected) => {
    render(<TeamMemberNoteDialog {...makeProps({ initialNote })} />);
    expect(editor().value).toBe(expected);
  });

  it('儲存使用最新輸入並 trim，且不呼叫取消', () => {
    const props = makeProps();
    render(<TeamMemberNoteDialog {...props} />);
    fireEvent.input(editor(), { target: { value: '  新備註\n  ' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith('新備註');
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('允許儲存空字串以清除備註', () => {
    const props = makeProps();
    render(<TeamMemberNoteDialog {...props} />);
    fireEvent.input(editor(), { target: { value: ' \n ' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith('');
  });

  it('貼上超長內容時 JS 截斷至 120 字並保存截斷結果', () => {
    const props = makeProps();
    render(<TeamMemberNoteDialog {...props} />);
    fireEvent.input(editor(), { target: { value: '字'.repeat(150) } });
    expect(editor().value).toBe('字'.repeat(120));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith('字'.repeat(120));
  });

  it('已達上限後再貼入相同前綴，state 未變仍修正 DOM 長度', () => {
    const props = makeProps({ initialNote: '字'.repeat(120) });
    render(<TeamMemberNoteDialog {...props} />);
    fireEvent.input(editor(), { target: { value: `${'字'.repeat(120)}多餘文字` } });
    expect(editor().value).toBe('字'.repeat(120));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith('字'.repeat(120));
  });

  it('超長初始資料也限制為 120 字', () => {
    render(<TeamMemberNoteDialog {...makeProps({ initialNote: '字'.repeat(130) })} />);
    expect(editor().value).toBe('字'.repeat(120));
    expect(editor().selectionStart).toBe(120);
    expect(editor().selectionEnd).toBe(120);
  });

  it.each(['Escape', '遮罩', '返回鍵', '取消鈕'])('%s 可取消', (method) => {
    const props = makeProps();
    render(<TeamMemberNoteDialog {...props} />);
    if (method === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    if (method === '遮罩') fireEvent.click(element('#team-member-note-modal'));
    if (method === '取消鈕') fireEvent.click(screen.getByRole('button', { name: '取消' }));
    if (method === '返回鍵') {
      act(() => {
        expect(backHandler()()).toBe(true);
      });
    }
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('點擊名稱與輸入框不會觸發遮罩取消', () => {
    const props = makeProps();
    render(<TeamMemberNoteDialog {...props} />);
    fireEvent.click(screen.getByText('王小明'));
    fireEvent.click(editor());
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('busy 時忽略 Esc、遮罩、返回鍵與取消，儲存鈕停用', () => {
    const props = makeProps({ busy: true });
    render(<TeamMemberNoteDialog {...props} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(element('#team-member-note-modal'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    act(() => {
      expect(backHandler()()).toBe(false);
    });
    const save = screen.getByRole<HTMLButtonElement>('button', { name: '儲存' });
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('busy 時不接受新輸入，仍保留 textarea 只有三個屬性', () => {
    render(<TeamMemberNoteDialog {...makeProps({ busy: true })} />);
    fireEvent.input(editor(), { target: { value: '寫入中修改' } });
    expect(editor().value).toBe('現有備註');
    expect(editor().getAttributeNames().sort()).toEqual(['id', 'maxlength', 'rows']);
  });

  it('重新渲染後使用最新 busy 與回呼，不重新註冊返回鍵', () => {
    const props = makeProps();
    const nextCancel = vi.fn();
    const nextSave = vi.fn();
    const { rerender } = render(<TeamMemberNoteDialog {...props} />);
    const back = backHandler();

    rerender(
      <TeamMemberNoteDialog {...props} busy onCancel={nextCancel} onSave={nextSave} />,
    );
    act(() => {
      expect(back()).toBe(false);
    });
    rerender(
      <TeamMemberNoteDialog
        {...props}
        busy={false}
        onCancel={nextCancel}
        onSave={nextSave}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    act(() => {
      expect(back()).toBe(true);
    });
    expect(nextSave).toHaveBeenCalledExactlyOnceWith('現有備註');
    expect(nextCancel).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(mocks.pushOverlay).toHaveBeenCalledTimes(1);
  });

  it('初始焦點在 textarea 且游標位於最後', () => {
    render(<TeamMemberNoteDialog {...makeProps()} />);
    expect(document.activeElement).toBe(editor());
    expect(editor().selectionStart).toBe('現有備註'.length);
    expect(editor().selectionEnd).toBe('現有備註'.length);
  });

  it('Tab 在 textarea、取消與儲存間循環，Shift+Tab 可反向循環', () => {
    render(<TeamMemberNoteDialog {...makeProps()} />);
    const cancel = screen.getByRole('button', { name: '取消' });
    const save = screen.getByRole('button', { name: '儲存' });

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(editor());
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it('busy 時 Tab 跳過停用的儲存鈕', () => {
    render(<TeamMemberNoteDialog {...makeProps({ busy: true })} />);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(editor());
  });

  it('卸載時清理返回鍵、鎖定與事件並還原開啟前焦點', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const props = makeProps();
    const { unmount } = render(<TeamMemberNoteDialog {...props} />);
    expect(mocks.lockBody).toHaveBeenCalledExactlyOnceWith(document.body);
    unmount();

    expect(mocks.releaseBack).toHaveBeenCalledTimes(1);
    expect(mocks.unlock).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    expect(document.getElementById('team-member-note-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCancel).not.toHaveBeenCalled();
    trigger.remove();
  });

  it('名稱與備註的 HTML 字元只作文字，不產生 HTML 元素', () => {
    render(<TeamMemberNoteDialog {...makeProps({
      memberName: '<b>x</b>',
      initialNote: '</textarea><b>備註</b>',
    })} />);
    expect(element('.td-member-match-form > span').textContent).toBe('<b>x</b>');
    expect(editor().value).toBe('</textarea><b>備註</b>');
    expect(screen.getByRole('dialog').querySelector('b')).toBeNull();
  });
});
