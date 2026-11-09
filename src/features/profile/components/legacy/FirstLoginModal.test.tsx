import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

import { LegacyFirstLoginModal } from './LegacyFirstLoginModal';

vi.mock('../../data/profile-writes', () => ({
  saveFirstLoginProfile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));

import { saveFirstLoginProfile } from '../../data/profile-writes';
import { toast } from '@/ui/Toast';

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  vi.mocked(saveFirstLoginProfile).mockReset();
  vi.mocked(saveFirstLoginProfile).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

/** 捲動容器是彈窗本身（.modal { overflow-y: auto }），不是 .modal-body。 */
function modalScroller(): HTMLElement {
  const modal = document.getElementById('first-login-modal');
  if (!(modal instanceof HTMLElement)) throw new Error('missing #first-login-modal');
  return modal;
}

let rafQueue: FrameRequestCallback[] = [];

function flushScrollFrame(): void {
  act(() => {
    const batch = rafQueue.splice(0, rafQueue.length);
    for (const cb of batch) cb(0);
  });
}

/** jsdom 沒有版面，直接覆寫捲動尺寸後派 scroll。 */
function setScrollMetrics(
  el: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: metrics.clientHeight });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    writable: true,
    value: metrics.scrollTop,
  });
}

function fieldOf(id: string): HTMLElement {
  const field = document.getElementById(id)?.closest('.fl-field');
  if (!(field instanceof HTMLElement)) throw new Error(`missing field for #${id}`);
  return field;
}

function stubReducedMotion(reduced: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function layoutCss(): string {
  return readFileSync(resolve(process.cwd(), 'src/styles/legacy/layout.css'), 'utf8');
}

/** 選擇器剛好是彈窗自己（不含後代）的宣告區塊。 */
function modalOwnBlocks(css: string): string[] {
  const blocks: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    const selector = match[1] ?? '';
    const body = match[2] ?? '';
    const parts = selector.replace(/\s+/g, ' ').trim().split(',').map((part) => part.trim());
    const ownsModal = parts.every((part) => (
      part === '#first-login-modal' || part === '#first-login-modal.open'
      || part === '[data-theme="dark"] #first-login-modal'
    ));
    if (ownsModal) blocks.push(body);
  }
  return blocks;
}

function ruleBodyIncluding(css: string, snippet: string): string {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    const selector = match[1] ?? '';
    const body = match[2] ?? '';
    if (selector.includes(snippet)) return body;
  }
  return '';
}

