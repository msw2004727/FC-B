/**
 * `event-create.ts` 純函式與 Callable 邊界測試。
 *
 * 涵蓋：
 *   - buildCreateEventPayload：初始常數、id 格式、clientRequestId、缺 payloadRevision/Digest、
 *     isPublic、Date 型別、addons_use 檢查。
 *   - buildEditEventUpdates：不含統計 / 禁改欄位、status 四段規則、有報名時 max 改走 Callable。
 *   - changeEventCapacity：Callable 呼叫契約（mock `@/data/callables.callFn`）。
 *   - updateEventBasics：有報名 + max 變動時，會先 updateDoc 再呼叫 callFn。
 *
 * 時區無關策略：
 *   - `event-create.ts` 內 `buildStartEnd` 走本地時區；golden 內的 ISO 是 UTC 字串。
 *   - 比較時把兩邊都化為「同一個 YYYY-MM-DDTHH:mm 本地時間的毫秒數」，
 *     因此測試不依賴 `TZ` 環境變數。
 *   - `now` / `regOpenTime` 一律用 UTC 明確建構，避免跨日邊界。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/preact';

// ── Mock：@/data/callables ──────────────────────────

const { callFnMock } = vi.hoisted(() => ({ callFnMock: vi.fn() }));

vi.mock('@/data/callables', () => ({
  callFn: callFnMock,
  registerMock: vi.fn(),
  clearMocks: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}));

// ── Mock：firebase/firestore（updateEventBasics / createEvent 會動態 import）──

const { updateDocMock, txGetMock, txSetMock } = vi.hoisted(() => ({
  updateDocMock: vi.fn(),
  txGetMock: vi.fn(),
  txSetMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, coll: string, id: string) => ({ path: `${coll}/${id}` })),
  updateDoc: updateDocMock,
  runTransaction: vi.fn(async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ get: txGetMock, set: txSetMock })),
  serverTimestamp: vi.fn(() => '__SERVER_TIMESTAMP__'),
}));

// ── Mock：@/data/firebase（避免真的取 Firebase instance）──

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { kind: 'db' } })),
}));

const coverMocks = vi.hoisted(() => ({
  uploadEventImageVariants: vi.fn(),
  uploadImageDataUrl: vi.fn(),
}));

vi.mock('@/features/events/data/event-cover-upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./event-cover-upload')>();
  return {
    ...actual,
    uploadEventImageVariants: coverMocks.uploadEventImageVariants,
    uploadImageDataUrl: coverMocks.uploadImageDataUrl,
  };
});

// ── 受測模組（mock 已套用）──

import {
  ADDON_UPSELL_MESSAGE,
  applyAddonGate,
  buildCreateEventPayload,
  buildEditEventUpdates,
  changeEventCapacity,
  createEvent,
  createEventsBatch,
  newEventId,
  updateEventBasics,
  EventCreateError,
  type CreateEventContext,
  type CreateEventForm,
  type EventForEdit,
} from '@/features/events/data/event-create';
import goldenData from './__fixtures__/event-create-golden.json';
import { DEFAULT_EVENT_COVER_URL } from './event-cover-upload';
import {
  canManageAllActivities,
  hasActivityManageEntry,
  type OperateContext,
} from './operate-permissions';

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  coverMocks.uploadEventImageVariants.mockReset();
  coverMocks.uploadEventImageVariants.mockImplementation(
    async (_id: string, variants: CreateEventForm['imageVariants']) => variants,
  );
  coverMocks.uploadImageDataUrl.mockReset();
  coverMocks.uploadImageDataUrl.mockResolvedValue('https://example.com/uploaded.webp');
});

afterEach(() => {
  cleanup();
});

import {
  buildMultiDateForms,
  calcRegOpenForDate,
  createDefaultFormState,
  toCreateEventForm,
  validateEventForm,
} from './event-form-model';

// ASSUMPTION: 未提供 event-form-model.test.ts 原文，純函式案例集中於本檔，保留未知既有測試。
describe('卡 3B：相對報名與多日期驗證', () => {
  function validState() {
    return {
      ...createDefaultFormState(),
      title: '多日足球',
      location: '球場',
      sportTag: 'football',
      dateVal: '2030-05-10',
    };
  }

  it('相對欄位預設為 0', () => {
    expect(createDefaultFormState()).toMatchObject({ regRelDays: '0', regRelHours: '0' });
  });

  it('跨日、跨月、跨年與閏日依本地時間計算', () => {
    expect(calcRegOpenForDate('2030-05-10', '01:30', 1, 2)).toBe('2030-05-08T23:30');
    expect(calcRegOpenForDate('2030-03-01', '14:00', 1, 0)).toBe('2030-02-28T14:00');
    expect(calcRegOpenForDate('2030-01-01', '00:30', 0, 1)).toBe('2029-12-31T23:30');
    expect(calcRegOpenForDate('2032-03-01', '14:00', 1, 0)).toBe('2032-02-29T14:00');
  });

  it('0、非法日期、非法時間及超範圍回 null', () => {
    expect(calcRegOpenForDate('2030-05-10', '14:00', 0, 0)).toBeNull();
    expect(calcRegOpenForDate('invalid', '14:00', 1, 0)).toBeNull();
    expect(calcRegOpenForDate('2030-02-30', '14:00', 1, 0)).toBeNull();
    expect(calcRegOpenForDate('2030-05-10', '24:00', 1, 0)).toBeNull();
    expect(calcRegOpenForDate('2030-05-10', '14:00', 31, 0)).toBeNull();
    expect(calcRegOpenForDate('2030-05-10', '14:00', 0, 24)).toBeNull();
  });

  it('組裝只替換 dateVal 與 regOpenTime，不修改 base', () => {
    const state = { ...validState(), regOpenEnabled: true, regRelDays: '1', regRelHours: '2' };
    const base = toCreateEventForm(state, '教練');
    const dates = ['2030-05-10', '2030-05-12'];
    const forms = buildMultiDateForms(base, dates, state);
    expect(forms).toEqual(dates.map(dateVal => ({
      ...base,
      dateVal,
      regOpenTime: `${dateVal === '2030-05-10' ? '2030-05-09' : '2030-05-11'}T12:00`,
    })));
    expect(base.dateVal).toBe('2030-05-10');
    expect(base.regOpenTime).toBeNull();
    expect(buildMultiDateForms(base, dates, { ...state, regOpenEnabled: false })
      .every(form => form.regOpenTime === null)).toBe(true);
  });

  it('多日期跳過絕對時間完整性，早鳥要求相對開放時間', () => {
    // 測試同步更新：照 A（驗證）。
    const state = {
      ...validState(),
      dateVal: '',
      regOpenEnabled: true,
      earlyBirdEnabled: true,
    };
    const now = new Date('2030-05-01T12:00');
    const options = { dates: ['2030-05-10', '2030-05-12'] };
    expect(validateEventForm(state, now, options)).toEqual({
      ok: false,
      message: '早鳥報名需先設定活動開始前的開放報名時間',
    });
    expect(validateEventForm({ ...state, regRelDays: '1' }, now, options)).toEqual({ ok: true });
    expect(validateEventForm({ ...state, regRelHours: '1' }, now, options)).toEqual({ ok: true });
    expect(validateEventForm({
      ...state, regRelDays: '1', regOpenEnabled: false,
    }, now, options)).toEqual({
      ok: false,
      message: '早鳥報名需先設定活動開始前的開放報名時間',
    });
    expect(validateEventForm(state, now, { ...options, canUseAddons: false })).toEqual({ ok: true });
  });

  it('每一場都檢查開始時間，不能只驗第一場', () => {
    const state = { ...validState(), dateVal: '' };
    expect(validateEventForm(state, new Date('2030-05-01T12:00'), {
      dates: ['2030-05-10', '2030-04-30'],
    })).toEqual({ ok: false, messageKey: 'events.form.error.startInPast' });
  });

  it('單日期及編輯維持絕對時間驗證', () => {
    const state = { ...validState(), regOpenEnabled: true };
    const now = new Date('2030-05-01T12:00');
    expect(validateEventForm(state, now)).toEqual({
      ok: false, messageKey: 'events.form.error.regOpenIncomplete',
    });
    expect(validateEventForm({ ...state, eventId: 'ce_existing' }, now, {
      dates: ['2030-05-10', '2030-05-12'],
    })).toEqual({ ok: false, messageKey: 'events.form.error.regOpenIncomplete' });
  });
});

describe('卡 3B：createEventsBatch', () => {
  function batchContext(): CreateEventContext {
    return {
      uid: 'batch-owner',
      role: 'super_admin',
      capabilities: [],
      rolePermissions: null,
      userGrants: null,
      now: new Date('2030-05-01T00:00'),
      generateId: vi.fn(() => 'ce_unused'),
    };
  }

  function batchForms(count = 2): CreateEventForm[] {
    const state = {
      ...createDefaultFormState(),
      title: '多日足球',
      location: '球場',
      sportTag: 'football',
      regOpenEnabled: true,
      regRelDays: '1',
      teamSplitEnabled: true,
      teamSplitMode: 'self-select' as const,
      teamSplitLockHours: 2,
    };
    const dates = Array.from({ length: count }, (_, index) =>
      `2030-05-${String(index + 1).padStart(2, '0')}`);
    return buildMultiDateForms(toCreateEventForm(state, '教練'), dates, state);
  }

  function batchIds(count = 2): string[] {
    return Array.from({ length: count }, (_, index) => `ce_batch_${index}`);
  }

  function writtenPayload(index: number): Record<string, unknown> {
    const value: unknown = txSetMock.mock.calls[index]?.[1];
    if (!value || typeof value !== 'object') throw new Error('缺少寫入 payload');
    return value as Record<string, unknown>;
  }

  beforeEach(() => {
    txGetMock.mockReset();
    txSetMock.mockReset();
    txGetMock.mockResolvedValue({ exists: () => false });
  });

  it.each([2, 30])('%i 場只用一次 transaction，先全部 get 才全部 set', async count => {
    const { runTransaction } = await import('firebase/firestore');
    vi.mocked(runTransaction).mockClear();
    const forms = batchForms(count);
    const ids = batchIds(count);
    const result = await createEventsBatch(forms, batchContext(), ids, 'batch_fixed');
    expect(result).toEqual({ eventIds: ids, alreadyExisted: false, addonsStripped: false });
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(txGetMock).toHaveBeenCalledTimes(count);
    expect(txSetMock).toHaveBeenCalledTimes(count);
    const getOrder = txGetMock.mock.invocationCallOrder;
    const setOrder = txSetMock.mock.invocationCallOrder;
    expect(Math.max(...getOrder)).toBeLessThan(Math.min(...setOrder));
    forms.forEach((form, index) => {
      const id = ids[index];
      const payload = writtenPayload(index);
      expect(txSetMock.mock.calls[index]?.[0]).toEqual({ path: `events/${id}` });
      expect(payload).toMatchObject({
        id,
        clientRequestId: id,
        creatorUid: 'batch-owner',
        batchGroupId: 'batch_fixed',
        date: `${form.dateVal.replace(/-/g, '/')} 14:00~16:00`,
        startTimestamp: new Date(`${form.dateVal}T14:00`),
        endTimestamp: new Date(`${form.dateVal}T16:00`),
        regOpenTime: form.regOpenTime,
        status: index === 0 ? 'open' : 'upcoming',
        teamSplit: { lockAt: new Date(`${form.dateVal}T12:00`) },
        createdAt: '__SERVER_TIMESTAMP__',
        updatedAt: '__SERVER_TIMESTAMP__',
      });
      expect(payload).not.toHaveProperty('payloadRevision');
      expect(payload).not.toHaveProperty('payloadDigest');
    });
    expect(writtenPayload(0).teamSplit).not.toEqual(writtenPayload(1).teamSplit);
  });

  it.each([0, 1, 31])('拒絕 %i 場且沒有上傳或寫入', async count => {
    await expect(createEventsBatch(batchForms(count), batchContext(), batchIds(count), 'batch_fixed'))
      .rejects.toMatchObject({ code: 'BATCH_SIZE_INVALID' });
    expect(coverMocks.uploadEventImageVariants).not.toHaveBeenCalled();
    expect(txGetMock).not.toHaveBeenCalled();
    expect(txSetMock).not.toHaveBeenCalled();
  });

  it('拒絕長度不符、重複 ID、非法 ID、空 UID 與空批次 ID', async () => {
    await expect(createEventsBatch(batchForms(), batchContext(), ['ce_one'], 'batch_fixed'))
      .rejects.toMatchObject({ code: 'BATCH_SIZE_INVALID' });
    await expect(createEventsBatch(batchForms(), batchContext(), ['ce_same', 'ce_same'], 'batch_fixed'))
      .rejects.toMatchObject({ code: 'ID_TAKEN' });
    await expect(createEventsBatch(batchForms(), batchContext(), ['bad', 'ce_valid'], 'batch_fixed'))
      .rejects.toMatchObject({ code: 'INVALID_ID' });
    await expect(createEventsBatch(batchForms(), { ...batchContext(), uid: '' }, batchIds(), 'batch_fixed'))
      .rejects.toMatchObject({ code: 'CREATOR_UID_REQUIRED' });
    await expect(createEventsBatch(batchForms(), batchContext(), batchIds(), ''))
      .rejects.toMatchObject({ code: 'BATCH_GROUP_INVALID' });
    expect(coverMocks.uploadEventImageVariants).not.toHaveBeenCalled();
    expect(txSetMock).not.toHaveBeenCalled();
  });

  // 測試同步更新（Codex 第 3 段第二審 P1）：重送冪等改為「識別欄位＋建立內容」都相同才算成功。
  function existingBatchDocs(ctx: ReturnType<typeof batchContext>, mutate?: (doc: Record<string, unknown>, index: number) => void) {
    const forms = batchForms();
    const ids = batchIds();
    return async (ref: { path: string }) => {
      const id = ref.path.slice('events/'.length);
      const index = ids.indexOf(id);
      const doc: Record<string, unknown> = {
        ...(buildCreateEventPayload(forms[index]!, ctx, id) as unknown as Record<string, unknown>),
        batchGroupId: 'batch_fixed',
        // 建立後才會變的欄位不參與比對。
        image: 'https://example.test/uploaded.png',
        current: 3,
        status: 'full',
      };
      mutate?.(doc, index);
      return { exists: () => true, data: () => doc };
    };
  }

  it('全部相符的重送視為成功，不寫入、不另產生 ID', async () => {
    const ctx = batchContext();
    txGetMock.mockImplementation(existingBatchDocs(ctx));
    expect(await createEventsBatch(batchForms(), ctx, batchIds(), 'batch_fixed'))
      .toMatchObject({ alreadyExisted: true, eventIds: batchIds() });
    expect(txSetMock).not.toHaveBeenCalled();
    expect(ctx.generateId).not.toHaveBeenCalled();
  });

  it('已建立但重送時內容改過（標題）→ CONTENT_CONFLICT，不寫入', async () => {
    const ctx = batchContext();
    txGetMock.mockImplementation(existingBatchDocs(ctx, (doc, index) => {
      if (index === 1) doc.title = '先前送出的標題';
    }));
    await expect(createEventsBatch(batchForms(), ctx, batchIds(), 'batch_fixed'))
      .rejects.toMatchObject({ code: 'CONTENT_CONFLICT' });
    expect(txSetMock).not.toHaveBeenCalled();
  });

  it.each([0, 1])('部分存在（第 %i 筆存在）一筆都不寫', async existingIndex => {
    batchIds().forEach((id, index) => {
      txGetMock.mockResolvedValueOnce({
        exists: () => index === existingIndex,
        data: () => ({
          id, clientRequestId: id, creatorUid: 'batch-owner', batchGroupId: 'batch_fixed',
        }),
      });
    });
    await expect(createEventsBatch(batchForms(), batchContext(), batchIds(), 'batch_fixed'))
      .rejects.toMatchObject({ code: 'ID_TAKEN' });
    expect(txGetMock).toHaveBeenCalledTimes(2);
    expect(txSetMock).not.toHaveBeenCalled();
  });

  it.each(['id', 'creatorUid', 'clientRequestId', 'batchGroupId'])('%s 不符一筆都不寫', async field => {
    txGetMock.mockImplementation(async (ref: { path: string }) => {
      const id = ref.path.slice('events/'.length);
      return {
        exists: () => true,
        data: () => ({
          id, clientRequestId: id, creatorUid: 'batch-owner', batchGroupId: 'batch_fixed',
          [field]: 'different',
        }),
      };
    });
    await expect(createEventsBatch(batchForms(), batchContext(), batchIds(), 'batch_fixed'))
      .rejects.toMatchObject({ code: 'ID_TAKEN' });
    expect(txSetMock).not.toHaveBeenCalled();
  });

  it('封面 variants 逐場傳入自己的 ID，完成後才開始 transaction', async () => {
    coverMocks.uploadEventImageVariants.mockImplementation(async (id: string) => ({
      cover: `https://example.com/events/${id}_cover`,
      homeNext: `https://example.com/events/${id}_homeNext`,
    }));
    const forms = batchForms().map(form => ({
      ...form,
      image: '',
      imageVariants: { cover: 'data:image/webp;base64,cover', homeNext: 'data:image/webp;base64,next' },
    }));
    await createEventsBatch(forms, batchContext(), batchIds(), 'batch_fixed');
    batchIds().forEach((id, index) => {
      expect(coverMocks.uploadEventImageVariants).toHaveBeenNthCalledWith(index + 1, id, forms[index]?.imageVariants);
      expect(writtenPayload(index)).toMatchObject({
        image: `https://example.com/events/${id}_cover`,
        imageVariants: {
          cover: `https://example.com/events/${id}_cover`,
          homeNext: `https://example.com/events/${id}_homeNext`,
        },
      });
    });
    expect(coverMocks.uploadImageDataUrl).not.toHaveBeenCalled();
    expect(Math.max(...coverMocks.uploadEventImageVariants.mock.invocationCallOrder))
      .toBeLessThan(Math.min(...txGetMock.mock.invocationCallOrder));
  });

  it('無 variants 的 data URL 沿用單場上傳函式與各自路徑', async () => {
    const forms = batchForms().map(form => ({ ...form, image: 'data:image/png;base64,cover' }));
    await createEventsBatch(forms, batchContext(), batchIds(), 'batch_fixed');
    batchIds().forEach((id, index) => {
      expect(coverMocks.uploadImageDataUrl).toHaveBeenNthCalledWith(
        index + 1, 'data:image/png;base64,cover', `events/${id}`,
      );
    });
  });

  it('封面失敗不進 transaction，重試可以成功', async () => {
    coverMocks.uploadEventImageVariants.mockRejectedValueOnce(new Error('upload failed'));
    await expect(createEventsBatch(batchForms(), batchContext(), batchIds(), 'batch_fixed'))
      .rejects.toThrow('upload failed');
    expect(txGetMock).not.toHaveBeenCalled();
    expect(txSetMock).not.toHaveBeenCalled();
    await expect(createEventsBatch(batchForms(), batchContext(), batchIds(), 'batch_fixed'))
      .resolves.toMatchObject({ alreadyExisted: false });
    expect(txSetMock).toHaveBeenCalledTimes(2);
  });

  it('沒有建立權限時不先上傳', async () => {
    await expect(createEventsBatch(
      batchForms(),
      { ...batchContext(), role: 'user', capabilities: [] },
      batchIds(),
      'batch_fixed',
    )).rejects.toBeInstanceOf(EventCreateError);
    expect(coverMocks.uploadEventImageVariants).not.toHaveBeenCalled();
    expect(txSetMock).not.toHaveBeenCalled();
  });

  it('沿用加值權限清除並回傳 addonsStripped', async () => {
    const ctx = {
      ...batchContext(),
      role: 'user',
      capabilities: ['user.activity.basic_create'],
    };
    await expect(createEventsBatch(batchForms(), ctx, batchIds(), 'batch_fixed'))
      .resolves.toMatchObject({ addonsStripped: true });
    expect(writtenPayload(0)).not.toHaveProperty('teamSplit');
    expect(writtenPayload(1)).not.toHaveProperty('teamSplit');
  });
});

// ── 測試輔助 ─────────────────────────────────────────

/**
 * 把 golden 內 UTC ISO 字串視作「本地時間」解析，與 `buildStartEnd` 行為一致。
 * 例：golden `2026-05-15T15:00:00.000Z` → `new Date('2026-05-15T15:00')` 的毫秒。
 */
