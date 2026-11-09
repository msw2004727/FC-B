import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import {
  renderRingContent,
  ringButtonClass,
  useActionRing,
  useDeferredStart,
} from '@/ui/action-ring';
import type { SignupButtonState } from '../../data/signup-state';
import './signup-a11y.css';

/**
 * 成功後等背景刷新的訊號（取代原翻牌 SignupFlip）：每次伺服器確認成功 serial 加一並 pending=true，
 * 頁面等最短時間到且背景刷新完成（或逾時）才把 pending 改回 false。pending 期間進度環繼續爬，
 * 改回 false 時資料已是新狀態，按鈕才補滿環＋✓＋展開成新文字（不會先露出舊狀態）。
 */
export interface SignupSettle {
  serial: number;
  pending: boolean;
}

export { ringPercent } from '@/ui/action-ring';

export interface EventDetailPrimaryButtonProps {
  state: SignupButtonState;
  disabled: boolean;
  /** 頁面忙碌（含幫夥伴報名、重試等其他動作）；只有 running 時才變形成進度環。 */
  busy: boolean;
  /** 主按鈕自己的動作（報名／候補／早鳥／取消）進行中。 */
  running?: boolean;
  settle?: SignupSettle;
  onClick: () => void;
  teamReservation?: {
    label: string;
    busyLabel: string;
    busy: boolean;
    disabled?: boolean;
    /** 團隊名額寫入成功時加一；busy 結束時有變才打勾。 */
    doneSerial?: number;
    onClick: () => void;
  } | null;
}

// 照 A `event-detail-signup.js#handleSignup` 第 1950～1965 行的文字替換。
function getBusyLabel(state: SignupButtonState): string {
  if (state.kind === 'cancelWaitlist') return '取消候補中...';
  if (state.kind === 'cancel') return '取消報名中...';
  if (state.label.includes('候補')) return '候補中...';
  return '報名中...';
}

// 照 A showEventDetail 的 `_glowWrap` helper。
function renderGlowWrap(
  button: JSX.Element,
  state: SignupButtonState,
  loading: boolean,
  extraClass = '',
): JSX.Element {
  const wrapClass = `signup-glow-wrap${extraClass ? ` ${extraClass}` : ''}`
    + `${loading ? ' loading' : ''}`;
  return (
    <div
      class={wrapClass}
      style={`--glow-c:${state.glow ?? 'var(--accent)'};--glow-c-light:${state.glowLight ?? 'var(--accent-hover)'}`}
    >
      <div class="signup-glow-border" />
      <div class="signup-glow-shadow" />
      <div class="signup-flipper">
        {button}
      </div>
      <div class="signup-loading-hint">
        <div class="mini-spinner" />
        <span class="mini-text">{state.hint || '資料更新中'}</span>
      </div>
    </div>
  );
}

export function EventDetailPrimaryButton(props: EventDetailPrimaryButtonProps): JSX.Element {
  const team = props.teamReservation;
  const personal = <PersonalSignupButton {...props} />;
  if (!team) return personal;
  return (
    <div class="event-signup-action-row">
      <div class="event-signup-personal-action">{personal}</div>
      <div class="event-signup-team-action">
        <TeamReservationButton team={team} pageBusy={props.busy} />
      </div>
    </div>
  );
}

function TeamReservationButton({ team, pageBusy }: {
  team: NonNullable<EventDetailPrimaryButtonProps['teamReservation']>;
  pageBusy: boolean;
}): JSX.Element {
  // 團隊名額本地檢查沒過時 busy 同一輪就收回：延一個 0ms 才開始環，避免閃一次展開回原狀（11-09 審查）。
  const started = useDeferredStart(team.busy);
  const ring = useActionRing(started, team.doneSerial ?? 0);
  const ringing = ring.phase !== 'idle' && !ring.reduced;
  // 等那一個 0ms 的期間不切靜態忙碌樣式（同一輪就結束時畫面完全不動）。
  const loading = started && !ringing;
  return (
    <div class={'signup-glow-wrap team-reservation-action' + (loading ? ' loading' : '')}
      style="--glow-c:#2563eb;--glow-c-light:#60a5fa">
      <div class="signup-glow-border" /><div class="signup-glow-shadow" />
      <div class="signup-flipper">
        <button type="button" class={'event-signup-team-button' + ringButtonClass(ring)}
          ref={ring.buttonRef}
          style={'background:#2563eb;color:#fff' + (ringing && ring.style ? `;${ring.style}` : '')}
          disabled={pageBusy || team.busy || team.disabled || ringing}
          aria-busy={team.busy || ringing || undefined}
          aria-label={ringing ? team.busyLabel : undefined}
          onClick={team.onClick}>{ringing ? renderRingContent(ring) : team.label}</button>
      </div>
      <div class="signup-loading-hint"><div class="mini-spinner" />
        <span class="mini-text">{team.busyLabel}</span></div>
    </div>
  );
}

