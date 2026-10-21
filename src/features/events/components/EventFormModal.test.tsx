import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _setDictLoaderForTest, initLocale } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { ViewerView } from '@/features/profile/data/viewer';
import zhTW from '../locales/zh-TW.json';
import * as eventCreateMod from '../data/event-create';
import { EventFormModal } from './EventFormModal';

vi.mock('../data/event-create', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/event-create')>();
  return {
    ...actual,
    newEventId: vi.fn(() => 'ce_fixed_id_001'),
    createEvent: vi.fn(),
    updateEventBasics: vi.fn(),
  };
});

const notifyMocks = vi.hoisted(() => ({
  loadEventNotifyRecipientUids: vi.fn(async () => ['U_reg_1']),
  notifyEventChanged: vi.fn(async () => 1),
}));

vi.mock('../data/event-change-notify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/event-change-notify')>();
  return { ...actual, ...notifyMocks };
});

function flattenDict(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenDict(v as Record<string, unknown>, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

const TEST_VIEWER: ViewerView = {
  uid: 'u_host_1',
  displayName: '測試團主',
  role: 'coach',
  roleLevel: 2,
  capabilities: ['user.activity.basic_create'],
  teamIds: new Set(),
  hasPermission: () => true,
  permissionSources: {
    rolePermissions: ['activity.manage.entry', 'event.create', 'event.edit_self'],
    userGrants: [],
    customRoles: [],
  },
} as unknown as ViewerView;

describe('EventFormModal', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    toast.clear();
    const mergedEvents = zhTW;
    const dict = {
      ...flattenDict(mergedEvents, 'events'),
      'ui.modal.close': '關閉',
      'ui.modal.loading': '載入中',
      'ui.switch.on': '開',
      'ui.switch.off': '關',
    };
    _setDictLoaderForTest(async () => dict);
    await initLocale();
  });

  afterEach(() => {
    cleanup();
    _setDictLoaderForTest(null);
  });

  it('renders legacy A fields and default values when opened in create mode', () => {
    render(
      <EventFormModal
        open={true}
        mode="create"
        viewer={TEST_VIEWER}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );

    expect(screen.getByText('新增活動')).toBeTruthy();
    const titleInput = document.getElementById('ce-title') as HTMLInputElement;
    expect(titleInput.value).toBe('');
    expect(titleInput.maxLength).toBe(16);

    const typeSelect = document.getElementById('ce-type') as HTMLSelectElement;
    expect(typeSelect.value).toBe('play');

    const startInput = document.getElementById('ce-time-start') as HTMLInputElement;
    const endInput = document.getElementById('ce-time-end') as HTMLInputElement;
    expect(startInput.value).toBe('14:00');
    expect(endInput.value).toBe('16:00');

    const maxInput = document.getElementById('ce-max') as HTMLInputElement;
    expect(maxInput.value).toBe('20');

    expect(screen.getByText('開啟 — 指定活動地區')).toBeTruthy();
    expect(screen.getByText('立即開放報名')).toBeTruthy();
    expect(screen.getByText('關閉 — 不限制年齡')).toBeTruthy();
    expect(screen.getByText('* 必選，未選擇運動 / 場景標籤將無法儲存活動')).toBeTruthy();
    expect(screen.getByText('建立活動')).toBeTruthy();
  });

  it('does not call createEvent when validation fails', async () => {
    render(
      <EventFormModal
        open={true}
        mode="create"
        viewer={TEST_VIEWER}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );

    const submitBtn = document.getElementById('ce-submit-btn')!;
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(eventCreateMod.createEvent).not.toHaveBeenCalled();
  });

  it('calls createEvent with the same generated eventId and prevents double-click duplicate submission', async () => {
    let resolveCreate!: (val: Awaited<ReturnType<typeof eventCreateMod.createEvent>>) => void;
    const pendingPromise = new Promise<Awaited<ReturnType<typeof eventCreateMod.createEvent>>>(
      (res) => {
        resolveCreate = res;
      },
    );
    vi.mocked(eventCreateMod.createEvent).mockReturnValue(pendingPromise);

    const onSaved = vi.fn();
    render(
      <EventFormModal
        open={true}
        mode="create"
        viewer={TEST_VIEWER}
        onClose={() => undefined}
        onSaved={onSaved}
      />,
    );

    const titleInput = document.getElementById('ce-title') as HTMLInputElement;
    const locationInput = document.getElementById('ce-location') as HTMLInputElement;
    const dateInput = document.getElementById('ce-date') as HTMLInputElement;

    await act(async () => {
      fireEvent.input(titleInput, { target: { value: '週六足球團' } });
      fireEvent.input(locationInput, { target: { value: '大安森林公園' } });
      fireEvent.input(dateInput, { target: { value: '2099-12-31' } });
    });

    // 選擇運動標籤
    const sportTrigger = document.getElementById('ce-sport-selected')!;
    await act(async () => {
      fireEvent.click(sportTrigger);
    });
    const footballOption = screen.getByRole('option', { name: /足球/ });
    await act(async () => {
      fireEvent.click(footballOption);
    });

    const submitBtn = document.getElementById('ce-submit-btn')!;
    await act(async () => {
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);
    });

    expect(eventCreateMod.createEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(eventCreateMod.createEvent).mock.calls[0]?.[2]).toBe('ce_fixed_id_001');

    await act(async () => {
      resolveCreate({
        eventId: 'ce_fixed_id_001',
        payload: {} as eventCreateMod.EventCreatePayload,
        alreadyExisted: false,
        addonsStripped: false,
      });
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('ce_fixed_id_001');
    });
  });

  it('populates existing event values and calls updateEventBasics in edit mode', async () => {
    vi.mocked(eventCreateMod.updateEventBasics).mockResolvedValue({
      updates: {},
      capacityChange: null,
      addonsStripped: false,
    });

    const existingEvent = {
      id: 'ce_edit_99',
      title: '既有活動名稱',
      type: 'camp',
      location: '台中市運動場',
      date: '2026/08/20 10:00~12:00',
      max: 30,
      minAge: 15,
      notes: '既有注意事項',
      sportTag: 'basketball',
      regionEnabled: true,
      region: '中部',
      cities: ['台中市'],
    };

    const onSaved = vi.fn();
    render(
      <EventFormModal
        open={true}
        mode="edit"
        existing={existingEvent}
        viewer={TEST_VIEWER}
        onClose={() => undefined}
        onSaved={onSaved}
      />,
    );

    expect(screen.getByText('編輯活動')).toBeTruthy();
    expect(screen.getByText('儲存變更')).toBeTruthy();

    const titleInput = document.getElementById('ce-title') as HTMLInputElement;
    expect(titleInput.value).toBe('既有活動名稱');

    const locationInput = document.getElementById('ce-location') as HTMLInputElement;
    expect(locationInput.value).toBe('台中市運動場');

    const dateInput = document.getElementById('ce-date') as HTMLInputElement;
    expect(dateInput.value).toBe('2026-08-20');

    const submitBtn = document.getElementById('ce-submit-btn')!;
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(eventCreateMod.updateEventBasics).toHaveBeenCalledTimes(1);
      expect(onSaved).toHaveBeenCalledWith('ce_edit_99');
    });
  });

  it('編輯後通知欄位有變才送活動變更通知（照 A）', async () => {
    const existingEvent = {
      id: 'ce_edit_99',
      title: '既有活動名稱',
      type: 'camp',
      location: '台中市運動場',
      date: '2026/08/20 10:00~12:00',
      max: 30,
      sportTag: 'basketball',
      regionEnabled: true,
      region: '中部',
      cities: ['台中市'],
    };
    vi.mocked(eventCreateMod.updateEventBasics).mockResolvedValueOnce({
      updates: { title: '新的活動名稱', date: '2026/08/20 10:00~12:00' },
      capacityChange: null,
      addonsStripped: false,
    });
    const view = render(
      <EventFormModal open={true} mode="edit" existing={existingEvent} viewer={TEST_VIEWER}
        onClose={() => undefined} onSaved={() => undefined} />,
    );
    await act(async () => { fireEvent.click(document.getElementById('ce-submit-btn')!); });
    await waitFor(() => expect(notifyMocks.notifyEventChanged).toHaveBeenCalledTimes(1));
    expect((notifyMocks.notifyEventChanged.mock.calls[0] as unknown[])[0]).toMatchObject({
      eventId: 'ce_edit_99',
      recipientUids: ['U_reg_1'],
    });
    view.unmount();

    notifyMocks.notifyEventChanged.mockClear();
    vi.mocked(eventCreateMod.updateEventBasics).mockResolvedValueOnce({
      updates: { image: '' },
      capacityChange: null,
      addonsStripped: false,
    });
    render(
      <EventFormModal open={true} mode="edit" existing={existingEvent} viewer={TEST_VIEWER}
        onClose={() => undefined} onSaved={() => undefined} />,
    );
    await act(async () => { fireEvent.click(document.getElementById('ce-submit-btn')!); });
    await waitFor(() => expect(eventCreateMod.updateEventBasics).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(notifyMocks.notifyEventChanged).not.toHaveBeenCalled();
  });
});

