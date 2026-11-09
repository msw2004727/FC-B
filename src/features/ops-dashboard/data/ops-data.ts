/**
 * 營運儀表板進頁讀取（C1）。只讀、不寫、不開監聽。
 *
 * 指標字典 `ops-dashboard-c0-metrics-2026-11-09.md` §5（每次進頁讀取 ≤ 60）：
 * - `getDoc(opsSummary/latest)`：1 次（頁首更新時間；C3 起關鍵數字、趨勢、排行也讀這份）
 * - `getCountFromServer(events where status in ['open','full','upcoming'])`：1 次／每 1,000 筆（K3s 報名中場數）
 * C1 合計 2 次；`opsSummary/noshow` 與 A1 候選重讀屬 C3。
 *
 * 錯誤分流：文件不存在（C2 尚未部署）＝`absent`，相關區塊不顯示；
 * 權限錯誤或其他讀取錯誤＝`error`，畫面顯示讀取失敗，**不可當成沒有資料**。
 */
import { collection, doc, getCountFromServer, getDoc, query, where } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';

/** K3s 報名中：含即將開放（字典 §2.1 K3s，與自動結束掃描同一組狀態）。 */
export const OPEN_EVENT_STATUSES = ['open', 'full', 'upcoming'] as const;

export type ReadResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'absent' }
  | { kind: 'error'; code: string };

export interface SummaryHeader {
  /** `opsSummary/latest.generatedAt`（毫秒）；欄位缺漏或格式不對為 null。 */
  generatedAtMs: number | null;
  /** 資料截止日 `YYYY-MM-DD`（台北）；缺漏為 ''。 */
  asOf: string;
}

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code ? code : 'unknown';
}

function toMillis(value: unknown): number | null {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export async function fetchSummaryHeader(): Promise<ReadResult<SummaryHeader>> {
  try {
    const { db } = await getFirebase();
    const snap = await getDoc(doc(db, 'opsSummary', 'latest'));
    if (!snap.exists()) return { kind: 'absent' };
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    return {
      kind: 'ok',
      value: {
        generatedAtMs: toMillis(data['generatedAt']),
        asOf: typeof data['asOf'] === 'string' ? data['asOf'] : '',
      },
    };
  } catch (err: unknown) {
    return { kind: 'error', code: errorCode(err) };
  }
}

export async function fetchOpenEventCount(): Promise<ReadResult<number>> {
  try {
    const { db } = await getFirebase();
    const q = query(collection(db, 'events'), where('status', 'in', [...OPEN_EVENT_STATUSES]));
    const count = (await getCountFromServer(q)).data().count;
    return { kind: 'ok', value: Number.isFinite(count) ? count : 0 };
  } catch (err: unknown) {
    return { kind: 'error', code: errorCode(err) };
  }
}

export interface DashboardLoad {
  summary: ReadResult<SummaryHeader>;
  openEvents: ReadResult<number>;
}

/** 進頁一次讀完（兩個查詢平行；任一失敗不影響另一個區塊）。 */
export async function loadDashboard(): Promise<DashboardLoad> {
  const [summary, openEvents] = await Promise.all([fetchSummaryHeader(), fetchOpenEventCount()]);
  return { summary, openEvents };
}
