import { useRef } from 'preact/hooks';

/**
 * 個人頁 attendance summary 的「發出序號」保護：較晚發出的請求優先，
 * 慢的舊請求晚到時 `accept` 回 false，呼叫端丟棄結果，不得蓋掉已套用的較新值。
 * 報名紀錄卡（LegacyActivityRecordsCard）與個人頁（ProfilePage）共用同一套規則，
 * 各自對自己持有的 summary 狀態使用。
 */
export interface SummarySequencer {
  /** 發出請求（或收到一份較新的結果）前呼叫，取得序號。 */
  issue(): number;
  /** 要套用前呼叫：序號比已套用的新才回 true 並記下；否則回 false（丟棄）。 */
  accept(token: number): boolean;
}

export function createSummarySequencer(): SummarySequencer {
  let issued = 0;
  let applied = 0;
  return {
    issue: () => ++issued,
    accept: (token) => {
      if (token <= applied) return false;
      applied = token;
      return true;
    },
  };
}

/** 元件實例內穩定的序號器（同一實例每次 render 回傳同一個）。 */
export function useSummarySequencer(): SummarySequencer {
  const ref = useRef<SummarySequencer | null>(null);
  if (ref.current === null) ref.current = createSummarySequencer();
  return ref.current;
}
