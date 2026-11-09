import { useEffect, useRef, useState } from 'preact/hooks';

/** 每台裝置只提示一次的記錄鍵（B 新增，A 沒有）。 */
export const CONTACT_FAB_HINT_KEY = 'fcb:contact-fab-hinted';

/** 讀到已提示過、或 localStorage 不可用／丟錯，一律視為已提示過（回傳 false）。 */
function claimHint(): boolean {
  try {
    if (localStorage.getItem(CONTACT_FAB_HINT_KEY)) return false;
    localStorage.setItem(CONTACT_FAB_HINT_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * 聯繫站長浮球首次提示：首頁掛載約 1 秒後浮球抖 2 下（0.6 秒）並顯示泡泡約 4 秒；
 * reduced motion 只顯示泡泡。泡泡顯示期間點泡泡以外任何地方就關閉（不攔截該次點擊）。
 * 回傳 [泡泡顯示中, 抖動中, 關閉]。
 */
export function useContactFabHint(): [boolean, boolean, () => void] {
  // 0 無；1 只有泡泡；2 泡泡＋抖動
  const [stage, setStage] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number): void => {
      timers.push(setTimeout(fn, ms));
    };
    later(() => {
      if (done.current || location.pathname !== '/' || !claimHint()) return;
      const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      setStage(calm ? 1 : 2);
      if (!calm) later(() => setStage((s) => (s ? 1 : 0)), 600);
      later(() => setStage(0), 4000);
    }, 1000);
    return () => timers.forEach(clearTimeout);
  }, []);

  const showing = stage > 0;
  useEffect(() => {
    if (!showing) return undefined;
    const close = (e: Event): void => {
      if (!(e.target as Element).closest?.('.contact-owner-fab-hint')) setStage(0);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [showing]);

  const dismiss = (): void => {
    done.current = true;
    setStage(0);
  };
  return [showing, stage === 2, dismiss];
}
