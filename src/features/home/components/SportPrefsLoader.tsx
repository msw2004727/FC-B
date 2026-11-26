import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

type Gate = typeof import('@/features/sport-prefs/SportPrefsGate').SportPrefsGate;

/** 首頁九宮格：入口只放條件與延後下載；判斷、畫面都在延後程式塊。 */
export function SportPrefsLoader({ uid, due }: { uid: string | null; due?: boolean }): JSX.Element | null {
  const [Comp, setComp] = useState<Gate | null>(null);
  useEffect(() => {
    if (!uid || !due) return;
    let off = false;
    const id = setTimeout(() => {
      import('@/features/sport-prefs/SportPrefsGate').then((m) => { if (!off) setComp(() => m.SportPrefsGate); }, () => {});
    }, 1200);
    return () => { off = true; clearTimeout(id); };
  }, [uid, due]);
  return Comp && uid ? <Comp uid={uid} home /> : null;
}