describe('LegacyFirstLoginModal 短螢幕捲動', () => {
  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafQueue[id - 1] = () => {};
    });
  });

  it('內容可捲且未到底時顯示「還有欄位」，捲到底後隱藏', () => {
    renderModal();
    const scroller = modalScroller();
    setScrollMetrics(scroller, { scrollHeight: 800, clientHeight: 300, scrollTop: 0 });
    fireEvent.scroll(scroller);
    flushScrollFrame();
    const hint = document.querySelector('.fl-scroll-hint');
    expect(hint).not.toBeNull();
    expect(document.querySelector('.fl-scroll-hint__label')?.textContent).toBe('還有欄位');
    expect(document.querySelector('.fl-scroll-hint__arrow')).not.toBeNull();

    setScrollMetrics(scroller, { scrollHeight: 800, clientHeight: 300, scrollTop: 500 });
    fireEvent.scroll(scroller);
    flushScrollFrame();
    expect(document.querySelector('.fl-scroll-hint')).toBeNull();
  });

  it('先出現提示，改成不需捲動並再觸發 scroll 後提示消失', () => {
    renderModal();
    const scroller = modalScroller();
    setScrollMetrics(scroller, { scrollHeight: 800, clientHeight: 300, scrollTop: 0 });
    fireEvent.scroll(scroller);
    flushScrollFrame();
    expect(document.querySelector('.fl-scroll-hint')).not.toBeNull();

    setScrollMetrics(scroller, { scrollHeight: 300, clientHeight: 320, scrollTop: 0 });
    fireEvent.scroll(scroller);
    flushScrollFrame();
    expect(document.querySelector('.fl-scroll-hint')).toBeNull();
  });

  it('點向下箭頭以平滑捲動捲到底', () => {
    renderModal();
    const scroller = modalScroller();
    setScrollMetrics(scroller, { scrollHeight: 800, clientHeight: 300, scrollTop: 0 });
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo;
    fireEvent.scroll(scroller);
    flushScrollFrame();
    fireEvent.click(document.querySelector('.fl-scroll-hint__arrow') as SVGElement);
    expect(scrollTo).toHaveBeenCalledWith({ top: 800, behavior: 'smooth' });
  });

  it('地區未填時捲到該欄位、外框標錯，填好後移除；原本的缺漏提示仍在', () => {
    renderModal({
      initial: { gender: '男', birthday: '1990/01/15', region: '', email: '' },
    });
    const field = fieldOf('fl-region-input');
    const input = document.getElementById('fl-region-input') as HTMLInputElement;
    const scrollIntoView = vi.fn();
    const focus = vi.spyOn(input, 'focus');
    field.scrollIntoView = scrollIntoView;
    fireEvent.click(document.getElementById('fl-legal-consent') as HTMLInputElement);
    fireEvent.click(document.querySelector('.fl-submit-btn') as HTMLButtonElement);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(focus).toHaveBeenCalledWith();
    expect(field.classList.contains('fl-field--error')).toBe(true);
    expect(input.classList.contains('fl-field--error')).toBe(true);
    expect(fieldOf('fl-gender').classList.contains('fl-field--error')).toBe(false);
    expect(vi.mocked(toast.show)).toHaveBeenCalledWith({
      message: '請填寫所有必填欄位（性別、生日、地區）',
    });
    expect(saveFirstLoginProfile).not.toHaveBeenCalled();

    fireEvent.input(input, { target: { value: '   ' } });
    expect(field.classList.contains('fl-field--error')).toBe(true);
    expect(input.classList.contains('fl-field--error')).toBe(true);
    fireEvent.input(input, { target: { value: '台北市' } });
    expect(field.classList.contains('fl-field--error')).toBe(false);
    expect(input.classList.contains('fl-field--error')).toBe(false);
  });

  it('紅框 class 在有框線的控制項上，layout.css 該 class 含 border', () => {
    renderModal({
      initial: { gender: '男', birthday: '1990/01/15', region: '', email: '' },
    });
    fireEvent.click(document.getElementById('fl-legal-consent') as HTMLInputElement);
    fireEvent.click(document.querySelector('.fl-submit-btn') as HTMLButtonElement);
    const input = document.getElementById('fl-region-input') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.classList.contains('fl-field--error')).toBe(true);
    const gender = document.getElementById('fl-gender') as HTMLSelectElement;
    expect(gender.classList.contains('fl-field--error')).toBe(false);

    const css = layoutCss();
    const errorRule = ruleBodyIncluding(css, '.fl-field--error');
    expect(errorRule).toMatch(/border\s*:\s*1px\s+solid\s+var\(--danger\)/);
    expect(errorRule).toMatch(/border-radius\s*:/);
    const controlRule = ruleBodyIncluding(css, '.fl-field input');
    expect(controlRule).toMatch(/border\s*:/);
  });

  it('漏填且未勾同意時仍捲到並標紅第一個漏填欄位，同意錯誤提示照舊', () => {
    renderModal();
    const genderField = fieldOf('fl-gender');
    const gender = document.getElementById('fl-gender') as HTMLSelectElement;
    const scrollIntoView = vi.fn();
    genderField.scrollIntoView = scrollIntoView;
    fireEvent.click(document.querySelector('.fl-submit-btn') as HTMLButtonElement);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(genderField.classList.contains('fl-field--error')).toBe(true);
    expect(gender.classList.contains('fl-field--error')).toBe(true);
    expect(fieldOf('fl-region-input').classList.contains('fl-field--error')).toBe(false);
    expect(vi.mocked(toast.show)).toHaveBeenCalledWith({
      message: '請先勾選同意服務條款與隱私權政策。',
    });
    expect(vi.mocked(toast.show)).not.toHaveBeenCalledWith({
      message: '請填寫所有必填欄位（性別、生日、地區）',
    });
    expect(saveFirstLoginProfile).not.toHaveBeenCalled();
  });

  it('第一個缺漏是性別時捲到性別欄，不標後面的地區', () => {
    renderModal();
    const genderField = fieldOf('fl-gender');
    const gender = document.getElementById('fl-gender') as HTMLSelectElement;
    const scrollIntoView = vi.fn();
    genderField.scrollIntoView = scrollIntoView;
    fireEvent.click(document.getElementById('fl-legal-consent') as HTMLInputElement);
    fireEvent.click(document.querySelector('.fl-submit-btn') as HTMLButtonElement);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(genderField.classList.contains('fl-field--error')).toBe(true);
    expect(gender.tagName).toBe('SELECT');
    expect(gender.classList.contains('fl-field--error')).toBe(true);
    expect(fieldOf('fl-region-input').classList.contains('fl-field--error')).toBe(false);
    expect(saveFirstLoginProfile).not.toHaveBeenCalled();
  });

  it('#first-login-modal 自身規則沒有 overflow:hidden 與 display:flex', () => {
    const blocks = modalOwnBlocks(layoutCss());
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).not.toMatch(/overflow\s*:\s*hidden/);
      expect(block).not.toMatch(/display\s*:\s*flex/);
    }
  });

  it('prefers-reduced-motion 時捲動 behavior 為 auto', () => {
    stubReducedMotion(true);
    renderModal({
      initial: { gender: '男', birthday: '1990/01/15', region: '', email: '' },
    });
    const field = fieldOf('fl-region-input');
    const scrollIntoView = vi.fn();
    field.scrollIntoView = scrollIntoView;
    fireEvent.click(document.getElementById('fl-legal-consent') as HTMLInputElement);
    fireEvent.click(document.querySelector('.fl-submit-btn') as HTMLButtonElement);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });

    const scroller = modalScroller();
    setScrollMetrics(scroller, { scrollHeight: 800, clientHeight: 300, scrollTop: 0 });
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo;
    fireEvent.scroll(scroller);
    flushScrollFrame();
    fireEvent.click(document.querySelector('.fl-scroll-hint__btn') as HTMLButtonElement);
    expect(scrollTo).toHaveBeenCalledWith({ top: 800, behavior: 'auto' });
  });
});
