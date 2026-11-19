/**
 * 首頁「我的下一場活動」的本機快照：讀取端（站長 2026-11-19 定案：先畫上次內容＋「更新中」，新資料到了再換）。
 *
 * - 只存畫面用得到的欄位（標題、日期字串、地點、圖片網址、公開 id、報名狀態），白名單投影在寫入端
 *   `next-activity-snapshot-write.ts`（延遲載入，首頁入口 JS 預算只剩幾十 bytes）。讀取端再挑一次字串欄位，不信任其他形狀。
 * - 記下屬於哪個帳號（owner＝uid）。帳號確認後不符就不用；登出／清除快取時由 `clearAccountLocalState`
 *   依前綴 `fcb:home-next:` 一起清掉（data/auth.ts）。
 * - 帳號還原前（authPending）只有「上次已登入」旗標在時才可先畫（站長同意放寬，只限這一塊）。
 * - 活動已開始、存了超過 7 天、寫入時間在未來、格式版本不同或格式不符都視為沒有快照。
 * - 讀取失敗（私密模式、被停用、壞掉的 JSON）一律當作沒有快照。
 */
import type { EventDoc } from '@/features/events/data/types';
import { parseEventDateRange, type NextActivityResult } from './next-activity';

export const NEXT_ACTIVITY_SNAPSHOT_KEY = 'fcb:home-next:v1';
export const NEXT_ACTIVITY_SNAPSHOT_FORMAT_V = 1;
export const NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const NEXT_ACTIVITY_SNAPSHOT_MAX_CHARS = 20_000;

export interface NextActivitySnapshot {
  owner: string;
  savedAt: number;
  result: NextActivityResult;
}

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const url = (v: unknown): string | undefined => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
};

/** 讀快照：沒有、過期、活動已開始、格式不符都回 null。不檢查帳號，帳號由呼叫端比對 owner。 */
export function readNextActivitySnapshot(nowMs: number = Date.now()): NextActivitySnapshot | null {
  try {
    const raw = localStorage.getItem(NEXT_ACTIVITY_SNAPSHOT_KEY);
    if (!raw || raw.length > NEXT_ACTIVITY_SNAPSHOT_MAX_CHARS) return null;
    const parsed = obj(JSON.parse(raw));
    const owner = str(parsed.owner);
    const savedAt = parsed.savedAt;
    if (parsed.v !== NEXT_ACTIVITY_SNAPSHOT_FORMAT_V || !owner || typeof savedAt !== 'number') return null;
    if (!(nowMs - savedAt <= NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS && savedAt <= nowMs + 60_000)) return null;
    const res = obj(parsed.result);
    const ev = obj(res.event);
    const id = str(ev.id);
    const date = str(ev.date);
    if (!id || !date || !((parseEventDateRange(date)?.startMs ?? 0) > nowMs)) return null;
    const variants = obj(ev.imageVariants);
    const event: EventDoc = {
      id,
      date,
      title: str(ev.title),
      location: str(ev.location),
      image: url(ev.image),
      imageVariants: { homeNext: url(variants.homeNext), cover: url(variants.cover) },
    };
    const reg = res.registration ? obj(res.registration) : null;
    return {
      owner,
      savedAt,
      result: {
        event,
        registration: reg ? { status: str(reg.status), managedRole: str(reg.managedRole) } : null,
        managedRole: str(res.managedRole) ?? '',
      },
    };
  } catch {
    return null;
  }
}
