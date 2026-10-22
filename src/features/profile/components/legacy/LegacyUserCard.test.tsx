import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/Toast', () => ({ toast: vi.fn() }));
vi.mock('../../data/profile-model', () => ({ loadUserProfile: vi.fn() }));
vi.mock('../../data/activity-records', () => ({
  loadUserStats: vi.fn(),
  getFilteredRecords: vi.fn(() => []),
  RECORDS_PAGE_SIZE: 10,
}));
vi.mock('../../data/attendance-summary', () => ({
  loadUserAttendanceSummary: vi.fn(),
}));
vi.mock('../../data/viewer', () => ({ useViewer: vi.fn() }));
vi.mock('@/data/identity-settings', () => ({ useIdentitySettings: vi.fn(() => null) }));

import { loadUserStats, getFilteredRecords } from '../../data/activity-records';
import { loadUserAttendanceSummary } from '../../data/attendance-summary';
import { loadUserProfile, type UserProfile } from '../../data/profile-model';
import { useViewer, type ViewerView } from '../../data/viewer';

import { LegacyUserCard } from './LegacyUserCard';

function makeViewer(overrides: Partial<ViewerView> = {}): ViewerView {
  return {
    uid: 'viewer-uid',
    role: 'user',
    displayName: 'viewer',
    pictureUrl: null,
    capabilities: [],
    hasPermission: () => false,
    ...overrides,
  } as unknown as ViewerView;
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'target-uid',
    name: 'Bob',
    _docId: 'target-uid',
    lastActive: null,
    displayName: 'Bob',
    phone: '0912345678',
    gender: '男',
    birthday: '1990-01-01',
    region: '台北市',
    sports: '籃球',
    createdAt: null,
    role: 'user',
    pictureUrl: 'https://example.com/bob.jpg',
    ...overrides,
  };
}

describe('LegacyUserCard（照 A showUserProfile）', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    vi.clearAllMocks();
    vi.mocked(loadUserProfile).mockResolvedValue(makeProfile());
    vi.mocked(loadUserStats).mockResolvedValue({
      uid: 'target-uid',
      activityRecords: [],
      attendanceRecords: [],
    });
    vi.mocked(loadUserAttendanceSummary).mockResolvedValue({
      uid: 'target-uid',
      exists: true,
      sourceVersion: 1,
      expectedCount: 5,
      attendedCount: 4,
      completedCount: 4,
      attendRate: 80,
      updatedAt: null,
    });
    vi.mocked(getFilteredRecords).mockReturnValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('一般登入者看他人 → DOM 中沒有「聯繫方式」列與電話', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());

    expect(container.textContent).toContain('基本資料');
    expect(container.textContent).toContain('加入時間');
    expect(container.textContent).not.toContain('聯繫方式');
    expect(container.textContent).not.toContain('0912345678');
  });

  it('本人看自己 → 有「聯繫方式」列與電話', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'target-uid', role: 'user' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());

    expect(container.textContent).toContain('聯繫方式');
    expect(container.textContent).toContain('0912345678');
  });

  it('全域管理員（roleLevel 4）看他人 → 有「聯繫方式」列與電話', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'admin-uid', role: 'admin' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());

    expect(container.textContent).toContain('聯繫方式');
    expect(container.textContent).toContain('0912345678');
  });

  it('對方 secondaryEnabled=true 時一般登入者仍看得到名片（不再整張隱藏）', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(
      makeProfile({ secondaryEnabled: true, secondaryIdentityEnabled: true }),
    );
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());

    expect(container.textContent).toContain('Bob');
    expect(container.textContent).toContain('基本資料');
  });

  it('活動紀錄：初次不呼 loadUserStats；點毛玻璃後才呼叫', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());

    expect(loadUserStats).not.toHaveBeenCalled();
    expect(loadUserAttendanceSummary).not.toHaveBeenCalled();

    const overlays = Array.from(container.querySelectorAll('.uc-blur-overlay'));
    const recordBlur = overlays.find((el) => el.textContent?.includes('點擊載入活動記錄'));
    expect(recordBlur).toBeTruthy();
    if (recordBlur) fireEvent.click(recordBlur);

    await waitFor(() => expect(loadUserStats).toHaveBeenCalledWith('target-uid'));
    expect(loadUserAttendanceSummary).toHaveBeenCalledWith('target-uid');
  });
});
