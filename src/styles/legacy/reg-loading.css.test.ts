import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function regLoadingRules(file: string): string[] {
  const css = readFileSync(resolve(__dirname, file), 'utf8');
  return css
    .split(/\r?\n/)
    .map((line) => line.trim())
    // 只取共用的轉圈與骨架規則本體（排除只屬於活動詳情的 .event-detail-belowfold-loading 覆寫與註解）。
    .filter((line) => /^(\.reg-loading(-skeleton(-row)?)?(::before)?\{|@keyframes reg-loading-)/.test(line))
    .sort();
}

describe('.reg-loading 共用規則', () => {
  it('reg-loading.css 與活動頁 activity.css 的重複定義一致，改一邊必須同步另一邊', () => {
    const shared = regLoadingRules('./reg-loading.css');
    const activity = regLoadingRules('../../features/events/legacy/activity.css');
    expect(shared.length).toBe(6);
    expect(activity).toEqual(shared);
  });
});