function PersonalSignupButton({
  state: liveState,
  disabled,
  busy,
  running = false,
  settle,
  onClick,
}: EventDetailPrimaryButtonProps): JSX.Element {
  const settling = settle?.pending === true;
  const ring = useActionRing(running || settling, settle?.serial ?? 0, settling);
  const ringActive = ring.phase !== 'idle';
  // 進度環期間凍結按下時的狀態（底色、忙碌文字）：環背後的資料會先變（例如額滿投影），
  // 展開完成回到 idle 才換成新狀態，避免環上閃過中間狀態的底色或先露出舊文字。
  const frozen = useRef(liveState);
  if (!ringActive) frozen.current = liveState;
  const state = ringActive ? frozen.current : liveState;
  const ringing = ringActive && !ring.reduced;
  // 減少動態或其他動作造成的頁面忙碌：沿用原本的靜態忙碌文字＋光跡。
  const staticBusy = !ringing && (busy || ringActive);
  const isDisabled = disabled || busy || state.disabled || ringActive;
  const content = ringing ? renderRingContent(ring) : staticBusy ? getBusyLabel(state) : state.label;
  const handleClick = isDisabled ? undefined : onClick;
  const srOnly = staticBusy ? <span class="fcb-sr-only">處理中</span> : null;
  const ringClass = ringButtonClass(ring);
  const ringStyle = ringing && ring.style ? ring.style : undefined;

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

  const ariaBusy = staticBusy || ringing ? 'true' : undefined;
  const ariaDisabled = staticBusy || ringing ? 'true' : undefined;
  // 環期間文字被拿掉，改用 aria-label 告知「報名中／取消中」。
  const ariaLabel = ringing ? getBusyLabel(state) : undefined;

  // 照 A `_buildEventEarlyBirdSignupHtml`。
  if (state.variant === 'earlyBird') {
    const earlyBirdDisabledClass = (disabled || state.disabled)
      ? ' event-early-bird-btn-disabled'
      : '';
    const button = (
      <button
        type="button"
        class={`event-early-bird-btn${earlyBirdDisabledClass}${ringClass}`}
        ref={ring.buttonRef}
        style={ringStyle}
        disabled={isDisabled}
        onClick={handleClick}
        aria-busy={ariaBusy}
        aria-disabled={ariaDisabled}
        aria-label={ariaLabel}
      >
        {content}
        {srOnly}
      </button>
    );
    if (state.glowWrap) {
      return renderGlowWrap(button, state, staticBusy, 'event-early-bird-cta');
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
        class={`primary-btn${ringClass}`}
        ref={ring.buttonRef}
        style={ringStyle}
        disabled={isDisabled}
        onClick={handleClick}
        aria-busy={ariaBusy}
        aria-disabled={ariaDisabled}
        aria-label={ariaLabel}
      >
        {content}
        {srOnly}
      </button>
    );
    return state.glowWrap ? renderGlowWrap(button, state, staticBusy) : button;
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
  if (ringStyle) styleParts.push(ringStyle);
  const button = (
    <button
      type="button"
      class={ringClass ? ringClass.trim() : undefined}
      ref={ring.buttonRef}
      style={styleParts.join(';')}
      disabled={isDisabled}
      onClick={handleClick}
      aria-busy={ariaBusy}
      aria-disabled={ariaDisabled}
      aria-label={ariaLabel}
    >
      {content}
      {srOnly}
    </button>
  );
  return state.glowWrap ? renderGlowWrap(button, state, staticBusy) : button;
}
