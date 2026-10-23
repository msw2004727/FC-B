import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LOCALES, type Locale } from '@/i18n/locales';
import { DRAWER_MENUS } from '@/ui/drawer-menu';

async function loadManifest(): Promise<typeof import('./index')> {
  vi.resetModules();
  return import('./index');
}

function loadLocale(locale: Locale): Record<string, string> {
  // 相對路徑放變數：字面 new URL(`./locales/${locale}.json`, import.meta.url) 會被 Vite 改寫到錯誤磁碟路徑。
  const relativePath = `./locales/${locale}.json`;
  const raw: unknown = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${locale} 字典不是物件`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') throw new Error(`${locale}.${key} 不是字串`);
    out[key] = value;
  }
  return out;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('qa-login manifest', () => {
  it('內測模式時 routes 恰含 /qa-login，titleKey 為 qa-login.title', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_PUBLIC_LAUNCH', '');
    const { manifest } = await loadManifest();

    expect(manifest.routes.map((route) => route.path)).toEqual(['/qa-login']);
    expect(manifest.routes[0]?.titleKey).toBe('qa-login.title');
    expect(manifest.nav).toBeUndefined();
  });

  it('正式公開時 routes 為空陣列', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_PUBLIC_LAUNCH', '1');
    const { manifest } = await loadManifest();

    expect(manifest.routes).toEqual([]);
    expect(manifest.nav).toBeUndefined();
  });

  it('manifest 沒有 nav，ALL_FEATURES 含 qa-login，抽屜沒有 /qa-login', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_PUBLIC_LAUNCH', '1');
    vi.resetModules();
    const { ALL_FEATURES } = await import('@/features.config');

    expect(ALL_FEATURES.map((feature) => feature.id)).toContain('qa-login');
    const qaLogin = ALL_FEATURES.find((feature) => feature.id === 'qa-login');
    expect(qaLogin).toBeDefined();
    expect(qaLogin?.nav).toBeUndefined();

    for (const item of DRAWER_MENUS) {
      expect(item.routePath).not.toBe('/qa-login');
      expect(item.page).not.toBe('/qa-login');
    }
    expect(JSON.stringify(DRAWER_MENUS)).not.toContain('/qa-login');
  });

  it('七個語系 key 相同，zh-TW 的錯誤文案精確，五個 persona 用詞相同', () => {
    const dicts = Object.fromEntries(LOCALES.map((locale) => [locale, loadLocale(locale)])) as Record<
      Locale,
      Record<string, string>
    >;
    const zhTW = dicts['zh-TW'];
    const reference = Object.keys(zhTW).sort();

    expect(LOCALES).toHaveLength(7);
    expect(zhTW.error).toBe('無法進入測試模式');
    expect(zhTW.title).toBe('QA 測試模式');
    expect(reference).not.toContain('persona.placeholder');

    for (const locale of LOCALES) {
      expect(Object.keys(dicts[locale]).sort()).toEqual(reference);
      expect(dicts[locale].error).toBeTruthy();
      expect(dicts[locale].title).toBe(dicts[locale]['banner.plain']);
    }

    const personaKeys = ['persona.captain', 'persona.coach', 'persona.venueOwner', 'persona.memberA', 'persona.memberB'] as const;
    for (const key of personaKeys) {
      const values = LOCALES.map((locale) => dicts[locale][key]);
      expect(values.every((value) => value === zhTW[key])).toBe(true);
      expect(zhTW[key]).not.toBe('');
    }
  });
});
