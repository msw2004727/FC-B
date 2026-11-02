// 通知腳本編輯：開彈窗讀 notifTemplates ≤ 20、缺的基本範本補預設、只寫有改動或缺漏的。
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeState, limitOf, resetFakeFirestore, totalReads } from '../fake-firestore.test-helper';
import { NOTIF_TEMPLATES_READ_LIMIT, loadEditableTemplates, saveTemplates } from './notif-templates-admin';

vi.mock('firebase/firestore', async () => (await import('../fake-firestore.test-helper')).fakeSdk);
// 非同步 mock 工廠先解析一次，避免頁面同時動態載入兩次時拿到真的 SDK。
beforeAll(async () => {
  await import('firebase/firestore');
});
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: { __db: true } }) }));

beforeEach(() => {
  resetFakeFirestore();
});

describe('loadEditableTemplates', () => {
  it('讀 1 次（limit 20），排序照 A 的佔位符清單，缺的補預設', async () => {
    fakeState.docsHandler = () => [
      { id: 'zzz_custom', data: { key: 'zzz_custom', title: '自訂', body: '自訂內容' } },
      { id: 'welcome', data: { key: 'welcome', title: '歡迎', body: '嗨' } },
      { id: 'role_upgrade', data: { key: 'role_upgrade', title: '升級', body: '恭喜' } },
    ];
    const list = await loadEditableTemplates();
    expect(totalReads()).toBeLessThanOrEqual(NOTIF_TEMPLATES_READ_LIMIT);
    expect(limitOf(fakeState.reads[0]?.q)).toBe(20);
    expect(list.map((t) => t.key)).toEqual([
      'welcome',
      'signup_success',
      'cancel_signup',
      'waitlist_promoted',
      'waitlist_demoted',
      'event_cancelled',
      'role_upgrade',
      'role_application',
      'event_changed',
      'event_relisted',
      'zzz_custom',
    ]);
    expect(list[0]).toEqual({ key: 'welcome', title: '歡迎', body: '嗨', missing: false });
    expect(list.find((t) => t.key === 'cancel_signup')).toMatchObject({ missing: true, title: '取消報名通知' });
    expect(list.find((t) => t.key === 'cancel_signup')?.body.startsWith('{status}。')).toBe(true);
  });
});

describe('saveTemplates', () => {
  const original = [
    { key: 'welcome', title: '歡迎', body: '嗨', missing: false },
    { key: 'role_upgrade', title: '升級', body: '恭喜', missing: false },
    { key: 'event_relisted', title: '重新上架', body: '...', missing: true },
  ];

  it('只寫改過的與缺漏的；新建的補 createdAt', async () => {
    const edited = original.map((t) => (t.key === 'welcome' ? { ...t, body: '嗨嗨' } : t));
    expect(await saveTemplates(original, edited)).toBe(2);
    expect(fakeState.writes.map((w) => w.path)).toEqual(['notifTemplates/welcome', 'notifTemplates/event_relisted']);
    const welcome = fakeState.writes[0]?.data as Record<string, unknown>;
    expect(welcome).toMatchObject({ key: 'welcome', title: '歡迎', body: '嗨嗨' });
    expect(welcome['createdAt']).toBeUndefined();
    expect((fakeState.writes[1]?.data as Record<string, unknown>)['createdAt']).toEqual({ __serverTimestamp: true });
  });

  it('沒有改動也沒有缺漏：0 寫', async () => {
    const clean = original.filter((t) => !t.missing);
    expect(await saveTemplates(clean, clean)).toBe(0);
    expect(fakeState.writes).toEqual([]);
  });
});
