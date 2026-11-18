import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { DIAG_HOST, readHostname } from './diag-host';

type DiagLoadsBadgeComponent = typeof import('./DiagLoadsBadge').DiagLoadsBadge;

interface LazyDiagLoadsBadgeProps {
  /** 不傳就看 location.hostname。只有測試會傳。 */
  hostname?: string;
}

/**
 * 內測站角標的延遲載入（2026-11-18 入口瘦身）：只有內測主機才下載角標程式，正式站不下載也不渲染。
 * 取代：App 靜態 import DiagLoadsBadge，正式站永遠回 null 卻佔首頁入口大小。
 * 本檔不得靜態 import DiagLoadsBadge。
 */
export function LazyDiagLoadsBadge({ hostname }: LazyDiagLoadsBadgeProps = {}): JSX.Element | null {
  const host = hostname ?? readHostname();
  const [Badge, setBadge] = useState<DiagLoadsBadgeComponent | null>(null);
  useEffect(() => {
    if (host !== DIAG_HOST) return undefined;
    let alive = true;
    void (async () => {
      try {
        const mod = await import('./DiagLoadsBadge');
        if (alive) setBadge(() => mod.DiagLoadsBadge);
      } catch {
        // 內測角標下載失敗就不顯示，不影響畫面。
      }
    })();
    return () => {
      alive = false;
    };
  }, [host]);
  return Badge ? <Badge hostname={host} /> : null;
}
