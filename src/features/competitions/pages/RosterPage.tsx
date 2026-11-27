// 代表看的名單。背號、顯示名、位置同一行。人數不足不能確認。鎖定後唯讀。
// 球員本人：自己那一列有「退出名單」（CP-PO-08）。公開名單沒有 uid，靠 cpMine 的 plIds 認出自己。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { useGoBack } from '@/core/back-guard';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { BottomSheet } from '@/ui/BottomSheet';
import { Input } from '@/ui/Input';
import { rosterPhaseOpen } from '../access';
import { liveCpActions } from '../actions';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { positionLabel } from '../format';
import { LiveBoundary } from '../live';
import { isClubMemberByKeys, loadClubMemberKeys, useClubMemberKeys } from '../club-member-keys';
import { nicknameShapeOk, rosterNameParts, rosterRoleOf } from '../data/names';
import { runFirstLoad } from '../data/first-load';
import type { EntryStatus, RosterPublicDoc } from '../data/types';
import { CpError, CpLoadFailed, errorOf, loadFailOf, reasonText, type CpLoadFail } from '../ui/feedback';
import { dangerConfirm } from '../ui/danger-confirm';
import { loadMyRosterProfile } from '../rep-clubs';
import { RosterNameTags } from '../ui/roster-name-tags';
import { CpCard, CpFrame, CpI18nPending, PencilIcon, TrashIcon } from '../ui/shell';
import { StatusTag } from '../ui/status-tag';
import { toast } from '@/ui/Toast';
import { TeamCrest } from '../ui/TeamCrest';

/** 我在這場賽事的名單列 id。讀不到（沒登入、沒文件、讀取失敗）就當空：只是不顯示退出鍵，名單照常顯示。 */
async function loadMyPlIds(env: CpInjectedEnv, cid: string): Promise<string[]> {
  const uid = env.actor.uid;
  if (!uid) return [];
  try {
    const mine = await env.repo.getMine(uid, cid);
    return mine?.plIds ?? [];
  } catch {
    return [];
  }
}

async function loadRoster(env: CpInjectedEnv, cid: string, enId: string): Promise<CpBundle> {
  const uid = env.actor.uid;
  const [competition, divisions, entries, roster, staff, myPlIds] = await Promise.all([
    env.repo.getCompetition(cid),
    env.repo.listDivisions(cid),
    env.repo.listEntries(cid),
    env.repo.listRoster(cid, enId),
    uid ? env.repo.getStaff(cid, uid) : Promise.resolve(null),
    loadMyPlIds(env, cid),
  ]);
  return { competition, divisions, entries, roster, privates: [], staff, myPlIds };
}

