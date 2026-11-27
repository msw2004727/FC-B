import { createElement } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { UserProfile } from '@/features/profile/data/profile-model';

const sportData = vi.hoisted(() => ({ useSportPrefsEnabled: vi.fn(() => true) }));
const callables = vi.hoisted(() => ({ saveSportPrefs: vi.fn() }));
const confirmMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@/features/sport-prefs/data', () => ({ useSportPrefsEnabled: sportData.useSportPrefsEnabled }));
vi.mock('@/features/sport-prefs/callables', () => ({
  saveSportPrefs: callables.saveSportPrefs,
  SportPrefsCallError: class SportPrefsCallError extends Error {
    code = 'internal';
  },
}));
vi.mock('@/features/sport-prefs/i18n', () => ({
  useSportPrefsT: () => (key: string, params?: Record<string, string | number>) => {
    if (key === 'add') return '喜好通知＋';
    if (key === 'removeConfirm') return `移除${params?.name ?? ''}`;
    if (key === 'removeOk') return '移除';
    if (key === 'toggle') return '每日新活動';
    if (key === 'saveFailed') return '儲存失敗';
    if (key === 'limit') return '已達上限';
    return key;
  },
  sportName: (_t: unknown, key: string) => key,
}));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: confirmMock }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('preact-iso', () => ({ useLocation: () => ({ route: vi.fn() }) }));
vi.mock('@/features/profile/components/legacy/WebPushSlot', () => ({ WebPushSlot: () => null }));
vi.mock('@/features/sport-prefs/SportPrefsModal', () => ({
  default: () => createElement('div', { 'data-testid': 'spf-modal' }),
}));

import { LegacyProfileInfoCard } from '@/features/profile/components/legacy/LegacyProfileCards';
import { LegacyLineNotifyCard } from '@/features/profile/components/legacy/LegacyLineNotifyCard';

function makeProfile(extra: Record<string, unknown> = {}): UserProfile {
  return {
    favSports: ['basketball'],
    sports: '舊運動字串',
    newEventNotify: true,
    ...extra,
  } as unknown as UserProfile;
}

beforeEach(() => {
  vi.clearAllMocks();
  sportData.useSportPrefsEnabled.mockReturnValue(true);
  callables.saveSportPrefs.mockResolvedValue({ favSports: [], newEventNotify: false });
  confirmMock.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe('運動喜好整合', () => {
  it('開關開時個人資料顯示標籤與喜好通知＋', () => {
    const { container } = render(<LegacyProfileInfoCard uid="u1" profile={makeProfile()} onSaved={vi.fn()} embedded />);
    const shown = document.getElementById('profile-info-display')!;
    expect(shown.textContent).toContain('basketball');
    expect(shown.textContent).toContain('喜好通知＋');
    expect(container.querySelector('#profile-sports')).toBeTruthy();
  });

  it('編輯狀態按 × 呼叫 appConfirm 且確認後呼叫 saveSportPrefs({ removeSport })', async () => {
    const onSaved = vi.fn();
    const { container } = render(<LegacyProfileInfoCard uid="u1" profile={makeProfile()} onSaved={onSaved} embedded />);
    fireEvent.click(container.querySelector('#profile-edit-btn')!);
    await waitFor(() => expect(container.querySelector('.fav-row')).toBeTruthy());
    const x = container.querySelector('.fav-tag-x');
    expect(x).toBeTruthy();
    fireEvent.click(x!);
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    await waitFor(() => expect(callables.saveSportPrefs).toHaveBeenCalledWith({ removeSport: 'basketball' }));
    expect(onSaved).toHaveBeenCalledWith({ favSports: [], newEventNotify: false });
  });

  it('取消則不呼叫 saveSportPrefs', async () => {
    confirmMock.mockResolvedValueOnce(false);
    const { container } = render(<LegacyProfileInfoCard uid="u1" profile={makeProfile()} onSaved={vi.fn()} embedded />);
    fireEvent.click(container.querySelector('#profile-edit-btn')!);
    await waitFor(() => expect(container.querySelector('.fav-row')).toBeTruthy());
    const x = container.querySelector('.fav-tag-x');
    expect(x).toBeTruthy();
    fireEvent.click(x!);
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(callables.saveSportPrefs).not.toHaveBeenCalled();
  });

  it('開關關時顯示舊字串且沒有喜好通知＋', () => {
    sportData.useSportPrefsEnabled.mockReturnValue(false);
    const { container } = render(<LegacyProfileInfoCard uid="u1" profile={makeProfile()} onSaved={vi.fn()} embedded />);
    const shown = document.getElementById('profile-info-display')!;
    expect(shown.textContent).toContain('舊運動字串');
    expect(screen.queryAllByText('喜好通知＋')).toHaveLength(0);
    expect(container.querySelector('.fav-tags')).toBeNull();
  });

  it('推播卡開關開時有每日新活動開關，切換呼叫 saveSportPrefs({ newEventNotify: false })', async () => {
    const { container } = render(<LegacyLineNotifyCard uid="u1" profile={makeProfile()} onSaved={vi.fn()} embedded />);
    const cb = container.querySelector('.ne-block input[type="checkbox"]') as HTMLInputElement | null;
    expect(cb).toBeTruthy();
    expect(cb!.checked).toBe(true);
    fireEvent.click(cb!);
    await waitFor(() => expect(callables.saveSportPrefs).toHaveBeenCalledWith({ newEventNotify: false }));
  });
});
