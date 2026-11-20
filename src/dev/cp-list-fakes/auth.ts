// 示範頁用的「上次登入帳號」（取代 data/auth 的 getLastKnownAuthUid）。
import { cplState } from './state';

export function getLastKnownAuthUid(): string | null {
  return cplState().viewer.uid ?? null;
}
