import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/callables', () => ({ callFn: vi.fn() }));
vi.mock('@/data/inbox-delivery', () => ({
  deliverInboxMessage: vi.fn(),
  buildInboxDeliveryDedupeKey: vi.fn(),
}));
vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn().mockResolvedValue({ db: {} }),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
}));

import { getDoc, getDocs } from 'firebase/firestore';

import { callFn } from '@/data/callables';
import { deliverInboxMessage } from '@/data/inbox-delivery';

import {
  DEFAULT_NOTIF_TEMPLATES,
  isForcedLinePushSource,
  LINE_PUSH_FORCED_ON_SOURCES,
  renderTemplate,
  sendTemplateNotification,
  shouldSkipLinePushByToggles,
} from './notify';

function mockNoCustomTemplate(): void {
  vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);
}

function mockCustomTemplate(data: { title?: unknown; body?: unknown }): void {
  vi.mocked(getDocs).mockResolvedValue({
    docs: [{ data: () => data }],
  } as never);
}

function mockToggles(toggles: Record<string, unknown>): void {
  vi.mocked(getDoc).mockResolvedValue({
    exists: () => true,
    data: () => ({ notificationToggles: toggles }),
  } as never);
}

function mockNoToggles(): void {
  vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);
}

beforeEach(() => {
  vi.mocked(callFn).mockReset();
  vi.mocked(deliverInboxMessage).mockReset();
  vi.mocked(getDocs).mockReset();
  vi.mocked(getDoc).mockReset();
});

// ── 內建範本逐字 golden ───────────────────────────

describe('DEFAULT_NOTIF_TEMPLATES', () => {
  it('event_changed 逐字 golden（含換行）', () => {
    expect(DEFAULT_NOTIF_TEMPLATES['event_changed']).toEqual({
      title: '活動變更通知',
      body: '您報名的活動資訊有所變更，請留意：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如因變更需要取消報名，請至活動頁面操作。',
    });
  });

  it('event_cancelled 逐字 golden', () => {
    expect(DEFAULT_NOTIF_TEMPLATES['event_cancelled']).toEqual({
      title: '活動取消通知',
      body: '很抱歉通知您，以下活動因故取消：\n\n活動名稱：{eventName}\n原定時間：{date}\n原定地點：{location}\n\n如您已繳費，費用將於 3 個工作天內退還。造成不便深感抱歉。',
    });
  });

  it('cancel_signup 使用 A fallbackTemplates 覆寫版本', () => {
    expect(DEFAULT_NOTIF_TEMPLATES['cancel_signup']).toEqual({
      title: '取消報名通知',
      body: '{status}：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如之後想再次參加，請回到活動頁重新報名。',
    });
  });

  it('waitlist_demoted 使用 A fallbackTemplates 覆寫版本', () => {
    expect(DEFAULT_NOTIF_TEMPLATES['waitlist_demoted']).toEqual({
      title: '候補調整通知',
      body: '很抱歉通知您，因活動名額調整，您的報名狀態已改為候補。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n若有名額釋出，系統將依候補順序自動遞補。',
    });
  });
});

// ── renderTemplate ───────────────────────────────

describe('renderTemplate', () => {
  it('代入已知變數', () => {
    expect(renderTemplate('Hi {name}!', { name: 'Sam' })).toBe('Hi Sam!');
  });

  it('找不到的變數保留 {key} 原樣', () => {
    expect(renderTemplate('Hi {name} and {other}', { name: 'Sam' })).toBe(
      'Hi Sam and {other}',
    );
  });

  it('vars 為 null 時全部保留', () => {
    expect(renderTemplate('Hi {name}', null)).toBe('Hi {name}');
  });

  it('值為 null 時也保留原變數', () => {
    expect(renderTemplate('Hi {name}', { name: null })).toBe('Hi {name}');
  });

  it('空字串回空字串', () => {
    expect(renderTemplate('', {})).toBe('');
  });
});

// ── LINE 強制來源／toggle 判斷 ────────────────────

describe('isForcedLinePushSource', () => {
  it('所有強制來源都為 true', () => {
    for (const source of LINE_PUSH_FORCED_ON_SOURCES) {
      expect(isForcedLinePushSource(source)).toBe(true);
    }
  });

  it('target: 前綴為 true', () => {
    expect(isForcedLinePushSource('target:abc')).toBe(true);
  });

  it('其他來源為 false', () => {
    expect(isForcedLinePushSource('template:signup_success')).toBe(false);
    expect(isForcedLinePushSource('client:something')).toBe(false);
  });

  it('前後空白不影響判斷', () => {
    expect(isForcedLinePushSource('  template:event_changed  ')).toBe(true);
  });
});

