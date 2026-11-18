import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CP_REASON_CODES, CP_REASON_FALLBACK_KEY, cpReasonKey } from './reasons';

const LOCALES = ['zh-TW', 'zh-CN', 'en', 'ja', 'vi', 'th', 'ko'] as const;

function readLocale(locale: string): string {
  return readFileSync(resolve(__dirname, `../locales/${locale}.json`), 'utf8');
}

describe('cpReasonKey（契約 §5 全覆蓋）', () => {
  it('每個已知 reason 對到自己的鍵，未知回通用失敗鍵', () => {
    for (const code of CP_REASON_CODES) {
      expect(cpReasonKey(code)).toBe(`competitions.reason.${code}`);
    }
    expect(cpReasonKey('UNKNOWN')).toBe(CP_REASON_FALLBACK_KEY);
    expect(cpReasonKey('UNKNOWN_FIELD')).toBe(CP_REASON_FALLBACK_KEY);
    expect(cpReasonKey('')).toBe(CP_REASON_FALLBACK_KEY);
    expect(cpReasonKey('not-a-code')).toBe(CP_REASON_FALLBACK_KEY);
  });

  it('七語都是同一份繁中，而且每個 reason 都有非空文案', () => {
    const base = readLocale('zh-TW');
    const parsed = JSON.parse(base) as { reason: Record<string, string> };
    for (const locale of LOCALES) {
      expect(readLocale(locale), locale).toBe(base);
    }
    for (const code of CP_REASON_CODES) {
      expect(parsed.reason[code], code).toEqual(expect.any(String));
      expect(parsed.reason[code]?.trim().length).toBeGreaterThan(0);
    }
    expect(parsed.reason.UNKNOWN).toBe('操作失敗，請稍後再試');
    expect(parsed.reason.CLUB_SYNC_PENDING).toBe('俱樂部資料同步中');
    expect(parsed.reason.BANNED_WORD).toBe('名稱包含不允許的字詞');
    expect(parsed.reason.ROSTERS_LOCKED).toBe('名單已鎖定，不能再修改');
    expect(parsed.reason.BIRTHDAY_REQUIRED).toBe('請先補上生日');
  });

  it('站長已同意的文案逐字存在，禁用字錯誤不寫死任何字', () => {
    const text = readLocale('zh-TW');
    const exact = [
      '建立後是草稿，發布後才會公開招募',
      '繳費由主辦與參賽隊伍自行處理',
      '本站不經手款項',
      '未成年球員公開時會遮住名字第一個字（例：王O明）。',
      '真實姓名僅供主辦核對資格，不會公開。',
      '我已取得監護人同意',
      '我了解名單會公開顯示暱稱與背號',
      '我了解名單會公開顯示遮字後的姓名與背號',
      '我了解名單會公開顯示我的顯示名稱與背號',
      '公開顯示：{name}',
      '只用來判斷年齡，不會儲存',
      '還需 {n} 人才能確認（最少 {min} 人）',
      '還有 {n} 隊尚未確認名單。鎖定後所有隊伍都不能再改名單，確定鎖定？',
      '名單已鎖定，不能再修改',
      '名稱包含不允許的字詞',
      '每隊報名費',
      '免費',
      '線上支付',
      '即將推出',
    ];
    for (const line of exact) expect(text).toContain(line);
    for (const label of ['無', '守門員', '後衛', '中場', '前鋒', '自訂']) {
      expect(text).toContain(label);
    }
    expect(text).not.toMatch(/官方|協會|协会|聯盟|联盟|fifa|FIFA/);
  });
});
