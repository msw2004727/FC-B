// 第 3 步詳情首屏要讀的東西。還沒接進 CompetitionDetailPage（那會改第 2 步的讀取）。
// 不讀 matches 全集：16 隊單循環就超過詳情上限。畫面用摘要片。
// ASSUMPTION: 內部期多的 3 筆是 getLaunch、getLaunchTester、listMine，而且觀看者已登入。
// 沒有 uid 時測試員與我的賽事不讀，只多開賽設定那 1 筆。
// ASSUMPTION: 賽事文件不存在就停，不再讀子集合。
// ASSUMPTION: 進行中與已結束才讀積分榜。招募與預熱不讀。

import type { CompetitionsRepo } from './cp-repo';
import { competitionPhase, type CompetitionPhase } from './present';
import type {
  CompetitionDoc,
  DivisionDoc,
  EntryDoc,
  StaffDoc,
  StandingDoc,
  SummaryEntry,
} from './types';

export interface ScheduleDetailInput {
  cid: string;
  uid: string | null;
  now: number;
  /** 內部期。已登入時多 3 筆讀取。 */
  internal?: boolean;
}

export interface ScheduleDetail {
  competition: CompetitionDoc | null;
  phase: CompetitionPhase | null;
  divisions: DivisionDoc[];
  crests: EntryDoc[];
  staff: StaffDoc | null;
  summary: SummaryEntry[];
  standings: StandingDoc[];
}

/** 每次回傳新物件，避免呼叫端改到共用常數（Flash 初審 P3）。 */
const emptyDetail = (): ScheduleDetail => ({
  competition: null,
  phase: null,
  divisions: [],
  crests: [],
  staff: null,
  summary: [],
  standings: [],
});

export async function loadScheduleDetail(
  repo: CompetitionsRepo,
  input: ScheduleDetailInput,
): Promise<ScheduleDetail> {
  if (input.internal) {
    await repo.getLaunch();
    if (input.uid) {
      await repo.getLaunchTester(input.uid);
      await repo.listMine(input.uid);
    }
  }
  const competition = await repo.getCompetition(input.cid);
  if (!competition) return emptyDetail();
  const phase = competitionPhase(competition, input.now);
  const needTable = phase === 'live' || phase === 'done';
  const [divisions, crests, staff, summary, standings] = await Promise.all([
    repo.listDivisions(input.cid),
    repo.listEntriesForCrest(input.cid),
    input.uid ? repo.getStaff(input.cid, input.uid) : Promise.resolve(null),
    repo.listSummary(input.cid),
    needTable ? repo.listStandings(input.cid) : Promise.resolve([] as StandingDoc[]),
  ]);
  return { competition, phase, divisions, crests, staff, summary, standings };
}
