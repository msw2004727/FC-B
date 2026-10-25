import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import { toast } from '@/ui/Toast';
import { ACHIEVEMENTS_OPEN, showAchievementsClosedToast } from './availability';

const EXPECTED: Record<Locale, string> = {
  'zh-TW': '功能尚未開放',
  'zh-CN': '功能尚未开放',
  en: 'This feature is not available yet',
  ja: 'この機能はまだ公開されていません',
  ko: '아직 오픈되지 않은 기능입니다',
  vi: 'Tính năng này chưa được mở',
  th: 'ฟีเจอร์นี้ยังไม่เปิดให้ใช้งาน',
};

describe('成就／稱號開放開關（T-038）', () => {
  beforeEach(async () => {
    localStorage.clear();
    _setDictLoaderForTest(null);
    await setLocale('zh-TW');
    toast.clear();
  });

  afterEach(() => {
    toast.clear();
    _setDictLoaderForTest(null);
    localStorage.clear();
  });

  it('預設關閉（2026-10-26 站長：成就徽章與稱號先反灰）', () => {
    expect(ACHIEVEMENTS_OPEN).toBe(false);
  });

  it.each(Object.entries(EXPECTED))('提示文字走 i18n：%s 語系有翻譯、不是 key 名稱', async (locale, message) => {
    await setLocale(locale as Locale);
    const spy = vi.spyOn(toast, 'show');
    showAchievementsClosedToast();
    expect(spy).toHaveBeenCalledWith({ message });
    expect(message).not.toContain('exp-achievements.closed');
    spy.mockRestore();
  });
});
