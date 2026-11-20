// 賽事第 4 步預覽文案。先集中繁中字串，之後再轉 i18n。元件不要自己寫死句子。

export const LIVE_COPY = {
  periodH1: '上半場',
  periodHt: '中場休息',
  periodH2: '下半場',
  periodPk: 'PK',
  connected: '已連線',
  goal: '進球',
  yellow: '黃牌',
  red: '紅牌',
  unspecified: '不指定球員',
  goalNormal: '一般',
  goalPenalty: '點球',
  goalOwn: '烏龍',
  secondYellow: '第二張黃牌 → 紅牌',
  secondYellowMark: '第二張黃牌',
  tapToClose: '點一下關閉',
  undo: '復原',
  undone: '已復原',
  kickoff: '開賽',
  halftime: '半場',
  fulltime: '終場',
  resume: '下半場開始',
  correctClock: '修正時鐘',
  pauseClock: '停錶',
  resumeClock: '繼續計時',
  pauseReserved: '為保留記分額度，停錶已停用',
  matchMenu: '選單',
  amend: '改判',
  amendNote: '會先復原原紀錄，再記新的',
  amendHalf: '原紀錄已復原，新紀錄未送出',
  undoBoth: '會一併復原第二張黃牌',
  undoBothConfirm: '確定復原',
  amendConfirm: '確定改判',
  undoHalf: '第二張黃牌已復原，第一張黃牌仍在',
  undoSecondFailed: '第二張黃牌沒有復原',
  showCard: '看這張牌',
  nearCap: '本場紀錄接近上限',
  atCap: '紀錄已達上限，請由主辦在賽後登錄比分',
  fulltimeSent: '終場已送出',
  undoFulltime: '撤回終場',
  unappliedTitle: '未套用的動作',
  unappliedHint: '另一支裝置可能也在記這場',
  pending: '待送',
  rejected: '被拒',
  rejectedTakenOver: '被拒：已被接手',
  rejectedConflict: '被拒：比分版本衝突',
  rejectedLocked: '被拒：場次已鎖',
  reapply: '重新套用',
  discard: '捨棄',
  takeoverTitle: '這場目前由另一支裝置記分',
  takeoverAction: '接手記分',
  takeoverLater: '先不要',
  takeoverNote: '接手後，另一支裝置記的動作會送不出去',
  takeoverEntry: '其他裝置記分中',
  offlineUnstored: '離線紀錄無法保存，斷網時記的動作重整後會消失',
  wakeLock: '請關閉手機自動鎖定',
  liveBadge: '即時',
  correctedBadge: '比分已更正',
  matchLog: '比賽紀錄',
  scorersStalled: '射手榜已停止更新',
  scorersEmpty: '還沒有已確認的比賽紀錄',
  scorersCap: '只顯示前 50 名',
  scorers: '射手榜',
  cardsTab: '紅黃牌',
  colRank: '名次',
  colPlayer: '球員',
  colTeam: '隊',
  colGoals: '進球數',
  colYellow: '黃牌數',
  colRed: '紅牌數',
  tablistLabel: '射手榜與紅黃牌',
  teamTimeout: '球隊暫停',
  endTimeout: '結束暫停',
  collapseTimeout: '收合',
  expandTimeout: '展開',
  timeoutOver: '已超過規則次數（由主辦現場判斷）',
  timeoutRule: '每半場重新計算',
  pkStart: 'PK 大戰',
  pkIn: '進',
  pkMiss: '沒進',
  pkConfirmTitle: '開始 PK 大戰？',
  pkConfirmLine1: '開始後不能再記一般進球。',
  pkConfirmLine2: 'PK 開始後不能取消，要取消須由主辦重置整場。',
  pkConfirmGo: '開始 PK',
  pkConfirmCancel: '取消',
  kickoffConfirmTitle: '開始比賽？',
  kickoffConfirmLine: '時鐘會立刻開始計時',
  pkGoalLocked: 'PK 期間不能復原或改判一般進球',
  halftimeGoalUndoOnly: '中場休息只能復原，下半場再記',
  cardNoRoster: '這隊名單沒有球員，無法記牌',
  noScorePermission: '你沒有這場的記分權限',
  backToSchedule: '回賽程',
  /** 進場讀取失敗（網路類，會自動重試）。 */
  loadFailedAuto: '讀取失敗，連線恢復後會自動重試',
  /** 進場讀取失敗（其他錯誤，只能按重試）。 */
  loadFailed: '讀取失敗',
  retry: '重試',
  leaveScore: '離開記分',
  assignScorerHint: '請先在指派頁把自己指派為記分員',
} as const;

