#!/usr/bin/env node
/**
 * FC-B E2E 驗收腳本 —— 直接使用 Playwright (`@playwright/test` 的 chromium API)
 * 不經過 test runner，node 直接執行。
 *
 * 用法：
 *   node scripts/e2e-shots.mjs <輸出資料夾>
 *
 * 前置：
 *   - 開發伺服器已在 http://localhost:5181（VITE_FIREBASE_EMULATOR=1）
 *   - Firestore / Auth emulator 已用 scripts/seed-emulator.mjs 灌好 seed-data
 */

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { seedData, UIDS } from './seed-data.mjs';

const BASE = 'http://localhost:5181';
const OUT_DIR = resolve(process.argv[2] || 'e2e-artifacts');

// ─────────────────────────────────────────────────────────────────────
// 一、純函式移植（visibility.ts / terminal.ts 的 JS 版本）
//    本檔不 import TS，直接以 seed-data 的資料推導預期可見集合。
// ─────────────────────────────────────────────────────────────────────
const ADMIN_ROLE_LEVEL = 4;
const TERMINAL_DELAY_MS = 6 * 60 * 60 * 1000;
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const DATE_RE =
  /(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*[~\uFF5E-]\s*(\d{1,2}):(\d{2}))?/;

function normalizeUid(uid) {
  const v = String(uid ?? '').trim();
  return v === 'unknown' ? '' : v;
}

