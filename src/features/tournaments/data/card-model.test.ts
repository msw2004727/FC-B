import { describe, expect, it } from 'vitest';
import { parseTaipei } from '@/core/taipei-time';
import {
  TOURNAMENT_CARD_PERMISSION,
  buildTournamentCardWrite,
  canManageTournamentCards,
  filterTournamentCards,
  formatCardDates,
  isTournamentCardEnded,
  isValidDateKey,
  normalizeHttpsUrl,
  safeImageSrc,
  sortTournamentCards,
  taipeiTodayKey,
  toTournamentCard,
  type TournamentCard,
  type TournamentCardActor,
} from './card-model';

function card(overrides: Partial<TournamentCard>): TournamentCard {
  return {
    id: 'tc_1',
    name: '賽事',
    type: 'cup',
    startDate: '2026-10-09',
    endDate: '2026-10-11',
    url: 'https://cup.toosterx.com/',
    image: '',
    imagePath: '',
    ...overrides,
  };
}

describe('normalizeHttpsUrl：連結只收 https', () => {
  it.each([
    ['https://cup.toosterx.com/', 'https://cup.toosterx.com/'],
    ['  https://example.com/a?b=1  ', 'https://example.com/a?b=1'],
    ['https://example.com/賽事', 'https://example.com/%E8%B3%BD%E4%BA%8B'],
    ['HTTPS://Example.com', 'https://example.com/'],
  ])('允許 %s', (input, expected) => {
    expect(normalizeHttpsUrl(input)).toBe(expected);
  });

  it.each([
    'http://example.com/',
    'javascript:alert(1)',
    'data:text/html,hi',
    '//example.com',
    '/tournaments',
    'https://',
    'ftp://example.com',
    '',
    null,
    42,
    `https://example.com/${'a'.repeat(600)}`,
  ])('拒絕 %s', (input) => {
    expect(normalizeHttpsUrl(input)).toBe('');
  });
});

describe('safeImageSrc', () => {
  it('只收 http(s)', () => {
    expect(safeImageSrc('https://x/a.webp')).toBe('https://x/a.webp');
    expect(safeImageSrc('http://127.0.0.1:9199/v0/b/x/o/a')).toBe('http://127.0.0.1:9199/v0/b/x/o/a');
    expect(safeImageSrc('javascript:alert(1)')).toBe('');
    expect(safeImageSrc(undefined)).toBe('');
  });
});

describe('isValidDateKey', () => {
  it('YYYY-MM-DD 且是真的日期', () => {
    expect(isValidDateKey('2026-10-09')).toBe(true);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026/10/09')).toBe(false);
    expect(isValidDateKey('2026-1-9')).toBe(false);
    expect(isValidDateKey(20261009)).toBe(false);
  });
});

describe('toTournamentCard', () => {
  it('合格文件轉成卡片', () => {
    expect(
      toTournamentCard('tc_1', {
        name: ' FEDA CUP 2026 飛達盃 ',
        type: 'cup',
        startDate: '2026-10-09',
        endDate: '2026-10-11',
        url: 'https://cup.toosterx.com/',
        image: 'https://x/a.webp',
        imagePath: 'tournamentCards/tc_1/cover_1.webp',
        createdBy: 'u1',
      }),
    ).toEqual({
      id: 'tc_1',
      name: 'FEDA CUP 2026 飛達盃',
      type: 'cup',
      startDate: '2026-10-09',
      endDate: '2026-10-11',
      url: 'https://cup.toosterx.com/',
      image: 'https://x/a.webp',
      imagePath: 'tournamentCards/tc_1/cover_1.webp',
    });
  });

  it.each([
    ['類型不對', { type: 'open' }],
    ['日期格式不對', { startDate: '2026/10/09' }],
    ['連結不是 https', { url: 'http://cup.toosterx.com/' }],
    ['連結是 javascript', { url: 'javascript:alert(1)' }],
  ])('%s 的文件不顯示', (_label, patch) => {
    const raw = {
      name: 'x',
      type: 'cup',
      startDate: '2026-10-09',
      endDate: '2026-10-11',
      url: 'https://cup.toosterx.com/',
      ...patch,
    };
    expect(toTournamentCard('tc_1', raw)).toBeNull();
  });

  it('圖片網址不安全時不顯示圖片', () => {
    const result = toTournamentCard('tc_1', {
      name: 'x',
      type: 'league',
      startDate: '2026-10-09',
      endDate: '2026-10-09',
      url: 'https://a.com/',
      image: 'javascript:alert(1)',
    });
    expect(result?.image).toBe('');
  });
});

