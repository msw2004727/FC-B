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

afterEach(() => {
  cleanup();
});

const FIXED_NOW = new Date('2026-06-01T10:00:00');

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

