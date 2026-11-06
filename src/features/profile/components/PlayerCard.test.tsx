import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, createEvent, fireEvent, render, waitFor } from '@testing-library/preact';
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
const identity = vi.hoisted(() => ({
  current: {
    displayName: '王小明',
    pictureUrl: 'https://profile.line-scdn.net/abc' as string | null,
    identityId: 'primary',
  },
}));
vi.mock('@/data/identity-resolver', () => ({
  getEffectiveIdentity: () => identity.current,
}));
const canvasMock = vi.hoisted(() => ({
  renderPlayerCardPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  ensurePlayerCardFonts: vi.fn(async () => undefined),
  browserRenderDeps: { tag: 'browser-deps' },
}));
vi.mock('../data/player-card-canvas', () => canvasMock);
const shareMock = vi.hoisted(() => ({
  PLAYER_CARD_FILE_NAME: 'toosterx-player-card.png',
  sharePlayerCardBlob: vi.fn(async (): Promise<string> => 'overlay'),
  browserDownload: vi.fn(),
  blobToDataUrl: vi.fn(async () => 'data:image/png;base64,AAAA'),
  makePlayerCardFile: vi.fn((blob: Blob) => new File([blob], 'toosterx-player-card.png', { type: 'image/png' })),
  retrySharePlayerCardFile: vi.fn(async (): Promise<string> => 'shared'),
}));
vi.mock('../data/player-card-share', () => shareMock);
const qrcodeLoaded = vi.hoisted(() => ({ count: 0 }));
vi.mock('qrcode', () => {
  qrcodeLoaded.count += 1;
  return { create: vi.fn(), default: { create: vi.fn() } };
});

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { UserProfile } from '../data/profile-model';
import type { ViewerView } from '../data/viewer';
import type { UserAttendanceSummary } from '../data/attendance-summary';
import { LegacyProfileTopSection } from './legacy/LegacyProfileHeader';
import { playerCardShineCssGradient, playerCardShineLayers } from '../data/player-card-model';
import { options } from 'preact';
import { PLAYER_CARD_SAFE_MAX_RPM, playerCardShineOffsetPct, rpmToNeedleDeg } from './player-card-spin';
import { _resetPlayerCardPreloadForTest } from './PlayerCardShareButton';
import { _resetOverlayBackForTest } from '@/core/overlay-back';

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

/** 把 inline style 字串正規化成瀏覽器序列化格式後比對。 */
function cssTextOf(style: string): string {
  const el = document.createElement('div');
  el.setAttribute('style', style);
  return el.style.cssText;
}

function renderTop(v: ViewerView, s: UserAttendanceSummary | null = summary) {
  return render(<LegacyProfileTopSection uid="U-me" profile={profile} viewer={v} summary={s} />);
}

