import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { isSeenLocal, isSportPrefsEnabled, markSeenLocal } from './data';
import { saveSportPrefs } from './callables';
import SportPrefsModal from './SportPrefsModal';

export function SportPrefsGate({ uid, home, owned, onSaved }: { uid: string; home?: boolean; owned?: readonly string[]; onSaved?: (r: { favSports: string[]; newEventNotify: boolean }) => void }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (isSeenLocal(uid)) return;
      const enabled = await isSportPrefsEnabled();
      if (!alive || !enabled) return;
      if (home) {
        if (location.pathname !== '/') return;
        if (document.querySelector('.modal.open, .app-confirm-overlay, #first-login-modal, #sw-reload-deferred-prompt')) return;
      }
      markSeenLocal(uid);
      void saveSportPrefs({ promptSeen: true }).catch(() => {});
      if (!alive) return;
      setOpen(true);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [uid, home]);
  return open ? <SportPrefsModal uid={uid} owned={owned ?? []} onClose={() => setOpen(false)} onSaved={(r) => onSaved?.(r)} /> : null;
}
