// 賽事頁「站內賽事」。整區先過開賽閘門；沒過就不渲染，也不留空標題。
// ASSUMPTION: 公開清單不重複列出已在「我的賽事」的 cid。沒有名稱的項目不顯示 id。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useT } from '@/i18n/i18n';
import { Button } from '@/ui/Button';
import { canSeeInAppSection, isCpAdmin } from '../access';
import type { CompetitionsRepo } from '../data/cp-repo';
import type { CpActor } from '../env';
import { useInjectedEnv } from '../env';
import { LiveBoundary } from '../live';
import '../competitions.css';

interface NamedComp {
  cid: string;
  name: string;
}

function SectionBody({
  actor,
  repo,
}: {
  actor: CpActor;
  repo: CompetitionsRepo;
}): JSX.Element | null {
  const t = useT();
  const { route } = useLocation();
  const [phase, setPhase] = useState<'loading' | 'hidden' | 'ready'>('loading');
  const [mine, setMine] = useState<NamedComp[]>([]);
  const [publicRows, setPublicRows] = useState<NamedComp[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const launch = await repo.getLaunch();
      const isPublic = launch ? launch.isPublic : null;
      const isAdmin = isCpAdmin(actor.role);
      // 登入者尚未定案、又不是已公開：先不要判成「看不到」。
      if (actor.authPending && !isAdmin && isPublic !== true) return;
      let isTester = false;
      if (isPublic === false && actor.uid && !isAdmin) {
        isTester = await repo.getLaunchTester(actor.uid);
      }
      if (!canSeeInAppSection({ isPublic, isTester, isAdmin })) {
        if (alive) setPhase('hidden');
        return;
      }
      const items = actor.uid ? await repo.listMine(actor.uid) : [];
      const mineIds = new Set(items.map((item) => item.cid));
      const named: NamedComp[] = [];
      for (const item of items) {
        const doc = await repo.getCompetition(item.cid);
        if (doc?.name) named.push({ cid: item.cid, name: doc.name });
      }
      const listed = await repo.listPublic();
      const pub = listed
        .filter((doc) => !mineIds.has(doc.id) && doc.name)
        .map((doc) => ({ cid: doc.id, name: doc.name }));
      if (!alive) return;
      setMine(named);
      setPublicRows(pub);
      setPhase('ready');
    })().catch(() => {
      if (alive) setPhase('hidden');
    });
    return () => {
      alive = false;
    };
  }, [actor.authPending, actor.role, actor.uid, repo]);

  if (phase !== 'ready') return null;
  const showCreate = !!actor.uid && !actor.authPending;

  function open(path: string, event: JSX.TargetedMouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    route(path);
  }

  return (
    <section class="cps-inapp" data-inapp="competitions">
      <h3 class="cps-h">{t('competitions.inApp')}</h3>
      {showCreate ? (
        <div class="cps-actions" style="margin-top:8px">
          <Button variant="primary" onClick={() => route('/competitions/new')}>{t('competitions.createAction')}</Button>
        </div>
      ) : null}
      {mine.length > 0 ? (
        <div style="margin-top:12px">
          <h4 class="cps-sub cps-nowrap">{t('competitions.mine')}</h4>
          <ul class="cps-list">
            {mine.map((item) => (
              <li class="cps-li" key={item.cid}>
                <a class="cps-li__name cps-link" href={`/competitions/${item.cid}`} onClick={(event) => open(`/competitions/${item.cid}`, event)}>
                  {item.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {publicRows.length > 0 ? (
        <div style="margin-top:12px">
          <h4 class="cps-sub cps-nowrap">{t('competitions.publicList')}</h4>
          <ul class="cps-list">
            {publicRows.map((item) => (
              <li class="cps-li" key={item.cid}>
                <a class="cps-li__name cps-link" href={`/competitions/${item.cid}`} onClick={(event) => open(`/competitions/${item.cid}`, event)}>
                  {item.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function InAppSection(): JSX.Element | null {
  const injected = useInjectedEnv();
  if (injected) return <SectionBody actor={injected.actor} repo={injected.repo} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <SectionBody actor={actor} repo={repo} />}
    </LiveBoundary>
  );
}
