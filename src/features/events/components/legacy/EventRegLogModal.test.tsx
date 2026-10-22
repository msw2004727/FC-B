import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventRegLogModal } from './EventRegLogModal';
import type { RegLogEntry } from '../../data/event-reg-log';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), pushOverlay: vi.fn(), release: vi.fn(),
}));
vi.mock('../../data/event-reg-log', async original => ({
  ...(await original<typeof import('../../data/event-reg-log')>()),
  loadEventRegLog: mocks.load,
}));
vi.mock('@/core/overlay-back', () => ({ pushOverlay: mocks.pushOverlay }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pushOverlay.mockReturnValue(mocks.release);
});
afterEach(() => cleanup());

it('載入、空資料、返回鍵與卸載釋放', async () => {
  let resolve!: (entries: RegLogEntry[]) => void;
  mocks.load.mockReturnValue(new Promise(done => { resolve = done; }));
  const close = vi.fn();
  const view = render(<EventRegLogModal eventId="public" eventDocId="doc" cachedRegistrations={[]} onClose={close} />);
  expect(screen.getByText('載入中…')).toBeTruthy();
  await waitFor(() => expect(mocks.pushOverlay).toHaveBeenCalledOnce());
  resolve([]);
  expect(await screen.findByText('尚無報名紀錄')).toBeTruthy();
  const back = mocks.pushOverlay.mock.calls[0]?.[0] as () => boolean;
  expect(back()).toBe(true);
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  expect(mocks.release).toHaveBeenCalledOnce();
});

it('輸出 A class，名稱以文字呈現；內框點擊不關閉', async () => {
  mocks.load.mockResolvedValue([{
    ms: 1000, userName: '<img src=x>', action: 'team', label: '建立席位', actionClass: 'promote',
  }]);
  const close = vi.fn();
  const view = render(<EventRegLogModal eventId="public" eventDocId="doc" cachedRegistrations={[]} onClose={close} />);
  expect(await screen.findByText('<img src=x>')).toBeTruthy();
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.querySelector('.event-reg-log-action.promote')?.textContent).toBe('建立席位');
  fireEvent.click(screen.getByText('報名紀錄'));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '關閉' }));
  expect(close).toHaveBeenCalledOnce();
});

it('較舊請求晚到不覆蓋新活動', async () => {
  let first!: (entries: RegLogEntry[]) => void;
  mocks.load.mockReturnValueOnce(new Promise(done => { first = done; })).mockResolvedValueOnce([]);
  const view = render(<EventRegLogModal eventId="a" eventDocId="a-doc" cachedRegistrations={[]} onClose={() => {}} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  view.rerender(<EventRegLogModal eventId="b" eventDocId="b-doc" cachedRegistrations={[]} onClose={() => {}} />);
  await screen.findByText('尚無報名紀錄');
  first([{ ms: 1, userName: '舊資料', action: 'register', label: '報名', actionClass: 'reg' }]);
  await waitFor(() => expect(screen.queryByText('舊資料')).toBeNull());
});
