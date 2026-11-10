import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restArray, restBool, restInt, restMap, restStr } from '@/features/home/data/__fixtures__/banners-rest';
import {
  EARLY_EVENT_DETAIL_MAX_AGE_MS,
  earlyEventDocumentNameMatches,
  markEarlyEventDetailAdopted,
  readEarlyEventDetail,
  readSettledEarlyEvent,
  resetEarlyEventDetailForTest,
  selectEarlyEventDetail,
  selectEarlyEventShellText,
} from './early-event-shell';
import type { ViewerContext } from './types';
import * as visibility from './visibility';

const read = (rel: string): string => readFileSync(resolve(__dirname, rel), 'utf8');

function viewer(uid: string | null): ViewerContext {
  return { uid, teamIds: new Set(), hasPermission: () => false, roleLevel: 0 };
}

function doc(id: string, fields: Record<string, unknown>, name?: string): Record<string, unknown> {
  return {
    name: name ?? `projects/p/databases/(default)/documents/events/${id}`,
    fields,
  };
}

beforeEach(() => {
  resetEarlyEventDetailForTest();
  vi.spyOn(performance, 'now').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__fcbEarlyEvent;
});

describe('earlyEventDocumentNameMatches', () => {
  it('最後兩段是 events 與精確 publicId 才算，後綴碰撞與 fields.id 都不算', () => {
    const full = 'projects/p/databases/(default)/documents/events/abc';
    expect(earlyEventDocumentNameMatches(full, 'abc')).toBe(true);
    expect(earlyEventDocumentNameMatches(full, 'bc')).toBe(false);
    expect(earlyEventDocumentNameMatches(full, 'ab')).toBe(false);
    expect(earlyEventDocumentNameMatches('projects/p/databases/(default)/documents/events/bc', 'abc')).toBe(false);
    expect(earlyEventDocumentNameMatches('projects/p/databases/(default)/documents/other/abc', 'abc')).toBe(false);
    expect(earlyEventDocumentNameMatches('events/abc', 'abc')).toBe(true);
    expect(earlyEventDocumentNameMatches('events/abc/', 'abc')).toBe(false);
    expect(earlyEventDocumentNameMatches(42, 'abc')).toBe(false);
    expect(earlyEventDocumentNameMatches(full, '')).toBe(false);
  });
});

