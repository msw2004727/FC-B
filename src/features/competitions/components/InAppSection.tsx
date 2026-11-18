// 賽事頁「站內賽事」。整區先過開賽閘門；沒過就不渲染，也不留空標題。
// 我的賽事＝cpMine 加上各代表俱樂部主辦的賽事（含草稿），以 cid 去重。
// 俱樂部主辦清單是另一段：等代表俱樂部到齊才補讀 listByHostTeam 再合併。
// launch、tester、listMine、listPublic 不因 repKey 變動重讀。
// ASSUMPTION: 公開清單不重複列出已在「我的賽事」的 cid。沒有名稱的項目不顯示 id。
// 單筆讀取失敗略過，不讓整區消失。
// 正式頁等閘門通過才查代表俱樂部；沒過時 teams 一筆都不讀。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useViewer } from '@/features/profile/data/viewer';
import { ctOrKey, useCompetitionsT } from '../i18n';
import { CpI18nPending } from '../ui/shell';
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

function dedupeNamed(rows: ReadonlyArray<NamedComp | null>): NamedComp[] {
  const byId = new Map<string, NamedComp>();
  for (const row of rows) {
    if (row && !byId.has(row.cid)) byId.set(row.cid, row);
  }
  return [...byId.values()];
}

function hostedRows(lists: ReadonlyArray<readonly CompetitionDoc[]>): NamedComp[] {
  const rows: NamedComp[] = [];
  for (const list of lists) {
    for (const doc of list) {
      if (!doc.name || rows.some((row) => row.cid === doc.id)) continue;
      rows.push({ cid: doc.id, name: doc.name });
    }
  }
  return rows;
}

function SectionBody({
  actor,
  repo,
  onGate,
}: {
  actor: CpActor;
  repo: CompetitionsRepo;
  /** 正式頁用來決定要不要查代表俱樂部。注入環境不傳。 */
  onGate?: (open: boolean) => void;
}): JSX.Element | null {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [phase, setPhase] = useState<'loading' | 'hidden' | 'ready'>('loading');
  const [baseMine, setBaseMine] = useState<NamedComp[]>([]);
  const [hostedMine, setHostedMine] = useState<NamedComp[]>([]);
  const [publicSource, setPublicSource] = useState<NamedComp[]>([]);
  // null＝閘門還沒通過，不要為了俱樂部主辦去讀。
  const [hostQuery, setHostQuery] = useState<{ publicOnly: boolean } | null>(null);
  // 換帳號的第一個畫面就要藏起上一個人的清單，不能等 effect。
  const appliedUid = useRef(actor.uid);
  const uidStale = appliedUid.current !== actor.uid;
  const repKey = representativeClubs(actor).map((club) => club.id).join('\n');
  const mine = dedupeNamed([...baseMine, ...hostedMine]);
  const publicRows = publicSource.filter((row) => !mine.some((item) => item.cid === row.cid));

  useEffect(() => {
    let alive = true;
    if (appliedUid.current !== actor.uid) {
      appliedUid.current = actor.uid;
      setPhase('loading');
      setBaseMine([]);
      setHostedMine([]);
      setPublicSource([]);
      setHostQuery(null);
    }
    void (async () => {
      const launch = await repo.getLaunch();
      const isPublic = launch ? launch.isPublic : null;
      const isAdmin = isCpAdmin(actor.role);
      // 登入者尚未定案、又不是已公開：先不要判成「看不到」，也不要開始查俱樂部。
      if (actor.authPending && !isAdmin && isPublic !== true) return;
      let isTester = false;
      if (isPublic === false && actor.uid && !isAdmin) {
        isTester = await repo.getLaunchTester(actor.uid);
      }
      if (!canSeeInAppSection({ isPublic, isTester, isAdmin })) {
        if (!alive) return;
        onGate?.(false);
        setHostQuery(null);
        setPhase('hidden');
        return;
      }
      // 閘門過了才准查代表俱樂部。這段本身不讀 listByHostTeam。
      // unmount 之後不得再通知外層去查俱樂部。
      if (!alive) return;
      onGate?.(true);
      const [items, listed] = await Promise.all([
        actor.uid ? repo.listMine(actor.uid).catch(() => [] as CpMineItem[]) : Promise.resolve([] as CpMineItem[]),
        repo.listPublic(isTester || isAdmin).catch(() => [] as CompetitionDoc[]),
      ]);
      const namedMine = await Promise.all(items.map((item) => nameOfMine(repo, item)));
      const pub = listed
        .filter((doc) => doc.name)
        .map((doc) => ({ cid: doc.id, name: doc.name }));
      if (!alive) return;
      setBaseMine(dedupeNamed(namedMine));
      setPublicSource(pub);
      setHostQuery({ publicOnly: !isTester && !isAdmin });
      setPhase('ready');
    })().catch(() => {
      if (!alive) return;
      onGate?.(false);
      setHostQuery(null);
      setPhase('hidden');
    });
    return () => {
      alive = false;
    };
    // onGate 在正式頁是 useState setter，身分穩定。repKey 不在這裡，避免俱樂部到了就重讀。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.authPending, actor.role, actor.uid, repo]);

  useEffect(() => {
    if (!hostQuery) return;
    const clubs = representativeClubs(actor);
    if (clubs.length === 0) {
      setHostedMine([]);
      return;
    }
    let alive = true;
    const publicOnly = hostQuery.publicOnly;
    void Promise.all(clubs.map((club) => repo.listByHostTeam(club.id, publicOnly).catch(() => [] as CompetitionDoc[])))
      .then((lists) => {
        if (alive) setHostedMine(hostedRows(lists));
      })
      .catch(() => {
        if (alive) setHostedMine([]);
      });
    return () => {
      alive = false;
    };
    // repKey 變了才補讀俱樂部主辦。launch／listMine／listPublic 不在這個 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostQuery, repKey, repo]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  if (uidStale || phase !== 'ready') return null;
  const showCreate = !!actor.uid && !actor.authPending;

  function open(path: string, event: JSX.TargetedMouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    route(path);
  }

  return (
    <section class="cps-inapp" data-inapp="competitions">
      <h3 class="cps-h">{ct('inApp')}</h3>
      {showCreate ? (
        <div class="cps-actions" style="margin-top:8px">
          <Button variant="primary" onClick={() => route('/competitions/new')}>{ct('createAction')}</Button>
        </div>
      ) : null}
      {mine.length > 0 ? (
        <div style="margin-top:12px">
          <h4 class="cps-sub cps-nowrap">{ct('mine')}</h4>
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
          <h4 class="cps-sub cps-nowrap">{ct('publicList')}</h4>
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

function LiveInApp(): JSX.Element {
  const viewer = useViewer();
  const [loadClubs, setLoadClubs] = useState(false);
  const clubsUid = useRef(viewer.uid);
  const uidStale = clubsUid.current !== viewer.uid;
  useEffect(() => {
    if (clubsUid.current === viewer.uid) return;
    clubsUid.current = viewer.uid;
    setLoadClubs(false);
  }, [viewer.uid]);
  return (
    <LiveBoundary loadClubs={!uidStale && loadClubs}>
      {(actor, repo) => <SectionBody actor={actor} repo={repo} onGate={setLoadClubs} />}
    </LiveBoundary>
  );
}

export function InAppSection(): JSX.Element | null {
  const injected = useInjectedEnv();
  if (injected) return <SectionBody actor={injected.actor} repo={injected.repo} />;
  return <LiveInApp />;
}
