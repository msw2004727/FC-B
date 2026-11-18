import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
}));
vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn().mockResolvedValue({ db: {} }),
}));
vi.mock('@/data/callables', () => ({ callFn: vi.fn() }));
vi.mock('@/data/inbox-delivery', () => ({
  deliverInboxMessage: vi.fn(),
  buildInboxDeliveryDedupeKey: vi.fn(),
}));

import { getDoc, getDocs } from 'firebase/firestore';

import { callFn } from '@/data/callables';
import { deliverInboxMessage } from '@/data/inbox-delivery';

import {
  getEventChangeNotificationDedupeKey,
  hasEventChangeNotificationDiff,
  hashEventChangeNotifyString,
  loadEventNotifyRecipientUids,
  notifyEventChanged,
  EVENT_CHANGE_NOTIFY_FIELDS,
} from './event-change-notify';

beforeEach(() => {
  vi.mocked(callFn).mockReset();
  vi.mocked(deliverInboxMessage).mockReset();
  vi.mocked(getDocs).mockReset();
  vi.mocked(getDoc).mockReset();
});

// ── diff ─────────────────────────────────────────

describe('hasEventChangeNotificationDiff', () => {
  it('改標題 → 有差異', () => {
    expect(
      hasEventChangeNotificationDiff({ title: 'A', location: 'L' }, { title: 'B' }),
    ).toBe(true);
  });

  it('改無關欄位 → 沒差異', () => {
    expect(
      hasEventChangeNotificationDiff(
        { title: 'A', location: 'L', image: 'old' },
        { image: 'new' },
      ),
    ).toBe(false);
  });

  it('existing 為 null → 視為有差異', () => {
    expect(hasEventChangeNotificationDiff(null, { title: 'A' })).toBe(true);
  });

  it('update 不影響既有欄位值時不判定差異（含 Date 正規化）', () => {
    const before = { title: 'T', regOpenTime: new Date('2026-05-01T00:00:00Z') };
    const after = { regOpenTime: new Date('2026-05-01T00:00:00Z') };
    expect(hasEventChangeNotificationDiff(before, after)).toBe(false);
  });
});

// ── 演算法 golden ────────────────────────────────

describe('hashEventChangeNotifyString', () => {
  it('A 演算法手算 golden', () => {
    // hash('test')：116 → 3697 → 114722 → 3556498；base36 = '2487m'
    expect(hashEventChangeNotifyString('test')).toBe('2487m');
    // hash('a')：97；base36 = '2p'
    expect(hashEventChangeNotifyString('a')).toBe('2p');
    // hash('')：0；base36 = '0'
    expect(hashEventChangeNotifyString('')).toBe('0');
  });
});

describe('getEventChangeNotificationDedupeKey', () => {
  it('去重鍵與 A 真實程式逐字相同（golden 由 A 的 _getEventChangeNotificationDedupeKey 實算）', () => {
    // 2026-10-19：A 的欄位清單共 33 個（含收費、私密、地圖等）；golden 用 A 原始碼在 node 實算。
    expect(EVENT_CHANGE_NOTIFY_FIELDS).toHaveLength(33);
    expect(getEventChangeNotificationDedupeKey('e-1', 'u-1', { title: 'test', image: 'ignored' }))
      .toBe('event_changed:e-1:u-1:1d8j68i');
  });

  it('eventId／uid 前後空白會 trim', () => {
    const key1 = getEventChangeNotificationDedupeKey(' e-1 ', ' u-1 ', { title: 't' });
    const key2 = getEventChangeNotificationDedupeKey('e-1', 'u-1', { title: 't' });
    expect(key1).toBe(key2);
  });

  it('title 不同 → hash 不同', () => {
    const a = getEventChangeNotificationDedupeKey('e-1', 'u-1', { title: 'A' });
    const b = getEventChangeNotificationDedupeKey('e-1', 'u-1', { title: 'B' });
    expect(a).not.toBe(b);
  });
});

// ── 收件人 ───────────────────────────────────────

describe('loadEventNotifyRecipientUids', () => {
  it('排除 cancelled／removed，並去重', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        { data: () => ({ userId: 'U1', status: 'confirmed' }) },
        { data: () => ({ userId: 'U2', status: 'cancelled' }) },
        { data: () => ({ userId: 'U3', status: 'removed' }) },
        { data: () => ({ userId: 'U1', status: 'confirmed' }) },
        { data: () => ({ userId: 'U4' }) },
        { data: () => ({ userId: '' }) },
      ],
    } as never);

    const uids = await loadEventNotifyRecipientUids('e-1');
    expect([...uids].sort()).toEqual(['U1', 'U4']);
  });
});

// ── notifyEventChanged ──────────────────────────

describe('notifyEventChanged', () => {
  it('一人失敗其餘照送，回傳成功送達人數', async () => {
    vi.mocked(getDocs)
      .mockResolvedValue({ docs: [] } as never); // 無自訂範本
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);
    vi.mocked(deliverInboxMessage)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ dedupeKey: 'k-ok' } as never);
    vi.mocked(callFn).mockResolvedValue({} as never);

    const count = await notifyEventChanged({
      eventId: 'e-1',
      title: '測試活動',
      date: '2026/05/09',
      location: '台北',
      recipientUids: ['U1', 'U2'],
      eventData: { title: '測試活動' },
      senderUid: 'U-sender',
    });

    expect(count).toBe(1);
    expect(deliverInboxMessage).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(deliverInboxMessage).mock.calls;
    expect(first![0].category).toBe('activity');
    expect(first![0].categoryName).toBe('活動');
    expect(second![0].category).toBe('activity');
    // dedupeKey 走 getEventChangeNotificationDedupeKey（比對字串開頭即可）
    const extra = first![0].extra as { dedupeKey: string };
    expect(extra.dedupeKey.startsWith('event_changed:e-1:U1:')).toBe(true);
  });

  it('sendTemplateNotification 整批失敗仍回 0，不拋出', async () => {
    vi.mocked(getDocs).mockRejectedValue(new Error('read boom'));
    vi.mocked(getDoc).mockRejectedValue(new Error('toggles boom'));
    vi.mocked(deliverInboxMessage).mockRejectedValue(new Error('boom'));

    const count = await notifyEventChanged({
      eventId: 'e-1',
      title: 'T',
      date: 'D',
      location: 'L',
      recipientUids: ['U1', 'U2'],
      eventData: { title: 'T' },
      senderUid: 'U-sender',
    });

    expect(count).toBe(0);
  });
});