export function offlineChip(pending: number): string {
  return `離線・${pending} 筆待送`;
}

export function offlineSaved(pending: number): string {
  return `離線中，已存 ${pending} 筆，恢復網路會自動送出`;
}

/** 有被拒項目擋住送出時的常駐提示（第 4 步 A F5-3，顧問 11-20）。12px 一行，360 寬不斷行。 */
export function heldRejected(rejected: number): string {
  return `${rejected > 1 ? `有 ${rejected} 筆` : '前一筆'}沒送出，請點「未套用的動作」處理`;
}

export function heldQueued(queued: number): string {
  return `之後記的 ${queued} 筆先存在這支手機，處理後一起送出`;
}

const BLOCKED_STEP: Record<'kickoff' | 'halftime' | 'resume' | 'fulltime' | 'undoFinish' | 'pkStart', string> = {
  kickoff: '開賽',
  pkStart: '開始 PK',
  halftime: '進入半場',
  resume: '開始下半場',
  fulltime: '記終場',
  undoFinish: '撤回終場',
};

/** 階段動作被擋：說清楚要先做什麼、擋住的是哪一步。 */
export function blockedStep(kind: keyof typeof BLOCKED_STEP): string {
  return `先處理沒送出的紀錄，才能${BLOCKED_STEP[kind]}`;
}

export function undoWithin(clock: string): string {
  return `${clock} 內可撤回`;
}

export function teamAction(team: string, action: string): string {
  return `${team} ${action}`;
}

export function playerChoiceLabel(number: number, name: string): string {
  return `${number} ${name}`;
}

export function minuteMark(minute: number): string {
  return `${minute}'`;
}

export function addedClock(baseMin: number, addedMin: number): string {
  return `${baseMin}+${addedMin}'`;
}

export function pausedFor(clock: string): string {
  return `已停錶 ${clock}`;
}

/**
 * 底欄剩餘次數，例「停錶・剩18」。
 * 用「停錶」跟選單裡的「球隊暫停」分開。
 * 不寫「停錶 18」：那個寫法在計時旁邊會被讀成 18 秒。
 * 中間點把動作和「剩」分開；不寫「次」是為了 360 寬底欄不換行。
 */
export function pauseRemain(left: number): string {
  return `停錶・剩${left}`;
}

/** 球隊暫停倒數，例「雷霆隊暫停 0:47」。分不補零，跟比賽時鐘的 00:47 分開。 */
export function teamTimeoutText(team: string, clock: string): string {
  return `${team}暫停 ${clock}`;
}

export function timeoutClock(leftSec: number): string {
  const sec = Math.max(0, Math.floor(leftSec));
  const minute = Math.floor(sec / 60);
  const rest = sec % 60;
  return `${minute}:${String(rest).padStart(2, '0')}`;
}

/** 選隊鈕，例「雷霆隊 剩 1 次」。 */
export function timeoutTeamChoice(team: string, left: number): string {
  return `${team} 剩 ${left} 次`;
}

export function pkScoreLabel(home: number, away: number): string {
  return `PK ${home}:${away}`;
}

export function pkKickLine(round: number, team: string, who: string, scored: boolean): string {
  return `第${round}輪 ${team} ${who} ${scored ? LIVE_COPY.pkIn : LIVE_COPY.pkMiss}`;
}

export function restedFor(clock: string): string {
  return `已休息 ${clock}`;
}

/** 復原、重新套用、捨棄的無障礙名稱，帶上那一筆的內容。 */
export function withEvent(action: string, detail: string): string {
  return `${action} ${detail}`;
}
