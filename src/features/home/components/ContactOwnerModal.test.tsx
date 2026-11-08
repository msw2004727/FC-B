import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { setLocale } from '@/i18n/i18n';
import { getToasts, toast } from '@/ui/Toast';
import { ContactOwnerModal } from './ContactOwnerModal';

const mocks = vi.hoisted(() => ({
  callFn: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('@/data/callables', () => ({
  callFn: mocks.callFn,
}));

vi.mock('@/data/auth', () => ({
  signIn: mocks.signIn,
  isLoginRedirectingError: (err: unknown) => Boolean(
    err && typeof err === 'object' && (err as { isRedirecting?: unknown }).isRedirecting === true,
  ),
}));

function fill(values = { name: '小明', contact: 'line-id', content: '你好' }): void {
  fireEvent.input(screen.getByRole('textbox', { name: '稱呼' }), { target: { value: values.name } });
  fireEvent.input(screen.getByRole('textbox', { name: '聯絡方式（Email／LINE ID／電話）' }), {
    target: { value: values.contact },
  });
  fireEvent.input(screen.getByRole('textbox', { name: '想說的話' }), { target: { value: values.content } });
}

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>再打開</button>
      <ContactOwnerModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

beforeEach(async () => {
  mocks.callFn.mockReset();
  mocks.signIn.mockReset();
  mocks.signIn.mockResolvedValue({ uid: 'u1' });
  mocks.callFn.mockResolvedValue({ ok: true, id: 'm1' });
  toast.clear();
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  toast.clear();
  _resetOverlayBackForTest();
  vi.useRealTimers();
});

describe('ContactOwnerModal', () => {
  it('欄位只有 placeholder，必填未過不送出，並標出未填欄', () => {
    render(<ContactOwnerModal open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: '聯繫站長' })).toBeTruthy();
    expect(screen.queryByText('請填寫')).toBeNull();
    expect(screen.getByRole('textbox', { name: '稱呼' }).getAttribute('maxlength')).toBe('60');
    expect(screen.getByRole('textbox', { name: '聯絡方式（Email／LINE ID／電話）' }).getAttribute('maxlength')).toBe('160');
    expect(screen.getByRole('textbox', { name: '想說的話' }).getAttribute('maxlength')).toBe('2000');
    expect(screen.getByText('0／1000')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    expect(mocks.callFn).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '稱呼' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('textbox', { name: '聯絡方式（Email／LINE ID／電話）' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('textbox', { name: '想說的話' }).getAttribute('aria-invalid')).toBe('true');

    fill({ name: '   ', contact: 'line-id', content: '你好' });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    expect(mocks.callFn).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '稱呼' }).getAttribute('aria-invalid')).toBe('true');
  });

  it('字數跟著想說的話更新', () => {
    render(<ContactOwnerModal open onClose={vi.fn()} />);
    fireEvent.input(screen.getByRole('textbox', { name: '想說的話' }), { target: { value: '你好' } });
    expect(screen.getByText('2／1000')).toBeTruthy();
  });

  it('送出成功顯示完成，約 1.6 秒後關閉並清空', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    fill({ name: '  小明  ', contact: ' line-id ', content: ' 你好 ' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出' }));
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    expect(mocks.callFn).toHaveBeenCalledWith('submitContactMessage', {
      name: '小明',
      contact: 'line-id',
      content: '你好',
      source: 'fcb',
    });
    expect(screen.getByRole('status').textContent).toContain('已送出，謝謝你的訊息');
    expect(screen.queryByRole('button', { name: '送出' })).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1599);
    });
    expect(screen.getByRole('dialog', { name: '聯繫站長' })).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再打開' }));
    expect((screen.getByRole('textbox', { name: '稱呼' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('textbox', { name: '想說的話' }) as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('0／1000')).toBeTruthy();
  });

  it('送出中不能重複送', async () => {
    let release: (value: unknown) => void = () => undefined;
    mocks.callFn.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));
    render(<ContactOwnerModal open onClose={vi.fn()} />);
    fill();
    const form = document.querySelector('form');
    expect(form).toBeTruthy();
    await act(async () => {
      fireEvent.submit(form!);
      fireEvent.submit(form!);
    });
    expect(mocks.callFn).toHaveBeenCalledTimes(1);
    const pending = screen.getByRole('button', { name: '送出中' }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);

    await act(async () => {
      release({ success: true });
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toContain('已送出，謝謝你的訊息');
  });

  it('CONTACT_RATE_LIMITED 與一般失敗顯示對應 toast，並保留已填內容', async () => {
    mocks.callFn.mockRejectedValueOnce({
      code: 'functions/resource-exhausted',
      message: 'slow down',
      details: { code: 'CONTACT_RATE_LIMITED' },
    });
    render(<ContactOwnerModal open onClose={vi.fn()} />);
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出' }));
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(getToasts()[0]?.message).toBe('送出太頻繁，請稍後再試');
    expect((screen.getByRole('textbox', { name: '稱呼' }) as HTMLInputElement).value).toBe('小明');
    expect((screen.getByRole('textbox', { name: '想說的話' }) as HTMLTextAreaElement).value).toBe('你好');
    expect(mocks.signIn).not.toHaveBeenCalled();

    toast.clear();
    mocks.callFn.mockRejectedValueOnce({ code: 'functions/internal', message: 'boom' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出' }));
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(getToasts()[0]?.message).toBe('送出失敗，請稍後再試');
    expect((screen.getByRole('textbox', { name: '稱呼' }) as HTMLInputElement).value).toBe('小明');
  });

  it('unauthenticated 走登入、不開失敗 toast，內容保留', async () => {
    mocks.callFn.mockRejectedValueOnce({ code: 'functions/unauthenticated', message: 'auth' });
    render(<ContactOwnerModal open onClose={vi.fn()} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
    expect(getToasts()).toEqual([]);
    expect((screen.getByRole('textbox', { name: '聯絡方式（Email／LINE ID／電話）' }) as HTMLInputElement).value).toBe('line-id');
  });

  it('送出中不能關（返回鍵擋下並提示），送完才結束', async () => {
    let release: (value: unknown) => void = () => undefined;
    mocks.callFn.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));
    render(<Harness />);
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出' }));
      await Promise.resolve();
    });
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('dialog', { name: '聯繫站長' })).toBeTruthy();
    expect(getToasts().some((item) => item.message === '資料儲存中，請稍候')).toBe(true);

    await act(async () => {
      release({ ok: true, id: 'm1' });
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toContain('已送出，謝謝你的訊息');
  });

  it('CONTACT_DAILY_LIMIT 顯示太頻繁；INVALID_* 標出對應欄位', async () => {
    mocks.callFn.mockRejectedValueOnce({
      code: 'functions/resource-exhausted',
      details: { code: 'CONTACT_DAILY_LIMIT' },
    });
    render(<ContactOwnerModal open onClose={vi.fn()} />);
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出' }));
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(getToasts()[0]?.message).toBe('送出太頻繁，請稍後再試');

    toast.clear();
    mocks.callFn.mockRejectedValueOnce({
      code: 'functions/invalid-argument',
      details: { code: 'INVALID_CONTACT' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出' }));
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(screen.getByRole('textbox', { name: '聯絡方式（Email／LINE ID／電話）' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('textbox', { name: '稱呼' }).getAttribute('aria-invalid')).toBeNull();
  });

  it('重新登入正在導向時不提示送出失敗；登入真的失敗才提示', async () => {
    mocks.callFn.mockRejectedValue({ code: 'functions/unauthenticated', message: 'auth' });
    mocks.signIn.mockRejectedValueOnce({ isRedirecting: true });
    render(<ContactOwnerModal open onClose={vi.fn()} />);
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出' }));
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(getToasts()).toEqual([]);

    mocks.signIn.mockRejectedValueOnce(new Error('popup closed'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出' }));
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(getToasts()[0]?.message).toBe('送出失敗，請稍後再試');
  });

  it('返回鍵關閉彈窗', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: '聯繫站長' })).toBeTruthy();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
