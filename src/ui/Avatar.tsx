import './avatar.css';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';

export type UserRole =
  | 'user'
  | 'coach'
  | 'captain'
  | 'team_leader'
  | 'venue_owner'
  | 'admin'
  | 'super_admin';

export interface AvatarProps {
  name?: string | null;
  pictureUrl?: string | null;
  avatarUrl?: string | null;
  /** M-059：支援額外候選頭像網址清單，照 A 多網址輪試 */
  candidateUrls?: ReadonlyArray<string | null | undefined>;
  role?: UserRole;
  size?: 'sm' | 'md' | 'lg';
  decorative?: boolean;
  class?: string;
}

/* A 抽屜實測 44px；lg 沿用 A，sm / md 依通用規格。 */
const sizes = { sm: 24, md: 32, lg: 44 } as const;

/**
 * U-018：全站共用本次瀏覽的壞網址記憶清單（照 A `this._rememberBrokenAvatarUrl`）。
 * 壞過的網址直接跳過不再重試，避免名單反覆破圖再變字。
 */
const brokenAvatarUrls = new Set<string>();

export function rememberBrokenAvatarUrl(url: string | null | undefined): void {
  const trimmed = url?.trim();
  if (trimmed) brokenAvatarUrls.add(trimmed);
}

export function isBrokenAvatarUrl(url: string | null | undefined): boolean {
  const trimmed = url?.trim();
  return Boolean(trimmed && brokenAvatarUrls.has(trimmed));
}

/** 測試用：清空壞頭像記憶清單 */
export function _resetBrokenAvatarUrlsForTest(): void {
  brokenAvatarUrls.clear();
}

/**
 * M-059：照 A `js/modules/profile/profile-avatar.js`：
 * 取出有名字時的首字（不強轉大寫，保留原字；沒名字時回傳 `'?'`）。
 */
function initialOf(rawName: string | null | undefined): string {
  const trimmed = (rawName ?? '').trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0) || '?';
}

/**
 * M-059：組出可渲染的候選頭像網址清單：
 * - 若 `pictureUrl` 明確傳空字串 `""`，視為呼叫端要求空來源（直接顯示首字色塊，不回退 `avatarUrl`）
 * - 若 `pictureUrl` 與 `avatarUrl` 皆有值且不同，依序納入輪試
 * - 過濾已記住的壞網址（U-018）與重複網址
 */
function getRenderableCandidateUrls(
  pictureUrl: string | null | undefined,
  avatarUrl: string | null | undefined,
  extraCandidates?: ReadonlyArray<string | null | undefined>,
): string[] {
  if (pictureUrl !== undefined && pictureUrl !== null && pictureUrl.trim() === '') {
    return [];
  }
  const rawList: Array<string | null | undefined> = [
    pictureUrl,
    avatarUrl,
    ...(extraCandidates ?? []),
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of rawList) {
    const url = item?.trim();
    if (!url || seen.has(url) || brokenAvatarUrls.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

interface AvatarImageProps {
  candidates: readonly string[];
  altName: string;
  rawName: string | null | undefined;
  initial: string;
  size: number;
  decorative: boolean;
}

function AvatarImage({
  candidates,
  altName,
  rawName,
  initial,
  size,
  decorative,
}: AvatarImageProps): JSX.Element {
  const [index, setIndex] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const currentUrl = candidates[index] ?? null;

  const advanceOnBroken = (brokenUrl: string): void => {
    rememberBrokenAvatarUrl(brokenUrl);
    setIndex((prev) => prev + 1);
  };

  // M-059：照 A 延遲複檢（HTTP 快取載入壞圖或 <2px 時 onerror 可能不觸發）
  useEffect(() => {
    if (!currentUrl) return undefined;
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0 && (img.naturalWidth < 2 || img.naturalHeight < 2)) {
      advanceOnBroken(currentUrl);
      return undefined;
    }
    const timer = setTimeout(() => {
      const el = imgRef.current;
      if (!el || !el.complete) return;
      if (el.naturalWidth > 0 && (el.naturalWidth < 2 || el.naturalHeight < 2)) {
        advanceOnBroken(currentUrl);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [currentUrl]);

  if (currentUrl) {
    return (
      <img
        ref={imgRef}
        class="ui-avatar__image"
        src={currentUrl}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        data-avatar-fallback="1"
        data-avatar-name={(rawName ?? '').trim()}
        alt={decorative ? '' : altName}
        aria-hidden={decorative || undefined}
        onLoad={(event) => {
          const el = event.currentTarget;
          // M-059：照 A <2px 視為壞圖（jsdom 下未設定 naturalWidth 時為 0，僅在 >0 且 <2 或明確設定時觸發）
          if (el.naturalWidth < 2 || (el.naturalHeight > 0 && el.naturalHeight < 2)) {
            advanceOnBroken(currentUrl);
          }
        }}
        onError={() => advanceOnBroken(currentUrl)}
      />
    );
  }

  return (
    <span
      class="ui-avatar__fallback"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : altName}
      aria-hidden={decorative || undefined}
    >
      <Text class="ui-avatar__initial">{initial}</Text>
    </span>
  );
}

export function Avatar({
  name,
  pictureUrl,
  avatarUrl,
  candidateUrls,
  role = 'user',
  size = 'md',
  decorative = false,
  class: className = '',
}: AvatarProps): JSX.Element {
  const t = useT();
  const trimmedName = name?.trim() || '';
  const altName = trimmedName || t('ui.avatar.unknown');
  const candidates = getRenderableCandidateUrls(pictureUrl, avatarUrl, candidateUrls);
  const initial = initialOf(trimmedName);

  return (
    <span
      class={`ui-avatar ui-avatar--${size} ui-avatar--${role} ${className}`.trim()}
      aria-hidden={decorative || undefined}
    >
      <AvatarImage
        key={candidates.join('|')}
        candidates={candidates}
        altName={altName}
        rawName={trimmedName}
        initial={initial}
        size={sizes[size]}
        decorative={decorative}
      />
    </span>
  );
}
