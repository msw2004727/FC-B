// 正式記分頁。預覽記分板不變；這裡只接工作階段、權限與空狀態。

import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { scoreAccess } from '../live/access';
import { LIVE_COPY } from '../live/copy';
import { ScorePad } from '../live/ScorePad';
import { scorePadPropsFrom } from '../live/scoring-adapter';
import { useScoring, type ScoringDeps } from '../live/useScoring';
import { LiveBoundary } from '../live';
import { useCompetitionsT } from '../i18n';
import { CpCard, CpFrame, CpI18nPending } from '../ui/shell';

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

export function ScoringScreen({
  cid,
  mtId,
  deps,
  nowMs,
}: {
  cid: string;
  mtId: string;
  deps?: ScoringDeps;
  nowMs?: number;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = cpDict.ct;
  const { route } = useLocation();
  const view = useScoring(cid, mtId, deps);
  const now = nowMs ?? Date.now();
  useScoreDocumentTitle(ct ? ct('scoreTitle') : null);
  if (!ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  if (view.loading) return <div class="cps-root"><PageSpinner /></div>;
  const access = scoreAccess({
    roles: view.staff.roles,
    matchIds: view.staff.matchIds,
    expiresAt: view.staff.expiresAt,
    mtId,
    nowMs: now,
  });
  const back = () => route(`/competitions/${cid}/schedule`);
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
    <ScorePad
      {...scorePadPropsFrom(view, now)}
      onLeave={() => route(`/competitions/${cid}/matches`)}
    />
  );
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
          <ScoringScreen cid={cid} mtId={mtId} deps={{ uid: actor.uid }} />
        )
      )}
    </LiveBoundary>
  );
}
