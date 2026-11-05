import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildEventLocationValue, resetLocationDraft,
} from '../components/event-form/use-event-location';
import type { EventDoc } from './types';
import type { OperateContext } from './operate-permissions';
import {
  buildExternalEventUpdates, externalEventEditForm, saveExternalEventEdit,
  validateExternalEventEdit, type ExternalEventEditForm,
} from './external-event-edit';

const mocks = vi.hoisted(() => ({
  read: vi.fn(), queryRead: vi.fn(), update: vi.fn(), upload: vi.fn(), log: vi.fn(),
}));
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: 'db' }) }));
vi.mock('./event-cover-upload', () => ({ uploadImageDataUrl: mocks.upload }));
vi.mock('@/data/op-log', () => ({ writeOpLog: mocks.log }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, name: string) => name,
  query: (...parts: unknown[]) => parts,
  where: (...parts: unknown[]) => parts,
  limit: (n: number) => ({ limit: n }),
  getDocFromServer: mocks.read, getDocsFromServer: mocks.queryRead,
  updateDoc: mocks.update, serverTimestamp: () => 'SERVER_TIME',
}));

const event: EventDoc & { sportTag: string } = {
  id: 'public-id', _docId: 'legacy-document', type: 'external', creatorUid: 'owner',
  title: '原活動', date: '2026/1/5 09:00~11:00', location: '球場',
  externalUrl: 'https://example.test/activity', sportTag: 'football', image: 'https://example.test/cover',
};
const owner: OperateContext = {
  uid: 'owner', role: 'user', rolePermissions: [], userGrants: null,
  capabilities: ['user.activity.own_edit_basic'], customRoles: [],
};
const snapshot = (data: EventDoc | null, id = 'legacy-document') => ({
  id, exists: () => data !== null, data: () => data,
});
const point = {
  location: '球場', lat: 25, lng: 121, mapAddress: '地址', mapPlaceId: 'place',
  mapProvider: 'google', mapLocationConfirmed: true, mapLocationUpdatedAt: '2026-01-01T00:00:00.000Z',
};
const loc = (enabled = false, text = '球場', source = point) =>
  buildEventLocationValue(resetLocationDraft(source, text), text, true, enabled, new Date('2026-11-04T00:00:00Z'));
let form: ExternalEventEditForm;
let context: OperateContext;
const actor = () => ({ context, operator: '主辦人' });

beforeEach(() => {
  vi.clearAllMocks();
  form = externalEventEditForm(event);
  context = { ...owner };
  mocks.read.mockResolvedValue(snapshot(event));
  mocks.queryRead.mockResolvedValue({ docs: [] });
  mocks.update.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue('https://example.test/uploaded');
  mocks.log.mockResolvedValue(undefined);
});

