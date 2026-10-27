import { cleanup } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REGION_MAP,
  createDefaultFormState,
  formStateFromEvent,
  toCreateEventForm,
  validateEventForm,
  type EventFormState,
  REGION_KEYS,
  resolveCreatorName,
  canToggleEventRegion,
} from './event-form-model';
import type { EventDoc } from './types';
import { SPORTS } from './sports';
import { TEAM_SPLIT_COLORS } from '../components/event-form/TeamJerseyIcon';

afterEach(() => {
  cleanup();
});

// 絕對瞬間 2026-06-01 10:00 台北。早鳥「等於現在」在四個時區都必須拒絕。
const FIXED_NOW = new Date('2026-06-01T10:00:00+08:00');

function makeValidState(overrides: Partial<EventFormState> = {}): EventFormState {
  return {
    ...createDefaultFormState(FIXED_NOW),
    title: '週六足球友誼賽',
    location: '台北市大安運動中心',
    dateVal: '2026-06-10',
    startTime: '14:00',
    endTime: '16:00',
    sportTag: 'football',
    ...overrides,
  };
}

describe('event-form-model', () => {
  it('createDefaultFormState matches legacy A defaults', () => {
    const state = createDefaultFormState(FIXED_NOW);
    expect(state.eventId).toBeNull();
    expect(state.title).toBe('');
    expect(state.type).toBe('play');
    expect(state.regionEnabled).toBe(true);
    expect(state.region).toBe('中部');
    expect(state.cities).toEqual([...REGION_MAP['中部']!]);
    expect(state.location).toBe('');
    expect(state.dateVal).toBe('');
    expect(state.startTime).toBe('14:00');
    expect(state.endTime).toBe('16:00');
    expect(state.regOpenEnabled).toBe(false);
    expect(state.max).toBe('20');
    expect(state.ageLimitEnabled).toBe(false);
    expect(state.minAge).toBe('0');
    expect(state.notes).toBe('');
    expect(state.sportTag).toBe('');
  });

  describe('validateEventForm order and messages', () => {
    it('1. requires title', () => {
      const res = validateEventForm(makeValidState({ title: '   ' }), FIXED_NOW);
      expect(res).toEqual({ ok: false, messageKey: 'events.form.error.titleRequired' });
    });

    it('2. rejects title > 16 chars', () => {
      const res = validateEventForm(
        makeValidState({ title: '一二三四五六七八九十十一十二十三十四十五十六十七' }),
        FIXED_NOW,
      );
      // 測試同步更新（R-QA-005）：照 A「活動名稱不可超過 N 字」帶上限參數。
      expect(res).toEqual({ ok: false, messageKey: 'events.form.error.titleTooLong', params: { limit: 16 } });
    });

    it('3. requires location', () => {
      const res = validateEventForm(makeValidState({ location: '' }), FIXED_NOW);
      expect(res).toEqual({ ok: false, messageKey: 'events.form.error.locationRequired' });
    });

    it('4. requires dateVal', () => {
      const res = validateEventForm(makeValidState({ dateVal: '' }), FIXED_NOW);
      expect(res).toEqual({ ok: false, messageKey: 'events.form.error.dateRequired' });
    });

    it('5. requires startTime and endTime', () => {
      const res1 = validateEventForm(makeValidState({ startTime: '' }), FIXED_NOW);
      expect(res1).toEqual({ ok: false, messageKey: 'events.form.error.timeRequired' });
      const res2 = validateEventForm(makeValidState({ endTime: '' }), FIXED_NOW);
      expect(res2).toEqual({ ok: false, messageKey: 'events.form.error.timeRequired' });
    });

    it('6. requires complete regOpen date and clock when regOpenEnabled', () => {
      const res1 = validateEventForm(
        makeValidState({ regOpenEnabled: true, regOpenDate: '2026-06-05', regOpenClock: '' }),
        FIXED_NOW,
      );
      expect(res1).toEqual({ ok: false, messageKey: 'events.form.error.regOpenIncomplete' });
      const res2 = validateEventForm(
        makeValidState({ regOpenEnabled: true, regOpenDate: '', regOpenClock: '12:00' }),
        FIXED_NOW,
      );
      expect(res2).toEqual({ ok: false, messageKey: 'events.form.error.regOpenIncomplete' });
    });

    it('7. rejects start time earlier than now on create, but allows on edit', () => {
      const pastCreate = makeValidState({
        eventId: null,
        dateVal: '2026-05-30',
        startTime: '14:00',
        endTime: '16:00',
      });
      expect(validateEventForm(pastCreate, FIXED_NOW)).toEqual({
        ok: false,
        messageKey: 'events.form.error.startInPast',
      });

      const pastEdit = makeValidState({
        eventId: 'ce_existing_1',
        dateVal: '2026-05-30',
        startTime: '14:00',
        endTime: '16:00',
      });
      expect(validateEventForm(pastEdit, FIXED_NOW)).toEqual({ ok: true });
    });

    it('8. requires end time after start time', () => {
      const res = validateEventForm(
        makeValidState({ startTime: '16:00', endTime: '14:00' }),
        FIXED_NOW,
      );
      expect(res).toEqual({ ok: false, messageKey: 'events.form.error.endBeforeStart' });
    });

    it('9. rejects notes > 500 chars', () => {
      const res = validateEventForm(
        makeValidState({ notes: 'a'.repeat(501) }),
        FIXED_NOW,
      );
      expect(res).toEqual({ ok: false, messageKey: 'events.form.error.notesTooLong' });
    });

    it('10. requires sportTag', () => {
      const res = validateEventForm(makeValidState({ sportTag: '' }), FIXED_NOW);
      expect(res).toEqual({ ok: false, messageKey: 'events.form.error.sportRequired' });
    });

    it('11. requires region when regionEnabled is true', () => {
      const res = validateEventForm(
        makeValidState({ regionEnabled: true, region: '' }),
        FIXED_NOW,
      );
      expect(res).toEqual({ ok: false, messageKey: 'events.form.error.regionRequired' });

      const disabledOk = validateEventForm(
        makeValidState({ regionEnabled: false, region: '' }),
        FIXED_NOW,
      );
      expect(disabledOk).toEqual({ ok: true });
    });
  });

  // 測試同步更新（R-QA-005）：A `_regionGetFormData` 縣市原樣送出、不回填（空縣市由 UI 至少保留一個避免）。
  it('sends cities as-is like A (no backfill)', () => {
    const state = makeValidState({
      regionEnabled: true,
      region: '南部',
      cities: [],
    });
    const form = toCreateEventForm(state, '王小明');
    expect(form.regionEnabled).toBe(true);
    expect(form.region).toBe('南部');
    expect(form.cities).toEqual([]);

    const disabledForm = toCreateEventForm(
      makeValidState({ regionEnabled: false, region: '南部', cities: ['台南市'] }),
      '王小明',
    );
    expect(disabledForm.regionEnabled).toBe(false);
    expect(disabledForm.region).toBe('');
    expect(disabledForm.cities).toEqual([]);
  });

  it('formStateFromEvent round-trips into toCreateEventForm', () => {
    const doc: EventDoc & Record<string, unknown> = {
      id: 'ce_test_123',
      title: '週日籃球團',
      type: 'camp',
      location: '市民運動中心',
      date: '2026/07/15 18:30~20:30',
      regOpenTime: '2026-07-01T09:00',
      max: 16,
      minAge: 18,
      notes: '請穿淺色球衣',
      sportTag: 'basketball',
      regionEnabled: true,
      region: '北部',
      cities: [],
    };

    const state = formStateFromEvent(doc);
    expect(state.eventId).toBe('ce_test_123');
    expect(state.title).toBe('週日籃球團');
    expect(state.type).toBe('camp');
    expect(state.location).toBe('市民運動中心');
    expect(state.dateVal).toBe('2026-07-15');
    expect(state.startTime).toBe('18:30');
    expect(state.endTime).toBe('20:30');
    expect(state.regOpenEnabled).toBe(true);
    expect(state.regOpenDate).toBe('2026-07-01');
    expect(state.regOpenClock).toBe('09:00');
    expect(state.max).toBe('16');
    expect(state.ageLimitEnabled).toBe(true);
    expect(state.minAge).toBe('18');
    expect(state.notes).toBe('請穿淺色球衣');
    expect(state.sportTag).toBe('basketball');
    expect(state.regionEnabled).toBe(true);
    expect(state.region).toBe('北部');
    expect(state.cities).toEqual([...REGION_MAP['北部']!]);

    const form = toCreateEventForm(state, '主辦人');
    expect(form.title).toBe('週日籃球團');
    expect(form.type).toBe('camp');
    expect(form.dateVal).toBe('2026-07-15');
    expect(form.startTime).toBe('18:30');
    expect(form.endTime).toBe('20:30');
    expect(form.regOpenTime).toBe('2026-07-01T09:00');
    expect(form.max).toBe(16);
    expect(form.minAge).toBe(18);
    expect(form.feeEnabled).toBe(false);
    expect(form.fee).toBe(0);
    expect(form.teamOnly).toBe(false);
    expect(form.privateEvent).toBe(false);
    expect(form.delegates).toEqual([]);
    expect(form.image).toBe('');
  });
});

