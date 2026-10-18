/**
 * FC-B Viewer 資料層。
 *
 * 規則對照：
 *  - R-IAM-008：權限判定必須與 A 前端一致（透過 createPermissionChecker）。
 *  - R-CAP-006～008：capabilities 儲存格式不得改寫；本檔只回傳正規化後的唯讀陣列。
 *  - L-02／L-04：hook 請求序號防舊結果覆蓋；訂閱後補讀一次目前值。
 *  - L-07：不使用 void promise，每個非同步都以 try/catch 或 .catch 收斂。
 *  - L-08：本檔不建立 inflight cache，故無殘留問題。
 *  - L-09：載入失敗保留上一份完整狀態（hook 端不覆蓋）。
 *
 * Firestore 存取集中在此檔。
 */

import { useEffect, useState } from 'preact/hooks';
import type { Firestore } from 'firebase/firestore';
import { doc, getDoc } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { getCurrentUser } from '@/data/auth';
import { on } from '@/core/events';
import type { ViewerContext } from '@/features/events/data/types';

import {
  createPermissionChecker,
  getRoleLevel,
} from './permissions';

/** 對外公開的 Viewer 快照（含 role 與顯示欄位）。 */
export interface ViewerView extends ViewerContext {
  role: string;
  displayName: string | null;
  pictureUrl: string | null;
  capabilities: readonly string[];
}

const EMPTY_TEAM_IDS: ReadonlySet<string> = new Set<string>();
const EMPTY_CAPABILITIES: readonly string[] = Object.freeze([]) as readonly string[];

function alwaysFalse(): boolean {
  return false;
}

/** 訪客（未登入）快照。 */
export function createGuestViewer(): ViewerView {
  return {
    uid: null,
    teamIds: EMPTY_TEAM_IDS,
    hasPermission: alwaysFalse,
    roleLevel: 0,
    role: 'guest',
    displayName: null,
    pictureUrl: null,
    capabilities: EMPTY_CAPABILITIES,
  };
}

