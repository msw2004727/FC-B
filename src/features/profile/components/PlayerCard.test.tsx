import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('preact-iso', () => ({
  useLocation: () => ({ route: vi.fn() }),
}));
vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => ({}),
  userLevelFromExp: () => 0,
}));
vi.mock('@/data/identity-settings', () => ({
  useIdentitySettings: () => ({}),
}));
vi.mock('@/data/identity-resolver', () => ({
  getEffectiveIdentity: () => ({
    displayName: '王小明',
    pictureUrl: 'https://profile.line-scdn.net/abc',
    identityId: 'primary',
  }),
}));
const canvasMock = vi.hoisted(() => ({
  renderPlayerCardPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}));
vi.mock('../data/player-card-canvas', () => canvasMock);
const shareMock = vi.hoisted(() => ({
  sharePlayerCardBlob: vi.fn(async () => 'overlay'),
  browserDownload: vi.fn(),
  blobToDataUrl: vi.fn(async () => 'data:image/png;base64,AAAA'),
}));
vi.mock('../data/player-card-share', () => shareMock);

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import type { UserProfile } from '../data/profile-model';
import type { ViewerView } from '../data/viewer';
import type { UserAttendanceSummary } from '../data/attendance-summary';
import { LegacyProfileTopSection } from './legacy/LegacyProfileHeader';
import { resolveShineMode } from './PlayerCard';

const profile = { exp: 0 } as unknown as UserProfile;

function viewer(role = 'user', teamIds: string[] = []): ViewerView {
  return {
    uid: 'U-me',
    role,
    roleLevel: 1,
    teamIds: new Set(teamIds),
    capabilities: [],
    displayName: null,
    pictureUrl: null,
    hasPermission: () => false,
  } as ViewerView;
}

const summary: UserAttendanceSummary = {
  uid: 'U-me',
  exists: true,
  sourceVersion: 1,
  expectedCount: 26,
  attendedCount: 22,
  completedCount: 14,
  attendRate: 85,
  updatedAt: null,
};