describe('1E-3：封面、委託人與運動類型', () => {
  it('未給 extras 維持原預設，且不產生 imageVariants 欄位', () => {
    const form = toCreateEventForm(makeValidState(), '主辦人');
    expect(form.image).toBe('');
    expect(form.delegates).toEqual([]);
    expect(Object.hasOwn(form, 'imageVariants')).toBe(false);
    expect(toCreateEventForm(makeValidState(), '主辦人', {})).toEqual(form);
  });

  it('extras 原樣帶入既有欄位', () => {
    const extras = {
      image: 'https://example.test/image.webp',
      imageVariants: {
        cover: 'https://example.test/cover.webp',
        homeNext: 'https://example.test/home.webp',
      },
      delegates: [{ uid: 'delegate-uid', name: '委託人' }],
    };
    const form = toCreateEventForm(makeValidState(), '主辦人', extras);
    expect(form.image).toBe(extras.image);
    expect(form.imageVariants).toEqual(extras.imageVariants);
    expect(form.delegates).toEqual(extras.delegates);
    expect(form.creatorName).toBe('主辦人');
  });

  it('只有部分 extras 時，其餘維持預設', () => {
    const form = toCreateEventForm(makeValidState(), '主辦人', { image: 'cover' });
    expect(form.image).toBe('cover');
    expect(form.delegates).toEqual([]);
    expect(Object.hasOwn(form, 'imageVariants')).toBe(false);
  });

  it.each(SPORTS.map(sport => sport.sportTag))('有效 sportTag %s 在讀取與送出時 trim', tag => {
    // 測試同步更新：照 A（1E-3）。
    const state = formStateFromEvent({ id: 'public-id', sportTag: ` ${tag} ` } as EventDoc);
    expect(state.sportTag).toBe(tag);
    expect(toCreateEventForm(makeValidState({ sportTag: ` ${tag} ` }), '主辦人').sportTag).toBe(tag);
  });

  it.each(['', 'unknown', 'FOOTBALL', '__proto__', 'constructor'])(
    '未知 sportTag %s 在讀取與送出時轉空字串',
    tag => {
      // 測試同步更新：照 A（1E-3）。
      expect(formStateFromEvent({ id: 'public-id', sportTag: tag } as EventDoc).sportTag).toBe('');
      expect(toCreateEventForm(makeValidState({ sportTag: tag }), '主辦人').sportTag).toBe('');
    },
  );
});

