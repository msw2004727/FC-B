import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));

import { toast } from '@/ui/Toast';

import { UserCardBadges } from './UserCardBadges';
import { UNAVAILABLE_MSG } from './profile-legacy-helpers';

describe('UserCardBadges', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('看他人時輸出空狀態與毛玻璃', () => {
    const { container } = render(<UserCardBadges uid="target" isSelf={false} />);
    expect(container.textContent).toContain('已獲得徽章');
    expect(container.textContent).toContain('尚未獲得徽章');
    expect(container.querySelector('.uc-blur-overlay')).toBeTruthy();
    expect(container.textContent).toContain('點擊載入此用戶的徽章');
  });

  it('本人時不顯示毛玻璃', () => {
    const { container } = render(<UserCardBadges uid="target" isSelf={true} />);
    expect(container.querySelector('.uc-blur-overlay')).toBeFalsy();
    expect(container.textContent).toContain('尚未獲得徽章');
  });

  it('點毛玻璃先 toast UNAVAILABLE_MSG', () => {
    const { container } = render(<UserCardBadges uid="target" isSelf={false} />);
    const blur = container.querySelector('.uc-blur-overlay');
    expect(blur).toBeTruthy();
    if (blur) fireEvent.click(blur);
    expect(toast.show).toHaveBeenCalledWith({ message: UNAVAILABLE_MSG });
  });
});
