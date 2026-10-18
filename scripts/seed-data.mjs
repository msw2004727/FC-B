// Firestore emulator 種子資料物件。
//
// 覆蓋 FC-B 的：
//   - EventDoc（types.ts）：id/date/status/blockedUids/privateEvent/teamOnly/
//     creatorUid/creatorTeamId(s)/delegateUids 等
//   - RegistrationDoc：userId / eventId / status / registeredAt
//   - visibility.ts 分支：黑名單四態（guest / 非黑名單 / 黑名單+有報名 / 黑名單+無報名）、
//     私密活動 owner/delegate/admin、teamOnly 的 team 交集／isPublic
//   - terminal.ts 分支：ended/cancelled 尚未到 6h（active）、已超過 6h（terminal）、
//     cancelled 手動取消
//
// 文件 ID 使用固定字串，避免每次 seed 產生不同文件；日期仍以 buildSeedData(now) 的 now 為基準相對產生。

export const UIDS = {
  user1: 'U0000000000000000000000000000001',
  coach: 'U0000000000000000000000000000002',
  admin: 'U0000000000000000000000000000003',
  blocked: 'U0000000000000000000000000000004',
};

export const TEAM_IDS = {
  a: 'tm_seed_team_a',
  b: 'tm_seed_team_b',
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${pad2(d.getMinutes())}`;
}

/** 產生 terminal.ts::DATE_RE 可解析的字串：「YYYY/M/D H:MM~H:MM」 */
function fmtRange(startMs, endMs) {
  const e = new Date(endMs);
  return `${fmtDateTime(startMs)}~${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
}

export function buildSeedData(now = Date.now()) {
  const IDS = {
    football:    'ce_1700000000000_fmtch1',
    basketball:  'ce_1700000000000_bskt01',
    badminton:   'ce_1700000000000_bdmt01',
    full:        'ce_1700000000000_full01',
    upcoming:    'ce_1700000000000_upcm01',
    private:     'ce_1700000000000_priv01',
    teamOnly:    'ce_1700000000000_team01',
    blockNoReg:  'ce_1700000000000_blk001',
    blockCancel: 'ce_1700000000000_blk002',
    ended3h:     'ce_1700000000000_end3h1',
    ended7h:     'ce_1700000000000_end7h1',
    cancelled:   'ce_1700000000000_cncl01',
  };

  function mkEvent(id, title, startMs, endMs, extra) {
    const base = {
      id,
      title,
      date: fmtRange(startMs, endMs),
      status: 'open',
      location: '種子測試場地',
      max: 20,
      current: 0,
      waitlist: 0,
      sportTag: 'football',
      creatorUid: UIDS.coach,
      creatorTeamId: TEAM_IDS.a,
      creatorTeamIds: [TEAM_IDS.a],
      creatorName: 'Seed Coach',
      privateEvent: false,
      teamOnly: false,
      blockedUids: [],
      delegateUids: [],
      createdAt: new Date(startMs - HOUR_MS),
    };
    return Object.assign(base, extra || {});
  }

  // ── events ────────────────────────────────────────────────────
  const events = [
    // 0：公開報名中（football）
    {
      id: IDS.football,
      data: mkEvent(IDS.football, '週末足球公開賽', now + 1 * DAY_MS, now + 1 * DAY_MS + 2 * HOUR_MS, {
        sportTag: 'football',
        current: 5,
      }),
    },
    // 1：公開報名中（basketball）
    {
      id: IDS.basketball,
      data: mkEvent(IDS.basketball, '週末籃球公開賽', now + 2 * DAY_MS, now + 2 * DAY_MS + 2 * HOUR_MS, {
        sportTag: 'basketball',
        current: 3,
      }),
    },
    // 2：公開報名中（badminton）
    {
      id: IDS.badminton,
      data: mkEvent(IDS.badminton, '週末羽球公開賽', now + 3 * DAY_MS, now + 3 * DAY_MS + 2 * HOUR_MS, {
        sportTag: 'badminton',
        current: 4,
      }),
    },
    // 3：額滿
    {
      id: IDS.full,
      data: mkEvent(IDS.full, '額滿足球賽', now + 4 * DAY_MS, now + 4 * DAY_MS + 2 * HOUR_MS, {
        sportTag: 'football',
        current: 20,
        max: 20,
        status: 'full',
      }),
    },
    // 4：即將開放報名（upcoming）
    {
      id: IDS.upcoming,
      data: mkEvent(IDS.upcoming, '即將開放足球賽', now + 8 * DAY_MS, now + 8 * DAY_MS + 2 * HOUR_MS, {
        sportTag: 'football',
        status: 'upcoming',
      }),
    },
    // 5：私密活動（非 owner/delegate/non-admin 不可見）
    {
      id: IDS.private,
      data: mkEvent(IDS.private, '私密練習賽', now + 5 * DAY_MS, now + 5 * DAY_MS + 2 * HOUR_MS, {
        sportTag: 'basketball',
        privateEvent: true,
      }),
    },
    // 6：俱樂部限定（tm_seed_team_a）
    {
      id: IDS.teamOnly,
      data: mkEvent(IDS.teamOnly, 'A 隊俱樂部限定', now + 6 * DAY_MS, now + 6 * DAY_MS + 2 * HOUR_MS, {
        sportTag: 'football',
        teamOnly: true,
        creatorTeamId: TEAM_IDS.a,
        creatorTeamIds: [TEAM_IDS.a],
      }),
    },
    // 7：黑名單擋 0004 且 0004 無報名 → 對 0004 不可見
    {
      id: IDS.blockNoReg,
      data: mkEvent(
        IDS.blockNoReg,
        '黑名單驗證（無報名）',
        now + 7 * DAY_MS,
        now + 7 * DAY_MS + 2 * HOUR_MS,
        { sportTag: 'football', blockedUids: [UIDS.blocked] },
      ),
    },
    // 8：黑名單擋 0004 但 0004 有 cancelled 報名 → 第 3 態，可見
    {
      id: IDS.blockCancel,
      data: mkEvent(
        IDS.blockCancel,
        '黑名單驗證（有取消報名）',
        now + 9 * DAY_MS,
        now + 9 * DAY_MS + 2 * HOUR_MS,
        { sportTag: 'badminton', blockedUids: [UIDS.blocked] },
      ),
    },
    // 9：結束 3 小時內（end+6h 尚未到，仍顯示在 active）
    {
      id: IDS.ended3h,
      data: mkEvent(IDS.ended3h, '剛結束 3 小時內', now - 5 * HOUR_MS, now - 3 * HOUR_MS, {
        status: 'ended',
      }),
    },
    // 10：結束 7 小時前（end+6h 已超過，terminal）
    {
      id: IDS.ended7h,
      data: mkEvent(IDS.ended7h, '已結束 7 小時前', now - 9 * HOUR_MS, now - 7 * HOUR_MS, {
        status: 'ended',
      }),
    },
    // 11：手動取消
    {
      id: IDS.cancelled,
      data: mkEvent(IDS.cancelled, '手動取消活動', now - 10 * HOUR_MS, now - 8 * HOUR_MS, {
        status: 'cancelled',
      }),
    },
  ];

  // ── users ─────────────────────────────────────────────────────
  const users = [
    {
      id: UIDS.user1,
      data: {
        uid: UIDS.user1,
        lineUserId: UIDS.user1,
        role: 'user',
        displayName: '種子用戶 0001',
        teamIds: [TEAM_IDS.a],
        createdAt: new Date(now - 30 * DAY_MS),
      },
    },
    {
      id: UIDS.coach,
      data: {
        uid: UIDS.coach,
        lineUserId: UIDS.coach,
        role: 'coach',
        displayName: '種子教練 0002',
        teamIds: [TEAM_IDS.a],
        createdAt: new Date(now - 30 * DAY_MS),
      },
    },
    {
      id: UIDS.admin,
      data: {
        uid: UIDS.admin,
        lineUserId: UIDS.admin,
        role: 'admin',
        displayName: '種子管理員 0003',
        teamIds: [],
        createdAt: new Date(now - 30 * DAY_MS),
      },
    },
    {
      id: UIDS.blocked,
      data: {
        uid: UIDS.blocked,
        lineUserId: UIDS.blocked,
        role: 'user',
        displayName: '種子被黑名單 0004',
        teamIds: [],
        banned: true,
        bannedReason: 'seed: blocklist test fixture',
        createdAt: new Date(now - 30 * DAY_MS),
      },
    },
  ];

  // ── teams ─────────────────────────────────────────────────────
  // 欄位形狀照 A：id 與文件 ID 相同（R-ID-004）、active 為真才會出現在列表、members 是 A 寫入的人數快取（數字）。
  const teams = [
    {
      id: TEAM_IDS.a,
      data: {
        id: TEAM_IDS.a,
        name: '種子俱樂部 A',
        type: 'competitive',
        sportTag: 'football',
        region: '台北市',
        active: true,
        members: 2,
        teamExp: 1200,
        ownerUid: UIDS.coach,
        creatorUid: UIDS.coach,
        captainUid: UIDS.coach,
        captain: '種子教練',
        createdAt: new Date(now - 60 * DAY_MS),
      },
    },
    {
      id: TEAM_IDS.b,
      data: {
        id: TEAM_IDS.b,
        name: '種子俱樂部 B',
        type: 'education',
        sportTag: 'basketball',
        region: '新北市',
        active: true,
        members: 0,
        ownerUid: UIDS.admin,
        creatorUid: UIDS.admin,
        captainUid: UIDS.admin,
        createdAt: new Date(now - 60 * DAY_MS),
      },
    },
    {
      // 停用俱樂部：列表不應顯示（A getActiveTeams）
      id: 'tm_seed_team_inactive',
      data: {
        id: 'tm_seed_team_inactive',
        name: '種子俱樂部（停用）',
        type: 'leisure',
        sportTag: 'football',
        active: false,
        members: 0,
        captainUid: UIDS.admin,
        createdAt: new Date(now - 90 * DAY_MS),
      },
    },
  ];

  // ── registrations（events/{eventId}/registrations/{regId}）────
  const registrations = [
    // 事件 0（足球公開）— U0001 報名（驗證「下一場活動」）
    {
      path: `events/${IDS.football}/registrations/rg_seed_u0001`,
      data: {
        id: 'rg_seed_u0001',
        eventId: IDS.football,
        userId: UIDS.user1,
        status: 'confirmed',
        participantType: 'player',
        registeredAt: new Date(now - 2 * HOUR_MS),
      },
    },
    // 事件 0（足球公開）— U0002 教練報名
    {
      path: `events/${IDS.football}/registrations/rg_seed_u0002`,
      data: {
        id: 'rg_seed_u0002',
        eventId: IDS.football,
        userId: UIDS.coach,
        status: 'confirmed',
        participantType: 'player',
        registeredAt: new Date(now - 3 * HOUR_MS),
      },
    },
    // 事件 8（黑名單 + 取消）— U0004 曾有 cancelled 報名（第 3 態）
    {
      path: `events/${IDS.blockCancel}/registrations/rg_seed_u0004`,
      data: {
        id: 'rg_seed_u0004',
        eventId: IDS.blockCancel,
        userId: UIDS.blocked,
        status: 'cancelled',
        participantType: 'player',
        registeredAt: new Date(now - 1 * DAY_MS),
      },
    },
  ];

  // ── legacy root registrations（用來驗證 B 會排除它）────────────
  const legacy = [
    {
      path: 'registrations/rg_seed_legacy_u0001',
      data: {
        id: 'rg_seed_legacy_u0001',
        eventId: IDS.football,
        userId: UIDS.user1,
        status: 'confirmed',
        registeredAt: new Date(now - 10 * HOUR_MS),
      },
    },
  ];

  return { users, teams, events, registrations, legacy };
}

/** 匯出的種子資料物件（於 import 時以此當下時間產生一次）。 */
export const seedData = buildSeedData();