describe('selectEarlyEventShellText', () => {
  it('name 不符就不填，就算 fields.id 等於 publicId', () => {
    const text = selectEarlyEventShellText(
      doc('old', { id: restStr('abc'), title: restStr('舊文件') }, 'projects/p/databases/(default)/documents/events/old'),
      'abc',
      viewer(null),
      false,
    );
    expect(text).toBeNull();
  });

  it('四欄只收字串；圖片優先 cover，兩者都過 safeImageUrl', () => {
    const text = selectEarlyEventShellText(doc('abc', {
      title: { integerValue: '3' },
      date: restStr('今天'),
      location: { mapValue: { fields: { city: restStr('桃園') } } },
      image: { booleanValue: true },
      imageVariants: restMap({ cover: restStr('https://img.test/cover.jpg') }),
    }), 'abc', viewer(null), false);
    expect(text).toEqual({
      title: undefined,
      date: '今天',
      location: undefined,
      image: 'https://img.test/cover.jpg',
    });

    const fallback = selectEarlyEventShellText(doc('abc', {
      title: restStr('圖'),
      image: restStr('http://img.test/a.jpg'),
      imageVariants: restMap({ cover: restStr('javascript:alert(1)') }),
    }), 'abc', viewer(null), false);
    expect(fallback?.image).toBe('http://img.test/a.jpg');

    const blocked = selectEarlyEventShellText(doc('abc', {
      title: restStr('圖'),
      image: restStr('javascript:alert(1)'),
    }), 'abc', viewer(null), false);
    expect(blocked?.image).toBeUndefined();
    expect(blocked?.title).toBe('圖');
  });

  it('沒有可顯示字串就回 null', () => {
    expect(selectEarlyEventShellText(doc('abc', {
      title: { integerValue: '1' },
      date: { nullValue: null },
    }), 'abc', viewer(null), false)).toBeNull();
  });

  it('登入線索且黑名單非空、uid 還沒到時不畫，也不先問可見性', () => {
    const spy = vi.spyOn(visibility, 'isEventVisibleToUser');
    const text = selectEarlyEventShellText(doc('abc', {
      title: restStr('秘密'),
      blockedUids: restArray([restStr('u1')]),
    }), 'abc', viewer(null), true);
    expect(text).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('沒有登入線索的訪客仍看得到黑名單活動；uid 確定後照可見性', () => {
    const secret = doc('abc', {
      title: restStr('秘密'),
      blockedUids: restArray([restStr('u1')]),
    });
    expect(selectEarlyEventShellText(secret, 'abc', viewer(null), false)?.title).toBe('秘密');
    expect(selectEarlyEventShellText(secret, 'abc', viewer('u1'), true)).toBeNull();
    expect(selectEarlyEventShellText(secret, 'abc', viewer('u2'), true)?.title).toBe('秘密');
  });

  it('不寫 storage，原始碼也不碰 phase', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    selectEarlyEventShellText(doc('abc', { title: restStr('青埔') }), 'abc', viewer(null), false);
    expect(setItem).not.toHaveBeenCalled();
    expect(read('early-event-shell.ts')).not.toContain('setPhase');
    expect(read('../components/legacy/EventDetailLoadingShell.tsx')).not.toContain('setPhase');
    const page = read('../pages/EventDetailPage.tsx');
    expect(page.match(/setPhase\('ready'\)/g)).toHaveLength(1);
  });

  it('黑名單超過解碼上限（101 筆）時一律不畫，不當成空黑名單放行', () => {
    const many = Array.from({ length: 101 }, (_v, i) => restStr(`u${i + 1}`));
    const raw = doc('abc', { title: restStr('秘密'), blockedUids: restArray(many) });
    expect(selectEarlyEventShellText(raw, 'abc', viewer(null), false)).toBeNull();
    expect(selectEarlyEventShellText(raw, 'abc', viewer('u101'), false)).toBeNull();
    expect(selectEarlyEventShellText(raw, 'abc', viewer('other'), false)).toBeNull();
  });
});

describe('selectEarlyEventDetail', () => {
  it('頂層欄位都解得開就成完整文件，docId 來自 name', () => {
    const detail = selectEarlyEventDetail(doc('abc', {
      title: restStr('提早標題'),
      date: restStr('2099/10/19 18:30~21:00'),
      location: restStr('提早地點'),
      status: restStr('open'),
      current: restInt(3),
      max: restInt(10),
      privateEvent: { booleanValue: true },
      blockedUids: restArray([restStr('u1')]),
      id: restStr('public-abc'),
    }), 'abc');
    expect(detail).toEqual({
      eventDocId: 'abc',
      event: {
        title: '提早標題',
        date: '2099/10/19 18:30~21:00',
        location: '提早地點',
        status: 'open',
        current: 3,
        max: 10,
        privateEvent: true,
        blockedUids: ['u1'],
        id: 'public-abc',
        _docId: 'abc',
      },
    });
  });

  it('name 不符、頂層解不開、黑名單不是字串陣列時整份回 null', () => {
    const spy = vi.spyOn(visibility, 'isEventVisibleToUser');
    expect(selectEarlyEventDetail(
      doc('old', { id: restStr('abc'), title: restStr('舊文件') }),
      'abc',
    )).toBeNull();
    expect(selectEarlyEventDetail(doc('abc', {
      title: restStr('提早'),
      current: { integerValue: 'nope' },
    }), 'abc')).toBeNull();
    expect(selectEarlyEventDetail(doc('abc', {
      title: restStr('提早'),
      blockedUids: restArray([restInt(1)]),
    }), 'abc')).toBeNull();
    const many = Array.from({ length: 101 }, (_v, i) => restStr(`u${i + 1}`));
    expect(selectEarlyEventDetail(doc('abc', {
      title: restStr('提早'),
      blockedUids: restArray(many),
    }), 'abc')).toBeNull();
    expect(selectEarlyEventDetail(doc('abc', {
      title: restStr('提早'),
      tags: restArray([{ bytesValue: 'qq' }]),
    }), 'abc')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('不寫 storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    selectEarlyEventDetail(doc('abc', { title: restStr('提早') }), 'abc');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('正常巢狀的 teamSplit、delegates 整份保留', () => {
    const detail = selectEarlyEventDetail(doc('abc', {
      title: restStr('提早'),
      teamSplit: restMap({
        enabled: restBool(true),
        mode: restStr('random'),
        teams: restArray([
          restMap({ key: restStr('A'), color: restStr('#111111'), name: restStr('甲隊') }),
        ]),
      }),
      delegates: restArray([
        restMap({ uid: restStr('host1'), name: restStr('小幫手') }),
      ]),
    }), 'abc');
    expect(detail?.event).toMatchObject({
      title: '提早',
      teamSplit: {
        enabled: true,
        mode: 'random',
        teams: [{ key: 'A', color: '#111111', name: '甲隊' }],
      },
      delegates: [{ uid: 'host1', name: '小幫手' }],
    });
  });

  it('巢狀 map 有 bytesValue、深度 5、巢狀陣列 101 筆時整份回 null', () => {
    expect(selectEarlyEventDetail(doc('abc', {
      title: restStr('提早'),
      teamSplit: restMap({
        enabled: restBool(true),
        blob: { bytesValue: 'qq' },
      }),
    }), 'abc')).toBeNull();

    let leaf: Record<string, unknown> = restStr('太深');
    for (let i = 0; i < 5; i += 1) leaf = restMap({ n: leaf });
    expect(selectEarlyEventDetail(doc('abc', {
      title: restStr('提早'),
      teamSplit: leaf,
    }), 'abc')).toBeNull();

    const many = Array.from({ length: 101 }, () => restStr('x'));
    expect(selectEarlyEventDetail(doc('abc', {
      title: restStr('提早'),
      teamSplit: restMap({
        enabled: restBool(true),
        tags: restArray(many),
      }),
    }), 'abc')).toBeNull();
  });
});

describe('readEarlyEventDetail', () => {
  it('等 Promise，記進記憶體，第二次不再等', async () => {
    let resolve!: (value: unknown) => void;
    const promise = new Promise((done) => { resolve = done; });
    window.__fcbEarlyEvent = promise;
    const pending = readEarlyEventDetail('abc');
    resolve(doc('abc', { title: restStr('提早'), status: restStr('open') }));
    await expect(pending).resolves.toMatchObject({
      eventDocId: 'abc',
      event: { title: '提早', status: 'open', _docId: 'abc' },
    });
    expect(readSettledEarlyEvent(promise)?.value).toMatchObject({
      fields: { title: { stringValue: '提早' } },
    });
    await expect(readEarlyEventDetail('abc')).resolves.toMatchObject({ eventDocId: 'abc' });
  });

  it('開頁超過 30 秒回 null，未滿 30 秒仍可用', async () => {
    const now = vi.spyOn(performance, 'now');
    window.__fcbEarlyEvent = Promise.resolve(doc('abc', {
      title: restStr('提早'),
      status: restStr('open'),
    }));
    now.mockReturnValue(EARLY_EVENT_DETAIL_MAX_AGE_MS - 1);
    await expect(readEarlyEventDetail('abc')).resolves.toMatchObject({ eventDocId: 'abc' });
    now.mockReturnValue(EARLY_EVENT_DETAIL_MAX_AGE_MS);
    await expect(readEarlyEventDetail('abc')).resolves.toBeNull();
  });

  it('等待期間超過 30 秒就丟棄，不把過期文件交出去', async () => {
    let resolve!: (value: unknown) => void;
    const promise = new Promise((done) => { resolve = done; });
    window.__fcbEarlyEvent = promise;
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const pending = readEarlyEventDetail('abc');
    now.mockReturnValue(EARLY_EVENT_DETAIL_MAX_AGE_MS);
    resolve(doc('abc', { title: restStr('提早'), status: restStr('open') }));
    await expect(pending).resolves.toBeNull();
  });

  it('採用後第二次呼叫回 null', async () => {
    window.__fcbEarlyEvent = Promise.resolve(doc('abc', {
      title: restStr('提早'),
      status: restStr('open'),
    }));
    await expect(readEarlyEventDetail('abc')).resolves.toMatchObject({ eventDocId: 'abc' });
    markEarlyEventDetailAdopted();
    await expect(readEarlyEventDetail('abc')).resolves.toBeNull();
  });

  it('拒絕時記成 null，不把拒絕丟出去', async () => {
    const rejected = Promise.reject(new Error('boom'));
    const swallowed = rejected.catch(() => undefined);
    window.__fcbEarlyEvent = rejected;
    await expect(readEarlyEventDetail('abc')).resolves.toBeNull();
    await swallowed;
    expect(readSettledEarlyEvent(rejected)?.value).toBeNull();
    await expect(readEarlyEventDetail('abc')).resolves.toBeNull();
  });
});
