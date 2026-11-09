import './action-ring.css';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

// 站長 11-08 核可「變形加進度環」（FC docs/previews/signup-speed-feel-2026-11-08.html 的 k=6），
// 11-09 由報名主按鈕抽成共用：按下縮成圓、環先快後慢爬；成功補滿＋✓＋展開，失敗不打勾直接展開。
// expand＝成功打勾後展開；revert＝失敗或結果未知，不打勾直接展開回原狀態。
export type RingPhase = 'idle' | 'progress' | 'fill' | 'check' | 'expand' | 'revert';
export const RING_LENGTH = 94.25; // 2π × r15
const RING_FILL_MS = 180; // 環 .15s 補滿，多留一點給轉場收尾（同設計稿）
const RING_CHECK_MS = 220;
const RING_EXPAND_MS = 260;
/** 一般按鈕的 ✓ 停留：補滿 180＋停留 300＝伺服器回來到關窗多 0.48 秒。 */
const ACTION_CHECK_MS = 300;
/** 一般按鈕縮成的圓直徑上限（同主按鈕 46px）；按鈕較矮時取按鈕高度，不撐高版面。 */
const ACTION_RING_MAX = 46;

/** 前 0.6 秒線性衝到 60%，之後 60+30×(1−e^(−(s−0.6)/1.5)) 慢慢爬，永遠到不了 100%。 */
export function ringPercent(elapsedMs: number): number {
  const s = Math.max(0, elapsedMs) / 1000;
  return s < 0.6 ? (s / 0.6) * 60 : 60 + 30 * (1 - Math.exp(-(s - 0.6) / 1.5));
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export interface ActionRing {
  phase: RingPhase;
  /** 減少動態：不變形、不畫環，只用靜態忙碌文字，結果出來直接切換。 */
  reduced: boolean;
  arcRef: { current: SVGCircleElement | null };
  buttonRef: { current: HTMLButtonElement | null };
  /** 環期間掛在按鈕上的 inline 變數：按下前的原高度，CSS 用它補邊界，縮成 46px 圓時下方版面不跳動。 */
  style: string;
}

export interface ActionRingOptions {
  /** ✓ 停留時間；預設同主按鈕 220ms。 */
  checkMs?: number;
  /** 這一輪結束（✓ 停留完、失敗、減少動態或根本沒轉成環）時呼叫。 */
  onSettled?: () => void;
}

/**
 * running 期間顯示進度環；running 結束時若期間看過 settling（成功後等重讀），或 successKey 與開始時不同，
 * 就算成功 → 補滿＋✓＋展開；否則（失敗、結果未知、使用者取消確認）不打勾直接展開回原狀態。
 * settling 另外判斷，是因為多次狀態更新被合併成一次 render 時，環可能在 serial 已加一後才開始。
 * 階段推進只用 setTimeout（不靠 transitionend），減少動態把轉場壓成 0.01ms 也不會卡住。
 */
export function useActionRing(
  running: boolean,
  successKey: number,
  settling = false,
  options: ActionRingOptions = {},
): ActionRing {
  const [phase, setPhase] = useState<RingPhase>('idle');
  const [reduced, setReduced] = useState(false);
  const phaseRef = useRef<RingPhase>('idle');
  const reducedRef = useRef(false);
  const started = useRef({ key: successKey, at: 0 });
  const succeeded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const arcRef = useRef<SVGCircleElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const idleHeight = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const checkMs = options.checkMs ?? RING_CHECK_MS;

  function go(next: RingPhase): void {
    phaseRef.current = next;
    setPhase(next);
  }
  function settled(): void {
    optionsRef.current.onSettled?.();
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
      if (phaseRef.current === 'progress') {
        if (settling) succeeded.current = true;
        return;
      }
      clearTimer();
      succeeded.current = settling;
      started.current = { key: successKey, at: now() };
      reducedRef.current = prefersReducedMotion();
      setReduced(reducedRef.current);
      go('progress');
      return;
    }
    if (phaseRef.current !== 'progress') {
      settled();
      return;
    }
    stopFrame();
    if (reducedRef.current) {
      go('idle');
      settled();
      return;
    }
    if (!succeeded.current && successKey === started.current.key) {
      go('revert');
      settled();
      after(RING_EXPAND_MS, () => go('idle'));
      return;
    }
    go('fill');
    after(RING_FILL_MS, () => {
      go('check');
      after(checkMs, () => {
        go('expand');
        settled();
        after(RING_EXPAND_MS, () => go('idle'));
      });
    });
  }, [running, successKey, settling]);

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

  // 閒置時記下按鈕原高度（各狀態、各平台字型不同：全寬按鈕約 36～40px，並排與早鳥是 46px）。
  useLayoutEffect(() => {
    if (phaseRef.current === 'idle' && !running && buttonRef.current) {
      idleHeight.current = buttonRef.current.offsetHeight;
    }
  });

  const style = idleHeight.current > 0 ? `--signup-ring-h:${idleHeight.current}px` : '';
  // running 剛變 true、layout effect 尚未推進的那一次 render 就先當成 progress，避免閃一次靜態忙碌樣式。
  if (running && phase === 'idle') {
    return { phase: 'progress', reduced: prefersReducedMotion(), arcRef, buttonRef, style };
  }
  return { phase, reduced, arcRef, buttonRef, style };
}

