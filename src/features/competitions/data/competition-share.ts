// 賽事分享（CP-SHARE 第一段）：照活動分享 events/data/event-share.ts#shareEvent 的流程與退路
// （R-SHARE-007、008）：shareTargetPicker Flex → LINE 社群純文字 → 複製連結；不能用 picker 的訪客走 navigator.share，再不行複製。
// LINE 內一律用 Mini App 網址 `?competition={cid}`（R-SHARE-001、004；`?tournament=` 是舊站賽事，不混用）。
// 複製連結先用網站 /competitions/{cid}；專屬預覽圖文 /competition-share 是第二段，另卡。
// 卡片與文字只放賽事公開欄位：不放主辦、聯絡、隊伍或球員名單。

import { copyToClipboard } from '@/features/events/data/activity-share';
import { canUseShareTargetPicker, loadShareLiff, type ShareLiff } from '@/features/events/data/event-share';
import { buildFlexInfoRow, buildShareUrl, getEventSportShareImageUrl } from '@/features/events/data/event-share-builders';
import type { ShareChoice, ShareSheetLabels } from '@/features/events/components/legacy/ShareActionSheet';
import type { CompetitionsT } from '../i18n';
import { formatTaipeiShort } from '../format';
import { formatInAppDates } from './list-cards';
import type { CompetitionCategory, CompetitionDoc } from './types';

type PickerMessages = Parameters<
  typeof import('@line/liff').default.shareTargetPicker
>[0];
type FlexMessage = Extract<PickerMessages[number], { type: 'flex' }>;
type Bubble = Extract<FlexMessage['contents'], { type: 'bubble' }>;
type Box = NonNullable<Bubble['body']>;

/** 後端 CID_RE（同 data/list-snapshot.ts、pages/edit-competition.ts#isCompetitionId）。 */
const CID_RE = /^cp_[A-Za-z0-9]{20}$/;

export type ShareCompetition = Pick<
  CompetitionDoc,
  | 'id' | 'name' | 'sport' | 'category' | 'status' | 'visibility' | 'hidden' | 'deletingAt'
  | 'regOpenAt' | 'regCloseAt' | 'firstMatchAt' | 'lastMatchAt' | 'endedAt' | 'venues' | 'cover'
>;

export function isShareableCid(cid: string): boolean {
  return CID_RE.test(cid);
}

/**
 * 分享鈕顯示條件＝收到連結的人讀得到（Rules isPubLike && internalGate 的一般會員版）：
 * 已發布（含延期、取消）、未下架、公開（內部賽不顯示）、不是刪到一半；草稿不顯示。
 */
export function isCompetitionShareable(doc: ShareCompetition): boolean {
  return (doc.status === 'published' || doc.status === 'postponed' || doc.status === 'cancelled')
    && doc.hidden === false
    && doc.visibility === 'public'
    && doc.deletingAt == null
    && isShareableCid(doc.id);
}

/** 還在招募（同詳情頁 statusBadge 的「招募中」；主辦提前結束也不算）才列報名截止。 */
export function isRecruiting(doc: ShareCompetition, now: number): boolean {
  return doc.status === 'published' && doc.endedAt == null && now >= doc.regOpenAt && now < doc.regCloseAt;
}

export function buildCompetitionLiffUrl(cid: string): string {
  return buildShareUrl('competition', cid);
}

export function buildCompetitionCopyUrl(cid: string): string {
  return 'https://toosterx.com/competitions/' + encodeURIComponent(String(cid || '').trim());
}

const CATEGORY_COLORS: Readonly<Record<CompetitionCategory, string>> = {
  league: '#2563eb',
  cup: '#b45309',
  friendly: '#7c3aed',
};

function categoryLabel(ct: CompetitionsT, category: CompetitionCategory): string {
  if (category === 'cup') return ct('categoryCup');
  if (category === 'friendly') return ct('categoryFriendly');
  return ct('categoryLeague');
}

function venueText(doc: ShareCompetition): string {
  return doc.venues.map((venue) => venue.name.trim()).filter(Boolean).join('、');
}

/**
 * 照活動 _buildEventShareAltText 的 400 字上限（UTF-16 長度、碼點截斷、「...」收尾），
 * 但網址一律完整留在最後一行：只截網址前的內文（場地最多 10 個，串起來可能很長）。
 */
