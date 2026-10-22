import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/preact';
import { createDefaultFormState } from './event-form-model';
import type { EventLocationValue } from '../components/event-form/use-event-location';
import {
  MAX_EVENT_TEMPLATES,
  buildTemplateFromForm,
  deleteEventTemplate,
  loadEventTemplates,
  saveEventTemplate,
  templateToFormPatch,
  type EventTemplateDoc,
} from './event-templates';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getFirebase: vi.fn(),
  db: { testDatabase: 'event-templates' },
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  addDoc: vi.fn(),
  doc: vi.fn(),
  deleteDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('@/data/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/data/firebase', () => ({ getFirebase: mocks.getFirebase }));
vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  query: mocks.query,
  where: mocks.where,
  limit: mocks.limit,
  getDocs: mocks.getDocs,
  addDoc: mocks.addDoc,
  doc: mocks.doc,
  deleteDoc: mocks.deleteDoc,
  serverTimestamp: mocks.serverTimestamp,
}));
vi.mock('./event-cover-upload', () => ({ uploadImageDataUrl: mocks.upload }));

const location: EventLocationValue = {
  mapPickerEnabled: true,
  gpsEnabled: true,
  lat: 25,
  lng: 121,
  mapAddress: '地址',
  mapPlaceId: 'place',
  mapProvider: 'manual',
  mapLocationConfirmed: true,
  mapLocationUpdatedAt: '2026-10-01T00:00:00.000Z',
};

function build(overrides: Partial<Parameters<typeof buildTemplateFromForm>[0]> = {}) {
  return buildTemplateFromForm({
    name: '週六',
    state: createDefaultFormState(),
    image: null,
    location,
    canUseAddons: true,
    generateId: (prefix) => `${prefix}uuid`,
    now: new Date('2026-10-22T00:00:00.000Z'),
    ...overrides,
  });
}

