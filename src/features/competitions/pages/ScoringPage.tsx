// 正式記分頁。預覽記分板不變；這裡只接工作階段、權限與空狀態。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { canHostOrCo, isCpAdmin } from '../access';
import { resolveHostAccess } from '../data/host-access';
import type { StaffRole } from '../data/types';
import { getCompetitionsRepo } from '../data/cp-repo';
import { scoreAccess } from '../live/access';
import { LIVE_COPY } from '../live/copy';
import { ScorePad } from '../live/ScorePad';
import { scorePadPropsFrom } from '../live/scoring-adapter';
import { useScoring, type ScoringDeps } from '../live/useScoring';
import { LiveBoundary } from '../live';
import { loadRepClubs } from '../rep-clubs';
import { useCompetitionsT } from '../i18n';
import { CpCard, CpFrame, CpI18nPending, InfoIcon, LockIcon } from '../ui/shell';
import '../live/score-fullscreen.css';

/** 記分頁全幅：掛載時 <html> 加 cp-score-full 隱藏 App 頂欄、底部導覽、角標（見 score-fullscreen.css），卸載時恢復。 */
export const SCORE_FULLSCREEN_CLASS = 'cp-score-full';

export function useScoreFullscreen(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(SCORE_FULLSCREEN_CLASS);
    return () => {
      root.classList.remove(SCORE_FULLSCREEN_CLASS);
    };
  }, []);
}

/** 畫面上拿掉標題列之後，分頁標題仍是「記分」。 */
function useScoreDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (!title) return undefined;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/**
 * 俱樂部賽事的目前代表（沒有主辦 staff 文件）。代表清單走 session 快取；
 * 有代表俱樂部才讀賽事主文件（+1 讀）。只在沒有本場指派、staff 也不是主辦時才問。
 */
export async function scoringClubRep(cid: string, uid: string): Promise<boolean> {
  const clubs = await loadRepClubs(uid);
  const access = await resolveHostAccess({
    repo: getCompetitionsRepo(),
    cid,
    staffRoles: [],
    repClubIds: clubs.map((club) => club.id),
    isAdmin: false,
  });
  return access.clubRep;
}

/**
 * 「回賽程」與「離開記分」共用的去處（顧問 §3.506）。賽程頁、賽程管理只給主辦用（canHostOrCo），
 * 純記分員或裁判去自己的場次（my-matches），未登入回公開賽事頁。只用頁面已有的資料，不多讀。
 * 主辦判斷沿用 access.ts canHostOrCo：管理員、staff host／coHost；俱樂部目前代表由頁面已算好的 clubRep 帶入
 * （與 host-access.ts resolveHostAccess 同一拆法，代表身分要讀賽事主文件，這裡不另讀）。
 * roles 為 null＝讀取失敗、還不知道 staff：非管理員一律回公開賽事頁（人人可看，不會撞到「只有主辦可以做這個操作」）。
 */
export function scoringExitPath(cid: string, who: {
  signedIn: boolean;
  isAdmin: boolean;
  roles: readonly string[] | null;
  clubRep: boolean;
}): string {
  if (!who.signedIn) return `/competitions/${cid}`;
  const staffRoles = (who.roles ?? []).filter((role): role is StaffRole => role === 'host' || role === 'coHost');
  const host = who.clubRep || canHostOrCo({
    staffRoles,
    hostType: 'personal',
    hostTeamId: null,
    repClubIds: [],
    isAdmin: who.isAdmin,
  });
  if (host) return `/competitions/${cid}/matches`;
  if (who.roles == null) return `/competitions/${cid}`;
  return `/competitions/${cid}/my-matches`;
}

/** 回去鈕的字跟著去處走（顧問 §3.508）：去自己的場次寫「回我的場次」，去賽程管理或賽事頁照舊「回賽程」。 */
export function scoringBackLabel(path: string): string {
  return path.endsWith('/my-matches') ? LIVE_COPY.backToMyMatches : LIVE_COPY.backToSchedule;
}

