import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

type Fab = typeof import('./PwaInstallFab').PwaInstallFab;

/** 首頁「加到主畫面」浮球：主程式只排程下載，判斷與畫面都在延後 chunk。不顯示就什麼都不畫；下載失敗靜默略過。 */
export function PwaInstallFabLoader(): JSX.Element | null {
  const [Comp, setComp] = useState<Fab | null>(null);
  useEffect(() => {
    let off = false;
    let stop: (() => void) | undefined;
    const id = setTimeout(async () => {
      try {
        const m = await import('./PwaInstallFab');
        if (!off) stop = m.whenPwaFabShouldShow(() => setComp(() => m.PwaInstallFab));
      } catch {
        /* 靜默 */
      }
    }, 1500);
    return () => {
      off = true;
      clearTimeout(id);
      stop?.();
    };
  }, []);
  return Comp ? <Comp /> : null;
}
