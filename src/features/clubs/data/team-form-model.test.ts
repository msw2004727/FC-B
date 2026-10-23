import { describe, expect, it } from 'vitest';

import {
  TEAM_CATEGORY_OPTIONS,
  buildCreateTeamPayload,
  buildUpdateTeamPatch,
  diffStaffForNotify,
  normalizeTeamCategory,
  validateTeamFormValues,
} from './team-form-model';
import type {
  TeamFormContactLinks,
  TeamFormValues,
} from './team-form-model';

function values(overrides: Partial<TeamFormValues> = {}): TeamFormValues {
  return {
    type: 'competitive',
    sportTag: 'football',
    name: ' 海風俱樂部 ',
    nameEn: ' Sea Wind ',
    nationality: '台灣',
    region: ' 台北市 ',
    founded: '02024',
    contact: ' 0912345678 ',
    bio: ' 簡介 ',
    eduAccepting: false,
    contactLinksEnabled: false,
    contactLinkDrafts: [],
    captain: { uid: 'captain', name: '經理' },
    leaders: [
      { uid: 'leader-1', name: ' Alice ' },
      { uid: 'leader-2', name: 'ALICE' },
    ],
    coaches: [{ uid: 'coach', name: '教練' }],
    unresolvedLeaderNames: [' alice ', '舊領隊', ' '],
    unresolvedCoachNames: [' 教練 ', '舊教練'],
    unresolvedCaptainName: '舊經理',
    ...overrides,
  };
}

function contacts(): TeamFormContactLinks {
  return {
    enabled: true,
    links: [{ url: 'https://line.me/club', platform: 'line', label: 'LINE', host: 'line.me' }],
  };
}

function expectedCommon() {
  return {
    name: '海風俱樂部',
    nameEn: 'Sea Wind',
    nationality: '台灣',
    region: '台北市',
    founded: '02024',
    contact: '0912345678',
    bio: '簡介',
    contactLinksEnabled: true,
    contactLinks: [{ url: 'https://line.me/club', platform: 'line', label: 'LINE', host: 'line.me' }],
    leader: 'Alice',
    leaderUid: 'leader-1',
    leaders: ['Alice', '舊領隊'],
    leaderUids: ['leader-1', 'leader-2'],
    leaderNames: ['Alice', '舊領隊'],
    captain: '經理',
    captainUid: 'captain',
    captainName: '經理',
    coaches: ['教練', '舊教練'],
    coachUids: ['coach'],
    coachNames: ['教練', '舊教練'],
    type: 'competitive',
    sportTag: 'football',
    teachingEnabled: false,
  };
}

describe('分類：對應 A _normalizeTeamCategory / _getTeamCategoryOptions', () => {
  it.each([
    ['none', 'none'], [' NO ', 'none'], ['untagged', 'none'],
    ['education', 'education'], [' TEACHING ', 'education'],
    ['leisure', 'leisure'], ['Casual', 'leisure'], ['recreational', 'leisure'],
    ['competitive', 'competitive'], ['unknown', 'competitive'],
    ['', 'competitive'], [null, 'competitive'], [undefined, 'competitive'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeTeamCategory(input)).toBe(expected);
  });

  it('選項文案、順序與教學設定逐字一致', () => {
    expect(TEAM_CATEGORY_OPTIONS).toEqual([
      {
        key: 'none', label: '無', description: '不顯示標籤',
        formHint: '不顯示任何標籤與緞帶，也不啟用課程功能。',
        showEduSettings: false,
      },
      {
        key: 'competitive', label: '競技', description: '賽事與戰績分類',
        formHint: '競技標籤只作為俱樂部分類，賽事系統設定已預留。',
        showEduSettings: false,
      },
      {
        key: 'education', label: '教學', description: '啟用課程功能',
        formHint: '教學標籤會啟用課程、學員與待審核功能。',
        showEduSettings: true,
      },
      {
        key: 'leisure', label: '休閒', description: '休閒交流分類',
        formHint: '休閒標籤只作為俱樂部分類，未來可銜接友誼賽或休閒賽事設定。',
        showEduSettings: false,
      },
    ]);
  });
});