describe('T-092 球員卡（DOM）', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    await setLocale('zh-TW');
    vi.clearAllMocks();
    _resetPlayerCardPreloadForTest();
    _resetOverlayBackForTest();
    stubMatchMedia(false);
    identity.current = {
      displayName: '王小明',
      pictureUrl: 'https://profile.line-scdn.net/abc',
      identityId: 'primary',
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
  });

  it('卡片外順序：身分標籤（卡片上方）→ 卡片 → UID＋QR → 分享球員卡', () => {
    const { container } = renderTop(viewer());
    const order = ['#profile-role-tag-wrap', '.player-card', '#profile-uid-wrap', '#player-card-share-btn']
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
    // 身分標籤與鎖頭同一列（卡片上方外側），不在會旋轉的舞台裡
    const topbar = container.querySelector('.player-card-topbar')!;
    expect(topbar.contains(container.querySelector('#profile-role-tag-wrap'))).toBe(true);
    expect(container.querySelector('.player-card-stage')!.contains(topbar)).toBe(false);
  });

  // 測試同步更新（站長 11-06 放鴿子／出席率 v2）：「應到」改「參與」、縮寫 SCH 改 APP；沒有 v2 仍顯示 ATT、無「計 N 場」。
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
    for (const label of ['參與', '完成', '出席率', 'APP', 'CMP', 'ATT']) {
      expect(card.textContent).toContain(label);
    }
    expect((card.querySelector('.player-card-gauge-fill') as HTMLElement).style.width).toBe('85%');
    expect(card.querySelector('.player-card-logo')?.getAttribute('src')).toBe('/assets/logo-black.webp');
    expect(card.querySelector('#profile-title')?.textContent).toBe('王小明');
  });

  it('沒有 v2：出席率下方是 ATT 縮寫，沒有「計 N 場」，也沒有 SCH', () => {
    const { container } = renderTop(viewer());
    const card = container.querySelector('.player-card')!;
    expect(card.querySelector('.player-card-counted')).toBeNull();
    expect(card.textContent).not.toContain('SCH');
    expect(card.textContent).not.toMatch(/計 d+ 場/);
  });

  it.each([
    { counted: 12, completed: 9, rate: '75%', gauge: '75%' },
    { counted: 2, completed: 1, rate: '1/2', gauge: '50%' },
    { counted: 0, completed: 0, rate: '--', gauge: '0%' },
  ])('v2：參與／完成／出席率 $rate，「計 $counted 場」放在 ATT 縮寫位置', ({ counted, completed, rate, gauge }) => {
    const { container } = renderTop(viewer(), {
      ...summary,
      v2: { since: '2026-11-06', participatedCount: 20, countedCount: counted, countedCompletedCount: completed, countedNoShowCount: 0 },
    });
    const card = container.querySelector('.player-card')!;
    expect(card.querySelector('#profile-stat-total')?.textContent).toBe('20');
    expect(card.querySelector('#profile-stat-done')?.textContent).toBe(String(completed));
    expect(card.querySelector('#profile-stat-rate')?.textContent).toBe(rate);
    expect(card.querySelector('.player-card-att-num')?.textContent).toBe(rate);
    const abbr = card.querySelector('#profile-stat-rate')!.parentElement!.querySelector('.player-card-abbr');
    expect(abbr?.classList.contains('player-card-counted')).toBe(true);
    expect(abbr?.textContent).toBe(`計 ${counted} 場`);
    // 三格內出席率下方的 ATT 縮寫在 v2 由「計 N 場」取代（左上大數字的 ATT 不動）；SCH 已改 APP。
    expect(card.textContent).not.toContain('SCH');
    expect((card.querySelector('.player-card-gauge-fill') as HTMLElement).style.width).toBe(gauge);
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

  it('固定斜光：網頁卡面無動畫、無計時器，淺深兩版都有斜光且與 PNG 同一組常數；減少動態時照常顯示同一道光', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const rafSpy = vi.fn();
    vi.stubGlobal('requestAnimationFrame', rafSpy);
    const animate = vi.fn();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    try {
      document.documentElement.setAttribute('data-theme', 'light');
      const lightView = renderTop(viewer());
      const card = lightView.container.querySelector('.player-card')!;
      expect([...card.classList].some((c) => c.startsWith('is-shine'))).toBe(false);
      const shines = [...card.querySelectorAll(':scope > .player-card-shine')] as HTMLElement[];
      const lightLayers = playerCardShineLayers('light', 'front');
      expect(shines).toHaveLength(2);
      shines.forEach((shine, i) => {
        expect(shine.getAttribute('aria-hidden')).toBe('true');
        expect(shine.style.cssText).toBe(cssTextOf(`background:${playerCardShineCssGradient(lightLayers[i]!)}`));
        expect(shine.style.background).toContain('115deg');
        expect(shine.style.width).toBe('');
        expect(shine.style.transform).toBe('');
        expect(shine.style.animation).toBe('');
      });
      // 第①層 soft-light（CSS class 設 mix-blend-mode），第②層一般疊加；淺色 alpha 為預覽減半
      expect(shines[0]!.classList.contains('is-soft-light')).toBe(true);
      expect(shines[1]!.classList.contains('is-soft-light')).toBe(false);
      expect(shines[0]!.style.background).toContain('rgba(255, 255, 240, 0.425) 50%');
      expect(shines[1]!.style.background).toContain('rgba(255, 250, 232, 0.225) 50%');
      // 斜光是最後兩層（與 PNG 一樣疊在內容上）
      expect(card.lastElementChild).toBe(shines[1]);
      expect(shines[1]!.previousElementSibling).toBe(shines[0]);
      // 淺色背面只有第②層
      const back = lightView.container.querySelector('.player-card-back')!;
      const backShines = [...back.querySelectorAll('.player-card-shine')] as HTMLElement[];
      expect(backShines).toHaveLength(1);
      expect(backShines[0]!.classList.contains('is-soft-light')).toBe(false);
      expect(backShines[0]!.style.cssText).toBe(shines[1]!.style.cssText);
      const lightStyle = shines[1]!.style.cssText;
      cleanup();

      stubMatchMedia(true);
      document.documentElement.setAttribute('data-theme', 'light');
      const reduced = renderTop(viewer());
      expect((reduced.container.querySelector('.player-card .player-card-shine:last-child') as HTMLElement).style.cssText)
        .toBe(lightStyle);
      cleanup();

      document.documentElement.setAttribute('data-theme', 'dark');
      const darkView = renderTop(viewer());
      const darkShines = [...darkView.container.querySelectorAll('.player-card > .player-card-shine')] as HTMLElement[];
      expect(darkShines).toHaveLength(1);
      const darkShine = darkShines[0]!;
      expect(darkShine.style.cssText).toBe(
        cssTextOf(`background:${playerCardShineCssGradient(playerCardShineLayers('dark', 'front')[0]!)}`),
      );
      expect(darkShine.classList.contains('is-soft-light')).toBe(false);
      expect(darkShine.style.cssText).not.toBe(lightStyle);
      expect(darkShine.style.background).toContain('rgba(255, 255, 255, 0.2) 50%');
      const darkBack = [...darkView.container.querySelectorAll('.player-card-back .player-card-shine')] as HTMLElement[];
      expect(darkBack).toHaveLength(1);
      expect(darkBack[0]!.style.cssText).toBe(darkShine.style.cssText);

      expect(animate).not.toHaveBeenCalled();
      expect(rafSpy).not.toHaveBeenCalled();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      // 卡片本身不排計時器（分享按鈕的閒置預載另有 requestIdleCallback／setTimeout 1500，非動畫）
      expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 3000)).toBe(false);
    } finally {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
    }
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
    // 底部「關閉」已移除，改右上角 X
    expect(document.querySelector('.player-card-overlay-close')).toBeNull();
    const x = document.querySelector('.player-card-overlay-x') as HTMLButtonElement;
    expect(x.getAttribute('aria-label')).toBe('關閉');
    await waitFor(() => expect(document.activeElement).toBe(x));
    fireEvent.click(x);
    await waitFor(() => expect(document.querySelector('.player-card-overlay')).toBeNull());
  });

  it('P2-1：沒有名字時身分解析退回 UID，卡面與 PNG 模型都不得出現 UID', async () => {
    // getMainIdentity 在無 displayName／name 時以 uid 當名字（舊行為不改），卡片要自己擋。
    identity.current = { displayName: ' U-me ', pictureUrl: null, identityId: 'primary' };
    const { container } = renderTop(viewer('user', ['t1']));
    const card = container.querySelector('.player-card')!;
    expect(card.querySelector('#profile-title')?.textContent).toBe('-');
    expect(card.textContent).not.toContain('U-me');
    fireEvent.click(container.querySelector('#player-card-share-btn')!);
    await waitFor(() => expect(canvasMock.renderPlayerCardPng).toHaveBeenCalledTimes(1));
    const [model] = canvasMock.renderPlayerCardPng.mock.calls[0] as unknown as [{ name: string }];
    expect(model.name).toBe('-');
    expect(JSON.stringify(model)).not.toContain('U-me');
  });

  it('LINE 覆蓋層：提示長按存圖，沒有分享／儲存按鈕', async () => {
    shareMock.sharePlayerCardBlob.mockResolvedValueOnce('overlay');
    const { container } = renderTop(viewer());
    fireEvent.click(container.querySelector('#player-card-share-btn')!);
    await waitFor(() => expect(document.querySelector('.player-card-overlay')).not.toBeNull());
    expect(document.querySelector('.player-card-overlay')?.textContent).toContain('長按圖片即可儲存');
    expect(document.querySelector('#player-card-share-again')).toBeNull();
    expect(document.querySelector('#player-card-save')).toBeNull();
    // LINE 只有圖片＋提示＋右上 X
    expect(document.querySelector('.player-card-overlay-actions')).toBeNull();
    expect(document.querySelectorAll('.player-card-overlay button')).toHaveLength(1);
    expect(document.querySelector('.player-card-overlay-x')).not.toBeNull();
  });

  it('覆蓋層關閉方式：點圖片不關、點提示或遮罩空白處關閉；Esc 關閉', async () => {
    const open = async (): Promise<void> => {
      shareMock.sharePlayerCardBlob.mockResolvedValueOnce('overlay');
      fireEvent.click(document.querySelector('#player-card-share-btn')!);
      await waitFor(() => expect(document.querySelector('.player-card-overlay')).not.toBeNull());
      // 等覆蓋層的 effect（Esc、返回鍵登記與焦點）跑完
      await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.player-card-overlay-x')));
    };
    const gone = async (): Promise<void> => {
      await waitFor(() => expect(document.querySelector('.player-card-overlay')).toBeNull());
    };
    renderTop(viewer());

    await open();
    fireEvent.click(document.querySelector('.player-card-overlay img')!);
    expect(document.querySelector('.player-card-overlay')).not.toBeNull();
    fireEvent.click(document.querySelector('.player-card-overlay')!);
    await gone();

    await open();
    fireEvent.click(document.querySelector('.player-card-overlay-hint')!);
    await gone();

    await open();
    fireEvent.keyDown(document, { key: 'Escape' });
    await gone();
  });

  it('覆蓋層：返回鍵（popstate）關閉', async () => {
    shareMock.sharePlayerCardBlob.mockResolvedValueOnce('overlay');
    renderTop(viewer());
    fireEvent.click(document.querySelector('#player-card-share-btn')!);
    await waitFor(() => expect(document.querySelector('.player-card-overlay')).not.toBeNull());
    // 覆蓋層的 effect（登記返回鍵、Esc、焦點）跑完才送返回鍵：以焦點已到 X 為準
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.player-card-overlay-x')));
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(document.querySelector('.player-card-overlay')).toBeNull());
  });

  it('P2-2：系統分享被拒（retry）→ 覆蓋層提示不寫長按，第二次點分享同步呼叫同一張 PNG，儲存走下載', async () => {
    shareMock.sharePlayerCardBlob.mockResolvedValueOnce('retry');
    const { container } = renderTop(viewer());
    fireEvent.click(container.querySelector('#player-card-share-btn')!);
    await waitFor(() => expect(document.querySelector('#player-card-share-again')).not.toBeNull());
    const overlay = document.querySelector('.player-card-overlay')!;
    expect(overlay.textContent).toContain('分享／儲存球員卡');
    expect(overlay.textContent).not.toContain('長按');
    // 分享置中為主按鈕、儲存在下方為次要樣式；沒有底部「關閉」，焦點在右上 X
    const actions = overlay.querySelector('.player-card-overlay-actions')!;
    const shareBtn = actions.querySelector('#player-card-share-again')!;
    const saveBtn = actions.querySelector('#player-card-save')!;
    expect(shareBtn.classList.contains('is-primary')).toBe(true);
    expect(saveBtn.classList.contains('is-secondary')).toBe(true);
    expect(shareBtn.compareDocumentPosition(saveBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(overlay.querySelector('.player-card-overlay-close')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(overlay.querySelector('.player-card-overlay-x')));
    // 點按鈕不會被當成點遮罩而關閉
    fireEvent.click(saveBtn);
    expect(document.querySelector('.player-card-overlay')).not.toBeNull();
    shareMock.browserDownload.mockClear();
    const blob = await canvasMock.renderPlayerCardPng.mock.results[0]!.value;

    fireEvent.click(document.querySelector('#player-card-save')!);
    expect(shareMock.browserDownload).toHaveBeenCalledWith(blob, 'toosterx-player-card.png');

    fireEvent.click(document.querySelector('#player-card-share-again')!);
    // 點擊當下（未經任何 await）就已呼叫分享
    expect(shareMock.retrySharePlayerCardFile).toHaveBeenCalledTimes(1);
    expect(shareMock.makePlayerCardFile).toHaveBeenCalledWith(blob);
    await waitFor(() => expect(document.querySelector('.player-card-overlay')).toBeNull());
  });

  it('P2-2：掛載後閒置時預先載入產圖模組並預載字型；pointerdown 也會觸發', async () => {
    const idle: Array<() => void> = [];
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      idle.push(cb);
      return idle.length;
    });
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { container } = renderTop(viewer());
    expect(canvasMock.ensurePlayerCardFonts).not.toHaveBeenCalled();
    expect(idle).toHaveLength(1);
    idle[0]!();
    await waitFor(() => expect(canvasMock.ensurePlayerCardFonts).toHaveBeenCalledTimes(1));
    // 預載一併載入 qrcode 模組（只載不產碼）。本檔產圖模組已 mock、不會 import qrcode，
    // 唯一的 import 來源就是 preloadPlayerCardShare；模組只評估一次，所以用 ≥1 判斷。
    expect(qrcodeLoaded.count).toBeGreaterThanOrEqual(1);
    expect(canvasMock.renderPlayerCardPng).not.toHaveBeenCalled();
    cleanup();

    _resetPlayerCardPreloadForTest();
    canvasMock.ensurePlayerCardFonts.mockClear();
    const again = renderTop(viewer());
    fireEvent.pointerDown(again.container.querySelector('#player-card-share-btn')!);
    await waitFor(() => expect(canvasMock.ensurePlayerCardFonts).toHaveBeenCalledTimes(1));
    void container;
  });

  it('沒有頭像時畫面顯示姓名首字；名字被遮掉時顯示 ?', () => {
    identity.current = { displayName: '王小明', pictureUrl: null, identityId: 'primary' };
    const named = renderTop(viewer());
    expect(named.container.querySelector('#profile-avatar')?.textContent).toBe('王');
    cleanup();
    identity.current = { displayName: 'U-me', pictureUrl: null, identityId: 'primary' };
    const hidden = renderTop(viewer());
    expect(hidden.container.querySelector('#profile-avatar')?.textContent).toBe('?');
  });

  it('QR：網頁卡面不顯示；本人球員卡產 PNG 時帶個人名片分享網址', async () => {
    const { container } = renderTop(viewer());
    const card = container.querySelector('.player-card')!;
    expect(card.querySelector('canvas')).toBeNull();
    expect(card.querySelector('[class*="qr"], [id*="qr"]')).toBeNull();
    expect(card.innerHTML).not.toContain('miniapp.line.me');
    fireEvent.click(container.querySelector('#player-card-share-btn')!);
    await waitFor(() => expect(canvasMock.renderPlayerCardPng).toHaveBeenCalledTimes(1));
    const args = canvasMock.renderPlayerCardPng.mock.calls[0] as unknown as unknown[];
    expect(args[3]).toBe(canvasMock.browserRenderDeps);
    expect(args[4]).toEqual({ qrText: 'https://miniapp.line.me/2009525300-AuPGQ0sh?profile=U-me' });
  });

  it('QR：不是本人的球員卡不放 QR', async () => {
    const other = { ...viewer(), uid: 'U-other' } as ViewerView;
    const { container } = renderTop(other);
    fireEvent.click(container.querySelector('#player-card-share-btn')!);
    await waitFor(() => expect(canvasMock.renderPlayerCardPng).toHaveBeenCalledTimes(1));
    const args = canvasMock.renderPlayerCardPng.mock.calls[0] as unknown as unknown[];
    expect(args[4]).toEqual({ qrText: null });
  });

  it('覆蓋層第二次分享仍失敗：提示改按儲存（shareUnavailable），不是「產生失敗」', async () => {
    const show = vi.spyOn(toast, 'show');
    shareMock.sharePlayerCardBlob.mockResolvedValueOnce('retry');
    shareMock.retrySharePlayerCardFile.mockResolvedValueOnce('failed');
    const { container } = renderTop(viewer());
    fireEvent.click(container.querySelector('#player-card-share-btn')!);
    await waitFor(() => expect(document.querySelector('#player-card-share-again')).not.toBeNull());
    fireEvent.click(document.querySelector('#player-card-share-again')!);
    await waitFor(() => expect(show).toHaveBeenCalledWith({ message: '無法開啟分享，請改按儲存' }));
    expect(show).not.toHaveBeenCalledWith({ message: '球員卡圖片產生失敗，請再試一次' });
    expect(document.querySelector('.player-card-overlay')).not.toBeNull();
    show.mockRestore();
  });

  it('LegacyProfileHeader 的靜態 import 鏈不得帶入 preact/compat（覆蓋層需要時才動態載入）', () => {
    // 帶入 compat 會讓 @testing-library/preact 把 fireEvent.change 改發 input，
    // 所有 import LegacyAvatar 的測試（LegacyIdentityCard 上傳圖片）因此收不到 change。
    const dir = resolve(process.cwd(), 'src/features/profile');
    const staticCompat = /^\s*import\s+(?!type\b)[^;]*from\s+['"]preact\/compat['"]/m;
    for (const file of [
      'components/legacy/LegacyProfileHeader.tsx',
      'components/PlayerCard.tsx',
      'components/PlayerCardShareButton.tsx',
      'data/player-card-model.ts',
    ]) {
      expect(staticCompat.test(readFileSync(resolve(dir, file), 'utf8')), file).toBe(false);
    }
    const button = readFileSync(resolve(dir, 'components/PlayerCardShareButton.tsx'), 'utf8');
    expect(button).toContain("import('./PlayerCardImageOverlay')");
    expect(button).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+'\.\/PlayerCardImageOverlay'/m);
  });

  it('名字為資料層預設 Unknown 時卡面顯示 -、頭像首字 ?，PNG 模型同樣', async () => {
    identity.current = { displayName: ' unknown ', pictureUrl: null, identityId: 'primary' };
    const { container } = renderTop(viewer());
    const card = container.querySelector('.player-card')!;
    expect(card.querySelector('#profile-title')?.textContent).toBe('-');
    expect(card.querySelector('#profile-avatar')?.textContent).toBe('?');
    expect(card.textContent?.toLowerCase()).not.toContain('unknown');
    fireEvent.click(container.querySelector('#player-card-share-btn')!);
    await waitFor(() => expect(canvasMock.renderPlayerCardPng).toHaveBeenCalledTimes(1));
    const [model] = canvasMock.renderPlayerCardPng.mock.calls[0] as unknown as [{ name: string; avatarInitial: string }];
    expect(model.name).toBe('-');
    expect(model.avatarInitial).toBe('?');
  });

  describe('撥動翻面＋鎖頭', () => {
    const LOCK_KEY = 'toosterx:player-card-locked';
    let raf: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      localStorage.removeItem(LOCK_KEY);
      raf = vi.fn(() => 1);
      vi.stubGlobal('requestAnimationFrame', raf);
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
      localStorage.removeItem(LOCK_KEY);
    });

    const parts = (container: Element) => ({
      lock: container.querySelector('.player-card-lock') as HTMLButtonElement,
      stage: container.querySelector('.player-card-stage') as HTMLElement,
      flip: container.querySelector('.player-card-flip') as HTMLElement,
    });

    function drag(el: Element, dx: number, dy = 0): void {
      const base = { pointerId: 7, pointerType: 'touch', clientX: 100, clientY: 100 };
      fireEvent.pointerDown(el, base);
      fireEvent.pointerMove(el, { ...base, clientX: 100 + dx / 2, clientY: 100 + dy / 2 });
      fireEvent.pointerMove(el, { ...base, clientX: 100 + dx, clientY: 100 + dy });
    }
    function lift(el: Element, dx: number): void {
      fireEvent.pointerUp(el, { pointerId: 7, pointerType: 'touch', clientX: 100 + dx, clientY: 100 });
    }

    it('鎖頭預設解鎖，在卡片外、有 aria-label／aria-pressed', () => {
      const { container } = renderTop(viewer());
      const { lock, flip } = parts(container);
      expect(lock.getAttribute('aria-pressed')).toBe('false');
      expect(lock.getAttribute('aria-label')).toBe('鎖定旋轉');
      expect(container.querySelector('.player-card')!.contains(lock)).toBe(false);
      expect(flip.contains(lock)).toBe(false);
      expect(flip.style.transform).toBe('');
    });

    it('點鎖頭切換並記在 localStorage，重新開啟仍維持', () => {
      const first = renderTop(viewer());
      fireEvent.click(parts(first.container).lock);
      const lock = parts(first.container).lock;
      expect(lock.getAttribute('aria-pressed')).toBe('true');
      // 文案固定，狀態只靠 aria-pressed
      expect(lock.getAttribute('aria-label')).toBe('鎖定旋轉');
      expect(lock.classList.contains('is-locked')).toBe(true);
      expect(localStorage.getItem(LOCK_KEY)).toBe('1');
      cleanup();

      const again = renderTop(viewer());
      expect(parts(again.container).lock.getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(parts(again.container).lock);
      expect(parts(again.container).lock.getAttribute('aria-pressed')).toBe('false');
      expect(localStorage.getItem(LOCK_KEY)).toBe('0');
    });

    it('localStorage 讀寫拋錯：預設解鎖，點擊照常切換', () => {
      localStorage.setItem(LOCK_KEY, '1');
      const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      try {
        const { container } = renderTop(viewer());
        expect(parts(container).lock.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(parts(container).lock);
        expect(parts(container).lock.getAttribute('aria-pressed')).toBe('true');
        expect(setSpy).toHaveBeenCalled();
      } finally {
        getSpy.mockRestore();
        setSpy.mockRestore();
      }
    });

    it('解鎖時水平拖曳跟手旋轉；鎖定時拖曳不改變旋轉', () => {
      const open = renderTop(viewer());
      const a = parts(open.container);
      drag(a.stage, 100);
      expect(a.flip.style.transform).toBe('rotateY(80deg)');
      lift(a.stage, 100);
      cleanup();
      raf.mockClear();

      localStorage.setItem(LOCK_KEY, '1');
      const shut = renderTop(viewer());
      const b = parts(shut.container);
      expect(b.stage.classList.contains('is-locked')).toBe(true);
      drag(b.stage, 150);
      lift(b.stage, 150);
      expect(b.flip.style.transform).toBe('');
      expect(raf).not.toHaveBeenCalled();
    });

    it('垂直為主的移動交給頁面捲動，不接管旋轉', () => {
      const { container } = renderTop(viewer());
      const { stage, flip } = parts(container);
      drag(stage, 4, 60);
      lift(stage, 4);
      expect(flip.style.transform).toBe('');
    });

    it('點鎖頭（含按下與移動）不觸發旋轉', () => {
      const { container } = renderTop(viewer());
      const { lock, flip } = parts(container);
      drag(lock, 150);
      lift(lock, 150);
      fireEvent.click(lock);
      expect(flip.style.transform).toBe('');
      expect(raf).not.toHaveBeenCalled();
    });

    it('轉到一半鎖上：停在對齊的一面', () => {
      stubMatchMedia(true);
      const { container } = renderTop(viewer());
      const { stage, flip, lock } = parts(container);
      drag(stage, 150); // 120°
      fireEvent.click(lock);
      expect(flip.style.transform).toBe('rotateY(180deg)');
      lift(stage, 150);
      expect(flip.style.transform).toBe('rotateY(180deg)');
    });

    it('減少動態：放手直接翻到正／背面，不跑慣性動畫', () => {
      stubMatchMedia(true);
      const { container } = renderTop(viewer());
      const { stage, flip } = parts(container);
      drag(stage, 150);
      lift(stage, 150);
      expect(flip.style.transform).toBe('rotateY(180deg)');
      expect(raf).not.toHaveBeenCalled();
    });

    describe('慣性與收尾（手動推進 rAF 與時間）', () => {
      let now = 0;
      let pending: Map<number, FrameRequestCallback>;
      let caf: ReturnType<typeof vi.fn>;
      let nowSpy: { mockRestore: () => void };

      beforeEach(() => {
        now = 1000;
        pending = new Map();
        let nextId = 1;
        raf = vi.fn((cb: FrameRequestCallback) => {
          const id = nextId++;
          pending.set(id, cb);
          return id;
        });
        caf = vi.fn((id: number) => {
          pending.delete(id);
        });
        vi.stubGlobal('requestAnimationFrame', raf);
        vi.stubGlobal('cancelAnimationFrame', caf);
        nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
      });

      afterEach(() => {
        nowSpy.mockRestore();
      });

      function flush(maxFrames = 5000): void {
        for (let i = 0; i < maxFrames && pending.size; i++) {
          const [id, cb] = pending.entries().next().value as [number, FrameRequestCallback];
          pending.delete(id);
          now += 16;
          cb(now);
        }
        expect(pending.size).toBe(0);
      }

      /** 記錄每次寫入的 rotateY 角度。 */
      function recordAngles(flip: HTMLElement): number[] {
        const angles: number[] = [];
        Object.defineProperty(flip.style, 'transform', {
          configurable: true,
          get: () => (angles.length ? `rotateY(${angles[angles.length - 1]}deg)` : ''),
          set: (v: string) => {
            angles.push(Number(/rotateY\((-?[\d.e+-]+)deg\)/.exec(v)![1]));
          },
        });
        return angles;
      }

      const ptr = (x: number, extra: Record<string, unknown> = {}) => ({
        pointerId: 7, pointerType: 'touch', clientX: x, clientY: 100, ...extra,
      });

      /** 30ms 內從 x=100 撥到 toX，模擬用力一撥。 */
      function flick(stage: Element, toX: number): void {
        fireEvent.pointerDown(stage, ptr(100));
        const steps = 3;
        for (let i = 1; i <= steps; i++) {
          now += 10;
          fireEvent.pointerMove(stage, ptr(100 + ((toX - 100) * i) / steps));
        }
        fireEvent.pointerUp(stage, ptr(toX));
      }

      for (const dir of [1, -1]) {
        it(`用力撥（${dir > 0 ? '向右' : '向左'}）：轉多圈、全程不倒轉，停在 180° 倍數`, () => {
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          const angles = recordAngles(flip);
          flick(stage, 100 + dir * 100);
          flush();
          // 最後一筆是收尾後正規化到 0／180，前面是連續角度
          const raw = angles.slice(0, -1);
          for (let i = 1; i < raw.length; i++) {
            expect((raw[i]! - raw[i - 1]!) * dir, `frame ${i}`).toBeGreaterThanOrEqual(0);
          }
          const target = raw[raw.length - 1]!;
          expect(Math.abs(target)).toBeGreaterThan(360);
          expect(Math.abs(target % 180)).toBe(0);
          const final = angles[angles.length - 1]!;
          expect([0, 180]).toContain(final);
          expect(((target % 360) + 360) % 360).toBe(final);
        });
      }

      it('pointercancel：不慣性，對齊最近一面', () => {
        const { container } = renderTop(viewer());
        const { stage, flip } = parts(container);
        const angles = recordAngles(flip);
        fireEvent.pointerDown(stage, ptr(100));
        now += 10;
        fireEvent.pointerMove(stage, ptr(160));
        now += 10;
        fireEvent.pointerMove(stage, ptr(250)); // 120°
        fireEvent.pointerCancel(stage, ptr(250));
        flush();
        expect(Math.max(...angles)).toBe(180);
        expect(angles[angles.length - 1]).toBe(180);
      });

      it('滑鼠在卡外放開（移動時 buttons=0）視為放開並對齊', () => {
        const { container } = renderTop(viewer());
        const { stage, flip } = parts(container);
        fireEvent.pointerDown(stage, ptr(100, { pointerType: 'mouse', button: 0, buttons: 1 }));
        now += 10;
        fireEvent.pointerMove(stage, ptr(200, { pointerType: 'mouse', buttons: 1 })); // 80°
        expect(flip.style.transform).toBe('rotateY(80deg)');
        now += 10;
        fireEvent.pointerMove(stage, ptr(400, { pointerType: 'mouse', buttons: 0 }));
        expect(flip.style.transform).toBe('rotateY(80deg)');
        flush();
        expect(flip.style.transform).toBe('rotateY(0deg)');
        // 之後再移動不再跟手
        fireEvent.pointerMove(stage, ptr(300, { pointerType: 'mouse', buttons: 0 }));
        expect(flip.style.transform).toBe('rotateY(0deg)');
      });

      it('lostpointercapture：視同取消並對齊', () => {
        const { container } = renderTop(viewer());
        const { stage, flip } = parts(container);
        fireEvent.pointerDown(stage, ptr(100));
        fireEvent.pointerMove(stage, ptr(160));
        fireEvent.pointerMove(stage, ptr(250)); // 120°
        fireEvent(stage, new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 7 }));
        flush();
        expect(flip.style.transform).toBe('rotateY(180deg)');
      });

      it('子元素冒泡上來的 lostpointercapture（Safari 隱式 capture）不取消拖曳', () => {
        const { container } = renderTop(viewer());
        const { stage, flip } = parts(container);
        const child = stage.querySelector('.player-card') as HTMLElement;
        fireEvent.pointerDown(child, ptr(100));
        fireEvent.pointerMove(stage, ptr(160));
        fireEvent(child, new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 7 }));
        fireEvent.pointerMove(stage, ptr(250)); // 仍跟手：120°
        expect(flip.style.transform).toBe('rotateY(120deg)');
      });

      it('第二指不搶：已有一指拖曳時另一指的按下與移動被忽略', () => {
        const { container } = renderTop(viewer());
        const { stage, flip } = parts(container);
        fireEvent.pointerDown(stage, ptr(100));
        fireEvent.pointerMove(stage, ptr(200)); // 80°
        fireEvent.pointerDown(stage, ptr(0, { pointerId: 8 }));
        fireEvent.pointerMove(stage, ptr(300, { pointerId: 8 }));
        expect(flip.style.transform).toBe('rotateY(80deg)');
        fireEvent.pointerMove(stage, ptr(225)); // 原手指仍跟手：100°
        expect(flip.style.transform).toBe('rotateY(100deg)');
      });

      it('一般動畫路徑：轉到一半鎖上，動畫對齊到最近一面', () => {
        const { container } = renderTop(viewer());
        const { stage, flip, lock } = parts(container);
        fireEvent.pointerDown(stage, ptr(100));
        fireEvent.pointerMove(stage, ptr(160));
        fireEvent.pointerMove(stage, ptr(250)); // 120°
        fireEvent.click(lock);
        expect(pending.size).toBe(1);
        flush();
        expect(flip.style.transform).toBe('rotateY(180deg)');
        fireEvent.pointerUp(stage, ptr(250));
        expect(pending.size).toBe(0);
        expect(flip.style.transform).toBe('rotateY(180deg)');
      });

      describe('連撥加速＋RPM（站長 11-06）', () => {
        const BEST_KEY = 'toosterx:player-card-best-rpm';
        const GAUGE_DEG_PER_MS = (900 * 360) / 60000;
        const SAFE_DEG_PER_MS = (PLAYER_CARD_SAFE_MAX_RPM * 360) / 60000;
        beforeEach(() => localStorage.removeItem(BEST_KEY));
        afterEach(() => localStorage.removeItem(BEST_KEY));

        /** 30ms 內從 x=100 撥到 toX（不同於上面的 flick，可指定起點以外的位移）。 */
        function swipe(stage: Element, toX: number): void {
          fireEvent.pointerDown(stage, ptr(100));
          for (let i = 1; i <= 3; i++) {
            now += 10;
            fireEvent.pointerMove(stage, ptr(100 + ((toX - 100) * i) / 3));
          }
          fireEvent.pointerUp(stage, ptr(toX));
        }
        /** 推進 n 格（每格 16ms），回傳每格角速度（°/ms）。 */
        function frames(angles: number[], n: number): number[] {
          const vels: number[] = [];
          for (let i = 0; i < n && pending.size; i++) {
            const before = angles[angles.length - 1]!;
            const [id, cb] = pending.entries().next().value as [number, FrameRequestCallback];
            pending.delete(id);
            now += 16;
            cb(now);
            vels.push((angles[angles.length - 1]! - before) / 16);
          }
          return vels;
        }
        const rpmParts = (container: Element) => ({
          box: container.querySelector('.player-card-rpm') as HTMLElement,
          num: container.querySelector('.player-card-rpm-num') as HTMLElement,
          best: container.querySelector('.player-card-rpm-best-num') as HTMLElement,
        });

        it('RPM 在卡片外、aria-hidden，靜止顯示 0/RPM 與最高記錄', () => {
          localStorage.setItem(BEST_KEY, '345');
          const { container } = renderTop(viewer());
          const { box, num, best } = rpmParts(container);
          expect(box.getAttribute('aria-hidden')).toBe('true');
          expect(container.querySelector('.player-card')!.contains(box)).toBe(false);
          expect(box.textContent).toBe('0/RPM最高記錄：345');
          expect(num.textContent).toBe('0');
          expect(best.textContent).toBe('345');
          expect(box.classList.contains('is-spinning')).toBe(false);
        });

        it('最高記錄：壞值／Infinity／負數當 0；不設上限（舊值 720／900 與 900 以上照讀），只夾在安全值 99999', () => {
          const cases: Array<[string, string]> = [
            ['abc', '0'], ['Infinity', '0'], ['-5', '0'], ['NaN', '0'],
            ['720', '720'], ['900', '900'], ['1500', '1500'], ['99999', '99999'], ['1e9', '99999'],
          ];
          for (const [stored, shown] of cases) {
            localStorage.setItem(BEST_KEY, stored);
            const v = renderTop(viewer());
            expect(rpmParts(v.container).best.textContent, stored).toBe(shown);
            cleanup();
          }
        });

        it('上限解除：慣性中同向連撥轉速持續疊加、超過 900 RPM，最高記錄也超過 900', () => {
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          const angles = recordAngles(flip);
          const peaks: number[] = [];
          for (let k = 0; k < 10; k++) {
            swipe(stage, 160); // 單次撥速 1.6°/ms（約 267 RPM）
            const v = frames(angles, 3);
            peaks.push(v[0]!);
          }
          expect(peaks[0]).toBeCloseTo(1.6, 5);
          for (let k = 1; k < peaks.length; k++) expect(peaks[k]!, `flick ${k}`).toBeGreaterThan(peaks[k - 1]!);
          // 原本第 4～5 撥就夾在 900 RPM（5.4°/ms）；解除後第 10 撥超過（此撥法約在 1,050 RPM 與摩擦平衡）
          expect(peaks[9]!).toBeGreaterThan(GAUGE_DEG_PER_MS);
          flush();
          expect([0, 180]).toContain(angles[angles.length - 1]);
          const best = Number(rpmParts(container).best.textContent);
          expect(best).toBeGreaterThan(900);
          expect(localStorage.getItem(BEST_KEY)).toBe(String(best));
        });

        it('數值安全值：異常超高撥速夾在 99999 RPM，數字與最高記錄 5 位數照實顯示', () => {
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          const angles = recordAngles(flip);
          swipe(stage, 100 + 1e6); // 30ms 撥 100 萬 px
          const v = frames(angles, 1)[0]!;
          expect(v).toBeCloseTo(SAFE_DEG_PER_MS, 6);
          const { num, best } = rpmParts(container);
          expect(num.textContent).toBe('99999');
          expect(best.textContent).toBe('99999');
          flush();
          expect(localStorage.getItem(BEST_KEY)).toBe('99999');
          expect(Number.isFinite(angles[angles.length - 1]!)).toBe(true);
        });

        it('超表：超過 900 RPM 指針停在頂端、紅區發光（is-over），降回 900 以下與停下時拿掉', () => {
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          const angles = recordAngles(flip);
          const { box } = rpmParts(container);
          const needle = container.querySelector('.player-card-rpm-needle')!;
          swipe(stage, 100 + 300); // 8°/ms＝1333 RPM
          expect(box.classList.contains('is-over')).toBe(true);
          expect(needle.getAttribute('transform')).toBe('rotate(90 20 20)');
          let sawUnder = false;
          while (pending.size) {
            frames(angles, 1);
            const deg = Number(/rotate\((-?[\d.]+) /.exec(needle.getAttribute('transform')!)![1]);
            if (deg < 90) {
              sawUnder = true;
              expect(box.classList.contains('is-over')).toBe(false);
            }
          }
          expect(sawUnder).toBe(true);
          expect(box.classList.contains('is-over')).toBe(false);
          expect(needle.getAttribute('transform')).toBe('rotate(-90 20 20)');
        });

        it('卡頓時同一刻送達多個 move＋up（事件時間差 <1ms）：撥速以事件時間計、分母至少 16ms，速度與最高記錄不暴衝', () => {
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          const angles = recordAngles(flip);
          /** 送出帶指定事件時間（timeStamp）的指標事件；performance.now() 全程不動，模擬同一個 task 內處理。 */
          const send = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, ts: number): void => {
            const ev = createEvent[type](stage, ptr(x));
            Object.defineProperty(ev, 'timeStamp', { value: ts });
            fireEvent(stage, ev);
          };
          now = 5000;
          send('pointerDown', 100, 4999.0);
          send('pointerMove', 166, 4999.1);
          send('pointerMove', 233, 4999.2);
          send('pointerMove', 300, 4999.3);
          send('pointerUp', 300, 4999.3);
          // 修正前：200px / 0.3ms ×0.8 ≈ 533°/ms（約 88,900 RPM）；修正後分母取 16ms：200/16×0.8＝10°/ms（約 1,667 RPM）
          const v = frames(angles, 1)[0]!;
          expect(v).toBeCloseTo(10, 6);
          flush();
          const best = Number(rpmParts(container).best.textContent);
          expect(best).toBeLessThanOrEqual(1667);
          expect(Number(localStorage.getItem(BEST_KEY))).toBeLessThanOrEqual(1667);

          // 卡頓後才一起送達、但事件實際相隔 30ms：照事件時間算出真實撥速 200/30×0.8≈5.33°/ms
          now = 9000;
          send('pointerDown', 100, 8900);
          send('pointerMove', 166, 8910);
          send('pointerMove', 233, 8920);
          send('pointerMove', 300, 8930);
          send('pointerUp', 300, 8930);
          expect(frames(angles, 1)[0]!).toBeCloseTo((200 / 30) * 0.8, 6);
        });

        it('反向撥：丟掉剩餘轉速，只照本次撥速反向轉、全程不倒退', () => {
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          const angles = recordAngles(flip);
          swipe(stage, 200); // 約 2.67°/ms 向右
          frames(angles, 3);
          swipe(stage, 40); // 反向 1.6°/ms
          const after = frames(angles, 1)[0]!;
          expect(after).toBeCloseTo(-1.6, 5);
          const mark = angles.length;
          flush();
          const raw = angles.slice(mark, -1);
          for (let i = 1; i < raw.length; i++) expect(raw[i]! - raw[i - 1]!).toBeLessThanOrEqual(0);
        });

        it('抓住超過 150ms 再撥：不疊加剩餘轉速（只照本次撥速）', () => {
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          const angles = recordAngles(flip);
          swipe(stage, 200);
          frames(angles, 3);
          fireEvent.pointerDown(stage, ptr(100));
          now += 200; // 抓住不動
          for (let i = 1; i <= 3; i++) {
            now += 10;
            fireEvent.pointerMove(stage, ptr(100 + (60 * i) / 3));
          }
          fireEvent.pointerUp(stage, ptr(160));
          expect(frames(angles, 1)[0]!).toBeCloseTo(1.6, 5);
        });

        it('按住：立即拿掉 is-spinning、數字先維持；按住超過 300ms 數字歸 0', () => {
          vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
          try {
            const { container } = renderTop(viewer());
            const { stage, flip } = parts(container);
            const angles = recordAngles(flip);
            const { box, num } = rpmParts(container);
            swipe(stage, 200);
            frames(angles, 3);
            const shown = num.textContent;
            expect(box.classList.contains('is-spinning')).toBe(true);
            fireEvent.pointerDown(stage, ptr(100));
            expect(box.classList.contains('is-spinning')).toBe(false);
            expect(num.textContent).toBe(shown);
            vi.advanceTimersByTime(299);
            expect(num.textContent).toBe(shown);
            vi.advanceTimersByTime(1);
            expect(num.textContent).toBe('0');
            fireEvent.pointerUp(stage, ptr(100));
            flush();
            expect(num.textContent).toBe('0');
          } finally {
            vi.useRealTimers();
          }
        });

        it('對齊階段 RPM 只遞減不回升', () => {
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          const angles = recordAngles(flip);
          const { num } = rpmParts(container);
          swipe(stage, 200);
          const seen: number[] = [Number(num.textContent)];
          while (pending.size) {
            frames(angles, 1);
            seen.push(Number(num.textContent));
          }
          for (let i = 1; i < seen.length; i++) expect(seen[i]!, `step ${i}`).toBeLessThanOrEqual(seen[i - 1]!);
          expect(seen[seen.length - 1]).toBe(0);
        });

        it('轉到一半卸載：有新記錄就補寫 localStorage', () => {
          const view = renderTop(viewer());
          const { stage, flip } = parts(view.container);
          const angles = recordAngles(flip);
          swipe(stage, 200);
          frames(angles, 2);
          expect(localStorage.getItem(BEST_KEY)).toBeNull();
          view.unmount();
          expect(Number(localStorage.getItem(BEST_KEY))).toBeGreaterThan(400);
        });

        it('轉速表：半圓刻度、750 起紅區、靜止指 0；指針角度對應轉速，停下與鎖上歸 0', () => {
          expect(rpmToNeedleDeg(0)).toBe(-90);
          expect(rpmToNeedleDeg(450)).toBe(0);
          expect(rpmToNeedleDeg(900)).toBe(90);
          expect(rpmToNeedleDeg(1200)).toBe(90);
          expect(rpmToNeedleDeg(-5)).toBe(-90);
          const { container } = renderTop(viewer());
          const { stage, flip, lock } = parts(container);
          const angles = recordAngles(flip);
          const gauge = container.querySelector('.player-card-rpm .player-card-rpm-gauge')!;
          expect(gauge.getAttribute('aria-hidden')).toBe('true');
          expect(container.querySelector('.player-card')!.contains(gauge)).toBe(false);
          expect(gauge.querySelector('.player-card-rpm-gauge-red')).not.toBeNull();
          const ticks = gauge.querySelectorAll('.player-card-rpm-gauge-tick');
          expect(ticks).toHaveLength(13);
          expect(gauge.querySelectorAll('.player-card-rpm-gauge-tick.is-major')).toHaveLength(5);
          expect(gauge.querySelectorAll('.player-card-rpm-gauge-tick.is-red')).toHaveLength(3); // 750、825、900
          const needle = gauge.querySelector('.player-card-rpm-needle')!;
          expect(needle.getAttribute('transform')).toBe('rotate(-90 20 20)');
          const { num } = rpmParts(container);
          swipe(stage, 200);
          const rpm = Number(num.textContent);
          expect(rpm).toBeGreaterThan(400);
          expect(needle.getAttribute('transform')).toBe(`rotate(${rpmToNeedleDeg(rpm)} 20 20)`);
          frames(angles, 3);
          const deg = Number(/rotate\((-?[\d.]+) /.exec(needle.getAttribute('transform')!)![1]);
          expect(deg).toBeLessThan(rpmToNeedleDeg(rpm)); // 每幀跟著減速
          flush();
          expect(needle.getAttribute('transform')).toBe('rotate(-90 20 20)');
          swipe(stage, 200);
          frames(angles, 2);
          fireEvent.click(lock);
          flush();
          expect(needle.getAttribute('transform')).toBe('rotate(-90 20 20)');
        });

        it('寫入取較大值：其他分頁已寫入更高記錄時不被覆蓋', () => {
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          recordAngles(flip);
          localStorage.setItem(BEST_KEY, '700'); // 掛載後另一分頁寫入
          swipe(stage, 200); // 約 444 RPM
          flush();
          expect(localStorage.getItem(BEST_KEY)).toBe('700');
          expect(rpmParts(container).best.textContent).toBe('700');
        });

        it('點一下＝煞車：不疊加，停在最近一面', () => {
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          const angles = recordAngles(flip);
          swipe(stage, 200);
          frames(angles, 10);
          const at = angles[angles.length - 1]!;
          fireEvent.pointerDown(stage, ptr(100));
          now += 40;
          fireEvent.pointerUp(stage, ptr(100));
          flush();
          const raw = angles[angles.length - 2]!; // 正規化前的目標角
          expect(Math.abs(raw - at)).toBeLessThanOrEqual(90);
          expect(raw % 180).toBe(0);
          expect(rpmParts(container).num.textContent).toBe('0');
        });

        it('RPM 文字隨轉速更新（節流 100ms），停下歸 0；最高記錄即時更新、停下才寫一次 localStorage', () => {
          const setSpy = vi.spyOn(Storage.prototype, 'setItem');
          try {
            const { container } = renderTop(viewer());
            const { stage, flip } = parts(container);
            recordAngles(flip);
            const { box, num, best } = rpmParts(container);
            swipe(stage, 200);
            frames([0], 1);
            const first = Number(num.textContent);
            expect(first).toBeGreaterThan(400);
            expect(first).toBeLessThan(900);
            expect(box.classList.contains('is-spinning')).toBe(true);
            expect(Number(best.textContent)).toBe(first);
            // 100ms 內不再改字
            frames([0], 3);
            expect(Number(num.textContent)).toBe(first);
            frames([0], 5);
            expect(Number(num.textContent)).toBeLessThan(first);
            expect(setSpy.mock.calls.filter((c) => c[0] === BEST_KEY)).toHaveLength(0);
            flush();
            expect(num.textContent).toBe('0');
            expect(box.classList.contains('is-spinning')).toBe(false);
            const bestCalls = setSpy.mock.calls.filter((c) => c[0] === BEST_KEY);
            expect(bestCalls).toHaveLength(1);
            expect(bestCalls[0]![1]).toBe(best.textContent);
            // 較慢的一撥不刷新記錄、也不再寫
            swipe(stage, 150);
            flush();
            expect(setSpy.mock.calls.filter((c) => c[0] === BEST_KEY)).toHaveLength(1);
          } finally {
            setSpy.mockRestore();
          }
        });

        it('localStorage 寫入拋錯：轉動與 RPM 照常', () => {
          const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
          });
          try {
            const { container } = renderTop(viewer());
            const { stage, flip } = parts(container);
            recordAngles(flip);
            swipe(stage, 200);
            flush();
            expect(rpmParts(container).num.textContent).toBe('0');
          } finally {
            setSpy.mockRestore();
          }
        });

        it('轉動中鎖上：停下且 RPM 歸 0，之後再撥也不轉', () => {
          const { container } = renderTop(viewer());
          const { stage, flip, lock } = parts(container);
          const angles = recordAngles(flip);
          swipe(stage, 200);
          frames(angles, 8);
          expect(rpmParts(container).num.textContent).not.toBe('0');
          fireEvent.click(lock);
          flush();
          expect(rpmParts(container).num.textContent).toBe('0');
          const n = angles.length;
          swipe(stage, 200);
          expect(pending.size).toBe(0);
          expect(angles.length).toBe(n);
        });

        it('減少動態：連撥不加速、不跑動畫，RPM 維持 0、不留記錄', () => {
          stubMatchMedia(true);
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          const angles = recordAngles(flip);
          swipe(stage, 200);
          swipe(stage, 200);
          expect(raf).not.toHaveBeenCalled();
          expect([0, 180]).toContain(angles[angles.length - 1]);
          expect(rpmParts(container).num.textContent).toBe('0');
          expect(localStorage.getItem(BEST_KEY)).toBeNull();
        });
      });

      describe('動態反光（站長 11-06 方案①）', () => {
        const shineParts = (container: Element) => ({
          front: [...container.querySelectorAll('.player-card > .player-card-shine')] as HTMLElement[],
          back: [...container.querySelectorAll('.player-card-back > .player-card-shine')] as HTMLElement[],
        });
        const pct = (el: HTMLElement): number => {
          const m = /^translateX\((-?[\d.]+)%\)$/.exec(el.style.transform);
          return m ? Number(m[1]) : NaN;
        };
        /** 拖到指定角度（0.8°/px），不放手。 */
        function dragTo(stage: Element, deg: number): void {
          fireEvent.pointerDown(stage, ptr(100));
          fireEvent.pointerMove(stage, ptr(100 + deg / 0.8 / 2));
          fireEvent.pointerMove(stage, ptr(100 + deg / 0.8));
        }

        it('位移公式：sin(該面角度)×60%，正面 sin(θ)、背面 −sin(θ)；180° 倍數一律 0', () => {
          expect(playerCardShineOffsetPct(45, 'front')).toBeCloseTo(42.4264, 3);
          expect(playerCardShineOffsetPct(45, 'back')).toBeCloseTo(-42.4264, 3);
          expect(playerCardShineOffsetPct(90, 'front')).toBeCloseTo(60, 6);
          expect(playerCardShineOffsetPct(135, 'front')).toBeCloseTo(42.4264, 3);
          expect(playerCardShineOffsetPct(-45, 'front')).toBeCloseTo(-42.4264, 3);
          for (const a of [0, 180, -180, 360, 540, -720, 1800]) {
            expect(playerCardShineOffsetPct(a, 'front'), String(a)).toBe(0);
            expect(playerCardShineOffsetPct(a, 'back'), String(a)).toBe(0);
          }
        });

        for (const theme of ['light', 'dark'] as const) {
          it(`${theme}：拖到 45°／90°／135° 光帶跟著滑（正背兩面、只寫 transform）；0／180° 時回到與 PNG 相同的靜止值`, () => {
            document.documentElement.setAttribute('data-theme', theme);
            const { container } = renderTop(viewer());
            const { stage, flip } = parts(container);
            const { front, back } = shineParts(container);
            expect(front.length).toBeGreaterThan(0);
            expect(back).toHaveLength(1);
            const restFront = front.map((el) => el.style.cssText);
            const restBack = back.map((el) => el.style.cssText);
            const restBg = front.map((el) => el.style.background);
            expect(restFront[0]).not.toContain('transform');
            dragTo(stage, 45);
            expect(flip.style.transform).toBe('rotateY(45deg)');
            expect(flip.classList.contains('is-turning')).toBe(true);
            for (const el of front) expect(pct(el)).toBeCloseTo(42.426, 3);
            for (const el of back) expect(pct(el)).toBeCloseTo(-42.426, 3);
            // 漸層本身不重算：background 與靜止時相同
            expect(front.map((el) => el.style.background)).toEqual(restBg);
            fireEvent.pointerMove(stage, ptr(100 + 90 / 0.8));
            for (const el of front) expect(pct(el)).toBeCloseTo(60, 3);
            fireEvent.pointerMove(stage, ptr(100 + 135 / 0.8));
            for (const el of front) expect(pct(el)).toBeCloseTo(42.426, 3);
            for (const el of back) expect(pct(el)).toBeCloseTo(-42.426, 3);
            // 剛好 180°：拖曳中也回到靜止值
            fireEvent.pointerMove(stage, ptr(100 + 180 / 0.8));
            expect(flip.style.transform).toBe('rotateY(180deg)');
            expect(flip.classList.contains('is-turning')).toBe(false);
            expect(front.map((el) => el.style.cssText)).toEqual(restFront);
            expect(back.map((el) => el.style.cssText)).toEqual(restBack);
            fireEvent.pointerMove(stage, ptr(100 + 135 / 0.8));
            fireEvent.pointerUp(stage, ptr(100 + 135 / 0.8));
            flush();
            expect(flip.style.transform).toBe('rotateY(180deg)');
            expect(flip.classList.contains('is-turning')).toBe(false);
            expect(front.map((el) => el.style.cssText)).toEqual(restFront);
            expect(back.map((el) => el.style.cssText)).toEqual(restBack);
          });
        }

        it('用力撥：慣性每幀光帶位移＝sin(角度)×60%，停下（0／180°）回到靜止值', () => {
          document.documentElement.setAttribute('data-theme', 'light');
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          const angles = recordAngles(flip);
          const { front, back } = shineParts(container);
          const rest = front.map((el) => el.style.cssText);
          flick(stage, 300);
          let checked = 0;
          for (let i = 0; i < 20 && pending.size; i++) {
            const [id, cb] = pending.entries().next().value as [number, FrameRequestCallback];
            pending.delete(id);
            now += 16;
            cb(now);
            const a = angles[angles.length - 1]!;
            if (a % 180 === 0) continue;
            const expected = playerCardShineOffsetPct(a, 'front');
            for (const el of front) expect(pct(el)).toBeCloseTo(expected, 2);
            for (const el of back) expect(pct(el)).toBeCloseTo(-expected, 2);
            checked++;
          }
          expect(checked).toBeGreaterThan(10);
          flush();
          expect([0, 180]).toContain(angles[angles.length - 1]);
          expect(front.map((el) => el.style.cssText)).toEqual(rest);
          expect(back.every((el) => el.style.transform === '')).toBe(true);
          expect(flip.classList.contains('is-turning')).toBe(false);
        });

        it('減少動態：拖曳照樣跟手翻，但斜光完全不動（無 transform、無 is-turning）', () => {
          stubMatchMedia(true);
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          const { front, back } = shineParts(container);
          dragTo(stage, 45);
          expect(flip.style.transform).toBe('rotateY(45deg)');
          expect(flip.classList.contains('is-turning')).toBe(false);
          for (const el of [...front, ...back]) expect(el.style.transform).toBe('');
          fireEvent.pointerUp(stage, ptr(100 + 45 / 0.8));
          for (const el of [...front, ...back]) expect(el.style.transform).toBe('');
        });

        it('轉動全程不觸發 Preact 重繪（斜光、轉速、指針都直寫 DOM）', () => {
          const { container } = renderTop(viewer());
          const { stage, flip } = parts(container);
          recordAngles(flip);
          const opts = options as { diffed?: (v: unknown) => void };
          const prev = opts.diffed;
          let diffs = 0;
          opts.diffed = (v) => {
            diffs++;
            prev?.(v);
          };
          try {
            dragTo(stage, 70);
            fireEvent.pointerUp(stage, ptr(100 + 70 / 0.8));
            flick(stage, 400);
            flush();
          } finally {
            opts.diffed = prev;
          }
          expect(diffs).toBe(0);
          expect(container.querySelector('.player-card-shine')!.isConnected).toBe(true);
        });
      });

      it('轉動中卸載：取消排好的 rAF', () => {
        const view = renderTop(viewer());
        flick(parts(view.container).stage, 200);
        for (let i = 0; i < 3; i++) {
          const [id, cb] = pending.entries().next().value as [number, FrameRequestCallback];
          pending.delete(id);
          now += 16;
          cb(now);
        }
        expect(pending.size).toBe(1);
        const [lastId] = [...pending.keys()];
        view.unmount();
        expect(caf).toHaveBeenCalledWith(lastId);
        expect(pending.size).toBe(0);
      });
    });

    it('背面：同尺寸外框＋原廠 logo（依深淺色），不含正面資料', () => {
      document.documentElement.setAttribute('data-theme', 'light');
      const light = renderTop(viewer('user', ['t1']));
      const back = light.container.querySelector('.player-card-flip > .player-card-back')!;
      expect(back).not.toBeNull();
      expect(back.getAttribute('aria-hidden')).toBe('true');
      expect(back.querySelector('.player-card-frame')).not.toBeNull();
      expect(back.querySelector('.player-card-back-logo')?.getAttribute('src')).toBe('/assets/logo-black.webp');
      expect(back.textContent).toBe('');
      // 圖片不可被拖走（桌機拖曳時不會變成原生圖片拖放）
      expect(back.querySelector('.player-card-back-logo')?.getAttribute('draggable')).toBe('false');
      expect(light.container.querySelector('.player-card-logo')?.getAttribute('draggable')).toBe('false');
      const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
      light.container.querySelector('.player-card-stage')!.dispatchEvent(dragStart);
      expect(dragStart.defaultPrevented).toBe(true);
      expect(back.querySelector('#profile-avatar, .player-card-club, .stat-item')).toBeNull();
      // 正面仍是第一個 .player-card，PNG 仍只畫正面
      expect(light.container.querySelector('.player-card')?.classList.contains('player-card-back')).toBe(false);
      cleanup();

      document.documentElement.setAttribute('data-theme', 'dark');
      const dark = renderTop(viewer());
      expect(dark.container.querySelector('.player-card-back-logo')?.getAttribute('src')).toBe('/assets/logo-white.webp');
    });
  });
});

