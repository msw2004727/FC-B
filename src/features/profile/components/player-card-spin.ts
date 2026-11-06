/**
 * T-092 球員卡撥動翻面＋鎖頭（站長 11-05 預覽定案）。
 * 手感參數照預覽：拖曳 0.8°/px、最近 90ms 取樣算速度、超過 0.35°/ms 才慣性、每 ms 乘 0.9965 減速、
 * 低於 0.12°/ms 後以 420ms ease-out 對齊最近的 0°／180° 倍數。
 * 旋轉角度直接寫進 DOM（不走 state），避免每格重畫整張卡。
 * 加速（站長 11-06）：慣性中再撥，放手速度＝剩餘轉速（按住期間照摩擦衰減）＋本次撥速，同向越撥越快、反向減速，
 * 上限 MAX_DEG_PER_MS（720 RPM）；點一下＝煞車停最近一面。轉速以「{數字}/RPM」寫在卡片左上外側（同樣直寫 DOM、100ms 節流）。
 */
import { useEffect, useRef } from 'preact/hooks';

export const PLAYER_CARD_LOCK_STORAGE_KEY = 'toosterx:player-card-locked';
/** 最高轉速記錄（每台裝置記住，不進 Firestore）；只在轉動停下時寫一次。 */
export const PLAYER_CARD_BEST_RPM_STORAGE_KEY = 'toosterx:player-card-best-rpm';

const DEG_PER_PX = 0.8;
const SAMPLE_WINDOW_MS = 90;
const FLICK_MIN_DEG_PER_MS = 0.35;
const STOP_DEG_PER_MS = 0.12;
const FRICTION_PER_MS = 0.9965;
const MAX_FRAME_MS = 32;
const SETTLE_MS = 420;
/** 水平位移超過此值且大於垂直位移才接管；垂直先超過就交給頁面捲動。 */
const AXIS_LOCK_PX = 6;
/** 放手時總位移小於此值視為點一下，不翻。 */
const TAP_PX = 4;
/** 轉速上限 720 RPM（=4.32°/ms）：連撥加速到此為止，避免失控與低階機掉幀。 */
export const PLAYER_CARD_MAX_RPM = 720;
const MAX_DEG_PER_MS = (PLAYER_CARD_MAX_RPM * 360) / 60000;
/** RPM 文字最快每 100ms 更新一次；歸零立即寫。 */
const RPM_UPDATE_MS = 100;

/** 角速度（°/ms）換算 RPM。 */
export function degPerMsToRpm(vel: number): number {
  return Math.round((Math.abs(vel) * 60000) / 360);
}

