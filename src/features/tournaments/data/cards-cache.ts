import type { TournamentCard } from './card-model';

/**
 * 賽事卡片的記憶體快取（顧問 §3.233 ①）：回訪先顯示上次讀到的清單，背景照常重讀一次。
 * 只放記憶體、不寫 localStorage／IndexedDB；以帳號區隔，帳號不同就不用（卡片本身是公開資料）。
 * 整頁重載即清空。
 */
let cached: { uid: string | null; cards: TournamentCard[] } | null = null;

export function readCardsCache(uid: string | null): TournamentCard[] | null {
  return cached && cached.uid === uid ? cached.cards.slice() : null;
}

export function writeCardsCache(uid: string | null, cards: TournamentCard[]): void {
  cached = { uid, cards };
}

export function resetCardsCacheForTest(): void {
  cached = null;
}
