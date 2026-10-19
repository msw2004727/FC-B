import { useEffect, useState } from 'preact/hooks';
import type { FeatureManifest, FeatureNavItem, FeatureRoute } from './feature-types';
import { FEATURE_OVERRIDES } from '@/features.config';

const manifests = new Map<string, FeatureManifest>();
const registeredPaths = new Set<string>();
const listeners = new Set<() => void>();
let remoteFlags: Record<string, boolean> = {};
let registryVersion = 0;

function notifyRegistry(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (err) {
      console.error('[feature-registry] listener error', err);
    }
  }
}

/** 訂閱註冊表變更（功能註冊成功或遠端旗標變更）。 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 目前註冊表版本；每次成功註冊或 setRemoteFlags 後遞增。 */
export function getRegistryVersion(): number {
  return registryVersion;
}

/** 以 hook 形式訂閱註冊表版本，供路由與導覽重新計算。 */
export function useRegistryVersion(): number {
  const [version, setVersion] = useState<number>(getRegistryVersion());

  useEffect(() => {
    const unsubscribe = subscribe(() => setVersion(getRegistryVersion()));
    // 補上 render 與 effect 之間可能發生的變更。
    setVersion(getRegistryVersion());
    return unsubscribe;
  }, []);

  return version;
}

function validateAcyclic(graph: ReadonlyMap<string, FeatureManifest>): void {
  // 0 = 未訪問、1 = 訪問中、2 = 已完成
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    const currentState = state.get(id) ?? 0;
    if (currentState === 2) return;

    state.set(id, 1);
    stack.push(id);

    const manifest = graph.get(id);
    if (!manifest) {
      stack.pop();
      state.set(id, 2);
      return;
    }

    for (const dep of manifest.dependsOn ?? []) {
      const depState = state.get(dep) ?? 0;
      if (depState === 1) {
        const index = stack.indexOf(dep);
        const cycle = index >= 0 ? [...stack.slice(index), dep] : [dep, id, dep];
        throw new Error(`[feature-registry] 偵測到循環依賴：${cycle.join(' → ')}`);
      }
      if (depState === 0) visit(dep);
    }

    stack.pop();
    state.set(id, 2);
  };

  for (const id of graph.keys()) {
    if ((state.get(id) ?? 0) === 0) visit(id);
  }
}

/** 註冊功能清單。重複 id、重複 path、未知 dependsOn、循環依賴會丟錯。 */
export function registerFeatures(list: readonly FeatureManifest[]): void {
  const pendingIds = new Set<string>();
  const pendingPaths = new Set<string>(registeredPaths);

  for (const m of list) {
    if (manifests.has(m.id) || pendingIds.has(m.id)) {
      throw new Error(`[feature-registry] 重複的功能 id：${m.id}`);
    }
    pendingIds.add(m.id);
    for (const r of m.routes) {
      if (pendingPaths.has(r.path)) {
        throw new Error(`[feature-registry] 重複的路由 path：${r.path}（功能：${m.id}）`);
      }
      pendingPaths.add(r.path);
    }
  }

  const allManifests = new Map<string, FeatureManifest>(manifests);
  for (const m of list) allManifests.set(m.id, m);

  for (const m of allManifests.values()) {
    for (const dep of m.dependsOn ?? []) {
      if (!allManifests.has(dep)) {
        throw new Error(`[feature-registry] 功能 "${m.id}" 依賴未知的 id："${dep}"`);
      }
    }
  }

  // 所有驗證都在提交前完成；任何錯誤都不會改變註冊表狀態。
  validateAcyclic(allManifests);

  for (const m of list) manifests.set(m.id, m);
  for (const p of pendingPaths) registeredPaths.add(p);

  registryVersion += 1;
  notifyRegistry();
}

export function getFeature(id: string): FeatureManifest | undefined {
  return manifests.get(id);
}

/**
 * 啟用判斷 = 建置期設定 AND 遠端旗標 AND 所有 dependsOn 都啟用。
 * `reserved` 一律不啟用，除非建置期設定明確覆寫為 true。
 */
export function isFeatureEnabled(id: string): boolean {
  const m = manifests.get(id);
  if (!m) return false;

  const override = FEATURE_OVERRIDES[id];
  if (override === false) return false;
  if (m.status === 'reserved' && override !== true) return false;

  // 遠端旗標：預設全部 true
  if (remoteFlags[id] === false) return false;

  for (const dep of m.dependsOn ?? []) {
    if (!isFeatureEnabled(dep)) return false;
  }
  return true;
}

/** 設定遠端旗標；缺少的 id 視為 true。 */
export function setRemoteFlags(flags: Record<string, boolean>): void {
  remoteFlags = { ...flags };
  registryVersion += 1;
  notifyRegistry();
}

/** 已啟用功能的 Manifest 清單。 */
export function getActiveManifests(): FeatureManifest[] {
  const out: FeatureManifest[] = [];
  for (const m of manifests.values()) {
    if (isFeatureEnabled(m.id)) out.push(m);
  }
  return out;
}

/** 已啟用功能的 Route 清單。 */
export function getActiveRoutes(): FeatureRoute[] {
  const out: FeatureRoute[] = [];
  for (const m of manifests.values()) {
    if (isFeatureEnabled(m.id)) out.push(...m.routes);
  }
  return out;
}

/** 已啟用功能的導覽項目，依 order 升冪。 */
export function getNavItems(): FeatureNavItem[] {
  const items: FeatureNavItem[] = [];
  for (const m of manifests.values()) {
    if (isFeatureEnabled(m.id) && m.nav) items.push(...m.nav);
  }
  return items.sort((a, b) => a.order - b.order);
}

/** 測試用：重設註冊表狀態。 */
export function _resetForTest(): void {
  manifests.clear();
  registeredPaths.clear();
  remoteFlags = {};
  registryVersion = 0;
  listeners.clear();
}
