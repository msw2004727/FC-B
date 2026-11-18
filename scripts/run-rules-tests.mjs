#!/usr/bin/env node
// 在 Firestore emulator 已聽 127.0.0.1:8080 時，只跑檔名含 .rules.test. 的測試。
// 由 firebase emulators:exec（npm run test:rules）呼叫。
// hookTimeout：正本規則較大，五個檔平行載入時預設 10 秒不夠；教育測試自己已設 120 秒。

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitest = resolve(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');

const result = spawnSync(process.execPath, [vitest, 'run', '.rules.test.', '--hookTimeout=120000'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    RUN_FIRESTORE_RULES_TESTS: '1',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  },
});

if (result.error) {
  console.error(`[run-rules-tests] ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
