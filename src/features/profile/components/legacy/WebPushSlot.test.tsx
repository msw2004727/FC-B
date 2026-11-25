import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
// lazy() 第一次載入後就不再暫停；記號每個測試先暫停一次，「列到之前放不放空白」才每案都驗得到。
const gate = vi.hoisted(() => ({ pending: null as Promise<void> | null }));
vi.mock('../../web-push/WebPushRow', () => ({
  default: ({ env, uiPublic }: { env: string; uiPublic: boolean }) => {
    if (gate.pending) throw gate.pending;
    return <div class="wp-block" data-env={env} data-public={String(uiPublic)} />;
  },
}));
// 正式常數已是 true；開通前（false）的保護用注入繼續測。
const flag = vi.hoisted(() => ({ uiPublic: null as boolean | null }));
vi.mock('../../web-push/env', async (orig) => {
  const real = await orig<typeof import('../../web-push/env')>();
  return {
    ...real,
    get WEB_PUSH_UI_PUBLIC() {
      return flag.uiPublic ?? real.WEB_PUSH_UI_PUBLIC;
    },
  };
});

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

beforeEach(() => {
  gate.pending = new Promise((resolve) =>
    setTimeout(() => {
      gate.pending = null;
      resolve();
    }, 0),
  );
});

afterEach(() => {
  cleanup();
  flag.uiPublic = null;
});

describe('U 推播列位置（LegacyLineNotifyCard）', () => {
  it('不支援的瀏覽器（jsdom 沒有 PushManager）→ 不畫推播列、也沒有分隔線或空白', () => {
    const { container } = render(<LegacyLineNotifyCard uid="u1" profile={PROFILE} onSaved={() => {}} embedded />);
    expect(container.querySelector('.wp-block, .wp-sep, .wp-placeholder')).toBeNull();
  });

  it('支援時（正式常數，已公開）：embedded 才有，列到之前先放等高空白，位置在「？」與 LINE 區之間', async () => {
    const restore = stubCapable();
    try {
      const { container, findByText } = render(
        <LegacyLineNotifyCard uid="u1" profile={PROFILE} onSaved={() => {}} embedded />,
      );
      void findByText;
      const body = container.querySelector('#profile-line-notify')!;
      expect(body.querySelector('.wp-placeholder')).not.toBeNull();
      await vi.waitFor(() => expect(body.querySelector('.wp-block')).not.toBeNull());
      expect(body.querySelector('.wp-placeholder')).toBeNull();
      expect(body.querySelector('.wp-block')?.getAttribute('data-public')).toBe('true');
      const kids = [...body.children];
      const help = kids.findIndex((el) => el.classList.contains('profile-quick-help'));
      const line = kids.findIndex((el) => el.classList.contains('profile-collapse-content'));
      const slot = kids.findIndex((el) => el.matches('.wp-block'));
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

  it('注入開通前（uiPublic=false）：列到之前不放空白（審查 P2-2），並把 false 傳給推播列', async () => {
    flag.uiPublic = false;
    const restore = stubCapable();
    try {
      const { container } = render(<LegacyLineNotifyCard uid="u1" profile={PROFILE} onSaved={() => {}} embedded />);
      const body = container.querySelector('#profile-line-notify')!;
      expect(body.querySelector('.wp-placeholder')).toBeNull();
      await vi.waitFor(() => expect(body.querySelector('.wp-block')).not.toBeNull());
      expect(body.querySelector('.wp-block')?.getAttribute('data-public')).toBe('false');
    } finally {
      restore();
    }
  });
});
