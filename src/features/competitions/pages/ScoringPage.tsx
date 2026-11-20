// 正式記分頁。預覽記分板不變；這裡只接工作階段、權限與空狀態。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { resolveHostAccess } from '../data/host-access';
import { getCompetitionsRepo } from '../data/cp-repo';
import { scoreAccess } from '../live/access';
import { LIVE_COPY } from '../live/copy';
import { ScorePad } from '../live/ScorePad';
import { scorePadPropsFrom } from '../live/scoring-adapter';
import { useScoring, type ScoringDeps } from '../live/useScoring';
import { LiveBoundary } from '../live';
import { loadRepClubs } from '../rep-clubs';
import { useCompetitionsT } from '../i18n';
import { CpCard, CpFrame, CpI18nPending } from '../ui/shell';
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

export function ScoringScreen({
  cid,
  mtId,
  deps,
  nowMs,
  clubRepCheck,
}: {
  cid: string;
  mtId: string;
  deps?: ScoringDeps;
  nowMs?: number;
  /** 沒有本場指派時用來判斷是不是俱樂部目前代表（顯示「先指派自己」提示）。省略＝不判斷。 */
  clubRepCheck?: () => Promise<boolean>;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = cpDict.ct;
  const { route } = useLocation();
  const view = useScoring(cid, mtId, deps);
  const now = nowMs ?? Date.now();
  const [clubRep, setClubRep] = useState(false);
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
  if (view.loading) return <div class="cps-root"><PageSpinner /></div>;
  const back = () => route(`/competitions/${cid}/schedule`);
  // 進場丟錯是讀取失敗，不是沒有權限（G-06）。網路類會自動重試，兩種都可手動重試。
  if (view.loadError) {
    return (
      <CpFrame title={ct('scoreTitle')} onBack={back}>
        <CpCard>
          <p class="cps-note" data-score-load-error={view.loadError}>
            {view.loadError === 'network' ? LIVE_COPY.loadFailedAuto : LIVE_COPY.loadFailed}
          </p>
          <div class="cps-actions">
            <Button onClick={() => view.retry?.()}>{LIVE_COPY.retry}</Button>
            <Button variant="secondary" onClick={back}>{LIVE_COPY.backToSchedule}</Button>
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
  if (!access.pad) {
    return (
      <CpFrame title={ct('scoreTitle')} onBack={back}>
        <CpCard>
          <p class="cps-note">{LIVE_COPY.noScorePermission}</p>
          {access.hint ? <p class="cps-note">{LIVE_COPY.assignScorerHint}</p> : null}
          <div class="cps-actions">
            <Button variant="secondary" onClick={back}>{LIVE_COPY.backToSchedule}</Button>
          </div>
        </CpCard>
      </CpFrame>
    );
  }
  return (
    <FullscreenPad>
      <ScorePad
        {...scorePadPropsFrom(view, now)}
        onLeave={() => route(`/competitions/${cid}/matches`)}
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

function SignedOut({ cid }: { cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = cpDict.ct;
  const { route } = useLocation();
  useScoreDocumentTitle(ct ? ct('scoreTitle') : null);
  if (!ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const back = () => route(`/competitions/${cid}/schedule`);
  return (
    <CpFrame title={ct('scoreTitle')} onBack={back}>
      <CpCard>
        <p class="cps-note">{LIVE_COPY.noScorePermission}</p>
        <div class="cps-actions">
          <Button variant="secondary" onClick={back}>{LIVE_COPY.backToSchedule}</Button>
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
          />
        )
      )}
    </LiveBoundary>
  );
}