function stubMatchMedia(reduced: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function renderTop(v: ViewerView, s: UserAttendanceSummary | null = summary) {
  return render(<LegacyProfileTopSection uid="U-me" profile={profile} viewer={v} summary={s} />);
}

describe('T-092 球員卡（DOM）', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    await setLocale('zh-TW');
    vi.clearAllMocks();
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
  });

  it('卡片外順序：卡片 → UID＋QR → 身分標籤 → 分享球員卡', () => {
    const { container } = renderTop(viewer());
    const order = ['.player-card', '#profile-uid-wrap', '#profile-role-tag-wrap', '#player-card-share-btn']
      .map((sel) => container.querySelector(sel));
    order.forEach((el) => expect(el).not.toBeNull());
    for (let i = 1; i < order.length; i++) {
      const prev = order[i - 1]!;
      const next = order[i]!;
      expect(prev.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // UID、身分標籤與分享按鈕都不在卡片內（PNG 也不含）
    const card = container.querySelector('.player-card')!;
    expect(card.contains(container.querySelector('#profile-uid-wrap'))).toBe(false);
    expect(card.contains(container.querySelector('#profile-role-tag-wrap'))).toBe(false);
    expect(card.contains(container.querySelector('#player-card-share-btn'))).toBe(false);
  });

  it('卡面：三格中文＋英文縮寫、出席率大數字、計量條、球員卡標題、logo', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const { container } = renderTop(viewer());
    const card = container.querySelector('.player-card')!;
    expect(card.querySelector('#profile-stat-total')?.textContent).toBe('26');
    expect(card.querySelector('#profile-stat-done')?.textContent).toBe('14');
    expect(card.querySelector('#profile-stat-rate')?.textContent).toBe('85%');
    expect(card.querySelector('.player-card-att-num')?.textContent).toBe('85%');
    expect(card.textContent).toContain('球員卡');
    expect(card.textContent).toContain('PLAYER CARD');
    for (const label of ['應到', '完成', '出席率', 'SCH', 'CMP', 'ATT']) {
      expect(card.textContent).toContain(label);
    }
    expect((card.querySelector('.player-card-gauge-fill') as HTMLElement).style.width).toBe('85%');
    expect(card.querySelector('.player-card-logo')?.getAttribute('src')).toBe('/assets/logo-black.webp');
    expect(card.querySelector('#profile-title')?.textContent).toBe('王小明');
  });

  it('深色模式 logo 換白色版', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { container } = renderTop(viewer());
    expect(container.querySelector('.player-card-logo')?.getAttribute('src')).toBe('/assets/logo-white.webp');
  });

  it('管理員看得到 UID，但只在卡片外', () => {
    const { container } = renderTop(viewer('admin'));
    expect(container.querySelector('#profile-uid-wrap')?.textContent).toContain('U-me');
    expect(container.querySelector('.player-card')?.textContent).not.toContain('U-me');
  });

  it('俱樂部數 0 不顯示方塊；有俱樂部顯示數字、兩位數加寬', () => {
    const none = renderTop(viewer('user', []));
    expect(none.container.querySelector('.player-card-club')).toBeNull();
    cleanup();
    const two = renderTop(viewer('user', ['t1', 't2', 't2']));
    const badge = two.container.querySelector('.player-card-club')!;
    expect(badge.textContent).toContain('俱樂部');
    expect(badge.querySelector('.player-card-club-num')?.textContent).toBe('2');
    expect(badge.classList.contains('is-wide')).toBe(false);
    cleanup();
    const many = renderTop(viewer('user', Array.from({ length: 12 }, (_, i) => `t${i}`)));
    expect(many.container.querySelector('.player-card-club')?.classList.contains('is-wide')).toBe(true);
  });

  it('summary 未載入時三格與大數字顯示 --', () => {
    const { container } = renderTop(viewer(), null);
    expect(container.querySelector('#profile-stat-total')?.textContent).toBe('--');
    expect(container.querySelector('.player-card-att-num')?.textContent).toBe('--');
  });

  it('反光：一般掃光；prefers-reduced-motion 改靜態斜光；頁面隱藏暫停', () => {
    expect(resolveShineMode(false, false)).toBe('sweep');
    expect(resolveShineMode(false, true)).toBe('paused');
    expect(resolveShineMode(true, false)).toBe('static');
    expect(resolveShineMode(true, true)).toBe('static');

    const normal = renderTop(viewer());
    expect(normal.container.querySelector('.player-card')?.classList.contains('is-shine-sweep')).toBe(true);
    cleanup();

    stubMatchMedia(true);
    const reduced = renderTop(viewer());
    const card = reduced.container.querySelector('.player-card')!;
    expect(card.classList.contains('is-shine-static')).toBe(true);
    expect(card.classList.contains('is-shine-sweep')).toBe(false);
  });

  it('按分享球員卡：動態載入產圖，覆蓋層路徑顯示圖片供長按存圖', async () => {
    const { container } = renderTop(viewer('user', ['t1']));
    fireEvent.click(container.querySelector('#player-card-share-btn')!);
    await waitFor(() => expect(document.querySelector('.player-card-overlay img')).not.toBeNull());
    expect(canvasMock.renderPlayerCardPng).toHaveBeenCalledTimes(1);
    const [model, , labels] = canvasMock.renderPlayerCardPng.mock.calls[0] as unknown as [
      { clubCount: number; attendText: string }, string, { title: string },
    ];
    expect(model.clubCount).toBe(1);
    expect(model.attendText).toBe('85%');
    expect(labels.title).toBe('球員卡');
    expect(JSON.stringify(model)).not.toContain('U-me');
    expect(document.querySelector('.player-card-overlay img')?.getAttribute('src'))
      .toBe('data:image/png;base64,AAAA');
    expect(document.querySelector('.player-card-overlay')?.textContent).toContain('長按圖片即可儲存');
    fireEvent.click(document.querySelector('.player-card-overlay-close')!);
    await waitFor(() => expect(document.querySelector('.player-card-overlay')).toBeNull());
  });
});