describe('validateTeamFormValues', () => {
  it('依序排除錯誤：名稱 → 運動 → 地區 → 聯絡 → 領隊 → 經理', () => {
    const form = values({
      name: ' ',
      sportTag: '',
      region: '',
      contactLinksEnabled: true,
      contactLinkDrafts: [],
      leaders: [],
      captain: null,
    });
    const expectError = (message: string): void => {
      expect(validateTeamFormValues(form, 'create')).toEqual({ ok: false, message });
    };

    expectError('請輸入俱樂部名稱');
    form.name = '俱樂部';
    expectError('請選擇運動類型');
    form.sportTag = 'football';
    expectError('請選擇地區');
    form.region = '臺北市';
    expectError('地區必須從清單選擇');
    form.region = ' 台北市 ';
    expectError('已開啟聯絡按鈕，請至少填一個連結');
    form.contactLinkDrafts = ['ftp://example.com'];
    expectError('聯絡連結格式不正確，請以 https:// 開頭或輸入有效網址');
    form.contactLinkDrafts = ['line.me/club'];
    expectError('請選擇至少一位俱樂部領隊');
    form.leaders = [{ uid: 'leader', name: '領隊' }];
    expectError('請設定俱樂部經理（必填）');
    form.captain = { uid: 'captain', name: '經理' };
    expect(validateTeamFormValues(form, 'create')).toEqual({
      ok: true,
      contactLinks: contacts(),
    });
  });

  it('編輯仍驗證基本欄位與聯絡資料', () => {
    const cases: [Partial<TeamFormValues>, string][] = [
      [{ name: '' }, '請輸入俱樂部名稱'],
      [{ sportTag: '' }, '請選擇運動類型'],
      [{ region: ' ' }, '請選擇地區'],
      [{ region: '不存在' }, '地區必須從清單選擇'],
      [
        { contactLinksEnabled: true, contactLinkDrafts: [' '] },
        '已開啟聯絡按鈕，請至少填一個連結',
      ],
      [
        { contactLinksEnabled: true, contactLinkDrafts: ['ftp://example.com'] },
        '聯絡連結格式不正確，請以 https:// 開頭或輸入有效網址',
      ],
    ];
    for (const [overrides, message] of cases) {
      expect(validateTeamFormValues(values(overrides), 'edit')).toEqual({ ok: false, message });
    }
  });

  it('編輯允許零領隊、無經理；新增未連結姓名不替代已解析人員', () => {
    const form = values({
      leaders: [],
      captain: null,
      unresolvedLeaderNames: ['舊領隊'],
      unresolvedCaptainName: '舊經理',
    });
    expect(validateTeamFormValues(form, 'edit')).toEqual({
      ok: true, contactLinks: { enabled: false, links: [] },
    });
    expect(validateTeamFormValues(form, 'create')).toEqual({
      ok: false, message: '請選擇至少一位俱樂部領隊',
    });
    expect(validateTeamFormValues(values({
      captain: null, unresolvedCaptainName: '舊經理',
    }), 'create')).toEqual({
      ok: false, message: '請設定俱樂部經理（必填）',
    });
  });

  it('其他為合法地區；關閉聯絡按鈕忽略非法草稿', () => {
    expect(validateTeamFormValues(values({
      region: '其他',
      contactLinksEnabled: false,
      contactLinkDrafts: ['ftp://example.com'],
    }), 'create')).toEqual({
      ok: true, contactLinks: { enabled: false, links: [] },
    });
  });
});

describe('buildCreateTeamPayload', () => {
  it('建立逐欄符合契約；不存在額外欄位或時間戳', () => {
    expect(buildCreateTeamPayload({
      teamId: 'tm_1', values: values(), contactLinks: contacts(),
      image: null, imageVariants: null,
    })).toEqual({
      ...expectedCommon(),
      id: 'tm_1',
      members: 4,
      image: null,
      active: true,
      pinned: false,
      pinOrder: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      history: [],
    });
  });

  it('教學型完整 payload 含 eduSettings 與 variants，cover 優先', () => {
    expect(buildCreateTeamPayload({
      teamId: 'tm_edu',
      values: values({ type: 'education', eduAccepting: false }),
      contactLinks: contacts(),
      image: 'original',
      imageVariants: { cover: 'cover-url', card: 'card-url' },
    })).toEqual({
      ...expectedCommon(),
      type: 'education',
      teachingEnabled: true,
      eduSettings: { acceptingStudents: false, teachingEnabled: true },
      id: 'tm_edu',
      members: 4,
      image: 'cover-url',
      imageVariants: { cover: 'cover-url', card: 'card-url' },
      active: true,
      pinned: false,
      pinOrder: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      history: [],
    });
  });

  it.each(['none', 'competitive', 'leisure'] as const)('非教學 %s 不寫 eduSettings', (type) => {
    const payload = buildCreateTeamPayload({
      teamId: 'tm_1', values: values({ type }), contactLinks: contacts(),
      image: 'image-url', imageVariants: {},
    });
    expect(payload.teachingEnabled).toBe(false);
    expect(payload).not.toHaveProperty('eduSettings');
    expect(payload).not.toHaveProperty('imageVariants');
    expect(payload.image).toBe('image-url');
  });

  it('只傳 card 時作為主圖；接受學生為 true 時保留', () => {
    const payload = buildCreateTeamPayload({
      teamId: 'tm_1',
      values: values({ type: 'education', eduAccepting: true }),
      contactLinks: contacts(),
      image: null,
      imageVariants: { cover: '', card: 'card-url' },
    });
    expect(payload.image).toBe('card-url');
    expect(payload.imageVariants).toEqual({ card: 'card-url' });
    expect(payload.eduSettings).toEqual({ acceptingStudents: true, teachingEnabled: true });
  });

  it('members 只計 UID；去重、濾空，不以同名合併不同身分', () => {
    const payload = buildCreateTeamPayload({
      teamId: 'tm_1',
      values: values({
        captain: { uid: 'u1', name: '同名' },
        leaders: [
          { uid: 'u1', name: '同名' },
          { uid: 'u2', name: '同名' },
          { uid: '', name: '空 UID' },
        ],
        coaches: [
          { uid: 'u2', name: '同名' },
          { uid: 'u3', name: '同名' },
          { uid: '  ', name: '空白 UID' },
        ],
        unresolvedLeaderNames: ['未連結'],
      }),
      contactLinks: { enabled: false, links: [] },
      image: null,
      imageVariants: null,
    });
    expect(payload.members).toBe(3);
    expect(payload.leaderUids).toEqual(['u1', 'u2', '']);
    expect(payload.leaderNames).toEqual(['同名', '空 UID', '未連結']);
  });
});

