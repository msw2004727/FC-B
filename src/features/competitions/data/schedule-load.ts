// 第 3 步詳情首屏。還沒接進 CompetitionDetailPage（那會改第 2 步的讀取）。
// 招募／預熱：賽事根、組別、隊徽。不讀摘要、職員、積分。
// 進行中：賽事根、當日一片摘要、積分、隊徽。不讀組別、職員、摘要全集。
// 已結束：賽事根、積分、隊徽。摘要留到展開（loadFullSchedule）。
// 內部期多的 3 筆是 getLaunch、getLaunchTester、listMine，而且觀看者已登入。
// 沒有 uid 時測試員與我的賽事不讀，只多開賽設定那 1 筆。
// 賽事文件不存在就停，不再讀子集合。

import type { CompetitionsRepo } from './cp-repo';
import { competitionPhase, taipeiYmd, type CompetitionPhase } from './present';
import type {
  CompetitionDoc,
  DivisionDoc,
  EntryDoc,
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
  /** 招募／預熱才讀。進行中與已結束是空陣列。 */
  divisions: DivisionDoc[];
  crests: EntryDoc[];
  /** 當日摘要。只有進行中有內容。 */
  summary: SummaryEntry[];
  standings: StandingDoc[];
}

/** 每次回傳新物件，避免呼叫端改到共用常數。 */
const emptyDetail = (): ScheduleDetail => ({
  competition: null,
  phase: null,
  divisions: [],
  crests: [],
  summary: [],
  standings: [],
});

/** 當日摘要片 id：d + 台北日期 YYYYMMDD。 */
export function summaryShardIdOf(now: number): string {
  return `d${taipeiYmd(now)}`;
}

async function readInternal(repo: CompetitionsRepo, input: ScheduleDetailInput): Promise<void> {
  if (!input.internal) return;
  await repo.getLaunch();
  if (input.uid) {
    await repo.getLaunchTester(input.uid);
    await repo.listMine(input.uid);
  }
}

export async function loadScheduleDetail(
  repo: CompetitionsRepo,
  input: ScheduleDetailInput,
): Promise<ScheduleDetail> {
  await readInternal(repo, input);
  const competition = await repo.getCompetition(input.cid);
  if (!competition) return emptyDetail();
  const phase = competitionPhase(competition, input.now);
  if (phase === 'recruit' || phase === 'warm') {
    const [divisions, crests] = await Promise.all([
      repo.listDivisions(input.cid),
      repo.listEntriesForCrest(input.cid),
    ]);
    return { competition, phase, divisions, crests, summary: [], standings: [] };
  }
  if (phase === 'live') {
    const [summary, standings, crests] = await Promise.all([
      repo.getSummaryShard(input.cid, summaryShardIdOf(input.now)),
      repo.listStandings(input.cid),
      repo.listEntriesForCrest(input.cid),
    ]);
    return { competition, phase, divisions: [], crests, summary, standings };
  }
  const [standings, crests] = await Promise.all([
    repo.listStandings(input.cid),
    repo.listEntriesForCrest(input.cid),
  ]);
  return { competition, phase, divisions: [], crests, summary: [], standings };
}

/** 賽程分頁與已結束展開。摘要片最多 CP_READ_LIMIT.summary。 */
export async function loadFullSchedule(repo: CompetitionsRepo, cid: string): Promise<SummaryEntry[]> {
  return repo.listSummary(cid);
}
