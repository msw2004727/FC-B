import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareLiff } from '@/features/events/data/event-share';
import { makeCompetitionsT } from '../i18n';
import { competition, NOW, REG_CLOSE, REG_OPEN } from '../testing/screen-fixtures';
import {
  buildCompetitionCopyUrl,
  buildCompetitionFlexMessage,
  buildCompetitionLiffUrl,
  buildCompetitionShareAltText,
  competitionShareImage,
  isCompetitionShareable,
  isRecruiting,
  isShareableCid,
  shareCompetition,
  shareSheetLabels,
} from './competition-share';

vi.mock('@line/liff', () => ({ default: { isLoggedIn: () => false, isApiAvailable: () => false, shareTargetPicker: vi.fn() } }));

const dict = JSON.parse(readFileSync(resolve(__dirname, '../locales-lazy/zh-TW.json'), 'utf8')) as Record<string, string>;
const ct = makeCompetitionsT(dict);
// 假的合格格式 id（cp_＋20 碼），不是任何真實賽事。
const CID = 'cp_TESTabcdefghij012345';
const COVER_URL = 'https://firebasestorage.googleapis.com/v0/b/b1/o/images%2Fcompetitions%2Fc_aaaaaaaaaaaaaaaa%2Fcover_1.webp?alt=media&token=t';

function doc(partial: Parameters<typeof competition>[0] = {}) {
  return competition({ id: CID, ...partial });
}

function picker(): ShareLiff {
  return {
    isLoggedIn: () => true,
    isApiAvailable: () => true,
    shareTargetPicker: vi.fn(async () => ({ status: 'success' as const })),
  };
}

