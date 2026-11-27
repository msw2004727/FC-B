import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 只比對已進版本的檔案。取代原本另讀 .grok-input 凍結檔的比對：那個檔案不進 Git，乾淨工作樹與 CI 會失敗（PM 收 U3 基底時發現）。
describe('asia-main 規則快照', () => {
  it('sha256 與 RULES_SOURCE、FC S1 版前 16 碼一致', () => {
    const rules = readFileSync('emulator/asia-main.rules');
    const recorded = JSON.parse(readFileSync('emulator/RULES_SOURCE.json', 'utf8')) as {
      asiaMainRules: { sha256: string; fcCommit: string };
    };
    const hash = createHash('sha256').update(rules).digest('hex');
    expect(hash).toBe(recorded.asiaMainRules.sha256);
    expect(recorded.asiaMainRules.fcCommit).toBe('79296d983');
    expect(hash.slice(0, 16)).toBe('37add016c3084d24');
  });
});
