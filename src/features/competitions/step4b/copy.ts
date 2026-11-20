// 第 4 步預覽文案。畫面只從這裡拿字，避免各檔各寫一句。
// 沿用既有名單公開說明與監護人勾選的句子（competitions locales-lazy zh-TW）。

import type { AssignRole, AuditAction, AuditActorRole, PlayerPos, S4bMatchStatus, S4bTimeout, StaffRole, TemplateId, TieKey, TimeoutBasis } from '../testing/step4b-fixtures';

export const copy = {
  back: '返回',
  remove: '移除',
  save: '儲存',
  copyLink: '複製連結',
  revoke: '撤銷',
  copied: '已複製',
  shareLine: '分享到 LINE',
  print: '列印',
  copyText: '複製文字',
  accept: '接受',
  enterScore: '進入記分',
  join: '加入名單',
  approve: '核可',
  reject: '拒絕',
  rejectSubmit: '送出',
  addSubmit: '送出申請',
  nextDay: '隔日',
  me: '我自己',
  generateInvite: '產生邀請連結',
  assignScorer: '指派記分員',
  useTemplate: '用這個範本',
  advanced: '進階',
  addNote: '＋補充說明',
  noteLabel: '補充說明',
  notePrefix: '補充：',
  birthday: '生日',
  year: '年',
  month: '月',
  day: '日',
  birthdayKnown: '已有生日資料',
  birthdayPrivate1: '生日只用來確認年齡資格，',
  birthdayPrivate2: '不會公開',
  name: '姓名',
  realName: '真實姓名',
  number: '背號',
  position: '位置',
  privacy: '我了解名單會公開我的顯示名稱與背號',
  guardian: '我已取得監護人同意',
  selfConsent: '已取得本人同意',
  addAck: '已告知球員名單會公開顯示名稱與背號',
  rosterFullTitle: '名單已滿',
  rosterFull: '這隊名單已滿，不能再加入。',
  linkDeadTitle: '連結失效',
  linkDead: '這個連結已失效。',
  claimTitle: '認領登錄',
  claimYes: '這是我',
  claimAgeTitle: '年齡不符',
  claimAge: '年齡不符，不能認領。',
  waitHost: '等待主辦核可',
  reasonLabel: '拒絕原因',
  reasonRequired: '請填寫拒絕原因',
  role: '角色',
  person: '人員',
  term: '期限',
  uses: '使用次數',
  makeLink: '產生連結',
  activeLinks: '有效連結',
  roster: '名單',
  daysDefault: '名單鎖定或 14 天取早者',
  subMode: '方式',
  freeSub: '自由換人（換下可再上場）',
  limitedSub: '有限次數',
  subHint: '系統只提醒，不擋上場',
  subMax: '每隊每場最多（次）',
  pointsTitle: '勝和負積分',
  winLabel: '勝一場（分）',
  drawLabel: '和局（分）',
  lossLabel: '負一場（分）',
  pointsWarnWin: '勝分低於和分，請確認',
  pointsWarnLoss: '負分高於和分，請確認',
  fairTitle: '公平競賽（行為分）',
  fairHint: '吃牌越少分數越高',
  fairLater: '記牌功能上線後生效',
  fairNote: '少吃牌者排序較前',
  yellowLabel: '一張黃牌（分）',
  secondYellowLabel: '兩黃變紅（分）',
  directRedLabel: '直接紅牌（分）',
  yellowRedLabel: '先黃牌再直接紅牌（分）',
  mercyTitle: '單場球差上限（仁慈規則）',
  mercySwitch: '單場球差上限啟用',
  mercyCap: '單場球差最多計（球）',
  mercyMsg1: '積分榜的球差有上限，',
  mercyMsg2: '進球與失球仍是實際比分',
  h2hTitle: '直接對戰',
  algo1: '算法：先比這幾隊彼此的比賽；',
  algo2: '分出高下後，剩下的隊伍從頭再比',
  sysCalc: '系統會照這個算',
  hostDoes: '由主辦現場執行',
  tieTitle: '同分排序',
  walkTitle: '棄權',
  subTitle: '換人',
  timeoutTitle: '球隊暫停',
  timeoutEnabled: '開放',
  timeoutBasis: '次數怎麼算',
  timeoutPerTeam: '每隊次數',
  timeoutSeconds: '每次秒數',
  timeoutStopClock: '暫停時停錶',
  timeoutExtra: '延長賽每隊次數',
  timeoutHint: '系統只提醒，不擋',
  timeoutClosed: '不開放',
  lateTitle: '遲到',
  suspTitle: '紅黃牌累積停賽',
  kitTitle: '裝備',
  appealTitle: '申訴',
  inviteRevokedTitle: '已撤銷',
  inviteRevoked: '主辦已撤銷這個邀請。',
  inviteExpiredTitle: '已過期',
  inviteExpired: '這個邀請已過期。',
  compCancelledTitle: '賽事已取消',
  compCancelled: '賽事已取消，邀請跟著失效。',
  staffTitle: '指派與邀請',
  assignTitle: '指派',
  acceptTitle: '接受邀請',
  scorerTitle: '我的場次',
  linkRepTitle: '登錄連結',
  joinTitle: '加入名單',
  additionTitle: '增補申請',
  reviewTitle: '增補核可',
  templateTitle: '選擇規則範本',
  rulesEditTitle: '組別規則',
  rulesPublicTitle: '比賽規則',
  checkinTitle: '檢錄表',
  auditTitle: '稽核紀錄',
  scheduleTitle: '賽程',
  actor: '操作者',
  unset: '未設定',
  colNumber: '背號',
  colReal: '真名',
  colDisplay: '顯示名',
  colPos: '位置',
  colSign: '簽名',
  posNone: '無',
  posCustom: '自訂',
  posCustomLabel: '自訂位置',
  kv(label: string, value: string): string {
    return `${label}：${value}`;
  },
  vs(home: string, away: string): string {
    return `${home}對${away}`;
  },
  assigned(n: number): string {
    return `${n} 場`;
  },
  dayHeading(month: number, day: number, weekday: string): string {
    return `${month}/${day}（${weekday}）`;
  },
  days(n: number): string {
    return `${n} 天`;
  },
  usedOf(used: number, max: number): string {
    return `已用 ${used}／${max}`;
  },
  expireOn(md: string): string {
    return `到期 ${md}`;
  },
  remain(n: number): string {
    return `本隊還可增補 ${n} 人`;
  },
  claimLine(team: string, number: number): string {
    return `代表已幫你登錄：${team} ${number} 號`;
  },
  numberUsed(n: number): string {
    return `${n}（已用）`;
  },
  templateSummary(players: number, half: number, halftime: number): string {
    return `${players} 人・每半場 ${half} 分・中場 ${halftime} 分`;
  },
  ageFit(ok: boolean): string {
    return `年齡符合組別：${ok ? '是' : '否'}`;
  },
  rank(i: number, name: string): string {
    return `${i}. ${name}`;
  },
  winLine(n: number): string {
    return `勝一場：${n} 分`;
  },
  drawLine(n: number): string {
    return `和局：${n} 分`;
  },
  lossLine(n: number): string {
    return `負一場：${n} 分`;
  },
  woScore(against: number, scoreFor: number): string {
    return `比分：棄權方 ${against}，對手 ${scoreFor}`;
  },
  woPoints(award: number, penalty: number): string {
    return `積分：勝方 ${award} 分，棄權方 ${penalty} 分`;
  },
  woGoals: '得失球：計入',
  subLine: '方式：自由換人（換下可再上場）',
  lateLine: '寬限：由主辦登錄棄權，系統不計時',
  suspLine: '累積停賽：未啟用',
  shinLine: '護脛：未設定',
  colorLine: '同色球衣：未設定',
  numLine: '號碼：未設定',
  appealLine: '時限：未設定',
  mercyOff: '單場球差上限：不設',
  cardLine(label: string, value: string): string {
    return `${label}：${value}`;
  },
  scoreBefore(score: string): string {
    return `改前 ${score}`;
  },
  scoreAfter(score: string): string {
    return `改後 ${score}`;
  },
  yearOption(year: number): string {
    return `${year}年`;
  },
  monthOption(month: number): string {
    return `${month}月`;
  },
  dayOption(day: number): string {
    return `${day}日`;
  },
} as const;