/** 鎖頭狀態每台裝置記住；讀不到（隱私模式、被擋）一律視為解鎖。 */
export function readPlayerCardLocked(): boolean {
  try {
    return localStorage.getItem(PLAYER_CARD_LOCK_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writePlayerCardLocked(locked: boolean): void {
  try {
    localStorage.setItem(PLAYER_CARD_LOCK_STORAGE_KEY, locked ? '1' : '0');
  } catch {
    /* 存不了只影響下次開啟，不擋操作 */
  }
}

/** 讀不到或格式不對一律當 0。 */
export function readPlayerCardBestRpm(): number {
  try {
    const n = Number(localStorage.getItem(PLAYER_CARD_BEST_RPM_STORAGE_KEY));
    return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), PLAYER_CARD_MAX_RPM) : 0;
  } catch {
    return 0;
  }
}

function writePlayerCardBestRpm(rpm: number): void {
  try {
    localStorage.setItem(PLAYER_CARD_BEST_RPM_STORAGE_KEY, String(rpm));
  } catch {
    /* 存不了只是下次不記得，不擋轉動 */
  }
}

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function nearestFace(angle: number): number {
  return Math.round(angle / 180) * 180;
}

interface SpinState {
  angle: number;
  vel: number;
  raf: number;
  mode: 'idle' | 'pending' | 'drag';
  pointerId: number;
  startX: number;
  startY: number;
  startA: number;
  samples: Array<{ x: number; t: number }>;
  /** 正在跑的是慣性（可疊加）還是對齊動畫。 */
  anim: 'none' | 'coast' | 'settle';
  /** 按下時攔下的慣性轉速與時間，放手時衰減後疊加。 */
  carryVel: number;
  carryT: number;
  rpmText: string;
  rpmT: number;
  best: number;
  bestDirty: boolean;
}

export interface PlayerCardSpinHandlers {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerCancel: (e: PointerEvent) => void;
  onLostPointerCapture: (e: PointerEvent) => void;
}

export function usePlayerCardSpin(locked: boolean): {
  flipRef: { current: HTMLDivElement | null };
  rpmRef: { current: HTMLSpanElement | null };
  bestRef: { current: HTMLSpanElement | null };
  /** 首次畫面用的最高記錄（之後由 DOM 直寫更新）。 */
  initialBest: number;
  handlers: PlayerCardSpinHandlers;
} {
  const flipRef = useRef<HTMLDivElement | null>(null);
  const rpmRef = useRef<HTMLSpanElement | null>(null);
  const bestRef = useRef<HTMLSpanElement | null>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const st = useRef<SpinState>({
    angle: 0,
    vel: 0,
    raf: 0,
    mode: 'idle',
    pointerId: -1,
    startX: 0,
    startY: 0,
    startA: 0,
    samples: [],
    anim: 'none',
    carryVel: 0,
    carryT: 0,
    rpmText: '0',
    rpmT: -Infinity,
    best: 0,
    bestDirty: false,
  }).current;

  const api = useRef<{
    stop: () => void;
    settle: () => void;
    handlers: PlayerCardSpinHandlers;
  } | null>(null);

  if (!api.current) {
    const render = (): void => {
      const el = flipRef.current;
      if (el) el.style.transform = `rotateY(${st.angle}deg)`;
    };
    st.best = readPlayerCardBestRpm();
    /**
     * 轉速寫進 DOM：最快每 RPM_UPDATE_MS 一次；歸零立即寫，靜止時 is-spinning 拿掉（CSS 淡化）。
     * record=true（放手後的慣性）才刷新最高記錄，拖曳中的手指取樣雜訊不算；歸零時有新記錄才寫 localStorage 一次。
     */
    const showRpm = (vel: number, record = false): void => {
      const rpm = degPerMsToRpm(vel);
      if (record && rpm > st.best) {
        st.best = rpm;
        st.bestDirty = true;
      }
      if (rpm === 0 && st.bestDirty) {
        st.bestDirty = false;
        writePlayerCardBestRpm(st.best);
      }
      const el = rpmRef.current;
      const text = String(rpm);
      if (!el || text === st.rpmText) return;
      const now = performance.now();
      if (rpm !== 0 && now - st.rpmT < RPM_UPDATE_MS) return;
      st.rpmText = text;
      st.rpmT = now;
      el.textContent = text;
      el.closest('.player-card-rpm')?.classList.toggle('is-spinning', rpm !== 0);
      const bestEl = bestRef.current;
      if (bestEl && bestEl.textContent !== String(st.best)) bestEl.textContent = String(st.best);
    };
    const stop = (): void => {
      if (st.raf) {
        cancelAnimationFrame(st.raf);
        st.raf = 0;
      }
      st.anim = 'none';
    };
    const snap = (target: number): void => {
      st.angle = ((target % 360) + 360) % 360;
      st.vel = 0;
      render();
      showRpm(0);
    };
    /** dir≠0（慣性收尾）時取轉動方向上的下一個 180° 倍數，避免最後倒轉；dir=0 取最近一面。 */
    const settle = (dir = 0): void => {
      stop();
      const target = dir > 0
        ? Math.ceil(st.angle / 180) * 180
        : dir < 0
          ? Math.floor(st.angle / 180) * 180
          : nearestFace(st.angle);
      if (target === st.angle) {
        showRpm(0);
        return;
      }
      if (prefersReducedMotion()) {
        snap(target);
        return;
      }
      const from = st.angle;
      const t0 = performance.now();
      st.anim = 'settle';
      const step = (t: number): void => {
        const p = Math.min(1, (t - t0) / SETTLE_MS);
        const eased = 1 - Math.pow(1 - p, 3);
        st.angle = from + (target - from) * eased;
        render();
        if (p < 1) {
          // ease-out 的瞬時角速度＝(target-from)·3(1-p)²／SETTLE_MS
          showRpm(((target - from) * 3 * Math.pow(1 - p, 2)) / SETTLE_MS);
          st.raf = requestAnimationFrame(step);
        } else {
          st.raf = 0;
          st.anim = 'none';
          snap(target);
        }
      };
      st.raf = requestAnimationFrame(step);
    };
    const coast = (): void => {
      stop();
      st.anim = 'coast';
      const dir = Math.sign(st.vel);
      let last = performance.now();
      const step = (t: number): void => {
        const dt = Math.min(MAX_FRAME_MS, Math.max(0, t - last));
        last = t;
        st.angle += st.vel * dt;
        st.vel *= Math.pow(FRICTION_PER_MS, dt);
        render();
        showRpm(st.vel, true);
        if (Math.abs(st.vel) > STOP_DEG_PER_MS) st.raf = requestAnimationFrame(step);
        else {
          st.raf = 0;
          st.anim = 'none';
          settle(dir);
        }
      };
      st.raf = requestAnimationFrame(step);
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (lockedRef.current) return;
      // 已有一指在操作時，第二指不搶
      if (st.mode !== 'idle') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // 慣性中按下：先停住，把剩餘轉速記下，放手若是撥動就疊加回去（點一下則丟掉＝煞車）。
      // RPM 文字在按住期間不更新，避免連撥時數字在每次按下歸零閃爍。
      st.carryVel = st.anim === 'coast' ? st.vel : 0;
      st.carryT = performance.now();
      stop();
      st.mode = 'pending';
      st.pointerId = e.pointerId;
      st.startX = e.clientX;
      st.startY = e.clientY;
      st.startA = st.angle;
      st.samples = [{ x: e.clientX, t: performance.now() }];
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (st.mode === 'idle' || e.pointerId !== st.pointerId) return;
      // 滑鼠在卡外放開而沒收到 pointerup：移動時已無按鍵就視為放開
      if (e.pointerType === 'mouse' && e.buttons === 0) {
        release(e, true);
        return;
      }
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      if (st.mode === 'pending') {
        if (Math.abs(dx) >= AXIS_LOCK_PX && Math.abs(dx) > Math.abs(dy)) {
          st.mode = 'drag';
          try {
            (e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);
          } catch {
            /* 不支援 capture 時仍可跟手，只是手指滑出卡外會中斷 */
          }
        } else if (Math.abs(dy) >= AXIS_LOCK_PX) {
          // 垂直為主：交給頁面捲動（touch-action: pan-y），若剛好攔停了轉動就對齊
          st.mode = 'idle';
          settle();
          return;
        } else {
          return;
        }
      }
      const now = performance.now();
      st.angle = st.startA + dx * DEG_PER_PX;
      st.samples.push({ x: e.clientX, t: now });
      st.samples = st.samples.filter((s) => now - s.t < SAMPLE_WINDOW_MS);
      render();
    };
    const release = (e: PointerEvent, cancelled: boolean): void => {
      if (st.mode === 'idle' || e.pointerId !== st.pointerId) return;
      const mode = st.mode;
      st.mode = 'idle';
      st.pointerId = -1;
      if (mode !== 'drag' || cancelled) {
        settle();
        return;
      }
      const now = performance.now();
      const first = st.samples.find((s) => now - s.t < SAMPLE_WINDOW_MS);
      const flickVel = first && now - first.t > 0 ? ((e.clientX - first.x) / (now - first.t)) * DEG_PER_PX : 0;
      // 疊加：剩餘轉速按住期間照摩擦衰減，再加本次撥速；同向越撥越快、反向抵銷減速，夾在上限內
      const carry = st.carryVel * Math.pow(FRICTION_PER_MS, Math.max(0, now - st.carryT));
      st.carryVel = 0;
      st.vel = Math.max(-MAX_DEG_PER_MS, Math.min(MAX_DEG_PER_MS, carry + flickVel));
      if (Math.abs(e.clientX - st.startX) < TAP_PX) {
        st.angle = st.startA;
        render();
        settle();
        return;
      }
      if (prefersReducedMotion()) {
        // 減少動態：不做慣性多圈，直接翻到正／背面
        let target = nearestFace(st.angle);
        if (Math.abs(st.vel) > FLICK_MIN_DEG_PER_MS && target === nearestFace(st.startA)) {
          target += Math.sign(st.vel) * 180;
        }
        stop();
        snap(target);
        return;
      }
      if (Math.abs(st.vel) > FLICK_MIN_DEG_PER_MS) coast();
      else settle();
    };

    api.current = {
      stop,
      settle,
      handlers: {
        onPointerDown,
        onPointerMove,
        onPointerUp: (e) => release(e, false),
        onPointerCancel: (e) => release(e, true),
        // 只認舞台自己失去 capture：Safari 觸控的隱式 capture 在子元素上，舞台 setPointerCapture 時
        // 子元素的 lostpointercapture 會冒泡上來，不能當成取消（否則一開始拖就被對齊回去）
        onLostPointerCapture: (e) => {
          if (e.target === e.currentTarget) release(e, true);
        },
      },
    };
  }

  const { stop, settle, handlers } = api.current;

  useEffect(() => {
    if (!locked) return;
    // 鎖上：停止轉動、放掉拖曳，對齊最近一面
    st.mode = 'idle';
    st.pointerId = -1;
    st.vel = 0;
    st.carryVel = 0;
    settle();
  }, [locked]);

  useEffect(() => stop, []);

  return { flipRef, rpmRef, bestRef, initialBest: st.best, handlers };
}
