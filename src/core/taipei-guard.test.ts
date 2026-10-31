import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-054c §2.1／§2.2：包含 C2／C3、列明不必修改的消費端及共用 event-time。
// 這是原始碼 token 守門，連註解／字串也掃描；不涵蓋別名、動態屬性或 Intl／toLocale*。
const GUARDED_FILES = [
  'src/core/event-time.ts',
  'src/features/events/data/terminal.ts',
  'src/features/home/data/next-activity.ts',
  'src/features/events/data/event-lifecycle.ts',
  'src/features/events/data/signup-restrictions.ts',
  'src/features/events/data/signup.ts',
  'src/features/clubs/data/team-detail-model.ts',
  'src/features/clubs/components/legacy/TeamDetailV2Panels.tsx',
  'src/features/profile/data/activity-records.ts',
  'src/features/events/data/event-calendar.ts',
  'src/features/events/data/event-comments.ts',
  'src/features/checkin/data/scan-events.ts',
  'src/features/clubs/components/legacy/TeamDetailWeekStrip.tsx',
  'src/features/events/data/attendance-settle.ts',
  'src/features/home/components/legacy/HomeNextActivity.tsx',
  'src/features/events/data/calendar-model.ts',
  'src/features/events/components/legacy/ActivityCalendar.tsx',
  'src/features/events/components/legacy/use-calendar-nav.ts',
  'src/features/events/pages/ActivitiesPage.tsx',
  'src/features/events/data/my-activities-model.ts',
  'src/features/events/data/signup-state.ts',
  'src/features/events/components/legacy/use-cancel-registration.tsx',
  'src/features/events/components/legacy/EventDetailMainView.tsx',
  'src/features/events/data/presentation.ts',
  'src/features/events/data/use-events.ts',
  'src/features/home/data/sport-rows.ts',
  'src/features/checkin/ScanSession.tsx',
  'src/features/events/pages/EventDetailPage.tsx',
  'src/features/events/data/detail-model.ts',
  'src/features/events/components/legacy/event-lifecycle-action.ts',
] as const;

type GuardedFile = (typeof GUARDED_FILES)[number];

interface AllowedLine {
  file: GuardedFile;
  line: number;
  source: string;
  reason: string;
}