/** 圓圈內容：progress／fill 畫環，check／expand 顯示 ✓，revert 留白直到展開完成。 */
export function renderRingContent(ring: ActionRing): JSX.Element | null {
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

/** 進度環期間（非減少動態）套到報名主按鈕上的 class；expand／revert 拿掉 is-collapsed、保留轉場，寬度與圓角回到原樣。 */
export function ringButtonClass(ring: ActionRing): string {
  if (ring.phase === 'idle' || ring.reduced) return '';
  return ring.phase === 'expand' || ring.phase === 'revert'
    ? ' signup-ring-btn'
    : ' signup-ring-btn is-collapsed';
}

/**
 * 宣告式用：value 變 true 後等一個 0ms 計時器才回 true，變 false 立即回 false。
 * 本地驗證失敗時忙碌旗標同一輪就收回，進度環不會開始（也就不會閃一次展開回原狀）。
 */
export function useDeferredStart(value: boolean): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!value) {
      setArmed(false);
      return;
    }
    const timer = setTimeout(() => setArmed(true), 0);
    return () => clearTimeout(timer);
  }, [value]);
  return value && armed;
}

export interface ActionRingControl {
  ring: ActionRing;
  /** 真正送出時才呼叫（本地驗證通過後）；同一輪內就失敗或成功（同步驗證丟錯）不會縮成圓。 */
  start(): void;
  /**
   * 伺服器確認成功：補滿＋✓。回傳的 Promise 在 ✓ 停留結束時完成（減少動態、未成環時立即完成），
   * 值＝元件是否仍掛載：等 ✓ 期間卸載會立即以 false 完成，呼叫端看到 false 就不再跑關窗、回填、提示。
   * （11-09 審查：取代原本卸載時以 void 放行、讓後續流程跑在已卸載元件上的做法；
   *   不選「卸載時永不完成」，是因為呼叫端的 finally 要照常解開送出鎖。）
   */
  succeed(): Promise<boolean>;
  /** 失敗或結果未知：不打勾直接展開；沒有進行中的環時不做事，可放在 finally。 */
  fail(): void;
}

/**
 * 一般按鈕用的命令式控制：呼叫端照原流程判斷成敗，只在對應位置呼叫 start／succeed／fail。
 * start 先排一個 0ms 計時器才真正縮成圓：本地驗證失敗（同一輪微任務內就結束）時完全不變形。
 */
