export type WaitView =
  | { kind: 'wait'; number: number; expiresAt: number; busy: boolean }   // ④ 等待，busy＝「我已完成」停用中
  | { kind: 'notYet'; number: number; expiresAt: number }                // ⑤ 還沒收到
  | { kind: 'timeout' };                                                 // ⑥ 逾時
export type RelayView =
  | { kind: 'pick'; options: number[]; busy: boolean; tryLater: boolean } // ① 選數字；tryLater＝顯示「稍後再試」與重試
  | { kind: 'done' }                                                     // ② 已轉交
  | { kind: 'wrong' }                                                    // ③ 數字不符或已失效
  | { kind: 'sentOrExpired' };                                           // 已送出或已失效（不顯示失敗）
export interface WaitHandlers { onDone(): void; onRestart(): void; onRetry(): void; onClose(): void; }
export interface RelayHandlers { onPick(n: number): void; onRetry(): void; onClose(): void; }
/** view＝null 時卸載。可重複呼叫更新狀態。 */
export function renderWait(view: WaitView | null, handlers: WaitHandlers): void {
  /* 畫面由另一張卡施工 */
}
export function renderRelay(view: RelayView | null, handlers: RelayHandlers): void {
  /* 畫面由另一張卡施工 */
}
