// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const compatPath = new URL('../public/sw-legacy-compat.js', import.meta.url);
const configPath = new URL('../vite.config.ts', import.meta.url);

/** 舊站 index.html 的 canReloadWithControllerVersion 逐字對照（V 是舊站最後版本）。 */
function legacyCanReload(version, V = '0.20261030a') {
  if (version === V) return true;
  return /^0\.\d{8}[a-z]*$/.test(version) && /^0\.\d{8}[a-z]*$/.test(V) && version > V;
}

async function loadListener() {
  const source = await readFile(compatPath, 'utf8');
  let listener = null;
  const self = { addEventListener: (type, fn) => { if (type === 'message') listener = fn; } };
  new Function('self', source)(self);
  return listener;
}

describe('sw-legacy-compat（舊站頁面問 SW 版本）', () => {
  it('收到 SPORTHUB_GET_VERSION 就從 port 回 SPORTHUB_VERSION，版號讓舊站判定可重載', async () => {
    const listener = await loadListener();
    const sent = [];
    listener({ data: { type: 'SPORTHUB_GET_VERSION' }, ports: [{ postMessage: (m) => sent.push(m) }] });
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('SPORTHUB_VERSION');
    expect(legacyCanReload(sent[0].version)).toBe(true);
  });

  it('其他訊息、沒有 port、沒有 data 都不回覆也不拋錯', async () => {
    const listener = await loadListener();
    const sent = [];
    const port = { postMessage: (m) => sent.push(m) };
    listener({ data: { type: 'OTHER' }, ports: [port] });
    listener({ data: null, ports: [port] });
    listener({ data: { type: 'SPORTHUB_GET_VERSION' }, ports: [] });
    listener({ data: { type: 'SPORTHUB_GET_VERSION' } });
    expect(sent).toHaveLength(0);
  });

  it('vite 設定匯入這支腳本，且不把它放進預存', async () => {
    const config = await readFile(configPath, 'utf8');
    expect(config).toContain("importScripts: ['sw-legacy-compat.js']");
    expect(config).toMatch(/globIgnores:[^\]]*'sw-legacy-compat\.js'/);
  });
});
