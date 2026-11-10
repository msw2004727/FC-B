// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { taipeiBuildId } from './build-meta.mjs';
import {
  assertAllowedOnlineUrl,
  assertNewerThanOnline,
  assertRuntimeConfigShape,
  ONLINE_VERSION_URL,
  onlineUrlFromArgv,
  replaceMinBuild,
  runForceUpdate,
  RUNTIME_CONFIG_KEYS,
} from './force-update.mjs';

const NOW = new Date('2026-11-10T16:05:00.000Z'); // 台北 2026-11-11 00:05
const NEXT = '202611110005';

const SOURCE = `{
    "swEnabled": true,
    "minBuild": 0,
    "googleMapsBrowserApiKey": "abc",
    "googleMapsVersion": "quarterly"
}
`;

describe('force-update', () => {
  it('minBuild 是當下台北時間、恰好 12 位、不大於當下', async () => {
    expect(taipeiBuildId(NOW)).toBe(NEXT);
    let written = '';
    const result = await runForceUpdate({
      now: NOW,
      readFile: () => SOURCE,
      writeFile: (_file, text) => { written = text; },
      fetchOnline: async () => '202611101200',
    });
    expect(result.next).toBe(Number(NEXT));
    expect(String(result.next)).toHaveLength(12);
    expect(result.next).toBeLessThanOrEqual(Number(taipeiBuildId(NOW)));
    expect(written).toBe(SOURCE.replace('"minBuild": 0', `"minBuild": ${NEXT}`));
    const before = JSON.parse(SOURCE);
    const after = JSON.parse(written);
    expect(after.minBuild).toBe(Number(NEXT));
    delete before.minBuild;
    delete after.minBuild;
    expect(after).toEqual(before);
  });

  it('只改 minBuild，縮排與其他欄位保留', () => {
    const next = replaceMinBuild(SOURCE, NEXT);
    expect(next).toContain('    "swEnabled": true,');
    expect(next).toContain('"googleMapsBrowserApiKey": "abc"');
    expect(next).not.toContain('"minBuild": 0');
  });

  it('不大於線上建置編號就失敗，且不寫檔', async () => {
    let wrote = false;
    const writeFile = () => { wrote = true; };
    await expect(runForceUpdate({
      now: NOW,
      readFile: () => SOURCE,
      writeFile,
      fetchOnline: async () => NEXT,
    })).rejects.toThrow(/不大於線上/);
    await expect(runForceUpdate({
      now: NOW,
      readFile: () => SOURCE,
      writeFile,
      fetchOnline: async () => '202611110006',
    })).rejects.toThrow(/不大於線上/);
    expect(wrote).toBe(false);
    expect(() => assertNewerThanOnline(NEXT, Number(NEXT))).toThrow(/不大於線上/);
  });

  it('離線或讀不到線上檔就失敗，不寫檔', async () => {
    let wrote = false;
    await expect(runForceUpdate({
      now: NOW,
      readFile: () => SOURCE,
      writeFile: () => { wrote = true; },
      fetchOnline: async () => { throw new Error('ENOTFOUND'); },
    })).rejects.toThrow(/讀不到線上 version\.json/);
    expect(wrote).toBe(false);
  });

  it('線上 build 不是建置編號就失敗，不寫檔', async () => {
    let wrote = false;
    await expect(runForceUpdate({
      now: NOW,
      readFile: () => SOURCE,
      writeFile: () => { wrote = true; },
      fetchOnline: async () => 'latest',
    })).rejects.toThrow(/未寫入/);
    expect(wrote).toBe(false);
  });

  it('缺檔、壞 JSON、minBuild 不是 0 或 12 位、多一個欄位，都不寫', async () => {
    let wrote = false;
    const writeFile = () => { wrote = true; };
    await expect(runForceUpdate({
      now: NOW,
      readFile: () => { throw new Error('ENOENT'); },
      writeFile,
      fetchOnline: async () => '0',
    })).rejects.toThrow(/讀不到 runtime-config\.json/);
    expect(() => replaceMinBuild('{', NEXT)).toThrow(/不是合法 JSON/);
    expect(() => replaceMinBuild('{"swEnabled":true,"minBuild":12}', NEXT)).toThrow(/12 位/);
    expect(() => replaceMinBuild('{"swEnabled":true,"minBuild":0,"extra":1}', NEXT)).toThrow(/不允許/);
    expect(wrote).toBe(false);
  });

  it('swEnabled 不是布林就失敗', () => {
    expect(() => assertRuntimeConfigShape({ swEnabled: 'true', minBuild: 0 })).toThrow(/布林/);
  });

  it('沒有 --online-url 時仍用正式站 version.json', () => {
    expect(ONLINE_VERSION_URL).toBe('https://toosterx.com/version.json');
    expect(onlineUrlFromArgv([])).toBe(ONLINE_VERSION_URL);
    expect(onlineUrlFromArgv(['--dry-run'])).toBe(ONLINE_VERSION_URL);
    expect(assertAllowedOnlineUrl('https://next.toosterx.com/version.json'))
      .toBe('https://next.toosterx.com/version.json');
  });

  it('--online-url 接受 next 站並寫檔', async () => {
    let written = '';
    const result = await runForceUpdate({
      now: NOW,
      onlineUrl: 'https://next.toosterx.com/version.json',
      readFile: () => SOURCE,
      writeFile: (_file, text) => { written = text; },
      fetchOnline: async () => '202611101200',
    });
    expect(result.next).toBe(Number(NEXT));
    expect(written).toContain(`"minBuild": ${NEXT}`);
  });

  it.each([
    'http://toosterx.com/version.json',
    'http://next.toosterx.com/version.json',
    'https://evil.com/version.json',
    'https://toosterx.com.evil.com/version.json',
    'https://evil.toosterx.com/version.json',
    'https://next.toosterx.com.evil.com/version.json',
    'https://nottoosterx.com/version.json',
    'https://user:pass@toosterx.com/version.json',
    'https://toosterx.com@evil.com/version.json',
    'https://toosterx.com:444/version.json',
    'https://toosterx.com/version.json?x=1',
    'https://toosterx.com/version.json#frag',
    'https://toosterx.com/other.json',
    'https://toosterx.com./version.json',
    'not a url',
  ])('拒絕 %s，且不寫檔', async (onlineUrl) => {
    let wrote = false;
    await expect(runForceUpdate({
      now: NOW,
      onlineUrl,
      readFile: () => SOURCE,
      writeFile: () => { wrote = true; },
      fetchOnline: async () => '0',
    })).rejects.toThrow(/未寫入/);
    expect(wrote).toBe(false);
  });

  it('--online-url=<網址> 等號寫法、旗標重複都失敗（不能靜默改用預設網址）', () => {
    expect(() => onlineUrlFromArgv(['--online-url=https://next.toosterx.com/version.json'])).toThrow(/只接受/);
    expect(() => onlineUrlFromArgv([
      '--online-url', 'https://next.toosterx.com/version.json',
      '--online-url', 'https://toosterx.com/version.json',
    ])).toThrow(/只能給一次/);
    expect(() => onlineUrlFromArgv(['--online-urlx', 'https://next.toosterx.com/version.json'])).toThrow(/只接受/);
  });

  it('--online-url 沒給網址就失敗', () => {
    expect(() => onlineUrlFromArgv(['--online-url'])).toThrow(/需要網址/);
    expect(() => onlineUrlFromArgv(['--online-url', '--help'])).toThrow(/需要網址/);
  });
});

describe('public/runtime-config.json 格式', () => {
  const data = JSON.parse(readFileSync(new URL('../public/runtime-config.json', import.meta.url), 'utf8'));

  it('swEnabled 是布林，minBuild 是 0 或 12 位整數，沒有名單外的欄位', () => {
    expect(typeof data.swEnabled).toBe('boolean');
    expect(data.minBuild === 0 || /^\d{12}$/.test(String(data.minBuild))).toBe(true);
    expect(Object.keys(data).sort()).toEqual([...RUNTIME_CONFIG_KEYS].sort());
    expect(() => assertRuntimeConfigShape(data)).not.toThrow();
  });

  it('多一個欄位、minBuild 多一位、swEnabled 改成字串，都會失敗', () => {
    expect(() => assertRuntimeConfigShape({ ...data, extra: true })).toThrow(/不允許/);
    expect(() => assertRuntimeConfigShape({ ...data, minBuild: 2026111112001 })).toThrow(/12 位/);
    expect(() => assertRuntimeConfigShape({ ...data, swEnabled: 1 })).toThrow(/布林/);
  });
});
