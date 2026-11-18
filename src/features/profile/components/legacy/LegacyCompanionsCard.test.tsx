// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/ui/Toast';
import { appConfirm } from '@/ui/AppConfirm';
import type { UserProfile } from '../../data/profile-model';
import { saveCompanions } from '../../data/profile-writes';
import { LegacyCompanionsCard } from './LegacyCompanionsCard';

vi.mock('../../data/profile-writes', () => ({
  saveCompanions: vi.fn(),
}));

vi.mock('@/ui/AppConfirm', () => ({
  appConfirm: vi.fn().mockResolvedValue(true),
}));

// 測試同步更新：照 A（M-127）真實 API 為 toast.show({ message })，非 toast(message)。
vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));

// 測試同步更新：照 A（M-127）元件自 `@/data/ids` 匯入 generateId。
vi.mock('@/data/ids', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}test-id`),
}));

function emptyProfile(companions: unknown[] = []): UserProfile {
  return {
    uid: 'U-me',
    _docId: 'U-me',
    name: '王小明',
    lastActive: null,
    gender: '男',
    birthday: '2000/01/02',
    region: '台北市',
    role: 'user',
    teamName: '測試俱樂部',
    socialLinks: {},
    companions,
    eduChildren: [],
  };
}

describe('LegacyCompanionsCard', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('空清單顯示「尚無同行者」且 count=0', () => {
    render(
      <LegacyCompanionsCard uid="U-me" profile={emptyProfile()} onSaved={vi.fn()} />,
    );
    expect(document.getElementById('companions-count')?.textContent).toBe('0');
    fireEvent.click(screen.getByText('我的運動夥伴'));
    expect(screen.getByText('尚無同行者')).toBeTruthy();
  });

  it('標題點擊就地展開、aria-expanded 隨之切換', () => {
    render(
      <LegacyCompanionsCard uid="U-me" profile={emptyProfile()} onSaved={vi.fn()} />,
    );
    const title = screen.getByRole('button', { name: '我的運動夥伴' });
    expect(title.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(title);
    expect(title.getAttribute('aria-expanded')).toBe('true');
  });

  it('有同行者時渲染序號、性別圖示、備註與底部說明', () => {
    render(
      <LegacyCompanionsCard
        uid="U-me"
        profile={emptyProfile([
          { id: 'comp_1', name: '李四', gender: '男', notes: '朋友' },
          { id: 'comp_2', name: '王五', gender: '女', notes: '' },
        ])}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('我的運動夥伴'));
    expect(screen.getByText('①')).toBeTruthy();
    expect(screen.getByText('②')).toBeTruthy();
    expect(screen.getByText('李四')).toBeTruthy();
    expect(screen.getByText('♂男')).toBeTruthy();
    expect(screen.getByText('♀女')).toBeTruthy();
    expect(screen.getByText('朋友')).toBeTruthy();
    expect(
      screen.getByText('※ 序號為幫夥伴報名時的候補遞補順序'),
    ).toBeTruthy();
  });

  it('超過 10 位時序號以數字顯示', () => {
    const companions = Array.from({ length: 11 }, (_, i) => ({
      id: `comp_${i}`,
      name: `人${i + 1}`,
      gender: '',
      notes: '',
    }));
    render(
      <LegacyCompanionsCard
        uid="U-me"
        profile={emptyProfile(companions)}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('我的運動夥伴'));
    expect(screen.getByText('⑩')).toBeTruthy();
    // 測試同步更新：照 A（M-127）外層 #companions-count 徽章也是 11，改以列表容器限定。
    const list = document.getElementById('companions-inner-list');
    if (!list) throw new Error('Expected #companions-inner-list');
    expect(within(list).getByText('11')).toBeTruthy();
  });

  it('新增同行者：saveCompanions 收到完整陣列、onSaved、toast 皆對', async () => {
    vi.mocked(saveCompanions).mockResolvedValue(undefined);
    const onSaved = vi.fn();
    render(
      <LegacyCompanionsCard uid="U-me" profile={emptyProfile()} onSaved={onSaved} />,
    );
    fireEvent.click(screen.getByText('我的運動夥伴'));
    fireEvent.click(screen.getByText('+ 新增同行者'));

    const nameInput = document.getElementById('companion-modal-name');
    expect(nameInput).not.toBeNull();
    await act(async () => {
      fireEvent.input(nameInput as HTMLInputElement, { target: { value: '張三' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('儲存'));
    });

    await waitFor(() => {
      expect(saveCompanions).toHaveBeenCalledTimes(1);
    });
    const call = vi.mocked(saveCompanions).mock.calls[0];
    expect(call).toBeDefined();
    const next = call![1] as Array<Record<string, unknown>>;
    expect(next).toHaveLength(1);
    // 測試同步更新：照 A（M-127）saveCompanion 寫入 (id,name,gender,notes) 四欄；id 用 /^comp_/。
    expect(next[0]).toMatchObject({
      id: expect.stringMatching(/^comp_/),
      name: '張三',
      gender: '',
      notes: '',
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ companions: next });
      expect(toast.show).toHaveBeenCalledWith({ message: '同行者已新增' });
    });
  });

  it('姓名空白時 toast「請填寫姓名」且不寫入', () => {
    render(
      <LegacyCompanionsCard uid="U-me" profile={emptyProfile()} onSaved={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('我的運動夥伴'));
    fireEvent.click(screen.getByText('+ 新增同行者'));
    fireEvent.click(screen.getByText('儲存'));
    expect(toast.show).toHaveBeenCalledWith({ message: '請填寫姓名' });
    expect(saveCompanions).not.toHaveBeenCalled();
  });

  it('編輯同行者：保留 id 並送出更新值', async () => {
    vi.mocked(saveCompanions).mockResolvedValue(undefined);
    const onSaved = vi.fn();
    render(
      <LegacyCompanionsCard
        uid="U-me"
        profile={emptyProfile([
          { id: 'comp_a', name: '李四', gender: '男', notes: '朋友' },
        ])}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByText('我的運動夥伴'));
    fireEvent.click(screen.getByText('編輯'));

    const nameInput = document.getElementById('companion-modal-name');
    expect((nameInput as HTMLInputElement).value).toBe('李四');

    await act(async () => {
      fireEvent.input(nameInput as HTMLInputElement, {
        target: { value: '李四（改）' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('儲存'));
    });

    await waitFor(() => {
      expect(saveCompanions).toHaveBeenCalledTimes(1);
      expect(toast.show).toHaveBeenCalledWith({ message: '同行者已更新' });
    });
    const call = vi.mocked(saveCompanions).mock.calls[0];
    const next = call![1] as Array<Record<string, unknown>>;
    expect(next[0]).toMatchObject({ id: 'comp_a', name: '李四（改）' });
  });

  it('刪除：確認後呼叫 saveCompanions 並 toast「同行者已刪除」', async () => {
    vi.mocked(saveCompanions).mockResolvedValue(undefined);
    vi.mocked(appConfirm).mockResolvedValue(true);
    const onSaved = vi.fn();
    render(
      <LegacyCompanionsCard
        uid="U-me"
        profile={emptyProfile([
          { id: 'comp_a', name: '李四', gender: '', notes: '' },
        ])}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByText('我的運動夥伴'));

    await act(async () => {
      fireEvent.click(screen.getByText('刪除'));
    });

    await waitFor(() => {
      expect(appConfirm).toHaveBeenCalledWith('確定要刪除此同行者？');
    });
    await waitFor(() => {
      expect(saveCompanions).toHaveBeenCalledTimes(1);
      expect(toast.show).toHaveBeenCalledWith({ message: '同行者已刪除' });
    });
    expect(onSaved).toHaveBeenCalledWith({ companions: [] });
  });

  it('刪除取消：不寫入', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    render(
      <LegacyCompanionsCard
        uid="U-me"
        profile={emptyProfile([
          { id: 'comp_a', name: '李四', gender: '', notes: '' },
        ])}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('我的運動夥伴'));

    await act(async () => {
      fireEvent.click(screen.getByText('刪除'));
    });

    await waitFor(() => {
      expect(appConfirm).toHaveBeenCalledTimes(1);
    });
    expect(saveCompanions).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalledWith({ message: '同行者已刪除' });
  });
});
