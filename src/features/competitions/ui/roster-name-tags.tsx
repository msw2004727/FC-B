// 賽事名單名字標籤（站長 11-27 選 B：一顆斜方標籤，改過暱稱時第二段接原始暱稱）。底色依身分快照，不可點。
import type { JSX } from 'preact';
import { userCapsuleRoleClass } from '@/ui/UserTag';
import type { UserRole } from '@/ui/Avatar';
import { rosterNameParts, rosterRoleOf } from '../data/names';

export function RosterNameTags({ row, class: extra = '' }: {
  row: { displayName: string; nickname?: string | null; originalName?: string | null; role?: string | null };
  class?: string;
}): JSX.Element {
  const n = rosterNameParts(row);
  const role = rosterRoleOf(row.role) as UserRole;
  return (
    <span class={`user-capsule ${userCapsuleRoleClass(role)} cpn-tag ${extra}`.trim()} data-roster-name>
      <span class="cpn-straight">{n.main}{n.orig ? <span class="cpn-seg">{n.orig}</span> : null}</span>
    </span>
  );
}