describe('buildUpdateTeamPatch', () => {
  it('編輯逐欄符合契約；無建立專用欄位或未傳入圖片', () => {
    expect(buildUpdateTeamPatch({
      values: values(), contactLinks: contacts(),
    })).toEqual({
      ...expectedCommon(),
      eduSettings: null,
    });
  });

  it('教學編輯逐欄保留設定與新圖片', () => {
    expect(buildUpdateTeamPatch({
      values: values({ type: 'education', eduAccepting: true }),
      contactLinks: contacts(),
      image: 'original',
      imageVariants: { cover: 'cover-url', card: 'card-url' },
    })).toEqual({
      ...expectedCommon(),
      type: 'education',
      teachingEnabled: true,
      eduSettings: { acceptingStudents: true, teachingEnabled: true },
      image: 'cover-url',
      imageVariants: { cover: 'cover-url', card: 'card-url' },
    });
  });

  it('傳入 image 才包含；空 variants 不造成圖片欄位寫入', () => {
    const args = { values: values(), contactLinks: contacts() };
    expect(buildUpdateTeamPatch({ ...args, image: 'new-image' })).toEqual({
      ...expectedCommon(), eduSettings: null, image: 'new-image',
    });
    expect(buildUpdateTeamPatch({ ...args, image: null })).toEqual({
      ...expectedCommon(), eduSettings: null, image: null,
    });
    for (const imageVariants of [null, {}, { cover: '', card: '' }]) {
      expect(buildUpdateTeamPatch({ ...args, imageVariants })).toEqual({
        ...expectedCommon(), eduSettings: null,
      });
    }
    expect(buildUpdateTeamPatch({
      ...args, imageVariants: { card: 'card-only' },
    })).toEqual({
      ...expectedCommon(),
      eduSettings: null,
      image: 'card-only',
      imageVariants: { card: 'card-only' },
    });
  });

  it('未連結姓名保留且大小寫去重；空 UID 與相容欄位為 null', () => {
    const patch = buildUpdateTeamPatch({
      values: values({
        captain: null,
        leaders: [],
        coaches: [],
        unresolvedCaptainName: ' 舊經理 ',
        unresolvedLeaderNames: ['Legacy', ' legacy ', ''],
        unresolvedCoachNames: ['Coach', 'COACH', ' 舊教練 '],
      }),
      contactLinks: { enabled: false, links: [] },
    });
    expect(patch.captain).toBe('舊經理');
    expect(patch.captainName).toBe('舊經理');
    expect(patch.captainUid).toBeNull();
    expect(patch.leader).toBe('Legacy');
    expect(patch.leaderUid).toBeNull();
    expect(patch.leaders).toEqual(['Legacy']);
    expect(patch.leaderNames).toEqual(['Legacy']);
    expect(patch.leaderUids).toEqual([]);
    expect(patch.coaches).toEqual(['Coach', '舊教練']);
    expect(patch.coachNames).toEqual(['Coach', '舊教練']);
    expect(patch.coachUids).toEqual([]);

    const empty = buildUpdateTeamPatch({
      values: values({
        captain: { uid: 'captain', name: '' },
        leaders: [],
        unresolvedCaptainName: ' 備用名 ',
        unresolvedLeaderNames: [],
      }),
      contactLinks: { enabled: false, links: [] },
    });
    expect(empty.captain).toBe('備用名');
    expect(empty.captainUid).toBe('captain');
    expect(empty.leader).toBe('');
    expect(empty.leaderUid).toBeNull();
  });

  it('保留 nationality 原值與 founded 字串，不修改或共用輸入陣列', () => {
    const form = values({ nationality: ' 台灣 ', founded: '' });
    const links = contacts();
    const variants = { cover: 'cover-url' };
    const before = JSON.stringify({ form, links, variants });
    const create = buildCreateTeamPayload({
      teamId: 'tm_1', values: form, contactLinks: links,
      image: null, imageVariants: variants,
    });
    const patch = buildUpdateTeamPatch({
      values: form, contactLinks: links, imageVariants: variants,
    });
    expect(create.nationality).toBe(' 台灣 ');
    expect(create.founded).toBe('');
    expect(patch.nationality).toBe(' 台灣 ');
    expect(patch.founded).toBe('');
    create.leaders.push('新增');
    patch.coachNames.push('新增');
    create.contactLinks.splice(0);
    if (patch.imageVariants) patch.imageVariants.cover = 'changed';
    expect(JSON.stringify({ form, links, variants })).toBe(before);
    expect(patch.leaderNames).toEqual(['Alice', '舊領隊']);
  });
});

