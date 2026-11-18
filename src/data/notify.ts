/**
 * 範本通知發送（對應 A `js/modules/message/message-notify.js` 的
 * `_sendNotifFromTemplate`／`_renderTemplate`／`_deliverMessageWithLinePush`＋`_queueLinePush`）。
 *
 * 決策：
 * - 內建範本（`DEFAULT_NOTIF_TEMPLATES`）逐字照抄 A；`cancel_signup`／`waitlist_demoted` 用
 *   A 的 `fallbackTemplates` 覆寫版本（合併順序：先預設，再覆寫）。
 * - 收件匣一律走 `deliverInboxMessage`（B 的 inbox-delivery，形狀與 A 相同）。
 * - LINE 走 `callFn('enqueuePrivilegedLineNotification', ...)`，與 A `_dispatchLinePush` 一致。
 * - 收件匣、LINE 失敗都只 warn，不往外拋（A 為 fire-and-forget）。
 * - `source` 預設 `template:${key}`，可由 `lineOptions.source` 覆寫。
 * - dedupeKey 取收件匣訊息的 `dedupeKey`，`lineOptions.dedupeKey` 優先。
 */

import { callFn, type RequestOf } from '@/data/callables';
import { getFirebase } from '@/data/firebase';
import { deliverInboxMessage, type InboxDeliveryExtra } from '@/data/inbox-delivery';

// ── 內建範本（照 A `_getDefaultNotifTemplates` 逐字複製） ──

interface NotifTemplate {
  title: string;
  body: string;
}

const A_DEFAULT_TEMPLATES: Record<string, NotifTemplate> = {
  welcome: {
    title: '歡迎加入 SportHub！',
    body: '嗨 {userName}，歡迎加入 SportHub 平台！\n\n您可以在這裡瀏覽並報名各類足球活動、加入俱樂部、參與聯賽。\n祝您使用愉快！',
  },
  signup_success: {
    title: '報名成功通知',
    body: '您已成功報名以下活動：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n報名狀態：{status}\n\n請準時出席，如需取消請提前至活動頁面操作。',
  },
  cancel_signup: {
    title: '取消報名通知',
    body: '{status}。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如需再次參加，可回到活動頁重新報名。',
  },
  waitlist_promoted: {
    title: '候補遞補通知',
    body: '恭喜！由於有人取消報名，您已從候補名單自動遞補為正式參加者。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n請準時出席！',
  },
  waitlist_demoted: {
    title: '候補降級通知',
    body: '因活動名額調整，您目前已改為候補狀態。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n若後續有名額釋出，系統會再通知您。',
  },
  event_cancelled: {
    title: '活動取消通知',
    body: '很抱歉通知您，以下活動因故取消：\n\n活動名稱：{eventName}\n原定時間：{date}\n原定地點：{location}\n\n如您已繳費，費用將於 3 個工作天內退還。造成不便深感抱歉。',
  },
  role_upgrade: {
    title: '身份變更通知',
    body: '恭喜 {userName}！您的身份已變更為「{roleName}」。\n\n新身份可能帶來新的權限與功能，請至個人資料頁面查看詳情。\n感謝您對社群的貢獻！',
  },
  role_application: {
    title: '有用戶欲申請身分權限',
    body: '通知有用戶 {userName} 欲申請相關權限，請至官方 LINE@ 確認訊息。',
  },
  event_changed: {
    title: '活動變更通知',
    body: '您報名的活動資訊有所變更，請留意：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如因變更需要取消報名，請至活動頁面操作。',
  },
  event_relisted: {
    title: '活動重新上架通知',
    body: '您先前報名的活動已重新上架：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n您的報名資格仍然保留，請留意活動時間。',
  },
  tournament_friendly_host_opened: {
    title: '友誼賽已建立',
    body: '主辦俱樂部「{hostTeamName}」已開啟友誼賽「{tournamentName}」。\n\n報名截止：{regEnd}\n\n若您為主辦俱樂部成員，現在可前往賽事頁的俱樂部頁籤點選參賽。',
  },
  tournament_friendly_team_apply_host: {
    title: '有新俱樂部申請參賽',
    body: '俱樂部「{teamName}」已申請參加「{tournamentName}」。\n申請人：{applicantName}\n\n請前往賽事詳細頁進行審核。',
  },
  tournament_friendly_team_approved_applicant: {
    title: '俱樂部申請已通過',
    body: '恭喜！您代表「{teamName}」申請參加「{tournamentName}」已通過審核。\n審核人：{reviewerName}\n\n隊員現在可加入該隊參賽名單。',
  },
  tournament_friendly_team_rejected_applicant: {
    title: '俱樂部申請結果通知',
    body: '很抱歉，您代表「{teamName}」申請參加「{tournamentName}」未獲通過。\n審核人：{reviewerName}\n\n如有疑問請聯繫主辦方。',
  },
  tournament_friendly_team_approved_broadcast: {
    title: '俱樂部已可加入名單',
    body: '俱樂部「{teamName}」已通過「{tournamentName}」參賽審核。\n\n若您是該隊成員，現在可前往賽事頁的俱樂部頁籤點選參賽。',
  },
};

