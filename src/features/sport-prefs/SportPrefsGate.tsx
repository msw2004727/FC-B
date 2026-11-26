import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { isSeenLocal, isSportPrefsEnabled, markSeenLocal, SPORT_PREFS_OFF_KEY } from './data';
import { saveSportPrefs } from './callables';

type Modal = typeof import('./SportPrefsModal').SportPrefsModal;

function rememberOff(off: boolean): void {
  try {
    if (off) sessionStorage.setItem(SPORT_PREFS_OFF_KEY, '1');
    else sessionStorage.removeItem(SPORT_PREFS_OFF_KEY);
  } catch {
    /* 私密模式等：每次重查，不影響功能 */
  }
}

/**
 * 九宮格自動跳出的閘門（延後程式塊）。條件全部通過才下載彈窗本體（顧問 §3.809：開關關時不白下載）；
 * 開關關時在 sessionStorage 記一筆，首頁的 SportPrefsLoader 同分頁之後就不再下載本程式塊、也不再讀 runtime-config。
 */
export function SportPrefsGate({ uid, home, owned, onSaved }: { uid: string; home?: boolean; owned?: readonly string[]; onSaved?: (r: { favSports: string[]; newEventNotify: boolean }) => void }): JSX.Element | null {
  const [Comp, setComp] = useState<Modal | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (isSeenLocal(uid)) return;
      const enabled = await isSportPrefsEnabled();
      rememberOff(!enabled);
      if (!alive || !enabled) return;
      if (home) {
        if (location.pathname !== '/') return;
        if (document.querySelector('.modal.open, .app-confirm-overlay, #first-login-modal, #sw-reload-deferred-prompt')) return;
      }
      const mod = await import('./SportPrefsModal');
      if (!alive) return;
      markSeenLocal(uid);
      void saveSportPrefs({ promptSeen: true }).catch(() => {});
      setComp(() => mod.SportPrefsModal);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [uid, home]);
  return Comp ? <Comp uid={uid} owned={owned ?? []} onClose={() => setComp(null)} onSaved={(r) => onSaved?.(r)} /> : null;
}