function getEventLimitedTeamIds(e) {
  if (!e) return [];
  const ids = [];
  const seen = new Set();
  const push = (raw) => {
    const v = String(raw ?? '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    ids.push(v);
  };
  if (Array.isArray(e.creatorTeamIds)) e.creatorTeamIds.forEach(push);
  push(e.creatorTeamId);
  return ids;
}

function isEventOwner(e, uid) {
  const myUid = normalizeUid(uid);
  if (!e || !myUid) return false;
  const ownerIds = [e.creatorUid, e.ownerUid, e.captainUid]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  if (!ownerIds.length) return false;
  return ownerIds.includes(myUid);
}

function isEventDelegate(e, uid) {
  const myUid = normalizeUid(uid);
  if (!e || !myUid) return false;
  if (!Array.isArray(e.delegateUids)) return false;
  return e.delegateUids.some((d) => String(d ?? '').trim() === myUid);
}

function canViewEventByTeamScope(e, viewer) {
  if (!e) return false;
  if (!e.teamOnly) return true;
  if (isEventOwner(e, viewer.uid)) return true;
  if (viewer.hasPermission('event.edit_all')) return true;
  const eventTeamIds = getEventLimitedTeamIds(e);
  if (eventTeamIds.some((id) => viewer.teamIds.has(id))) return true;
  return !!e.isPublic;
}

function canListPrivateEvent(e, viewer) {
  if (!e || !e.privateEvent) return true;
  if (viewer.roleLevel >= ADMIN_ROLE_LEVEL) return true;
  return isEventOwner(e, viewer.uid) || isEventDelegate(e, viewer.uid);
}

function isEventVisibleToUser(e, viewer, registrationsOfViewer) {
  if (!e) return false;
  const myUid = normalizeUid(viewer.uid);
  if (!myUid) return true;
  const blocked = Array.isArray(e.blockedUids) ? e.blockedUids : [];
  if (!blocked.some((b) => String(b ?? '').trim() === myUid)) return true;
  const regs = Array.isArray(registrationsOfViewer) ? registrationsOfViewer : [];
  return regs.some(
    (r) =>
      r != null &&
      r.eventId === e.id &&
      (!r.userId || String(r.userId).trim() === myUid),
  );
}

function getVisibleEvents(events, viewer, regs) {
  if (!Array.isArray(events)) return [];
  return events.filter((e) => {
    if (!canViewEventByTeamScope(e, viewer)) return false;
    if (!canListPrivateEvent(e, viewer)) return false;
    if (!isEventVisibleToUser(e, viewer, regs)) return false;
    return true;
  });
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'object') {
    const v = value;
    if (typeof v.toMillis === 'function') {
      try {
        return v.toMillis();
      } catch {
        return 0;
      }
    }
    if (typeof v.toDate === 'function') {
      try {
        const d = v.toDate();
        return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
      } catch {
        return 0;
      }
    }
    const secRaw = typeof v.seconds === 'number' ? v.seconds : v._seconds;
    if (typeof secRaw === 'number' && Number.isFinite(secRaw)) {
      const nanoRaw = typeof v.nanoseconds === 'number' ? v.nanoseconds : v._nanoseconds;
      const nano = typeof nanoRaw === 'number' ? nanoRaw : 0;
      return secRaw * 1000 + Math.floor(nano / 1_000_000);
    }
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseEventDateRange(value) {
  if (!value) return null;
  if (typeof value !== 'string') {
    const ms = toMillis(value);
    return ms ? { startMs: ms, endMs: ms + DEFAULT_DURATION_MS } : null;
  }
  const raw = value.trim();
  const m = raw.match(DATE_RE);
  if (!m) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed)
      ? { startMs: parsed, endMs: parsed + DEFAULT_DURATION_MS }
      : null;
  }
  const y = m[1];
  const mo = m[2];
  const d = m[3];
  const sh = m[4];
  const sm = m[5];
  if (!y || !mo || !d || !sh || !sm) return null;
  const startHour = Number(sh);
  const startMinute = Number(sm);
  const eh = m[6];
  const em = m[7];
  const endHour = eh ? Number(eh) : startHour + 2;
  const endMinute = em ? Number(em) : startMinute;
  const start = new Date(Number(y), Number(mo) - 1, Number(d), startHour, startMinute, 0);
  const end = new Date(Number(y), Number(mo) - 1, Number(d), endHour, endMinute, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function isEventInEndedTab(event, now) {
  if (!event) return false;
  if (event.status !== 'ended' && event.status !== 'cancelled') return false;
  const r = parseEventDateRange(event.date);
  if (!r) return false;
  return now >= r.endMs + TERMINAL_DELAY_MS;
}

// ─────────────────────────────────────────────────────────────────────
// 二、以 seed-data 推導預期可見集合
// ─────────────────────────────────────────────────────────────────────
function buildViewer(uid) {
  const userDoc = uid ? seedData.users.find((u) => u.id === uid) : null;
  const role = userDoc?.data?.role || 'guest';
  const roleLevel = role === 'admin' ? ADMIN_ROLE_LEVEL : role === 'guest' ? 0 : 1;
  return {
    uid: uid || '',
    teamIds: new Set(userDoc?.data?.teamIds || []),
    role,
    roleLevel,
    hasPermission: (perm) => role === 'admin',
  };
}

function registrationsForViewer(uid) {
  if (!uid) return [];
  return seedData.registrations
    .map((r) => r.data)
    .filter((r) => r && r.userId === uid);
}

function computeExpectedIds(uid) {
  const viewer = buildViewer(uid);
  const regs = registrationsForViewer(uid);
  const allEvents = seedData.events.map((e) => e.data);
  const now = Date.now();
  const visible = getVisibleEvents(allEvents, viewer, regs).filter(
    (e) => !isEventInEndedTab(e, now),
  );
  return visible.map((e) => e.id).sort();
}

// ─────────────────────────────────────────────────────────────────────
// 三、工具函式
// ─────────────────────────────────────────────────────────────────────
function attachListeners(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      try {
        consoleErrors.push(msg.text());
      } catch {
        consoleErrors.push('<unreadable console message>');
      }
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err?.message ? String(err.message) : String(err));
  });
  return { consoleErrors, pageErrors };
}

async function auditTapTargets(page) {
  try {
    return await page.evaluate(() => {
      const sel = 'button, a, [role="button"], select, input';
      const out = [];
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) {
        const rects = el.getClientRects();
        if (!rects || rects.length === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.width < 44 || r.height < 44) {
          out.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            text: (el.textContent || el.getAttribute('aria-label') || '')
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 80),
            width: Math.round(r.width * 100) / 100,
            height: Math.round(r.height * 100) / 100,
          });
        }
      }
      return out;
    });
  } catch {
    return [];
  }
}

