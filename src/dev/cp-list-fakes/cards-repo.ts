// 示範頁用的外部賽事讀寫（取代 features/tournaments/data/cards-repo）：不連 Firestore、不上傳。
import type { TournamentCard } from '@/features/tournaments/data/card-model';
import { cplState } from './state';

export interface UploadedImage { url: string; path: string }

export class TournamentCardError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function loadTournamentCards(): Promise<TournamentCard[]> {
  const state = cplState();
  if (state.ext === 'loading') return new Promise<TournamentCard[]>(() => undefined);
  if (state.ext === 'error') throw new Error('示範：讀取失敗');
  return state.cards;
}

export async function deleteTournamentCard(): Promise<void> {}
export async function uploadTournamentCardImage(): Promise<UploadedImage | null> {
  return null;
}
export async function saveTournamentCard(input: { existing: TournamentCard | null; id: string }): Promise<TournamentCard> {
  return input.existing ?? cplState().cards[0]!;
}
export function newTournamentCardId(): string {
  return 'tc_demo_new';
}