describe('diffStaffForNotify', () => {
  it('新增：全部幹部重算、每種職務各通知，跨職務重算去重', () => {
    expect(diffStaffForNotify(null, {
      captainUid: 'c',
      leaderUids: ['l', 'c', 'l'],
      coachUids: ['k', 'l'],
    })).toEqual({
      recalcUids: ['c', 'l', 'k'],
      notifyCaptain: 'c',
      notifyLeaders: ['l', 'c'],
      notifyCoaches: ['k', 'l'],
    });
  });

  it('不變：經理與全部教練仍重算，既有領隊不重算、不通知', () => {
    const staff = { captainUid: 'c', leaderUids: ['l'], coachUids: ['k'] };
    expect(diffStaffForNotify(staff, staff)).toEqual({
      recalcUids: ['c', 'k'],
      notifyCaptain: null,
      notifyLeaders: [],
      notifyCoaches: [],
    });
  });

  it('新增、移除及經理轉移同時發生，保留 A 重算順序', () => {
    expect(diffStaffForNotify(
      { captainUid: 'old-c', leaderUids: ['old-l', 'l'], coachUids: ['old-k', 'k'] },
      { captainUid: 'new-c', leaderUids: ['l', 'new-l'], coachUids: ['k', 'new-k'] },
    )).toEqual({
      recalcUids: ['new-c', 'new-l', 'k', 'new-k', 'old-c', 'old-k', 'old-l'],
      notifyCaptain: 'new-c',
      notifyLeaders: ['new-l'],
      notifyCoaches: ['new-k'],
    });
  });

  it('清除全部職務：被移除的舊經理也重算', () => {
    expect(diffStaffForNotify(
      { captainUid: 'c', leaderUids: ['l'], coachUids: ['k'] },
      { captainUid: null, leaderUids: [], coachUids: [] },
    )).toEqual({
      recalcUids: ['c', 'k', 'l'],
      notifyCaptain: null,
      notifyLeaders: [],
      notifyCoaches: [],
    });
  });

  it('經理轉為領隊、新經理由舊教練轉任：只按 UID 與職務變化通知', () => {
    expect(diffStaffForNotify(
      { captainUid: 'a', leaderUids: [], coachUids: ['b'] },
      { captainUid: 'b', leaderUids: ['a'], coachUids: [] },
    )).toEqual({
      recalcUids: ['b', 'a'],
      notifyCaptain: 'b',
      notifyLeaders: ['a'],
      notifyCoaches: [],
    });
  });

  it('空值排除、UID 保序去重且不修改輸入', () => {
    const prev = {
      captainUid: ' c ', leaderUids: ['l', 'l', ' '], coachUids: ['k', ''],
    };
    const next = {
      captainUid: 'c', leaderUids: [' l ', '', 'new', 'new'], coachUids: [' k ', ' '],
    };
    const before = JSON.stringify({ prev, next });
    expect(diffStaffForNotify(prev, next)).toEqual({
      recalcUids: ['c', 'new', 'k'],
      notifyCaptain: null,
      notifyLeaders: ['new'],
      notifyCoaches: [],
    });
    expect(JSON.stringify({ prev, next })).toBe(before);
    expect(diffStaffForNotify(null, {})).toEqual({
      recalcUids: [], notifyCaptain: null, notifyLeaders: [], notifyCoaches: [],
    });
    expect(diffStaffForNotify({}, { captainUid: 'first' })).toEqual({
      recalcUids: ['first'], notifyCaptain: 'first', notifyLeaders: [], notifyCoaches: [],
    });
  });
});

// ASSUMPTION: 本次依附件交付測試原始碼；未執行命令，沒有宣稱測試或 TS 檢查已通過。
