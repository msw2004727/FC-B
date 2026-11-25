import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LATE_CANCEL_HOURS,
  LATE_CANCEL_HOURS,
  LATE_CANCEL_SINCE,
  buildCompanionLateCancelNote,
  buildLateCancelConfirm,
  isLateCancelEnabled,
  isLateCancelRegistration,
  isWithinLateCancelWindow,
  lateCancelHint,
  lateCancelOptionLabel,
  lateCancelTagState,
  lateCancelWaitlistLine,
  lateCancelWouldTurnRed,
  needsLateCancelAttendance,
  normalizeLateCancelHours,
  withLateCancelMarked,
  type LateCancelUserInfo,
} from './late-cancel';
import { normalizeReleaseHours } from './team-reservation-release';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 2026/12/01 20:00 台北＝起算點之後。
const START = Date.parse('2026-12-01T20:00:00+08:00');
const DATE = '2026/12/01 20:00~22:00';

function info(partial: Partial<LateCancelUserInfo> = {}): LateCancelUserInfo {
  return { level: null, untilMs: null, releaseAt: 0, recentMs: [], total: 0, ...partial };
}

describe('normalizeLateCancelHours（契約 §1，與 Functions 同一組案例）', () => {
  it.each([
    ['沒有鍵', {}, 2],
    ['有鍵值 undefined', { lateCancelHours: undefined }, 2],
    ['0（不設定）', { lateCancelHours: 0 }, 0],
    ['允許值 2', { lateCancelHours: 2 }, 2],
    ['允許值 48', { lateCancelHours: 48 }, 48],
    ['null', { lateCancelHours: null }, 0],
    ['字串', { lateCancelHours: '2' }, 0],
    ['不在清單的數字', { lateCancelHours: 5 }, 0],
    ['負數', { lateCancelHours: -2 }, 0],
    ['NaN', { lateCancelHours: Number.NaN }, 0],
  ])('%s → %s', (_label, event, expected) => {
    expect(normalizeLateCancelHours(event)).toBe(expected);
  });

  it('事件本身缺省（null／undefined）視同缺值 → 2', () => {
    expect(normalizeLateCancelHours(null)).toBe(2);
    expect(normalizeLateCancelHours(undefined)).toBe(2);
  });

  it('常數：允許值與預設', () => {
    expect([...LATE_CANCEL_HOURS]).toEqual([0, 2, 3, 6, 12, 24, 48]);
    expect(DEFAULT_LATE_CANCEL_HOURS).toBe(2);
    expect(LATE_CANCEL_SINCE).toBe(Date.parse('2026-11-25T00:00:00+08:00'));
  });

  it('對照：缺值時團隊預留 normalizeReleaseHours 回 0、本函式回 2；壞值兩邊都 0', () => {
    expect(normalizeReleaseHours(undefined)).toBe(0);
    expect(normalizeLateCancelHours({})).toBe(2);
    expect(normalizeReleaseHours(null)).toBe(0);
    expect(normalizeLateCancelHours({ lateCancelHours: null })).toBe(0);
  });
});

