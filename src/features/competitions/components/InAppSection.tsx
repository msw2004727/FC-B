// 賽事頁「站內賽事」。整區先過開賽閘門；沒過就不渲染，也不留空標題。
// 我的賽事＝cpMine 加上各代表俱樂部主辦的賽事（含草稿），以 cid 去重。
// ASSUMPTION: 公開清單不重複列出已在「我的賽事」的 cid。沒有名稱的項目不顯示 id。
// 單筆讀取失敗略過，不讓整區消失。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useT } from '@/i18n/i18n';
import { Button } from '@/ui/Button';
import { canSeeInAppSection, isCpAdmin } from '../access';
import type { CompetitionsRepo } from '../data/cp-repo';
import type { CompetitionDoc, CpMineItem } from '../data/types';
import type { CpActor } from '../env';
import { useInjectedEnv } from '../env';
import { LiveBoundary } from '../live';
import { representativeClubs } from '../rep-clubs';
import '../competitions.css';

interface NamedComp {
  cid: string;
  name: string;
}

async function nameOfMine(repo: CompetitionsRepo, item: CpMineItem): Promise<NamedComp | null> {
  const named = item.name?.trim();
  if (named) return { cid: item.cid, name: named };
  try {
    const doc = await repo.getCompetition(item.cid);
    return doc?.name ? { cid: item.cid, name: doc.name } : null;
  } catch {
    return null;
  }
}

function mergeMine(
  fromMine: ReadonlyArray<NamedComp | null>,
  hosted: ReadonlyArray<readonly CompetitionDoc[]>,
): NamedComp[] {
  const byId = new Map<string, NamedComp>();
  for (const row of fromMine) {
    if (row && !byId.has(row.cid)) byId.set(row.cid, row);
  }
  for (const list of hosted) {
    for (const doc of list) {
      if (!doc.name || byId.has(doc.id)) continue;
      byId.set(doc.id, { cid: doc.id, name: doc.name });
    }
  }
  return [...byId.values()];
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
  const repKey = representativeClubs(actor).map((club) => club.id).join('\n');

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
      const clubs = representativeClubs(actor);
      const publicOnly = !isTester && !isAdmin;
      const [items, hosted, listed] = await Promise.all([
        actor.uid ? repo.listMine(actor.uid).catch(() => [] as CpMineItem[]) : Promise.resolve([] as CpMineItem[]),
        Promise.all(clubs.map((club) => repo.listByHostTeam(club.id, publicOnly).catch(() => [] as CompetitionDoc[]))),
        repo.listPublic(isTester || isAdmin).catch(() => [] as CompetitionDoc[]),
      ]);
      const namedMine = await Promise.all(items.map((item) => nameOfMine(repo, item)));
      const merged = mergeMine(namedMine, hosted);
      const mineIds = new Set(merged.map((item) => item.cid));
      const pub = listed
        .filter((doc) => !mineIds.has(doc.id) && doc.name)
        .map((doc) => ({ cid: doc.id, name: doc.name }));
      if (!alive) return;
      setMine(merged);
      setPublicRows(pub);
      setPhase('ready');
    })().catch(() => {
      if (alive) setPhase('hidden');
    });
    return () => {
      alive = false;
    };
    // repKey 代表俱樂部 id。物件本身每輪可能是新的，不放進依賴。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.authPending, actor.role, actor.uid, repo, repKey]);

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
