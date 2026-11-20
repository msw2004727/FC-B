export type WaitView =
  | { kind: 'ready'; number: number; expiresAt: number }                 // ④前：先記住數字，按「前往 LINE 登入」才換頁
  | { kind: 'wait'; number: number; expiresAt: number; busy: boolean }   // ④ 等待，busy＝「我已完成」停用中
  | { kind: 'notYet'; number: number; expiresAt: number }                // ⑤ 還沒收到
  | { kind: 'timeout' };                                                 // ⑥ 逾時
export type RelayView =
  | { kind: 'pick'; options: number[]; busy: boolean; tryLater: boolean; picked?: number | null } // ① 選數字；tryLater＝顯示「稍後再試」與重試；picked＝已按下的數字
  | { kind: 'done' }                                                     // ② 已轉交
  | { kind: 'wrong' }                                                    // ③ 數字不符或已失效
  | { kind: 'sentOrExpired' };                                           // 已送出或已失效（不顯示失敗）
export interface WaitHandlers { onDone(): void; onRestart(): void; onRetry(): void; onClose(): void; onGo?(): void; }
export interface RelayHandlers { onPick(n: number): void; onRetry(): void; onClose(): void; }
