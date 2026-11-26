import { useEffect, useState } from 'preact/hooks';
import { SPORTS, type SportOption } from '@/features/events/data/sports';
import type { Firestore } from 'firebase/firestore';

export const SPORT_PREFS_MAX = 20;

export function favPool(): SportOption[] {
  return SPORTS.filter((s) => s.key !== 'other');
}

export function orderedSports(rank: readonly string[]): SportOption[] {
  const pool = favPool();
  const seen = new Set<string>();
  const inRank: SportOption[] = [];
  for (const k of rank) {
    if (seen.has(k)) continue;
    seen.add(k);
    const item = pool.find((s) => s.key === k);
    if (item) inRank.push(item);
  }
  return [...inRank, ...pool.filter((s) => !seen.has(s.key))];
}

export const RING_SLOTS = [4, 1, 2, 5, 8, 7, 6, 3, 0] as const;

export function batchCells(list: readonly SportOption[], batch: number): (SportOption | null)[] {
  const cells: (SportOption | null)[] = Array.from({ length: 9 }, () => null);
  const start = batch * 9;
  list.slice(start, start + 9).forEach((s, i) => {
    const slot = RING_SLOTS[i];
    if (slot !== undefined) cells[slot] = s;
  });
  return cells;
}

export function batchCount(n: number): number {
  return Math.max(1, Math.ceil(n / 9));
}

let rankPromise: Promise<string[]> | null = null;

export function loadSportRank(): Promise<string[]> {
  if (!rankPromise) {
    rankPromise = (async () => {
      try {
        const [{ getFirebase }, { doc, getDoc }] = await Promise.all([
          import('@/data/firebase'),
          import('firebase/firestore'),
        ]);
        const fb = await getFirebase();
        const snap = await getDoc(doc(fb.db as Firestore, 'siteConfig', 'sportRank'));
        if (!snap.exists()) return [];
        const data = snap.data() as { order?: unknown };
        const raw = data.order;
        if (!Array.isArray(raw)) return [];
        const seen = new Set<string>();
        const out: string[] = [];
        for (const v of raw) {
          if (typeof v !== 'string' || seen.has(v)) continue;
          seen.add(v);
          out.push(v);
        }
        return out;
      } catch {
        rankPromise = null;
        return [];
      }
    })();
  }
  return rankPromise;
}

let enabledPromise: Promise<boolean> | null = null;

export function isSportPrefsEnabled(): Promise<boolean> {
  if (!enabledPromise) {
    enabledPromise = (async () => {
      try {
        const res = await fetch('/runtime-config.json', { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) return false;
        const json = (await res.json()) as { sportPrefs?: unknown };
        return json?.sportPrefs === true;
      } catch {
        return false;
      }
    })();
  }
  return enabledPromise;
}

/** 測試與截圖台用：直接給排行與開關結果（不讀資料庫、不打 runtime-config）。 */
export function _setSportPrefsDataForTest(rank: string[], enabled: boolean): void {
  rankPromise = Promise.resolve(rank);
  enabledPromise = Promise.resolve(enabled);
}

export function _resetSportPrefsDataForTest(): void {
  rankPromise = null;
  enabledPromise = null;
}

const SEEN_KEY = 'fcb:sportPrefsSeen:v1';
const SEEN_MAX = 20;

export function uidTag(uid: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < uid.length; i += 1) {
    hash ^= uid.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function isSeenLocal(uid: string): boolean {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return false;
    const tag = uidTag(uid);
    return parsed.some((x) => x === tag);
  } catch {
    return false;
  }
}

export function markSeenLocal(uid: string): void {
  try {
    const tag = uidTag(uid);
    const raw = localStorage.getItem(SEEN_KEY);
    let arr: string[] = [];
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) arr = parsed.filter((x): x is string => typeof x === 'string');
    }
    const next = arr.filter((x) => x !== tag);
    next.push(tag);
    const trimmed = next.length > SEEN_MAX ? next.slice(next.length - SEEN_MAX) : next;
    localStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage 例外一律吞掉
  }
}

/** 與 web-push/store.ts 的 WEB_PUSH_STORE_KEY 相同（不靜態 import web-push/，守 static-entry 規則；data.test 鎖一致）。 */
export const WEB_PUSH_RECORD_KEY = 'fcb:webpush:v1';

export function devicePushOn(): boolean {
  try {
    if (!localStorage.getItem(WEB_PUSH_RECORD_KEY)) return false;
  } catch {
    return false;
  }
  if (typeof Notification === 'undefined') return false;
  return Notification.permission === 'granted';
}

export function useSportPrefsEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    isSportPrefsEnabled()
      .then((v) => {
        if (alive) setEnabled(v);
      })
      .catch(() => {
        if (alive) setEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}
