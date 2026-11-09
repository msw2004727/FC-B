// 推播通知設定測試用的 Firestore SDK 替身：只記錄呼叫、不連線。
import { vi } from 'vitest';

export interface NotifStore {
  /** undefined＝文件不存在。 */
  featureFlags: Record<string, unknown> | undefined;
  /** 讀取要丟的錯（每次讀取取一個；用完即恢復正常）。 */
  readErrors: unknown[];
  /** 讀取暫停：設成 Promise 時 getDoc 會等它。 */
  readGate: Promise<void> | null;
  writeError: unknown;
}

export const store: NotifStore = { featureFlags: undefined, readErrors: [], readGate: null, writeError: null };

export function resetNotifStore(featureFlags?: Record<string, unknown>): void {
  store.featureFlags = featureFlags;
  store.readErrors = [];
  store.readGate = null;
  store.writeError = null;
  vi.clearAllMocks();
}

export const sdk = {
  doc: vi.fn((_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` })),
  getDoc: vi.fn(async (ref: { path: string }) => {
    if (store.readGate) await store.readGate;
    if (store.readErrors.length > 0) throw store.readErrors.shift();
    const data = ref.path === 'siteConfig/featureFlags' ? store.featureFlags : undefined;
    return { exists: () => data !== undefined, data: () => data };
  }),
  setDoc: vi.fn(async (_ref: { path: string }, _data: unknown, _opts?: unknown) => {
    if (store.writeError) throw store.writeError;
  }),
  updateDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
  addDoc: vi.fn(async () => {}),
  getDocs: vi.fn(async () => ({ docs: [] })),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
};

/** 除了 doc／getDoc／setDoc 以外的 API 都不該被呼叫。 */
export const OTHER_APIS = ['updateDoc', 'deleteDoc', 'addDoc', 'getDocs', 'writeBatch', 'runTransaction'] as const;

export const ALL_FALSE = {
  category_activity: false,
  category_system: false,
  category_tournament: false,
  type_signup_success: false,
  type_cancel_signup: false,
  type_waitlist_demoted: false,
  type_event_relisted: false,
  type_role_upgrade: false,
  type_welcome: false,
} as const;
