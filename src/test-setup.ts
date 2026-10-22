// vitest 共用 setup（vite.config.ts 的 test.setupFiles）。
// 整包平行跑時，findBy*／waitFor 的預設 1 秒等待會偶發逾時（2026-10-22 M-071、M-090 各發生一次，單跑都在 1 秒內）；
// 統一放寬到 10 秒，取代逐個測試加 timeout；testTimeout 另在 vite.config.ts 設 15 秒。
import { configure } from '@testing-library/preact';

configure({ asyncUtilTimeout: 10_000 });
