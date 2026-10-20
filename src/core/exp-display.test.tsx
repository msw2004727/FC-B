import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { SHOW_EXP } from './exp-display';
import { UserTag } from '@/ui/UserTag';
import { TopBar } from '@/ui/TopBar';

vi.mock('@/data/user-roles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/user-roles')>()),
  getCachedUserLevel: () => 7,
}));

describe('新版關閉經驗值顯示（站長 2026-10-20：經驗值照舊累計，只關顯示）', () => {
  afterEach(() => cleanup());

  it('預設關閉', () => {
    expect(SHOW_EXP).toBe(false);
  });

  it('使用者膠囊不畫 Lv', () => {
    const { container } = render(<UserTag uid="u1" name="小明" onOpenProfile={() => {}} />);
    expect(container.querySelector('.uc-lv')).toBeNull();
    expect(container.textContent).toBe('小明');
  });

  it('頂部列不畫 EXP', () => {
    const { container } = render(<TopBar drawerOpen={false} onMenuClick={() => {}} />);
    expect(container.querySelector('#points-display')).toBeNull();
  });
});
