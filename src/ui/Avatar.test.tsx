import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { t } from '@/i18n/i18n';
import { Avatar, _resetBrokenAvatarUrlsForTest, isBrokenAvatarUrl, type UserRole } from './Avatar';
import { prepareUi2Locale, resetUi2Locale } from './ui2-test-utils';

beforeEach(() => {
  _resetBrokenAvatarUrlsForTest();
  return prepareUi2Locale();
});
afterEach(() => {
  _resetBrokenAvatarUrlsForTest();
  cleanup();
  resetUi2Locale();
});

describe('Avatar', () => {
  it('prefers pictureUrl, sets referrerpolicy="no-referrer", and reserves image dimensions (M-059)', () => {
    const { getByRole } = render(
      <Avatar name="Alice" pictureUrl="/picture.png" avatarUrl="/avatar.png" size="lg" />,
    );
    const image = getByRole('img', { name: 'Alice' });
    expect(image.getAttribute('src')).toBe('/picture.png');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(image.getAttribute('width')).toBe('44');
    expect(image.getAttribute('height')).toBe('44');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');
  });

  it('uses avatarUrl only when pictureUrl is nullish', () => {
    const { getByRole, rerender } = render(
      <Avatar name="Alice" pictureUrl={null} avatarUrl="/avatar.png" />,
    );
    expect(getByRole('img').getAttribute('src')).toBe('/avatar.png');

    rerender(<Avatar name="Alice" pictureUrl="" avatarUrl="/avatar.png" />);
    expect(getByRole('img').tagName).toBe('SPAN');
    expect(getByRole('img').textContent).toBe('A');
  });

  it('tries next candidate URL on error, remembers broken URLs across instances, and falls back to initial (M-059, U-018)', () => {
    const { getByRole, rerender, unmount } = render(
      <Avatar name="王小明" pictureUrl="/bad-1.png" avatarUrl="/backup-2.png" />,
    );
    // 第一個網址失敗 → 自動輪試第二個網址並記住壞網址
    fireEvent.error(getByRole('img'));
    expect(isBrokenAvatarUrl('/bad-1.png')).toBe(true);
    expect(getByRole('img').getAttribute('src')).toBe('/backup-2.png');

    // 第二個網址也失敗 → 顯示名字首字「王」
    fireEvent.error(getByRole('img'));
    expect(isBrokenAvatarUrl('/backup-2.png')).toBe(true);
    expect(getByRole('img', { name: '王小明' }).textContent).toBe('王');

    // 換新網址時重試
    rerender(<Avatar name="王小明" pictureUrl="/good.png" />);
    expect(getByRole('img').getAttribute('src')).toBe('/good.png');
    unmount();

    // U-018：另一個 Avatar 傳入已記住的壞網址時直接顯示首字，不再輸出破圖 <img>
    const second = render(<Avatar name="李大華" pictureUrl="/bad-1.png" />);
    expect(second.container.querySelector('img')).toBeNull();
    expect(second.getByRole('img', { name: '李大華' }).textContent).toBe('李');
  });

  it('treats loaded images smaller than 2px as broken (M-059)', () => {
    const { getByRole } = render(<Avatar name="陳小華" pictureUrl="/1x1.png" />);
    const img = getByRole('img') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 1, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 1, configurable: true });
    fireEvent.load(img);
    expect(isBrokenAvatarUrl('/1x1.png')).toBe(true);
    expect(getByRole('img', { name: '陳小華' }).textContent).toBe('陳');
  });

  // 測試同步更新：照 A（M-059）首字保留原字不強轉大寫
  it.each<UserRole>([
    'user', 'coach', 'captain', 'team_leader', 'venue_owner', 'admin', 'super_admin',
  ])('maps role %s to its variant', (role) => {
    const { container } = render(<Avatar name="alex" role={role} />);
    expect(container.firstElementChild?.classList.contains(`ui-avatar--${role}`)).toBe(true);
    expect(container.textContent).toBe('a');
  });

  it.each([
    ['sm', '24'], ['md', '32'], ['lg', '44'],
  ] as const)('uses %s dimensions', (size, pixels) => {
    const { getByRole, container } = render(<Avatar name="A" pictureUrl="/a.png" size={size} />);
    expect(getByRole('img').getAttribute('width')).toBe(pixels);
    expect(container.firstElementChild?.classList.contains(`ui-avatar--${size}`)).toBe(true);
  });

  it('hides decorative images and fallback from accessibility queries', () => {
    const { queryByRole, container, rerender } = render(
      <Avatar name="Alice" pictureUrl="/a.png" decorative />,
    );
    expect(queryByRole('img')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');

    rerender(<Avatar name="Alice" decorative />);
    expect(queryByRole('img')).toBeNull();
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  // 測試同步更新：照 A（M-059）沒名字時視覺顯示「?」，無障礙 aria-label 仍維持翻譯文案
  it('displays "?" when name is missing while keeping translated aria-label', () => {
    const { getByRole } = render(<Avatar />);
    expect(getByRole('img').getAttribute('aria-label')).toBe(t('ui.avatar.unknown'));
    expect(getByRole('img').getAttribute('aria-label')).toBe('未提供名稱');
    expect(getByRole('img').textContent).toBe('?');
  });
});
