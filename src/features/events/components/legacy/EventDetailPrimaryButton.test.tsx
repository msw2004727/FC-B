import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import type { SignupButtonState } from '../../data/signup-state';
import {
  EventDetailPrimaryButton,
  type EventDetailPrimaryButtonProps,
} from './EventDetailPrimaryButton';

vi.mock('./signup-a11y.css', () => ({}));

afterEach(() => {
  cleanup();
});

function makeState(overrides: Partial<SignupButtonState> = {}): SignupButtonState {
  return {
    kind: 'signup',
    label: '立即報名',
    labelKey: 'events.detailPage.button.signup',
    disabled: false,
    action: 'signup',
    tone: 'primary',
    variant: 'primary',
    glow: 'var(--accent)',
    glowLight: 'var(--accent-hover)',
    hint: '報名中',
    glowWrap: true,
    ...overrides,
  };
}

function renderButton(overrides: Partial<EventDetailPrimaryButtonProps> = {}) {
  const props: EventDetailPrimaryButtonProps = {
    state: makeState(),
    disabled: false,
    busy: false,
    flip: null,
    onClick: () => {},
    ...overrides,
  };
  return render(<EventDetailPrimaryButton {...props} />);
}

describe('EventDetailPrimaryButton', () => {
  it('glow 結構照 A _glowWrap', () => {
    const { container } = renderButton();
    const wrap = container.querySelector('.signup-glow-wrap');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('.signup-glow-border')).not.toBeNull();
    expect(wrap?.querySelector('.signup-glow-shadow')).not.toBeNull();
    expect(wrap?.querySelector('.signup-flipper')).not.toBeNull();
    expect(wrap?.querySelector('.signup-loading-hint .mini-spinner')).not.toBeNull();
    expect(wrap?.querySelector('.signup-loading-hint .mini-text')?.textContent).toBe('報名中');
    expect(wrap?.querySelector('button.primary-btn')?.textContent).toContain('立即報名');
  });

  it('busy 時加 aria-busy、sr-only、loading 與報名中文字', () => {
    const { container } = renderButton({ busy: true });
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.textContent).toContain('報名中...');
    expect(container.querySelector('.fcb-sr-only')?.textContent).toBe('處理中');
    expect(container.querySelector('.signup-glow-wrap')?.classList.contains('loading')).toBe(true);
  });

  it('取消候補 busy 文字照 U-028', () => {
    const { container } = renderButton({
      state: makeState({
        kind: 'cancelWaitlist',
        label: '取消候補',
        bg: '#7c3aed',
        glow: '#7c3aed',
        glowLight: '#a78bfa',
        hint: '正在取消候補',
      }),
      busy: true,
    });
    expect(container.querySelector('button')?.textContent).toContain('取消候補中...');
  });

  it('flip 非 null 時加 signup-flip-back 與 flipped', () => {
    const { container } = renderButton({
      flip: { text: '取消候補', background: '#7c3aed', serial: 1 },
    });
    const back = container.querySelector('.signup-flip-back');
    expect(back?.textContent).toBe('取消候補');
    expect(back?.getAttribute('style')).toContain('background');
    expect(container.querySelector('.signup-flipper')?.classList.contains('flipped')).toBe(true);
    expect(container.querySelector('.signup-glow-wrap')?.classList.contains('flipped')).toBe(true);
  });

  it('早鳥可報 DOM', () => {
    const { container } = renderButton({
      state: makeState({
        kind: 'earlyBird',
        label: '早鳥報名 · 50 積分',
        variant: 'earlyBird',
        action: 'earlyBird',
        glow: '#d97706',
        glowLight: '#fbbf24',
        hint: '早鳥報名中',
        glowWrap: true,
      }),
    });
    expect(container.querySelector('.signup-glow-wrap.event-early-bird-cta')).not.toBeNull();
    expect(container.querySelector('button.event-early-bird-btn')?.textContent)
      .toContain('早鳥報名 · 50 積分');
  });

  it('早鳥不可報 DOM', () => {
    const { container } = renderButton({
      state: makeState({
        kind: 'earlyBirdFull',
        label: '早鳥名額已滿',
        variant: 'earlyBird',
        disabled: true,
        action: 'none',
        glowWrap: false,
        subtext: '正式開放後可依活動狀態候補報名',
      }),
    });
    expect(container.querySelector('.signup-glow-wrap')).toBeNull();
    expect(container.querySelector('.event-early-bird-cta')).not.toBeNull();
    expect(container.querySelector('button.event-early-bird-btn-disabled')?.textContent)
      .toContain('早鳥名額已滿');
    expect(container.querySelector('.event-early-bird-subtext')?.textContent)
      .toBe('正式開放後可依活動狀態候補報名');
  });

  it('disabled 時不呼叫 onClick', () => {
    const onClick = vi.fn();
    const { container } = renderButton({ disabled: true, onClick });
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    if (button) fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