export const weekdayName = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] as const;

export const timeoutBasisLabel: Record<TimeoutBasis, string> = {
  half: '每半場',
  match: '每場',
  period: '每節',
};

/** 範本第二行。開放例：球隊暫停：每隊每半場 1 次、60 秒。關閉：球隊暫停：不開放。 */
export function templateTimeoutLine(timeout: S4bTimeout): string {
  if (!timeout.enabled) return `${copy.timeoutTitle}：${copy.timeoutClosed}`;
  const basis = timeoutBasisLabel[timeout.basis];
  return `${copy.timeoutTitle}：每隊${basis} ${timeout.perTeam} 次、${timeout.seconds} 秒`;
}

/**
 * 公開頁一項一行。關閉回空陣列（整區不印）。
 * 延長賽次數為 0 不印。停錶關掉時不寫「暫停時停錶」。
 */
export function publicTimeoutLines(timeout: S4bTimeout): string[] {
  if (!timeout.enabled) return [];
  const basis = timeoutBasisLabel[timeout.basis];
  // 一項一行（F5 草案 §5）；區塊標題已是「球隊暫停」，各行不再重複標題（取代單行長句被縮字級，PM 收件 11-19）
  const lines = [`次數：每隊${basis} ${timeout.perTeam} 次`, `每次：${timeout.seconds} 秒`];
  if (timeout.stopClock) lines.push(`停錶：${copy.timeoutStopClock}`);
  if (timeout.extraPerTeam > 0) lines.push(`延長賽：每隊 ${timeout.extraPerTeam} 次`);
  return lines;
}