describe('shouldSkipLinePushByToggles', () => {
  it('類別關閉 → skip', () => {
    expect(
      shouldSkipLinePushByToggles('activity', 'template:signup_success', {
        category_activity: false,
      }),
    ).toBe(true);
  });

  it('類型關閉 → skip', () => {
    expect(
      shouldSkipLinePushByToggles('activity', 'template:signup_success', {
        type_signup_success: false,
      }),
    ).toBe(true);
  });

  it('強制來源不受 category／type toggle 影響', () => {
    expect(
      shouldSkipLinePushByToggles('activity', 'template:event_changed', {
        category_activity: false,
        type_event_changed: false,
      }),
    ).toBe(false);
  });

  it('未設定的 toggle 預設不 skip', () => {
    expect(shouldSkipLinePushByToggles('activity', 'template:foo', {})).toBe(false);
  });

  it('toggle 為 true 時不 skip', () => {
    expect(
      shouldSkipLinePushByToggles('system', 'template:role_upgrade', {
        category_system: true,
        type_role_upgrade: true,
      }),
    ).toBe(false);
  });
});

// ── sendTemplateNotification ─────────────────────

describe('sendTemplateNotification', () => {
  const baseInput = {
    key: 'event_changed',
    vars: { eventName: '測試活動', date: '2026/05/09 15:00', location: '台北' },
    targetUid: 'U-recipient',
    category: 'activity',
    categoryName: '活動',
    senderUid: 'U-sender',
  } as const;

  it('自訂範本缺少 body → 退回內建範本', async () => {
    mockCustomTemplate({ title: '自訂標題', body: '' });
    mockToggles({});
    vi.mocked(deliverInboxMessage).mockResolvedValueOnce({ dedupeKey: 'k-1' } as never);
    vi.mocked(callFn).mockResolvedValueOnce({} as never);

    const result = await sendTemplateNotification({ ...baseInput });

    expect(result.delivered).toBe(true);
    expect(vi.mocked(deliverInboxMessage)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(deliverInboxMessage).mock.calls[0]![0];
    expect(call.title).toBe('活動變更通知');
    expect(call.body).toContain('活動名稱：測試活動');
    expect(call.body).not.toContain('{eventName}');
    expect(call.senderName).toBe('系統');
  });

  it('自訂範本 title 與 body 都有 → 使用自訂範本', async () => {
    mockCustomTemplate({ title: '自訂 {eventName}', body: '自訂內文 {location}' });
    mockNoToggles();
    vi.mocked(deliverInboxMessage).mockResolvedValueOnce({ dedupeKey: 'k-2' } as never);
    vi.mocked(callFn).mockResolvedValueOnce({} as never);

    await sendTemplateNotification({ ...baseInput });

    const call = vi.mocked(deliverInboxMessage).mock.calls[0]![0];
    expect(call.title).toBe('自訂 測試活動');
    expect(call.body).toBe('自訂內文 台北');
  });

  it('找不到自訂範本且 key 不在內建 → template_missing', async () => {
    mockNoCustomTemplate();

    const result = await sendTemplateNotification({
      ...baseInput,
      key: 'unknown_key',
    });

    expect(result).toEqual({
      delivered: false,
      linePushed: false,
      reason: 'template_missing',
    });
    expect(deliverInboxMessage).not.toHaveBeenCalled();
    expect(callFn).not.toHaveBeenCalled();
  });

  it('收件匣失敗不丟例外，也不呼叫 Callable', async () => {
    mockNoCustomTemplate();
    mockToggles({});
    vi.mocked(deliverInboxMessage).mockRejectedValueOnce(new Error('inbox boom'));

    const result = await sendTemplateNotification({ ...baseInput });

    expect(result).toEqual({ delivered: false, linePushed: false });
    expect(callFn).not.toHaveBeenCalled();
  });

  it('category toggle 關閉時不呼叫 Callable', async () => {
    mockNoCustomTemplate();
    mockToggles({ category_activity: false });
    vi.mocked(deliverInboxMessage).mockResolvedValueOnce({ dedupeKey: 'k-3' } as never);

    const result = await sendTemplateNotification({
      ...baseInput,
      key: 'signup_success',
      vars: {
        eventName: 'E',
        date: 'D',
        location: 'L',
        status: '成功',
      },
    });

    expect(result.delivered).toBe(true);
    expect(result.linePushed).toBe(false);
    expect(callFn).not.toHaveBeenCalled();
  });

  it('type toggle 關閉時不呼叫 Callable', async () => {
    mockNoCustomTemplate();
    mockToggles({ type_signup_success: false });
    vi.mocked(deliverInboxMessage).mockResolvedValueOnce({ dedupeKey: 'k-4' } as never);

    const result = await sendTemplateNotification({
      ...baseInput,
      key: 'signup_success',
      vars: {
        eventName: 'E',
        date: 'D',
        location: 'L',
        status: '成功',
      },
    });

    expect(result.linePushed).toBe(false);
    expect(callFn).not.toHaveBeenCalled();
  });

  it('強制來源即使 toggle 關閉也照樣呼叫 Callable', async () => {
    mockNoCustomTemplate();
    mockToggles({ category_activity: false, type_event_changed: false });
    vi.mocked(deliverInboxMessage).mockResolvedValueOnce({ dedupeKey: 'k-5' } as never);
    vi.mocked(callFn).mockResolvedValueOnce({} as never);

    const result = await sendTemplateNotification({ ...baseInput });

    expect(result.delivered).toBe(true);
    expect(result.linePushed).toBe(true);
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(callFn).mock.calls[0]![0]).toBe('enqueuePrivilegedLineNotification');
    const payload = vi.mocked(callFn).mock.calls[0]![1] as Record<string, unknown>;
    expect(payload['uid']).toBe('U-recipient');
    expect(payload['source']).toBe('template:event_changed');
    expect(payload['dedupeKey']).toBe('k-5');
  });

  it('lineOptions.source 覆寫 template:key', async () => {
    mockNoCustomTemplate();
    mockNoToggles();
    vi.mocked(deliverInboxMessage).mockResolvedValueOnce({ dedupeKey: 'k-6' } as never);
    vi.mocked(callFn).mockResolvedValueOnce({} as never);

    await sendTemplateNotification({
      ...baseInput,
      lineOptions: { source: 'template:event_changed_override' },
    });

    const payload = vi.mocked(callFn).mock.calls[0]![1] as Record<string, unknown>;
    expect(payload['source']).toBe('template:event_changed_override');
  });

  it('lineOptions.dedupeKey 優先於收件匣 dedupeKey', async () => {
    mockNoCustomTemplate();
    mockNoToggles();
    vi.mocked(deliverInboxMessage).mockResolvedValueOnce({ dedupeKey: 'from-inbox' } as never);
    vi.mocked(callFn).mockResolvedValueOnce({} as never);

    await sendTemplateNotification({
      ...baseInput,
      lineOptions: { dedupeKey: 'from-options' },
    });

    const payload = vi.mocked(callFn).mock.calls[0]![1] as Record<string, unknown>;
    expect(payload['dedupeKey']).toBe('from-options');
  });

  it('LINE Callable 失敗仍回 delivered=true、linePushed=false', async () => {
    mockNoCustomTemplate();
    mockNoToggles();
    vi.mocked(deliverInboxMessage).mockResolvedValueOnce({ dedupeKey: 'k-8' } as never);
    vi.mocked(callFn).mockRejectedValueOnce(new Error('line boom'));

    const result = await sendTemplateNotification({ ...baseInput });

    expect(result).toEqual({ delivered: true, linePushed: false });
  });

  it('loadNotifTemplate 失敗（getDocs 擲錯）時退回內建範本', async () => {
    vi.mocked(getDocs).mockRejectedValueOnce(new Error('read boom'));
    mockNoToggles();
    vi.mocked(deliverInboxMessage).mockResolvedValueOnce({ dedupeKey: 'k-9' } as never);
    vi.mocked(callFn).mockResolvedValueOnce({} as never);

    const result = await sendTemplateNotification({ ...baseInput });

    expect(result.delivered).toBe(true);
    const call = vi.mocked(deliverInboxMessage).mock.calls[0]![0];
    expect(call.title).toBe('活動變更通知');
  });
});
