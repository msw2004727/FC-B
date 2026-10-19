#!/usr/bin/env node
// 改版頁面（照 A 的 DOM）一次性轉換：把帶 data-i18n 的元素文字與 data-i18n-{title,aria-label,placeholder}
// 對應的屬性改成 lt(key, 原文)，行為照 A navigation.js#_applyStaticI18n（只翻有標記的地方，查不到用原文）。
// 用法：node scripts/apply-legacy-i18n.mjs <檔案.tsx> [...]
// 已轉過的不會重複轉（文字已是 {…} 運算式、屬性已是運算式就跳過）。
// 解析器用 @babel/parser（FC-B 用 TypeScript 7 原生版，沒有 JS 的語法 API）。
import fs from 'node:fs';
import { parse } from '@babel/parser';

const ATTRS = ['title', 'aria-label', 'placeholder'];

function quote(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function attrName(attr) {
  return attr.name.type === 'JSXNamespacedName'
    ? `${attr.name.namespace.name}:${attr.name.name.name}`
    : attr.name.name;
}

function stringValue(attr) {
  return attr && attr.value && attr.value.type === 'StringLiteral' ? attr.value.value : null;
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((v) => walk(v, visit));
    else if (value && typeof value.type === 'string') walk(value, visit);
  }
}

function transform(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  const edits = [];

  walk(ast.program, (node) => {
    if (node.type !== 'JSXElement') return;
    const attrs = node.openingElement.attributes.filter((a) => a.type === 'JSXAttribute');
    const byName = new Map(attrs.map((a) => [attrName(a), a]));

    const key = stringValue(byName.get('data-i18n'));
    if (key) {
      const children = node.children.filter((c) => !(c.type === 'JSXText' && !c.value.trim()));
      if (children.length === 1 && children[0].type === 'JSXText') {
        const child = children[0];
        const text = child.value.trim();
        const lead = child.value.slice(0, child.value.indexOf(text));
        const trail = child.value.slice(child.value.indexOf(text) + text.length);
        edits.push({ start: child.start, end: child.end, text: `${lead}{lt(${quote(key)}, ${quote(text)})}${trail}` });
      }
    }

    for (const name of ATTRS) {
      const attrKey = stringValue(byName.get(`data-i18n-${name}`));
      const target = byName.get(name);
      const original = stringValue(target);
      if (!attrKey || original === null) continue;
      edits.push({ start: target.value.start, end: target.value.end, text: `{lt(${quote(attrKey)}, ${quote(original)})}` });
    }
  });

  if (edits.length === 0) return 0;
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  const existing = out.match(/import \{([^}]*)\} from '@\/i18n\/i18n';/);
  if (existing) {
    const names = existing[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (!names.includes('lt')) {
      names.push('lt');
      out = out.replace(existing[0], `import { ${names.sort((a, b) => a.localeCompare(b)).join(', ')} } from '@/i18n/i18n';`);
    }
  } else {
    const imports = [...out.matchAll(/^import [\s\S]*?;$/gm)];
    const last = imports.pop();
    const at = last ? last.index + last[0].length : 0;
    out = `${out.slice(0, at)}\nimport { lt } from '@/i18n/i18n';${out.slice(at)}`;
  }
  fs.writeFileSync(file, out);
  return edits.length;
}

for (const file of process.argv.slice(2)) {
  console.log(`${file}: ${transform(file)} 處`);
}
