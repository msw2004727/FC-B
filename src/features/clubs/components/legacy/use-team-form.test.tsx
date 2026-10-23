// @vitest-environment jsdom
// 依附件撰寫；未在專案環境執行，不代表 TS／Vitest／瀏覽器驗收已通過。
// 經理降職預覽為本段範圍外；本檔不執行遠端寫入或部署。
import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageCropperProps } from '@/features/events/components/event-form/ImageCropper';
import {
  getUserDirectory,
  loadUserDirectory,
  searchUserDirectory,
  verifyUserDirectorySelection,
} from '@/features/events/data/user-directory';
import type {
  DirectoryUser,
  DirectoryVerification,
} from '@/features/events/data/user-directory';
import { toast } from '@/ui/Toast';
import { appConfirm } from '@/ui/AppConfirm';
import {
  submitCreateTeam,
  submitEditTeam,
} from '../../data/team-form-actions';
import type { SubmitTeamResult } from '../../data/team-form-actions';
import { useTeamForm } from './use-team-form';
import type { TeamFormApi, TeamFormProps } from './use-team-form';

const cropper = vi.hoisted(() => ({ props: null as ImageCropperProps | null }));

vi.mock('@/features/events/data/user-directory', () => ({
  getUserDirectory: vi.fn(),
  loadUserDirectory: vi.fn(),
  searchUserDirectory: vi.fn(),
  verifyUserDirectorySelection: vi.fn(),
}));
vi.mock('../../data/team-form-actions', () => ({
  submitCreateTeam: vi.fn(),
  submitEditTeam: vi.fn(),
}));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: vi.fn() }));
vi.mock('@/features/events/components/event-form/ImageCropper', () => ({
  ImageCropper: (props: ImageCropperProps) => {
    cropper.props = props;
    return null;
  },
}));

let api: TeamFormApi;
let renders = 0;
function Harness(props: TeamFormProps) {
  renders += 1;
  api = useTeamForm(props);
  return api.image.cropper;
}

