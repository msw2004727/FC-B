// 測試與 harness 用這個 context 注入假資料。有注入時不呼叫 useViewer、不連線。
// 正式頁沒有注入，改掛 LiveBoundary（各自的頁面裡）。

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { CpActions } from './actions';
import type { CpClub } from './access';
import type { CompetitionsRepo } from './data/cp-repo';
import type {
  CompetitionDoc,
  DivisionDoc,
  EntryDoc,
  EntryPrivateDoc,
  RosterPublicDoc,
  StaffDoc,
} from './data/types';
import type { DivisionDraft, VenueDraft } from './payload';

export interface CpActor {
  uid: string | null;
  authPending: boolean;
  role: string;
  displayName: string | null;
  repClubs: readonly CpClub[];
  managedClubs: readonly CpClub[];
  /** 我所屬的俱樂部 id（含代表）。用來決定看不看得到「登錄名單」。 */
  memberClubIds: readonly string[];
}

export interface CpBundle {
  competition: CompetitionDoc | null;
  divisions: DivisionDoc[];
  entries: EntryDoc[];
  roster: RosterPublicDoc[];
  privates: EntryPrivateDoc[];
  staff: StaffDoc | null;
}

/** harness 要首屏就有內容（截圖不等非同步）。正式頁不帶。 */
export interface CpPreview {
  menuOpen?: boolean;
  reportOpen?: boolean;
  rejectOpen?: boolean;
  lockDialog?: boolean;
  unlockOpen?: boolean;
  /** 建賽精靈起點。 */
  wizardStep?: 1 | 2 | 3 | 'done';
  wizardClub?: boolean;
  wizardError?: boolean;
  /** 登錄表單預填，對齊已同意的預覽。 */
  prefillForm?: boolean;
  selfMinor?: boolean;
  repAdult?: boolean;
  /** 主辦管理一開始顯示的分頁。鎖定／解鎖預覽仍強制已核准。 */
  manageTab?: 'pending' | 'approved' | 'rejected';
}

export interface WizardSeed {
  name: string;
  hostType: 'personal' | 'club';
  hostTeamId: string;
  feeNote: string;
  regOpen: string;
  regClose: string;
  firstMatch: string;
  lastMatch: string;
  venues: VenueDraft[];
  divisions: DivisionDraft[];
}

export interface CpInjectedEnv {
  actor: CpActor;
  repo: CompetitionsRepo;
  actions: CpActions;
  /** 權限判斷用的現在。省略則用 Date.now()。 */
  now?: number;
  route?: { cid?: string; enId?: string };
  bundle?: CpBundle;
  preview?: CpPreview;
  wizardSeed?: WizardSeed;
}

const CpEnvContext = createContext<CpInjectedEnv | null>(null);

export function CpEnvProvider({ value, children }: { value: CpInjectedEnv; children: ComponentChildren }) {
  return <CpEnvContext.Provider value={value}>{children}</CpEnvContext.Provider>;
}

export function useInjectedEnv(): CpInjectedEnv | null {
  return useContext(CpEnvContext);
}
