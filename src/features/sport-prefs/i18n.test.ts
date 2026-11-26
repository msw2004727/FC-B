import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIR = path.resolve(__dirname, 'locales-lazy');
const LANGS = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'th', 'vi'] as const;

type Flat = Record<string, string>;

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
}

function flatten(obj: Record<string, unknown>, prefix = '', out: Flat = {}): Flat {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else out[key] = String(v);
  }
  return out;
}

const dicts: Array<{ lang: string; flat: Flat }> = LANGS.map((lang) => ({
  lang,
  flat: flatten(readJson(path.join(DIR, `${lang}.json`))),
}));

describe('sport-prefs/i18n locales', () => {
  it('七個 locale 檔鍵集合完全相同', () => {
    const ref = new Set(Object.keys(dicts[0]!.flat));
    for (let i = 1; i < dicts.length; i += 1) {
      const cur = new Set(Object.keys(dicts[i]!.flat));
      expect(Array.from(cur).sort()).toEqual(Array.from(ref).sort());
    }
  });

  it('每個 removeConfirm 都含 {name}、\\n，且提到 add 按鈕名稱', () => {
    for (const { lang, flat } of dicts) {
      const v = flat['removeConfirm'];
      expect(typeof v, `removeConfirm @ ${lang}`).toBe('string');
      expect(v, `{name} @ ${lang}`).toContain('{name}');
      expect(v, `\\n @ ${lang}`).toContain('\n');
      const addText = flat['add'] ?? '';
      expect(addText.length, `add @ ${lang}`).toBeGreaterThan(0);
      expect(addText, `add 保留＋ @ ${lang}`).toMatch(/[＋+]$/);
      expect(v, `removeConfirm 提及 add @ ${lang}`).toContain(addText);
    }
  });

  it('add 按鈕各語系都以＋結尾（中日全形、拉丁與泰韓半形，Opus 終審第 4 條）', () => {
    for (const { lang, flat } of dicts) {
      expect(flat['add'], `add @ ${lang}`).toMatch(lang === 'zh-TW' || lang === 'zh-CN' || lang === 'ja' ? /＋$/ : / \+$/);
    }
  });

  it('sport.* 值與 events locales 相同', () => {
    const eventsDir = path.resolve(__dirname, '../events/locales');
    for (const { lang, flat } of dicts) {
      const eventsPath = path.join(eventsDir, `${lang}.json`);
      if (!fs.existsSync(eventsPath)) continue;
      const eventsFlat = flatten(readJson(eventsPath));
      for (const [k, v] of Object.entries(flat)) {
        if (!k.startsWith('sport.')) continue;
        expect(eventsFlat[k], `${k} @ ${lang}`).toBe(v);
      }
    }
  });
});