describe('球員卡身分圖案（網頁卡面）', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    await setLocale('zh-TW');
    stubMatchMedia(false);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
  });

  function renderWith(p: Record<string, unknown>) {
    return render(
      <LegacyProfileTopSection uid="U-me" profile={{ exp: 0, ...p } as unknown as UserProfile} viewer={viewer()} summary={summary} />,
    );
  }

  it('教練・女：正面有粉色戰術板 svg（logo 之後、斜光之前），背面沒有', () => {
    const { container } = renderWith({ role: 'coach', gender: '女' });
    const front = container.querySelector('.player-card')!;
    const svgs = front.querySelectorAll('svg.player-card-motif');
    expect(svgs).toHaveLength(1);
    const svg = svgs[0]!;
    expect(svg.getAttribute('data-motif')).toBe('board');
    expect(svg.getAttribute('data-motif-palette')).toBe('pink');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('viewBox')).toBe('0 0 51.25 53.25');
    const logo = front.querySelector('.player-card-logo')!;
    const shine = front.querySelector('.player-card-shine')!;
    expect(logo.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(svg.compareDocumentPosition(shine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 粉色線條＋花瓣點綴
    const strokes = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('stroke'));
    expect(strokes).toContain('#B94A72');
    expect(strokes).toContain('#D9849A');
    expect(container.querySelector('.player-card-back .player-card-motif')).toBeNull();
  });

  it('教練・男：金色戰術板、無花瓣；深色主題用深色金線', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { container } = renderWith({ role: 'coach', gender: '男' });
    const svg = container.querySelector('.player-card svg.player-card-motif')!;
    expect(svg.getAttribute('data-motif-palette')).toBe('gold');
    const strokes = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('stroke'));
    expect(strokes).toContain('#FAC775');
    expect(strokes).not.toContain('#F9D3DC');
  });

  it('一般用戶・女＝櫻花枝；一般用戶・男與未填＝無圖案；隱身管理員照一般用戶', () => {
    expect(renderWith({ gender: '女' }).container.querySelector('.player-card-motif')?.getAttribute('data-motif')).toBe('sakura');
    cleanup();
    expect(renderWith({ gender: '男' }).container.querySelector('.player-card-motif')).toBeNull();
    cleanup();
    expect(renderWith({}).container.querySelector('.player-card-motif')).toBeNull();
    cleanup();
    expect(renderWith({ role: 'admin', stealth: true, gender: '男' }).container.querySelector('.player-card-motif')).toBeNull();
    cleanup();
    expect(renderWith({ role: 'super_admin', stealth: true, gender: '女' }).container.querySelector('.player-card-motif')?.getAttribute('data-motif')).toBe('sakura');
  });
});