function options(loggedIn = true, signal = new AbortController().signal) {
  return { ct, loggedIn, signal, showToast: vi.fn() };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('顯示條件與 id', () => {
  it('只收後端 CID_RE 形狀', () => {
    expect(isShareableCid(CID)).toBe(true);
    for (const bad of ['cup', 'cp_short', `${CID}x`, 'cp_TESTabcdefghij01234-', 'xp_TESTabcdefghij012345', '']) {
      expect(isShareableCid(bad)).toBe(false);
    }
  });

  it('已發布、延期、取消且未下架、公開才可分享', () => {
    expect(isCompetitionShareable(doc())).toBe(true);
    expect(isCompetitionShareable(doc({ status: 'postponed' }))).toBe(true);
    expect(isCompetitionShareable(doc({ status: 'cancelled' }))).toBe(true);
  });

  it.each([
    ['草稿', { status: 'draft' as const }],
    ['下架', { hidden: true }],
    ['內部賽', { visibility: 'internal' }],
    ['刪到一半', { deletingAt: 1 }],
    ['id 不合格', { id: 'cup' }],
  ])('%s 不可分享', (_label, patch) => {
    expect(isCompetitionShareable(doc(patch))).toBe(false);
  });

  it('招募中：已發布且在報名期間內', () => {
    expect(isRecruiting(doc(), NOW)).toBe(true);
    expect(isRecruiting(doc(), REG_OPEN - 1)).toBe(false);
    expect(isRecruiting(doc(), REG_CLOSE + 1)).toBe(false);
    // 與後端 REG_CLOSED（now >= regCloseAt）同一條邊界：截止那一毫秒就不算招募中。
    expect(isRecruiting(doc(), REG_CLOSE - 1)).toBe(true);
    expect(isRecruiting(doc(), REG_CLOSE)).toBe(false);
    expect(isRecruiting(doc({ status: 'postponed' }), NOW)).toBe(false);
  });
});

describe('網址', () => {
  it('LINE 內用 Mini App ?competition=，複製用網站 /competitions/', () => {
    expect(buildCompetitionLiffUrl(CID)).toBe(`https://miniapp.line.me/2009525300-AuPGQ0sh?competition=${CID}`);
    expect(buildCompetitionLiffUrl(CID)).not.toContain('tournament');
    expect(buildCompetitionCopyUrl(CID)).toBe(`https://toosterx.com/competitions/${CID}`);
  });
});

describe('替代文字與卡片', () => {
  const url = buildCompetitionLiffUrl(CID);

  it('招募中列報名截止；過了截止不列', () => {
    expect(buildCompetitionShareAltText(doc(), url, ct, NOW)).toBe([
      '＜示範盃＞',
      '賽事分類：聯賽',
      '比賽期間：2027/01/09 – 01/10',
      '場地：示範球場',
      '報名截止：12/20 23:59',
      url,
    ].join('\n'));
    const closed = buildCompetitionShareAltText(doc(), url, ct, REG_CLOSE + 1);
    expect(closed).not.toContain('報名截止');
  });

  it('替代文字超過 400 字：只截內文、網址完整留在最後（碼點截斷，不切半個字）', () => {
    const text = buildCompetitionShareAltText(doc({ name: '😀'.repeat(300) }), url, ct, NOW);
    expect(text.length).toBeLessThanOrEqual(400);
    expect(text.endsWith('...\n' + url)).toBe(true);
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    const venues = Array.from({ length: 10 }, (_, i) => ({ name: `${i}`.repeat(40) }));
    const many = buildCompetitionShareAltText(doc({ venues }), url, ct, NOW);
    expect(many.length).toBeLessThanOrEqual(400);
    expect(many.endsWith('...\n' + url)).toBe(true);
    const copyUrl = buildCompetitionCopyUrl(CID);
    expect(buildCompetitionShareAltText(doc({ venues }), copyUrl, ct, NOW).endsWith('\n' + copyUrl)).toBe(true);
    expect(buildCompetitionShareAltText(doc(), url, ct, NOW).endsWith('\n' + url)).toBe(true);
  });

  it('取消、延期列狀態；主辦提前結束不列報名截止', () => {
    expect(buildCompetitionShareAltText(doc({ status: 'cancelled' }), url, ct, NOW)).toContain('狀態：已取消');
    expect(JSON.stringify(buildCompetitionFlexMessage(doc({ status: 'postponed' }), url, ct, NOW))).toContain('已延期');
    expect(buildCompetitionShareAltText(doc(), url, ct, NOW)).not.toContain('狀態');
    expect(isRecruiting(doc({ endedAt: NOW - 1 }), NOW)).toBe(false);
  });

  it('Flex：分類、名稱、期間、場地、截止、查看賽事；不放主辦、聯絡、隊伍', () => {
    const bubble = buildCompetitionFlexMessage(doc({ category: 'cup', contactNote: 'LINE：@x' }), url, ct, NOW);
    const json = JSON.stringify(bubble);
    for (const text of ['⚽ 盃賽', '示範盃', '比賽期間', '2027/01/09 – 01/10', '場地', '示範球場', '報名截止', '查看賽事']) {
      expect(json).toContain(text);
    }
    for (const text of ['示範俱樂部', '@x', 'club_host', '主辦', '繳交']) {
      expect(json).not.toContain(text);
    }
    expect(bubble.footer?.contents[0]).toMatchObject({ type: 'button', action: { type: 'uri', uri: url } });
  });

  it('有封面用封面，沒有封面用足球預設圖', () => {
    expect(competitionShareImage(doc({ cover: { url: COVER_URL, thumb: COVER_URL } }))).toEqual({ url: COVER_URL, aspectRatio: '8:3' });
    expect(competitionShareImage(doc({ cover: null }))?.url).toMatch(/^https:\/\/toosterx\.com\/assets\/og\/sports\/football\.jpg\?v=/);
    expect(buildCompetitionFlexMessage(doc({ cover: null }), url, ct, NOW).hero).toMatchObject({ type: 'image', size: 'full' });
  });

  it('選單文字七語系都有（鍵都存在）', () => {
    for (const locale of ['zh-TW', 'zh-CN', 'en', 'ja', 'vi', 'th', 'ko']) {
      const d = JSON.parse(readFileSync(resolve(__dirname, `../locales-lazy/${locale}.json`), 'utf8')) as Record<string, string>;
      const labels = shareSheetLabels(makeCompetitionsT(d));
      for (const value of Object.values(labels)) expect(value).not.toMatch(/^share|^cancel$/);
      for (const key of ['shareBtn', 'shareView', 'shareDone', 'shareFailed', 'shareCopied', 'shareClipboard']) {
        expect(d[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });
});

describe('shareCompetition 流程（照 shareEvent）', () => {
  it('LINE 好友：picker 送 Flex，替代文字用 Mini App 網址', async () => {
    const liff = picker();
    const opt = options();
    const showSheet = vi.fn(async () => 'line' as const);
    await shareCompetition(doc(), opt, { loadLiff: async () => liff, showSheet });
    expect(showSheet).toHaveBeenCalledWith(true, opt.signal, '分享賽事', expect.objectContaining({ friends: 'LINE 好友' }));
    expect(liff.shareTargetPicker).toHaveBeenCalledWith([expect.objectContaining({
      type: 'flex',
      altText: expect.stringContaining(`?competition=${CID}`),
    })]);
    expect(opt.showToast).toHaveBeenCalledWith('賽事已分享到 LINE');
  });

  it('picker 丟錯提示分享失敗；不能用 picker 卻選好友提示在 LINE 開啟', async () => {
    const liff = picker();
    vi.mocked(liff.shareTargetPicker).mockRejectedValueOnce(new Error('x'));
    const opt = options();
    await shareCompetition(doc(), opt, { loadLiff: async () => liff, showSheet: async () => 'line' });
    expect(opt.showToast).toHaveBeenCalledWith('分享失敗，請稍後再試');
    const opt2 = options();
    await shareCompetition(doc(), opt2, { loadLiff: async () => null, showSheet: async () => 'line' });
    expect(opt2.showToast).toHaveBeenCalledWith('請在 LINE 中開啟以使用此功能');
  });

  it('複製連結用網站網址；LINE 社群走 R/share；取消不動作', async () => {
    const copy = vi.fn(async (_text: string) => true);
    const openLine = vi.fn();
    const opt = options();
    await shareCompetition(doc(), opt, { loadLiff: async () => null, showSheet: async () => 'copy', copy });
    expect(copy).toHaveBeenCalledOnce();
    expect(copy.mock.calls[0]?.[0]).toContain(`https://toosterx.com/competitions/${CID}`);
    expect(copy.mock.calls[0]?.[0]).not.toContain('miniapp');
    expect(opt.showToast).toHaveBeenCalledWith('連結已複製');

    await shareCompetition(doc(), opt, { loadLiff: async () => null, showSheet: async () => 'line-share', openLine });
    expect(openLine).toHaveBeenCalledWith(expect.stringContaining(`?competition=${CID}`));

    copy.mockClear();
    openLine.mockClear();
    await shareCompetition(doc(), opt, { loadLiff: async () => null, showSheet: async () => 'cancel', copy, openLine });
    expect(copy).not.toHaveBeenCalled();
    expect(openLine).not.toHaveBeenCalled();
  });

  it('訪客不在 LINE：不載 SDK、不開選單，走 navigator.share；失敗再複製', async () => {
    const showSheet = vi.fn(async () => 'copy' as const);
    const nativeShare = vi.fn(async () => undefined);
    await shareCompetition(doc(), options(false), { showSheet, nativeShare });
    expect(showSheet).not.toHaveBeenCalled();
    expect(nativeShare).toHaveBeenCalledWith({ text: expect.stringContaining(`?competition=${CID}`) });

    const copy = vi.fn(async () => false);
    const opt = options(false);
    await shareCompetition(doc(), opt, {
      showSheet,
      nativeShare: async () => { throw new Error('denied'); },
      copy,
    });
    expect(copy).toHaveBeenCalledOnce();
    expect(opt.showToast).toHaveBeenCalledWith('複製失敗，請手動複製');

    const aborted = vi.fn(async () => true);
    await shareCompetition(doc(), options(false), {
      nativeShare: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); },
      copy: aborted,
    });
    expect(aborted).not.toHaveBeenCalled();
  });

  it('不可分享的賽事不動作；連點只跑一次；中止後不提示', async () => {
    const showSheet = vi.fn(async () => 'copy' as const);
    await shareCompetition(doc({ status: 'draft' }), options(), { loadLiff: async () => null, showSheet });
    expect(showSheet).not.toHaveBeenCalled();

    let release!: (value: 'cancel') => void;
    const slow = vi.fn(() => new Promise<'cancel'>((resolve) => { release = resolve; }));
    const first = shareCompetition(doc(), options(), { loadLiff: async () => null, showSheet: slow });
    await shareCompetition(doc(), options(), { loadLiff: async () => null, showSheet: slow });
    await vi.waitFor(() => expect(slow).toHaveBeenCalledOnce());
    release('cancel');
    await first;

    const controller = new AbortController();
    const opt = options(true, controller.signal);
    await shareCompetition(doc(), opt, {
      loadLiff: async () => null,
      showSheet: async () => { controller.abort(); return 'copy'; },
      copy: vi.fn(async () => true),
    });
    expect(opt.showToast).not.toHaveBeenCalled();
  });
});