async function collectActivityIds(page) {
  try {
    const hrefs = await page.$$eval('a[href^="/events/"]', (els) =>
      els.map((el) => el.getAttribute('href')).filter(Boolean),
    );
    const ids = hrefs
      .map((h) => {
        const m = String(h).match(/^\/events\/([^/?#]+)/);
        return m ? m[1] : null;
      })
      .filter(Boolean);
    return Array.from(new Set(ids)).sort();
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// 四、可見性比對（訪客 / U0001 / U0004）
// ─────────────────────────────────────────────────────────────────────
async function runVisibilityCheck(browser, uid) {
  const identity = uid || 'guest';
  const expected = computeExpectedIds(uid);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const { consoleErrors, pageErrors } = attachListeners(page);

  let loadError = null;
  try {
    if (uid) {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(async (u) => {
        const m = await import('/src/data/auth.ts');
        await m.devSignIn(u);
      }, uid);
      await page.waitForTimeout(300);
    }
    await page.goto(`${BASE}/activities`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector('a[href^="/events/"]', { timeout: 15000 });
    } catch (err) {
      loadError = err?.message || String(err);
    }
    await page.waitForTimeout(600);
  } catch (err) {
    loadError = err?.message || String(err);
  }

  const actual = await collectActivityIds(page);
  const tapTargets = await auditTapTargets(page);

  await context.close();

  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((id) => !actualSet.has(id));
  const unexpected = actual.filter((id) => !expectedSet.has(id));
  const passed = !loadError && missing.length === 0 && unexpected.length === 0;

  return {
    identity,
    uid: uid || '',
    expected,
    actual,
    missing,
    unexpected,
    loadError,
    passed,
    consoleErrors,
    pageErrors,
    smallTapTargets: tapTargets,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 五、首頁「下一場活動」驗證（U0001）
// ─────────────────────────────────────────────────────────────────────
async function runHomeNextActivityCheck(browser) {
  const uid = UIDS.user1;
  const expectedTitle = '週末足球公開賽';
  const legacyEventId = seedData.events.find((e) => e.id.includes('fmtch1'))?.id || null;
  const legacyReg = seedData.legacy?.[0]?.data || null;

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const { consoleErrors, pageErrors } = attachListeners(page);

  let loadError = null;
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async (u) => {
      const m = await import('/src/data/auth.ts');
      await m.devSignIn(u);
    }, uid);
    await page.waitForTimeout(400);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
  } catch (err) {
    loadError = err?.message || String(err);
  }

  let nextCard = null;
  try {
    nextCard = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('body *'));
      const label = all.find(
        (el) => el.children.length === 0 && /下一場活動/.test(el.textContent || ''),
      );
      if (!label) return null;
      let node = label;
      while (node && node !== document.body) {
        if (node.querySelector && node.querySelector('a[href^="/events/"]')) {
          return {
            text: (node.innerText || '').replace(/\s+/g, ' ').trim(),
            hrefs: Array.from(node.querySelectorAll('a[href^="/events/"]'))
              .map((a) => a.getAttribute('href'))
              .filter(Boolean),
          };
        }
        node = node.parentElement;
      }
      return {
        text: (label.parentElement?.innerText || '').replace(/\s+/g, ' ').trim(),
        hrefs: [],
      };
    });
  } catch (err) {
    loadError = loadError || err?.message || String(err);
  }

  let bodyText = '';
  try {
    bodyText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  } catch {
    bodyText = '';
  }

  const nextCardText = nextCard?.text || '';
  const titleInNextCard = nextCardText.includes(expectedTitle);
  const titleOnPage = bodyText.includes(expectedTitle);
  const shownNext = Boolean(nextCard) ? titleInNextCard : titleOnPage;

  // legacy root 報名對應的活動（seed 中和合法報名指向同一個 event）
  const legacyTargetsSameEvent = legacyReg && legacyEventId && legacyReg.eventId === legacyEventId;
  const legacyNote = legacyTargetsSameEvent
    ? 'legacy root 報名與合法子集合報名指向同一個 event（週末足球公開賽）；' +
      '若 B 正確忽略 legacy 資料，下一場活動仍應顯示該標題，且不得重複出現。'
    : 'legacy root 報名目標與合法報名不同 event。';

  const passed = !loadError && shownNext;

  await context.close();

  return {
    viewer: uid,
    expectedTitle,
    legacyEventId,
    legacyEventIdMatchesExpectation: Boolean(legacyTargetsSameEvent),
    legacyNote,
    foundNextCard: Boolean(nextCard),
    nextCardText: nextCardText.slice(0, 500),
    nextCardHrefs: nextCard?.hrefs || [],
    titleInNextCard,
    titleOnPage,
    passed,
    loadError,
    consoleErrors,
    pageErrors,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 六、截圖
// ─────────────────────────────────────────────────────────────────────
const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

async function takeShot(browser, cfg) {
  const { pageName, viewportName, theme, locale, uid, outDir } = cfg;
  const viewport = VIEWPORTS[viewportName];
  const identity = uid ? 'user' : 'guest';

  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const { consoleErrors, pageErrors } = attachListeners(page);

  let loadError = null;
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ({ loc, th }) => {
        localStorage.setItem('toosterx:locale', loc);
        localStorage.setItem('toosterx:theme', th);
      },
      { loc: locale, th: theme },
    );
    if (uid) {
      await page.evaluate(async (u) => {
        const m = await import('/src/data/auth.ts');
        await m.devSignIn(u);
      }, uid);
      await page.waitForTimeout(400);
    }
    const target = pageName === 'home' ? '/' : '/activities';
    await page.goto(`${BASE}${target}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1200);
  } catch (err) {
    loadError = err?.message || String(err);
  }

  const tapTargets = await auditTapTargets(page);

  const filename = `${pageName}-${viewportName}-${theme}-${locale}-${identity}.png`;
  const fullPath = join(outDir, filename);
  try {
    await page.screenshot({ path: fullPath, fullPage: false });
  } catch (err) {
    loadError = loadError || err?.message || String(err);
  }

  await context.close();

  return {
    filename,
    path: fullPath,
    page: pageName,
    viewport: viewportName,
    theme,
    locale,
    identity,
    loadError,
    consoleErrors,
    pageErrors,
    smallTapTargets: tapTargets,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 七、主流程
// ─────────────────────────────────────────────────────────────────────
function printLine(char = '─', len = 72) {
  console.log(char.repeat(len));
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`[e2e] 輸出資料夾：${OUT_DIR}`);
  console.log(`[e2e] 目標伺服器：${BASE}`);

  const browser = await chromium.launch({ headless: true });
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    outDir: OUT_DIR,
    seedEventIds: Object.fromEntries(
      seedData.events.map((e) => [e.data.title, e.id]),
    ),
    seedEventTitles: seedData.events.map((e) => e.data.title),
    uids: UIDS,
    visibility: [],
    home: null,
    screenshots: [],
    summary: {},
  };

  try {
    // ── 1. 三個身分的可見性比對 ─────────────────────────────────
    printLine();
    console.log('[e2e] 可見性比對開始');
    for (const uid of [null, UIDS.user1, UIDS.blocked]) {
      const result = await runVisibilityCheck(browser, uid);
      report.visibility.push(result);
      const identity = result.identity;
      console.log(
        `[e2e] ${identity.padEnd(34)} ${result.passed ? 'PASS' : 'FAIL'}  ` +
          `expected=${result.expected.length} actual=${result.actual.length} ` +
          `missing=${result.missing.length} unexpected=${result.unexpected.length}` +
          (result.loadError ? `  loadError=${result.loadError.slice(0, 80)}` : ''),
      );
      if (result.missing.length) console.log(`         missing: ${result.missing.join(', ')}`);
      if (result.unexpected.length)
        console.log(`         unexpected: ${result.unexpected.join(', ')}`);
    }

    // ── 2. 首頁「下一場活動」 ─────────────────────────────────
    printLine();
    console.log('[e2e] 首頁「下一場活動」驗證');
    report.home = await runHomeNextActivityCheck(browser);
    console.log(
      `[e2e] home ${report.home.passed ? 'PASS' : 'FAIL'}  ` +
        `foundNextCard=${report.home.foundNextCard} titleInNextCard=${report.home.titleInNextCard} ` +
        `titleOnPage=${report.home.titleOnPage}`,
    );

    // ── 3. 截圖 ─────────────────────────────────────────────
    printLine();
    console.log('[e2e] 截圖開始');
    const shotCfgs = [
      { pageName: 'home', viewportName: 'mobile', theme: 'light', locale: 'zh-TW', uid: null },
      { pageName: 'home', viewportName: 'mobile', theme: 'dark', locale: 'zh-TW', uid: null },
      { pageName: 'home', viewportName: 'desktop', theme: 'light', locale: 'zh-TW', uid: null },
      { pageName: 'activities', viewportName: 'mobile', theme: 'light', locale: 'zh-TW', uid: null },
      { pageName: 'activities', viewportName: 'mobile', theme: 'dark', locale: 'zh-TW', uid: null },
      {
        pageName: 'activities',
        viewportName: 'desktop',
        theme: 'light',
        locale: 'zh-TW',
        uid: null,
      },
      { pageName: 'activities', viewportName: 'mobile', theme: 'light', locale: 'en', uid: null },
      { pageName: 'activities', viewportName: 'mobile', theme: 'light', locale: 'th', uid: null },
      { pageName: 'activities', viewportName: 'mobile', theme: 'light', locale: 'vi', uid: null },
    ];

    for (const cfg of shotCfgs) {
      const shot = await takeShot(browser, { ...cfg, outDir: OUT_DIR });
      report.screenshots.push(shot);
      console.log(
        `[e2e] shot ${shot.filename.padEnd(46)} ` +
          `consoleErr=${shot.consoleErrors.length} pageErr=${shot.pageErrors.length} ` +
          `smallTargets=${shot.smallTapTargets.length}` +
          (shot.loadError ? `  loadError=${shot.loadError.slice(0, 60)}` : ''),
      );
    }
  } finally {
    await browser.close();
  }

  // ── 4. 彙總 ─────────────────────────────────────────────────
  const visibilityPassed = report.visibility.every((r) => r.passed);
  const allPageErrors = [
    ...report.visibility.flatMap((r) => r.pageErrors),
    ...(report.home?.pageErrors || []),
    ...report.screenshots.flatMap((s) => s.pageErrors),
  ];
  const allConsoleErrors = [
    ...report.visibility.flatMap((r) => r.consoleErrors),
    ...(report.home?.consoleErrors || []),
    ...report.screenshots.flatMap((s) => s.consoleErrors),
  ];

  report.summary = {
    visibilityPassed,
    homeNextActivityPassed: Boolean(report.home?.passed),
    pageErrorCount: allPageErrors.length,
    consoleErrorCount: allConsoleErrors.length,
    screenshotCount: report.screenshots.length,
    smallTapTargetsTotal: report.screenshots.reduce(
      (n, s) => n + s.smallTapTargets.length,
      0,
    ),
    exitCode: !visibilityPassed || allPageErrors.length > 0 ? 1 : 0,
  };

  const reportPath = join(OUT_DIR, 'e2e-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  printLine('═');
  console.log('[e2e] 摘要');
  printLine();
  for (const r of report.visibility) {
    console.log(
      `[e2e]   可見性 ${r.identity.padEnd(34)} ${r.passed ? 'PASS' : 'FAIL'}`,
    );
  }
  console.log(
    `[e2e]   首頁下一場活動                     ${report.home?.passed ? 'PASS' : 'FAIL'}`,
  );
  console.log(`[e2e]   pageerror 總數                  ${allPageErrors.length}`);
  console.log(`[e2e]   console error 總數              ${allConsoleErrors.length}`);
  console.log(`[e2e]   截圖張數                        ${report.screenshots.length}`);
  console.log(`[e2e]   小尺寸可點元素總數              ${report.summary.smallTapTargetsTotal}`);
  console.log(`[e2e]   報告                            ${reportPath}`);
  console.log(`[e2e]   exitCode                        ${report.summary.exitCode}`);
  printLine('═');

  process.exit(report.summary.exitCode);
}

main().catch((err) => {
  console.error('[e2e] 未預期錯誤：', err);
  process.exit(1);
});