/* ── warnOnce：每次載入最多記錄一次（避免洗版） ── */
const warnedKeys = new Set<string>();
function warnOnce(key: string, err: unknown): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[viewer] failed to read ${key}`, err);
}

/* ── 從 Firestore 文件資料解析各欄位（純函式，方便測試） ── */

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
  }
  return out;
}

interface UserInfo {
  role: string;
  displayName: string | null;
  pictureUrl: string | null;
  teamIds: string[];
}

function defaultUserInfo(): UserInfo {
  return { role: 'user', displayName: null, pictureUrl: null, teamIds: [] };
}

function parseUserInfo(data: Record<string, unknown> | null | undefined): UserInfo {
  if (!data) return defaultUserInfo();
  const rawRole = data.role;
  const role = typeof rawRole === 'string' && rawRole.trim() ? rawRole.trim() : 'user';

  let displayName: string | null = null;
  if (typeof data.displayName === 'string') displayName = data.displayName;
  else if (typeof data.name === 'string') displayName = data.name;

  let pictureUrl: string | null = null;
  if (typeof data.pictureUrl === 'string') pictureUrl = data.pictureUrl;
  else if (typeof data.picture === 'string') pictureUrl = data.picture;

  const teamIds: string[] = [];
  const teamIdsArr = readStringArray(data.teamIds);
  if (teamIdsArr) {
    for (const t of teamIdsArr) if (t) teamIds.push(t);
  }
  if (typeof data.teamId === 'string' && data.teamId && !teamIds.includes(data.teamId)) {
    teamIds.push(data.teamId);
  }

  return { role, displayName, pictureUrl, teamIds };
}

function parseRolePermissions(
  data: Record<string, unknown> | null,
  role: string,
): string[] {
  if (!data) return [];
  const candidates: unknown[] = [
    data.permissions,
    data.codes,
    data.list,
    data.items,
    data[role],
  ];
  for (const c of candidates) {
    const arr = readStringArray(c);
    if (arr) return arr;
  }
  return [];
}

function parseUserGrantCodes(data: Record<string, unknown> | null): string[] {
  if (!data) return [];
  const candidates: unknown[] = [
    data.permissions,
    data.codes,
    data.grants,
    data.list,
    data.items,
  ];
  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    const out: string[] = [];
    for (const item of c) {
      if (typeof item === 'string') {
        out.push(item);
      } else if (item && typeof item === 'object') {
        const obj = item as {
          code?: unknown;
          granted?: unknown;
          suspended?: unknown;
          effective?: unknown;
        };
        if (
          typeof obj.code === 'string'
          && obj.granted !== false
          && obj.suspended !== true
          && obj.effective !== false
        ) {
          out.push(obj.code);
        }
      }
    }
    return out;
  }
  // 退化路徑：map 形式的 { code: true }
  const map: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === true) map.push(k);
  }
  return map;
}

function parseCapabilities(data: Record<string, unknown> | null): string[] {
  if (!data) return [];
  // R-CAP-006：storage 保持原樣；schema 可能是 { user: [...] } 或 { capabilities: [...] }。
  const candidates: unknown[] = [
    data.user,
    data.capabilities,
    data.items,
    data.codes,
    data.list,
  ];
  for (const c of candidates) {
    const arr = readStringArray(c);
    if (arr) return arr;
  }
  return [];
}

/* ── 安全讀取：不存在或無權限皆視為 null，不丟錯 ── */

type DocResult =
  | { ok: true; data: Record<string, unknown> | null }
  | { ok: false; error: unknown };

function safeGetDoc(promise: Promise<Awaited<ReturnType<typeof getDoc>>>): Promise<DocResult> {
  return promise.then(
    (snap): DocResult => {
      if (!snap.exists()) return { ok: true, data: null };
      const data = snap.data() as Record<string, unknown> | undefined;
      return { ok: true, data: data ?? null };
    },
    (error: unknown): DocResult => ({ ok: false, error }),
  );
}

/* ── 主入口 ── */

/**
 * 依 uid 載入 Viewer。uid 為空字串視同訪客。
 * 缺文件或無權限讀取 rolePermissions / userPermissionGrants / roleActivityCapabilities 時
 * 都視為空並記錄 console.warn（每種 collection 每次載入最多一次）。
 */
export async function loadViewer(uid: string): Promise<ViewerView> {
  if (!uid) return createGuestViewer();

  const firebase = await getFirebase();
  const db = firebase.db as unknown as Firestore;

  // 1. users/{uid}（找不到或失敗都以預設處理；不擋瀏覽）
  let userInfo = defaultUserInfo();
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      userInfo = parseUserInfo(userSnap.data() as Record<string, unknown> | undefined);
    }
  } catch (err) {
    warnOnce('users', err);
  }

  const role = userInfo.role;

  // 2~4. 平行讀取 rolePermissions / userPermissionGrants / roleActivityCapabilities
  const [roleRes, grantRes, capRes] = await Promise.all([
    safeGetDoc(getDoc(doc(db, 'rolePermissions', role))),
    safeGetDoc(getDoc(doc(db, 'userPermissionGrants', uid))),
    safeGetDoc(getDoc(doc(db, 'roleActivityCapabilities', uid))),
  ]);

  if (!roleRes.ok) warnOnce('rolePermissions', roleRes.error);
  if (!grantRes.ok) warnOnce('userPermissionGrants', grantRes.error);
  if (!capRes.ok) warnOnce('roleActivityCapabilities', capRes.error);

  const rolePermList = parseRolePermissions(roleRes.ok ? roleRes.data : null, role);
  const grants = parseUserGrantCodes(grantRes.ok ? grantRes.data : null);
  const capabilities = parseCapabilities(capRes.ok ? capRes.data : null);

  const hasPermission = createPermissionChecker({
    role,
    rolePermissions: { [role]: rolePermList },
    userGrants: grants,
  });
  const roleLevel = getRoleLevel(role);

  return {
    uid,
    teamIds: new Set(userInfo.teamIds) as ReadonlySet<string>,
    hasPermission,
    roleLevel,
    role,
    displayName: userInfo.displayName,
    pictureUrl: userInfo.pictureUrl,
    capabilities,
  };
}

/* ── 可測試的請求序號防護 ── */

/**
 * 建立依序號守衛的載入器。回傳的函式可重複呼叫，只有最新一次呼叫的結果會被 `onChange`。
 * `load` 應為 `loadViewer` 或測試用的替身。
 */
export function createViewerLoader(
  load: (uid: string) => Promise<ViewerView>,
  onChange: (viewer: ViewerView) => void,
): (uid: string | null) => void {
  let seq = 0;
  return (uid: string | null): void => {
    const current = ++seq;
    if (!uid) {
      onChange(createGuestViewer());
      return;
    }
    load(uid)
      .then((next) => {
        if (current !== seq) return; // stale：舊結果直接丟棄
        onChange(next);
      })
      .catch((err: unknown) => {
        // L-09：錯誤時不改公開狀態，由呼叫端保留上一份 snapshot。
        // eslint-disable-next-line no-console
        console.warn('[viewer] load failed', err);
      });
  };
}

/* ── Preact hook ── */

/**
 * 訂閱 `auth:changed` 並依序號防護載入 Viewer。載入中回傳上一個值（首次為訪客）。
 */
export function useViewer(): ViewerView {
  const [viewer, setViewer] = useState<ViewerView>(() => createGuestViewer());

  useEffect(() => {
    const loader = createViewerLoader(loadViewer, setViewer);

    // L-04：先訂閱，避免 render→effect 之間的 auth 變更漏接。
    const off = on('auth:changed', ({ uid }) => {
      loader(uid);
    });

    // L-04：訂閱後補讀一次目前值（涵蓋訂閱前已變更的情況）。
    void getCurrentUser()
      .then((current) => loader(current ? current.uid : null))
      .catch(() => loader(null));

    return () => {
      off();
    };
  }, []);

  return viewer;
}
