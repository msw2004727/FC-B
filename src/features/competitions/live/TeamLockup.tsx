import type { JSX } from 'preact';
import type { EntryDoc } from '../data/types';
import { crestFromEntry, TeamCrest, type CrestSize } from '../ui/TeamCrest';

/** 隊名旁的隊徽。沒有圖、或網址不是本專案 Storage，TeamCrest 會顯示首字。 */
export function TeamLockup({
  entryId,
  name,
  crests,
  align,
  place,
}: {
  entryId: string;
  name: string;
  crests: readonly EntryDoc[];
  align: 'home' | 'away';
  place: 'board' | 'column';
}): JSX.Element {
  const crest = crestFromEntry(entryId, name, crests);
  const size: CrestSize = place === 'board' ? 22 : 20;
  const awayBoard = align === 'away' && place === 'board';
  const cls = [
    's4-side',
    awayBoard ? 's4-side--away' : '',
    place === 'column' ? 's4-side--col' : '',
  ].filter(Boolean).join(' ');
  const nameCls = place === 'column'
    ? 's4-col__name'
    : awayBoard
      ? 's4-team s4-team--away'
      : 's4-team';
  return (
    <span class={cls}>
      <TeamCrest teamId={crest.teamId} name={crest.name} teamLogo={crest.teamLogo} size={size} />
      <span class={nameCls}>{name}</span>
    </span>
  );
}
