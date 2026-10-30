import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getUserPermissionGrantAllowedCodes } from '@/features/profile/data/permissions';

/** 僅解析指定函式的 literal；若 Rules 改成運算式，測試應失敗並要求重審 parser。 */
function parseGrantCodes(source: string): string[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const matches = [...clean.matchAll(/function\s+allowedUserPermissionGrantCodes\s*\(\s*\)\s*\{\s*return\s*\[([\s\S]*?)\]\s*;\s*\}/g)];
  if (matches.length !== 1) throw new Error('找不到唯一的 allowedUserPermissionGrantCodes literal');
  const body = matches[0]![1]!;
  const strings = [...body.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)];
  if (!strings.length || body.replace(/'([^'\\]*)'|"([^"\\]*)"/g, '').replace(/[\s,]/g, '')) {
    throw new Error('allowedUserPermissionGrantCodes 必須只有字串清單');
  }
  return strings.map(match => match[1] ?? match[2]!);
}

describe('M20 B 與同步 Rules 個別授權集合 parity', () => {
  const rulesPath = resolve(__dirname, '../../../../emulator/firestore.rules');
  it('兩方向差集必須皆空，兩邊都不含 admin.roles.entry', () => {
    const rules = new Set(parseGrantCodes(readFileSync(rulesPath, 'utf8')));
    const client = new Set(getUserPermissionGrantAllowedCodes());
    const onlyB = [...client].filter(code => !rules.has(code)).sort();
    const onlyRules = [...rules].filter(code => !client.has(code)).sort();
    const message = '僅 B：' + JSON.stringify(onlyB) + '；僅 Rules：' + JSON.stringify(onlyRules);
    expect({ onlyB, onlyRules }, message).toEqual({ onlyB: [], onlyRules: [] });
    expect(client.has('admin.roles.entry'), 'B 不得提供權限管理入口碼').toBe(false);
    expect(rules.has('admin.roles.entry'), 'Rules 不得提供權限管理入口碼').toBe(false);
  });
  it('同步副本符合 RULES_SOURCE 的來源 hash', () => {
    const source = JSON.parse(readFileSync(resolve(__dirname, '../../../../emulator/RULES_SOURCE.json'), 'utf8'));
    expect(createHash('sha256').update(readFileSync(rulesPath)).digest('hex')).toBe(source.sha256);
  });
  it('parser 對不存在、運算式與重複函式拒絕，不默認空集合', () => {
    const valid = "function allowedUserPermissionGrantCodes() { return ['test.code']; }";
    expect(parseGrantCodes(valid)).toEqual(['test.code']);
    for (const invalid of ['', valid + valid, valid.replace("'test.code'", 'anotherFunction()')]) {
      expect(() => parseGrantCodes(invalid)).toThrow();
    }
  });
});