describe('2B-1：加值狀態、還原、對應與驗證', () => {
  it('加值預設照 A，陣列不跨表單共用', () => {
    const state = createDefaultFormState();
    expect(state).toMatchObject({
      feeEnabled: false,
      fee: '0',
      teamOnly: false,
      teamOnlyTeamIds: [],
      genderRestrictionEnabled: false,
      allowedGender: '',
      privateEvent: false,
      teamSplitEnabled: false,
      teamSplitCount: 2,
      teamSplitColorIdx: [0, 1, 2, 3],
      teamSplitBalanceCap: true,
      teamSplitMode: 'random',
      teamSplitLockHours: 2,
      socialLinksEnabled: false,
      socialLinkInputs: [''],
      earlyBirdEnabled: false,
      earlyBirdCost: '10',
      gpsEnabled: false,
    });
    state.teamSplitColorIdx[0] = 7;
    state.teamOnlyTeamIds.push('team-a');
    state.socialLinkInputs.push('https://example.test/');
    const another = createDefaultFormState();
    expect(another.teamSplitColorIdx).toEqual([0, 1, 2, 3]);
    expect(another.teamOnlyTeamIds).toEqual([]);
    expect(another.socialLinkInputs).toEqual(['']);
  });

  it('還原 A 加值欄位，色票以 hex 對回索引，GPS 受權限控制', () => {
    const color = TEAM_SPLIT_COLORS[3];
    if (!color) throw new Error('missing contract color');
    const doc = {
      id: 'public-addon-event',
      feeEnabled: true,
      fee: 120,
      teamOnly: true,
      creatorTeamIds: ['team-b', 'team-a'],
      genderRestrictionEnabled: true,
      allowedGender: '女',
      privateEvent: true,
      teamSplit: {
        enabled: true,
        mode: 'self-select',
        balanceCap: false,
        selfSelectLockHours: 6,
        teams: [
          { key: 'A', color: color.hex, name: color.name },
          { key: 'B', color: 'unknown-color', name: '舊色票' },
        ],
      },
      socialLinksEnabled: true,
      socialLinks: [{ url: 'https://line.me/test#fragment' }],
      earlyBirdEnabled: true,
      earlyBirdCost: 30,
      mapLocationConfirmed: true,
    } as unknown as EventDoc;

    expect(formStateFromEvent(doc, { canUseAddons: true })).toMatchObject({
      feeEnabled: true,
      fee: '120',
      teamOnly: true,
      teamOnlyTeamIds: ['team-b', 'team-a'],
      genderRestrictionEnabled: true,
      allowedGender: '女',
      privateEvent: true,
      teamSplitEnabled: true,
      teamSplitCount: 2,
      teamSplitColorIdx: [3, 1, 2, 3],
      teamSplitBalanceCap: false,
      teamSplitMode: 'self-select',
      teamSplitLockHours: 6,
      socialLinksEnabled: true,
      socialLinkInputs: ['https://line.me/test'],
      earlyBirdEnabled: true,
      earlyBirdCost: '30',
      gpsEnabled: true,
    });
    expect(formStateFromEvent(doc).gpsEnabled).toBe(false);
    expect(formStateFromEvent(doc, { canUseAddons: false }).gpsEnabled).toBe(false);
    expect(formStateFromEvent({
      id: 'gps-event',
      gpsEnabled: true,
    } as unknown as EventDoc, { canUseAddons: true }).gpsEnabled).toBe(true);
  });

  it('舊資料還原單一俱樂部、預設費用、早鳥、社群及分隊值', () => {
    const state = formStateFromEvent({
      id: 'old-event',
      fee: 80,
      creatorTeamId: 'old-team',
      creatorTeamIds: [],
      socialLinksEnabled: true,
      socialLinks: [],
      earlyBirdEnabled: true,
      earlyBirdCost: 0,
      teamSplit: {
        enabled: true,
        mode: 'manual',
        teams: [{ color: 'unknown' }, { color: 'unknown' }, { color: 'unknown' }],
      },
    } as unknown as EventDoc);
    expect(state).toMatchObject({
      feeEnabled: true,
      fee: '80',
      teamOnlyTeamIds: ['old-team'],
      socialLinksEnabled: false,
      socialLinkInputs: [''],
      earlyBirdCost: '10',
      teamSplitCount: 3,
      teamSplitBalanceCap: true,
      teamSplitMode: 'manual',
      teamSplitLockHours: 2,
    });
    expect(formStateFromEvent({
      id: 'explicit-fee',
      feeEnabled: false,
      fee: 80,
    } as unknown as EventDoc).feeEnabled).toBe(false);
  });

  it('開啟欄位送 A 格式，限定俱樂部以 extras 的順序為準', () => {
    const state = makeValidState({
      feeEnabled: true,
      fee: '123.9',
      teamOnly: true,
      teamOnlyTeamIds: ['ignored-state-id'],
      genderRestrictionEnabled: true,
      allowedGender: '男',
      privateEvent: true,
      teamSplitEnabled: true,
      teamSplitCount: 3,
      teamSplitColorIdx: [3, 2, 1, 0],
      teamSplitBalanceCap: false,
      teamSplitMode: 'self-select',
      teamSplitLockHours: 5,
      socialLinksEnabled: true,
      socialLinkInputs: [' line.me/test#fragment ', 'https://line.me/test', ''],
      earlyBirdEnabled: true,
      earlyBirdCost: '25.9',
      gpsEnabled: true,
    });
    const selection = { ids: ['team-b', 'team-a'], names: ['乙隊', '甲隊'] };
    const form = toCreateEventForm(state, '主辦人', { teamOnlySelection: selection });
    expect(form).toMatchObject({
      feeEnabled: true,
      fee: 123,
      teamOnly: true,
      creatorTeamId: 'team-b',
      creatorTeamName: '乙隊',
      creatorTeamIds: ['team-b', 'team-a'],
      creatorTeamNames: ['乙隊', '甲隊'],
      genderRestrictionEnabled: true,
      allowedGender: '男',
      privateEvent: true,
      socialLinksEnabled: true,
      earlyBirdEnabled: true,
      earlyBirdCost: 25,
      earlyBirdPolicyVersion: 1,
      gpsEnabled: true,
    });
    expect(form.creatorTeamIds).not.toBe(selection.ids);
    expect(form.creatorTeamNames).not.toBe(selection.names);
    expect(form.teamSplit).toEqual({
      enabled: true,
      mode: 'self-select',
      balanceCap: false,
      selfSelectLockHours: 5,
      teams: [3, 2, 1].map((index, offset) => ({
        key: ['A', 'B', 'C'][offset],
        color: TEAM_SPLIT_COLORS[index]?.hex,
        name: TEAM_SPLIT_COLORS[index]?.name,
      })),
    });
    expect(form.teamSplit).not.toHaveProperty('lockAt');
    expect(form.socialLinks).toEqual([{
      url: 'https://line.me/test',
      platform: 'line',
      label: 'LINE',
      host: 'line.me',
    }]);
  });

  it('關閉欄位不送殘留值，社群 enabled 依合法連結決定', () => {
    const state = makeValidState({
      fee: '100',
      allowedGender: '女',
      teamOnlyTeamIds: ['stale-team'],
      socialLinkInputs: ['https://line.me/test'],
      earlyBirdCost: '200',
    });
    const form = toCreateEventForm(state, '主辦人', {
      teamOnlySelection: { ids: ['stale-team'], names: ['舊隊'] },
    });
    expect(form).toMatchObject({
      feeEnabled: false,
      fee: 0,
      teamOnly: false,
      creatorTeamId: null,
      creatorTeamName: null,
      creatorTeamIds: [],
      creatorTeamNames: [],
      allowedGender: '',
      socialLinksEnabled: false,
      socialLinks: [],
      earlyBirdEnabled: false,
      earlyBirdCost: 0,
      earlyBirdPolicyVersion: null,
    });
    expect(form.teamSplit).toBeUndefined();
    expect(toCreateEventForm(makeValidState({
      socialLinksEnabled: true,
      socialLinkInputs: ['', 'http://'],
    }), '主辦人')).toMatchObject({
      socialLinksEnabled: false,
      socialLinks: [],
    });
    expect(toCreateEventForm(makeValidState({
      feeEnabled: true,
      fee: 'abc',
    }), '主辦人').fee).toBe(0);
  });

  it.each([
    ['9', 10],
    ['501', 500],
    ['25.9', 25],
    ['abc', 10],
    ['Infinity', 10],
  ])('早鳥 %s 正規化為 %i', (raw, expected) => {
    expect(toCreateEventForm(makeValidState({
      earlyBirdEnabled: true,
      earlyBirdCost: raw,
    }), '主辦人').earlyBirdCost).toBe(expected);
  });

  it.each(['random', 'manual', 'self-select'] as const)(
    '分隊模式 %s 的鎖定時間、預設索引與無效色票回退照 A',
    mode => {
      const form = toCreateEventForm(makeValidState({
        teamSplitEnabled: true,
        teamSplitCount: 4,
        teamSplitMode: mode,
        teamSplitLockHours: 0,
        teamSplitColorIdx: [999],
      }), '主辦人');
      expect(form.teamSplit?.selfSelectLockHours).toBe(mode === 'self-select' ? 2 : 0);
      expect(form.teamSplit?.teams.map(team => team.color)).toEqual([
        TEAM_SPLIT_COLORS[0]?.hex,
        TEAM_SPLIT_COLORS[1]?.hex,
        TEAM_SPLIT_COLORS[2]?.hex,
        TEAM_SPLIT_COLORS[3]?.hex,
      ]);
    },
  );

  it.each([
    {
      patch: { socialLinksEnabled: true, socialLinkInputs: [' ', ''] },
      message: '社群連結開啟後，請至少填入 1 個網址',
    },
    {
      patch: { socialLinksEnabled: true, socialLinkInputs: ['https://line.me/test', 'http://'] },
      message: '社群連結網址格式不正確，請確認後再送出',
    },
    {
      patch: { earlyBirdEnabled: true, earlyBirdCost: '9' },
      message: '早鳥報名積分需介於 10～500 分',
    },
    {
      patch: { earlyBirdEnabled: true, earlyBirdCost: '501' },
      message: '早鳥報名積分需介於 10～500 分',
    },
    {
      patch: { earlyBirdEnabled: true, earlyBirdCost: 'abc' },
      message: '早鳥報名積分需介於 10～500 分',
    },
    {
      patch: { earlyBirdEnabled: true },
      message: '早鳥報名需搭配未來的開放報名時間',
    },
    {
      patch: {
        earlyBirdEnabled: true,
        regOpenEnabled: true,
        regOpenDate: '2026-06-01',
        regOpenClock: '10:00',
      },
      message: '早鳥報名需搭配未來的開放報名時間',
    },
    {
      patch: { feeEnabled: true, fee: '0' },
      message: '請輸入活動費用',
    },
    {
      patch: { genderRestrictionEnabled: true, allowedGender: '' },
      message: '請選擇限定性別',
    },
  ] satisfies { patch: Partial<EventFormState>; message: string }[])(
    '新增驗證逐字回傳：$message',
    ({ patch, message }) => {
      document.documentElement.lang = 'zh-TW';
      expect(validateEventForm(makeValidState(patch), FIXED_NOW)).toEqual({
        ok: false,
        message,
      });
    },
  );

  it('驗證順序：社群空值 → 格式 → 早鳥積分 → 標題', () => {
    const state = makeValidState({
      title: '',
      socialLinksEnabled: true,
      socialLinkInputs: [''],
      earlyBirdEnabled: true,
      earlyBirdCost: '9',
    });
    expect(validateEventForm(state, FIXED_NOW)).toEqual({
      ok: false, message: '社群連結開啟後，請至少填入 1 個網址',
    });
    state.socialLinkInputs = ['http://'];
    expect(validateEventForm(state, FIXED_NOW)).toEqual({
      ok: false, message: '社群連結網址格式不正確，請確認後再送出',
    });
    state.socialLinkInputs = ['https://line.me/test'];
    expect(validateEventForm(state, FIXED_NOW)).toEqual({
      ok: false, message: '早鳥報名積分需介於 10～500 分',
    });
    state.earlyBirdCost = '10';
    expect(validateEventForm(state, FIXED_NOW)).toEqual({
      ok: false, messageKey: 'events.form.error.titleRequired',
    });
  });

  it('驗證順序：開放報名完整 → 早鳥未來時間 → 費用 → 建立時間', () => {
    const state = makeValidState({
      dateVal: '2026-05-01',
      regOpenEnabled: true,
      regOpenDate: '2026-06-05',
      regOpenClock: '',
      earlyBirdEnabled: true,
      feeEnabled: true,
      fee: '0',
    });
    expect(validateEventForm(state, FIXED_NOW)).toEqual({
      ok: false, messageKey: 'events.form.error.regOpenIncomplete',
    });
    state.regOpenEnabled = false;
    expect(validateEventForm(state, FIXED_NOW)).toEqual({
      ok: false, message: '早鳥報名需搭配未來的開放報名時間',
    });
    state.regOpenEnabled = true;
    state.regOpenClock = '12:00';
    expect(validateEventForm(state, FIXED_NOW)).toEqual({
      ok: false, message: '請輸入活動費用',
    });
    state.fee = '20';
    expect(validateEventForm(state, FIXED_NOW)).toEqual({
      ok: false, messageKey: 'events.form.error.startInPast',
    });
  });

  it('驗證順序：運動標籤 → 限定性別 → 地區', () => {
    const state = makeValidState({
      sportTag: '',
      genderRestrictionEnabled: true,
      allowedGender: '',
      region: '',
    });
    expect(validateEventForm(state, FIXED_NOW)).toEqual({
      ok: false, messageKey: 'events.form.error.sportRequired',
    });
    state.sportTag = 'football';
    expect(validateEventForm(state, FIXED_NOW)).toEqual({
      ok: false, message: '請選擇限定性別',
    });
    state.allowedGender = '女';
    expect(validateEventForm(state, FIXED_NOW)).toEqual({
      ok: false, messageKey: 'events.form.error.regionRequired',
    });
  });

  it('無加值權限仍先驗社群及早鳥積分，其後不阻擋既有加值欄位的基本編輯', () => {
    const state = makeValidState({
      eventId: 'existing',
      feeEnabled: true,
      fee: '0',
      earlyBirdEnabled: true,
      earlyBirdCost: '10',
      genderRestrictionEnabled: true,
      allowedGender: '',
    });
    expect(validateEventForm(state, FIXED_NOW, { canUseAddons: false })).toEqual({
      ok: true,
    });
    state.earlyBirdCost = '9';
    expect(validateEventForm(state, FIXED_NOW, { canUseAddons: false })).toEqual({
      ok: false, message: '早鳥報名積分需介於 10～500 分',
    });
  });

  it('合法早鳥邊界、性別及費用可以送出', () => {
    for (const cost of ['10', '500']) {
      expect(validateEventForm(makeValidState({
        earlyBirdEnabled: true,
        earlyBirdCost: cost,
        regOpenEnabled: true,
        regOpenDate: '2026-06-05',
        regOpenClock: '12:00',
        feeEnabled: true,
        fee: '100',
        genderRestrictionEnabled: true,
        allowedGender: '男',
      }), FIXED_NOW)).toEqual({ ok: true });
    }
  });
});

