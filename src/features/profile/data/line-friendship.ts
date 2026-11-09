// O-1（11-09 顧問 §3.23 核可）：個人頁 LINE 推播卡查「有沒有加官方帳號好友」。
// 只用已初始化且已登入的 LIFF（getReadyLiff），不 init、不下載 SDK、不寫資料、不打伺服器。
// 查不到（未 init、未登入、呼叫失敗或逾時）一律回 null，由畫面維持一般提示列。

import { getReadyLiff } from '@/data/liff-init';

const FRIENDSHIP_TIMEOUT_MS = 5000;

export async function checkLineFriendship(
  timeoutMs: number = FRIENDSHIP_TIMEOUT_MS,
): Promise<boolean | null> {
  const liff = getReadyLiff();
  if (!liff) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!liff.isLoggedIn()) return null;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const result = await Promise.race([liff.getFriendship(), timeout]);
    if (!result) return null;
    return typeof result.friendFlag === 'boolean' ? result.friendFlag : null;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
