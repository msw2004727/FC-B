import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('../../data/profile-writes', () => ({ updateProfileFields: vi.fn() }));
const routeMock = vi.hoisted(() => vi.fn());
vi.mock('preact-iso', async (importOriginal) => ({
  ...(await importOriginal<typeof import('preact-iso')>()),
  useLocation: () => ({ route: routeMock }),
}));

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import type { UserProfile } from '../../data/profile-model';
import { LegacyProfileInfoCard, PROFILE_CLUBS_PREVIEW } from './LegacyProfileCards';
import { calcAgeFromBirthday } from './profile-legacy-helpers';

/** 台北牆鐘 → 絕對毫秒（台北固定 UTC+8）。 */
function taipeiMs(y: number, m: number, d: number, h = 12, mi = 0): number {
  return Date.UTC(y, m - 1, d, h - 8, mi);
}

function mk(fields: Record<string, unknown> = {}): UserProfile {
  return { uid: 'U-me', name: '王小明', _docId: 'U-me', lastActive: null, ...fields };
}

function renderCard(profile: UserProfile) {
  return render(<LegacyProfileInfoCard embedded uid="U-me" profile={profile} onSaved={() => {}} />);
}

beforeEach(async () => {
  routeMock.mockReset();
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await setLocale('zh-TW');
});

describe('calcAgeFromBirthday（台北時區）', () => {
  it('生日當天滿歲、前一天還沒滿', () => {
    expect(calcAgeFromBirthday('1985/11/21', taipeiMs(2026, 11, 21))).toBe(41);
    expect(calcAgeFromBirthday('1985/11/21', taipeiMs(2026, 11, 20))).toBe(40);
    expect(calcAgeFromBirthday('1985-11-21', taipeiMs(2026, 11, 21))).toBe(41);
  });

  it('以台北日期判斷：UTC 還是前一天、台北已到生日當天就算滿歲', () => {
    // 台北 2026/11/21 00:30 ＝ UTC 2026/11/20 16:30。
    expect(calcAgeFromBirthday('1985/11/21', taipeiMs(2026, 11, 21, 0, 30))).toBe(41);
    // 台北 2026/11/20 23:59 仍是前一天。
    expect(calcAgeFromBirthday('1985/11/21', taipeiMs(2026, 11, 20, 23, 59))).toBe(40);
  });

  it('格式不對、日期不存在、未來日期回 null', () => {
    const now = taipeiMs(2026, 11, 8);
    expect(calcAgeFromBirthday('', now)).toBeNull();
    expect(calcAgeFromBirthday('1985/02/30', now)).toBeNull();
    expect(calcAgeFromBirthday('abc', now)).toBeNull();
    expect(calcAgeFromBirthday('2030/01/01', now)).toBeNull();
    expect(calcAgeFromBirthday(null, now)).toBeNull();
  });
});