describe('A 外部活動編輯表單', () => {
  it('六欄回填、日期補零；沒有時間時用 14:00／16:00，無封面為 null', () => {
    expect(form).toEqual({ title: '原活動', dateVal: '2026-01-05', startTime: '09:00', endTime: '11:00',
      location: '球場', externalUrl: event.externalUrl, sportTag: 'football', image: event.image });
    expect(externalEventEditForm({ date: '2026/1/5' })).toMatchObject({
      dateVal: '2026-01-05', startTime: '14:00', endTime: '16:00', sportTag: '', image: null,
    });
  });
  it('按 A 順序逐一回傳八個驗證分支，最後可儲存過去日期', () => {
    let f = { ...form, title: '', dateVal: '', startTime: '', endTime: '', sportTag: '', externalUrl: '' };
    const steps: [Partial<ExternalEventEditForm>, string | null][] = [
      [{}, '請輸入活動名稱'], [{ title: 'a'.repeat(17) }, '活動名稱不可超過 16 字'],
      [{ title: '活動' }, '請選擇活動日期'], [{ dateVal: '2000-01-01' }, '請選擇開始與結束時間'],
      [{ startTime: '12:00', endTime: '12:00' }, '結束時間必須晚於開始時間'],
      [{ endTime: '13:00' }, '請先選擇運動 / 場景標籤（必選）'],
      [{ sportTag: 'football' }, '請輸入活動連結'],
      [{ externalUrl: 'http://example.test' }, '活動連結必須以 https:// 開頭'],
      [{ externalUrl: ' https://example.test ' }, null],
    ];
    for (const [patch, expected] of steps) { f = { ...f, ...patch }; expect(validateExternalEventEdit(f)).toBe(expected); }
    expect(validateExternalEventEdit({ ...form, sportTag: 'arbitrary' })).toBe('請先選擇運動 / 場景標籤（必選）');
  });
  it('只寫 A 白名單，trim 欄位；旗標關時保留座標、不寫 GPS／時間戳', () => {
    expect(buildExternalEventUpdates({ ...form, title: ' 改名 ', location: ' 球場 ', externalUrl: ' https://example.test ' }, loc(), event)).toEqual({
      title: '改名', location: '球場', externalUrl: 'https://example.test', sportTag: 'football',
      date: '2026/01/05 09:00~11:00', image: event.image, gradient: 'linear-gradient(135deg,#6b7280,#4b5563)',
    });
  });
  it('新增已確認座標，cee 不寫 gpsEnabled', () => {
    const updates = buildExternalEventUpdates(form, loc(true), event);
    const { location: _location, ...coordinates } = point;
    expect(updates).toMatchObject(coordinates);
    expect(updates).not.toHaveProperty('gpsEnabled');
    expect(updates).not.toHaveProperty('startTimestamp');
    expect(updates).not.toHaveProperty('endTimestamp');
  });
  it.each(['地點已改', '未確認', '無座標'])('%s 時清空座標欄位', scenario => {
    const source = scenario === '未確認' ? { ...point, mapLocationConfirmed: false }
      : scenario === '無座標' ? { ...point, lat: NaN } : point;
    const updates = buildExternalEventUpdates(form, loc(true, scenario === '地點已改' ? '新地點' : '球場', source), { ...event, ...point });
    expect(updates).toMatchObject({ lat: null, lng: null, mapAddress: null, mapPlaceId: null,
      mapProvider: null, mapLocationConfirmed: false, mapLocationUpdatedAt: null });
  });
});

