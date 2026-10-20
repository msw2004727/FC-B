import { useEffect, useState } from 'preact/hooks';
import { emit, on } from '@/core/events';
import { SPORTS, getSportKeySafe } from '@/features/events/data/sports';

export const ACTIVE_SPORT_STORAGE_KEY = 'sporthub_active_sport';

export interface PickerSportOption {
  readonly key: string;
  readonly label: string;
}

export const PICKER_SPORT_OPTIONS: readonly PickerSportOption[] = [
  { key: 'all', label: '全部運動' },
  ...SPORTS.map((s) => ({ key: s.key, label: s.label })),
];

/**
 * 將任意輸入正規化為合法運動鍵或 `'all'`。
 * 照 A `event-list-helpers.js#_normalizeActivityUrlSport`：空值或未知鍵退回 `'all'`。
 */
export function normalizeActiveSport(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'all') return 'all';
  return getSportKeySafe(raw) || 'all';
}

function readInitialSport(): string {
  // 1. 優先讀取網址上的 ?sport=（照 A `bindSportPicker`）
  if (typeof window !== 'undefined' && window.location) {
    try {
      const urlSport = new URLSearchParams(window.location.search || '').get('sport');
      if (urlSport) {
        if (urlSport === 'all') return 'all';
        const safe = getSportKeySafe(urlSport);
        if (safe) return safe;
      }
    } catch {
      /* ignore */
    }
  }
  // 2. 從 localStorage 還原上次選擇（預設 all）
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(ACTIVE_SPORT_STORAGE_KEY);
      if (saved !== null) {
        return normalizeActiveSport(saved);
      }
    }
  } catch {
    /* ignore */
  }
  return 'all';
}

let currentSport: string = readInitialSport();
const sportListeners = new Set<(sport: string) => void>();

function notifyListeners(sport: string): void {
  const snapshot = Array.from(sportListeners);
  for (const fn of snapshot) {
    try {
      fn(sport);
    } catch (err) {
      console.error('[sport-filter] listener error', err);
    }
  }
}

/** 取得目前全站選中的運動項目（`'all'` 或合法 sportKey）。 */
export function getActiveSport(): string {
  return currentSport;
}

/** 取得運動項目對應顯示名稱（含 `'all'` → `'全部運動'`）。 */
export function getPickerSportLabel(sportKey: unknown): string {
  const norm = normalizeActiveSport(sportKey);
  if (norm === 'all') return '全部運動';
  return SPORTS.find((s) => s.key === norm)?.label ?? '全部運動';
}

export interface SetActiveSportOptions {
  /** 是否持久化到 localStorage（預設 true）。 */
  persist?: boolean;
  /** 是否發送通知（預設 true）。 */
  silent?: boolean;
}

/**
 * 設定全站目前運動篩選，寫入 `localStorage['sporthub_active_sport']` 並廣播通知。
 * 照 A `theme.js#setActiveSport`：若傳入非 `'all'` 且非合法運動鍵，退回 `'football'`（或由呼叫端正規化）。
 */
export function setActiveSport(sportKey: string, options: SetActiveSportOptions = {}): string {
  const raw = String(sportKey ?? '').trim();
  const safeKey = raw === 'all' || !raw ? 'all' : (getSportKeySafe(raw) || 'football');
  const changed = currentSport !== safeKey;
  currentSport = safeKey;

  if (options.persist !== false) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(ACTIVE_SPORT_STORAGE_KEY, safeKey);
      }
    } catch {
      /* ignore */
    }
  }

  if (options.silent !== true) {
    notifyListeners(safeKey);
    // 借用既有型別安全事件匯流排通知（不改 src/core/events.ts 介面）
    if (changed) {
      emit('sport:picker-open', {});
    }
  }
  return safeKey;
}

/** 訂閱全站運動篩選變更；回傳取消訂閱函式。 */
export function subscribeActiveSport(listener: (sport: string) => void): () => void {
  sportListeners.add(listener);
  return () => {
    sportListeners.delete(listener);
  };
}

/**
 * 共用 Hook：訂閱全站運動篩選（遵循 L-04 與 L-17：effect 訂閱後立即補讀目前值）。
 */
export function useActiveSport(): [string, (next: string) => string] {
  const [sport, setSportState] = useState<string>(() => getActiveSport());

  useEffect(() => {
    // L-04：訂閱前先同步補讀一次目前值，避免 render 到 effect 之間漏接
    setSportState(getActiveSport());
    const unsubLocal = subscribeActiveSport((next) => {
      setSportState(next);
    });
    const unsubBus = on('sport:picker-open', () => {
      setSportState(getActiveSport());
    });
    return () => {
      unsubLocal();
      unsubBus();
    };
  }, []);

  return [sport, setActiveSport];
}

/**
 * 照 A `team-list.js#_resolveTeamSportFilterSync`：
 * 計算俱樂部頁運動下拉與全站運動篩選的同步結果。
 */
export function resolveTeamSportFilterSync(
  currentValue: string,
  syncedGlobalSport: string | undefined,
  globalSport: string,
  force = false,
): {
  value: string;
  syncedGlobalSport: string;
  effectiveSport: string;
} {
  const normalizedGlobal = globalSport && globalSport !== 'all' ? globalSport : '';
  if (force || syncedGlobalSport === undefined || currentValue === syncedGlobalSport) {
    return {
      value: normalizedGlobal,
      syncedGlobalSport: normalizedGlobal,
      effectiveSport: normalizedGlobal,
    };
  }
  return {
    value: currentValue,
    syncedGlobalSport: normalizedGlobal,
    effectiveSport: currentValue || normalizedGlobal,
  };
}

/** 測試用：重設狀態並由目前環境（URL／localStorage）重新初始化。 */
export function _resetSportFilterForTest(): void {
  sportListeners.clear();
  currentSport = readInitialSport();
}