/**
 * A `_sendNotifFromTemplate` 的 `fallbackTemplates`：
 *   `{ ..._getDefaultNotifTemplates(), cancel_signup: {...}, waitlist_demoted: {...} }`。
 */
export const DEFAULT_NOTIF_TEMPLATES: Record<string, NotifTemplate> = {
  ...A_DEFAULT_TEMPLATES,
  cancel_signup: {
    title: '取消報名通知',
    body: '{status}：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如之後想再次參加，請回到活動頁重新報名。',
  },
  waitlist_demoted: {
    title: '候補調整通知',
    body: '很抱歉通知您，因活動名額調整，您的報名狀態已改為候補。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n若有名額釋出，系統將依候補順序自動遞補。',
  },
};

// ── 範本渲染（A `_renderTemplate`） ────────────────

export function renderTemplate(
  str: string,
  vars: Record<string, unknown> | null | undefined,
): string {
  if (!str) return '';
  return str.replace(
    /\{(\w+)\}/g,
    (_, key: string) => (vars && vars[key] != null ? String(vars[key]) : `{${key}}`),
  );
}

// ── LINE 推播強制來源與 toggle 判斷（A `_LINE_PUSH_FORCED_ON_SOURCES` 等） ──

export const LINE_PUSH_FORCED_ON_SOURCES = [
  'template:waitlist_promoted',
  'template:event_cancelled',
  'template:event_changed',
  'template:role_application',
] as const;

export function isForcedLinePushSource(source: string): boolean {
  const safeSource = String(source || '').trim();
  return (
    LINE_PUSH_FORCED_ON_SOURCES.some((prefix) => safeSource.startsWith(prefix))
    || safeSource.startsWith('target:')
  );
}

/** A `_linePushCategoryKey`：私訊（private）歸入 system，其他原樣。 */
export function linePushCategoryKey(category: string): string {
  if (category === 'private') return 'system';
  return category;
}

/**
 * A `_shouldSkipLinePushByToggles` 逐行移植。
 * - 強制來源不受 toggle 影響。
 * - `category_<key> === false` → skip。
 * - `source` 以 `template:` 開頭時，`type_<name> === false` → skip。
 */
export function shouldSkipLinePushByToggles(
  category: string,
  source: string,
  toggles: Record<string, unknown> | null | undefined,
): boolean {
  if (isForcedLinePushSource(source)) return false;

  const safeToggles = toggles || {};
  const categoryKey = 'category_' + linePushCategoryKey(category);
  if (safeToggles[categoryKey] === false) return true;

  if (String(source || '').startsWith('template:')) {
    const typeKey = 'type_' + String(source || '').slice('template:'.length);
    if (safeToggles[typeKey] === false) return true;
  }

  return false;
}

// ── 讀取自訂範本／toggles ─────────────────────────

/**
 * 讀 `notifTemplates` 集合中 `key` 相同的文件；讀取失敗回 null。
 * 回傳 title／body 只保留字串（非法型別回 undefined），交呼叫端決定是否採用。
 */
export async function loadNotifTemplate(
  key: string,
): Promise<{ title?: string; body?: string } | null> {
  try {
    const [{ collection, getDocs, limit, query, where }, { db }] = await Promise.all([
      import('firebase/firestore'),
      getFirebase(),
    ]);
    const q = query(
      collection(db, 'notifTemplates'),
      where('key', '==', key),
      limit(1),
    );
    const snap = await getDocs(q);
    const first = snap.docs[0];
    if (!first) return null;
    const data = first.data() as { title?: unknown; body?: unknown };
    return {
      title: typeof data.title === 'string' ? data.title : undefined,
      body: typeof data.body === 'string' ? data.body : undefined,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notify] loadNotifTemplate failed', err);
    return null;
  }
}

/**
 * 讀 `siteConfig/featureFlags.notificationToggles`（A `getNotificationToggles`）。
 * 不是物件／陣列／讀取失敗都回 `{}`。
 */
