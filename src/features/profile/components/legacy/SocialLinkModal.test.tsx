import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

import { LegacySocialLinkModal } from './LegacySocialLinkModal';
import type { Platform } from '../../ui/shared';

vi.mock('../../data/profile-writes', () => ({
  clearSocialLink: vi.fn().mockResolvedValue(undefined),
  saveSocialLink: vi.fn().mockResolvedValue(undefined),
  normalizeLineContactUrl: vi.fn((value: unknown) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw) || /^line:\/\//i.test(raw)) return raw;
    return `https://line.me/ti/p/${encodeURIComponent(raw.replace(/^@/, ''))}`;
  }),
}));

vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));

import { clearSocialLink, saveSocialLink } from '../../data/profile-writes';

// ASSUMPTION: 附件未給 Platform union；測試以已知 alias 傳入，透過 unknown 轉型避免型別耦合。
const ig = 'ig' as unknown as Platform;
const line = 'line' as unknown as Platform;

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  vi.mocked(saveSocialLink).mockReset();
  vi.mocked(saveSocialLink).mockResolvedValue(undefined);
  vi.mocked(clearSocialLink).mockReset();
  vi.mocked(clearSocialLink).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('LegacySocialLinkModal（M-130 照 A pages/profile.html#social-link-modal）', () => {
  it('renders A DOM：class、id、平台標題／label／prefix、清除與儲存按鈕', () => {
    render(
      <LegacySocialLinkModal
        uid="u1"
        platform={ig}
        socialLinks={{}}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(document.getElementById('social-link-modal')).not.toBeNull();
    expect(document.getElementById('social-modal-title')?.textContent).toBe('編輯 Instagram 連結');
    expect(document.getElementById('social-modal-label')?.textContent).toBe('你的 Instagram ID');
    expect(document.getElementById('social-url-prefix')?.textContent).toBe('https://www.instagram.com/');
    expect((document.getElementById('social-link-input') as HTMLInputElement).placeholder).toBe('your_id');
    expect(document.getElementById('social-clear-btn')?.textContent).toBe('清除');
    expect(document.querySelector('#social-link-modal .primary-btn')?.textContent).toBe('儲存');
  });

  it('沒有既有值時 #social-clear-btn 以 inline display:none 隱藏', () => {
    render(
      <LegacySocialLinkModal
        uid="u1"
        platform={ig}
        socialLinks={{}}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const clearBtn = document.getElementById('social-clear-btn') as HTMLButtonElement;
    expect(clearBtn.style.display).toBe('none');
  });

  it('有既有值時 #social-clear-btn 顯示且輸入框帶入既有 ID', () => {
    render(
      <LegacySocialLinkModal
        uid="u1"
        platform={ig}
        socialLinks={{ ig: 'myhandle' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const clearBtn = document.getElementById('social-clear-btn') as HTMLButtonElement;
    expect(clearBtn.style.display).not.toBe('none');
    expect((document.getElementById('social-link-input') as HTMLInputElement).value).toBe('myhandle');
  });

  it('非 LINE 平台以原始 ID 呼叫 saveSocialLink，toast 儲存文字照 A', async () => {
    const onSaved = vi.fn();
    render(
      <LegacySocialLinkModal
        uid="u1"
        platform={ig}
        socialLinks={{}}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    const input = document.getElementById('social-link-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'myhandle' } });
    fireEvent.click(document.querySelector('#social-link-modal .primary-btn') as HTMLButtonElement);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(saveSocialLink).toHaveBeenCalledWith('u1', 'ig', 'myhandle');
    const patch = (onSaved as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | { socialLinks?: Record<string, unknown> }
      | undefined;
    expect(patch?.socialLinks?.['ig']).toBe('myhandle');
  });

  it('拒絕 javascript: 協議（R-CODE-002）', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <LegacySocialLinkModal
        uid="u1"
        platform={ig}
        socialLinks={{}}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    const input = document.getElementById('social-link-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(document.querySelector('#social-link-modal .primary-btn') as HTMLButtonElement);
    await Promise.resolve();
    expect(saveSocialLink).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('LINE 依 normalizeLineContactUrl 組出完整 URL 存入 onSaved', async () => {
    const onSaved = vi.fn();
    render(
      <LegacySocialLinkModal
        uid="u1"
        platform={line}
        socialLinks={{}}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    const input = document.getElementById('social-link-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'abc123' } });
    fireEvent.click(document.querySelector('#social-link-modal .primary-btn') as HTMLButtonElement);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(saveSocialLink).toHaveBeenCalledWith('u1', 'line', 'abc123');
    const patch = (onSaved as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | { socialLinks?: Record<string, unknown> }
      | undefined;
    expect(patch?.socialLinks?.['line']).toBe('https://line.me/ti/p/abc123');
  });

  it('LINE 既有 full URL 時輸入框以去前綴的 ID 顯示', () => {
    render(
      <LegacySocialLinkModal
        uid="u1"
        platform={line}
        socialLinks={{ line: 'https://line.me/ti/p/abc123' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect((document.getElementById('social-link-input') as HTMLInputElement).value).toBe('abc123');
    expect(document.getElementById('social-url-prefix')?.textContent).toBe('https://line.me/ti/p/');
  });

  it('按下清除呼叫 clearSocialLink', async () => {
    const onSaved = vi.fn();
    render(
      <LegacySocialLinkModal
        uid="u1"
        platform={ig}
        socialLinks={{ ig: 'old' }}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(document.getElementById('social-clear-btn') as HTMLButtonElement);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(clearSocialLink).toHaveBeenCalledWith('u1', 'ig');
  });
});
