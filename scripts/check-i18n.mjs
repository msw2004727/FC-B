// 掃描 src/i18n/messages/ 與每個 src/features/*/locales/
// 以 zh-TW 為基準比對 7 個語系的 key 集合（含巢狀 key 攤平成 a.b）。
// 值必須是非空字串、插值參數集合一致、攤平後不得有 key 衝突。
// 有 index.ts 的 feature 必須有 locales/ 且 7 個語系檔都在。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LOCALES = ['zh-TW', 'zh-CN', 'en', 'ja', 'vi', 'th', 'ko'];
const BASE = 'zh-TW';

function flatten(obj, prefix = '') {
  /** @type {Record<string, unknown>} */
  const flat = {};
  /** @type {string[]} */
  const conflicts = [];

  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sub = flatten(v, key);
      for (const [sk, sv] of Object.entries(sub.flat)) {
        if (Object.prototype.hasOwnProperty.call(flat, sk)) {
          conflicts.push(sk);
        } else {
          flat[sk] = sv;
        }
      }
      conflicts.push(...sub.conflicts);
    } else {
      if (Object.prototype.hasOwnProperty.call(flat, key)) {
        conflicts.push(key);
      } else {
        flat[key] = v;
      }
    }
  }

  return { flat, conflicts: [...new Set(conflicts)] };
}

function extractParams(value) {
  const set = new Set();
  if (typeof value !== 'string') return set;
  for (const m of value.matchAll(/\{(\w+)\}/g)) {
    if (m[1]) set.add(m[1]);
  }
  return set;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

/**
 * 純函式：驗證多個命名空間。
 * @param {{ name: string; files: Record<string, object | Error> }[]} namespaces
 * @returns {string[]}
 */
export function checkNamespaces(namespaces) {
  /** @type {string[]} */
  const errors = [];

  for (const ns of namespaces) {
    /** @type {Record<string, Record<string, unknown>>} */
    const dicts = {};

    for (const locale of LOCALES) {
      const file = ns.files[locale];
      if (file === undefined) {
        errors.push(`[i18n] ${ns.name}/${locale}.json 缺檔`);
        continue;
      }
      if (file instanceof Error) {
        errors.push(`[i18n] ${ns.name}/${locale}.json 讀取或解析失敗：${file.message}`);
        continue;
      }
      if (!file || typeof file !== 'object' || Array.isArray(file)) {
        errors.push(`[i18n] ${ns.name}/${locale}.json 必須是物件`);
        continue;
      }

      const { flat, conflicts } = flatten(file);
      dicts[locale] = flat;

      for (const conflict of conflicts) {
        errors.push(`[i18n] ${ns.name}/${locale}.json key 衝突：${conflict}`);
      }

      for (const [key, value] of Object.entries(flat)) {
        if (typeof value !== 'string' || value.trim() === '') {
          errors.push(`[i18n] ${ns.name}/${locale}.json → ${key} 必須是非空字串`);
        }
      }
    }

    const base = dicts[BASE];
    if (!base) continue;
    const baseKeys = new Set(Object.keys(base));

    for (const locale of LOCALES) {
      if (locale === BASE) continue;
      const loc = dicts[locale];
      if (!loc) continue;

      const locKeys = new Set(Object.keys(loc));

      for (const key of baseKeys) {
        if (!locKeys.has(key)) {
          errors.push(`[i18n] 缺 key：${ns.name}/${locale}.json → ${key}`);
        }
      }
      for (const key of locKeys) {
        if (!baseKeys.has(key)) {
          errors.push(`[i18n] 多餘 key：${ns.name}/${locale}.json → ${key}`);
        }
      }

      for (const key of baseKeys) {
        if (!locKeys.has(key)) continue;
        const baseParams = extractParams(base[key]);
        const locParams = extractParams(loc[key]);
        if (!sameSet(baseParams, locParams)) {
          errors.push(`[i18n] 插值參數不同：${ns.name}/${locale}.json → ${key}`);
        }
      }
    }
  }

  return errors;
}

function readNamespaceFiles(dir) {
  /** @type {Record<string, object | Error>} */
  const files = {};
  for (const locale of LOCALES) {
    const path = join(dir, `${locale}.json`);
    try {
      files[locale] = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      files[locale] = e instanceof Error ? e : new Error(String(e));
    }
  }
  return files;
}

function loadNamespaces() {
  const ROOT = resolve(process.cwd());
  /** @type {{ name: string; files: Record<string, object | Error> }[]} */
  const namespaces = [];

  namespaces.push({
    name: 'core',
    files: readNamespaceFiles(join(ROOT, 'src/i18n/messages')),
  });

  const featuresDir = join(ROOT, 'src/features');
  let ids = [];
  try {
    ids = readdirSync(featuresDir);
  } catch (e) {
    throw new Error(`讀取 src/features 失敗：${e instanceof Error ? e.message : String(e)}`);
  }

  for (const id of ids) {
    const featureDir = join(featuresDir, id);
    let isDir = false;
    try {
      isDir = statSync(featureDir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;
    if (!existsSync(join(featureDir, 'index.ts'))) continue;

    namespaces.push({
      name: id,
      files: readNamespaceFiles(join(featureDir, 'locales')),
    });
  }

  return namespaces;
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  let namespaces;
  try {
    namespaces = loadNamespaces();
  } catch (e) {
    console.error(`[i18n] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const errors = checkNamespaces(namespaces);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error(`[i18n] 共 ${errors.length} 個問題`);
    process.exit(1);
  }

  for (const ns of namespaces) {
    const baseFile = ns.files[BASE];
    if (baseFile && !(baseFile instanceof Error)) {
      const { flat } = flatten(baseFile);
      console.log(`[i18n] ${ns.name}: ${Object.keys(flat).length} keys`);
    }
  }
  console.log('[i18n] 全部一致');
  process.exit(0);
}
