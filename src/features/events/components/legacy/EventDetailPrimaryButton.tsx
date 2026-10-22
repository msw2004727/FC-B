import type { JSX } from 'preact';
import type { SignupButtonState } from '../../data/signup-state';
import './signup-a11y.css';

export interface SignupFlip {
  text: string;
  background: string;
  serial: number;
}

export interface EventDetailPrimaryButtonProps {
  state: SignupButtonState;
  disabled: boolean;
  busy: boolean;
  flip: SignupFlip | null;
  onClick: () => void;
}

// 照 A `event-detail-signup.js#handleSignup` 第 1950～1965 行的文字替換。
function getBusyLabel(state: SignupButtonState): string {
  if (state.kind === 'cancelWaitlist') return '取消候補中...';
  if (state.kind === 'cancel') return '取消報名中...';
  if (state.label.includes('候補')) return '候補中...';
  return '報名中...';
}

// 照 A `event-detail-signup.js` 第 2084～2104 行的 signup-flip-back。
function flipStyle(flip: SignupFlip): string {
  const parts = [
    `background:${flip.background}`,
    'color:#fff',
    'padding:.55rem 1.2rem',
  ];
  if (flip.text === '立即報名') parts.push('font-weight:600');
  return parts.join(';');
}

// 照 A showEventDetail 的 `_glowWrap` helper。
function renderGlowWrap(
  button: JSX.Element,
  state: SignupButtonState,
  busy: boolean,
  flip: SignupFlip | null,
  extraClass = '',
): JSX.Element {
  const wrapClass = `signup-glow-wrap${extraClass ? ` ${extraClass}` : ''}`
    + `${busy ? ' loading' : ''}${flip ? ' flipped' : ''}`;
  const flipperClass = `signup-flipper${flip ? ' flipped' : ''}`;
  return (
    <div
      class={wrapClass}
      style={`--glow-c:${state.glow ?? 'var(--accent)'};--glow-c-light:${state.glowLight ?? 'var(--accent-hover)'}`}
    >
      <div class="signup-glow-border" />
      <div class="signup-glow-shadow" />
      <div class={flipperClass}>
        {button}
        {flip && (
          <div class="signup-flip-back" style={flipStyle(flip)}>{flip.text}</div>
        )}
      </div>
      <div class="signup-loading-hint">
        <div class="mini-spinner" />
        <span class="mini-text">{state.hint || '資料更新中'}</span>
      </div>
    </div>
  );
}

export function EventDetailPrimaryButton({
  state,
  disabled,
  busy,
  flip,
  onClick,
}: EventDetailPrimaryButtonProps): JSX.Element {
  const isDisabled = disabled || busy || state.disabled;
  const text = busy ? getBusyLabel(state) : state.label;
  const handleClick = isDisabled ? undefined : onClick;
  const srOnly = busy ? <span class="fcb-sr-only">處理中</span> : null;

  // 照 A `_buildEventSignupLoadingButton`（a-earlybird.js）。
  if (state.variant === 'syncing') {
    return (
      <button
        type="button"
        style="display:inline-flex;align-items:center;justify-content:center;gap:.45rem;min-height:2.1rem;background:#64748b;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed;opacity:.82"
        aria-busy="true"
        aria-live="polite"
        disabled
      >
        <span
          class="mini-spinner"
          style="width:14px;height:14px;border:2px solid rgba(255,255,255,.38);border-top-color:#fff;border-radius:50%;animation:signup-mini-spin .7s linear infinite;display:inline-block;flex:0 0 auto"
          aria-hidden="true"
        />
        <span>{state.label}</span>
      </button>
    );
  }

  const ariaBusy = busy ? 'true' : undefined;
  const ariaDisabled = busy ? 'true' : undefined;

  // 照 A `_buildEventEarlyBirdSignupHtml`。
  if (state.variant === 'earlyBird') {
    const earlyBirdDisabledClass = (disabled || state.disabled)
      ? ' event-early-bird-btn-disabled'
      : '';
    const button = (
      <button
        type="button"
        class={`event-early-bird-btn${earlyBirdDisabledClass}`}
        disabled={isDisabled}
        onClick={handleClick}
        aria-busy={ariaBusy}
        aria-disabled={ariaDisabled}
      >
        {text}
        {srOnly}
      </button>
    );
    if (state.glowWrap) {
      return renderGlowWrap(button, state, busy, flip, 'event-early-bird-cta');
    }
    return (
      <div class="event-early-bird-cta">
        {button}
        {state.subtext && <div class="event-early-bird-subtext">{state.subtext}</div>}
      </div>
    );
  }

  // 照 A showEventDetail 的 primary-btn。
  if (state.variant === 'primary') {
    const button = (
      <button
        type="button"
        class="primary-btn"
        disabled={isDisabled}
        onClick={handleClick}
        aria-busy={ariaBusy}
        aria-disabled={ariaDisabled}
      >
        {text}
        {srOnly}
      </button>
    );
    return state.glowWrap ? renderGlowWrap(button, state, busy, flip) : button;
  }

  // 照 A 各 styled 按鈕 inline style。
  const styleParts = [
    `background:${state.bg ?? '#64748b'}`,
    `color:${state.color ?? '#fff'}`,
    'padding:.55rem 1.2rem',
    'border-radius:var(--radius)',
    'border:none',
    'font-size:.85rem',
    `cursor:${isDisabled ? 'not-allowed' : 'pointer'}`,
  ];
  if (state.opacity != null && state.opacity !== 1) {
    styleParts.push(`opacity:${state.opacity}`);
  }
  const button = (
    <button
      type="button"
      style={styleParts.join(';')}
      disabled={isDisabled}
      onClick={handleClick}
      aria-busy={ariaBusy}
      aria-disabled={ariaDisabled}
    >
      {text}
      {srOnly}
    </button>
  );
  return state.glowWrap ? renderGlowWrap(button, state, busy, flip) : button;
}
