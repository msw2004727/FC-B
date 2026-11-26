// 第 3 步詳情首屏。CompetitionDetailPage 用這支，不讀 matches 全集，也不讀摘要全集。
// 招募：賽事根、組別、隊徽。已登入另讀職員。不讀摘要、積分。
// 預熱：賽事根、組別、隊徽、首場那天一片摘要。已登入另讀職員。不讀積分、摘要全集。
// 進行中：賽事根、當日一片摘要、積分、隊徽。已登入另讀職員。不讀組別、摘要全集。
// 已結束：賽事根、積分、隊徽。已登入另讀職員。摘要留到展開（loadFullSchedule）。
// 沒有 uid 不讀職員，staff 是 null。三個階段都一樣。
// withAssignment：已登入時把職員那 1 筆換成合併讀（同一份 staff/{uid}），多帶 assignment，讀數不變（CP-DETAIL-SPEED d1）。
// 內部期多的 3 筆是 getLaunch、getLaunchTester、listMine，而且觀看者已登入。
// 沒有 uid 時測試員與我的賽事不讀，只多開賽設定那 1 筆。
// 賽事文件不存在就停，不再讀子集合。

import type { CompetitionsRepo } from './cp-repo';
import { matchDayOf } from './match-day';
import { competitionPhase, type CompetitionPhase } from './present';
import type {
  CompetitionDoc,
  DivisionDoc,
  EntryDoc,
  StaffAssignment,
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
  /** 已登入時職員改用 getStaffWithAssignment，結果多帶 assignment。讀數不變。 */
  withAssignment?: boolean;
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
  /** 只有 withAssignment、有 uid、讀到賽事根時才有這個欄位（沒有文件是 null）。沒有這個欄位＝沒讀。 */
  assignment?: StaffAssignment | null;
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

/** 摘要片 id：比賽日 dYYYYMMDD。台北 00:00～04:59 歸前一天，與後端 K5 相同。 */
export function summaryShardIdOf(now: number): string {
  return matchDayOf(now).shardId;
}

async function readInternal(repo: CompetitionsRepo, input: ScheduleDetailInput): Promise<void> {
  if (!input.internal) return;
  await repo.getLaunch();
  if (input.uid) {
    await repo.getLaunchTester(input.uid);
    await repo.listMine(input.uid);
  }
}

type MineSlot = Pick<ScheduleDetail, 'assignment'>;

/** 沒有 uid 不讀。有 uid 才是 1 筆：getStaff，或 withAssignment 時合併讀（指派寫進 mine）。 */
async function readStaff(repo: CompetitionsRepo, input: ScheduleDetailInput, mine: MineSlot): Promise<StaffDoc | null> {
  if (!input.uid) return null;
  if (!input.withAssignment) return repo.getStaff(input.cid, input.uid);
  const both = await repo.getStaffWithAssignment(input.cid, input.uid);
  mine.assignment = both.assignment;
  return both.staff;
}

export async function loadScheduleDetail(
  repo: CompetitionsRepo,
  input: ScheduleDetailInput,
): Promise<ScheduleDetail> {
  await readInternal(repo, input);
  const competition = await repo.getCompetition(input.cid);
  if (!competition) return emptyDetail();
  const phase = competitionPhase(competition, input.now);
  const mine: MineSlot = {};
  if (phase === 'recruit') {
    const [divisions, crests, staff] = await Promise.all([
      repo.listDivisions(input.cid),
      repo.listEntriesForCrest(input.cid),
      readStaff(repo, input, mine),
    ]);
    return { competition, phase, divisions, crests, summary: [], standings: [], staff, ...mine };
  }
  if (phase === 'warm') {
    const [divisions, crests, staff, summary] = await Promise.all([
      repo.listDivisions(input.cid),
      repo.listEntriesForCrest(input.cid),
      readStaff(repo, input, mine),
      repo.getSummaryShard(input.cid, summaryShardIdOf(competition.firstMatchAt)),
    ]);
    return { competition, phase, divisions, crests, summary, standings: [], staff, ...mine };
  }
  if (phase === 'live') {
    const [summary, standings, crests, staff] = await Promise.all([
      repo.getSummaryShard(input.cid, summaryShardIdOf(input.now)),
      repo.listStandings(input.cid),
      repo.listEntriesForCrest(input.cid),
      readStaff(repo, input, mine),
    ]);
    return { competition, phase, divisions: [], crests, summary, standings, staff, ...mine };
  }
  const [standings, crests, staff] = await Promise.all([
    repo.listStandings(input.cid),
    repo.listEntriesForCrest(input.cid),
    readStaff(repo, input, mine),
  ]);
  return { competition, phase, divisions: [], crests, summary: [], standings, staff, ...mine };
}

/** 賽程分頁的「全部賽程」與已結束展開。摘要片最多 CP_READ_LIMIT.summary。取消原因在條目的 cr，不另讀場次。 */
export async function loadFullSchedule(repo: CompetitionsRepo, cid: string): Promise<SummaryEntry[]> {
  return repo.listSummary(cid);
}
