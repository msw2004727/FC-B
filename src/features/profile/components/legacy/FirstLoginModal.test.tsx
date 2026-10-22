import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

import { LegacyFirstLoginModal } from './LegacyFirstLoginModal';

vi.mock('../../data/profile-writes', () => ({
  saveFirstLoginProfile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));

import { saveFirstLoginProfile } from '../../data/profile-writes';

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  vi.mocked(saveFirstLoginProfile).mockReset();
  vi.mocked(saveFirstLoginProfile).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

interface RenderOpts {
  initial?: {
    gender: string;
    birthday: string;
    region: string;
    email: string;
  };
  onClose?: () => void;
  onSaved?: (patch: Record<string, unknown>) => void;
}

function renderModal(opts: RenderOpts = {}): {
  onClose: ReturnType<typeof vi.fn>;
  onSaved: ReturnType<typeof vi.fn>;
} {
  const onClose = (opts.onClose ?? vi.fn()) as ReturnType<typeof vi.fn>;
  const onSaved = (opts.onSaved ?? vi.fn()) as ReturnType<typeof vi.fn>;
  render(
    <LegacyFirstLoginModal
      uid="u1"
      initial={opts.initial ?? { gender: '', birthday: '', region: '', email: '' }}
      onClose={onClose as () => void}
      onSaved={onSaved as (patch: Record<string, unknown>) => void}
    />,
  );
  return { onClose, onSaved };
}

describe('LegacyFirstLoginModal（M-130 照 A index.html#first-login-modal）', () => {
  it('renders A DOM：class、id、role、aria、data-no-backdrop-close', () => {
    renderModal();
    const modal = document.getElementById('first-login-modal');
    expect(modal).not.toBeNull();
    expect(modal?.classList.contains('modal')).toBe(true);
    expect(modal?.classList.contains('profile-complete-modal')).toBe(true);
    expect(modal?.getAttribute('role')).toBe('dialog');
    expect(modal?.getAttribute('aria-modal')).toBe('true');
    expect(modal?.getAttribute('aria-labelledby')).toBe('first-login-title');
    expect(modal?.getAttribute('data-no-backdrop-close')).toBe('1');
    expect(document.getElementById('first-login-title')?.textContent).toBe('完善個人資料');
    expect(document.getElementById('fl-gender')).not.toBeNull();
    expect(document.getElementById('fl-birthday-y')).not.toBeNull();
    expect(document.getElementById('fl-birthday-m')).not.toBeNull();
    expect(document.getElementById('fl-birthday-d')).not.toBeNull();
    expect(document.getElementById('fl-region-input')).not.toBeNull();
    expect(document.getElementById('fl-email')).not.toBeNull();
    expect(document.getElementById('fl-legal-consent')).not.toBeNull();
    expect(document.getElementById('fl-error-msg')).not.toBeNull();
    expect(document.querySelector('.fl-submit-btn')?.textContent).toBe('同意並送出');
    expect(document.querySelector('.fl-secondary-btn')?.textContent).toBe('稍後填寫');
  });

  it('需要先勾選法律同意才呼叫 saveFirstLoginProfile（照 A _requireFirstLoginLegalConsent）', async () => {
    const { onSaved } = renderModal();
    const submit = document.querySelector('.fl-submit-btn') as HTMLButtonElement;
    fireEvent.click(submit);
    await Promise.resolve();
    expect(saveFirstLoginProfile).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('必填未填時不寫入（照 A 必填檢查）', async () => {
    renderModal();
    fireEvent.click(document.getElementById('fl-legal-consent') as HTMLInputElement);
    const submit = document.querySelector('.fl-submit-btn') as HTMLButtonElement;
    fireEvent.click(submit);
    await Promise.resolve();
    expect(saveFirstLoginProfile).not.toHaveBeenCalled();
  });

  it('有效提交時呼叫 saveFirstLoginProfile、寫入 patch 不含 legalConsent、關閉 modal', async () => {
    const { onClose, onSaved } = renderModal({
      initial: { gender: '男', birthday: '1990/01/15', region: '台北市', email: '' },
    });
    fireEvent.click(document.getElementById('fl-legal-consent') as HTMLInputElement);
    const submit = document.querySelector('.fl-submit-btn') as HTMLButtonElement;
    fireEvent.click(submit);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(saveFirstLoginProfile).toHaveBeenCalledWith('u1', {
      gender: '男',
      birthday: '1990/01/15',
      region: '台北市',
      legalConsent: true,
    });
    expect(onClose).toHaveBeenCalled();
    const patch = (onSaved as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(patch).toEqual({ gender: '男', birthday: '1990/01/15', region: '台北市' });
    expect(patch).not.toHaveProperty('legalConsent');
  });

  it('「稍後填寫」關閉且不寫入（照 A dismissFirstLoginModal）', () => {
    const { onClose } = renderModal();
    fireEvent.click(document.querySelector('.fl-secondary-btn') as HTMLButtonElement);
    expect(onClose).toHaveBeenCalled();
    expect(saveFirstLoginProfile).not.toHaveBeenCalled();
  });

  it('輸入「台」時出現縣市建議選項（照 A flRenderList）', async () => {
    renderModal();
    const input = document.getElementById('fl-region-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '台' } });
    await waitFor(() => {
      expect(document.querySelector('#fl-region-list [data-region="台北市"]')).not.toBeNull();
    });
  });

  it('點選建議選項後填入地區（照 A flSelectRegion）', async () => {
    renderModal();
    const input = document.getElementById('fl-region-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '台' } });
    await waitFor(() => {
      expect(document.querySelector('#fl-region-list [data-region="台北市"]')).not.toBeNull();
    });
    fireEvent.click(document.querySelector('#fl-region-list [data-region="台北市"]') as HTMLElement);
    await waitFor(() => expect(input.value).toBe('台北市'));
  });

  it('填無效地區送出顯示錯誤且不呼叫 saveFirstLoginProfile', async () => {
    renderModal({
      initial: { gender: '男', birthday: '1990/01/15', region: '', email: '' },
    });
    const input = document.getElementById('fl-region-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '火星' } });
    fireEvent.click(document.getElementById('fl-legal-consent') as HTMLInputElement);
    fireEvent.click(document.querySelector('.fl-submit-btn') as HTMLButtonElement);
    await waitFor(() => {
      expect(document.getElementById('fl-error-msg')?.textContent)
        .toBe('請輸入有效的縣市名稱');
    });
    expect(saveFirstLoginProfile).not.toHaveBeenCalled();
  });
});
