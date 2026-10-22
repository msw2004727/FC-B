/**
 * 照 A `js/config.js` 的 `ACHIEVEMENT_CONDITIONS` 逐字移植為 TS 常數。
 * 欄位、順序、字串全部照 A，不得增刪改字。
 */
export interface AchievementConditionTimeRange {
  key: string;
  label: string;
}

export interface AchievementConditionAction {
  key: string;
  label: string;
  unit: string;
  needsFilter: boolean;
}

export interface AchievementConditionFilter {
  key: string;
  label: string;
}

export interface AchievementConditions {
  timeRanges: readonly AchievementConditionTimeRange[];
  actions: readonly AchievementConditionAction[];
  filters: readonly AchievementConditionFilter[];
}

export const ACHIEVEMENT_CONDITIONS: AchievementConditions = {
  timeRanges: [
    { key: 'none',   label: '累計' },
  ],
  actions: [
    { key: 'register_event',  label: '報名活動',             unit: '場', needsFilter: true },
    { key: 'complete_event',  label: '完成活動（簽到+簽退）', unit: '場', needsFilter: true },
    { key: 'attend_play',     label: '出席 PLAY 活動',       unit: '場', needsFilter: false },
    { key: 'attend_friendly', label: '出席友誼活動',         unit: '場', needsFilter: false },
    { key: 'attend_camp',     label: '出席教學活動',         unit: '場', needsFilter: false },
    { key: 'attend_watch',    label: '出席觀賽',             unit: '場', needsFilter: false },
    { key: 'attendance_rate', label: '達到出席率',           unit: '%', needsFilter: false },
    { key: 'reach_level',     label: '達到等級',             unit: '級',  needsFilter: false },
    { key: 'reach_exp',       label: '累計 EXP',             unit: '點',  needsFilter: false },
    { key: 'join_team',       label: '加入俱樂部',             unit: '',  needsFilter: false },
    { key: 'complete_profile',label: '完成個人檔案',         unit: '',  needsFilter: false },
    { key: 'bind_line_notify',label: '綁定 LINE 推播',       unit: '',  needsFilter: false },
    { key: 'days_registered', label: '註冊天數',             unit: '天', needsFilter: false },
    { key: 'organize_event', label: '主辦活動',             unit: '場', needsFilter: true },
    { key: 'diverse_sports', label: '參與不同運動類型',     unit: '種', needsFilter: false },
    { key: 'no_show_free',   label: '連續無放鴿子',         unit: '場', needsFilter: false },
    { key: 'create_team',    label: '建立俱樂部',             unit: '隊', needsFilter: false },
    { key: 'bring_companion',label: '帶同行者報名',         unit: '人次', needsFilter: false },
    { key: 'team_member_count', label: '俱樂部成員數',        unit: '人', needsFilter: false },
    { key: 'early_event',    label: '參加早場活動',         unit: '場', needsFilter: false },
    { key: 'night_event',    label: '參加夜場活動',         unit: '場', needsFilter: false },
    { key: 'shop_trade',     label: '完成商城兌換',         unit: '次', needsFilter: false },
    { key: 'game_play',      label: '完成小遊戲',           unit: '場', needsFilter: false },
    { key: 'game_high_score',label: '小遊戲最高分',         unit: '分', needsFilter: false },
    { key: 'role_coach',     label: '教練身份',             unit: '',  needsFilter: false },
    { key: 'role_captain',   label: '領隊/經理身份',        unit: '',  needsFilter: false },
    { key: 'role_venue_owner',label: '場主身份',            unit: '',  needsFilter: false },
    { key: 'role_admin',     label: '管理員身份',           unit: '',  needsFilter: false },
    { key: 'role_super_admin',label: '總管身份',            unit: '',  needsFilter: false },
    { key: 'manual_award',   label: '手動授予',             unit: '',  needsFilter: false },
  ],
  filters: [
    { key: 'all',      label: '所有類型' },
    { key: 'play',     label: 'PLAY' },
    { key: 'friendly', label: '友誼' },
    { key: 'camp',     label: '教學' },
    { key: 'watch',    label: '觀賽' },
  ],
};
