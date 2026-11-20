// 頁首賽事名小字的記憶（第 4 批 3.2）：報隊管理、排賽程讀到賽事文件時記下名稱，
// 人員、指派、建立邀請三頁進頁時讀出，不為了名稱多讀一次資料。
// 只放記憶體（不進網址、不寫 sessionStorage）；以 cid 當鍵，拿不到就不顯示。

const names = new Map<string, string>();

export function rememberCompName(cid: string, name: string | null | undefined): void {
  if (!cid) return;
  const text = (name ?? '').trim();
  if (text) names.set(cid, text);
  else names.delete(cid);
}

export function recallCompName(cid: string): string | undefined {
  return cid ? names.get(cid) : undefined;
}

/** 只給測試：清空記憶。 */
export function forgetCompNames(): void {
  names.clear();
}
