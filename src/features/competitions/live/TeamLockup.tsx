import type { JSX } from 'preact';
import type { EntryDoc } from '../data/types';
import { crestFromEntry, TeamCrest, type CrestSize } from '../ui/TeamCrest';

/** 全形字算 1、半形字算 0.5（施工-第2批 3.5 的字數算法）。 */
export function nameWeight(name: string): number {
  let n = 0;
  for (const ch of Array.from(name)) {
    const code = ch.codePointAt(0) ?? 0;
    n += code <= 0xff || (code >= 0xff61 && code <= 0xffdc) ? 0.5 : 1;
  }
  return n;
}

/** 記分頁的長隊名拆段：犧牲中間、保住結尾。板上 7 以上對半拆；標籤一律最後四個字是後段。不必拆時回 null。 */
export function splitTeamName(name: string, place: 'board' | 'column'): [string, string] | null {
  const chars = Array.from(name);
  if (place === 'board') {
    if (nameWeight(name) < 7) return null;
    const head = Math.ceil(chars.length / 2);
    return [chars.slice(0, head).join(''), chars.slice(head).join('')];
  }
  if (chars.length <= 4) return null;
  return [chars.slice(0, -4).join(''), chars.slice(-4).join('')];
}

/** 隊名旁的隊徽。沒有圖、或網址不是本專案 Storage，TeamCrest 會顯示首字。 */
export function TeamLockup({
  entryId,
  name,
  crests,
  align,
  place,
  split = false,
}: {
  entryId: string;
  name: string;
  crests: readonly EntryDoc[];
  align: 'home' | 'away';
  place: 'board' | 'column';
  /** 只有記分頁傳：長隊名拆成前段、後段兩個子節點（文字相連，textContent 不變）。 */
  split?: boolean;
}): JSX.Element {
  const crest = crestFromEntry(entryId, name, crests);
  const size: CrestSize = place === 'board' ? 22 : 20;
  const awayBoard = align === 'away' && place === 'board';
  const cls = [
    's4-side',
    awayBoard ? 's4-side--away' : '',
    place === 'column' ? 's4-side--col' : '',
  ].filter(Boolean).join(' ');
  const baseCls = place === 'column'
    ? 's4-col__name'
    : awayBoard
      ? 's4-team s4-team--away'
      : 's4-team';
  const parts = split ? splitTeamName(name, place) : null;
  // 標籤超過 10 個字降 13px（3.5）；不拆段時不加，輸出與原本逐字相同。
  const nameCls = split && place === 'column' && nameWeight(name) > 10 ? `${baseCls} s4-nm--long` : baseCls;
  return (
    <span class={cls}>
      <TeamCrest teamId={crest.teamId} name={crest.name} teamLogo={crest.teamLogo} size={size} />
      {parts ? (
        <span class={nameCls}>
          <span class="s4-nm__a">{parts[0]}</span>
          <span class="s4-nm__b">{parts[1]}</span>
        </span>
      ) : (
        <span class={nameCls}>{name}</span>
      )}
    </span>
  );
}
