import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

type Gate = typeof import('@/features/sport-prefs/SportPrefsGate').SportPrefsGate;

/** 首頁九宮格：入口只放條件與延後下載；判斷、畫面都在延後程式塊。 */
export function SportPrefsLoader({ uid, due }: { uid: string | null; due?: boolean }): JSX.Element | null {
  const [Comp, setComp] = useState<Gate | null>(null);
  useEffect(() => {
    if (!uid || !due) return;
    // 開關關時 Gate 會記 'fcb:spOff'（同 sport-prefs/data.ts 的 SPORT_PREFS_OFF_KEY，測試鎖一致）：同分頁之後不再下載
    try { if (sessionStorage.getItem('fcb:spOff')) return; } catch { /* 照常 */ }
    let off = false;
    const id = setTimeout(() => {
      import('@/features/sport-prefs/SportPrefsGate').then((m) => { if (!off) setComp(() => m.SportPrefsGate); }, () => {});
    }, 1200);
    return () => { off = true; clearTimeout(id); };
  }, [uid, due]);
  return Comp && uid ? <Comp uid={uid} home /> : null;
}