describe('照 A 修正的項目', () => {
  it('地區與縣市順序照 A 的 REGION_MAP', () => {
    expect([...REGION_KEYS]).toEqual(['中部', '北部', '南部', '東部&外島']);
    expect(REGION_MAP['中部']).toEqual(['台中市', '苗栗縣', '彰化縣', '南投縣', '雲林縣']);
    expect(REGION_MAP['南部']).toEqual(['高雄市', '台南市', '嘉義市', '嘉義縣', '屏東縣']);
  });

  it('建立者名稱：暱稱 → 角色名稱（含自訂角色）→ 一般用戶，絕不用 UID', () => {
    expect(resolveCreatorName('小明', 'user')).toBe('小明');
    expect(resolveCreatorName('', 'coach')).toBe('教練');
    // A：displayName 有值就原樣使用（不 trim）
    expect(resolveCreatorName('  ', 'coach')).toBe('  ');
    expect(resolveCreatorName(null, 'judge', [{ key: 'judge' }])).toBe('judge');
    expect(resolveCreatorName(null, 'judge', [{ key: 'judge', label: '裁判' }])).toBe('裁判');
    expect(resolveCreatorName(null, 'unknown_role')).toBe('一般用戶');
  });

  it('地區開關只給有後台用戶管理或後台入口權限者', () => {
    expect(canToggleEventRegion((code) => code === 'admin.entry')).toBe(true);
    expect(canToggleEventRegion((code) => code === 'admin.users.entry')).toBe(true);
    expect(canToggleEventRegion(() => false)).toBe(false);
  });

  it('名額照 A：有限數字照用（含 0），否則 20', () => {
    const base = createDefaultFormState(new Date('2026-05-01T00:00:00'));
    expect(toCreateEventForm({ ...base, max: '0' }, '小明').max).toBe(0);
    expect(toCreateEventForm({ ...base, max: 'abc' }, '小明').max).toBe(20);
  });
});

