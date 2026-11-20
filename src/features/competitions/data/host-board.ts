// 主辦頁矮板的數字格：從既有整句字串切出「小標｜數字｜尾巴」，不新增字串。
// 切法：用兩個不會出現在字典裡的記號代入參數，找到數字的位置再換回真的值；切不到就回 null，呼叫端整句當一格、不放大數字。

const N_MARK = '\u0001';
const M_MARK = '\u0002';

export interface CountCell {
  /** 數字前面的字（例「已核准」）。 */
  k: string;
  n: number;
  /** 數字後面的字（例「／8 隊」），可能是空字串。 */
  tail: string;
}

/**
 * render：用參數組出整句的函式（例 `(n, m) => ct('approvedTeams', { teams: n, max: m })`）。
 * 數字前面沒有字、或記號沒有出現，都算切不到。
 */
export function splitCount(
  render: (n: string, m: string) => string,
  n: number,
  m: number,
): CountCell | null {
  const text = render(N_MARK, M_MARK);
  const at = text.indexOf(N_MARK);
  if (at < 0 || text.indexOf(N_MARK, at + 1) >= 0) return null;
  const k = text.slice(0, at).trim();
  if (!k) return null;
  const tail = text.slice(at + 1).split(M_MARK).join(String(m)).trim();
  return { k, n, tail };
}