describe('排序、已結束、篩選', () => {
  const today = taipeiTodayKey(parseTaipei('2026/11/02 12:00') as number);

  it('台北今天：UTC 前一天的 16:00 之後已是台北隔天', () => {
    expect(today).toBe('2026-11-02');
    expect(taipeiTodayKey(Date.parse('2026-11-01T16:30:00Z'))).toBe('2026-11-02');
    expect(taipeiTodayKey(Date.parse('2026-11-01T15:59:00Z'))).toBe('2026-11-01');
  });

  it('開始日新→舊，同一天維持原順序', () => {
    const list = sortTournamentCards([
      card({ id: 'a', startDate: '2026-10-09' }),
      card({ id: 'b', startDate: '2027-03-06' }),
      card({ id: 'c', startDate: '2026-11-15' }),
      card({ id: 'd', startDate: '2026-11-15' }),
    ]);
    expect(list.map((c) => c.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('已結束＝結束日 < 今天；結束日是今天不算結束', () => {
    expect(isTournamentCardEnded({ endDate: '2026-11-01' }, today)).toBe(true);
    expect(isTournamentCardEnded({ endDate: '2026-11-02' }, today)).toBe(false);
    expect(isTournamentCardEnded({ endDate: '2026-12-01' }, today)).toBe(false);
  });

  const cards = [
    card({ id: 'league', type: 'league', startDate: '2027-03-06', endDate: '2027-05-29' }),
    card({ id: 'friendly', type: 'friendly', startDate: '2026-11-15', endDate: '2026-11-15' }),
    card({ id: 'cup-ended', type: 'cup', startDate: '2026-10-09', endDate: '2026-10-11' }),
  ];

  it('全部＋顯示已結束：全部顯示', () => {
    expect(filterTournamentCards(cards, 'all', true, today).map((c) => c.id)).toEqual([
      'league',
      'friendly',
      'cup-ended',
    ]);
  });

  it('頁籤只留該類型', () => {
    expect(filterTournamentCards(cards, 'cup', true, today).map((c) => c.id)).toEqual(['cup-ended']);
    expect(filterTournamentCards(cards, 'league', true, today).map((c) => c.id)).toEqual(['league']);
    expect(filterTournamentCards(cards, 'friendly', true, today).map((c) => c.id)).toEqual(['friendly']);
  });

  it('關掉「顯示已結束」：移除已結束', () => {
    expect(filterTournamentCards(cards, 'all', false, today).map((c) => c.id)).toEqual([
      'league',
      'friendly',
    ]);
    expect(filterTournamentCards(cards, 'cup', false, today)).toEqual([]);
  });
});

describe('formatCardDates', () => {
  it('同一天只顯示一次', () => {
    expect(formatCardDates({ startDate: '2026-10-09', endDate: '2026-10-11' })).toBe('2026/10/09～2026/10/11');
    expect(formatCardDates({ startDate: '2026-11-15', endDate: '2026-11-15' })).toBe('2026/11/15');
  });
});

describe('buildTournamentCardWrite', () => {
  const valid = {
    name: ' FEDA CUP 2026 飛達盃 ',
    type: 'cup',
    startDate: '2026-10-09',
    endDate: '2026-10-11',
    url: 'https://cup.toosterx.com/',
  };

  it('合格：去空白、連結正規化', () => {
    expect(buildTournamentCardWrite(valid)).toEqual({
      ok: true,
      write: {
        name: 'FEDA CUP 2026 飛達盃',
        type: 'cup',
        startDate: '2026-10-09',
        endDate: '2026-10-11',
        url: 'https://cup.toosterx.com/',
      },
    });
  });

  it.each([
    ['name', { name: '   ' }],
    ['name', { name: 'x'.repeat(81) }],
    ['type', { type: '' }],
    ['type', { type: 'open' }],
    ['date', { startDate: '' }],
    ['date', { endDate: '2026-02-30' }],
    ['dateOrder', { startDate: '2026-10-12', endDate: '2026-10-11' }],
    ['url', { url: 'http://cup.toosterx.com/' }],
    ['url', { url: 'javascript:alert(1)' }],
  ])('錯誤 %s', (error, patch) => {
    expect(buildTournamentCardWrite({ ...valid, ...patch })).toEqual({ ok: false, error });
  });

  it('開始日＝結束日可以', () => {
    expect(buildTournamentCardWrite({ ...valid, endDate: '2026-10-09' }).ok).toBe(true);
  });
});

describe('canManageTournamentCards：按鈕與寫入共用同一個判斷', () => {
  function actor(role: string, has: boolean, uid: string | null = `u_${role}`): TournamentCardActor {
    return { uid, role, hasPermission: (code) => has && code === TOURNAMENT_CARD_PERMISSION };
  }

  it.each([
    ['持有 admin.tournaments.entry 的 admin', actor('admin', true)],
    ['持有個別授權的一般用戶', actor('user', true)],
    ['總管（即使 hasPermission 回 false）', actor('super_admin', false)],
  ])('允許：%s', (_label, a) => {
    expect(canManageTournamentCards(a)).toBe(true);
  });

  it.each([
    ['一般用戶', actor('user', false)],
    ['沒有權限碼的 coach', actor('coach', false)],
    ['沒有權限碼的 admin', actor('admin', false)],
    ['訪客（uid 為 null）', actor('super_admin', true, null)],
    ['null', null],
    ['undefined', undefined],
  ])('拒絕：%s', (_label, a) => {
    expect(canManageTournamentCards(a)).toBe(false);
  });

  it('只認 admin.tournaments.entry，不認其他碼', () => {
    const other: TournamentCardActor = { uid: 'u1', role: 'admin', hasPermission: (code) => code === 'admin.tournaments.create' };
    expect(canManageTournamentCards(other)).toBe(false);
  });
});