// 固定檔案＋行號＋完整行文字；不能以整檔、函式名或任意子字串豁免。
// 薄包裝也記錄在此，但它們沒有違規 token，不會擴大本地日期操作的豁免範圍。
const ALLOWED_LINES: readonly AllowedLine[] = [
  {
    file: 'src/features/events/data/signup-restrictions.ts',
    line: 101,
    source: "const date = new Date(year, month - 1, day);",
    reason: '生日日曆 Q-11：只以生日年月日建構日曆值，保留既有日期合法性驗證。',
  },
  {
    file: 'src/features/events/data/signup-restrictions.ts',
    line: 102,
    source: "if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;",
    reason: '生日日曆 Q-11：生日欄位往返驗證，拒絕不存在的日期。',
  },
  {
    file: 'src/features/events/data/signup-restrictions.ts',
    line: 111,
    source: "let age = ref.year - birthday.getFullYear();",
    reason: '生日日曆 Q-11：讀取生日年份與台北基準年份比較；生日不是瞬間。',
  },
  {
    file: 'src/features/events/data/signup-restrictions.ts',
    line: 112,
    source: "if (ref.month < birthday.getMonth() + 1",
    reason: '生日日曆 Q-11：讀取生日月份；基準月份已由 taipeiParts 取得。',
  },
  {
    file: 'src/features/events/data/signup-restrictions.ts',
    line: 113,
    source: "|| (ref.month === birthday.getMonth() + 1 && ref.day < birthday.getDate())) {",
    reason: '生日日曆 Q-11：比較生日月日是否已到；基準月日已由 taipeiParts 取得。',
  },
  {
    file: 'src/features/profile/data/activity-records.ts',
    line: 461,
    source: "date.getFullYear() +",
    reason: 'D 類格式化：出席摘要 updatedAt 的裝置本地年份顯示，不解析活動日期。',
  },
  {
    file: 'src/features/profile/data/activity-records.ts',
    line: 462,
    source: "'/' + pad(date.getMonth() + 1) +",
    reason: 'D 類格式化：出席摘要 updatedAt 的裝置本地月份顯示。',
  },
  {
    file: 'src/features/profile/data/activity-records.ts',
    line: 463,
    source: "'/' + pad(date.getDate()) +",
    reason: 'D 類格式化：出席摘要 updatedAt 的裝置本地日期顯示。',
  },
  {
    file: 'src/features/profile/data/activity-records.ts',
    line: 464,
    source: "' ' + pad(date.getHours()) +",
    reason: 'D 類格式化：出席摘要 updatedAt 的裝置本地小時顯示。',
  },
  {
    file: 'src/features/profile/data/activity-records.ts',
    line: 465,
    source: "':' + pad(date.getMinutes())",
    reason: 'D 類格式化：出席摘要 updatedAt 的裝置本地分鐘顯示。',
  },
  {
    file: 'src/features/events/data/event-comments.ts',
    line: 89,
    source: "return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;",
    reason: 'D 類格式化：留言的絕對時間沿用裝置時區顯示，不參與活動結束判斷。',
  },
  {
    file: 'src/features/events/data/calendar-model.ts',
    line: 72,
    source: "return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;",
    reason: '純日曆算術：將月格或月份算術產生的日曆 Date 轉成日期鍵；瞬間另用 formatTaipei。',
  },
  {
    file: 'src/features/events/data/calendar-model.ts',
    line: 83,
    source: "return monthKeyFromDate(new Date(year, month - 1 + delta, 1));",
    reason: '純日曆算術：月份鍵加減與跨年進位，不與現在瞬間比較。',
  },
  {
    file: 'src/features/events/data/calendar-model.ts',
    line: 89,
    source: "return MONTH_FORMATTER.format(new Date(year, month - 1, 1));",
    reason: '純日曆算術／格式化：以月份鍵產生日曆值，交給 MONTH_FORMATTER 顯示月份。',
  },
  {
    file: 'src/features/events/data/calendar-model.ts',
    line: 106,
    source: "const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;",
    reason: '純日曆算術：取得月初星期以排列月曆格。',
  },
  {
    file: 'src/features/events/data/calendar-model.ts',
    line: 107,
    source: "const daysInMonth = new Date(year, month + 1, 0).getDate();",
    reason: '純日曆算術：取得當月天數。',
  },
  {
    file: 'src/features/events/data/calendar-model.ts',
    line: 119,
    source: "const date = new Date(year, month - 1, offset + 1);",
    reason: '純日曆算術：依月格偏移產生日曆日期，今天／過去旗標另用台北日期鍵。',
  },
  {
    file: 'src/features/events/data/calendar-model.ts',
    line: 124,
    source: "day: date.getDate(),",
    reason: '純日曆算術：讀取月格日曆日期的日欄位。',
  },
  {
    file: 'src/features/events/data/calendar-model.ts',
    line: 137,
    source: "const start = new Date(year, month - 1, 1).getTime();",
    reason: '純日曆算術：月份分組下界，僅與同樣從年月日建構的日曆值比較。',
  },
  {
    file: 'src/features/events/data/calendar-model.ts',
    line: 138,
    source: "const end = new Date(year, month, 1).getTime();",
    reason: '純日曆算術：月份分組上界，僅與同樣從年月日建構的日曆值比較。',
  },
  {
    file: 'src/features/events/data/calendar-model.ts',
    line: 144,
    source: "const time = new Date(y, m - 1, d).getTime();",
    reason: '純日曆算術：日期鍵轉日曆值以判斷所屬月份，不與活動瞬間或現在比較。',
  },
  {
    file: 'src/features/events/pages/ActivitiesPage.tsx',
    line: 569,
    source: "const dateObj = new Date(y, m - 1, day);",
    reason: '純日曆算術：由活動日期的年月日建構日曆值，只供星期標籤。',
  },
  {
    file: 'src/features/events/pages/ActivitiesPage.tsx',
    line: 570,
    source: "const dayName = DAY_NAMES[dateObj.getDay()] ?? '日';",
    reason: '純日曆算術：讀取活動日期的星期；今天判斷另用台北欄位。',
  },
  {
    file: 'src/features/events/data/terminal.ts',
    line: 23,
    source: "return parseEventRangeMs(value);",
    reason: '薄包裝 Q-1：parseEventDateRange 單行委派 parseEventRangeMs；不豁免本地 getter 或建構。',
  },
  {
    file: 'src/features/home/data/next-activity.ts',
    line: 77,
    source: "return parseEventRangeMs(value);",
    reason: '薄包裝 Q-1：parseEventDateRange 單行委派 parseEventRangeMs；不豁免本地 getter 或建構。',
  },
];

