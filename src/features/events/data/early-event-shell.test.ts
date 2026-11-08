import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { restArray, restMap, restStr } from '@/features/home/data/__fixtures__/banners-rest';
import {
  earlyEventDocumentNameMatches,
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

afterEach(() => {
  vi.restoreAllMocks();
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
});