function template(overrides: Partial<EventTemplateDoc> = {}): EventTemplateDoc {
  return {
    ...build(),
    ownerUid: 'u',
    ownerName: '甲',
    _docId: 'document-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function snapshotDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

beforeEach(() => {
  vi.resetAllMocks();
  document.documentElement.lang = 'zh-TW';
  mocks.getCurrentUser.mockResolvedValue({ uid: 'u' });
  mocks.getFirebase.mockResolvedValue({ db: mocks.db });
  mocks.collection.mockImplementation((database: unknown, path: string) => ({ database, path }));
  mocks.where.mockImplementation((field: string, operator: string, value: string) => ({
    field, operator, value,
  }));
  mocks.limit.mockImplementation((count: number) => ({ count }));
  mocks.query.mockImplementation((...parts: unknown[]) => parts);
  mocks.getDocs.mockResolvedValue({ docs: [] });
  mocks.addDoc.mockResolvedValue({ id: 'automatic-document-id' });
  mocks.doc.mockImplementation((database: unknown, path: string, id: string) => ({
    database, path, id,
  }));
  mocks.deleteDoc.mockResolvedValue(undefined);
  mocks.serverTimestamp.mockReturnValue({ serverTimestamp: true });
  mocks.upload.mockResolvedValue('https://example.test/cover.jpg');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('loadEventTemplates', () => {
  it('照 A 查詢 ownerUid、limit 100，依 updatedAt 或 createdAt 排序並過濾類型', async () => {
    mocks.getDocs.mockResolvedValue({
      docs: [
        snapshotDoc('old-doc', {
          ...template({ id: 'old', updatedAt: 'invalid', createdAt: '2026-01-01' }),
        }),
        snapshotDoc('hidden-doc', {
          ...template({ id: 'hidden', templateType: 'course', updatedAt: '2026-12-01' }),
        }),
        snapshotDoc('new-doc', {
          ...template({
            id: 'new',
            templateType: 'normal',
            updatedAt: { toMillis: () => Date.parse('2026-11-01') },
          }),
        }),
        snapshotDoc('middle-doc', {
          ...template({ id: 'middle', templateType: 'event', updatedAt: '2026-10-01' }),
        }),
      ],
    });

    const result = await loadEventTemplates('u');

    expect(mocks.getFirebase).toHaveBeenCalledTimes(1);
    expect(mocks.collection).toHaveBeenCalledWith(mocks.db, 'eventTemplates');
    expect(mocks.where).toHaveBeenCalledWith('ownerUid', '==', 'u');
    expect(mocks.limit).toHaveBeenCalledWith(100);
    expect(result.map((item) => item.id)).toEqual(['new', 'middle', 'old']);
    expect(result.map((item) => item._docId)).toEqual(['new-doc', 'middle-doc', 'old-doc']);
  });

  it('includeAllTypes 保留全部本人範本類型，仍依時間排序及使用文件鍵', async () => {
    mocks.getDocs.mockResolvedValue({
      docs: [
        snapshotDoc('event-doc', {
          ...template({ id: 'event', templateType: 'event', updatedAt: '2026-10-01' }),
        }),
        snapshotDoc('course-doc', {
          ...template({ id: 'course', templateType: 'course', updatedAt: '2026-12-01' }),
        }),
        snapshotDoc('normal-doc', {
          ...template({ id: 'normal', templateType: 'normal', updatedAt: '2026-11-01' }),
        }),
        snapshotDoc('legacy-doc', {
          ...template({ id: 'legacy', updatedAt: '2026-09-01' }),
        }),
      ],
    });

    const result = await loadEventTemplates('u', { includeAllTypes: true });

    expect(mocks.collection).toHaveBeenCalledWith(mocks.db, 'eventTemplates');
    expect(mocks.where).toHaveBeenCalledWith('ownerUid', '==', 'u');
    expect(mocks.limit).toHaveBeenCalledWith(100);
    expect(result.map((item) => item.id)).toEqual(['course', 'normal', 'event', 'legacy']);
    expect(result.map((item) => item._docId)).toEqual([
      'course-doc', 'normal-doc', 'event-doc', 'legacy-doc',
    ]);
  });

  it('未登入不查詢', async () => {
    expect(await loadEventTemplates('')).toEqual([]);
    expect(await loadEventTemplates('unknown')).toEqual([]);
    expect(mocks.getFirebase).not.toHaveBeenCalled();
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it('第一次拒絕後可重新載入，不保留失敗 Promise', async () => {
    mocks.getDocs.mockRejectedValueOnce(new Error('offline'));

    await expect(loadEventTemplates('u')).rejects.toThrow('offline');
    await expect(loadEventTemplates('u')).resolves.toEqual([]);
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
  });
});

describe('buildTemplateFromForm', () => {
  it('逐欄建立 A 範本，不包含日期、委託、俱樂部、分隊、候補或課程欄位', () => {
    const state = {
      ...createDefaultFormState(),
      title: ' 活動 ',
      location: ' 球場 ',
      notes: ' 注意 ',
      dateVal: '2026-12-01',
      startTime: '08:00',
      endTime: '10:00',
      regOpenEnabled: true,
      regOpenDate: '2026-11-01',
      regOpenClock: '09:00',
      feeEnabled: true,
      fee: '120',
      max: '25',
      ageLimitEnabled: true,
      minAge: '18',
      privateEvent: true,
      earlyBirdEnabled: true,
      earlyBirdCost: '20',
      teamOnly: true,
      teamOnlyTeamIds: ['team-1'],
      teamSplitEnabled: true,
    };

    const result = build({ state, name: ' 週六 ', image: 'https://example.test/a.jpg' });

    expect(result).toEqual({
      id: 'tpl_uuid',
      name: '週六',
      title: '活動',
      type: 'play',
      location: '球場',
      fee: 120,
      feeEnabled: true,
      max: 25,
      minAge: 18,
      notes: '注意',
      sportTag: '',
      genderRestrictionEnabled: false,
      allowedGender: '',
      privateEvent: true,
      socialLinksEnabled: false,
      socialLinks: [],
      earlyBirdEnabled: true,
      earlyBirdCost: 20,
      regionEnabled: true,
      region: '中部',
      cities: ['台中市', '苗栗縣', '彰化縣', '南投縣', '雲林縣'],
      image: 'https://example.test/a.jpg',
      gpsEnabled: true,
      lat: 25,
      lng: 121,
      mapAddress: '地址',
      mapPlaceId: 'place',
      mapProvider: 'manual',
      mapLocationConfirmed: true,
      mapLocationUpdatedAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('無加值權限時費用、性別、私密、社群、早鳥及 GPS 全部關閉', () => {
    const result = build({
      canUseAddons: false,
      state: {
        ...createDefaultFormState(),
        feeEnabled: true,
        fee: '500',
        genderRestrictionEnabled: true,
        privateEvent: true,
        socialLinksEnabled: true,
        socialLinkInputs: ['https://example.test'],
        earlyBirdEnabled: true,
        earlyBirdCost: '50',
      },
    });

    expect(result).toMatchObject({
      feeEnabled: false,
      fee: 0,
      genderRestrictionEnabled: false,
      allowedGender: '',
      privateEvent: false,
      socialLinksEnabled: false,
      socialLinks: [],
      earlyBirdEnabled: false,
      earlyBirdCost: 0,
      gpsEnabled: false,
      lat: null,
      lng: null,
      mapAddress: null,
      mapPlaceId: null,
      mapProvider: null,
      mapLocationConfirmed: false,
      mapLocationUpdatedAt: null,
    });
  });

  it('地圖功能關閉時不產生八個地圖欄位', () => {
    const result = build({ location: { ...location, mapPickerEnabled: false } });
    for (const key of [
      'gpsEnabled', 'lat', 'lng', 'mapAddress', 'mapPlaceId',
      'mapProvider', 'mapLocationConfirmed', 'mapLocationUpdatedAt',
    ]) {
      expect(result).not.toHaveProperty(key);
    }
  });

  it('無效定位清掉座標，已確認定位缺時間才用 now', () => {
    expect(build({ location: { ...location, lat: 91 } })).toMatchObject({
      gpsEnabled: true,
      lat: null,
      lng: null,
      mapLocationConfirmed: false,
      mapLocationUpdatedAt: null,
    });

    expect(build({
      location: {
        ...location,
        mapAddress: null,
        mapPlaceId: null,
        mapProvider: null,
        mapLocationUpdatedAt: null,
      },
      state: { ...createDefaultFormState(), location: '球場' },
    })).toMatchObject({
      mapAddress: '球場',
      mapProvider: 'manual',
      mapLocationUpdatedAt: '2026-10-22T00:00:00.000Z',
    });
  });

  it('使用傳入的 ID generator，保留範本與表單陣列的隔離', () => {
    const generate = vi.fn((prefix: string) => `${prefix}random`);
    const state = createDefaultFormState();
    const result = build({ state, generateId: generate });

    expect(generate).toHaveBeenCalledWith('tpl_');
    expect(result.id).toBe('tpl_random');
    result.cities.push('額外');
    expect(state.cities).not.toContain('額外');
    expect(MAX_EVENT_TEMPLATES).toBe(30);
  });
});

describe('saveEventTemplate', () => {
  it('使用 addDoc 自動文件鍵，兩個時間欄為 serverTimestamp，並排除外來欄位', async () => {
    const input = {
      ...template(),
      ownerUid: 'spoofed',
      ownerName: 'spoofed',
      dateVal: '2030-01-01',
      startTime: '12:00',
      regOpenEnabled: true,
      delegateUids: ['other'],
      teamOnly: true,
      teamSplitEnabled: true,
      waitlist: 99,
      courseId: 'course-1',
    };

    const result = await saveEventTemplate({
      template: input,
      ownerUid: 'u',
      ownerName: '甲',
    });

    const expected = {
      ...build(),
      ownerUid: 'u',
      ownerName: '甲',
      createdAt: { serverTimestamp: true },
      updatedAt: { serverTimestamp: true },
    };
    expect(mocks.addDoc).toHaveBeenCalledWith(
      { database: mocks.db, path: 'eventTemplates' },
      expected,
    );
    expect(mocks.serverTimestamp).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ...expected, _docId: 'automatic-document-id' });
    expect(mocks.doc).not.toHaveBeenCalled();
  });

  it('data URL 上傳成功後只存下載網址', async () => {
    const result = await saveEventTemplate({
      template: template({ image: 'data:image/png;base64,AA==' }),
      ownerUid: 'u',
      ownerName: '甲',
    });

    expect(mocks.upload).toHaveBeenCalledWith(
      'data:image/png;base64,AA==',
      'eventTemplates/u',
    );
    expect(result.image).toBe('https://example.test/cover.jpg');
    expect(mocks.addDoc.mock.calls[0]?.[1]).toMatchObject({
      image: 'https://example.test/cover.jpg',
    });
  });

  it.each(['null', 'reject'])('圖片上傳失敗（%s）省略 image，仍儲存範本', async (failure) => {
    if (failure === 'null') mocks.upload.mockResolvedValue(null);
    else mocks.upload.mockRejectedValue(new Error('upload failed'));

    const result = await saveEventTemplate({
      template: template({ image: 'data:image/png;base64,AA==' }),
      ownerUid: 'u',
      ownerName: '甲',
    });

    expect(result).not.toHaveProperty('image');
    expect(mocks.addDoc.mock.calls[0]?.[1]).not.toHaveProperty('image');
    expect(mocks.addDoc).toHaveBeenCalledTimes(1);
  });

  it('現有圖片網址不重傳', async () => {
    await saveEventTemplate({
      template: template({ image: 'https://example.test/existing.jpg' }),
      ownerUid: 'u',
      ownerName: '甲',
    });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('UID 不符及上傳期間切換帳號均拒絕寫入', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({ uid: 'other' });
    await expect(saveEventTemplate({
      template: template(),
      ownerUid: 'u',
      ownerName: '甲',
    })).rejects.toThrow('EVENT_TEMPLATE_AUTH_REQUIRED');

    mocks.getCurrentUser
      .mockResolvedValueOnce({ uid: 'u' })
      .mockResolvedValueOnce({ uid: 'other' });

    await expect(saveEventTemplate({
      template: template({ image: 'data:image/png;base64,AA==' }),
      ownerUid: 'u',
      ownerName: '甲',
    })).rejects.toThrow('EVENT_TEMPLATE_AUTH_REQUIRED');

    expect(mocks.addDoc).not.toHaveBeenCalled();
  });
});

describe('deleteEventTemplate', () => {
  it('只使用 _docId 刪除，資料 id 不當成文件鍵', async () => {
    await deleteEventTemplate(template({ id: 'tpl_public', _docId: 'actual-document' }));
    expect(mocks.getFirebase).toHaveBeenCalledTimes(1);
    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, 'eventTemplates', 'actual-document');
    expect(mocks.deleteDoc).toHaveBeenCalledWith({
      database: mocks.db,
      path: 'eventTemplates',
      id: 'actual-document',
    });
  });

  it('文件鍵缺失不送出刪除', async () => {
    await expect(deleteEventTemplate(template({ _docId: '' })))
      .rejects.toThrow('EVENT_TEMPLATE_NOT_FOUND');
    expect(mocks.deleteDoc).not.toHaveBeenCalled();
  });
});

describe('templateToFormPatch', () => {
  it('空值不覆寫 setVal 欄位，時間、委託及其他一次性設定不還原', () => {
    const result = templateToFormPatch(template({
      title: '',
      location: '',
      notes: '',
      image: null,
    }), true);

    for (const key of [
      'title', 'location', 'notes', 'eventId', 'dateVal', 'startTime', 'endTime',
      'regOpenEnabled', 'regOpenDate', 'regOpenClock', 'teamOnly', 'teamOnlyTeamIds',
      'teamSplitEnabled', 'delegateUids', 'waitlist', 'courseId',
    ]) {
      expect(result.patch).not.toHaveProperty(key);
    }
    expect(result.image).toBeNull();
  });

  it('有值還原一般欄位、圖片及定位，保留零人數的 setVal 語意', () => {
    const result = templateToFormPatch(template({
      title: '名稱',
      location: '球場',
      notes: '注意',
      max: 0,
      minAge: 18,
      image: 'https://example.test/a.jpg',
    }), true);

    expect(result.patch).toMatchObject({
      title: '名稱',
      location: '球場',
      notes: '注意',
      max: '0',
      ageLimitEnabled: true,
      minAge: '18',
      gpsEnabled: true,
    });
    expect(result.locationTemplate).toMatchObject({
      lat: 25,
      lng: 121,
      mapLocationConfirmed: true,
    });
    expect(result.image).toBe('https://example.test/a.jpg');
    expect(result.upsell).toBe(false);
  });

  it('無權限時關閉所有加值，保留一般欄位並要求 upsell', () => {
    const result = templateToFormPatch(template({
      title: '一般欄位',
      feeEnabled: true,
      fee: 100,
      privateEvent: true,
      genderRestrictionEnabled: true,
      socialLinksEnabled: true,
      earlyBirdEnabled: true,
      earlyBirdCost: 50,
    }), false);

    expect(result.upsell).toBe(true);
    expect(result.patch).toMatchObject({
      title: '一般欄位',
      gpsEnabled: false,
      feeEnabled: false,
      fee: '0',
      genderRestrictionEnabled: false,
      allowedGender: '',
      privateEvent: false,
      socialLinksEnabled: false,
      socialLinkInputs: [''],
      earlyBirdEnabled: false,
      earlyBirdCost: '10',
    });
    expect(result.locationTemplate).toEqual({
      location: '',
      mapLocationConfirmed: false,
    });
  });

  it('社群物件還原成 URL 字串，無連結時保留一個空輸入列', () => {
    const built = build({
      state: {
        ...createDefaultFormState(),
        socialLinksEnabled: true,
        socialLinkInputs: ['https://www.instagram.com/toosterx/'],
      },
    });
    expect(built.socialLinks).toHaveLength(1);

    const saved = template({
      socialLinksEnabled: true,
      socialLinks: built.socialLinks,
    });
    expect(templateToFormPatch(saved, true).patch.socialLinkInputs).toEqual([
      'https://www.instagram.com/toosterx/',
    ]);
    expect(templateToFormPatch(saved, false).patch.socialLinkInputs).toEqual(['']);
    expect(templateToFormPatch(template({ socialLinks: [] }), true).patch.socialLinkInputs)
      .toEqual(['']);
  });

  it('舊範本未存 feeEnabled 時從 fee 判斷', () => {
    const old = template({ fee: 120 });
    delete old.feeEnabled;
    expect(templateToFormPatch(old, true).patch).toMatchObject({
      feeEnabled: true,
      fee: '120',
    });
  });
});
