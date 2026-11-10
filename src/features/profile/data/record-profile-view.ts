/**
 * 公開個人頁瀏覽計數。Callable `recordProfileView`（後端另卡）。
 * 閒置時才送，沿用球員卡分享預載：有 requestIdleCallback 就用（上限 4 秒），
 * 沒有則 setTimeout 1.5 秒（Safari／iOS 沒有 requestIdleCallback，R-CODE-005）。
 * 失敗完全靜默：不提示、不寫主控台（key 含 uid，不可印 log）。
 */
import { callFn } from '@/data/callables';

const IDLE_TIMEOUT_MS = 4000;
const IDLE_FALLBACK_MS = 1500;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

function storageKey(viewerUid: string, targetUid: string): string {
  return `popview:${viewerUid}:${targetUid}`;
}

/** 讀不到（禁用、隱私模式）就當沒有 key，不擋這次呼叫。 */
function hasStoredKey(key: string): boolean {
  try {
    return localStorage.getItem(key) != null;
  } catch {
    return false;
  }
}

/** 值只放 1。寫不進去就略過，不把 key 印出來。 */
function rememberKey(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // 本機擋寫入時不重試、不記錄。
  }
}

function shouldRemember(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const status = (value as { status?: unknown }).status;
  return status === 'counted' || status === 'already';
}

/** 已登入且不是看自己才送。已有本機 key 不再呼叫。只有 counted／already 才寫 key。 */
export async function recordProfileView(viewerUid: string, targetUid: string): Promise<void> {
  const viewer = viewerUid.trim();
  const target = targetUid.trim();
  if (!viewer || !target || viewer === target) return;

  const key = storageKey(viewer, target);
  if (hasStoredKey(key)) return;

  try {
    const result = await callFn('recordProfileView', { targetUid: target });
    if (shouldRemember(result)) rememberKey(key);
  } catch {
    // 失敗不寫 key、不提示、不寫主控台。
  }
}

/** 頁面卸載時呼叫回傳的取消函式：還沒送出就不再送。進行中的呼叫不 setState。 */
export function scheduleProfileViewRecord(viewerUid: string, targetUid: string): () => void {
  let cancelled = false;
  const run = (): void => {
    if (cancelled) return;
    void recordProfileView(viewerUid, targetUid);
  };

  if (typeof window === 'undefined') {
    return () => {
      cancelled = true;
    };
  }

  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const id = idleWindow.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => {
      cancelled = true;
      idleWindow.cancelIdleCallback?.(id);
    };
  }

  const timer = setTimeout(run, IDLE_FALLBACK_MS);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
