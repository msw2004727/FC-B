// 記分模擬器測試（CI emu job）的結果核對：模擬器沒起來時 *.emu.test.* 會整檔 describe.skipIf 略過、
// vitest 仍回 0。這支讀 vitest JSON 報告，略過、失敗或條數不足都算失敗，避免「沒跑也綠」。
// 用法：node scripts/check-emu-report.mjs <report.json> <最少條數>
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkEmuReport(report, minTests) {
  const errors = [];
  const total = Number(report?.numTotalTests ?? 0);
  const passed = Number(report?.numPassedTests ?? 0);
  const failed = Number(report?.numFailedTests ?? 0);
  const skipped = Number(report?.numPendingTests ?? 0) + Number(report?.numTodoTests ?? 0);
  if (report?.success !== true) errors.push('vitest 回報 success 不是 true');
  if (failed > 0) errors.push(`失敗 ${failed} 條`);
  if (skipped > 0) errors.push(`略過 ${skipped} 條（模擬器可能沒連上）`);
  if (passed < minTests) errors.push(`通過 ${passed} 條，少於最少 ${minTests} 條`);
  return { ok: errors.length === 0, errors, total, passed, failed, skipped };
}

// 兩邊都取 realpath 再比（經由 junction 執行時 argv[1] 不會解析連結）；同 check-cp-css-budget.mjs。
function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(path.resolve(argv1)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const [file, min] = process.argv.slice(2);
  const minTests = Number(min);
  if (!file || !Number.isInteger(minTests) || minTests < 1) {
    console.error('用法：node scripts/check-emu-report.mjs <report.json> <最少條數>');
    process.exit(2);
  }
  const result = checkEmuReport(JSON.parse(readFileSync(file, 'utf8')), minTests);
  console.log(`記分模擬器：共 ${result.total}、通過 ${result.passed}、失敗 ${result.failed}、略過 ${result.skipped}（最少 ${minTests}）`);
  if (!result.ok) {
    for (const e of result.errors) console.error(`✗ ${e}`);
    process.exit(1);
  }
}
