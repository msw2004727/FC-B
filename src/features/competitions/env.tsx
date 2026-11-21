// 測試與 harness 用這個 context 注入假資料。有注入時不呼叫 useViewer、不連線。
// 正式頁沒有注入，改掛 LiveBoundary（各自的頁面裡）。

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { CpActions } from './actions';
import type { CpClub } from './access';
import type { AudiencePorts } from './data/audience';
import type { CompetitionsRepo } from './data/cp-repo';
import type { UploadedCover } from './data/cover-upload';
import type {
  CompetitionCategory,
  CompetitionCover,
  CompetitionDoc,
  DivisionDoc,
  EntryDoc,
  EntryPrivateDoc,
  RosterPublicDoc,
  StaffDoc,
  MatchDoc,
  StandingDoc,
  SummaryEntry,
} from './data/types';
import type { DivisionDraft, VenueDraft } from './payload';

export interface CpActor {
  uid: string | null;
  authPending: boolean;
  /**
   * true＝已登入但角色還沒確定（users 文件還沒讀到、完整 viewer 也還沒到），role 暫時是最小 viewer 的 'user'。
   * users 文件讀到就不再 pending，role 改用已確定的角色，不等球隊掃描（顧問 11-20）。省略＝已定案（測試與 harness）。
   */
  rolePending?: boolean;
  role: string;
  displayName: string | null;
  repClubs: readonly CpClub[];
  /**
   * true＝代表清單還在讀。空陣列這時不代表沒有俱樂部。
   * ASSUMPTION: 省略＝已定案（測試與 harness 的清單是同步的）。
   */
  repClubsPending?: boolean;
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
  /** 代填成年而且已經填了暱稱。 */
  repNick?: boolean;
  /** 主辦管理一開始顯示的分頁。鎖定／解鎖預覽仍強制已核准。 */
  manageTab?: 'pending' | 'approved' | 'rejected';
  /** 詳情頁管理員：首屏打開下架對話框。 */
  moderateOpen?: boolean;
  /** 詳情頁管理員：首屏展開檢舉紀錄。 */
  reportsOpen?: boolean;
  /** 詳情頁刪除確認框：首屏打開。ack＝已勾；armed 省略時照 0.6 秒計時；error＝顯示這個錯誤碼。 */
  deleteDialog?: { ack: boolean; armed?: boolean; error?: string };
}

export interface CpScheduleSnapshot {
  summary: SummaryEntry[];
  standings: StandingDoc[];
}

export interface WizardSeed {
  name: string;
  hostType: 'personal' | 'club';
  hostTeamId: string;
  feeNote: string;
  /** 公開聯絡文字。省略當空白。 */
  contactNote?: string;
  /** 省略＝聯賽。 */
  category?: CompetitionCategory;
  regOpen: string;
  regClose: string;
  firstMatch: string;
  lastMatch: string;
  venues: VenueDraft[];
  divisions: DivisionDraft[];
  /** 已上傳好的封面（預覽與測試用）。省略＝沒選。 */
  cover?: CompetitionCover | null;
}

export interface CpInjectedEnv {
  actor: CpActor;
  repo: CompetitionsRepo;
  actions: CpActions;
  /** 權限判斷用的現在。省略則用 Date.now()。 */
  now?: number;
  route?: { cid?: string; enId?: string; uid?: string; mtId?: string };
  /** 觀眾監聽與射手榜。省略且沒有 bundle 時，正式頁才連 Firestore。 */
  audience?: AudiencePorts;
  bundle?: CpBundle;
  /** 注入時詳情不打網路，賽程與積分榜用這份。省略當空。 */
  schedule?: CpScheduleSnapshot;
  /** 主辦賽程管理。有注入就不打 listMatches。 */
  matches?: readonly MatchDoc[];
  preview?: CpPreview;
  wizardSeed?: WizardSeed;
  /** 接受邀請頁與檢舉的登入。省略時用站內既有的 signIn（LINE 登入，回跳到目前網址）。 */
  signIn?: () => Promise<void>;
  /** 封面上傳（裁好的 data URL → 兩個下載網址）。省略時動態載入 data/cover-upload.ts 傳到 Storage；測試與 harness 換假的。 */
  coverUpload?: (dataUrl: string) => Promise<UploadedCover>;
}

const CpEnvContext = createContext<CpInjectedEnv | null>(null);

export function CpEnvProvider({ value, children }: { value: CpInjectedEnv; children: ComponentChildren }) {
  return <CpEnvContext.Provider value={value}>{children}</CpEnvContext.Provider>;
}

export function useInjectedEnv(): CpInjectedEnv | null {
  return useContext(CpEnvContext);
}
