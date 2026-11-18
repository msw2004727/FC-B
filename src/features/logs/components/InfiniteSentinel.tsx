/**
 * 「無限」模式的捲動觸發點。
 * 規則（顧問 §3.196 硬條件 1、計畫書 3.2）：觸發點進入畫面時只呼叫 `onReach` 一次；
 * 之後必須先離開畫面（使用者再往下捲、清單變長把它推出去）才會再次觸發。
 * 清單太短、觸發點一直留在畫面內時不會連續自動抓（取代原型「enabled 重設就再觸發」的寫法）。
 * `enabled` 為 false（載入中、沒有更多、達上限、上一批全被隱藏）時不觸發；
 * 由 false 轉 true 時，只有「仍可觸發（尚未用掉）且正在畫面內」才補觸發一次。
 */
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export function InfiniteSentinel(props: { enabled: boolean; onReach: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(props.onReach);
  cb.current = props.onReach;
  const enabledRef = useRef(props.enabled);
  const armed = useRef(true);
  const visible = useRef(false);

  function tryFire(): void {
    if (enabledRef.current && armed.current && visible.current) {
      armed.current = false;
      cb.current();
    }
  }

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      const isIn = entries.some((e) => e.isIntersecting);
      visible.current = isIn;
      if (!isIn) armed.current = true;
      else tryFire();
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    enabledRef.current = props.enabled;
    tryFire();
  }, [props.enabled]);

  return <div ref={ref} class="lc-sentinel" aria-hidden="true" />;
}
