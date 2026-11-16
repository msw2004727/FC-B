/**
 * 「無限」模式的捲動觸發點：使用者捲到清單底部才呼叫 `onReach` 一次。
 * `enabled` 為 false（載入中、沒有更多、上一批全被隱藏）時不觸發，改由呼叫端顯示「載入更多」，
 * 避免畫面沒變長時連續自動抓下一頁（顧問 §3.195 硬條件 3）。
 */
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export function InfiniteSentinel(props: { enabled: boolean; onReach: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(props.onReach);
  cb.current = props.onReach;
  useEffect(() => {
    const el = ref.current;
    if (!props.enabled || !el || typeof IntersectionObserver === 'undefined') return undefined;
    let fired = false;
    const io = new IntersectionObserver((entries) => {
      if (!fired && entries.some((e) => e.isIntersecting)) {
        fired = true;
        cb.current();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [props.enabled]);
  return <div ref={ref} class="lc-sentinel" aria-hidden="true" />;
}