export async function loadNotificationToggles(): Promise<Record<string, unknown>> {
  try {
    const [{ doc, getDoc }, { db }] = await Promise.all([
      import('firebase/firestore'),
      getFirebase(),
    ]);
    const snap = await getDoc(doc(db, 'siteConfig', 'featureFlags'));
    if (!snap.exists()) return {};
    const data = snap.data() as { notificationToggles?: unknown };
    const toggles = data.notificationToggles;
    if (toggles && typeof toggles === 'object' && !Array.isArray(toggles)) {
      return toggles as Record<string, unknown>;
    }
    return {};
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notify] loadNotificationToggles failed', err);
    return {};
  }
}

// ── 範本通知發送 ──────────────────────────────────

export interface SendTemplateNotificationInput {
  key: string;
  vars: Record<string, unknown>;
  targetUid: string;
  category: string;
  categoryName: string;
  senderUid: string | null;
  extra?: InboxDeliveryExtra | null;
  lineOptions?: {
    source?: string;
    dedupeKey?: string;
  };
}

export interface SendTemplateNotificationResult {
  delivered: boolean;
  linePushed: boolean;
  reason?: string;
}

/**
 * A `_sendNotifFromTemplate`＋`_deliverMessageWithLinePush`＋`_queueLinePush` 的 B 版。
 * 收件匣、LINE 的失敗都只 warn，不往外拋（回傳 delivered／linePushed 表示實際結果）。
 */
export async function sendTemplateNotification(
  input: SendTemplateNotificationInput,
): Promise<SendTemplateNotificationResult> {
  // 1. 範本選擇（A: 自訂優先，缺 title/body 退回內建）。
  const customTpl = await loadNotifTemplate(input.key);
  const fallbackTpl = DEFAULT_NOTIF_TEMPLATES[input.key];
  const tpl: NotifTemplate | undefined =
    customTpl && customTpl.title && customTpl.body
      ? { title: customTpl.title, body: customTpl.body }
      : fallbackTpl;

  if (!tpl) {
    // eslint-disable-next-line no-console
    console.warn('[notify] template missing:', input.key);
    return { delivered: false, linePushed: false, reason: 'template_missing' };
  }

  const title = renderTemplate(tpl.title, input.vars);
  const body = renderTemplate(tpl.body, input.vars);
  const category = input.category || 'system';
  const categoryName = input.categoryName || '系統';

  // 2. 收件匣（A `_deliverMessageToInbox`）：失敗只 warn。
  let deliveredMsg: Record<string, unknown> | null;
  try {
    deliveredMsg = await deliverInboxMessage({
      title,
      body,
      category,
      categoryName,
      targetUid: input.targetUid,
      senderName: '系統',
      senderUid: input.senderUid,
      extra: input.extra ?? null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notify] deliverInboxMessage failed', err);
    return { delivered: false, linePushed: false };
  }

  // A `_deliverMessageWithLinePush`：收件匣略過（5 秒內重複）就不推 LINE。
  if (!deliveredMsg) return { delivered: false, linePushed: false, reason: 'duplicate' };

  // A `_queueLinePush`：uid／category／title／body 任一空白就不推。
  if (!input.targetUid || !category || !title || !body) {
    return { delivered: true, linePushed: false, reason: 'line_incomplete' };
  }

  // 3. LINE（A `_deliverMessageWithLinePush`＋`_queueLinePush`）：
  //    source 預設 template:${key}；toggles 判斷沿用 A；dedupeKey 優先用 lineOptions 的。
  const source = input.lineOptions?.source || `template:${input.key}`;

  // A `_queueLinePush`：強制推播的來源不必讀開關。
  const toggles = isForcedLinePushSource(source) ? {} : await loadNotificationToggles();
  if (shouldSkipLinePushByToggles(category, source, toggles)) {
    return { delivered: true, linePushed: false };
  }

  const lineDedupeKey =
    input.lineOptions?.dedupeKey
    || (typeof deliveredMsg['dedupeKey'] === 'string' && deliveredMsg['dedupeKey']
      ? (deliveredMsg['dedupeKey'] as string)
      : undefined);

  const payload: RequestOf<'enqueuePrivilegedLineNotification'> = {
    uid: input.targetUid,
    category,
    title,
    body,
    source,
  };
  if (lineDedupeKey) payload.dedupeKey = lineDedupeKey;

  try {
    await callFn('enqueuePrivilegedLineNotification', payload);
    return { delivered: true, linePushed: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notify] enqueuePrivilegedLineNotification failed', err);
    return { delivered: true, linePushed: false };
  }
}
