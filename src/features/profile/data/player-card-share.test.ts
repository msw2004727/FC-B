import { describe, expect, it, vi } from 'vitest';

import {
  PLAYER_CARD_FILE_NAME,
  choosePlayerCardShareRoute,
  isLineInAppBrowser,
  sharePlayerCardBlob,
  type ShareNavigatorLike,
} from './player-card-share';

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const LINE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/14.10.0';

const pngBlob = (): Blob => new Blob(['png'], { type: 'image/png' });
const file = (): File => new File([pngBlob()], PLAYER_CARD_FILE_NAME, { type: 'image/png' });

describe('T-092 分享球員卡三條路', () => {
  it('辨識 LINE 內建瀏覽器 UA', () => {
    expect(isLineInAppBrowser(LINE_UA)).toBe(true);
    expect(isLineInAppBrowser(CHROME_UA)).toBe(false);
    expect(isLineInAppBrowser(undefined)).toBe(false);
  });

  it('可分享檔案 → share；LINE 不能分享 → overlay；其他 → download', () => {
    const canShareNav: ShareNavigatorLike = {
      userAgent: LINE_UA,
      canShare: () => true,
      share: async () => undefined,
    };
    expect(choosePlayerCardShareRoute(canShareNav, file())).toBe('share');
    expect(choosePlayerCardShareRoute({ userAgent: LINE_UA }, file())).toBe('overlay');
    expect(choosePlayerCardShareRoute({ userAgent: LINE_UA, canShare: () => false, share: async () => undefined }, file()))
      .toBe('overlay');
    expect(choosePlayerCardShareRoute({ userAgent: CHROME_UA }, file())).toBe('download');
    // canShare 丟錯視為不能分享
    expect(choosePlayerCardShareRoute({
      userAgent: CHROME_UA,
      canShare: () => {
        throw new TypeError('bad');
      },
      share: async () => undefined,
    }, file())).toBe('download');
    // 只有 share 沒有 canShare：不能確認可分享檔案，不走 share
    expect(choosePlayerCardShareRoute({ userAgent: CHROME_UA, share: async () => undefined }, file()))
      .toBe('download');
  });

  it('share 路徑：帶 PNG 檔呼叫 navigator.share，不下載', async () => {
    const share = vi.fn(async (_data: ShareData) => undefined);
    const download = vi.fn();
    const outcome = await sharePlayerCardBlob(pngBlob(), {
      nav: { userAgent: CHROME_UA, canShare: () => true, share },
      download,
    });
    expect(outcome).toBe('shared');
    const data = share.mock.calls[0]![0];
    expect(data.files?.[0]?.name).toBe(PLAYER_CARD_FILE_NAME);
    expect(data.files?.[0]?.type).toBe('image/png');
    expect(download).not.toHaveBeenCalled();
  });

  it('使用者取消分享（AbortError）什麼都不做；其他錯誤退回覆蓋層', async () => {
    const download = vi.fn();
    const aborted = await sharePlayerCardBlob(pngBlob(), {
      nav: {
        userAgent: CHROME_UA,
        canShare: () => true,
        share: async () => {
          throw new DOMException('cancel', 'AbortError');
        },
      },
      download,
    });
    expect(aborted).toBe('cancelled');
    const denied = await sharePlayerCardBlob(pngBlob(), {
      nav: {
        userAgent: CHROME_UA,
        canShare: () => true,
        share: async () => {
          throw new DOMException('no gesture', 'NotAllowedError');
        },
      },
      download,
    });
    expect(denied).toBe('overlay');
    expect(download).not.toHaveBeenCalled();
  });

  it('LINE 內建瀏覽器不能分享檔案 → overlay，不下載', async () => {
    const download = vi.fn();
    await expect(sharePlayerCardBlob(pngBlob(), { nav: { userAgent: LINE_UA }, download }))
      .resolves.toBe('overlay');
    expect(download).not.toHaveBeenCalled();
  });

  it('桌機不能分享檔案 → 下載 PNG', async () => {
    const download = vi.fn();
    const blob = pngBlob();
    await expect(sharePlayerCardBlob(blob, { nav: { userAgent: CHROME_UA }, download }))
      .resolves.toBe('downloaded');
    expect(download).toHaveBeenCalledWith(blob, PLAYER_CARD_FILE_NAME);
  });
});