describe('外部活動寫入／最新權限／opLog', () => {
  describe.each(['owner', 'delegate'] as const)('%s 無 addons_use 的基本編輯', role => {
    describe.each([false, true])('mapPickerEnabled=%s', enabled => {
      it.each([
        ['缺少全部地圖欄位', {}],
        ['既有座標', point],
        ['既有座標但缺少 metadata', { lat: 25, lng: 121, mapLocationConfirmed: true }],
        ['明確空值', { lat: null, lng: null, mapLocationConfirmed: false }],
        ['快取時間戳', { ...point, mapLocationUpdatedAt: { seconds: 1767225600 } }],
      ])('%s：只改名稱不送任何地圖欄位', async (_name, coordinates) => {
        const target = { ...event, ...coordinates, delegateUids: ['delegate'] };
        context = { ...owner, uid: role };
        mocks.read.mockResolvedValue(snapshot(target));
        const value = buildEventLocationValue(resetLocationDraft(target, '球場'), '球場', true, enabled, new Date());
        await saveExternalEventEdit(target, { ...form, title: '只改名稱' }, value, actor);
        const updates = mocks.update.mock.calls[0]?.[1];
        expect(updates.title).toBe('只改名稱');
        for (const key of ['lat', 'lng', 'mapAddress', 'mapPlaceId', 'mapProvider',
          'mapLocationConfirmed', 'mapLocationUpdatedAt', 'gpsEnabled']) {
          expect(updates).not.toHaveProperty(key);
        }
      });
    });
  });

  it('只送有變更的座標／metadata；保留其他欄位與原時間戳', () => {
    const target = { ...event, ...point };
    const updates = buildExternalEventUpdates(form, { ...loc(true), lat: 24 }, target);
    expect(updates.lat).toBe(24);
    for (const key of ['lng', 'mapAddress', 'mapPlaceId', 'mapProvider', 'mapLocationConfirmed', 'mapLocationUpdatedAt']) {
      expect(updates).not.toHaveProperty(key);
    }
  });

  it('缺時間戳的舊座標真的改變時才補寫新的時間戳', () => {
    const target = { ...event, ...point, mapLocationUpdatedAt: undefined };
    const value = buildEventLocationValue(resetLocationDraft(target, '球場'), '球場', true, true, new Date('2026-11-04T00:00:00Z'));
    expect(buildExternalEventUpdates(form, value, target)).not.toHaveProperty('mapLocationUpdatedAt');
    expect(buildExternalEventUpdates(form, { ...value, lat: 24 }, target)).toMatchObject({
      lat: 24, mapLocationUpdatedAt: '2026-11-04T00:00:00.000Z',
    });
  });

  it('旗標關閉，即使草稿改變也不送座標；基本編輯不覆蓋伺服器較新的座標', async () => {
    const target = { ...event, ...point };
    const latestTarget = { ...target, lat: 24 };
    mocks.read.mockResolvedValue(snapshot(latestTarget));
    await saveExternalEventEdit(target, form, loc(true), actor);
    expect(mocks.update.mock.calls[0]?.[1]).not.toHaveProperty('lat');
    const updates = buildExternalEventUpdates(form, { ...loc(true), mapPickerEnabled: false, lat: 23 }, target);
    for (const key of Object.keys(point).filter(key => key !== 'location')) expect(updates).not.toHaveProperty(key);
  });

  it('已知 _docId 只 server read 一次，update 真實文件，最後寫 A opLog', async () => {
    await expect(saveExternalEventEdit(event, form, loc(), actor)).resolves.toEqual({ title: '原活動' });
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith('events/legacy-document');
    expect(mocks.queryRead).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('events/legacy-document', {
      ...buildExternalEventUpdates(form, loc(), event), updatedAt: 'SERVER_TIME',
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.log).toHaveBeenCalledExactlyOnceWith({
      type: 'event_update', typeName: '更新活動連結', content: '更新「原活動」', actorUid: 'owner', operator: '主辦人',
    }, expect.any(Function)));
  });
  it('只有 public id 時，直讀不存在後 limit(1) 查詢並沿用快照、不額外重讀', async () => {
    mocks.read.mockResolvedValue(snapshot(null, 'public-id'));
    mocks.queryRead.mockResolvedValue({ docs: [snapshot(event)] });
    await saveExternalEventEdit({ ...event, _docId: undefined }, form, loc(), actor);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith('events/public-id');
    expect(mocks.queryRead).toHaveBeenCalledExactlyOnceWith(['events', ['id', '==', 'public-id'], { limit: 1 }]);
    expect(mocks.update.mock.calls[0]?.[0]).toBe('events/legacy-document');
  });
  it('docId 別名可用；已知文件不存在不轉寫其他活動', async () => {
    mocks.read.mockResolvedValue(snapshot(null));
    await expect(saveExternalEventEdit({ ...event, _docId: undefined, docId: 'old-doc' }, form, loc(), actor)).rejects.toThrow('更新失敗，請稍後再試');
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith('events/old-doc');
    expect(mocks.queryRead).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(['missing', 'type', 'owner', 'delegate'])('最新文件 %s 變動時禁止寫入／上傳／opLog', async scenario => {
    const latest = scenario === 'missing' ? null : scenario === 'type' ? { ...event, type: 'friendly' }
      : { ...event, creatorUid: 'other', delegateUids: [] };
    const opening = scenario === 'delegate' ? { ...event, creatorUid: 'other', delegateUids: ['owner'] } : event;
    mocks.read.mockResolvedValue(snapshot(latest));
    await expect(saveExternalEventEdit(opening, { ...form, image: 'data:image/png;base64,AA==' }, loc(), actor)).rejects.toThrow();
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled();
  });
  it.each(['owner', 'delegate', 'staff', 'edit_all'])('%s 照 canEditOwnActivityBasic 可更新', async role => {
    let target: EventDoc = event;
    if (role === 'delegate') target = { ...event, creatorUid: 'other', delegateUids: ['owner'] };
    if (role === 'staff') context = { ...owner, role: 'coach', capabilities: [] };
    if (role === 'edit_all') { context = { ...owner, userGrants: { uid: 'owner', enabled: true, permissions: ['event.edit_all'] }, capabilities: [] }; target = { ...event, creatorUid: 'other' }; }
    mocks.read.mockResolvedValue(snapshot(target));
    await saveExternalEventEdit(target, form, loc(), actor);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('無權與非 external 在任何讀寫之前拒絕', async () => {
    context = { ...owner, capabilities: [] };
    await expect(saveExternalEventEdit(event, form, loc(), actor)).rejects.toThrow('權限不足');
    context = owner;
    await expect(saveExternalEventEdit({ ...event, type: 'friendly' }, form, loc(), actor)).rejects.toThrow('權限不足');
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('data URL 在權限確認後上傳 events/{publicId}，成功 URL 才寫入', async () => {
    await saveExternalEventEdit(event, { ...form, image: 'data:image/png;base64,AA==' }, loc(), actor);
    expect(mocks.upload).toHaveBeenCalledExactlyOnceWith('data:image/png;base64,AA==', 'events/public-id');
    expect(mocks.update.mock.calls[0]?.[1].image).toBe('https://example.test/uploaded');
    expect(mocks.read.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]!);
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]!);
  });
  it('上傳失敗不寫 image，其他更新仍成功', async () => {
    mocks.upload.mockResolvedValue(null);
    await saveExternalEventEdit(event, { ...form, image: 'data:image/png;base64,AA==' }, loc(), actor);
    expect(mocks.update.mock.calls[0]?.[1]).not.toHaveProperty('image');
    expect(mocks.update.mock.calls[0]?.[1]).toHaveProperty('title', '原活動');
  });
  it('等待上傳期間 viewer 權限或登入身分改變會擋寫入', async () => {
    mocks.upload.mockImplementation(async () => { context = { ...owner, capabilities: [] }; return 'https://example.test/uploaded'; });
    await expect(saveExternalEventEdit(event, { ...form, image: 'data:image/png;base64,AA==' }, loc(), actor)).rejects.toThrow('權限不足');
    expect(mocks.update).not.toHaveBeenCalled();
    context = owner;
    mocks.read.mockImplementation(async () => { context = { ...owner, uid: 'another', rolePermissions: ['event.edit_all'] }; return snapshot(event); });
    await expect(saveExternalEventEdit(event, form, loc(), actor)).rejects.toThrow('權限不足');
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('伺服器讀取失敗不降級快取或寫入', async () => {
    mocks.read.mockRejectedValue(new Error('raw SDK detail'));
    await expect(saveExternalEventEdit(event, form, loc(), actor)).rejects.toThrow();
    expect(mocks.queryRead).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('update 失敗不寫 opLog；opLog 失敗不改變成功結果', async () => {
    mocks.update.mockRejectedValueOnce(new Error('raw write error'));
    await expect(saveExternalEventEdit(event, form, loc(), actor)).rejects.toThrow();
    expect(mocks.log).not.toHaveBeenCalled();
    mocks.log.mockRejectedValue(new Error('raw log error'));
    await expect(saveExternalEventEdit(event, form, loc(), actor)).resolves.toEqual({ title: '原活動' });
    await vi.waitFor(() => expect(mocks.log).toHaveBeenCalledOnce());
  });
});
