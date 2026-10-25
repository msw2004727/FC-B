import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import { toast } from '@/ui/Toast';
import {
  ACHIEVEMENTS_CLOSED_CLASS,
  ACHIEVEMENTS_OPEN,
  showAchievementsClosedToast,
  syncAchievementsClosedClass,
} from './availability';

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

  it('載入模組時依開關在 <html> 掛上狀態 class（關閉＝有 class）', () => {
    expect(document.documentElement.classList.contains(ACHIEVEMENTS_CLOSED_CLASS)).toBe(!ACHIEVEMENTS_OPEN);
    expect(ACHIEVEMENTS_CLOSED_CLASS).toBe('achievements-closed');
  });

  it('開放時移除 <html> 狀態 class，關閉時再加回（改 ACHIEVEMENTS_OPEN=true 後不會留下反灰，退修 1 #2）', () => {
    const root = document.createElement('html');
    syncAchievementsClosedClass(false, root);
    expect(root.classList.contains(ACHIEVEMENTS_CLOSED_CLASS)).toBe(true);
    syncAchievementsClosedClass(true, root);
    expect(root.classList.contains(ACHIEVEMENTS_CLOSED_CLASS)).toBe(false);
    syncAchievementsClosedClass(false, root);
    expect(root.classList.contains(ACHIEVEMENTS_CLOSED_CLASS)).toBe(true);
  });
});