function truncateAltText(body: string, url: string): string {
  const max = 400 - url.length - 1;
  if (body.length <= max) return body + '\n' + url;
  let cut = '';
  for (const ch of Array.from(body)) {
    if (cut.length + ch.length > max - 3) break;
    cut += ch;
  }
  return cut + '...\n' + url;
}

interface InfoRow {
  label: string;
  value: string;
}

function infoRows(doc: ShareCompetition, ct: CompetitionsT, now: number): InfoRow[] {
  const rows: InfoRow[] = [];
  // 取消、延期也分享得出去（收到的人讀得到），卡片與文字要看得出狀態。
  if (doc.status === 'cancelled') rows.push({ label: ct('statusLabel'), value: ct('cancelled') });
  if (doc.status === 'postponed') rows.push({ label: ct('statusLabel'), value: ct('compPostponed') });
  rows.push({ label: ct('matchPeriod'), value: formatInAppDates(doc) });
  const venue = venueText(doc);
  if (venue) rows.push({ label: ct('venue'), value: venue });
  if (isRecruiting(doc, now)) rows.push({ label: ct('boardDeadline'), value: formatTaipeiShort(doc.regCloseAt) });
  return rows;
}

export function buildCompetitionShareAltText(
  doc: ShareCompetition,
  url: string,
  ct: CompetitionsT,
  now: number,
): string {
  const lines = [
    '＜' + doc.name + '＞',
    ct('category') + '：' + categoryLabel(ct, doc.category),
    ...infoRows(doc, ct, now).map((row) => row.label + '：' + row.value),
  ];
  return truncateAltText(lines.join('\n'), url);
}

/** 封面：主辦上傳的 1200×450；沒有就用運動預設圖（同活動分享的 og 圖）。 */
export function competitionShareImage(doc: ShareCompetition): { url: string; aspectRatio: string } | null {
  const cover = doc.hidden ? null : doc.cover;
  if (cover?.url && /^https:\/\//i.test(cover.url)) return { url: cover.url, aspectRatio: '8:3' };
  const sport = getEventSportShareImageUrl(doc.sport);
  return sport ? { url: sport, aspectRatio: '20:13' } : null;
}

export function buildCompetitionFlexMessage(
  doc: ShareCompetition,
  url: string,
  ct: CompetitionsT,
  now: number,
): Bubble {
  const color = CATEGORY_COLORS[doc.category] ?? CATEGORY_COLORS.league;
  // 資訊列與活動卡同一支（標籤 2：內容 5）。
  const rows: Box['contents'] = infoRows(doc, ct, now).map((row) => buildFlexInfoRow(row.label, row.value));
  const bubble: Bubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [{
            type: 'text',
            text: '⚽ ' + categoryLabel(ct, doc.category),
            size: 'xs',
            color: '#ffffff',
            weight: 'bold',
            align: 'center',
            gravity: 'center',
          }],
          backgroundColor: color,
          cornerRadius: '12px',
          paddingAll: '4px',
          paddingStart: '10px',
          paddingEnd: '10px',
          width: '90px',
        },
        {
          type: 'text',
          text: doc.name || ct('title'),
          weight: 'bold',
          size: 'lg',
          wrap: true,
          maxLines: 2,
          margin: 'md',
        },
        {
          type: 'box',
          layout: 'vertical',
          contents: rows,
          margin: 'lg',
          spacing: 'sm',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        style: 'primary',
        color,
        action: { type: 'uri', label: ct('shareView'), uri: url },
        height: 'sm',
      }],
      paddingAll: '12px',
    },
  };
  const image = competitionShareImage(doc);
  if (image) {
    bubble.hero = {
      type: 'image',
      url: image.url,
      size: 'full',
      aspectRatio: image.aspectRatio,
      aspectMode: 'cover',
    };
  }
  return bubble;
}

export function shareSheetLabels(ct: CompetitionsT): ShareSheetLabels {
  return {
    friends: ct('shareFriends'),
    friendsSub: ct('shareFriendsSub'),
    community: ct('shareCommunity'),
    communitySub: ct('shareCommunitySub'),
    toLine: ct('shareToLine'),
    copy: ct('shareCopy'),
    copySub: ct('shareCopySub'),
    cancel: ct('cancel'),
  };
}