function user(uid: string, name = uid): DirectoryUser {
  return { uid, name, displayName: name, pictureUrl: '', role: 'user' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function props(overrides: Partial<TeamFormProps> = {}): TeamFormProps {
  return {
    mode: 'create',
    viewer: {
      uid: 'me',
      displayName: '創立者',
      hasPermission: code => code === 'team.create' || code === 'team.assign_coach',
    },
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(appConfirm).mockResolvedValue(true);
  renders = 0;
  cropper.props = null;
  vi.mocked(getUserDirectory).mockReturnValue([]);
  vi.mocked(loadUserDirectory).mockResolvedValue(true);
  vi.mocked(searchUserDirectory).mockImplementation((users, query, excluded) =>
    users.filter(item =>
      !excluded.includes(item.uid)
      && [item.name, item.displayName, item.uid]
        .some(value => value.toLowerCase().includes(query.trim().toLowerCase())),
    ).slice(0, 5),
  );
  vi.mocked(verifyUserDirectorySelection).mockImplementation(async uids => ({
    ok: true, users: uids.map(uid => user(uid, `姓名-${uid}`)), missingUids: [], reason: '',
  }));
  vi.mocked(submitCreateTeam).mockResolvedValue({
    ok: true, teamId: 'new-team', roleSyncOk: true,
  });
  vi.mocked(submitEditTeam).mockResolvedValue({
    ok: true, teamId: 'old-team', roleSyncOk: true,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useTeamForm', () => {
  it.each(
    [true, false].flatMap(directoryOk =>
      ['', '   '].flatMap(blank =>
        [true, false].map(withUid => ({ directoryOk, blank, withUid })),
      ),
    ),
  )('空白姓名回退並保留身分界線：%j', async ({ directoryOk, blank, withUid }) => {
    vi.mocked(loadUserDirectory).mockResolvedValue(directoryOk);
    vi.mocked(getUserDirectory).mockReturnValue(directoryOk
      ? [user('leader', '目錄領隊'), user('coach', '目錄教練'), user('same', '舊領隊')]
      : []);
    render(<Harness {...props({
      mode: 'edit',
      team: {
        id: 'old-team',
        captainUid: 'me',
        leaderNames: [blank],
        leader: '舊領隊',
        leaderUids: withUid ? ['leader'] : [],
        coachNames: [blank],
        coaches: ['舊教練'],
        coachUids: withUid ? ['coach'] : [],
      },
    })} />);
    await flush();

    expect(api.values.leaders).toEqual(withUid
      ? [{ uid: 'leader', name: directoryOk ? '目錄領隊' : '舊領隊' }]
      : []);
    expect(api.values.coaches).toEqual(withUid
      ? [{ uid: 'coach', name: directoryOk ? '目錄教練' : '舊教練' }]
      : []);
    expect(api.values.unresolvedLeaderNames).toEqual(withUid ? [] : ['舊領隊']);
    expect(api.values.unresolvedCoachNames).toEqual(withUid ? [] : ['舊教練']);
  });

  it('領隊空白陣列優先回退 leaders，仍保留未連結姓名', async () => {
    vi.mocked(getUserDirectory).mockReturnValue([user('same', '舊領隊甲')]);
    render(<Harness {...props({
      mode: 'edit',
      team: {
        id: 'old-team',
        captainUid: 'me',
        leaderNames: ['', ' '],
        leaders: ['舊領隊甲', '舊領隊乙'],
        leader: '單一舊領隊',
      },
    })} />);
    await flush();
    expect(api.values.leaders).toEqual([]);
    expect(api.values.unresolvedLeaderNames).toEqual(['舊領隊甲', '舊領隊乙']);
  });

  it.each([true, false])('回退姓名保留空白位置，目錄成功=%s', async directoryOk => {
    vi.mocked(loadUserDirectory).mockResolvedValue(directoryOk);
    vi.mocked(getUserDirectory).mockReturnValue(directoryOk
      ? [user('first', '第一位'), user('second', '第二位')]
      : []);
    render(<Harness {...props({
      mode: 'edit',
      team: {
        id: 'old-team',
        captainUid: 'me',
        leaderUids: ['first', 'second'],
        leaderNames: [' ', ''],
        leader: '第一位舊名',
        coachUids: ['first', 'second'],
        coachNames: ['', '第二位舊名'],
      },
    })} />);
    await flush();
    expect(api.values.leaders).toEqual([
      { uid: 'first', name: directoryOk ? '第一位' : '第一位舊名' },
      { uid: 'second', name: directoryOk ? '第二位' : '' },
    ]);
    expect(api.values.coaches).toEqual([
      { uid: 'first', name: directoryOk ? '第一位' : '' },
      { uid: 'second', name: directoryOk ? '第二位' : '第二位舊名' },
    ]);
    expect(api.values.unresolvedLeaderNames).toEqual([]);
    expect(api.values.unresolvedCoachNames).toEqual([]);
  });

  it.each(['leaders', 'coaches'] as const)(
    '%s 未連結 tag 可在同一 act 依原 key 連刪，重複舊 key 不誤刪',
    async role => {
      render(<Harness {...props({
        mode: 'edit',
        team: {
          id: 'old-team',
          captainUid: 'me',
          leaderNames: ['甲', '乙', '丙'],
          coachNames: ['甲', '乙', '丙'],
        },
      })} />);
      await flush();
      const original = api[role].tags;
      const first = original[0]!;
      const second = original[1]!;
      const third = original[2]!;
      act(() => {
        api[role].remove(first.key);
        api[role].remove(second.key);
        api[role].remove(first.key);
      });
      expect(api[role].tags).toEqual([third]);
      act(() => api[role].remove(second.key));
      expect(api[role].tags).toEqual([third]);
    },
  );

  it.each([true, false])(
    '清除使進行中的經理驗證失效，原經理有 UID=%s',
    async withUid => {
      const verifying = deferred<DirectoryVerification>();
      vi.mocked(verifyUserDirectorySelection).mockReturnValue(verifying.promise);
      render(<Harness {...props({
        mode: 'edit',
        viewer: {
          uid: 'me',
          displayName: '管理員',
          hasPermission: () => true,
        },
        team: {
          id: 'old-team',
          captainUid: withUid ? 'me' : '',
          captainName: '原經理',
        },
      })} />);
      await flush();
      const original = api.values.captain;
      const unresolved = api.values.unresolvedCaptainName;
      let selection!: Promise<void>;
      act(() => { selection = api.captain.select('next'); });
      expect(verifyUserDirectorySelection).toHaveBeenCalledTimes(1);
      act(() => api.captain.clear());
      await act(async () => {
        verifying.resolve({
          ok: true, users: [user('next', '新經理')], missingUids: [], reason: '',
        });
        await selection;
      });
      expect(api.values.captain).toEqual(original);
      expect(api.values.unresolvedCaptainName).toBe(unresolved);
      expect(api.captain.pendingName).toBeNull();
    },
  );

  it.each(['switch', 'unmount'] as const)(
    '經理驗證等待期間 %s，結果不得寫入',
    async change => {
      const verifying = deferred<DirectoryVerification>();
      vi.mocked(verifyUserDirectorySelection).mockReturnValue(verifying.promise);
      const view = render(<Harness {...props({
        mode: 'edit',
        team: { id: 'old-team', captainUid: 'me', captainName: '原經理' },
      })} />);
      await flush();
      let selection!: Promise<void>;
      act(() => { selection = api.captain.select('next'); });
      if (change === 'switch') {
        view.rerender(<Harness {...props()} />);
        await flush();
      } else {
        view.unmount();
      }
      const count = renders;
      await act(async () => {
        verifying.resolve({
          ok: true, users: [user('next')], missingUids: [], reason: '',
        });
        await selection;
      });
      expect(renders).toBe(count);
      expect(api.values.captain?.uid).toBe('me');
      expect(api.values.unresolvedCaptainName).toBe('');
      expect(api.captain.pendingName).toBeNull();
      expect(toast.show).not.toHaveBeenCalled();
    },
  );

  it.each(['create', 'edit'] as const)(
    '%s action 回傳失敗：優先採 message，缺少時使用模式文案',
    async mode => {
      const action = vi.mocked(mode === 'create' ? submitCreateTeam : submitEditTeam);
      const options = props({
        mode,
        team: mode === 'edit' ? { id: 'old-team', captainUid: 'me' } : undefined,
      });
      render(<Harness {...options} />);
      await flush();
      for (const message of ['action 指定訊息', undefined]) {
        action.mockResolvedValue({
          ok: false,
          reason: 'write-failed',
          ...(message ? { message } : {}),
        });
        vi.mocked(toast.show).mockClear();
        await act(async () => { await api.submit(); });
        expect(toast.show).toHaveBeenCalledExactlyOnceWith({
          message: message || (mode === 'edit' ? '俱樂部更新失敗，請重試' : '儲存失敗：'),
          tone: 'error',
        });
        expect(api.busy).toBe(false);
      }
      expect(options.onSaved).not.toHaveBeenCalled();
    },
  );

  it.each(['create', 'edit'] as const)(
    '%s action reject／同步例外使用模式文案並解鎖',
    async mode => {
      const action = vi.mocked(mode === 'create' ? submitCreateTeam : submitEditTeam);
      const options = props({
        mode,
        team: mode === 'edit' ? { id: 'old-team', captainUid: 'me' } : undefined,
      });
      render(<Harness {...options} />);
      await flush();
      for (const synchronous of [false, true]) {
        for (const error of [new Error('offline'), '字串錯誤', undefined]) {
          if (synchronous) {
            action.mockImplementationOnce(() => { throw error; });
          } else {
            action.mockRejectedValueOnce(error);
          }
          vi.mocked(toast.show).mockClear();
          await act(async () => { await api.submit(); });
          expect(toast.show).toHaveBeenCalledExactlyOnceWith({
            message: mode === 'edit'
              ? '俱樂部更新失敗，請重試'
              : `儲存失敗：${error instanceof Error ? error.message : error ?? ''}`,
            tone: 'error',
          });
          expect(api.busy).toBe(false);
        }
      }
      expect(options.onSaved).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    '經理轉移等待確認才呼叫 action，確認結果=%s',
    async confirmed => {
      const confirmation = deferred<boolean>();
      vi.mocked(appConfirm).mockReturnValue(confirmation.promise);
      vi.mocked(getUserDirectory).mockReturnValue([user('me', '原經理')]);
      const options = props({
        mode: 'edit',
        team: { id: 'old-team', captainUid: 'me', captainName: '過去名稱' },
      });
      render(<Harness {...options} />);
      await flush();
      await act(async () => { await api.captain.select('next'); });
      let submission!: Promise<void>;
      act(() => { submission = api.submit(); });
      expect(appConfirm).toHaveBeenCalledExactlyOnceWith(
        '確定要轉移俱樂部經理嗎？\n\n' +
        '目前經理：原經理\n' +
        '新的經理：姓名-next\n\n' +
        '注意：\n' +
        '- 俱樂部經理只能有一位，不是可複選的領隊欄位。\n' +
        '- 儲存後，新的經理會取得俱樂部管理權限。\n' +
        '- 原經理可能失去此俱樂部管理權限，除非仍保留領隊、教練或其他管理身份。\n\n' +
        '確定要儲存這次經理轉移？',
      );
      expect(submitEditTeam).not.toHaveBeenCalled();
      expect(toast.show).not.toHaveBeenCalled();
      expect(api.busy).toBe(true);
      await act(async () => {
        confirmation.resolve(confirmed);
        await submission;
      });
      expect(submitEditTeam).toHaveBeenCalledTimes(confirmed ? 1 : 0);
      expect(options.onSaved).toHaveBeenCalledTimes(confirmed ? 1 : 0);
      expect(toast.show).toHaveBeenCalledTimes(confirmed ? 1 : 0);
      expect(api.busy).toBe(false);
    },
  );

  it('轉移確認找不到姓名時使用 A 的經理名稱回退', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    render(<Harness {...props({
      mode: 'edit',
      team: { id: 'old-team', captainUid: 'me' },
    })} />);
    await flush();
    act(() => api.setValue('captain', { uid: 'next', name: '' }));
    await act(async () => { await api.submit(); });
    expect(appConfirm).toHaveBeenCalledWith(expect.stringContaining(
      '目前經理：原俱樂部經理\n新的經理：新俱樂部經理\n\n',
    ));
    expect(submitEditTeam).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    expect(api.busy).toBe(false);
  });

  it.each(['same', 'no-old', 'create'] as const)(
    '%s 不跳經理轉移確認',
    async scenario => {
      const mode = scenario === 'create' ? 'create' : 'edit';
      render(<Harness {...props({
        mode,
        viewer: { uid: 'me', displayName: '本人', hasPermission: () => true },
        team: mode === 'edit'
          ? { id: 'old-team', captainUid: scenario === 'same' ? 'me' : '' }
          : undefined,
      })} />);
      await flush();
      if (scenario === 'no-old') {
        act(() => api.setValue('captain', { uid: 'next', name: '新經理' }));
      }
      await act(async () => { await api.submit(); });
      expect(appConfirm).not.toHaveBeenCalled();
      expect(mode === 'create' ? submitCreateTeam : submitEditTeam).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['switch', 'unmount'] as const)(
    '轉移確認期間 %s，確認後不得呼叫 action 或通知',
    async change => {
      const confirmation = deferred<boolean>();
      vi.mocked(appConfirm).mockReturnValue(confirmation.promise);
      const options = props({
        mode: 'edit',
        team: { id: 'old-team', captainUid: 'me' },
      });
      const view = render(<Harness {...options} />);
      await flush();
      await act(async () => { await api.captain.select('next'); });
      let submission!: Promise<void>;
      act(() => { submission = api.submit(); });
      expect(appConfirm).toHaveBeenCalledTimes(1);
      if (change === 'switch') {
        view.rerender(<Harness {...props()} />);
        await flush();
        expect(api.busy).toBe(false);
      } else {
        view.unmount();
      }
      const count = renders;
      await act(async () => {
        confirmation.resolve(true);
        await submission;
      });
      expect(renders).toBe(count);
      expect(submitEditTeam).not.toHaveBeenCalled();
      expect(submitCreateTeam).not.toHaveBeenCalled();
      expect(options.onSaved).not.toHaveBeenCalled();
      expect(toast.show).not.toHaveBeenCalled();
    },
  );
  it('新增初始值、文案、運動 key 與單次目錄載入', async () => {
    render(<Harness {...props()} />);
    await flush();
    expect(api.values).toMatchObject({
      type: 'competitive',
      nationality: '台灣',
      eduAccepting: true,
      captain: { uid: 'me', name: '創立者' },
    });
    expect(api.title).toBe('新增俱樂部');
    expect(api.submitLabel).toBe('建立俱樂部');
    expect(api.busyLabel).toBe('建立中...');
    expect(api.captain.displayText).toBe('俱樂部經理（創立者）：創立者');
    expect(api.captain.lockedText).toBe('（創立者自動成為俱樂部經理）');
    expect(api.captain.transferVisible).toBe(false);
    expect(api.sportOptions).toHaveLength(22);
    expect(api.sportOptions[0]).toEqual({ key: '', label: '未指定' });
    expect(api.sportOptions[1]).toEqual({ key: 'football', label: '⚽ 足球' });
    expect(loadUserDirectory).toHaveBeenCalledTimes(1);

    act(() => {
      api.setValue('name', '測試俱樂部');
      api.setValue('type', 'education');
      api.setValue('sportTag', 'football');
      api.captain.clear();
      api.setValue('captain', { uid: 'other', name: '其他人' });
    });
    expect(api.values.name).toBe('測試俱樂部');
    expect(api.values.sportTag).toBe('football');
    expect(api.showEduSettings).toBe(true);
    expect(api.categoryHint).toBe('教學標籤會啟用課程、學員與待審核功能。');
    expect(api.values.captain?.uid).toBe('me');
  });

  it('編輯預填、legacy UID 回退、未連結姓名不以同名配對', async () => {
    vi.mocked(getUserDirectory).mockReturnValue([
      user('same-name', '舊教練'),
      user('leader', '最新領隊'),
    ]);
    render(<Harness {...props({
      mode: 'edit',
      team: {
        id: 'old-team',
        captainUid: 'me',
        captainName: '原經理',
        leaderUids: [],
        leaderUid: 'leader',
        leader: '舊領隊',
        coachNames: ['舊教練'],
        name: '俱樂部',
        nationality: '日本',
        founded: 2020,
        type: 'education',
        sportTag: 'basketball',
        eduSettings: { acceptingStudents: false },
        image: 'old.jpg',
        imageVariants: { cover: 'cover.jpg' },
      },
    })} />);
    await flush();
    expect(api.title).toBe('編輯俱樂部');
    expect(api.submitLabel).toBe('儲存變更');
    expect(api.values).toMatchObject({
      name: '俱樂部',
      nationality: '日本',
      founded: '2020',
      eduAccepting: false,
      leaders: [{ uid: 'leader', name: '最新領隊' }],
      coaches: [],
      unresolvedCoachNames: ['舊教練'],
    });
    expect(api.coaches.tags).toEqual([
      { key: expect.stringMatching(/^legacy:\d+$/), uid: null, name: '舊教練' },
    ]);
    expect(api.image.previewUrl).toBe('cover.jpg');
    expect(api.captain.transferVisible).toBe(true);
  });

  it('目錄失敗保留 UID、姓名與尚未連結姓名', async () => {
    vi.mocked(loadUserDirectory).mockResolvedValue(false);
    render(<Harness {...props({
      mode: 'edit',
      team: {
        id: 'old-team',
        captainUid: 'me',
        captainName: '舊經理',
        leaderUids: ['missing-leader'],
        leaderNames: ['舊領隊'],
        coachNames: ['未連結教練'],
      },
    })} />);
    await flush();
    expect(api.values.captain).toEqual({ uid: 'me', name: '舊經理' });
    expect(api.values.leaders).toEqual([{ uid: 'missing-leader', name: '舊領隊' }]);
    expect(api.values.unresolvedCoachNames).toEqual(['未連結教練']);
    expect(toast.show).toHaveBeenCalledTimes(1);
  });

  it('延遲目錄不覆蓋已編輯欄位或已移除幹部', async () => {
    const loading = deferred<boolean>();
    vi.mocked(loadUserDirectory).mockReturnValue(loading.promise);
    render(<Harness {...props({
      mode: 'edit',
      team: { id: 'old-team', captainUid: 'me', leaderUids: ['leader'], leaderNames: ['舊名'] },
    })} />);
    act(() => {
      api.setValue('name', '使用者輸入');
      api.leaders.remove('uid:leader');
    });
    vi.mocked(getUserDirectory).mockReturnValue([user('leader', '新名')]);
    await act(async () => { loading.resolve(true); await loading.promise; });
    expect(api.values.name).toBe('使用者輸入');
    expect(api.values.leaders).toEqual([]);
  });

  it('地區聚焦顯示全部、模糊搜尋、200ms 失焦與重聚焦取消計時', async () => {
    vi.useFakeTimers();
    render(<Harness {...props()} />);
    await flush();
    act(() => api.region.onFocus());
    expect(api.region.suggestions).toHaveLength(23);
    expect(api.region.open).toBe(true);
    act(() => api.region.onInput('臺北'));
    expect(api.region.suggestions).toEqual(['台北市']);
    act(() => api.region.onBlur());
    act(() => { vi.advanceTimersByTime(199); });
    expect(api.region.open).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(api.region.open).toBe(false);
    act(() => {
      api.region.onFocus();
      api.region.onBlur();
      api.region.onFocus();
      vi.advanceTimersByTime(200);
    });
    expect(api.region.open).toBe(true);
    act(() => api.region.pick('新北市'));
    expect(api.values.region).toBe('新北市');
    expect(api.region.open).toBe(false);
  });

  it('聯絡連結開啟補列、預覽、保留草稿、最多五列與最後一列不可刪', async () => {
    render(<Harness {...props()} />);
    await flush();
    act(() => api.contactLinks.setEnabled(true));
    expect(api.contactLinks.drafts).toEqual(['']);
    act(() => api.contactLinks.remove(0));
    expect(api.contactLinks.drafts).toEqual(['']);
    act(() => {
      api.contactLinks.setDraft(0, 'https://line.me/test');
      api.contactLinks.add();
      api.contactLinks.add();
      api.contactLinks.add();
      api.contactLinks.add();
      api.contactLinks.add();
    });
    expect(api.contactLinks.drafts).toHaveLength(5);
    expect(api.contactLinks.canAdd).toBe(false);
    expect(api.contactLinks.previews[0]).toEqual({ platform: 'line', label: 'LINE' });
    expect(toast.show).toHaveBeenCalledWith({
      message: '聯絡連結最多 5 個', tone: 'error',
    });
    act(() => {
      api.contactLinks.remove(1);
      api.contactLinks.setEnabled(false);
    });
    expect(api.contactLinks.drafts).toHaveLength(4);
    expect(api.values.contactLinksEnabled).toBe(false);
  });

  it('領隊／教練新增需驗證，拒絕與重複 uid 不加入', async () => {
    render(<Harness {...props()} />);
    await flush();
    await act(async () => {
      await api.leaders.add('leader');
      await api.coaches.add('coach');
      await api.leaders.add('leader');
    });
    expect(api.values.leaders).toEqual([{ uid: 'leader', name: '姓名-leader' }]);
    expect(api.values.coaches).toEqual([{ uid: 'coach', name: '姓名-coach' }]);
    expect(verifyUserDirectorySelection).toHaveBeenCalledTimes(2);
    vi.mocked(verifyUserDirectorySelection).mockResolvedValue({
      ok: false, users: [], missingUids: ['bad'], reason: 'missing',
    });
    await act(async () => {
      await api.leaders.add('bad');
      await api.coaches.add('bad');
    });
    expect(api.values.leaders).toHaveLength(1);
    expect(api.values.coaches).toHaveLength(1);
  });

  it('無教練權限不驗證、不改 state；creator 不等於可轉移經理', async () => {
    render(<Harness {...props({
      mode: 'edit',
      viewer: { uid: 'me', displayName: null, hasPermission: () => false },
      team: { id: 'old-team', creatorUid: 'me', captainUid: 'captain' },
    })} />);
    await flush();
    expect(api.canSubmit).toBe(true);
    expect(api.coaches.allowed).toBe(false);
    expect(api.captain.transferVisible).toBe(false);
    expect(api.captain.lockedText).toBe('（僅俱樂部經理或管理員可轉移經理職位）');
    await act(async () => {
      await api.coaches.add('coach');
      await api.captain.select('other');
    });
    expect(api.values.coaches).toEqual([]);
    expect(api.values.captain?.uid).toBe('captain');
    expect(verifyUserDirectorySelection).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith({ message: '權限不足', tone: 'error' });
  });

  it('經理選取後可清除並恢復原經理；displayText 保持原經理', async () => {
    render(<Harness {...props({
      mode: 'edit',
      team: { id: 'old-team', captainUid: 'me', captainName: '原經理' },
    })} />);
    await flush();
    await act(async () => { await api.captain.select('next'); });
    expect(api.captain.pendingName).toBe('姓名-next');
    expect(api.captain.selected?.uid).toBe('next');
    expect(api.captain.displayText).toBe('目前俱樂部經理：原經理');
    act(() => api.captain.clear());
    expect(api.captain.selected).toEqual({ uid: 'me', name: '原經理' });
    expect(api.captain.pendingName).toBeNull();
  });

  it.each(['create', 'edit'] as const)('%s 送出正確 action、參數與成功通知', async mode => {
    const options = props({
      mode,
      team: mode === 'edit' ? { id: 'old-team', captainUid: 'me' } : undefined,
    });
    render(<Harness {...options} />);
    await flush();
    act(() => {
      api.setValue('name', '送出名稱');
      api.setValue('sportTag', 'football');
    });
    const submittedValues = api.values;
    await act(async () => { await api.submit(); });
    const action = mode === 'create' ? submitCreateTeam : submitEditTeam;
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(expect.objectContaining({
      values: submittedValues,
      images: {},
      viewer: expect.objectContaining({ uid: 'me', displayName: '創立者' }),
      ...(mode === 'edit' ? { team: options.team } : {}),
    }));
    expect(toast.show).toHaveBeenCalledWith({
      message: mode === 'create' ? '俱樂部建立成功！' : '俱樂部資料已更新',
      tone: 'success',
    });
    expect(options.onSaved).toHaveBeenCalledWith({
      teamId: mode === 'create' ? 'new-team' : 'old-team',
      mode,
      roleSyncOk: true,
    });
    expect(options.onClose).not.toHaveBeenCalled();
  });

  it.each([
    { ok: false, reason: 'write-failed', message: '指定失敗訊息' },
    { ok: false, reason: 'write-failed' },
    { ok: true, teamId: 'new-team', roleSyncOk: false },
  ] satisfies SubmitTeamResult[])('失敗／部分同步結果文案：%j', async result => {
    vi.mocked(submitCreateTeam).mockResolvedValue(result);
    const options = props();
    render(<Harness {...options} />);
    await flush();
    await act(async () => { await api.submit(); });
    expect(toast.show).toHaveBeenCalledWith({
      message: result.ok
        ? '俱樂部已儲存，但角色同步尚未完成，請稍後再儲存一次'
        : result.message || '儲存失敗：',
      tone: 'error',
    });
    expect(options.onSaved).toHaveBeenCalledTimes(result.ok ? 1 : 0);
  });

  it('同步連按與等待 onSaved 期間均防重送', async () => {
    const writing = deferred<SubmitTeamResult>();
    const refreshing = deferred<void>();
    vi.mocked(submitCreateTeam).mockReturnValue(writing.promise);
    const options = props({ onSaved: vi.fn(() => refreshing.promise) });
    render(<Harness {...options} />);
    await flush();
    let pending!: Promise<void>;
    act(() => {
      pending = api.submit();
      api.submit().catch(() => undefined);
    });
    expect(submitCreateTeam).toHaveBeenCalledTimes(1);
    expect(api.busy).toBe(true);
    await act(async () => {
      writing.resolve({ ok: true, teamId: 'new-team', roleSyncOk: true });
      await writing.promise;
    });
    await act(async () => { await api.submit(); });
    expect(submitCreateTeam).toHaveBeenCalledTimes(1);
    await act(async () => {
      refreshing.resolve();
      await pending;
    });
    expect(api.busy).toBe(false);
  });

  it('卸載後完成送出不通知、不回呼、不再重繪', async () => {
    const writing = deferred<SubmitTeamResult>();
    vi.mocked(submitCreateTeam).mockReturnValue(writing.promise);
    const options = props();
    const view = render(<Harness {...options} />);
    await flush();
    let pending!: Promise<void>;
    act(() => { pending = api.submit(); });
    view.unmount();
    const count = renders;
    await act(async () => {
      writing.resolve({ ok: true, teamId: 'new-team', roleSyncOk: true });
      await pending;
    });
    expect(renders).toBe(count);
    expect(options.onSaved).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('切換模式後舊選人／送出結果不得寫入新表單', async () => {
    const verifying = deferred<DirectoryVerification>();
    const writing = deferred<SubmitTeamResult>();
    vi.mocked(verifyUserDirectorySelection).mockReturnValue(verifying.promise);
    vi.mocked(submitCreateTeam).mockReturnValue(writing.promise);
    const original = props();
    const view = render(<Harness {...original} />);
    await flush();
    let selection!: Promise<void>;
    let submission!: Promise<void>;
    act(() => {
      selection = api.leaders.add('old');
      submission = api.submit();
    });
    view.rerender(<Harness {...props({
      mode: 'edit', team: { id: 'different', captainUid: 'me', name: '新表單' },
    })} />);
    await flush();
    await act(async () => {
      verifying.resolve({ ok: true, users: [user('old')], missingUids: [], reason: '' });
      writing.resolve({ ok: true, teamId: 'old-result', roleSyncOk: true });
      await Promise.all([selection, submission]);
    });
    expect(api.values.name).toBe('新表單');
    expect(api.values.leaders).toEqual([]);
    expect(api.busy).toBe(false);
    expect(original.onSaved).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('uid 延後到位才載入；編輯缺 team 與權限撤銷均禁止送出', async () => {
    const initial = props({
      viewer: { uid: null, displayName: null, hasPermission: () => false },
    });
    const view = render(<Harness {...initial} />);
    await flush();
    expect(loadUserDirectory).not.toHaveBeenCalled();
    expect(api.canSubmit).toBe(false);
    view.rerender(<Harness {...props()} />);
    await flush();
    expect(loadUserDirectory).toHaveBeenCalledTimes(1);
    expect(api.values.captain?.uid).toBe('me');

    view.rerender(<Harness {...props({ mode: 'edit', team: null })} />);
    await flush();
    expect(api.canSubmit).toBe(false);
    await act(async () => { await api.submit(); });
    expect(submitEditTeam).not.toHaveBeenCalled();

    view.rerender(<Harness {...props({
      viewer: { uid: 'me', displayName: '創立者', hasPermission: () => false },
    })} />);
    await flush();
    expect(api.canSubmit).toBe(false);
    await act(async () => { await api.submit(); });
    expect(submitCreateTeam).not.toHaveBeenCalled();
  });

  it('裁切兩步完成才提交新圖；取消第二步保留既有預覽', async () => {
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (
      this: FileReader,
    ) {
      Object.defineProperty(this, 'result', {
        configurable: true, value: 'data:image/png;base64,SOURCE',
      });
      this.dispatchEvent(new ProgressEvent('load'));
    });
    render(<Harness {...props({
      mode: 'edit',
      team: { id: 'old-team', captainUid: 'me', image: 'old.jpg' },
    })} />);
    await flush();
    const file = new File(['image'], 'cover.png', { type: 'image/png' });
    await act(async () => { await api.image.pickFile(file); });
    expect(cropper.props?.options.aspectRatio).toBe(8 / 3);
    act(() => cropper.props?.onConfirm('data:image/webp;base64,COVER'));
    expect(cropper.props?.options.aspectRatio).toBe(1);
    expect(api.image.hasNew).toBe(false);
    act(() => cropper.props?.onCancel());
    expect(api.image.previewUrl).toBe('old.jpg');

    await act(async () => { await api.image.pickFile(file); });
    act(() => cropper.props?.onConfirm('data:image/webp;base64,COVER'));
    act(() => cropper.props?.onConfirm('data:image/webp;base64,CARD'));
    expect(api.image.hasNew).toBe(true);
    expect(api.image.previewUrl).toBe('data:image/webp;base64,COVER');
    await act(async () => { await api.submit(); });
    expect(submitEditTeam).toHaveBeenCalledWith(expect.objectContaining({
      images: {
        coverDataUrl: 'data:image/webp;base64,COVER',
        cardDataUrl: 'data:image/webp;base64,CARD',
      },
    }));
  });

  it('圖片型別與大小驗證文案沿用既有 hook', async () => {
    render(<Harness {...props()} />);
    await flush();
    await act(async () => {
      await api.image.pickFile(new File(['text'], 'file.txt', { type: 'text/plain' }));
    });
    expect(toast.show).toHaveBeenLastCalledWith({
      message: '請上傳 JPG / PNG / WebP 圖片', tone: 'error',
    });
    const large = new File(['image'], 'cover.png', { type: 'image/png' });
    Object.defineProperty(large, 'size', { value: 5 * 1024 * 1024 + 1 });
    await act(async () => { await api.image.pickFile(large); });
    expect(toast.show).toHaveBeenLastCalledWith({
      message: '圖片太大，不能超過 5MB', tone: 'error',
    });
    expect(api.image.cropper).toBeNull();
  });

  it('action 拒絕會解鎖；onSaved 拒絕不改報儲存失敗', async () => {
    vi.mocked(submitCreateTeam).mockRejectedValueOnce(new Error('offline'));
    render(<Harness {...props({
      onSaved: vi.fn(async () => { throw new Error('refresh failed'); }),
    })} />);
    await flush();
    await act(async () => { await api.submit(); });
    expect(api.busy).toBe(false);
    expect(toast.show).toHaveBeenLastCalledWith({
      message: '儲存失敗：offline', tone: 'error',
    });
    vi.mocked(toast.show).mockClear();
    await act(async () => { await api.submit(); });
    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({
      message: '俱樂部建立成功！', tone: 'success',
    });
    expect(api.busy).toBe(false);
  });
});
