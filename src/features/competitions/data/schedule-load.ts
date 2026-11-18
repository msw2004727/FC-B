// 第 3 步詳情首屏。CompetitionDetailPage 用這支，不讀 matches 全集，也不讀摘要全集。
// 招募：賽事根、組別、隊徽。已登入另讀職員。不讀摘要、積分。
// 預熱：賽事根、組別、隊徽、首場那天一片摘要。已登入另讀職員。不讀積分、摘要全集。
// 進行中：賽事根、當日一片摘要、積分、隊徽。已登入另讀職員。不讀組別、摘要全集。
// 已結束：賽事根、積分、隊徽。已登入另讀職員。摘要留到展開（loadFullSchedule）。
// 沒有 uid 不讀職員，staff 是 null。三個階段都一樣。
// 內部期多的 3 筆是 getLaunch、getLaunchTester、listMine，而且觀看者已登入。
// 沒有 uid 時測試員與我的賽事不讀，只多開賽設定那 1 筆。
// 賽事文件不存在就停，不再讀子集合。

import type { CompetitionsRepo } from './cp-repo';
import { competitionPhase, taipeiYmd, type CompetitionPhase } from './present';
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
  /** 招募／預熱才讀。進行中與已結束是空陣列。 */
  divisions: DivisionDoc[];
  crests: EntryDoc[];
  /**
   * 預熱是首場那天一片；進行中是當日一片。
   * 招募與已結束是空陣列（已結束要等展開才讀全集）。
   */
  summary: SummaryEntry[];
  standings: StandingDoc[];
  /** 已登入才讀。沒有 uid 是 null，而且不打 getStaff。 */
  staff: StaffDoc | null;
}

/** 每次回傳新物件，避免呼叫端改到共用常數。 */
const emptyDetail = (): ScheduleDetail => ({
  competition: null,
  phase: null,
  divisions: [],
  crests: [],
  summary: [],
  standings: [],
  staff: null,
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

/** 沒有 uid 不讀。有 uid 才是 1 筆 getStaff。 */
async function readStaff(repo: CompetitionsRepo, input: ScheduleDetailInput): Promise<StaffDoc | null> {
  if (!input.uid) return null;
  return repo.getStaff(input.cid, input.uid);
}

export async function loadScheduleDetail(
  repo: CompetitionsRepo,
  input: ScheduleDetailInput,
): Promise<ScheduleDetail> {
  await readInternal(repo, input);
  const competition = await repo.getCompetition(input.cid);
  if (!competition) return emptyDetail();
  const phase = competitionPhase(competition, input.now);
  if (phase === 'recruit') {
    const [divisions, crests, staff] = await Promise.all([
      repo.listDivisions(input.cid),
      repo.listEntriesForCrest(input.cid),
      readStaff(repo, input),
    ]);
    return { competition, phase, divisions, crests, summary: [], standings: [], staff };
  }
  if (phase === 'warm') {
    const [divisions, crests, staff, summary] = await Promise.all([
      repo.listDivisions(input.cid),
      repo.listEntriesForCrest(input.cid),
      readStaff(repo, input),
      repo.getSummaryShard(input.cid, summaryShardIdOf(competition.firstMatchAt)),
    ]);
    return { competition, phase, divisions, crests, summary, standings: [], staff };
  }
  if (phase === 'live') {
    const [summary, standings, crests, staff] = await Promise.all([
      repo.getSummaryShard(input.cid, summaryShardIdOf(input.now)),
      repo.listStandings(input.cid),
      repo.listEntriesForCrest(input.cid),
      readStaff(repo, input),
    ]);
    return { competition, phase, divisions: [], crests, summary, standings, staff };
  }
  const [standings, crests, staff] = await Promise.all([
    repo.listStandings(input.cid),
    repo.listEntriesForCrest(input.cid),
    readStaff(repo, input),
  ]);
  return { competition, phase, divisions: [], crests, summary: [], standings, staff };
}

/** 賽程分頁的「全部賽程」與已結束展開。摘要片最多 CP_READ_LIMIT.summary。取消原因在條目的 cr，不另讀場次。 */
export async function loadFullSchedule(repo: CompetitionsRepo, cid: string): Promise<SummaryEntry[]> {
  return repo.listSummary(cid);
}