describe('台北牆鐘：驗證與報名時間讀回', () => {
  it('早鳥開放時間等於現在仍拒絕，晚 1 分鐘可以', () => {
    const now = new Date('2026-06-01T10:00:00+08:00');
    expect(validateEventForm(makeValidState({
      earlyBirdEnabled: true,
      regOpenEnabled: true,
      regOpenDate: '2026-06-01',
      regOpenClock: '10:00',
    }), now)).toEqual({ ok: false, message: '早鳥報名需搭配未來的開放報名時間' });
    expect(validateEventForm(makeValidState({
      earlyBirdEnabled: true,
      regOpenEnabled: true,
      regOpenDate: '2026-06-01',
      regOpenClock: '10:01',
    }), now)).toEqual({ ok: true });
  });

  it('不存在的日期走原本的錯誤 key（建立 startInPast、編輯 endBeforeStart）', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(validateEventForm(makeValidState({ dateVal: '2026-02-30' }), now)).toEqual({
      ok: false,
      messageKey: 'events.form.error.startInPast',
    });
    expect(validateEventForm(makeValidState({
      eventId: 'ce_existing',
      dateVal: '2026-02-30',
    }), now)).toEqual({
      ok: false,
      messageKey: 'events.form.error.endBeforeStart',
    });
  });

  it('datetime-local 仍用字串拆解；帶時區後備讀台北牆鐘；無法解析則關閉', () => {
    const local = formStateFromEvent({ id: 'a', regOpenTime: '2026-10-19T09:00' } as EventDoc);
    expect(local.regOpenEnabled).toBe(true);
    expect(local.regOpenDate).toBe('2026-10-19');
    expect(local.regOpenClock).toBe('09:00');

    const zoned = formStateFromEvent({ id: 'b', regOpenTime: '2026-10-19T01:00:00Z' } as EventDoc);
    expect(zoned.regOpenEnabled).toBe(true);
    expect(zoned.regOpenDate).toBe('2026-10-19');
    expect(zoned.regOpenClock).toBe('09:00');

    const early = formStateFromEvent({ id: 'c', regOpenTime: '2026-10-19T00:30:00+08:00' } as EventDoc);
    expect(early.regOpenDate).toBe('2026-10-19');
    expect(early.regOpenClock).toBe('00:30');

    const dateOnly = formStateFromEvent({ id: 'd', regOpenTime: '2026-10-19' } as EventDoc);
    expect(dateOnly.regOpenEnabled).toBe(true);
    expect(dateOnly.regOpenDate).toBe('2026-10-19');
    expect(dateOnly.regOpenClock).toBe('00:00');

    const bad = formStateFromEvent({ id: 'e', regOpenTime: 'nope' } as EventDoc);
    expect(bad.regOpenEnabled).toBe(false);
    expect(bad.regOpenDate).toBe('');
    expect(bad.regOpenClock).toBe('');

    const english = formStateFromEvent({ id: 'f', regOpenTime: 'Oct 19, 2026' } as EventDoc);
    expect(english.regOpenEnabled).toBe(false);
    expect(english.regOpenDate).toBe('');
    expect(english.regOpenClock).toBe('');
  });
});

