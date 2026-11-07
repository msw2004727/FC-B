import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCardLink } from './open-card-link';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openCardLink', () => {
  // 測試同步更新：外連共用分頁
  it('https 同步開共用分頁，不先 await', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const result = openCardLink('https://cup.toosterx.com/');
    expect(result).toBeUndefined();
    expect(open).toHaveBeenCalledWith('https://cup.toosterx.com/', 'toosterx_external');
    expect(open.mock.calls[0]).toHaveLength(2);
  });

  it('非 https 不開', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openCardLink('javascript:alert(1)');
    openCardLink('http://a.com/');
    openCardLink('');
    expect(open).not.toHaveBeenCalled();
  });
});
