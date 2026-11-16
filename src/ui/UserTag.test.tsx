import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 這組測試驗證「顯示經驗值」時的畫面；新版預設關閉（src/core/exp-display.ts），關閉時的行為另有測試。
vi.mock('@/core/exp-display', () => ({ SHOW_EXP: true }));

vi.mock('@/data/user-roles', () => ({
  getCachedUserLevel: (uid: string) => (uid === 'u-cached' ? 12 : undefined),
}));

const { UserTag } = await import('./UserTag');

// 測試同步更新（R-QA-005）：2026-10-19 膠囊改照 A `_userTag`（user-capsule uc-{role}、Lv、角色名稱在 title）。
describe('UserTag（照 A 使用者膠囊）', () => {
  afterEach(() => cleanup());

  it('輸出 A 的 class、Lv 與名字，角色名稱放在 title', () => {
    render(<UserTag uid="u1" name="小明" role="coach" level={3} onOpenProfile={() => undefined} />);
    const btn = screen.getByRole('button');
    expect(btn.classList.contains('user-capsule')).toBe(true);
    expect(btn.classList.contains('uc-coach')).toBe(true);
    expect(btn.getAttribute('title')).toBe('教練');
    expect(btn.querySelector('.uc-lv')?.textContent).toBe('Lv3');
    expect(btn.textContent).toContain('小明');
  });

  it('沒給等級時用快取，仍沒有則 Lv0', () => {
    render(<UserTag uid="u-cached" name="A" onOpenProfile={() => undefined} />);
    expect(screen.getByRole('button').querySelector('.uc-lv')?.textContent).toBe('Lv12');
    cleanup();
    render(<UserTag uid="u-none" name="B" onOpenProfile={() => undefined} />);
    expect(screen.getByRole('button').querySelector('.uc-lv')?.textContent).toBe('Lv0');
  });

  it('team_leader 用 A 的 uc-team-leader；總管 title 為「總管」', () => {
    render(<UserTag uid="u1" name="甲" role="team_leader" onOpenProfile={() => undefined} />);
    expect(screen.getByRole('button').classList.contains('uc-team-leader')).toBe(true);
    cleanup();
    render(<UserTag uid="u2" name="乙" role="super_admin" onOpenProfile={() => undefined} />);
    expect(screen.getByRole('button').getAttribute('title')).toBe('總管');
  });

  it('點擊以 uid 開個人名片；沒有 uid 或停用時不可點', () => {
    const open = vi.fn();
    render(<UserTag uid="u9" name="丙" onOpenProfile={open} />);
    fireEvent.click(screen.getByRole('button'));
    expect(open).toHaveBeenCalledWith('u9');
    cleanup();
    render(<UserTag uid="" name="丁" onOpenProfile={open} />);
    const disabled = screen.getByRole('button');
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(disabled);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('鍵盤 Enter 也能開名片', () => {
    const open = vi.fn();
    render(<UserTag uid="u7" name="己" onOpenProfile={open} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(open).toHaveBeenCalledWith('u7');
  });

  it('可選球衣插槽照 A 放在泡泡後、名字前，維持 UID 名片操作', () => {
    const open = vi.fn();
    const { rerender } = render(<UserTag uid="jersey-user" name="球員" recentNoShow
      nameClass="test-name" jersey={<svg class="uc-team-jersey" role="img" aria-label="B 隊 - 藍" />}
      onOpenProfile={open} />);
    const capsule = screen.getByRole('button');
    const jersey = screen.getByRole('img', { name: 'B 隊 - 藍' });
    expect(jersey.parentElement).toBe(capsule);
    expect(jersey.previousElementSibling?.className).toBe('uc-recent-noshow');
    expect(jersey.nextElementSibling?.textContent).toBe('球員');
    fireEvent.click(jersey);
    expect(open).toHaveBeenCalledExactlyOnceWith('jersey-user');
    rerender(<UserTag uid="jersey-user" name="球員" onOpenProfile={open} />);
    expect(capsule.querySelector('.uc-team-jersey')).toBeNull();
    expect(capsule.textContent).toBe('Lv0球員');
  });

  it('球衣插槽不會繞過停用的名片操作', () => {
    const open = vi.fn();
    render(<UserTag uid="jersey-user" name="球員" disabled
      jersey={<svg class="uc-team-jersey" role="img" aria-label="空衣" />} onOpenProfile={open} />);
    fireEvent.click(screen.getByRole('img', { name: '空衣' }));
    expect(open).not.toHaveBeenCalled();
  });

  it('出席率染色照 A：uc-att-warn、CSS 變數與放鴿子 title', () => {
    render(
      <UserTag
        uid="u1"
        name="戊"
        attendanceFill={{ pct: 40, color: 'red', noShow: 2, ended: 5 }}
        recentNoShow
        onOpenProfile={() => undefined}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.classList.contains('uc-att-warn')).toBe(true);
    expect(btn.getAttribute('title')).toBe('放鴿子 2/5 場 (40%)');
    expect(btn.querySelector('.uc-recent-noshow')).not.toBeNull();
  });
});