interface LocalDateUse {
  line: number;
  source: string;
  token: string;
}

/** 純掃描函式：不讀檔、不套允許清單，可直接以違規字串驗證。 */
export function findLocalDateUses(source: string): LocalDateUse[] {
  const pattern = /\.(?:getHours|getMinutes|getFullYear|getMonth|getDate|getDay)\s*\(|\bnew\s+Date\s*\(\s*(?:[$A-Z_a-z][\w$]*|[+-]?\d[\d_]*(?:\.\d+)?)\s*,/g;
  const lines = source.split(/\r?\n/);
  return Array.from(source.matchAll(pattern), (match) => {
    const line = source.slice(0, match.index).split('\n').length;
    return { line, source: (lines[line - 1] ?? '').trim(), token: match[0] };
  });
}

/** 讀檔由呼叫端負責；本函式對新增或改寫的本地日期操作直接報錯。 */
export function assertTaipeiSource(file: string, source: string, allowed: readonly AllowedLine[] = []): void {
  const violations = findLocalDateUses(source).filter((hit) => !allowed.some((entry) => (
    entry.file === file && entry.line === hit.line && entry.source === hit.source
  )));
  if (violations.length > 0) {
    throw new Error(violations.map((hit) => (
      file + ':' + hit.line + ': ' + hit.source
    )).join('\n'));
  }
}

const ROOT = resolve(__dirname, '../..');
const readSource = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8');

describe('T-054c 台北時間靜態守門', () => {
  it.each(GUARDED_FILES)('S1 %s 不得新增本地日期讀回／建構', (file) => {
    expect(() => assertTaipeiSource(file, readSource(file), ALLOWED_LINES)).not.toThrow();
  });

  it.each(ALLOWED_LINES)('S2 $file:$line 允許行必須存在且有理由', (entry) => {
    expect(entry.reason.trim().length).toBeGreaterThan(0);
    expect(GUARDED_FILES).toContain(entry.file);
    const lines = readSource(entry.file).split(/\r?\n/);
    expect(lines[entry.line - 1]?.trim()).toBe(entry.source);
  });

  it.each(ALLOWED_LINES.filter((entry) => entry.reason.startsWith('薄包裝')))(
    'S2 $file 的 parseEventDateRange 維持單行委派',
    (entry) => {
      expect(readSource(entry.file)).toContain(
        'export function parseEventDateRange(value: unknown): DateRange | null {\n'
        + '  ' + entry.source + '\n}',
      );
    },
  );

  it('S3 元測試：getHours() 違規字串必須讓相同守門函式拋錯', () => {
    const source = 'const targetA = evtA.getHours();';
    expect(() => assertTaipeiSource('src/core/event-time.ts', source, ALLOWED_LINES))
      .toThrow('src/core/event-time.ts:1: ' + source);
  });

  it.each([
    'evtA.getMinutes()',
    'evtA.getFullYear()',
    'evtA.getMonth()',
    'evtA.getDate()',
    'evtA.getDay()',
    'new Date(targetA, 0, 1)',
    'new Date(2026, 0, 1)',
    'evtA.getHours ( )',
    'new Date(\n  targetA, 0, 1)',
  ])('S3 元測試：攔下 %s', (source) => {
    expect(() => assertTaipeiSource('src/core/event-time.ts', source, ALLOWED_LINES)).toThrow();
  });

  it('S3 元測試：絕對毫秒建構及 UTC getter 可通過', () => {
    expect(() => assertTaipeiSource('src/core/event-time.ts', 'new Date(targetA).getUTCHours()'))
      .not.toThrow();
  });
});
