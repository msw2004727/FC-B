// 圓形隊徽。只收本專案 Storage 下載網址；其他網址或載入失敗時退回隊名首字＋底色。
// 底色由 teamId 決定（crestIndex），同 id 永遠同色。不在這裡讀網路：呼叫端把 listEntriesForCrest 的結果傳進來。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { FIREBASE_CONFIG } from '@/data/firebase-config';
import { crestIndex, crestInitial } from '../data/present';
import type { EntryDoc } from '../data/types';

function projectBucket(): string {
  return FIREBASE_CONFIG.storageBucket.trim().replace(/^gs:\/\//, '').replace(/\/+$/, '');
}

/**
 * 本專案 Storage 下載網址：主機 firebasestorage.googleapis.com，路徑 /v0/b/<bucket>/o/。
 * bucket 取 firebase-config 的 storageBucket。其他網址不收。
 */
export function isProjectStorageDownloadUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password || url.port) return false;
  if (url.hostname !== 'firebasestorage.googleapis.com') return false;
  const bucket = projectBucket();
  if (!bucket) return false;
  const prefixes = [`/v0/b/${bucket}/o/`, `/v0/b/${encodeURIComponent(bucket)}/o/`];
  return prefixes.some((prefix) => url.pathname.startsWith(prefix) && url.pathname.length > prefix.length);
}

export const CREST_SIZES = [64, 48, 32, 22, 20] as const;
export type CrestSize = (typeof CREST_SIZES)[number];

export function TeamCrest({
  teamId,
  name,
  teamLogo,
  size,
}: {
  teamId: string;
  name: string;
  teamLogo: string | null;
  size: CrestSize;
}): JSX.Element {
  const logo = teamLogo && isProjectStorageDownloadUrl(teamLogo) ? teamLogo : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [logo]);
  const style = `width:${size}px;height:${size}px`;
  if (logo && !failed) {
    return (
      <img
        class="cp3-crest"
        src={logo}
        alt=""
        loading="lazy"
        style={style}
        onError={() => setFailed(true)}
      />
    );
  }
  const index = crestIndex(teamId);
  return (
    <span
      class={`cp3-crest cp3-crest--txt cp3-crest--c${index}`}
      aria-hidden="true"
      style={`${style};font-size:${Math.round(size * 0.48)}px`}
    >
      {crestInitial(name)}
    </span>
  );
}

/** 摘要的 h.id／a.id 是報名文件 id。對不到時用該 id 上色、用摘要隊名、沒有圖。 */
export function crestFromEntry(entryId: string, name: string, crests: readonly EntryDoc[]): {
  teamId: string;
  name: string;
  teamLogo: string | null;
} {
  const found = crests.find((row) => row.id === entryId);
  return {
    teamId: found?.teamId || entryId,
    // 首字跟旁邊顯示的隊名一致；報隊資料只補隊徽圖片（截圖驗收：兩個來源名稱不一致時首字對不上）
    name: name || found?.name || '',
    teamLogo: found?.teamLogo ?? null,
  };
}
