// 人員、指派、邀請、記分頁的主辦判斷（這幾頁原本不讀賽事主文件）。
// staff 已是 host／coHost 或管理員就不讀賽事（+0 讀）；否則只有我有代表俱樂部時才讀賽事主文件（+1 讀），
// 看是不是這場俱樂部賽事的目前代表。代表清單沿用 LiveBoundary 的 repClubs（session 快取），不另查。

import { canHostOrCo, isCurrentClubRep } from '../access';
import type { CompetitionDoc } from './types';

export interface HostAccessResult {
  allowed: boolean;
  /** 靠「俱樂部目前代表」通過（後端 hostAccess 的 primary）。 */
  clubRep: boolean;
  /** 為了判斷代表而讀到的賽事；沒讀就是 null，呼叫端可沿用、不必再讀。 */
  competition: CompetitionDoc | null;
}

export async function resolveHostAccess(input: {
  repo: { getCompetition(cid: string): Promise<CompetitionDoc | null> };
  cid: string;
  staffRoles: Parameters<typeof canHostOrCo>[0]['staffRoles'];
  repClubIds: readonly string[];
  isAdmin: boolean;
}): Promise<HostAccessResult> {
  const byStaff = canHostOrCo({
    staffRoles: input.staffRoles,
    hostType: 'personal',
    hostTeamId: null,
    repClubIds: [],
    isAdmin: input.isAdmin,
  });
  if (byStaff) return { allowed: true, clubRep: false, competition: null };
  if (input.repClubIds.length === 0) return { allowed: false, clubRep: false, competition: null };
  const competition = await input.repo.getCompetition(input.cid);
  const clubRep = !!competition && isCurrentClubRep({
    hostType: competition.hostType,
    hostTeamId: competition.hostTeamId,
    repClubIds: input.repClubIds,
  });
  return { allowed: clubRep, clubRep, competition };
}