interface ShareOptions {
  ct: CompetitionsT;
  loggedIn: boolean;
  signal: AbortSignal;
  showToast: (message: string) => void;
}

export interface CompetitionShareDeps {
  loadLiff: () => Promise<ShareLiff | null>;
  showSheet: (canPicker: boolean, signal: AbortSignal, title: string, labels: ShareSheetLabels) => Promise<ShareChoice>;
  copy: (text: string) => Promise<boolean>;
  nativeShare: ((data: ShareData) => Promise<void>) | undefined;
  openLine: (text: string) => void;
}

let shareInProgress = false;

function dependencies(): CompetitionShareDeps {
  return {
    loadLiff: loadShareLiff,
    showSheet: async (canPicker, signal, title, labels) => {
      const module = await import('@/features/events/components/legacy/ShareActionSheet');
      if (signal.aborted) return 'cancel';
      return module.showShareActionSheet(canPicker, signal, title, labels);
    },
    copy: copyToClipboard,
    nativeShare: typeof navigator !== 'undefined' && typeof navigator.share === 'function'
      ? (data) => navigator.share(data)
      : undefined,
    openLine: (text) => {
      window.open('https://line.me/R/share?text=' + encodeURIComponent(text), '_blank');
    },
  };
}

// 照 shareEvent：同一套選擇與退路；不能分享的賽事（草稿、內部、下架、id 不合格）直接不動作。
export async function shareCompetition(
  doc: ShareCompetition,
  options: ShareOptions,
  overrides: Partial<CompetitionShareDeps> = {},
): Promise<void> {
  if (shareInProgress || options.signal.aborted || !isCompetitionShareable(doc)) return;
  shareInProgress = true;
  const deps = { ...dependencies(), ...overrides };
  const { ct } = options;
  const current = (): boolean => !options.signal.aborted;
  const notify = (message: string): void => {
    if (current()) options.showToast(message);
  };

  try {
    const url = buildCompetitionLiffUrl(doc.id);
    // 「還在招募」以按下分享這一刻為準，卡片、替代文字、複製文字共用。
    const sharedAt = Date.now();
    const altText = buildCompetitionShareAltText(doc, url, ct, sharedAt);
    // 訪客且不在 LINE App 內：不先等 SDK，保留 navigator.share 的使用者手勢（同 shareEvent）。
    const maybeInLine = typeof navigator !== 'undefined' && /\bLine\//i.test(navigator.userAgent || '');
    const liff = options.loggedIn || maybeInLine || overrides.loadLiff
      ? await deps.loadLiff()
      : null;
    if (!current()) return;
    const canPicker = canUseShareTargetPicker(liff);

    if (canPicker || options.loggedIn) {
      const choice = await deps.showSheet(canPicker, options.signal, ct('shareBtn'), shareSheetLabels(ct));
      if (!current()) return;

      if (choice === 'line') {
        if (!canPicker || !liff || !canUseShareTargetPicker(liff)) {
          notify(ct('shareNeedLine'));
          return;
        }
        try {
          const result = await liff.shareTargetPicker([{
            type: 'flex',
            altText,
            contents: buildCompetitionFlexMessage(doc, url, ct, sharedAt),
          }]);
          notify(result ? ct('shareDone') : ct('shareFinished'));
        } catch {
          notify(ct('shareFailed'));
        }
        return;
      }
      if (choice === 'line-share') {
        deps.openLine(altText);
        return;
      }
      if (choice === 'copy') {
        const text = buildCompetitionShareAltText(doc, buildCompetitionCopyUrl(doc.id), ct, sharedAt);
        const ok = await deps.copy(text);
        notify(ok ? ct('shareCopied') : ct('shareCopyFailed'));
      }
      return;
    }

    if (deps.nativeShare) {
      try {
        await deps.nativeShare({ text: altText });
        return;
      } catch (error) {
        if (
          error && typeof error === 'object'
          && 'name' in error && error.name === 'AbortError'
        ) return;
      }
    }
    if (!current()) return;
    const ok = await deps.copy(altText);
    notify(ok ? ct('shareClipboard') : ct('shareClipboardFailed'));
  } catch {
    notify(ct('shareFailed'));
  } finally {
    shareInProgress = false;
  }
}
