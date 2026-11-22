// 賽事頁「站內賽事」。整區先過開賽閘門；沒過就不渲染，也不留空標題。
// 清單是公開、cpMine、代表俱樂部主辦的聯集（含草稿），以 cid 去重。
// 「只看我的」打開時只留 cpMine 與代表俱樂部主辦，不再另畫「我的賽事」區塊。
// 俱樂部主辦清單是另一段：等代表俱樂部到齊才補讀 listByHostTeam 再合併。
// launch、tester、listMine、listPublic 不因 repKey、分類、階段篩選變動重讀。
// 進行中、而且此刻畫在畫面上的卡，各讀一次當日摘要片（getSummaryShard，不監聽）。
// 同 cid 同日的成功結果留在這頁的記憶體；失敗不留，卡片再出現才重讀。
// 不讀積分榜、隊徽、摘要全集。已結束卡不顯示冠軍。
// 每張都是記分板卡（站長 11-22）：進行中卡的摘要沒回來前，卡片預留那一列的高度，不等摘要才換版面。
// ASSUMPTION: 沒有名稱的項目不顯示 id。單筆讀取失敗略過，不讓整區消失。
// ASSUMPTION: 有名稱的 cpMine 不再讀賽事文件。
// ASSUMPTION: 同一場賽事公開清單與我的清單都有時，以公開文件為準
// （公開文件是最新根文件，我的索引名稱可能過期）。
// 正式頁等閘門通過才查代表俱樂部；沒過時 teams 一筆都不讀。
// 本機清單快照（data/list-snapshot.ts，顧問 §3.553）：閘門通過後、清單讀回前先畫上次的清單（只在閘門允許顯示站內時才讀）；
// 讀回（公開清單成功）就整份換成伺服器結果，快照裡已下架、已刪除的卡在這一次就消失；公開清單讀取失敗時保留快照畫面、不寫。
// 快照畫面不讀當日摘要、不放記分板（進行中的卡不寫「今天 N 場／下一場」），讀回後才照常讀摘要片。
// 寫入只用這次讀回的清單，登入狀態確定且就是畫面使用者才寫（守門同活動列表）。

import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { getLastKnownAuthUid } from '@/data/auth';
import { on } from '@/core/events';
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
import {
  canReadCpListSnapshot,
  canWriteCpListSnapshot,
  dropCpListSnapshot,
  dropForeignCpListSnapshot,
  readCpListSnapshot,
  writeCpListSnapshot,
  type CpListScope,
  type CpListSnapshot,
} from '../data/list-snapshot';
import type { CpActor, CpListSnapshotPorts } from '../env';
import { useInjectedEnv } from '../env';
import { LiveBoundary } from '../live';
import { representativeClubs } from '../rep-clubs';
import { InAppCardList } from './InAppCardList';
import { liveCpActions, type CpActions } from '../actions';
import { DeleteDialog, teamCountOf } from '../ui/delete-competition';
import { dangerConfirm } from '../ui/danger-confirm';
import { toast } from '@/ui/Toast';
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
  /**
   * 閘門結果。正式頁用來決定要不要畫來源切換，也用來決定要不要查代表俱樂部。
   * reason='denied'：伺服器明確判定看不到（不含讀取失敗）。賽事頁只在這時清「上次有過」的本機線索。
   */
  onGate?: (open: boolean, reason?: CpGateReason) => void;
  /** 閘門通過後清單也讀好、即將畫卡時通知一次。賽事頁用來把站內骨架留到卡片出現，中間不空白。 */
  onReady?: () => void;
}

export type CpGateReason = 'denied';

/** 正式頁的快照守門：登入模組確認的帳號。 */
const LIVE_SNAPSHOT: CpListSnapshotPorts = { confirmedUid: () => getLastKnownAuthUid() };
const NO_TODAY: ReadonlyMap<string, TodayMatches> = new Map();