describe('活動層條件與小字（契約 §3）', () => {
  it('> 0、非課程連結、未取消才啟用', () => {
    expect(isLateCancelEnabled({})).toBe(true);
    expect(isLateCancelEnabled({ lateCancelHours: 0 })).toBe(false);
    expect(isLateCancelEnabled({ courseLinkId: 'c1' })).toBe(false);
    expect(isLateCancelEnabled({ courseLinkId: '' })).toBe(true);
    expect(isLateCancelEnabled({ courseLinkId: '   ' })).toBe(true);
    expect(isLateCancelEnabled({ courseLinkId: ' c1 ' })).toBe(false);
    expect(isLateCancelEnabled({ status: 'cancelled' })).toBe(false);
    expect(isLateCancelEnabled({ status: 'ended' })).toBe(true);
  });

  it('小字：未開始才顯示，文案照甲', () => {
    expect(lateCancelHint({ date: DATE }, START - DAY)).toBe('開始前 2 小時內取消算臨時取消');
    expect(lateCancelHint({ date: DATE, lateCancelHours: 48 }, START - DAY)).toBe('開始前 48 小時內取消算臨時取消');
    expect(lateCancelHint({ date: DATE }, START)).toBeNull();
    expect(lateCancelHint({ date: DATE, lateCancelHours: 0 }, START - DAY)).toBeNull();
    expect(lateCancelHint({ date: DATE, courseLinkId: 'c1' }, START - DAY)).toBeNull();
    expect(lateCancelHint({ date: DATE, status: 'cancelled' }, START - DAY)).toBeNull();
    // 起算點前的活動小字照常顯示（§2）。
    expect(lateCancelHint({ date: '2026/11/26 20:00~22:00' }, Date.parse('2026-11-25T00:00:00+08:00')))
      .toBe('開始前 2 小時內取消算臨時取消');
  });

  it('下拉選項文字', () => {
    expect(lateCancelOptionLabel(0)).toBe('不設定');
    expect(lateCancelOptionLabel(6)).toBe('開始前 6 小時內取消算臨時取消');
  });

  it('時限內：0 < 開始 − 現在 ≤ 時限，且開始時間 ≥ 起算點', () => {
    expect(isWithinLateCancelWindow({ date: DATE }, START - 2 * HOUR)).toBe(true);
    expect(isWithinLateCancelWindow({ date: DATE }, START - 2 * HOUR - 1)).toBe(false);
    expect(isWithinLateCancelWindow({ date: DATE }, START)).toBe(false);
    expect(isWithinLateCancelWindow({ date: DATE, lateCancelHours: 24 }, START - 20 * HOUR)).toBe(true);
    const before = '2026/11/24 20:00~22:00';
    expect(isWithinLateCancelWindow({ date: before }, Date.parse('2026-11-24T19:00:00+08:00'))).toBe(false);
  });
});

describe('報名層條件（契約 §4 第 1、4、5 條）', () => {
  const event = { date: DATE };
  it('正取才算；候補、課程連結不算', () => {
    expect(isLateCancelRegistration({ status: 'confirmed' }, event)).toBe(true);
    expect(isLateCancelRegistration({ status: 'waitlisted' }, event)).toBe(false);
    expect(isLateCancelRegistration({ status: 'confirmed', courseLinkId: 'c1' } as never, event)).toBe(false);
    // 照後端 isCourseLinkedRegistrationData：來源、狀態、coursePriority、courseStudentId（去空白）。
    for (const extra of [
      { source: 'eduCourseLesson' }, { courseLinkSource: ' eduCourseLesson ' }, { courseLinkState: 'created_by_course' },
      { courseLinkState: 'priority_overlay' }, { coursePriority: true }, { courseStudentId: 's1' },
    ]) {
      expect(isLateCancelRegistration({ status: 'confirmed', ...extra } as never, event)).toBe(false);
    }
    expect(isLateCancelRegistration({ status: 'confirmed', courseLinkId: '  ' } as never, event)).toBe(true);
  });
  it('時限內才遞補上來不算；時限前遞補照算', () => {
    expect(isLateCancelRegistration({ status: 'confirmed', promotedAt: START - HOUR }, event)).toBe(false);
    expect(isLateCancelRegistration({ status: 'confirmed', promotedAt: { toMillis: () => START - 2 * HOUR } }, event)).toBe(false);
    expect(isLateCancelRegistration({ status: 'confirmed', promotedAt: { seconds: (START - 3 * HOUR) / 1000 } }, event)).toBe(true);
  });
});

describe('標籤狀態（契約 §8）', () => {
  const now = START;
  it('紅 → 紅；黑且未過期且出席數 < 解除場數 → 黑；其他不畫', () => {
    expect(lateCancelTagState(info({ level: 'red' }), null, now)).toBe('red');
    const black = info({ level: 'black', untilMs: now + DAY, releaseAt: 3 });
    expect(needsLateCancelAttendance(black, now)).toBe(true);
    expect(lateCancelTagState(black, 2, now)).toBe('black');
    expect(lateCancelTagState(black, 3, now)).toBeNull();
    expect(lateCancelTagState(black, null, now)).toBeNull();
    const expired = info({ level: 'black', untilMs: now - 1, releaseAt: 3 });
    expect(needsLateCancelAttendance(expired, now)).toBe(false);
    expect(lateCancelTagState(expired, 0, now)).toBeNull();
    expect(lateCancelTagState(info(), 0, now)).toBeNull();
    expect(lateCancelTagState(null, 0, now)).toBeNull();
  });

  it('90 天內第 3 次會變紅；超過 90 天的紀錄不算', () => {
    expect(lateCancelWouldTurnRed(info({ recentMs: [now - DAY, now - 2 * DAY] }), now)).toBe(true);
    expect(lateCancelWouldTurnRed(info({ recentMs: [now - DAY, now - 91 * DAY] }), now)).toBe(false);
    expect(lateCancelWouldTurnRed(info({ level: 'red', recentMs: [1, 2, 3] }), now)).toBe(false);
  });
});

