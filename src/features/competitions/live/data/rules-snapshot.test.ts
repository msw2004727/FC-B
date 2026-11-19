import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('asia-main 規則快照', () => {
  it('sha256 與 RULES_SOURCE、派工卡前 16 碼、凍結檔一致', () => {
    const rules = readFileSync('emulator/asia-main.rules');
    const frozen = readFileSync('.grok-input/asia-main.rules.integ-c096dfd43');
    const recorded = JSON.parse(readFileSync('emulator/RULES_SOURCE.json', 'utf8')) as {
      asiaMainRules: { sha256: string; fcCommit: string };
    };
    const hash = createHash('sha256').update(rules).digest('hex');
    expect(hash).toBe(recorded.asiaMainRules.sha256);
    expect(recorded.asiaMainRules.fcCommit).toBe('c096dfd43');
    expect(hash.slice(0, 16)).toBe('17068d4b6bd9e908');
    expect(Buffer.compare(rules, frozen)).toBe(0);
  });
});