function SectionBody({
  actor,
  repo,
  actions,
  now,
  tab,
  active,
  onGate,
  onReady,
  snapshot,
}: {
  actor: CpActor;
  repo: CompetitionsRepo;
  actions: CpActions;
  now: number;
  tab: InAppTab;
  active: boolean;
  onGate?: (open: boolean, reason?: CpGateReason) => void;
  onReady?: () => void;
  /** null：不讀不寫本機清單快照（注入環境沒開）。 */
  snapshot: CpListSnapshotPorts | null;
}): JSX.Element | null {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [phase, setPhase] = useState<'loading' | 'hidden' | 'ready'>('loading');
  const [baseMine, setBaseMine] = useState<MineListRow[]>([]);
  const [hosted, setHosted] = useState<CompetitionDoc[]>([]);
  const [publicDocs, setPublicDocs] = useState<CompetitionDoc[]>([]);
  const [status, setStatus] = useState<InAppStatusFilter>('all');
  // 清單卡刪除鈕（站長 11-22）：第一次確認通過後要刪的那場，打開第二次確認（勾選＋0.6 秒）。
  const [del, setDel] = useState<{ cid: string; name: string } | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [todayByCid, setTodayByCid] = useState<ReadonlyMap<string, TodayMatches>>(() => new Map());
  // null＝閘門還沒通過，不要為了俱樂部主辦去讀。
  const [hostQuery, setHostQuery] = useState<{ publicOnly: boolean } | null>(null);
  // 同 cid 同日只讀一次。失敗的 promise 會從這裡拿掉。不監聽。
  const shardCache = useRef(new Map<string, Promise<TodayMatches | null>>());
  // 讀回前先畫的上次清單。讀回後、換帳號、閘門沒過都清成 null。
  const [snap, setSnap] = useState<CpListSnapshot | null>(null);
  const snapShown = useRef(false);
  // 目前畫面上的伺服器清單是替誰、哪個範圍讀的，公開清單有沒有讀成功。寫快照只看這份。
  const fresh = useRef<{ uid: string | null; scope: CpListScope; publicOk: boolean; mineOk: boolean } | null>(null);
  // 登入狀態確定時重試寫快照（清單比登入確認早回來時）。
  const [authTick, setAuthTick] = useState(0);
  // 換帳號的第一個畫面就要藏起上一個人的清單，不能等 effect。
  const appliedUid = useRef(actor.uid);
  const uidStale = appliedUid.current !== actor.uid;
  const onGateRef = useRef(onGate);
  onGateRef.current = onGate;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
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
      setStatus('all');
      setDel(null);
      setOnlyMine(false);
      setTodayByCid(new Map());
      shardCache.current.clear();
      setSnap(null);
      snapShown.current = false;
      fresh.current = null;
    }
    void (async () => {
      const launch = await repo.getLaunch();
      const isPublic = launch ? launch.isPublic : null;
      const isAdmin = isCpAdmin(actor.role);
      // 登入者尚未定案、或已登入但角色還沒讀到（暫用最小 viewer 的 'user'），又不是已公開：
      // 先不要判成「看不到」，也不要開始查俱樂部。角色讀到後 effect 依 role／rolePending 重跑
      // （11-20 Opus 審 P2-1：管理員角色晚到時先被判 denied，清掉賽事頁線索又跳回外部）。
      if ((actor.authPending || actor.rolePending) && !isAdmin && isPublic !== true) return;
      let isTester = false;
      if (isPublic === false && actor.uid && !isAdmin) {
        isTester = await repo.getLaunchTester(actor.uid);
      }
      if (!canSeeInAppSection({ isPublic, isTester, isAdmin })) {
        if (!alive) return;
        onGateRef.current?.(false, 'denied');
        setHostQuery(null);
        setSnap(null);
        snapShown.current = false;
        // 伺服器明確判定看不到：這位使用者的快照以後也用不到，刪掉（審查 P3）。
        if (snapshot) dropCpListSnapshot(actor.uid);
        setPhase('hidden');
        return;
      }
      // 閘門過了才准查代表俱樂部。這段本身不讀 listByHostTeam。
      // unmount 之後不得再通知外層去查俱樂部。
      if (!alive) return;
      onGateRef.current?.(true);
      const scope: CpListScope = isTester || isAdmin ? 'internal' : 'public';
      // 閘門通過、伺服器清單還沒畫過：先畫本機快照（帳號與範圍都要相符）。
      if (snapshot && !fresh.current) {
        const confirmed = snapshot.confirmedUid();
        dropForeignCpListSnapshot(confirmed);
        const stored = canReadCpListSnapshot(actor.uid, confirmed) ? readCpListSnapshot(actor.uid, scope) : null;
        if (stored) {
          snapShown.current = true;
          setSnap(stored);
          onReadyRef.current?.();
        }
      }
      let publicOk = true;
      let mineOk = true;
      const [items, listed] = await Promise.all([
        actor.uid
          ? repo.listMine(actor.uid).catch(() => {
            mineOk = false;
            return [] as CpMineItem[];
          })
          : Promise.resolve([] as CpMineItem[]),
        repo.listPublic(isTester || isAdmin).catch(() => {
          publicOk = false;
          return [] as CompetitionDoc[];
        }),
      ]);
      const namedMine = await Promise.all(items.map((item) => resolveMine(repo, item)));
      if (!alive) return;
      // 公開清單讀取失敗而畫面上是快照：保留快照（不把清單換成空的），也不寫。
      if (!publicOk && snapShown.current) return;
      fresh.current = { uid: actor.uid, scope, publicOk, mineOk };
      snapShown.current = false;
      setSnap(null);
      setBaseMine(dedupeMine(namedMine));
      setPublicDocs(listed.filter((doc) => doc.name));
      setHostQuery({ publicOnly: !isTester && !isAdmin });
      setPhase('ready');
      onReadyRef.current?.();
    })().catch(() => {
      if (!alive) return;
      onGateRef.current?.(false);
      setHostQuery(null);
      setSnap(null);
      snapShown.current = false;
      setPhase('hidden');
    });
    return () => {
      alive = false;
    };
    // onGate 走 ref。repKey 不在這裡，避免俱樂部到了就重讀。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.authPending, actor.rolePending, actor.role, actor.uid, repo]);

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

  // 伺服器清單讀回後寫快照（之後主辦清單到了再寫一次）。只用伺服器結果，不拿快照回寫。
  useEffect(() => {
    if (!snapshot || phase !== 'ready') return;
    const meta = fresh.current;
    // 公開清單或我的清單有一份讀取失敗：不拿這半份清單蓋掉快照。
    if (!meta || !meta.publicOk || !meta.mineOk || meta.uid !== actor.uid) return;
    if (!canWriteCpListSnapshot(actor.uid, snapshot.confirmedUid())) return;
    writeCpListSnapshot(actor.uid, meta.scope, { publicDocs, hosted, mine: baseMine });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, publicDocs, hosted, baseMine, authTick, snapshot]);
  useEffect(() => (snapshot ? on('auth:changed', () => setAuthTick((value) => value + 1)) : undefined), [snapshot]);

  const showingSnap = phase === 'loading' && snap !== null;
  // 快照畫面不帶當日摘要（顧問條件 6）：進行中的卡沒有重點句，記分板等讀回後的摘要結果。
  const cards = useMemo(
    () => (showingSnap && snap
      ? assembleInAppCards({ ...snap, now, todayByCid: NO_TODAY })
      : assembleInAppCards({ publicDocs, hosted, mine: baseMine, now, todayByCid })),
    [showingSnap, snap, publicDocs, hosted, baseMine, now, todayByCid],
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
        // 失敗留空（卡片預留的那一列維持空白）。快取已清，這張卡再出現時才重讀。
      });
    }
    return () => {
      alive = false;
    };
  }, [liveKey, now, repo]);

  if (uidStale || (phase !== 'ready' && !showingSnap)) return null;
  if (!active) return null;
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const showCreate = !!actor.uid && !actor.authPending;
  // 刪除鈕只給管理員以上（站長 11-22）；後端 deleteCompetition 對管理員一律放行（delete-access.ts）。快照畫面不給。
  const canDelete = !!actor.uid && !actor.authPending && !actor.rolePending && isCpAdmin(actor.role) && !showingSnap;
  const findDoc = (cid: string): CompetitionDoc | undefined =>
    publicDocs.find((doc) => doc.id === cid) ?? hosted.find((doc) => doc.id === cid)
    ?? baseMine.find((row) => row.cid === cid)?.doc ?? undefined;
  const onDelete = async (cid: string, name: string): Promise<void> => {
    // 第一次確認：寫出賽事名稱；通過才打開第二次確認框。
    const ok = await dangerConfirm(ct('deleteAsk', { name }), { okText: ct('deleteComp'), danger: true });
    if (ok) setDel({ cid, name });
  };
  const dropDoc = (cid: string): void => {
    setPublicDocs((list) => list.filter((doc) => doc.id !== cid));
    setHosted((list) => list.filter((doc) => doc.id !== cid));
    setBaseMine((list) => list.filter((row) => row.cid !== cid));
  };

  return (
    <>
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
        event.stopPropagation(); // 不讓 preact-iso LocationProvider 的全域連結攔截再推一筆歷史（11-20 預演：返回要按兩次）。
        route(`/competitions/${cid}`);
      }}
      onDelete={canDelete ? (cid, name) => void onDelete(cid, name) : undefined}
    />
    {/* 換帳號或權限變了不再顯示（審查 P2-2） */}
    {del && canDelete ? (
      <DeleteDialog
        ct={ct}
        cid={del.cid}
        name={del.name}
        teams={null}
        loadTeams={async () => teamCountOf(await repo.listDivisions(del.cid))}
        resume={findDoc(del.cid)?.deletingAt != null}
        actions={actions}
        reload={() => repo.getCompetition(del.cid)}
        onClose={() => setDel(null)}
        onDeleted={() => {
          const cid = del.cid;
          setDel(null);
          toast.show({ message: ct('deleteDone') });
          repo.invalidateCrests(cid);
          dropDoc(cid);
        }}
        onStuck={(doc) => {
          // 刪到一半：換上新文件，確認框留著顯示錯誤；再按一次刪除即續刪。
          setPublicDocs((list) => list.map((item) => (item.id === doc.id ? doc : item)));
          setHosted((list) => list.map((item) => (item.id === doc.id ? doc : item)));
          setBaseMine((list) => list.map((row) => (row.cid === doc.id && row.doc ? { ...row, doc } : row)));
        }}
      />
    ) : null}
    </>
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
  const report = (open: boolean, reason?: CpGateReason): void => {
    setLoadClubs(open);
    props.onGate?.(open, reason);
  };
  return (
    <LiveBoundary loadClubs={!uidStale && loadClubs}>
      {(actor, repo) => (
        <SectionBody
          actor={actor}
          repo={repo}
          actions={liveCpActions}
          now={nowRef.current}
          tab={props.tab ?? 'all'}
          active={props.active !== false}
          onGate={report}
          onReady={props.onReady}
          snapshot={LIVE_SNAPSHOT}
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
        actions={injected.actions}
        now={injected.now ?? nowRef.current}
        tab={props.tab ?? 'all'}
        active={props.active !== false}
        onGate={props.onGate}
        onReady={props.onReady}
        snapshot={injected.listSnapshot ?? null}
      />
    );
  }
  return <LiveInApp {...props} />;
}