describe('取消彈窗內容（預覽 ②③④⑤-3）', () => {
  const base = { event: { date: DATE }, eligibleCount: 1, confirmedCount: 1, waitlistCount: 0, user: info() };
  it('候補資訊', () => {
    expect(lateCancelWaitlistLine(0, 1)).toBe('目前無人候補，名額將空出');
    expect(lateCancelWaitlistLine(3, 1)).toBe('名額會讓給候補第 1 位');
    expect(lateCancelWaitlistLine(3, 2)).toBe('名額會讓給候補第 1、2 位');
    expect(lateCancelWaitlistLine(1, 2)).toBe('名額會讓給候補第 1 位');
  });
  it('未啟用回 null；時限外只多候補資訊', () => {
    expect(buildLateCancelConfirm({ ...base, event: { date: DATE, lateCancelHours: 0 }, nowMs: START - HOUR })).toBeNull();
    expect(buildLateCancelConfirm({ ...base, waitlistCount: 2, nowMs: START - DAY })).toEqual({
      message: '確定要取消報名？', sub: '名額會讓給候補第 1 位', cancelText: '返回', okText: '確定取消',
    });
    expect(buildLateCancelConfirm({ ...base, eligibleCount: 0, nowMs: START - HOUR })?.warn).toBeUndefined();
  });
  it('讀不到操作者資料（undefined）：中性後果，不寫恢復條件', () => {
    expect(buildLateCancelConfirm({ ...base, user: undefined, nowMs: START - HOUR })).toEqual({
      warn: '距開始不到 2 小時',
      message: '現在取消會記一次臨時取消',
      sub: '同一場只記一次\n目前無人候補，名額將空出',
      cancelText: '保留名額',
      okText: '仍要取消',
    });
  });

  it('時限內寫後果；第 3 次寫會變紅', () => {
    expect(buildLateCancelConfirm({ ...base, nowMs: START - HOUR })).toEqual({
      warn: '距開始不到 2 小時',
      message: '現在取消會記一次臨時取消',
      sub: '名字標籤 7 天或出席 3 場後恢復\n同一場只記一次\n目前無人候補，名額將空出',
      cancelText: '保留名額',
      okText: '仍要取消',
    });
    const user = info({ level: 'black', untilMs: START + DAY, recentMs: [START - DAY, START - 2 * DAY] });
    expect(buildLateCancelConfirm({ ...base, user, nowMs: START - HOUR })).toEqual({
      warn: '這是你 90 天內第 3 次臨時取消',
      message: '取消後標籤會變紅',
      sub: '紅標要管理員解除',
      cancelText: '保留名額',
      okText: '仍要取消',
    });
  });
  it('同行者彈窗：只取消同行者也提示', () => {
    expect(buildCompanionLateCancelNote({
      ...base, eligibleCount: 2, confirmedCount: 2, waitlistCount: 5, selfChecked: false, nowMs: START - HOUR,
    })).toEqual({
      warn: '距開始不到 2 小時',
      message: '同行者取消也會記你一次臨時取消',
      sub: '同一場只記一次・名額讓給候補第 1、2 位',
    });
    expect(buildCompanionLateCancelNote({ ...base, selfChecked: true, nowMs: START - DAY })).toBeNull();
    // 讀不到操作者資料：不判斷會不會變紅，照一般警示。
    expect(buildCompanionLateCancelNote({ ...base, user: undefined, selfChecked: false, nowMs: START - HOUR })?.warn)
      .toBe('距開始不到 2 小時');
  });
  it('成功提示只在 lateCancelMarked === true 時追加', () => {
    expect(withLateCancelMarked('已取消報名', true)).toBe('已取消報名，已記一次臨時取消');
    expect(withLateCancelMarked('已取消報名', undefined)).toBe('已取消報名');
  });
});
