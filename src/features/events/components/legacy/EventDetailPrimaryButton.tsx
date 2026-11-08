import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
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

// 站長 11-08 核可「A＋B 變形加進度環」（FC docs/previews/signup-speed-feel-2026-11-08.html 的 k=6）。
// expand＝成功打勾後展開；revert＝失敗或結果未知，不打勾直接展開回原狀態。
type RingPhase = 'idle' | 'progress' | 'fill' | 'check' | 'expand' | 'revert';
const RING_LENGTH = 94.25; // 2π × r15
const RING_FILL_MS = 180; // 環 .15s 補滿，多留一點給轉場收尾（同設計稿）
const RING_CHECK_MS = 220;
const RING_EXPAND_MS = 260;

/** 前 0.6 秒線性衝到 60%，之後 60+30×(1−e^(−(s−0.6)/1.5)) 慢慢爬，永遠到不了 100%。 */
export function ringPercent(elapsedMs: number): number {
  const s = Math.max(0, elapsedMs) / 1000;
  return s < 0.6 ? (s / 0.6) * 60 : 60 + 30 * (1 - Math.exp(-(s - 0.6) / 1.5));
}

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

interface SignupRing {
  phase: RingPhase;
  /** 減少動態：不變形、不畫環，只用靜態忙碌文字，結果出來直接切換。 */
  reduced: boolean;
  arcRef: { current: SVGCircleElement | null };
}

/**
 * running 期間顯示進度環；running 結束時 successKey 與開始時不同＝成功 → 補滿＋✓＋展開，
 * 否則（失敗、結果未知、使用者取消確認）不打勾直接展開回原狀態。
 * 階段推進只用 setTimeout（不靠 transitionend），減少動態把轉場壓成 0.01ms 也不會卡住。
 */
function useSignupRing(running: boolean, successKey: number): SignupRing {
  const [phase, setPhase] = useState<RingPhase>('idle');
  const [reduced, setReduced] = useState(false);
  const phaseRef = useRef<RingPhase>('idle');
  const reducedRef = useRef(false);
  const started = useRef({ key: successKey, at: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const arcRef = useRef<SVGCircleElement | null>(null);

  function go(next: RingPhase): void {
    phaseRef.current = next;
    setPhase(next);
  }
  function clearTimer(): void {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  function after(ms: number, next: () => void): void {
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      next();
    }, ms);
  }
  function stopFrame(): void {
    if (frame.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frame.current);
    }
    frame.current = null;
  }

  useLayoutEffect(() => {
    if (running) {
      if (phaseRef.current === 'progress') return;
      clearTimer();
      started.current = { key: successKey, at: now() };
      reducedRef.current = prefersReducedMotion();
      setReduced(reducedRef.current);
      go('progress');
      return;
    }
    if (phaseRef.current !== 'progress') return;
    stopFrame();
    if (reducedRef.current) {
      go('idle');
      return;
    }
    if (successKey === started.current.key) {
      go('revert');
      after(RING_EXPAND_MS, () => go('idle'));
      return;
    }
    go('fill');
    after(RING_FILL_MS, () => {
      go('check');
      after(RING_CHECK_MS, () => {
        go('expand');
        after(RING_EXPAND_MS, () => go('idle'));
      });
    });
  }, [running, successKey]);

  // 進度環逐幀直接改 DOM（不觸發重繪）；離開 progress 或卸載時取消。
  useEffect(() => {
    if (phase !== 'progress' || reduced || typeof requestAnimationFrame !== 'function') return;
    const tick = (): void => {
      const arc = arcRef.current;
      if (arc) {
        const percent = ringPercent(now() - started.current.at);
        arc.style.strokeDashoffset = String(RING_LENGTH * (1 - percent / 100));
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return stopFrame;
  }, [phase, reduced]);

  useEffect(() => () => {
    clearTimer();
    stopFrame();
  }, []);

  // running 剛變 true、layout effect 尚未推進的那一次 render 就先當成 progress，避免閃一次靜態忙碌樣式。
  if (running && phase === 'idle') {
    return { phase: 'progress', reduced: prefersReducedMotion(), arcRef };
  }
  return { phase, reduced, arcRef };
}

/** 圓圈內容：progress／fill 畫環，check／expand 顯示 ✓，revert 留白直到展開完成。 */
function renderRingContent(ring: SignupRing): JSX.Element | null {
  if (ring.phase === 'revert') return null;
  if (ring.phase === 'check' || ring.phase === 'expand') {
    return <span class="signup-ring-check" aria-hidden="true">✓</span>;
  }
  const filled = ring.phase === 'fill';
  return (
    <svg class="signup-ring-svg" width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <circle class="signup-ring-track" cx="17" cy="17" r="15" />
      <circle
        ref={ring.arcRef}
        class={`signup-ring-arc${filled ? ' is-fill' : ''}`}
        cx="17"
        cy="17"
        r="15"
        transform="rotate(-90 17 17)"
        stroke-dasharray={String(RING_LENGTH)}
        style={{ strokeDashoffset: filled ? '0' : String(RING_LENGTH) }}
      />
    </svg>
  );
}

/** 進度環期間（非減少動態）套到按鈕上的 class；expand／revert 拿掉 is-collapsed、保留轉場，寬度與圓角回到原樣。 */
function ringButtonClass(ring: SignupRing): string {
  if (ring.phase === 'idle' || ring.reduced) return '';
  return ring.phase === 'expand' || ring.phase === 'revert'
    ? ' signup-ring-btn'
    : ' signup-ring-btn is-collapsed';
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
  const ring = useSignupRing(team.busy, team.doneSerial ?? 0);
  const ringing = ring.phase !== 'idle' && !ring.reduced;
  const loading = team.busy && !ringing;
  return (
    <div class={'signup-glow-wrap team-reservation-action' + (loading ? ' loading' : '')}
      style="--glow-c:#2563eb;--glow-c-light:#60a5fa">
      <div class="signup-glow-border" /><div class="signup-glow-shadow" />
      <div class="signup-flipper">
        <button type="button" class={'event-signup-team-button' + ringButtonClass(ring)}
          style="background:#2563eb;color:#fff"
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
  const ring = useSignupRing(running || settle?.pending === true, settle?.serial ?? 0);
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
  const busyLabel = getBusyLabel(state);
  const content = ringing ? renderRingContent(ring) : staticBusy ? busyLabel : state.label;
  const handleClick = isDisabled ? undefined : onClick;
  const srOnly = staticBusy ? <span class="fcb-sr-only">處理中</span> : null;
  const ringClass = ringButtonClass(ring);

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
  const ariaLabel = ringing ? busyLabel : undefined;

  // 照 A `_buildEventEarlyBirdSignupHtml`。
  if (state.variant === 'earlyBird') {
    const earlyBirdDisabledClass = (disabled || state.disabled)
      ? ' event-early-bird-btn-disabled'
      : '';
    const button = (
      <button
        type="button"
        class={`event-early-bird-btn${earlyBirdDisabledClass}${ringClass}`}
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
  const button = (
    <button
      type="button"
      class={ringClass ? ringClass.trim() : undefined}
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
