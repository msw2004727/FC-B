// 圓形隊徽。有 https 網址就用圖片；載入失敗或沒有網址時退回隊名首字＋底色。
// 底色由 teamId 決定（crestIndex），同 id 永遠同色。不在這裡讀網路：呼叫端把 listEntriesForCrest 的結果傳進來。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { crestIndex, crestInitial } from '../data/present';
import type { EntryDoc } from '../data/types';

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
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [teamLogo]);
  const style = `width:${size}px;height:${size}px`;
  if (teamLogo && !failed) {
    return (
      <img
        class="cp3-crest"
        src={teamLogo}
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
    name: found?.name || name,
    teamLogo: found?.teamLogo ?? null,
  };
}