export function useActionRingControl(): ActionRingControl {
  const [running, setRunning] = useState(false);
  const [key, setKey] = useState(0);
  const waiters = useRef<Array<(mounted: boolean) => void>>([]);
  const state = useRef({
    active: false,
    visible: false,
    mounted: true,
    arm: null as ReturnType<typeof setTimeout> | null,
  });
  const flush = (mounted: boolean): void => {
    const list = waiters.current;
    waiters.current = [];
    for (const resolve of list) resolve(mounted);
  };
  const ring = useActionRing(running, key, false, {
    checkMs: ACTION_CHECK_MS,
    onSettled: () => flush(state.current.mounted),
  });

  const methods = useRef<Omit<ActionRingControl, 'ring'> | null>(null);
  if (!methods.current) {
    const s = state.current;
    const disarm = (): boolean => {
      if (s.arm === null) return false;
      clearTimeout(s.arm);
      s.arm = null;
      return true;
    };
    methods.current = {
      start(): void {
        if (s.active || !s.mounted) return;
        s.active = true;
        if (prefersReducedMotion()) return;
        s.arm = setTimeout(() => {
          s.arm = null;
          if (!s.mounted || !s.active) return;
          s.visible = true;
          setRunning(true);
        }, 0);
      },
      succeed(): Promise<boolean> {
        if (!s.active) return Promise.resolve(s.mounted);
        s.active = false;
        if (disarm() || !s.visible || !s.mounted) return Promise.resolve(s.mounted);
        s.visible = false;
        return new Promise<boolean>((resolve) => {
          waiters.current.push(resolve);
          setKey(value => value + 1);
          setRunning(false);
        });
      },
      fail(): void {
        if (!s.active) return;
        s.active = false;
        if (disarm() || !s.visible) return;
        s.visible = false;
        setRunning(false);
      },
    };
  }

  useEffect(() => {
    const s = state.current;
    s.mounted = true;
    return () => {
      s.mounted = false;
      if (s.arm !== null) clearTimeout(s.arm);
      s.arm = null;
      flush(false);
    };
  }, []);

  return { ring, ...methods.current };
}

export interface ActionRingButtonProps
  extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'ref' | 'style' | 'class' | 'className' | 'children'> {
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  control: ActionRingControl;
  /** 環期間的 aria-label（原本的忙碌文字，例如「儲存中...」）。 */
  busyLabel: string;
  class?: string;
  style?: string;
  /** 照原本的內容（含原本的忙碌文字）；環期間包一層透明 span 保留寬度，版面不跳動。 */
  children: ComponentChildren;
}

/**
 * 一般按鈕的環：按鈕外框大小不變，用 clip-path 把畫面裁成置中的圓（直徑＝min(46px, 按鈕高度)），
 * 全寬、半寬與小按鈕都在原位置正中縮放；減少動態時完全照原樣顯示。
 */
export function ActionRingButton({
  control,
  busyLabel,
  class: className,
  style,
  disabled,
  children,
  ...rest
}: ActionRingButtonProps): JSX.Element {
  const ring = control.ring;
  const ringing = ring.phase !== 'idle' && !ring.reduced;
  const collapsed = ring.phase === 'progress' || ring.phase === 'fill' || ring.phase === 'check';
  // 按鈕自己量閒置高度（控制器可能放在父層，父層不一定在按鈕出現時重繪）。
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const measured = useRef(0);
  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (ring.phase === 'idle' && button && button.offsetHeight > 0) measured.current = button.offsetHeight;
  });
  const size = measured.current > 0 ? Math.min(ACTION_RING_MAX, measured.current) : ACTION_RING_MAX;
  const ringClass = ringing ? (collapsed ? ' action-ring-btn is-collapsed' : ' action-ring-btn is-expanding') : '';
  const ringStyle = ringing ? `--action-ring-d:${size}px` : '';
  const mergedStyle = [style, ringStyle].filter(Boolean).join(';') || undefined;
  const mergedClass = `${className ?? ''}${ringClass}`.trim() || undefined;
  return (
    <button
      {...rest}
      ref={buttonRef}
      class={mergedClass}
      style={mergedStyle}
      disabled={Boolean(disabled) || ring.phase !== 'idle'}
      aria-busy={ringing ? 'true' : rest['aria-busy']}
      aria-label={ringing ? busyLabel : rest['aria-label']}
    >
      {/* 閒置時原樣輸出內容（DOM 與原本相同）；環期間才包透明 span 撐住原寬度，讀屏器改讀 aria-label。 */}
      {ringing ? <span class="action-ring-label" aria-hidden="true">{children}</span> : children}
      {ringing ? <span class="action-ring-mark" aria-hidden="true">{renderRingContent(ring)}</span> : null}
    </button>
  );
}
