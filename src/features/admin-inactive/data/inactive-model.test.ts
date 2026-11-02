import { describe, expect, it } from 'vitest';

import { loginBoundaries, mapInactiveEvent, mapInactiveTeam, mapStatusUser, toMillis } from './inactive-model';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 2, 4, 0, 0);
const ts = (ms: number) => ({ toMillis: () => ms });

/** A `_renderUserStatusCheck` 的分組（天數 floor 後比 30／90）。 */
function aGroup(daysAgoMs: number): 'active' | 'mid' | 'over90' {
  const days = Math.floor(daysAgoMs / DAY);
  if (days > 90) return 'over90';
  if (days > 30) return 'mid';
  return 'active';
}

function bGroup(lastLoginMs: number): 'active' | 'mid' | 'over90' {
  const { activeAfterMs, over90AtOrBeforeMs } = loginBoundaries(NOW);
  if (lastLoginMs > activeAfterMs) return 'active';
  if (lastLoginMs > over90AtOrBeforeMs) return 'mid';
  return 'over90';
}

describe('loginBoundaries 與 A 的天數分組一致', () => {
  it.each([0, 1, 30 * DAY, 31 * DAY - 1, 31 * DAY, 31 * DAY + 1, 90 * DAY, 91 * DAY - 1, 91 * DAY, 91 * DAY + 1, 400 * DAY])(
    '距今 %d 毫秒',
    (ago) => {
      expect(bGroup(NOW - ago)).toBe(aGroup(ago));
    },
  );
});

describe('mapStatusUser', () => {
  it('照 A：顯示名 displayName → name；日期 Y/M/D；天數 floor', () => {
    const last = NOW - 45 * DAY - 5000;
    const user = mapStatusUser('doc1', { uid: 'U1', displayName: '小明', role: 'coach', lastLogin: ts(last), pictureUrl: 'https://x/p.png' }, NOW);
    const d = new Date(last);
    expect(user).toEqual({
      id: 'doc1', uid: 'U1', name: '小明', roleLabel: '教練', pictureUrl: 'https://x/p.png',
      lastLoginStr: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`, daysSince: 45,
    });
  });

  it('沒有最後登入：從未登入、9999 天；角色缺省為一般用戶；未知角色顯示原字串', () => {
    expect(mapStatusUser('doc2', { name: '舊名' }, NOW)).toMatchObject({
      uid: 'doc2', name: '舊名', roleLabel: '一般用戶', lastLoginStr: '從未登入', daysSince: 9999,
    });
    expect(mapStatusUser('doc3', { role: 'custom_x' }, NOW).roleLabel).toBe('custom_x');
  });

  it('沒有名字顯示「未知」，不顯示原始 UID', () => {
    expect(mapStatusUser('doc4', { uid: 'U-raw' }, NOW)).toMatchObject({ uid: 'U-raw', name: '未知' });
    expect(mapStatusUser('doc5', {}, NOW)).toMatchObject({ uid: 'doc5', name: '未知' });
  });

  it('toMillis 支援 toMillis／seconds，其他回 null', () => {
    expect(toMillis(ts(5))).toBe(5);
    expect(toMillis({ seconds: 2 })).toBe(2000);
    expect(toMillis('2026/01/01')).toBeNull();
    expect(toMillis(null)).toBeNull();
  });
});

describe('俱樂部／活動對應', () => {
  it('俱樂部：name、captain、members、region；缺值給空字串與 0', () => {
    expect(mapInactiveTeam('tm_1', { name: 'A隊', captain: '王', members: 7, region: '台北' }))
      .toEqual({ id: 'tm_1', name: 'A隊', captain: '王', members: 7, region: '台北' });
    expect(mapInactiveTeam('tm_2', undefined)).toEqual({ id: 'tm_2', name: '', captain: '', members: 0, region: '' });
  });

  it('活動：ended／cancelled 與 A 欄位', () => {
    expect(mapInactiveEvent('ce_1', { title: 'T', status: 'ended', date: '2026/10/01', location: 'L', creator: 'C', current: 3, max: 10 }))
      .toEqual({ id: 'ce_1', title: 'T', status: 'ended', date: '2026/10/01', location: 'L', creator: 'C', current: 3, max: 10 });
    expect(mapInactiveEvent('ce_2', { status: 'cancelled' }).status).toBe('cancelled');
  });
});
