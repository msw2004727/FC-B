import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';

vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: vi.fn() }));
vi.mock('@/features/events/data/line-notify-bind', () => ({
  bindLineNotify: vi.fn(),
  buildLineNotifyPayload: vi.fn(),
  LINE_BOT_BASIC_ID: '@830utvza',
}));
vi.mock('@/data/liff-init', () => ({ getReadyLiff: vi.fn(() => null) }));
vi.mock('./ProfileInfoButton', () => ({
  ProfileInfoButton: () => <button type="button">?</button>,
}));
// 推播列本體換成記號，只驗位置與「不支援就不畫」。
vi.mock('../../web-push/WebPushRow', () => ({
  default: ({ env }: { env: string }) => <div class="wp-block" data-env={env} />,
}));

import { LegacyLineNotifyCard } from './LegacyLineNotifyCard';

const PROFILE = { uid: 'u1', name: 'A', _docId: 'u1', lastActive: null, lineNotify: { bound: false, settings: {} } };

function stubCapable(): () => void {
  const w = window as unknown as Record<string, unknown>;
  w.Notification = function Notification() {};
  w.PushManager = function PushManager() {};
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
  return () => {
    delete w.Notification;
    delete w.PushManager;
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  };
}

afterEach(() => {
  cleanup();
});

describe('U 推播列位置（LegacyLineNotifyCard）', () => {
  it('不支援的瀏覽器（jsdom 沒有 PushManager）→ 不畫推播列、也沒有分隔線或空白', () => {
    const { container } = render(<LegacyLineNotifyCard uid="u1" profile={PROFILE} onSaved={() => {}} embedded />);
    expect(container.querySelector('.wp-block, .wp-sep, .wp-placeholder')).toBeNull();
  });

  it('支援時：embedded 才有，位置在「？」與 LINE 區之間；列到之前先放等高空白', async () => {
    const restore = stubCapable();
    try {
      const { container, findByText } = render(
        <LegacyLineNotifyCard uid="u1" profile={PROFILE} onSaved={() => {}} embedded />,
      );
      void findByText;
      const body = container.querySelector('#profile-line-notify')!;
      const first = body.querySelector('.wp-placeholder, .wp-block');
      expect(first).not.toBeNull();
      const kids = [...body.children];
      const help = kids.findIndex((el) => el.classList.contains('profile-quick-help'));
      const line = kids.findIndex((el) => el.classList.contains('profile-collapse-content'));
      const slot = kids.findIndex((el) => el.matches('.wp-placeholder, .wp-block'));
      expect(help).toBeLessThan(slot);
      expect(slot).toBeLessThan(line);
      await vi.waitFor(() => expect(body.querySelector('.wp-block')?.getAttribute('data-env')).toBe('capable'));

      cleanup();
      const card = render(<LegacyLineNotifyCard uid="u1" profile={PROFILE} onSaved={() => {}} />);
      expect(card.container.querySelector('.wp-block, .wp-placeholder')).toBeNull();
    } finally {
      restore();
    }
  });
});
