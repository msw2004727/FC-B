// 賽事頁「站內賽事」。整區先過開賽閘門；沒過就不渲染，也不留空標題。
// 清單是公開、cpMine、代表俱樂部主辦的聯集（含草稿），以 cid 去重。
// 「只看我的」打開時只留 cpMine 與代表俱樂部主辦，不再另畫「我的賽事」區塊。
// 俱樂部主辦清單是另一段：等代表俱樂部到齊才補讀 listByHostTeam 再合併。
// launch、tester、listMine、listPublic 不因 repKey、分類、階段篩選變動重讀。
// 進行中、而且此刻畫在畫面上的卡，各讀一次當日摘要片（getSummaryShard，不監聽）。
// 同 cid 同日的成功結果留在這頁的記憶體；失敗不留，卡片再出現才重讀。
// 不讀積分榜、隊徽、摘要全集。已結束卡不顯示冠軍。
// ASSUMPTION: 沒有名稱的項目不顯示 id。單筆讀取失敗略過，不讓整區消失。
// ASSUMPTION: 有名稱的 cpMine 不再讀賽事文件。
// ASSUMPTION: 同一場賽事公開清單與我的清單都有時，以公開文件為準
// （公開文件是最新根文件，我的索引名稱可能過期）。
// 正式頁等閘門通過才查代表俱樂部；沒過時 teams 一筆都不讀。

import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useViewer } from '@/features/profile/data/viewer';
import { ctOrKey, useCompetitionsT } from '../i18n';
import { CpI18nPending } from '../ui/shell';
import { canSeeInAppSection, isCpAdmin } from '../access';
import type { CompetitionsRepo } from '../data/cp-repo';
import type { CompetitionDoc, CpMineItem } from '../data/types';
import { categoryOf } from '../data/present';
import { summaryShardIdOf } from '../data/schedule-load';
import {
  assembleInAppCards,
  filterInAppCards,
  todayFromShard,
  type InAppStatusFilter,
  type InAppTab,
  type MineListRow,
  type TodayMatches,
} from '../data/list-cards';
import type { CpActor } from '../env';
import { useInjectedEnv } from '../env';
import { LiveBoundary } from '../live';
import { representativeClubs } from '../rep-clubs';
import { InAppCardList } from './InAppCardList';
import '../competitions.css';

async function resolveMine(repo: CompetitionsRepo, item: CpMineItem): Promise<MineListRow | null> {
  const named = item.name?.trim();
  if (named) return { cid: item.cid, name: named, category: categoryOf(item), doc: null };
  try {
    const doc = await repo.getCompetition(item.cid);
    return doc?.name ? { cid: item.cid, name: doc.name, category: categoryOf(doc), doc } : null;
  } catch {
    return null;
  }
}

function dedupeMine(rows: ReadonlyArray<MineListRow | null>): MineListRow[] {
  const byId = new Map<string, MineListRow>();
  for (const row of rows) {
    if (row && !byId.has(row.cid)) byId.set(row.cid, row);
  }
  return [...byId.values()];
}

function hostedDocs(lists: ReadonlyArray<readonly CompetitionDoc[]>): CompetitionDoc[] {
  const rows: CompetitionDoc[] = [];
  for (const list of lists) {
    for (const doc of list) {
      if (!doc.name || rows.some((row) => row.id === doc.id)) continue;
      rows.push(doc);
    }
  }
  return rows;
}

export interface InAppSectionProps {
  /** 與外部賽事共用的分類頁籤。 */
  tab?: InAppTab;
  /** false：資料照留，不畫卡（正在看外部賽事）。 */
  active?: boolean;
  /** 閘門結果。正式頁用來決定要不要畫來源切換，也用來決定要不要查代表俱樂部。 */
  onGate?: (open: boolean) => void;
}