function goldenTimestampToLocalMs(isoString: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/i.exec(isoString);
  if (!m) return new Date(isoString).getTime();
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`).getTime();
}

/** 把 golden 物件內已知的 Date 欄位轉為與 payload 同基準的毫秒數。 */
function hydrateGoldenDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hydrateGoldenDates);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof v === 'string' &&
        (key === 'startTimestamp' || key === 'endTimestamp' || key === 'lockAt')
      ) {
        out[key] = goldenTimestampToLocalMs(v);
      } else {
        out[key] = hydrateGoldenDates(v);
      }
    }
    return out;
  }
  return value;
}

/** 把 payload 內 Date 轉為毫秒；其餘遞迴；鍵以字母序輸出以便 golden 比對。 */
function serializeForGolden(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(serializeForGolden);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = serializeForGolden((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function expectMatchesGolden(actual: unknown, goldenExpected: unknown): void {
  expect(serializeForGolden(actual)).toEqual(hydrateGoldenDates(goldenExpected));
}

function buildForm(overrides: Partial<CreateEventForm> = {}): CreateEventForm {
  return {
    title: '週末練球',
    type: 'friendly',
    location: '台北市大安運動中心',
    dateVal: '2026-05-15',
    startTime: '15:00',
    endTime: '17:00',
    max: 20,
    minAge: 0,
    notes: '',
    sportTag: 'basketball',
    regOpenTime: null,
    image: 'https://example.com/cover.jpg',
    creatorName: '小明',
    delegates: [],
    regionEnabled: false,
    region: '',
    cities: [],
    feeEnabled: false,
    fee: 0,
    teamOnly: false,
    creatorTeamId: null,
    creatorTeamName: null,
    creatorTeamIds: [],
    creatorTeamNames: [],
    genderRestrictionEnabled: false,
    allowedGender: '',
    privateEvent: false,
    socialLinksEnabled: false,
    socialLinks: [],
    earlyBirdEnabled: false,
    earlyBirdCost: 0,
    earlyBirdPolicyVersion: null,
    ...overrides,
  };
}

function buildCtx(overrides: Partial<CreateEventContext> = {}): CreateEventContext {
  return {
    uid: 'uid_user_golden',
    role: 'user',
    capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    rolePermissions: null,
    userGrants: null,
    customRoles: [],
    now: new Date('2026-05-01T00:00:00.000Z'),
    generateId: () => 'ce_golden_user_basic',
    ...overrides,
  };
}

// ── buildCreateEventPayload ───────────────────────────

describe('buildCreateEventPayload', () => {
  it('一般 user 建立：與 golden 一致', () => {
    const payload = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expectMatchesGolden(payload, goldenData.createUserBasic.payload);
  });

  it('coach 建立：與 golden 一致', () => {
    const form = buildForm({ title: '教練帶練', creatorName: '王教練' });
    const ctx = buildCtx({ uid: 'uid_coach_golden', role: 'coach' });
    const payload = buildCreateEventPayload(form, ctx, 'ce_golden_coach');
    expectMatchesGolden(payload, goldenData.createCoach.payload);
  });

  it('admin 建立：與 golden 一致', () => {
    const form = buildForm({ title: '全站活動', creatorName: '李管理員' });
    const ctx = buildCtx({ uid: 'uid_admin_golden', role: 'admin' });
    const payload = buildCreateEventPayload(form, ctx, 'ce_golden_admin');
    expectMatchesGolden(payload, goldenData.createAdmin.payload);
  });

  it('user 有 addons_use 帶 fee + private：與 golden 一致', () => {
    const form = buildForm({
      title: '收費私密練球',
      creatorName: '陳收費',
      feeEnabled: true,
      fee: 100,
      privateEvent: true,
    });
    const ctx = buildCtx({
      uid: 'uid_user_addons_golden',
      capabilities: ['user.activity.basic_create', 'user.activity.addons_use'],
    });
    const payload = buildCreateEventPayload(form, ctx, 'ce_golden_user_addons');
    expectMatchesGolden(payload, goldenData.createUserWithAddons.payload);
  });

  it('Date 型別：startTimestamp / endTimestamp 為 Date 實例', () => {
    const payload = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect(payload.startTimestamp).toBeInstanceOf(Date);
    expect(payload.endTimestamp).toBeInstanceOf(Date);
  });

  it('start / end 走本地時區（不依賴執行環境 TZ）', () => {
    const payload = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    // 期望值也用同一種 local-time 解析，因此在任何 TZ 下都成立。
    expect(payload.startTimestamp.getTime()).toBe(
      new Date('2026-05-15T15:00').getTime(),
    );
    expect(payload.endTimestamp.getTime()).toBe(new Date('2026-05-15T17:00').getTime());
  });

  it('不寫 payloadRevision / payloadDigest', () => {
    const payload = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect('payloadRevision' in payload).toBe(false);
    expect('payloadDigest' in payload).toBe(false);
  });

  it('初始常數正確', () => {
    const payload = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect(payload.current).toBe(0);
    expect(payload.waitlist).toBe(0);
    expect(payload.participants).toEqual([]);
    expect(payload.waitlistNames).toEqual([]);
    expect(payload.contact).toBe('');
    expect(payload.icon).toBe('');
    expect(payload.countdown).toBe('即將開始');
  });

  it('isPublic === !!teamOnly', () => {
    const p1 = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect(p1.isPublic).toBe(false);

    const p2 = buildCreateEventPayload(
      buildForm({ teamOnly: true }),
      buildCtx({ role: 'admin', uid: 'uid_admin_golden' }),
      'ce_golden_admin',
    );
    expect(p2.teamOnly).toBe(true);
    expect(p2.isPublic).toBe(true);
  });

  it('status：regOpenTime 在未來 → upcoming', () => {
    const form = buildForm({ regOpenTime: '2026-06-01T00:00:00Z' });
    const payload = buildCreateEventPayload(form, buildCtx(), 'ce_golden_user_basic');
    expect(payload.status).toBe('upcoming');
  });

  it('status：regOpenTime 為 null → open', () => {
    const payload = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect(payload.status).toBe('open');
  });

  it('id 格式不符時擲出 INVALID_ID', () => {
    try {
      buildCreateEventPayload(buildForm(), buildCtx(), 'bad_id');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EventCreateError);
      expect((err as EventCreateError).code).toBe('INVALID_ID');
    }
  });

  it('無 basic_create 且無 event.create grant → 擲出 BASIC_CREATE_REQUIRED', () => {
    const ctx = buildCtx({ capabilities: [] });
    try {
      buildCreateEventPayload(buildForm(), ctx, 'ce_golden_user_basic');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EventCreateError);
      expect((err as EventCreateError).code).toBe('BASIC_CREATE_REQUIRED');
    }
  });

  it('addons 有內容但 user 缺 addons_use → 照 A 清掉加值欄位、照常建立（R-CAP-004）', () => {
    const form = buildForm({ privateEvent: true, feeEnabled: true, fee: 100 });
    const gate = applyAddonGate(form, buildCtx(), null);
    expect(gate.stripped).toBe(true);
    const payload = buildCreateEventPayload(form, buildCtx(), 'ce_golden_user_basic');
    expect(payload.privateEvent).toBe(false);
    expect(payload.feeEnabled).toBe(false);
    expect(payload.fee).toBe(0);
    expect(ADDON_UPSELL_MESSAGE).toBe('如需更多功能請聯繫官方Line@');
  });

  it('缺 addons_use 時 GPS 也一併關閉、座標寫 null（A gpsEnabled=false）', () => {
    const form = buildForm({
      mapPickerEnabled: true, gpsEnabled: true, lat: 25.03, lng: 121.56,
      mapAddress: '台北', mapProvider: 'google', mapLocationConfirmed: true,
    });
    const payload = buildCreateEventPayload(form, buildCtx(), 'ce_golden_user_basic');
    expect(payload.gpsEnabled).toBe(false);
    expect(payload.lat).toBeNull();
    expect(payload.lng).toBeNull();
    expect(payload.mapAddress).toBeNull();
    expect(payload.mapLocationConfirmed).toBe(false);
  });

  it('沒有委託人管理權的 user 建立 → delegates 寫空（A _canManageEventDelegates(null)）', () => {
    const form = buildForm({ delegates: [{ uid: 'uid_d', name: '小華' }] });
    const payload = buildCreateEventPayload(form, buildCtx(), 'ce_golden_user_basic');
    expect(payload.delegates).toEqual([]);
    expect(payload.delegateUids).toEqual([]);
    const withAssign = buildCtx({
      capabilities: ['user.activity.basic_create', 'user.activity.delegate_assign'],
    });
    expect(buildCreateEventPayload(form, withAssign, 'ce_golden_user_basic').delegateUids)
      .toEqual(['uid_d']);
  });

  it('gradient 由 type 推導（A GRADIENT_MAP），不吃表單', () => {
    const payload = buildCreateEventPayload(buildForm({ type: 'camp' }), buildCtx(), 'ce_golden_user_basic');
    expect(payload.gradient).toBe('linear-gradient(135deg,#ec4899,#be185d)');
  });

  it('分隊：寫入 teams、balanceCap、selfSelectLockHours，lockAt＝開始前 N 小時', () => {
    const ctx = buildCtx({
      capabilities: ['user.activity.basic_create', 'user.activity.addons_use'],
    });
    const teams = [
      { key: 'A', color: '#EF4444', name: '紅隊' },
      { key: 'B', color: '#3B82F6', name: '藍隊' },
    ];
    const form = buildForm({
      teamSplit: { enabled: true, mode: 'self-select', balanceCap: true, selfSelectLockHours: 3, teams },
    });
    const payload = buildCreateEventPayload(form, ctx, 'ce_golden_user_basic');
    expect(payload.teamSplit).toEqual({
      enabled: true,
      mode: 'self-select',
      balanceCap: true,
      selfSelectLockHours: 3,
      teams,
      lockAt: new Date(new Date('2026-05-15T15:00').getTime() - 3 * 3_600_000),
    });
  });
});

// ── buildEditEventUpdates ─────────────────────────────

describe('buildEditEventUpdates', () => {
  const existing = (overrides: Partial<EventForEdit> = {}): EventForEdit => ({
    id: 'ce_golden_user_basic',
    creatorUid: 'uid_user_golden',
    privateEvent: false,
    delegateUids: [],
    status: 'open',
    current: 0,
    waitlist: 0,
    max: 20,
    ...overrides,
  });

  function editForm(overrides: Partial<CreateEventForm> = {}): CreateEventForm {
    return buildForm({ title: '週末練球（已更新）', ...overrides });
  }

  function ownCtx(): CreateEventContext {
    return buildCtx({
      capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    });
  }

  function coachCtx(): CreateEventContext {
    return buildCtx({
      uid: 'uid_user_golden',
      role: 'coach',
      capabilities: [],
    });
  }

  it('owner 基本編輯：與 golden 一致', () => {
    const result = buildEditEventUpdates(existing(), editForm(), ownCtx());
    expectMatchesGolden(result.updates, goldenData.editOwnerBasic.updates);
    expect(result.capacityChange).toBeNull();
  });

  it('不含 6 個 Rules 禁改欄位', () => {
    const result = buildEditEventUpdates(existing(), editForm(), ownCtx());
    for (const forbidden of [
      'viewCount',
      'id',
      'clientRequestId',
      'creatorUid',
      'payloadRevision',
      'payloadDigest',
    ]) {
      expect(forbidden in result.updates).toBe(false);
    }
  });

  it('不含統計欄位（current / waitlist / participants / waitlistNames / realCurrent / *_WithUid）', () => {
    const result = buildEditEventUpdates(existing(), editForm(), ownCtx());
    for (const stat of [
      'current',
      'waitlist',
      'participants',
      'waitlistNames',
      'realCurrent',
      'participantsWithUid',
      'waitlistWithUid',
    ]) {
      expect(stat in result.updates).toBe(false);
    }
  });

  it('current=0 且 max 未改 → max 名額寫入 updates，capacityChange=null', () => {
    const result = buildEditEventUpdates(existing(), editForm({ max: 20 }), ownCtx());
    expect(result.updates.max).toBe(20);
    expect(result.capacityChange).toBeNull();
  });

  it('current > 0 且 max 有改 → updates 不含 max，capacityChange = newMax', () => {
    const result = buildEditEventUpdates(
      existing({ current: 5 }),
      editForm({ max: 30 }),
      ownCtx(),
    );
    expect('max' in result.updates).toBe(false);
    expect(result.capacityChange).toBe(30);
  });

  it('current > 0 但 max 未改 → capacityChange=null', () => {
    const result = buildEditEventUpdates(
      existing({ current: 5 }),
      editForm({ max: 20 }),
      ownCtx(),
    );
    expect('max' in result.updates).toBe(false);
    expect(result.capacityChange).toBeNull();
  });

  it('waitlist > 0 且 max 有改 → capacityChange = newMax', () => {
    const result = buildEditEventUpdates(
      existing({ waitlist: 2 }),
      editForm({ max: 25 }),
      ownCtx(),
    );
    expect('max' in result.updates).toBe(false);
    expect(result.capacityChange).toBe(25);
  });

  // ── status 四段規則 ───────────────────────────────
  // 1) user 無管理入口 → 不寫 status（既有測試）
  // 2) 有管理入口 + regOpenTime 未來 → upcoming
  // 3) 有管理入口 + regOpenTime 已過 + existing upcoming + 未滿 → open
  // 4) 有管理入口 + regOpenTime 已過 + existing upcoming + 已滿 → full
  // 5) 有管理入口 + existing ended / cancelled → 不寫
  // 6) 有管理入口 + regOpenTime 已過 + existing open → 不寫

  it('status 規則 A：user 無管理入口 → 不寫 status', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'open' }),
      editForm({ regOpenTime: '2026-06-01T00:00:00Z' }),
      ownCtx(),
    );
    expect(result.updates.status).toBeUndefined();
  });

  it('status 規則 B：coach 有管理入口 + regOpenTime 未來 → upcoming', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'open' }),
      editForm({ regOpenTime: '2026-06-01T00:00:00Z' }),
      coachCtx(),
    );
    expect(result.updates.status).toBe('upcoming');
  });

  it('status 規則 C：regOpenTime 已過 + existing upcoming + 未滿 → open', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'upcoming', current: 5, max: 20 }),
      editForm({ regOpenTime: '2026-04-01T00:00:00Z' }),
      coachCtx(),
    );
    expect(result.updates.status).toBe('open');
  });

  it('status 規則 D：regOpenTime 已過 + existing upcoming + 已滿 → full', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'upcoming', current: 20, max: 20 }),
      editForm({ regOpenTime: '2026-04-01T00:00:00Z' }),
      coachCtx(),
    );
    expect(result.updates.status).toBe('full');
  });

  it('status 規則 E：existing ended → 不寫 status（即使 regOpenTime 未來）', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'ended' }),
      editForm({ regOpenTime: '2026-06-01T00:00:00Z' }),
      coachCtx(),
    );
    expect(result.updates.status).toBeUndefined();
  });

  it('status 規則 F：existing cancelled → 不寫 status', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'cancelled' }),
      editForm({ regOpenTime: '2026-06-01T00:00:00Z' }),
      coachCtx(),
    );
    expect(result.updates.status).toBeUndefined();
  });

  it('status 規則 G：regOpenTime 已過 + existing open → 不寫 status', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'open' }),
      editForm({ regOpenTime: '2026-04-01T00:00:00Z' }),
      coachCtx(),
    );
    expect(result.updates.status).toBeUndefined();
  });

  it('限定俱樂部：有 event.edit_all 才寫 teamOnly／creatorTeam*（A 編輯分支）', () => {
    const form = editForm({
      teamOnly: true, creatorTeamId: 'tm_1', creatorTeamName: '甲隊',
      creatorTeamIds: ['tm_1'], creatorTeamNames: ['甲隊'],
    });
    const admin = buildCtx({ role: 'admin', capabilities: [], rolePermissions: ['event.edit_all'] });
    const adminResult = buildEditEventUpdates(existing({ creatorUid: 'uid_other' }), form, admin);
    expect(adminResult.updates.teamOnly).toBe(true);
    expect(adminResult.updates.creatorTeamIds).toEqual(['tm_1']);

    const coach = buildCtx({ role: 'coach', capabilities: [], rolePermissions: [] });
    const coachResult = buildEditEventUpdates(existing(), form, coach);
    expect('teamOnly' in coachResult.updates).toBe(false);
    expect('creatorTeamId' in coachResult.updates).toBe(false);
  });

  it('編輯：user 缺 addons_use 勾私密 → addonsStripped，updates 不含加值欄位', () => {
    const result = buildEditEventUpdates(existing(), editForm({ privateEvent: true }), ownCtx());
    expect(result.addonsStripped).toBe(true);
    expect('privateEvent' in result.updates).toBe(false);
    expect('feeEnabled' in result.updates).toBe(false);
  });

  it('EDIT_NOT_ALLOWED：非 owner 且無可編輯授權 → 擲出', () => {
    const stranger = buildCtx({
      uid: 'uid_stranger',
      capabilities: [],
      role: 'user',
    });
    try {
      buildEditEventUpdates(existing(), editForm(), stranger);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EventCreateError);
      expect((err as EventCreateError).code).toBe('EDIT_NOT_ALLOWED');
    }
  });

  it('T-013 修補：preserve 指定的群組不寫入（教練編輯不覆寫既有加值／委託人／封面）', () => {
    const admin = buildCtx({ role: 'admin', capabilities: [], rolePermissions: ['event.edit_all'] });
    const base = buildEditEventUpdates(existing(), editForm(), coachCtx());
    expect('privateEvent' in base.updates).toBe(true);
    expect('image' in base.updates).toBe(true);
    expect('delegates' in base.updates).toBe(true);

    for (const ctx of [coachCtx(), admin]) {
      const result = buildEditEventUpdates(existing(), editForm(), ctx, {
        addons: true,
        delegates: true,
        image: true,
      });
      for (const field of [
        'feeEnabled', 'fee', 'genderRestrictionEnabled', 'allowedGender', 'privateEvent',
        'socialLinksEnabled', 'socialLinks', 'earlyBirdEnabled', 'earlyBirdCost',
        'earlyBirdPolicyVersion', 'teamSplit', 'gpsEnabled', 'lat', 'lng', 'teamOnly',
        'creatorTeamId', 'creatorTeamName', 'creatorTeamIds', 'creatorTeamNames',
        'delegates', 'delegateUids', 'image', 'imageVariants',
      ]) {
        expect(field in result.updates).toBe(false);
      }
      expect(result.updates.title).toBe('週末練球（已更新）');
      expect(result.updates.notes).toBeDefined();
    }
  });
});

describe('1C-3：照 A 的封面 I/O 與資料修正', () => {
  const existing: EventForEdit = {
    id: 'ce_public',
    docId: 'legacy-document-id',
    creatorUid: 'uid_user_golden',
    status: 'open',
    current: 0,
    waitlist: 0,
    max: 20,
  };

  beforeEach(() => {
    txGetMock.mockReset();
    txGetMock.mockResolvedValue({ exists: () => false });
    txSetMock.mockReset();
    updateDocMock.mockReset();
    updateDocMock.mockResolvedValue(undefined);
  });

  it('建立保留既有封面，Storage 在 transaction 之前完成', async () => {
    const result = await createEvent(buildForm(), buildCtx(), 'ce_public');
    expect(result.payload.image).toBe('https://example.com/cover.jpg');
    expect(coverMocks.uploadImageDataUrl).not.toHaveBeenCalled();
    expect(coverMocks.uploadEventImageVariants).toHaveBeenCalledWith('ce_public', undefined);
    expect(coverMocks.uploadEventImageVariants.mock.invocationCallOrder[0]!)
      .toBeLessThan(txGetMock.mock.invocationCallOrder[0]!);
  });

  it('建立無封面時寫固定預設封面', async () => {
    // 測試同步更新：照 A（1C-3），建立流程會補預設封面。
    const result = await createEvent(buildForm({ image: '  ' }), buildCtx(), 'ce_public');
    expect(result.payload.image).toBe(DEFAULT_EVENT_COVER_URL);
    expect(result.payload).not.toHaveProperty('imageVariants');
    expect(txSetMock.mock.calls[0]?.[1]).toMatchObject({ image: DEFAULT_EVENT_COVER_URL });
  });

  it('建立採用成功的 cover，不再重複上傳 data 主圖', async () => {
    const variants = { cover: 'data:image/webp;base64,COVER', homeNext: 'data:image/webp;base64,NEXT' };
    coverMocks.uploadEventImageVariants.mockResolvedValue({
      cover: 'https://example.com/cover-new',
      homeNext: 'https://example.com/next-new',
    });
    const result = await createEvent(
      buildForm({ image: variants.cover, imageVariants: variants }),
      buildCtx(),
      'ce_public',
    );
    expect(result.payload.image).toBe('https://example.com/cover-new');
    expect(result.payload.imageVariants).toEqual({
      cover: 'https://example.com/cover-new',
      homeNext: 'https://example.com/next-new',
    });
    expect(coverMocks.uploadImageDataUrl).not.toHaveBeenCalled();
  });

  it('variants 失敗 key 不寫回；只剩 homeNext 且主圖為空時採用它', async () => {
    coverMocks.uploadEventImageVariants.mockResolvedValue({ homeNext: 'https://example.com/next' });
    const result = await createEvent(buildForm({
      image: '',
      imageVariants: { cover: 'data:image/webp;base64,COVER', homeNext: 'data:image/webp;base64,NEXT' },
    }), buildCtx(), 'ce_public');
    expect(result.payload.imageVariants).toEqual({ homeNext: 'https://example.com/next' });
    expect(result.payload.image).toBe('https://example.com/next');
  });

  it('variants 全部失敗且主圖為空時不寫 variants，使用預設封面', async () => {
    coverMocks.uploadEventImageVariants.mockResolvedValue(undefined);
    const result = await createEvent(buildForm({
      image: '',
      imageVariants: { cover: 'data:image/webp;base64,COVER' },
    }), buildCtx(), 'ce_public');
    expect(result.payload).not.toHaveProperty('imageVariants');
    expect(result.payload.image).toBe(DEFAULT_EVENT_COVER_URL);
  });

  it('data 主圖使用 public id 上傳，失敗時建立使用預設封面', async () => {
    const image = 'data:image/png;base64,MAIN';
    const success = await createEvent(buildForm({ image }), buildCtx(), 'ce_public');
    expect(coverMocks.uploadImageDataUrl).toHaveBeenCalledWith(image, 'events/ce_public');
    expect(success.payload.image).toBe('https://example.com/uploaded.webp');
    expect(coverMocks.uploadImageDataUrl.mock.invocationCallOrder[0]!)
      .toBeLessThan(txGetMock.mock.invocationCallOrder[0]!);

    coverMocks.uploadImageDataUrl.mockResolvedValueOnce(null);
    const failed = await createEvent(buildForm({ image }), buildCtx(), 'ce_public');
    expect(failed.payload.image).toBe(DEFAULT_EVENT_COVER_URL);
  });

  it('建立上傳尚未完成時不開始 transaction', async () => {
    let finish: ((value: CreateEventForm['imageVariants']) => void) | undefined;
    coverMocks.uploadEventImageVariants.mockReturnValueOnce(
      new Promise<CreateEventForm['imageVariants']>((resolve) => { finish = resolve; }),
    );
    const pending = createEvent(buildForm(), buildCtx(), 'ce_public');
    expect(txGetMock).not.toHaveBeenCalled();
    finish?.(undefined);
    await pending;
    expect(txGetMock).toHaveBeenCalledTimes(1);
  });

  it('建立權限或 ID 不符時不做 Storage I/O', async () => {
    await expect(createEvent(buildForm(), buildCtx({ capabilities: [] }), 'ce_public'))
      .rejects.toMatchObject({ code: 'BASIC_CREATE_REQUIRED' });
    await expect(createEvent(buildForm(), buildCtx(), 'invalid'))
      .rejects.toMatchObject({ code: 'INVALID_ID' });
    expect(coverMocks.uploadEventImageVariants).not.toHaveBeenCalled();
    expect(coverMocks.uploadImageDataUrl).not.toHaveBeenCalled();
    expect(txSetMock).not.toHaveBeenCalled();
  });

  it('編輯 preserve.image 完全不上傳且不寫 image／imageVariants', async () => {
    const result = await updateEventBasics(existing, buildForm({
      image: 'data:image/png;base64,MAIN',
      imageVariants: { cover: 'data:image/png;base64,COVER' },
    }), buildCtx(), { image: true });

    expect(coverMocks.uploadEventImageVariants).not.toHaveBeenCalled();
    expect(coverMocks.uploadImageDataUrl).not.toHaveBeenCalled();
    expect(result.updates).not.toHaveProperty('image');
    expect(result.updates).not.toHaveProperty('imageVariants');
    const written = updateDocMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(written).not.toHaveProperty('image');
    expect(written).not.toHaveProperty('imageVariants');
  });

  it('編輯主圖上傳用 public id；Firestore 寫 document id', async () => {
    await updateEventBasics(existing, buildForm({
      image: 'data:image/png;base64,MAIN',
    }), buildCtx());
    expect(coverMocks.uploadImageDataUrl).toHaveBeenCalledWith(
      'data:image/png;base64,MAIN',
      'events/ce_public',
    );
    expect(updateDocMock).toHaveBeenCalledWith(
      { path: 'events/legacy-document-id' },
      expect.objectContaining({ image: 'https://example.com/uploaded.webp' }),
    );
    expect(coverMocks.uploadImageDataUrl.mock.invocationCallOrder[0]!)
      .toBeLessThan(updateDocMock.mock.invocationCallOrder[0]!);
  });

  it('編輯 variants 先上傳，成功 cover 取代 data 主圖', async () => {
    coverMocks.uploadEventImageVariants.mockResolvedValue({
      cover: 'https://example.com/edited-cover',
    });
    const result = await updateEventBasics(existing, buildForm({
      image: 'https://example.com/old',
      imageVariants: {
        cover: 'data:image/png;base64,COVER',
        homeNext: 'data:image/png;base64,NEXT',
      },
    }), buildCtx());
    expect(result.updates.image).toBe('https://example.com/edited-cover');
    expect(result.updates.imageVariants).toEqual({ cover: 'https://example.com/edited-cover' });
    expect(coverMocks.uploadImageDataUrl).not.toHaveBeenCalled();
    expect(coverMocks.uploadEventImageVariants.mock.invocationCallOrder[0]!)
      .toBeLessThan(updateDocMock.mock.invocationCallOrder[0]!);
  });

  it('編輯 variants 與主圖上傳均失敗時，不寫失敗欄位', async () => {
    coverMocks.uploadEventImageVariants.mockResolvedValue(undefined);
    coverMocks.uploadImageDataUrl.mockResolvedValue(null);
    const result = await updateEventBasics(existing, buildForm({
      image: 'https://example.com/old',
      imageVariants: { cover: 'data:image/png;base64,COVER' },
    }), buildCtx());
    expect(coverMocks.uploadImageDataUrl).toHaveBeenCalledWith(
      'data:image/png;base64,COVER',
      'events/ce_public',
    );
    expect(result.updates).not.toHaveProperty('image');
    expect(result.updates).not.toHaveProperty('imageVariants');
    expect(updateDocMock.mock.calls[0]?.[1]).not.toHaveProperty('image');
  });

  it('編輯空封面不套預設封面', async () => {
    const result = await updateEventBasics(existing, buildForm({ image: '' }), buildCtx());
    expect(result.updates.image).toBe('');
  });

  it('編輯拒絕授權時不上傳、不寫文件', async () => {
    await expect(updateEventBasics(
      existing,
      buildForm({ image: 'data:image/png;base64,MAIN' }),
      buildCtx({ uid: 'other', capabilities: [] }),
    )).rejects.toMatchObject({ code: 'EDIT_NOT_ALLOWED' });
    expect(coverMocks.uploadEventImageVariants).not.toHaveBeenCalled();
    expect(coverMocks.uploadImageDataUrl).not.toHaveBeenCalled();
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('只有 event.edit_all 的管理員，沒有管理入口仍可變更 status', () => {
    // 測試同步更新：照 A（1C-3），管理入口與 event.edit_all 為 OR。
    // PM 修正：admin 角色本身有管理入口（coach+ 後備），改用「一般 user＋個別授權 event.edit_all」才測得到只有 edit_all 的情況。
    const ctx = buildCtx({
      role: 'user',
      capabilities: ['user.activity.own_edit_basic'],
      userGrants: { uid: 'uid_user_golden', enabled: true, permissions: ['event.edit_all'] },
    });
    const opCtx: OperateContext = { ...ctx, customRoles: ctx.customRoles ?? [] };
    // B 的 hasActivityManageEntry 照 A 已含 event.edit_all，所以 OR 條件與原寫法等價；此測試只鎖住 edit_all 者可改 status。
    expect(canManageAllActivities(opCtx)).toBe(true);

    expect(buildEditEventUpdates(existing, buildForm({
      regOpenTime: '2026-06-01T00:00:00Z',
    }), ctx).updates.status).toBe('upcoming');
    expect(buildEditEventUpdates(
      { ...existing, status: 'upcoming' },
      buildForm(),
      ctx,
    ).updates.status).toBe('open');
    for (const status of ['ended', 'cancelled'] as const) {
      expect(buildEditEventUpdates(
        { ...existing, status },
        buildForm({ regOpenTime: '2026-06-01T00:00:00Z' }),
        ctx,
      ).updates).not.toHaveProperty('status');
    }
  });

  it('建立與編輯 earlyBirdPolicyVersion 固定由 enabled 決定', () => {
    // 測試同步更新：照 A（1C-3），不採用表單版本。
    const ctx = buildCtx({ role: 'coach' });
    for (const earlyBirdEnabled of [true, false]) {
      const form = buildForm({
        earlyBirdEnabled,
        earlyBirdPolicyVersion: earlyBirdEnabled ? null : 1,
        earlyBirdCost: 50,
      });
      const expected = earlyBirdEnabled ? 1 : null;
      expect(buildCreateEventPayload(form, ctx, 'ce_public').earlyBirdPolicyVersion)
        .toBe(expected);
      expect(buildEditEventUpdates(existing, form, ctx).updates.earlyBirdPolicyVersion)
        .toBe(expected);
    }
  });
});

// ── Callable 邊界：changeEventCapacity ────────────────

describe('changeEventCapacity', () => {
  beforeEach(() => {
    callFnMock.mockReset();
    callFnMock.mockResolvedValue({
      success: true,
      promoted: 0,
      demoted: 0,
      current: 0,
      waitlist: 0,
    });
  });

  it('呼叫 callFn("adjustEventCapacity", { eventId, newMax })', async () => {
    await changeEventCapacity('ce_test_1', 30);
    expect(callFnMock).toHaveBeenCalledWith('adjustEventCapacity', {
      eventId: 'ce_test_1',
      newMax: 30,
    });
  });

  it('callFn 失敗 → 包成 EventCreateError("CAPACITY_ADJUST_FAILED")', async () => {
    callFnMock.mockRejectedValueOnce(new Error('boom'));
    try {
      await changeEventCapacity('ce_test_1', 30);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EventCreateError);
      expect((err as EventCreateError).code).toBe('CAPACITY_ADJUST_FAILED');
    }
  });
});

// ── Callable 邊界：updateEventBasics（有報名 → 走 Callable，不直寫 max）──

describe('updateEventBasics', () => {
  const existingCapacity: EventForEdit = {
    id: 'ce_golden_user_basic',
    creatorUid: 'uid_user_golden',
    status: 'open',
    current: 5,
    waitlist: 0,
    max: 20,
  };

  beforeEach(() => {
    updateDocMock.mockReset();
    updateDocMock.mockResolvedValue(undefined);
    callFnMock.mockReset();
    callFnMock.mockResolvedValue({
      success: true,
      promoted: 0,
      demoted: 0,
      current: 5,
      waitlist: 0,
    });
  });

  it('有報名 (current>0) + max 改動 → 先 updateDoc、再 callFn adjustEventCapacity', async () => {
    const form = buildForm({ title: '週末練球（已更新）', max: 30 });
    const ctx = buildCtx({
      capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    });

    const result = await updateEventBasics(existingCapacity, form, ctx);

    expect(result.capacityChange).toBe(30);
    expect('max' in result.updates).toBe(false);

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(callFnMock).toHaveBeenCalledTimes(1);
    expect(callFnMock).toHaveBeenCalledWith('adjustEventCapacity', {
      eventId: 'ce_golden_user_basic',
      newMax: 30,
    });
  });

  it('有報名但 max 未改 → 不呼叫 callFn', async () => {
    const form = buildForm({ title: '週末練球（已更新）', max: 20 });
    const ctx = buildCtx({
      capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    });

    const result = await updateEventBasics(existingCapacity, form, ctx);

    expect(result.capacityChange).toBeNull();
    expect('max' in result.updates).toBe(false);
    expect(callFnMock).not.toHaveBeenCalled();
  });

  it('無報名 (current=0) → max 直寫進 updates，不呼叫 callFn', async () => {
    const noCapacity: EventForEdit = { ...existingCapacity, current: 0, max: 20 };
    const form = buildForm({ title: '週末練球（已更新）', max: 30 });
    const ctx = buildCtx({
      capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    });

    const result = await updateEventBasics(noCapacity, form, ctx);

    expect(result.capacityChange).toBeNull();
    expect(result.updates.max).toBe(30);
    expect(callFnMock).not.toHaveBeenCalled();
  });
});

// ── Callable 邊界：createEvent ────────────────────────

describe('createEvent', () => {
  beforeEach(() => {
    txGetMock.mockReset();
    txSetMock.mockReset();
  });

  it('newEventId 用 ctx.generateId 產生一次；不符 Rules 樣式即擲出', () => {
    expect(newEventId(buildCtx())).toBe('ce_golden_user_basic');
    expect(() => newEventId(buildCtx({ generateId: () => 'bad id' }))).toThrow(EventCreateError);
  });

  it('文件不存在 → 以 transaction 寫入，alreadyExisted=false', async () => {
    txGetMock.mockResolvedValue({ exists: () => false });
    const result = await createEvent(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect(result.alreadyExisted).toBe(false);
    expect(txSetMock).toHaveBeenCalledTimes(1);
    const written = txSetMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(written.id).toBe('ce_golden_user_basic');
    expect(written.clientRequestId).toBe('ce_golden_user_basic');
    expect(written.createdAt).toBe('__SERVER_TIMESTAMP__');
    expect('payloadRevision' in written).toBe(false);
    expect('payloadDigest' in written).toBe(false);
  });

  // 測試同步更新（Codex 第 3 段第二審 P1）：本人建立且內容相同才視為成功。
  it('重試：同一 id 已由本人以相同內容建立 → 視為成功、不覆寫', async () => {
    const existing = {
      ...(buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic') as unknown as Record<string, unknown>),
      image: 'https://example.test/uploaded.png',
      current: 1,
      participants: ['某人'],
    };
    txGetMock.mockResolvedValue({ exists: () => true, data: () => existing });
    const result = await createEvent(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect(result.alreadyExisted).toBe(true);
    expect(txSetMock).not.toHaveBeenCalled();
  });

  it('重試：同一 id 已由本人建立但內容改過（名額）→ CONTENT_CONFLICT，不覆寫', async () => {
    const existing = {
      ...(buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic') as unknown as Record<string, unknown>),
      max: 99,
    };
    txGetMock.mockResolvedValue({ exists: () => true, data: () => existing });
    await expect(createEvent(buildForm(), buildCtx(), 'ce_golden_user_basic'))
      .rejects.toMatchObject({ code: 'CONTENT_CONFLICT' });
    expect(txSetMock).not.toHaveBeenCalled();
  });

  it('重試：首次含地圖座標已寫入、重送時沒帶地圖欄位 → CONTENT_CONFLICT（雙向比對選填欄位）', async () => {
    const existing = {
      ...(buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic') as unknown as Record<string, unknown>),
      gpsEnabled: true,
      lat: 25.03,
      lng: 121.56,
      mapLocationConfirmed: true,
    };
    txGetMock.mockResolvedValue({ exists: () => true, data: () => existing });
    await expect(createEvent(buildForm(), buildCtx(), 'ce_golden_user_basic'))
      .rejects.toMatchObject({ code: 'CONTENT_CONFLICT' });
    expect(txSetMock).not.toHaveBeenCalled();
  });

  it('onWriteStart 只在權限通過、即將進入 transaction 時呼叫', async () => {
    const onWriteStart = vi.fn();
    await expect(createEvent(buildForm(), buildCtx({ capabilities: [] }), 'ce_golden_user_basic', { onWriteStart }))
      .rejects.toBeInstanceOf(EventCreateError);
    expect(onWriteStart).not.toHaveBeenCalled();

    txGetMock.mockResolvedValue({ exists: () => false });
    await createEvent(buildForm(), buildCtx(), 'ce_golden_user_basic', { onWriteStart });
    expect(onWriteStart).toHaveBeenCalledTimes(1);
  });

  it('同一 id 已被他人使用 → ID_TAKEN，不覆寫', async () => {
    txGetMock.mockResolvedValue({ exists: () => true, data: () => ({ creatorUid: 'uid_other' }) });
    await expect(createEvent(buildForm(), buildCtx(), 'ce_golden_user_basic'))
      .rejects.toMatchObject({ code: 'ID_TAKEN' });
    expect(txSetMock).not.toHaveBeenCalled();
  });
});
