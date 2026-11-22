// 賽事封面圖（計畫書「賽事封面圖」做法甲，第一階段）：讀取端的解析與「畫不畫」的判斷。
// 上傳、裁切、壓縮在 cover-upload.ts（只在建賽表單與報隊管理選圖時才動態載入）。

import type { CompetitionCover, CompetitionDoc } from './types';

const STORAGE_HOST = 'firebasestorage.googleapis.com';

/** 只收本專案用的 Firebase Storage 下載網址（https、固定主機、/v0/b/ 開頭）；真正的白名單在後端 cpHost。 */
function storageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1200) return null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== STORAGE_HOST || u.port || u.username || u.password) return null;
  return u.pathname.startsWith('/v0/b/') ? value : null;
}

/**
 * 根文件的 cover 欄：url、thumb 兩個網址都合格才收，其餘（缺欄、null、外站網址、型別不對）一律當沒有封面。
 * card（800×300，選填）同一套檢查；不合格只當沒有 card，不影響 url、thumb。
 */
export function coverOf(raw: unknown): CompetitionCover | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const url = storageUrl(o.url);
  const thumb = storageUrl(o.thumb);
  const card = storageUrl(o.card);
  if (!url || !thumb) return null;
  return card ? { url, thumb, card } : { url, thumb };
}

/**
 * 清單用圖（每張記分板卡同一張）：有 800×300 card 用 card，舊賽事沒有 card 退回原圖 url（cpHost 自 cphost-00004-fol 起收 card）。
 * 沒封面是空字串。
 */
export function listImage(cover: CompetitionCover | null | undefined): string {
  return cover ? cover.card ?? cover.url : '';
}

/** 送給 cpHost 的 cover 欄：url、thumb，有 card 才帶 card（不送 null，舊資料形狀不變）。 */
export function coverInput(cover: CompetitionCover): CompetitionCover {
  return cover.card ? { url: cover.url, thumb: cover.thumb, card: cover.card } : { url: cover.url, thumb: cover.thumb };
}

/**
 * 畫面上要不要畫封面：下架（hidden）時主辦、共同主辦、俱樂部代表仍讀得到根文件，但一律不畫；
 * 管理員照畫（判斷要不要移除）。清單一律傳 isAdmin=false（下架的賽事清單上不出縮圖）。
 */
export function shownCover(doc: Pick<CompetitionDoc, 'hidden' | 'cover'>, isAdmin: boolean): CompetitionCover | null {
  if (doc.hidden && !isAdmin) return null;
  return doc.cover ?? null;
}