/** 照背號排，同號再比 id（與記分頁選人同一套；live/ 不能動，這裡另寫一份）。 */
function byNumber(a: RosterPublicDoc, b: RosterPublicDoc): number {
  return a.number - b.number || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 報隊狀態的字。新外觀卡 3-2：四種都是中性標籤（3.0.5），不再分色。 */
function entryStatusLabel(ct: CompetitionsT, status: EntryStatus): string {
  if (status === 'approved') return ct('approved');
  if (status === 'pending') return ct('pending');
  if (status === 'rejected') return ct('rejected');
  return ct('withdrawn');
}

function PlayerRow({
  player,
  canEdit,
  canLeave,
  canRename,
  busy,
  onRemove,
  onLeave,
  onRename,
}: {
  player: RosterPublicDoc;
  canEdit: boolean;
  /** 這一列是我自己，而且還能退出（rosterPhaseOpen：已發布、未下架、未結束、名單未鎖、首場前；與後端 leaveRoster 的 assertRosterPhase 一致）。 */
  canLeave: boolean;
  /** 這一列是我自己、成年、而且是新規則的列（有原始暱稱）才有筆；舊列、未成年、代填都沒有。 */
  canRename: boolean;
  busy: boolean;
  onRemove: () => void;
  onLeave: () => void;
  onRename: () => void;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const pos = positionLabel(player.position, player.positionText, {
    none: ct('positionNone'),
    GK: ct('positionGK'),
    DF: ct('positionDF'),
    MF: ct('positionMF'),
    FW: ct('positionFW'),
    custom: ct('positionCustom'),
  });
  return (
    <li class="cps-li cps-player" data-roster-row>
      <span class="cps-num">{player.number}</span>
      {/* 顧問 §3.471 X-02：20 字暱稱把這列撐出卡片。只在名單頁暱稱加 --fit：可縮、超過省略（單行列）。 */}
      {/* 外層沿用 --fit 讓位與省略；標籤放裡面，身分顏色才不會被 .cps-player__name 的字色蓋掉。 */}
      <span class="cps-player__name cps-player__name--fit"><RosterNameTags row={player} /></span>
      <span class="cps-player__pos">{pos}</span>
      {player.isMinor ? <StatusTag kind="neutral" label={ct('minor')} /> : null}
      {/* 自己那一列給「退出名單」（本人退出），代表移除別人仍是垃圾桶：兩者是不同動作，退出用字說清楚。
          紅字靠右、右緣對齊垃圾桶，不縮（flex:none，長暱稱由名字省略讓位）；
          用行內樣式是因為賽事樣式已到 check:cp-css 上限，不為一行版面調上限。 */}
      {canLeave ? (
        <>
          {canRename ? (
            <button type="button" class="cps-iconbtn cps-iconbtn--flat" style="flex:none;margin-left:auto" aria-label={ct('editNickname')} onClick={onRename}><PencilIcon /></button>
          ) : null}
          <Button variant="danger" size="sm" loading={busy} style={canRename ? 'flex:none;min-inline-size:0;padding-inline:12px;margin:0 -12px 0 0' : 'flex:none;min-inline-size:0;padding-inline:12px;margin:0 -12px 0 auto'} onClick={onLeave}>{ct('leaveRoster')}</Button>
        </>
      ) : canEdit ? (
        <button type="button" class="cps-iconbtn cps-iconbtn--flat" aria-label={ct('removePlayer', { name: rosterNameParts(player).main })} onClick={onRemove}>
          <TrashIcon />
        </button>
      ) : null}
    </li>
  );
}

function RosterView({ env, cid, enId }: { env: CpInjectedEnv; cid: string; enId: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  // 直接開名單頁時「<」退到賽事詳情，不跳出賽事。
  const back = useGoBack(`/competitions/${cid}`);
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [phase, setPhase] = useState<'loading' | 'ready' | CpLoadFail>(env.bundle ? 'ready' : 'loading');
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  // 改暱稱面板（B 版斜方標籤，站長 11-27）：按筆開，改完即時更新那列。
  const [renaming, setRenaming] = useState<RosterPublicDoc | null>(null);
  const [nickDraft, setNickDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const syncTried = useRef(false);
  const loadSeq = useRef(0);
  // 成員雙鍵（顧問 §3.846）：hook 要在提早 return 之前叫。
  const entryTeamId = bundle?.entries.find((row) => row.id === enId)?.teamId ?? '';
  const clubKeys = useClubMemberKeys(env.actor, entryTeamId, env.clubKeys);

  useEffect(() => {
    if (env.bundle) return;
    // 換帳號：新資料回來前先清掉上一個帳號的「我的名單列」，不讓退出鍵掛在別人的列上（L-43）
    setBundle((prev) => (prev?.myPlIds?.length ? { ...prev, myPlIds: [] } : prev));
    const seq = ++loadSeq.current;
    const run = runFirstLoad('roster', () => loadRoster(env, cid, enId), undefined, { authSettled: !env.actor.authPending });
    void run.promise.then((next) => {
      if (seq !== loadSeq.current) return;
      setBundle(next);
      setPhase(next.competition ? 'ready' : 'error');
    }).catch((err: unknown) => {
      if (seq === loadSeq.current) setPhase(loadFailOf(err));
    });
    return () => {
      run.cancel();
      loadSeq.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, enId, env.actor.uid, env.bundle]);

  // 名字補正（B 卡）：env 帶 myRosterProfile 且有自己那一列時補一次；失敗吞掉不影響名單顯示。
  useEffect(() => {
    if (syncTried.current) return;
    const fn = env.myRosterProfile;
    const uid = env.actor.uid;
    if (!fn || !uid) return;
    if (phase !== 'ready' || !bundle?.competition) return;
    syncTried.current = true;
    const nowMs = env.now ?? Date.now();
    if (!rosterPhaseOpen(bundle.competition, nowMs)) return;
    const mineIds = bundle.myPlIds ?? [];
    const mine = bundle.roster.find((p) => p.enId === enId && mineIds.includes(p.id) && !!p.originalName && !p.isMinor);
    if (!mine) return;
    const plId = mine.id;
    void (async () => {
      try {
        const p = await fn(uid);
        const wantSync = (mine.nameSource === 'profile' && !!p.lineDisplayName)
          || rosterRoleOf(p.role, p.stealth) !== rosterRoleOf(mine.role);
        if (!wantSync) return;
        const result = await env.actions.syncRosterName({ cid, plId });
        if (!result.changed) return;
        const next = await env.repo.listRoster(cid, enId);
        setBundle((prev) => prev ? { ...prev, roster: next } : prev);
      } catch {
        /* 補正失敗不影響名單顯示 */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, bundle, env, cid, enId]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  if (phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  const competition = bundle?.competition;
  const entry = bundle?.entries.find((row) => row.id === enId);
  const division = bundle?.divisions.find((row) => row.dvId === entry?.dvId);
  if (!competition || !entry || !division || phase === 'error' || phase === 'hidden') {
    return <CpLoadFailed title={ct('rosterTitle')} fail={phase === 'hidden' ? 'hidden' : 'error'} />;
  }

  const players = (bundle?.roster.filter((row) => row.enId === enId) ?? []).sort(byNumber);
  const now = env.now ?? Date.now();
  const locked = competition.rostersLockedAt != null;
  const isRep = env.actor.repClubs.some((club) => club.id === entry.teamId);
  // 代表（隊長、領隊）也能自己登錄：後端 joinRoster 認成員或代表（與 JoinRosterPage 的 isMember || isRep 一致）。
  // 只能代填自己的話那筆 uid 是 null，不受一人一隊限制、退出鍵也認不出自己（CP-PO-08）。
  // 成員改用雙鍵換算（顧問 §3.846）：換算中先不出「登錄名單」，換算完再出（不閃錯誤）；代表不必等換算。
  // !pending 目前是保險：換算中 hook 只回 [teamId] 且成員清單不含它，結果本來就是 false；防日後 hook 改成換算中回部分鍵（Opus 審）。
  const isMember = !clubKeys.pending && isClubMemberByKeys(env.actor.memberClubIds, entry.teamId, clubKeys.keys);
  const canSelfJoin = isRep || isMember;
  const min = division.rosterMin;
  const max = division.rosterMax;
  const short = players.length < min;
  // 對齊後端 entry.ts assertRosterPhase（已發布、沒下架、沒結束、名單沒鎖、首場前）。
  // 代表刪人（leaveRoster）後端不看報隊狀態；撤隊（withdrawEntry）要審核中或已核准。
  // 新增與登錄（addRosterByRep／joinRoster）也走 assertRosterPhase：延期、下架、結束時一併不顯示（DeepSeek 初審 P2）。
  const open = rosterPhaseOpen(competition, now);
  const activeEntry = entry.status === 'pending' || entry.status === 'approved';
  const canEdit = isRep && open;
  const canWithdraw = isRep && open && activeEntry;
  // 報隊狀態不加條件：flows.test 鎖住「代表任何狀態都有代填入口」（既有設計；後端被拒時回 ENTRY_STATE，另案回報）。
  const canAdd = isRep && open;
  const myPlIds = bundle?.myPlIds ?? [];
  const isMine = (player: RosterPublicDoc): boolean => myPlIds.includes(player.id);
  // 本人退出（leaveRoster）同樣走 assertRosterPhase：用 rosterPhaseOpen，延期、下架、結束時也不顯示（整合 po-host×CP-PO-08，顧問 §3.852）。
  const canLeave = open;
  // 改暱稱：自己那一列、成年、而且是新規則的列（有原始暱稱）才有筆；舊列、未成年、代填都沒有。
  const canRename = (player: RosterPublicDoc): boolean => canLeave && isMine(player) && !player.isMinor && !!player.originalName;
  const inThisRoster = players.some(isMine);
  const teamName = entry.name;
  const canJoin = canSelfJoin && !inThisRoster && open && activeEntry;

  async function remove(player: RosterPublicDoc, self = false): Promise<void> {
    if (busy) return;
    const ok = self
      ? await dangerConfirm(ct('leaveRosterConfirm', { team: teamName }), { okText: ct('leave'), danger: true })
      : await dangerConfirm(ct('removePlayerConfirm', { name: rosterNameParts(player).main }), { okText: ct('remove'), danger: true });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.leaveRoster({ cid, plId: player.id });
      setBundle((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          roster: prev.roster.filter((row) => row.id !== player.id),
          myPlIds: (prev.myPlIds ?? []).filter((plId) => plId !== player.id),
          entries: prev.entries.map((row) => (
            row.id === enId
              ? { ...row, rosterConfirmed: false, rosterCount: Math.max(0, row.rosterCount - 1) }
              : row
          )),
        };
      });
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(): Promise<void> {
    if (busy || !entry) return;
    const ok = await dangerConfirm(ct('withdrawEntryConfirm', { name: entry.name }), {
      okText: ct('withdrawEntry'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.withdrawEntry({ cid, enId });
      toast.show({ message: ct('withdrawDone'), tone: 'success' });
      // 後端已把這隊改成已退出、名單清空：回賽事詳情（取代這筆，返回不會回到已撤回的名單）。
      route(`/competitions/${cid}`, true);
    } catch (err) {
      setError(errorOf(err));
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (busy || short || locked) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.confirmRoster({ cid, enId });
      setBundle((prev) => prev ? {
        ...prev,
        entries: prev.entries.map((row) => row.id === enId ? { ...row, rosterConfirmed: true } : row),
      } : prev);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveNickname(): Promise<void> {
    if (renameBusy || !renaming) return;
    const trimmed = nickDraft.trim();
    if (trimmed && !nicknameShapeOk(trimmed)) {
      setRenameError(ct('nicknameShape'));
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    const targetId = renaming.id;
    try {
      const result = await env.actions.updateRosterNickname({ cid, plId: targetId, nickname: trimmed || null });
      setBundle((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          roster: prev.roster.map((row) => row.id === targetId
            ? { ...row, nickname: trimmed && trimmed !== row.originalName ? trimmed : null, displayName: result.displayName }
            : row),
        };
      });
      setRenaming(null);
    } catch (err) {
      const e = errorOf(err);
      setRenameError(reasonText(ct, e.reason, e.params));
    } finally {
      setRenameBusy(false);
    }
  }

  return (
    <CpFrame title={ct('rosterTitle')} context={competition.name} onBack={back}>
      {/* 新外觀卡 3-2：隊伍卡順序改成 隊徽＋隊名 → 兩顆標籤 → 人數 → 進度條 → 說明句（標記順序＝讀螢幕順序） */}
      <CpCard>
        <div class="cp3-roster-head">
          {/* ASSUMPTION: 名單這頁的 listEntries 已經帶 teamLogo，不再多打一筆 listEntriesForCrest。 */}
          <TeamCrest teamId={entry.teamId} name={entry.name} teamLogo={entry.teamLogo} size={48} />
          <div class="cp3-roster-head__t">
            <h2 class="cps-title">{entry.name}</h2>
            <p class="cps-sub">{division.name}　{ct('formatN', { n: division.playersOnField })}</p>
          </div>
        </div>
        <div class="cps-badges cp3-roster-tags">
          <StatusTag kind="neutral" label={entryStatusLabel(ct, entry.status)} />
          {locked
            ? <StatusTag kind="neutral" label={ct('rosterLockedTag')} />
            : <StatusTag kind="neutral" label={entry.rosterConfirmed ? ct('rosterConfirmed') : ct('rosterUnconfirmed')} />}
        </div>
        <div class="cps-kv cp3-roster-count">
          <span>{ct('currentCount')}</span>
          {/* 顧問巡視：下面「還需 N 人」那句已寫最少人數時，這一行不重複 */}
          <span>{!locked && short ? ct('rosterCountShort', { n: players.length, max }) : ct('rosterCount', { n: players.length, max, min })}</span>
        </div>
        <div class="cps-bar cp3-roster-bar" aria-hidden="true">
          <i class={short ? 'low' : ''} style={`width:${Math.min(100, (players.length / max) * 100)}%`} />
        </div>
        {!locked && short ? <p class="cps-note cps-warn cp3-roster-note">{ct('needMore', { n: min - players.length, min })}</p> : null}
        {locked ? <p class="cps-note cp3-roster-note">{ct('rosterLocked')}</p> : null}
        {error ? <CpError reason={error.reason} params={error.params} /> : null}
      </CpCard>
      <CpCard class="cp3-roster-list">
        <div class="cp3-roster-list__h">
          <h2 class="cps-h">{ct('players')}</h2>
          {canAdd ? (
            <Button variant="secondary" size="sm" onClick={() => route(`/competitions/${cid}/entries/${enId}/add`)}>{ct('addPlayer')}</Button>
          ) : null}
        </div>
        <ul class="cps-list">
          {players.map((player) => (
            <PlayerRow
              key={player.id}
              player={player}
              canEdit={canEdit}
              canLeave={canLeave && isMine(player)}
              canRename={canRename(player)}
              busy={busy}
              onRemove={() => { void remove(player); }}
              onLeave={() => { void remove(player, true); }}
              onRename={() => { setRenaming(player); setNickDraft(player.nickname ?? ''); setRenameError(null); }}
            />
          ))}
        </ul>
      </CpCard>
      {canAdd ? (
        <div class="cps-actions cp3-roster-act">
          <Button variant={entry.rosterConfirmed ? 'secondary' : 'primary'} disabled={short || entry.status !== 'approved'} onClick={() => { void confirm(); }}>{ct('confirmRoster')}</Button>
        </div>
      ) : null}
      {canJoin ? (
        <div class="cps-actions cp3-roster-act">
          {/* 代表這頁的主要動作是確認名單；自己登錄放次要鈕，不讓兩顆主要鈕疊在一起。一般成員仍是主要鈕。 */}
          <Button variant={canAdd ? 'secondary' : 'primary'} onClick={() => route(`/competitions/${cid}/entries/${enId}/join`)}>{ct('joinAction')}</Button>
        </div>
      ) : null}
      {/* 撤回報名：沿用刪除賽事的危險區外觀（置中、上面一條細線），放在最後。 */}
      {canWithdraw ? (
        <div class="cps-del-zone">
          <Button variant="danger" disabled={busy} onClick={() => { void withdraw(); }}>{ct('withdrawEntry')}</Button>
        </div>
      ) : null}
      {renaming ? (
        <BottomSheet
          open
          title={ct('editNickname')}
          busy={renameBusy}
          onClose={() => setRenaming(null)}
          footer={(
            <div class="cps-actions">
              <Button variant="secondary" onClick={() => setRenaming(null)}>{ct('cancel')}</Button>
              <Button variant="primary" loading={renameBusy} onClick={() => { void saveNickname(); }}>{ct('save')}</Button>
            </div>
          )}
        >
          <div class="cps-fields">
            <Input
              label={ct('nickname')}
              value={nickDraft}
              placeholder={renaming.originalName ?? ''}
              maxLength={20}
              error={renameError ?? undefined}
              onValueChange={(v) => { setNickDraft(v); setRenameError(null); }}
            />
            <div class="cps-sub cpn-preview">
              {ct('publicShown')}
              <RosterNameTags row={{
                displayName: renaming.originalName ?? '',
                originalName: renaming.originalName ?? null,
                nickname: nickDraft.trim() || null,
                role: renaming.role ?? null,
              }} />
            </div>
          </div>
        </BottomSheet>
      ) : null}
    </CpFrame>
  );
}

export default function RosterPage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  const enId = injected?.route?.enId ?? routed.params?.enId ?? '';
  if (injected) return <RosterView env={injected} cid={cid} enId={enId} />;
  return (
    <LiveBoundary>
      {(actor, repo) => (
        <RosterView env={{ actor, repo, actions: liveCpActions, route: { cid, enId }, clubKeys: loadClubMemberKeys, myRosterProfile: loadMyRosterProfile }} cid={cid} enId={enId} />
      )}
    </LiveBoundary>
  );
}
