/**
 * 通知腳本編輯（「編輯腳本」彈窗）。對應 A：
 * - `js/modules/message/message-notify.js#showTemplateEditor`（佔位符提示、排序）
 * - `js/firebase-service.js#_seedNotifTemplates`（缺的 10 個基本範本補上預設內容）
 * - `js/firebase-crud.js#updateNotifTemplate`（`notifTemplates/{key}` 寫入 title／body＋updatedAt）
 *
 * 讀取預算：開彈窗讀 `notifTemplates` 一次（limit 20，固定十幾份）。
 * Rules：寫入只限 `isAdmin()`；持入口碼的非 admin 按儲存會被擋（A 同），畫面提示失敗。
 * 與 A 差異：只寫有改動的範本與缺漏的基本範本（A 每次全部覆寫，且不等寫入結果）；寫入失敗會提示。
 */

import { getFirebase } from '@/data/firebase';
import { loadFirestoreSdk } from '@/data/firestore-sdk';
import { DEFAULT_NOTIF_TEMPLATES } from '@/data/notify';

export const NOTIF_TEMPLATES_READ_LIMIT = 20;

/** A `showTemplateEditor` 的 placeholderHints（也是排序依據）。 */
export const TEMPLATE_PLACEHOLDER_HINTS: Readonly<Record<string, string>> = {
  welcome: '{userName}',
  signup_success: '{eventName} {date} {location} {status}',
  cancel_signup: '{eventName} {date} {location} {status}',
  waitlist_promoted: '{eventName} {date} {location}',
  waitlist_demoted: '{eventName} {date} {location}',
  event_cancelled: '{eventName} {date} {location}',
  role_upgrade: '{userName} {roleName}',
  role_application: '{userName}',
  event_changed: '{eventName} {date} {location}',
  event_relisted: '{eventName} {date} {location}',
};

const ORDER = Object.keys(TEMPLATE_PLACEHOLDER_HINTS);

export interface EditableTemplate {
  key: string;
  title: string;
  body: string;
  /** Firestore 尚無這份（A `_seedNotifTemplates` 會補）。 */
  missing: boolean;
}

/** A `_seedNotifTemplates` 的預設內容（cancel_signup 用 seed 版，不是 _sendNotifFromTemplate 的覆寫版）。 */
const SEED_OVERRIDES: Readonly<Record<string, { title: string; body: string }>> = {
  cancel_signup: {
    title: '取消報名通知',
    body: '{status}。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如需再次參加，可回到活動頁重新報名。',
  },
  waitlist_demoted: {
    title: '候補降級通知',
    body: '因活動名額調整，您目前已改為候補狀態。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n若後續有名額釋出，系統會再通知您。',
  },
};

function seedTemplateOf(key: string): { title: string; body: string } | null {
  return SEED_OVERRIDES[key] ?? DEFAULT_NOTIF_TEMPLATES[key] ?? null;
}

/** A 的排序：有提示的依提示順序，其餘依 key 字母排在後面。 */
export function sortTemplates<T extends { key: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const ia = ORDER.indexOf(a.key);
    const ib = ORDER.indexOf(b.key);
    if (ia === -1 && ib === -1) return a.key.localeCompare(b.key);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export async function loadEditableTemplates(): Promise<EditableTemplate[]> {
  const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'notifTemplates'), fs.limit(NOTIF_TEMPLATES_READ_LIMIT)));
  const byKey = new Map<string, EditableTemplate>();
  for (const d of snap.docs) {
    const data = d.data() as { key?: unknown; title?: unknown; body?: unknown };
    const key = String(data.key ?? d.id).trim();
    if (!key) continue;
    byKey.set(key, {
      key,
      title: typeof data.title === 'string' ? data.title : '',
      body: typeof data.body === 'string' ? data.body : '',
      missing: false,
    });
  }
  for (const key of ORDER) {
    if (byKey.has(key)) continue;
    const seed = seedTemplateOf(key);
    if (seed) byKey.set(key, { key, title: seed.title, body: seed.body, missing: true });
  }
  return sortTemplates([...byKey.values()]);
}

/** 只寫有改動或尚未建立的範本；回傳寫入份數。任一失敗往外拋。 */
export async function saveTemplates(
  original: readonly EditableTemplate[],
  edited: readonly EditableTemplate[],
): Promise<number> {
  const before = new Map(original.map((t) => [t.key, t]));
  const changed = edited.filter((t) => {
    const prev = before.get(t.key);
    return !prev || prev.missing || prev.title !== t.title || prev.body !== t.body;
  });
  if (changed.length === 0) return 0;
  const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
  const batch = fs.writeBatch(db);
  for (const t of changed) {
    const prev = before.get(t.key);
    const payload: Record<string, unknown> = {
      key: t.key,
      title: t.title,
      body: t.body,
      updatedAt: fs.serverTimestamp(),
    };
    if (!prev || prev.missing) payload['createdAt'] = fs.serverTimestamp();
    batch.set(fs.doc(db, 'notifTemplates', t.key), payload, { merge: true });
  }
  await batch.commit();
  return changed.length;
}
