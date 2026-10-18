#!/usr/bin/env node
/**
 * 檢查 B 的 INHERENT_ROLE_PERMISSIONS 是否與 A 前端、Functions 三邊一致（R-IAM-008）。
 *
 * 用法：node scripts/check-permission-parity.mjs <FC repo path>
 *  - 讀取 <FC>/js/config.js 與 <FC>/functions/index.js 的 `INHERENT_ROLE_PERMISSIONS = Object.freeze({ ... })`。
 *  - 讀取本 repo `src/features/profile/data/permissions.ts` 的同名常數。
 *  - 三者不一致時列出差異並 exit 1。只用 Node 內建模組。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const CONSTANT_NAME = 'INHERENT_ROLE_PERMISSIONS';

function fail(message, code = 1) {
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(code);
}

function extractObjectLiteral(source, name) {
  // 允許 TS 型別標註（例如 `: Readonly<...>`），B 的 permissions.ts 有標註、A 的 JS 沒有
  const assignRe = new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*Object\\.freeze\\s*\\(`);
  const m = assignRe.exec(source);
  if (!m) throw new Error(`找不到 ${name} = Object.freeze(...) 的指派`);
  const afterParen = m.index + m[0].length;
  const openBrace = source.indexOf('{', afterParen);
  if (openBrace < 0) throw new Error(`${name}：Object.freeze( 後找不到物件字面量 {`);

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let endBrace = -1;

  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    const prev = i > 0 ? source[i - 1] : '';
    const next = i + 1 < source.length ? source[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTick) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '`') inTick = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" && prev !== '\\') {
      inSingle = true;
      continue;
    }
    if (ch === '"' && prev !== '\\') {
      inDouble = true;
      continue;
    }
    if (ch === '`' && prev !== '\\') {
      inTick = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        endBrace = i;
        break;
      }
    }
  }

  if (endBrace < 0) throw new Error(`${name}：找不到物件字面量的結尾 }`);
  return source.slice(openBrace, endBrace + 1);
}

function parseConstant(source, label) {
  const literal = extractObjectLiteral(source, CONSTANT_NAME);
  const sandbox = Object.create(null);
  sandbox.Object = Object;
  try {
    const value = vm.runInNewContext(`(${literal})`, sandbox, { timeout: 1000 });
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${label}：解析出的不是物件`);
    }
    return value;
  } catch (err) {
    throw new Error(`${label}：解析失敗 — ${err.message}`);
  }
}

function normalizeConstants(obj) {
  const out = {};
  const keys = Object.keys(obj).sort();
  for (const k of keys) {
    const v = obj[k];
    out[k] = Array.isArray(v) ? v.slice() : v;
  }
  return out;
}

function diffConstants(refLabel, refValue, otherLabel, otherValue) {
  const diffs = [];
  const refKeys = Object.keys(refValue).sort();
  const otherKeys = Object.keys(otherValue).sort();
  const allKeys = Array.from(new Set([...refKeys, ...otherKeys])).sort();

  for (const key of allKeys) {
    const hasRef = Object.prototype.hasOwnProperty.call(refValue, key);
    const hasOther = Object.prototype.hasOwnProperty.call(otherValue, key);
    if (!hasRef) {
      diffs.push(`  - ${otherLabel} 有鍵 "${key}"，但 ${refLabel} 沒有`);
      continue;
    }
    if (!hasOther) {
      diffs.push(`  - ${refLabel} 有鍵 "${key}"，但 ${otherLabel} 沒有`);
      continue;
    }
    const a = Array.isArray(refValue[key]) ? refValue[key] : null;
    const b = Array.isArray(otherValue[key]) ? otherValue[key] : null;
    if (!a || !b) {
      diffs.push(`  - 鍵 "${key}" 不是陣列（${refLabel}: ${typeof refValue[key]}, ${otherLabel}: ${typeof otherValue[key]}）`);
      continue;
    }
    const aJson = JSON.stringify(a);
    const bJson = JSON.stringify(b);
    if (aJson !== bJson) {
      diffs.push(`  - 鍵 "${key}"：`);
      diffs.push(`      ${refLabel}: ${aJson}`);
      diffs.push(`      ${otherLabel}: ${bJson}`);
    }
  }
  return diffs;
}

function main() {
  const fcRoot = process.argv[2];
  if (!fcRoot) {
    fail('用法：node scripts/check-permission-parity.mjs <FC repo path>', 2);
  }

  const fcPath = path.resolve(fcRoot);
  const configPath = path.join(fcPath, 'js', 'config.js');
  const functionsPath = path.join(fcPath, 'functions', 'index.js');

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const bPath = path.resolve(scriptDir, '..', 'src', 'features', 'profile', 'data', 'permissions.ts');

  for (const [label, p] of [['A config.js', configPath], ['A functions/index.js', functionsPath], ['B permissions.ts', bPath]]) {
    if (!fs.existsSync(p)) fail(`找不到檔案：${label} → ${p}`, 2);
  }

  let aConfig;
  let aFunctions;
  let bConst;
  try {
    aConfig = parseConstant(fs.readFileSync(configPath, 'utf8'), 'A config.js');
    aFunctions = parseConstant(fs.readFileSync(functionsPath, 'utf8'), 'A functions/index.js');
    bConst = parseConstant(fs.readFileSync(bPath, 'utf8'), 'B permissions.ts');
  } catch (err) {
    fail(`解析失敗：${err.message}`, 2);
  }

  aConfig = normalizeConstants(aConfig);
  aFunctions = normalizeConstants(aFunctions);
  bConst = normalizeConstants(bConst);

  const problems = [];

  const funcVsConfig = diffConstants('A config.js', aConfig, 'A functions/index.js', aFunctions);
  if (funcVsConfig.length > 0) {
    problems.push('❌ A functions/index.js 與 A config.js 不一致：');
    problems.push(...funcVsConfig);
  }

  const bVsConfig = diffConstants('A config.js', aConfig, 'B permissions.ts', bConst);
  if (bVsConfig.length > 0) {
    problems.push('❌ B permissions.ts 與 A config.js 不一致：');
    problems.push(...bVsConfig);
  }

  const bVsFunctions = diffConstants('A functions/index.js', aFunctions, 'B permissions.ts', bConst);
  if (bVsFunctions.length > 0 && bVsConfig.length === 0) {
    problems.push('❌ B permissions.ts 與 A functions/index.js 不一致：');
    problems.push(...bVsFunctions);
  }

  if (problems.length > 0) {
    // eslint-disable-next-line no-console
    console.error(problems.join('\n'));
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`✔ INHERENT_ROLE_PERMISSIONS 三邊一致（A js/config.js、functions/index.js、B permissions.ts）`);
}

main();