function SectionBody({
  actor,
  repo,
  now,
  tab,
  active,
  onGate,
}: {
  actor: CpActor;
  repo: CompetitionsRepo;
  now: number;
  tab: InAppTab;
  active: boolean;
  onGate?: (open: boolean) => void;
}): JSX.Element | null {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [phase, setPhase] = useState<'loading' | 'hidden' | 'ready'>('loading');
  const [baseMine, setBaseMine] = useState<MineListRow[]>([]);
  const [hosted, setHosted] = useState<CompetitionDoc[]>([]);
  const [publicDocs, setPublicDocs] = useState<CompetitionDoc[]>([]);
  const [status, setStatus] = useState<InAppStatusFilter>('open');
  const [onlyMine, setOnlyMine] = useState(false);
  const [todayByCid, setTodayByCid] = useState<ReadonlyMap<string, TodayMatches>>(() => new Map());
  // null＝閘門還沒通過，不要為了俱樂部主辦去讀。
  const [hostQuery, setHostQuery] = useState<{ publicOnly: boolean } | null>(null);
  // 同 cid 同日只讀一次。失敗的 promise 會從這裡拿掉。不監聽。
  const shardCache = useRef(new Map<string, Promise<TodayMatches | null>>());
  // 換帳號的第一個畫面就要藏起上一個人的清單，不能等 effect。
  const appliedUid = useRef(actor.uid);
  const uidStale = appliedUid.current !== actor.uid;
  const onGateRef = useRef(onGate);
  onGateRef.current = onGate;
  const repKey = representativeClubs(actor).map((club) => club.id).join('\n');

  useEffect(() => {
    let alive = true;
    if (appliedUid.current !== actor.uid) {
      appliedUid.current = actor.uid;
      setPhase('loading');
      setBaseMine([]);
      setHosted([]);
      setPublicDocs([]);
      setHostQuery(null);
      setStatus('open');
      setOnlyMine(false);
      setTodayByCid(new Map());
      shardCache.current.clear();
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
        onGateRef.current?.(false);
        setHostQuery(null);
        setPhase('hidden');
        return;
      }
      // 閘門過了才准查代表俱樂部。這段本身不讀 listByHostTeam。
      // unmount 之後不得再通知外層去查俱樂部。
      if (!alive) return;
      onGateRef.current?.(true);
      const [items, listed] = await Promise.all([
        actor.uid ? repo.listMine(actor.uid).catch(() => [] as CpMineItem[]) : Promise.resolve([] as CpMineItem[]),
        repo.listPublic(isTester || isAdmin).catch(() => [] as CompetitionDoc[]),
      ]);
      const namedMine = await Promise.all(items.map((item) => resolveMine(repo, item)));
      if (!alive) return;
      setBaseMine(dedupeMine(namedMine));
      setPublicDocs(listed.filter((doc) => doc.name));
      setHostQuery({ publicOnly: !isTester && !isAdmin });
      setPhase('ready');
    })().catch(() => {
      if (!alive) return;
      onGateRef.current?.(false);
      setHostQuery(null);
      setPhase('hidden');
    });
    return () => {
      alive = false;
    };
    // onGate 走 ref。repKey 不在這裡，避免俱樂部到了就重讀。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.authPending, actor.role, actor.uid, repo]);

  useEffect(() => {
    if (!hostQuery) return;
    const clubs = representativeClubs(actor);
    if (clubs.length === 0) {
      setHosted([]);
      return;
    }
    let alive = true;
    const publicOnly = hostQuery.publicOnly;
    void Promise.all(clubs.map((club) => repo.listByHostTeam(club.id, publicOnly).catch(() => [] as CompetitionDoc[])))
      .then((lists) => {
        if (alive) setHosted(hostedDocs(lists));
      })
      .catch(() => {
        if (alive) setHosted([]);
      });
    return () => {
      alive = false;
    };
    // repKey 變了才補讀俱樂部主辦。launch／listMine／listPublic 不在這個 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostQuery, repKey, repo]);

  const cards = useMemo(
    () => assembleInAppCards({ publicDocs, hosted, mine: baseMine, now, todayByCid }),
    [publicDocs, hosted, baseMine, now, todayByCid],
  );
  const visible = useMemo(
    () => filterInAppCards(cards, tab, status, onlyMine),
    [cards, tab, status, onlyMine],
  );
  // 空字串＝現在沒有畫在畫面上的進行中卡（含來源切到外部、字典未到）。
  const liveKey = !uidStale && phase === 'ready' && active && cpDict.ct
    ? visible.filter((card) => card.phase === 'live').map((card) => card.cid).join('\n')
    : '';

  useEffect(() => {
    if (!liveKey) return;
    const shardId = summaryShardIdOf(now);
    const cids = liveKey.split('\n');
    let alive = true;
    for (const cid of cids) {
      const key = `${cid}\n${shardId}`;
      let pending = shardCache.current.get(key);
      if (!pending) {
        // 單次 get。失敗拿掉快取，不在這裡重試迴圈。
        pending = Promise.resolve()
          .then(() => repo.getSummaryShard(cid, shardId))
          .then((entries) => todayFromShard(entries, now))
          .catch((error: unknown) => {
            shardCache.current.delete(key);
            throw error;
          });
        shardCache.current.set(key, pending);
      }
      void pending.then((today) => {
        if (!alive) return;
        setTodayByCid((prev) => {
          if (!today) {
            if (!prev.has(cid)) return prev;
            const next = new Map(prev);
            next.delete(cid);
            return next;
          }
          const old = prev.get(cid);
          if (old && old.count === today.count && old.time === today.time) return prev;
          const next = new Map(prev);
          next.set(cid, today);
          return next;
        });
      }).catch(() => {
        // 失敗留空。快取已清，這張卡再出現時才重讀。
      });
    }
    return () => {
      alive = false;
    };
  }, [liveKey, now, repo]);

  if (uidStale || phase !== 'ready') return null;
  if (!active) return null;
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const showCreate = !!actor.uid && !actor.authPending;

  return (
    <InAppCardList
      cards={visible}
      ct={ct}
      status={status}
      onlyMine={onlyMine}
      showCreate={showCreate}
      onStatus={setStatus}
      onOnlyMine={setOnlyMine}
      onCreate={() => route('/competitions/new')}
      onOpen={(cid, event) => {
        event.preventDefault();
        route(`/competitions/${cid}`);
      }}
    />
  );
}

function LiveInApp(props: InAppSectionProps): JSX.Element {
  const viewer = useViewer();
  const [loadClubs, setLoadClubs] = useState(false);
  const clubsUid = useRef(viewer.uid);
  const uidStale = clubsUid.current !== viewer.uid;
  // ASSUMPTION: 階段用進頁當下的時間。清單不每分鐘重算。注入環境改走 injected.now。
  const nowRef = useRef(Date.now());
  useEffect(() => {
    if (clubsUid.current === viewer.uid) return;
    clubsUid.current = viewer.uid;
    setLoadClubs(false);
  }, [viewer.uid]);
  const report = (open: boolean): void => {
    setLoadClubs(open);
    props.onGate?.(open);
  };
  return (
    <LiveBoundary loadClubs={!uidStale && loadClubs}>
      {(actor, repo) => (
        <SectionBody
          actor={actor}
          repo={repo}
          now={nowRef.current}
          tab={props.tab ?? 'all'}
          active={props.active !== false}
          onGate={report}
        />
      )}
    </LiveBoundary>
  );
}

export function InAppSection(props: InAppSectionProps): JSX.Element | null {
  const injected = useInjectedEnv();
  const nowRef = useRef(Date.now());
  if (injected) {
    return (
      <SectionBody
        actor={injected.actor}
        repo={injected.repo}
        now={injected.now ?? nowRef.current}
        tab={props.tab ?? 'all'}
        active={props.active !== false}
        onGate={props.onGate}
      />
    );
  }
  return <LiveInApp {...props} />;
}
