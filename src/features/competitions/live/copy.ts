// 賽事第 4 步預覽文案。先集中繁中字串，之後再轉 i18n。元件不要自己寫死句子。

export const LIVE_COPY = {
  periodH1: '上半場',
  periodHt: '中場休息',
  periodH2: '下半場',
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
  pauseClock: '暫停計時',
  resumeClock: '繼續計時',
  pauseReserved: '為保留記分額度，暫停計時已停用',
  matchMenu: '選單',
  amend: '改判',
  amendNote: '會先復原原紀錄，再記新的',
  amendHalf: '原紀錄已復原，新紀錄未送出',
  undoBoth: '會一併復原第二張黃牌',
  undoBothConfirm: '確定復原',
  undoHalf: '第二張黃牌已復原，第一張黃牌仍在',
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
  scorers: '射手榜',
  cardsTab: '紅黃牌',
  colRank: '名次',
  colPlayer: '球員',
  colTeam: '隊',
  colGoals: '進球數',
  colYellow: '黃牌數',
  colRed: '紅牌數',
  tablistLabel: '射手榜與紅黃牌',
} as const;

export function offlineChip(pending: number): string {
  return `離線・${pending} 筆待送`;
}

export function offlineSaved(pending: number): string {
  return `離線中，已存 ${pending} 筆，恢復網路會自動送出`;
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
  return `已暫停 ${clock}`;
}

/** 暫停鈕上的剩餘次數，例「暫停 18」。 */
export function pauseRemain(left: number): string {
  return `暫停 ${left}`;
}

export function restedFor(clock: string): string {
  return `已休息 ${clock}`;
}

/** 復原、重新套用、捨棄的無障礙名稱，帶上那一筆的內容。 */
export function withEvent(action: string, detail: string): string {
  return `${action} ${detail}`;
}
