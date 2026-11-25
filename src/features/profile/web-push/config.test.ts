import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WEB_PUSH_VAPID_KEY_ID, WEB_PUSH_VAPID_PUBLIC_KEY } from './config';
import { WEB_PUSH_UI_PUBLIC } from './env';
import { base64UrlToBytes } from './flows';

describe('G 設定', () => {
  it('G1 公鑰 base64url 解碼後 65 bytes、首 byte 0x04', () => {
    const bytes = base64UrlToBytes(WEB_PUSH_VAPID_PUBLIC_KEY);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });

  it('G2 key id ＝ sha256(公鑰字串) 前 16 碼（同伺服器 computeVapidKeyId）', () => {
    expect(WEB_PUSH_VAPID_KEY_ID).toBe(createHash('sha256').update(WEB_PUSH_VAPID_PUBLIC_KEY).digest('hex').slice(0, 16));
  });

  it('已公開：正式常數為 true（站長 2026-11-25；開通前只給 QA 的保護改由 WebPushRow／WebPushSlot 測試注入 false 鎖住）', () => {
    expect(WEB_PUSH_UI_PUBLIC).toBe(true);
  });
});