export function ScoringScreen({
  cid,
  mtId,
  deps,
  nowMs,
  clubRepCheck,
  isAdmin = false,
  endedCheck,
}: {
  cid: string;
  mtId: string;
  deps?: ScoringDeps;
  nowMs?: number;
  /** 沒有本場指派時用來判斷是不是俱樂部目前代表（顯示「先指派自己」提示）。省略＝不判斷。 */
  clubRepCheck?: () => Promise<boolean>;
  /** 站台管理員（actor.role）。只用來決定「回賽程」「離開記分」的去處，不影響能不能記分。 */
  isAdmin?: boolean;
  /** 賽事是否已結束（記分盤點 S1：結束後記完也確認不了，不給記分板）。省略＝不判斷；讀取失敗當作沒結束。 */
  endedCheck?: () => Promise<boolean>;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = cpDict.ct;
  const { route } = useLocation();
  const view = useScoring(cid, mtId, deps);
  const now = nowMs ?? Date.now();
  const [clubRep, setClubRep] = useState(false);
  const [ended, setEnded] = useState<boolean | null>(endedCheck ? null : false);
  useEffect(() => {
    if (!endedCheck) return undefined;
    let alive = true;
    setEnded(null);
    void endedCheck().then((value) => { if (alive) setEnded(value); }, () => { if (alive) setEnded(false); });
    return () => {
      alive = false;
    };
    // 換場次重問一次。結束後本機未送的紀錄也送不出去：後端結束後本來就確認不了。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, mtId]);
  const staffAccess = view.loading || view.loadError ? null : scoreAccess({
    roles: view.staff.roles,
    matchIds: view.staff.matchIds,
    expiresAt: view.staff.expiresAt,
    mtId,
    nowMs: now,
  });
  const askRep = !!clubRepCheck && staffAccess != null && !staffAccess.pad && !staffAccess.hint;
  useEffect(() => {
    if (!askRep || !clubRepCheck) return undefined;
    let alive = true;
    void (async () => {
      try {
        const ok = await clubRepCheck();
        if (alive) setClubRep(ok);
      } catch {
        // 判斷失敗只是不顯示提示。
      }
    })();
    return () => {
      alive = false;
    };
    // 只在需要判斷時問一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askRep]);
  useScoreDocumentTitle(ct ? ct('scoreTitle') : null);
  if (!ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  if (view.loading || ended === null) return <div class="cps-root"><PageSpinner /></div>;
  const exitPath = scoringExitPath(cid, {
    signedIn: true,
    isAdmin,
    roles: view.loadError ? null : view.staff.roles,
    clubRep,
  });
  const back = () => route(exitPath);
  const backLabel = scoringBackLabel(exitPath);
  // 進場丟錯是讀取失敗，不是沒有權限（G-06）。網路類會自動重試，兩種都可手動重試。
  if (view.loadError) {
    return (
      <CpFrame title={ct('scoreTitle')} onBack={back}>
        {/* 卡 2-6（施工-第2批 3.26）：第 1b 批「一句話＋回去的鈕」版面（.cps-gate）；兩顆等寬，回賽程在左、重試在右（順序記分小批已定）。 */}
        <CpCard class="cps-gate">
          <InfoIcon />
          <p class="cps-gate__text" data-score-load-error={view.loadError}>
            {view.loadError === 'network' ? LIVE_COPY.loadFailedAuto : LIVE_COPY.loadFailed}
          </p>
          <div class="cps-gate__btns">
            <Button variant="secondary" onClick={back}>{backLabel}</Button>
            <Button onClick={() => view.retry?.()}>{LIVE_COPY.retry}</Button>
          </div>
        </CpCard>
      </CpFrame>
    );
  }
  const access = scoreAccess({
    roles: view.staff.roles,
    matchIds: view.staff.matchIds,
    expiresAt: view.staff.expiresAt,
    mtId,
    nowMs: now,
    clubRep,
  });
  if (ended) {
    return (
      <CpFrame title={ct('scoreTitle')} onBack={back}>
        <CpCard class="cps-gate">
          <LockIcon />
          <p class="cps-gate__text">{ct('reason.COMPETITION_ENDED')}</p>
          <div class="cps-gate__btns">
            <Button onClick={back}>{backLabel}</Button>
          </div>
        </CpCard>
      </CpFrame>
    );
  }
  if (!access.pad) {
    return (
      <CpFrame title={ct('scoreTitle')} onBack={back}>
        {/* 卡 2-6：鎖頭＋一句話；主辦等多第二句（13px 次要色）；「回賽程」一顆實心青綠、不佔整列。 */}
        <CpCard class="cps-gate">
          <LockIcon />
          <p class="cps-gate__text">{LIVE_COPY.noScorePermission}</p>
          <p class="cps-note">{access.hint ? LIVE_COPY.assignScorerHint : LIVE_COPY.askHostToAssign}</p>
          <div class="cps-gate__btns">
            <Button onClick={back}>{backLabel}</Button>
          </div>
        </CpCard>
      </CpFrame>
    );
  }
  return (
    <FullscreenPad>
      <ScorePad
        {...scorePadPropsFrom(view, now)}
        onLeave={back}
      />
    </FullscreenPad>
  );
}

/**
 * 只有記分板真的出現時才全幅（顧問審 a7026243 P2-1）：未登入、無權限、載入中、錯誤時保留 App 外框，
 * 登入鈕等頂欄功能仍可用（取代「整個記分路由都全幅」）。
 */
function FullscreenPad({ children }: { children: JSX.Element }): JSX.Element {
  useScoreFullscreen();
  return children;
}

/** 未登入。匯出只給示範頁截圖用（u2-signed-out），正式路由照舊在 ScoringPage 裡用。 */
export function SignedOut({ cid }: { cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = cpDict.ct;
  const { route } = useLocation();
  useScoreDocumentTitle(ct ? ct('scoreTitle') : null);
  if (!ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const exitPath = scoringExitPath(cid, { signedIn: false, isAdmin: false, roles: null, clubRep: false });
  const back = () => route(exitPath);
  return (
    <CpFrame title={ct('scoreTitle')} onBack={back}>
      <CpCard class="cps-gate">
        <LockIcon />
        <p class="cps-gate__text">{LIVE_COPY.signInToScore}</p>
        <div class="cps-gate__btns">
          <Button onClick={back}>{scoringBackLabel(exitPath)}</Button>
        </div>
      </CpCard>
    </CpFrame>
  );
}

export default function ScoringPage(): JSX.Element {
  const routed = useRoute();
  const cid = routed.params?.cid ?? '';
  const mtId = routed.params?.mtId ?? '';
  return (
    <LiveBoundary loadClubs={false}>
      {(actor) => (
        actor.authPending ? (
          <div class="cps-root"><PageSpinner /></div>
        ) : !actor.uid ? (
          <SignedOut cid={cid} />
        ) : (
          <ScoringScreen
            cid={cid}
            mtId={mtId}
            deps={{ uid: actor.uid }}
            clubRepCheck={() => scoringClubRep(cid, actor.uid ?? '')}
            isAdmin={isCpAdmin(actor.role)}
            endedCheck={async () => (await getCompetitionsRepo().getCompetition(cid))?.endedAt != null}
          />
        )
      )}
    </LiveBoundary>
  );
}