describe('我的資料 P2 兩張卡（顯示模式）', () => {
  it('生日小標帶年齡，三格與三列依序顯示', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(taipeiMs(2026, 11, 8)));
    const { container } = renderCard(mk({
      gender: '男',
      birthday: '1985/11/21',
      region: '台中市',
      sports: '足球',
      phone: '0912-345-678',
      createdAt: '2026-02-09T04:00:00Z',
    }));
    const facts = Array.from(container.querySelectorAll('.pfi-fact'));
    expect(facts).toHaveLength(3);
    expect(facts[1]?.querySelector('.pfi-fact-lb')?.textContent).toBe('生日 · 40 歲');
    expect(container.querySelector('#profile-birthday')?.textContent).toBe('1985/11/21');
    expect(container.querySelector('#profile-gender')?.textContent).toBe('男');
    expect(container.querySelector('#profile-region')?.textContent).toBe('台中市');
    const kvLabels = Array.from(container.querySelectorAll('.pfi-kv > span:first-child')).map((el) => el.textContent);
    expect(kvLabels).toEqual(['運動類別', '聯繫方式', '加入時間']);
    expect(container.querySelector('#profile-sports')?.textContent).toBe('足球');
    expect(container.querySelector('#profile-phone')?.textContent).toBe('0912-345-678');
    // 說明「?」在「基本資料」卡標題列。
    expect(container.querySelector('.pfi-card .pfi-hd .edu-info-btn')).not.toBeNull();
  });

  it('空值一律顯示淡色「未設定」，不再顯示「-」，生日沒填也不顯示年齡', () => {
    const { container } = renderCard(mk());
    for (const id of ['profile-gender', 'profile-birthday', 'profile-region', 'profile-sports', 'profile-phone', 'profile-join-date']) {
      const el = container.querySelector(`#${id}`);
      expect(el?.textContent, id).toBe('未設定');
      expect(el?.classList.contains('pfi-empty'), id).toBe(true);
    }
    expect(container.querySelector('#profile-info-display')?.textContent).not.toContain('-');
    expect(container.querySelector('.pfi-age')).toBeNull();
    // 沒有俱樂部：卡片照常顯示，內容是既有空值文案「無」、不顯示個數與展開鈕。
    expect(container.querySelector('#profile-team')?.textContent).toBe('無');
    expect(container.querySelector('.pfi-count')).toBeNull();
    expect(container.querySelector('.pfi-more')).toBeNull();
  });

  it('其他語系的空值文案走 i18n', async () => {
    await setLocale('en');
    const { container } = renderCard(mk());
    expect(container.querySelector('#profile-gender')?.textContent).toBe('Not set');
    expect(container.querySelector('#profile-team')?.textContent).toBe('None');
  });

  it(`俱樂部超過 ${PROFILE_CLUBS_PREVIEW} 個只列前 ${PROFILE_CLUBS_PREVIEW} 個，可展開與收合`, () => {
    const names = ['圖斯特足球俱樂部', '台中星期二足球俱樂部', '流浪貓', '台中星期三足球俱樂部', '台中旅人足球俱樂部', '臺中市足球協會', '測試範本'];
    const { container } = renderCard(mk({
      teamIds: names.map((_, i) => `tm_${i}`),
      teamNames: names,
    }));
    const rows = () => Array.from(container.querySelectorAll('#profile-team .pfi-club'));
    expect(container.querySelector('.pfi-count')?.textContent).toBe('7 個');
    expect(rows()).toHaveLength(4);
    expect(rows().map((r) => r.querySelector('.pfi-club-name')?.textContent)).toEqual(names.slice(0, 4));
    expect(rows()[0]?.querySelector('.pfi-logo')?.textContent).toBe('圖');

    const more = container.querySelector('.pfi-more') as HTMLButtonElement;
    expect(more.textContent).toBe('顯示全部 7 個');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(rows()).toHaveLength(7);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(more.textContent).toBe('收合');
    fireEvent.click(more);
    expect(rows()).toHaveLength(4);
  });

  it('剛好 4 個不出現展開鈕；點俱樂部導到 /teams/{id}', () => {
    const { container } = renderCard(mk({
      teamIds: ['a', 'b', 'c', 'tm 1'],
      teamNames: ['A隊', 'B隊', 'C隊', 'D隊'],
    }));
    expect(container.querySelectorAll('#profile-team .pfi-club')).toHaveLength(4);
    expect(container.querySelector('.pfi-more')).toBeNull();
    fireEvent.click(container.querySelectorAll('#profile-team .pfi-club')[3] as HTMLElement);
    expect(routeMock).toHaveBeenCalledWith('/teams/tm%201');
  });

  it('只有名稱沒有 ID 的俱樂部只顯示、不可點', () => {
    const { container } = renderCard(mk({ teamName: '大安週末足球' }));
    const row = container.querySelector('#profile-team .pfi-club') as HTMLElement;
    expect(row.tagName).toBe('DIV');
    expect(row.textContent).toBe('大大安週末足球');
    fireEvent.click(row);
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('編輯模式不變：仍沿用原本的俱樂部連結與「-」加入時間', () => {
    const { container } = renderCard(mk({ teamIds: ['t1'], teamNames: ['測試俱樂部'] }));
    fireEvent.click(container.querySelector('#profile-edit-btn') as HTMLElement);
    expect(container.querySelector('#profile-team-display .uc-team-link')?.textContent).toBe('測試俱樂部');
    expect(container.querySelector('#profile-join-date-edit')?.textContent).toBe('-');
    // 編輯中沒有基本資料卡標題，說明「?」回到頂端。
    expect(container.querySelector('.profile-quick-help .edu-info-btn')).not.toBeNull();
  });
});