export const staffRoleLabel: Record<StaffRole, string> = {
  host: '主辦',
  coHost: '共同主辦',
  scorer: '記分員',
  referee: '裁判',
};

export const auditActorLabel: Record<AuditActorRole, string> = {
  host: '主辦',
  coHost: '共同主辦',
  scorer: '記分員',
  referee: '裁判',
  admin: '管理員',
};

export const assignRoleLabel: Record<AssignRole, string> = {
  scorer: '記分員',
  referee: '裁判',
};

export const matchStatusLabel: Record<S4bMatchStatus, string> = {
  scheduled: '未開賽',
  live: '進行中',
  done: '已結束',
};

export const posLabel: Record<PlayerPos, string> = {
  GK: '守門員',
  DF: '後衛',
  MF: '中場',
  FW: '前鋒',
};

export const templateTitle: Record<TemplateId, string> = {
  five: '五人制一般',
  seven: '七人制',
  eleven: '十一人制',
};

export const criterionLabel: Record<TieKey, string> = {
  points: '積分',
  headToHeadPoints: '直接對戰積分',
  headToHeadGoalDiff: '直接對戰得失球差',
  headToHeadGoalsFor: '直接對戰進球',
  goalDiff: '得失球差',
  goalsFor: '進球數',
  goalsAgainstAsc: '失球少者優先',
  fairPlay: '公平競賽（行為分）',
  manual: '主辦裁定',
};

export const auditActionLabel: Record<AuditAction, string> = {
  score: '改比分',
  reset: '重置場次',
  rules: '改規則',
};

export const cardWeightLabel = {
  yellow: '一張黃牌',
  secondYellow: '兩黃變紅',
  directRed: '直接紅牌',
  yellowThenRed: '先黃牌再直接紅牌',
} as const;
