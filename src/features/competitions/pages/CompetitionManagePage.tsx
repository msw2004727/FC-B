// 主辦管理：待審／已核准／已拒絕。審核、繳費、鎖定只給主辦方或管理員。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { PageSpinner } from '@/ui/PageSpinner';
import { RadioGroup } from '@/ui/RadioGroup';
import { Switch } from '@/ui/Switch';
import { Tabs } from '@/ui/Tabs';
import { Textarea } from '@/ui/Textarea';
import { canEditCompetition, canHostOrCo, canManageCompetition, canUnlockRosters, isCpAdmin } from '../access';
import { contactNoteProblem } from '../data/flex-schedule';
import { clipCodePoints } from '../format';
import { liveCpActions } from '../actions';
import { representativeClubs } from '../rep-clubs';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { LiveBoundary } from '../live';
import { buildPaymentInput, buildReviewInput } from '../payload';
import { CP_READ_LIMIT, type CompetitionCategory, type DivisionDoc, type EntryDoc, type EntryPrivateDoc, type PaymentStatus } from '../data/types';
import { rememberCompName } from '../data/comp-name-hint';
import { splitCount } from '../data/host-board';
import { dangerConfirm } from '../ui/danger-confirm';
import { CpError, CpLoadFailed, errorOf, loadFailOf } from '../ui/feedback';
import { FeeLine } from '../ui/fields';
import { AlertIcon, CpCard, CpFrame, CpI18nPending, DownIcon, NextIcon } from '../ui/shell';
import { StatusTag } from '../ui/status-tag';
import { CoverField, type CoverShown } from '../ui/cover-field';
import { coverInput, shownCover } from '../data/cover';
import { toast } from '@/ui/Toast';

const INFO_TOGGLE_ID = 'cp-comp-info-toggle';
const INFO_PANEL_ID = 'cp-comp-info';

async function loadManage(env: CpInjectedEnv, cid: string): Promise<CpBundle> {
  const uid = env.actor.uid;
  const [competition, divisions, entries, staff] = await Promise.all([
    env.repo.getCompetition(cid),
    env.repo.listDivisions(cid),
    env.repo.listEntries(cid),
    uid ? env.repo.getStaff(cid, uid) : Promise.resolve(null),
  ]);
  const manage = competition ? canManageCompetition({
    staffRoles: staff?.roles ?? [],
    hostType: competition.hostType,
    hostTeamId: competition.hostTeamId,
    repClubIds: representativeClubs(env.actor).map((club) => club.id),
    isAdmin: isCpAdmin(env.actor.role),
  }) : false;
  const privates = manage ? await readPrivates(env, cid) : [];
  return { competition, divisions, entries, roster: [], privates, staff };
}

/**
 * 私有報名資料。前端的可管理判定與 Rules（俱樂部代表鏡像、token 角色）可能暫時不一致，
 * 這時被拒只當成沒有私有資料，不把讀得到的公開賽事當成不公開；不公開只看根文件那批讀取。
 */
async function readPrivates(env: CpInjectedEnv, cid: string): Promise<EntryPrivateDoc[]> {
  try {
    return await env.repo.listEntryPrivate(cid, null);
  } catch (err) {
    if (loadFailOf(err) === 'hidden') return [];
    throw err;
  }
}

function payLabel(ct: CompetitionsT, status: PaymentStatus): string {
  if (status === 'paid') return ct('paid');
  if (status === 'refunded') return ct('refunded');
  return ct('unpaid');
}

function privateOf(rows: readonly EntryPrivateDoc[], entry: EntryDoc): EntryPrivateDoc | null {
  return rows.find((row) => row.id === entry.id) ?? rows.find((row) => row.teamId === entry.teamId) ?? null;
}

function ManageView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [phase, setPhase] = useState(env.bundle ? 'ready' : 'loading');
  const [tab, setTab] = useState(() => {
    if (env.preview?.unlockOpen || env.preview?.lockDialog) return 'approved';
    return env.preview?.manageTab ?? 'pending';
  });
  const [rejectId, setRejectId] = useState<string | null>(env.preview?.rejectOpen ? 'pending' : null);
  const [rejectReason, setRejectReason] = useState('');
  const [unlockOpen, setUnlockOpen] = useState(env.preview?.unlockOpen === true);
  const [unlockReason, setUnlockReason] = useState('');
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [rejectError, setRejectError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [unlockError, setUnlockError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  // 聯絡文字儲存用 lock。只看 busy 的話，連點會在重繪前再送一次。
  const contactLock = useRef(false);
  const [category, setCategory] = useState<CompetitionCategory>(env.bundle?.competition?.category ?? 'league');
  const [contactDraft, setContactDraft] = useState(env.bundle?.competition?.contactNote ?? '');
  // 站長「畫面要簡潔」：賽事分類與聯絡文字預設收成一顆按鈕，點了才展開；聯絡文字儲存成功後收回。
  const [infoOpen, setInfoOpen] = useState(false);
  // 剛上傳的封面：本機預覽，網址相同時直接顯示，不再下載一次。
  const [coverLocal, setCoverLocal] = useState<CoverShown | null>(null);
  // 封面上傳／儲存中：面板不能收（收起來封面欄會卸載，上傳完就不會存、留孤兒圖）。ref 給 saveContact await 之後讀最新值。
  const [coverBusy, setCoverBusyState] = useState(false);
  const coverBusyRef = useRef(false);
  const infoFocus = useRef<string | null>(null);
  const now = env.now ?? Date.now();
  const repKey = representativeClubs(env.actor).map((club) => club.id).join('\n');

  useEffect(() => {
    const target = infoFocus.current;
    infoFocus.current = null;
    if (target) document.querySelector<HTMLElement>(target)?.focus();
  }, [infoOpen]);

  function setCoverBusy(next: boolean): void {
    coverBusyRef.current = next;
    setCoverBusyState(next);
  }

  function toggleInfo(next: boolean): void {
    if (!next && coverBusyRef.current) return;
    // 封面欄的選檔 input 是隱藏的，聚焦跳過它（照舊落在分類第一個選項）。
    infoFocus.current = next ? `#${INFO_PANEL_ID} input:not([hidden])` : `#${INFO_TOGGLE_ID}`;
    setInfoOpen(next);
  }

  useEffect(() => {
    if (env.bundle) return;
    let alive = true;
    void loadManage(env, cid).then((next) => {
      if (!alive) return;
      setBundle(next);
      setPhase(next.competition ? 'ready' : 'error');
    }).catch((err: unknown) => {
      if (alive) setPhase(loadFailOf(err));
    });
    return () => {
      alive = false;
    };
    // repClubs 晚到要補讀 entryPrivate，否則繳費、拒絕原因、聯絡人是空的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.actor.uid, env.actor.role, env.bundle, repKey]);

  const compName = bundle?.competition?.name;
  useEffect(() => {
    // 頁首賽事名小字：記下來給人員、指派頁用（不為名稱多讀）。
    if (compName) rememberCompName(cid, compName);
  }, [cid, compName]);

  useEffect(() => {
    const next = bundle?.competition?.category;
    if (next) setCategory(next);
  }, [bundle?.competition?.category]);

  useEffect(() => {
    setContactDraft(bundle?.competition?.contactNote ?? '');
  }, [bundle?.competition?.contactNote]);

  const competition = bundle?.competition;
  const hostInput = competition ? {
    staffRoles: bundle?.staff?.roles ?? [],
    hostType: competition.hostType,
    hostTeamId: competition.hostTeamId,
    repClubIds: representativeClubs(env.actor).map((club) => club.id),
    isAdmin: isCpAdmin(env.actor.role),
  } : null;
  const manage = hostInput ? canManageCompetition(hostInput) : false;
  // 俱樂部目前代表也算（後端 hostAccess）。
  const hostOps = hostInput ? canHostOrCo(hostInput) : false;
  const locked = competition?.rostersLockedAt != null;
  const entries = bundle?.entries ?? [];
  const pending = entries.filter((entry) => entry.status === 'pending');
  const approved = entries.filter((entry) => entry.status === 'approved');
  const rejected = entries.filter((entry) => entry.status === 'rejected');
  // 與名單頁一致：主辦鎖定名單後一律算已確認（只是標示，不改資料）。
  const unconfirmed = approved.filter((entry) => !entry.rosterConfirmed && !locked).length;
  // 全部已確認時不再寫「還有 0 隊尚未確認」。
  const lockKey = unconfirmed === 0 ? 'lockConfirmAll' : 'lockConfirm';

  useEffect(() => {
    if (!env.preview?.lockDialog || !cpDict.ct) return;
    void dangerConfirm(cpDict.ct(lockKey, { n: unconfirmed }), {
      okText: cpDict.ct('lock'),
      danger: true,
    });
    // 只為截圖把確認框打開，不在這裡鎖定。字典晚到時補開一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpDict.ct]);

  useEffect(() => {
    if (env.preview?.rejectOpen && rejectId === 'pending' && pending[0]) {
      setRejectId(pending[0].id);
      setTab('pending');
    }
  }, [env.preview?.rejectOpen, pending, rejectId]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  if (phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  if (!competition) {
    return <CpLoadFailed title={ct('manageTitle')} fail={phase === 'hidden' ? 'hidden' : 'error'} />;
  }

  const rejectEntry = entries.find((entry) => entry.id === rejectId) ?? null;
  const divisionName = (dvId: string): string => bundle?.divisions.find((row) => row.dvId === dvId)?.name ?? '';
  const divisionOf = (dvId: string): DivisionDoc | undefined => bundle?.divisions.find((row) => row.dvId === dvId);

  async function approve(enId: string): Promise<void> {
    if (!manage || busy) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.review(buildReviewInput({ cid, enId, decision: 'approve' }));
      setBundle((prev) => {
        if (!prev) return prev;
        const entry = prev.entries.find((row) => row.id === enId);
        return {
          ...prev,
          entries: prev.entries.map((row) => row.id === enId ? { ...row, status: 'approved' } : row),
          divisions: prev.divisions.map((division) => (
            entry && division.dvId === entry.dvId
              ? { ...division, approvedCount: division.approvedCount + 1 }
              : division
          )),
        };
      });
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    if (!manage || !rejectEntry) return;
    const reason = rejectReason.trim();
    const reasonLen = [...reason].length;
    if (!reason) {
      setRejectError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    if (reasonLen < 2 || reasonLen > 200) {
      setRejectError({ reason: 'FIELD_LENGTH', params: { min: 2, max: 200 } });
      return;
    }
    setBusy(true);
    setRejectError(null);
    try {
      await env.actions.review(buildReviewInput({ cid, enId: rejectEntry.id, decision: 'reject', reason }));
      setBundle((prev) => prev ? {
        ...prev,
        entries: prev.entries.map((row) => row.id === rejectEntry.id ? { ...row, status: 'rejected' } : row),
        privates: prev.privates.map((row) => row.id === rejectEntry.id || row.teamId === rejectEntry.teamId
          ? { ...row, reviewNote: reason }
          : row),
      } : prev);
      setRejectId(null);
      setRejectReason('');
      setRejectError(null);
    } catch (err) {
      setRejectError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(entry: EntryDoc, paid: boolean): Promise<void> {
    if (!manage || busy) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.setPaymentStatus(buildPaymentInput({ cid, enId: entry.id, paid }));
      setBundle((prev) => {
        if (!prev) return prev;
        const status: PaymentStatus = paid ? 'paid' : 'none';
        const exists = prev.privates.some((row) => row.id === entry.id || row.teamId === entry.teamId);
        const privates = exists
          ? prev.privates.map((row) => row.id === entry.id || row.teamId === entry.teamId
            ? { ...row, paymentStatus: status }
            : row)
          : [...prev.privates, {
            id: entry.id,
            teamId: entry.teamId,
            contactName: null,
            contactPhone: null,
            paymentStatus: status,
            reviewNote: null,
          } as EntryPrivateDoc];
        return { ...prev, privates };
      });
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function lock(): Promise<void> {
    if (!manage || busy || locked) return;
    // 危險確認框：「鎖定」紅框，預設焦點在「取消」（顧問 §3.465）。
    const ok = await dangerConfirm(ct(lockKey, { n: unconfirmed }), {
      okText: ct('lock'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.lockRosters({ cid });
      setBundle((prev) => prev && prev.competition ? {
        ...prev,
        competition: { ...prev.competition, rostersLockedAt: now },
      } : prev);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function unlock(): Promise<void> {
    const reason = unlockReason.trim();
    const reasonLen = [...reason].length;
    if (!reason) {
      setUnlockError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    if (reasonLen < 2 || reasonLen > 200) {
      setUnlockError({ reason: 'FIELD_LENGTH', params: { min: 2, max: 200 } });
      return;
    }
    setBusy(true);
    setUnlockError(null);
    try {
      await env.actions.unlockRosters({ cid, reason });
      setBundle((prev) => prev && prev.competition ? {
        ...prev,
        competition: { ...prev.competition, rostersLockedAt: null },
      } : prev);
      setUnlockOpen(false);
      setUnlockReason('');
      setUnlockError(null);
    } catch (err) {
      setUnlockError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveContact(): Promise<void> {
    if (!hostOps || contactLock.current) return;
    const problem = contactNoteProblem(contactDraft);
    if (problem) {
      setError({ reason: problem, params: problem === 'FIELD_LENGTH' ? { min: 1, max: 60 } : undefined });
      return;
    }
    const text = contactDraft.trim();
    contactLock.current = true;
    setBusy(true);
    setError(null);
    try {
      await env.actions.update({ cid, contactNote: text ? text : null });
      setBundle((current) => (current?.competition ? {
        ...current,
        competition: { ...current.competition, contactNote: text || null },
      } : current));
      toggleInfo(false);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      contactLock.current = false;
      setBusy(false);
    }
  }

  /** 封面換新或移除：按下去直接存（同分類）。失敗丟回 CoverField，錯誤畫在封面那一格、畫面維持原本的封面。 */
  async function saveCover(next: CoverShown | null): Promise<void> {
    await env.actions.update({ cid, cover: next ? coverInput(next) : null });
    setCoverLocal(next);
    setBundle((current) => current?.competition ? {
      ...current,
      competition: { ...current.competition, cover: next ? coverInput(next) : null },
    } : current);
    toast.show({ message: ct(next ? 'coverSaved' : 'coverRemoved') });
  }

  async function saveCategory(next: CompetitionCategory): Promise<void> {
    if (!manage || busy || next === category) return;
    const prev = category;
    setCategory(next);
    setBusy(true);
    setError(null);
    try {
      await env.actions.update({ cid, category: next });
      setBundle((current) => current?.competition ? {
        ...current,
        competition: { ...current.competition, category: next },
      } : current);
    } catch (err) {
      setCategory(prev);
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  // 封面欄：下架時主辦看不到也改不了（後端非管理員回 COMPETITION_HIDDEN），管理員照畫；
  // 已結束／已取消只能移除，沒封面就不畫這一格。
  const isAdmin = isCpAdmin(env.actor.role);
  const coverNow = shownCover(competition, isAdmin);
  const coverClosed = competition.status === 'cancelled' || competition.endedAt != null;
  // 下架時主辦操作只留管理員（後端 lockRosters／unlockRosters／setPaymentStatus／update：hidden 且非管理員回 COMPETITION_HIDDEN，#14）。
  const hiddenBlock = competition.hidden && !isAdmin;
  // 審核走 assertRosterPhase：下架時連管理員也會被拒（#14）。
  const canReview = manage && !competition.hidden;
  // 分類與聯絡文字走 update：已結束／已取消回 COMPETITION_CLOSED（#17），下架非管理員回 COMPETITION_HIDDEN。
  const infoEditable = !coverClosed && !hiddenBlock;
  const coverField = manage && !(competition.hidden && !isAdmin) && (!coverClosed || coverNow) ? (
    <CoverField
      ct={ct}
      value={coverNow ? (coverLocal?.url === coverNow.url ? coverLocal : coverNow) : null}
      upload={env.coverUpload}
      removeOnly={coverClosed}
      onBusyChange={setCoverBusy}
      onChange={saveCover}
    />
  ) : null;

  const showUnlock = !hiddenBlock && competition.status === 'published' && canUnlockRosters({
    locked,
    canManage: manage,
    isAdmin: isCpAdmin(env.actor.role),
    firstMatchAt: competition.firstMatchAt,
    now,
  });

  // 卡片頂部第一行：隊名太長省略（省略號只在最內層的 span，連結的點擊區才不會被裁掉，3.15）。
  const teamName = (name: string): JSX.Element => <span class="cph-nm">{name}</span>;

  const pendingPanel = (
    <div class="cps-stack" style="margin-top:12px">
      {pending.map((entry) => {
        const priv = privateOf(bundle?.privates ?? [], entry);
        return (
          <CpCard key={entry.id} class="cph-team">
            <div class="cps-head-row">
              <h3 class="cps-h">{teamName(entry.name)}</h3>
            </div>
            <p class="cps-sub">{divisionName(entry.dvId)}</p>
            {priv?.contactName ? (
              <div class="d2-lines">
                <div class="cph-kv"><span>{ct('contact')}</span><span>{priv.contactName}</span></div>
              </div>
            ) : null}
            {canReview ? (
              <div class="cph-decide">
                <Button variant="danger" onClick={() => { setRejectError(null); setRejectId(entry.id); }}>{ct('reject')}</Button>
                <Button variant="primary" onClick={() => { void approve(entry.id); }}>{ct('approve')}</Button>
              </div>
            ) : null}
          </CpCard>
        );
      })}
      {/* s4b-mempty（本頁三處）：樣式在 step4b.css，靠同一支 entry CSS 才套得到；上線後併範圍時收進 .d2- */}
      {pending.length === 0 ? <CpCard><p class="s4b-mempty">{ct('pendingEmpty')}</p></CpCard> : null}
    </div>
  );

  const approvedPanel = (
    <div class="cps-stack" style="margin-top:12px">
      {approved.map((entry) => {
        const division = divisionOf(entry.dvId);
        const priv = privateOf(bundle?.privates ?? [], entry);
        const pay = payLabel(ct, priv?.paymentStatus ?? 'none');
        // 報名費、繳費標籤、標示已繳費只限俱樂部主辦（顧問 §3.257）
        const club = competition?.hostType === 'club';
        return (
          <CpCard key={entry.id} class="cph-team">
            <div class="cps-head-row">
              <h3 class="cps-h">
                <a class="cps-link cph-name" href={`/competitions/${cid}/entries/${entry.id}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); route(`/competitions/${cid}/entries/${entry.id}`); }}>
                  {teamName(entry.name)}
                  <NextIcon />
                </a>
              </h3>
              {locked
                ? <StatusTag kind="neutral" label={ct('rosterLockedTag')} />
                : entry.rosterConfirmed
                  ? <StatusTag kind="neutral" label={ct('rosterConfirmed')} />
                  : <StatusTag kind="neutral" label={ct('rosterUnconfirmed')} />}
            </div>
            <p class="cps-sub">{divisionName(entry.dvId)}</p>
            <div class="d2-lines">
              <div class="cph-kv">
                <span>{ct('rosterPeople')}</span>
                <span>{ct('rosterCount', { n: entry.rosterCount, max: division?.rosterMax ?? 0, min: division?.rosterMin ?? 0 })}</span>
              </div>
              {division && club ? (
                <FeeLine amount={division.feePerTeam} tag={manage ? <StatusTag kind="neutral" label={pay} /> : null} />
              ) : null}
              {manage && club && !hiddenBlock ? (
                <Switch
                  class="cph-switch"
                  label={ct('markPaid')}
                  checked={priv?.paymentStatus === 'paid'}
                  onCheckedChange={(checked) => { void markPaid(entry, checked); }}
                />
              ) : null}
            </div>
          </CpCard>
        );
      })}
      {approved.length === 0 ? <CpCard><p class="s4b-mempty">{ct('approvedEmpty')}</p></CpCard> : null}
      {/* 鎖定只在已發布（後端 lockRosters COMPETITION_NOT_OPEN，#6）、下架只留管理員（#14） */}
      {manage && !locked && competition.status === 'published' && !hiddenBlock ? (
        <div class="cph-end">
          <Button variant="danger" onClick={() => { void lock(); }}>{ct('lockAll')}</Button>
        </div>
      ) : null}
      {showUnlock ? (
        <div class="cph-end">
          <Button variant="secondary" onClick={() => { setUnlockError(null); setUnlockOpen(true); }}>{ct('unlock')}</Button>
        </div>
      ) : null}
    </div>
  );

  const rejectedPanel = (
    <div class="cps-stack" style="margin-top:12px">
      {rejected.map((entry) => {
        const priv = privateOf(bundle?.privates ?? [], entry);
        return (
          <CpCard key={entry.id} class="cph-team">
            <div class="cps-head-row">
              <h3 class="cps-h">{teamName(entry.name)}</h3>
            </div>
            <p class="cps-sub">{divisionName(entry.dvId)}</p>
            {priv?.reviewNote ? (
              <div class="d2-lines">
                <div class="cph-kv cph-kv--wrap"><span>{ct('rejectReason')}</span><span>{priv.reviewNote}</span></div>
              </div>
            ) : null}
          </CpCard>
        );
      })}
      {rejected.length === 0 ? <CpCard><p class="s4b-mempty">{ct('rejectedEmpty')}</p></CpCard> : null}
    </div>
  );

  // 矮板（3.3）：數字都是頁面已讀到的，不增加讀取。
  // 待審：報隊讀到上限（100）時可能少算，不放這一格。已核准：組別文件的 approvedCount／maxTeams 加總；沒讀到組別不放。
  const divisions = bundle?.divisions ?? [];
  const showPendingCell = entries.length < CP_READ_LIMIT.entries;
  const approvedSum = divisions.reduce((sum, row) => sum + row.approvedCount, 0);
  const maxSum = divisions.reduce((sum, row) => sum + row.maxTeams, 0);
  const approvedSentence = ct('approvedTeams', { teams: approvedSum, max: maxSum });
  const approvedCell = divisions.length > 0
    ? splitCount((n, m) => ct('approvedTeams', { teams: n, max: m }), approvedSum, maxSum)
    : null;
  const hasBoard = showPendingCell || divisions.length > 0;
  const board = hasBoard ? (
    <div class="d2-sb d2-sb--row">
      <p class="cps-vh">
        {showPendingCell ? `${ct('tabPending', { n: pending.length })}　` : ''}
        {divisions.length > 0 ? approvedSentence : ''}
      </p>
      <div class="d2-cells d2-cells--row" aria-hidden="true">
        {showPendingCell ? (
          <div class="d2-cell">
            <span class="d2-cell__k">{ct('pending')}</span>
            <span class="d2-cell__v"><b class="d2-num">{pending.length}</b></span>
          </div>
        ) : null}
        {divisions.length > 0 ? (
          <div class="d2-cell">
            {approvedCell ? (
              <>
                <span class="d2-cell__k">{approvedCell.k}</span>
                <span class="d2-cell__v"><b class="d2-num">{approvedCell.n}</b><small>{approvedCell.tail}</small></span>
              </>
            ) : <span class="d2-cell__k">{approvedSentence}</span>}
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <CpFrame
      title={ct('manageTitle')}
      context={competition.name}
      menu={(manage && (infoEditable || coverField)) || (hostOps && infoEditable) ? (
        <Button
          id={INFO_TOGGLE_ID}
          class="cph-pill"
          variant="secondary"
          size="sm"
          trailing={<DownIcon />}
          aria-expanded={infoOpen}
          aria-controls={INFO_PANEL_ID}
          disabled={coverBusy}
          onClick={() => toggleInfo(!infoOpen)}
        >
          {ct('editCompInfo')}
        </Button>
      ) : null}
    >
      {((manage && (infoEditable || coverField)) || (hostOps && infoEditable)) && infoOpen ? (
      <div id={INFO_PANEL_ID} class="cps-stack">
      {manage && (infoEditable || coverField) ? (
        <CpCard>
          {/* ASSUMPTION: 沒有獨立的編輯賽事路由。分類改在報隊管理；建立仍走精靈步驟 1。封面在分類上面（計畫書第 6 題）。 */}
          <div class="cps-fields">
          {coverField}
          {infoEditable ? (
          <RadioGroup
            label={ct('category')}
            orientation="horizontal"
            value={category}
            onValueChange={(value) => {
              if (value === 'league' || value === 'cup' || value === 'friendly') void saveCategory(value);
            }}
            options={[
              { value: 'league', label: ct('categoryLeague') },
              { value: 'cup', label: ct('categoryCup') },
              { value: 'friendly', label: ct('categoryFriendly') },
            ]}
          />
          ) : null}
          </div>
        </CpCard>
      ) : null}
      {hostOps && infoEditable ? (
        <CpCard>
          <div class="cps-fields">
            <Input
              label={ct('contactField')}
              hint={ct('publicHint')}
              value={contactDraft}
              maxLength={60}
              disabled={busy}
              onValueChange={(value) => setContactDraft(clipCodePoints(value.replace(/[\r\n]/g, ''), 60))}
            />
            {competition?.hostType === 'personal' ? <p class="cps-cap">{ct('contactEmptyHint')}</p> : null}
            <div class="cph-right">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => { void saveContact(); }}>{ct('contactSave')}</Button>
            </div>
          </div>
        </CpCard>
      ) : null}
      <div class="cph-right">
        <Button variant="secondary" size="sm" disabled={coverBusy} onClick={() => toggleInfo(false)}>{ct('editCompDone')}</Button>
      </div>
      </div>
      ) : null}
      {board || hostOps ? (
        <section class={hostOps ? 'd2-hero' : 'd2-hero d2-hero--bare'}>
          {board}
          {hostOps ? (
            <div class="d2-foot cph-doors">
              <Button variant="ghost" size="sm" trailing={<NextIcon />} onClick={() => route(`/competitions/${cid}/schedule`)}>{ct('hostSchedTitle')}</Button>
              <Button variant="ghost" size="sm" trailing={<NextIcon />} onClick={() => route(`/competitions/${cid}/matches`)}>{ct('hostListTitle')}</Button>
              <Button variant="ghost" size="sm" trailing={<NextIcon />} onClick={() => route(`/competitions/${cid}/staff`)}>{ct('assignScorer')}</Button>
              {/* 完整編輯（建賽精靈同一份表單）；上面的「編輯賽事資訊」快速面板照舊 */}
              {canEditCompetition(competition, { canHost: hostOps, isAdmin }) ? (
                <Button variant="ghost" size="sm" trailing={<NextIcon />} onClick={() => route(`/competitions/new?edit=${cid}`)}>{ct('editTitle')}</Button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      <div>
        {/* 只有一個組別時不畫各組小字：板上的視覺隱藏整句已經說了同一件事（終審裁定第 3 點） */}
        {divisions.length > 1 ? (
          <div class="cph-caps">
            {divisions.map((division) => (
              <p class="cps-cap" key={division.dvId} data-approved-count={division.dvId}>
                {division.name}　{ct('approvedTeams', { teams: division.approvedCount, max: division.maxTeams })}
              </p>
            ))}
          </div>
        ) : null}
        <Tabs
          label={ct('entryTabs')}
          variant="segmented"
          value={tab}
          onValueChange={(id) => {
            if (id === 'pending' || id === 'approved' || id === 'rejected') setTab(id);
          }}
          items={[
            { id: 'pending', label: ct('tabPending', { n: pending.length }), panel: pendingPanel },
            { id: 'approved', label: ct('tabApproved', { n: approved.length }), panel: approvedPanel },
            { id: 'rejected', label: ct('tabRejected', { n: rejected.length }), panel: rejectedPanel },
          ]}
        />
      </div>
      {error ? <CpError reason={error.reason} params={error.params} /> : null}
      {rejectEntry ? (
        <BottomSheet
          open
          class="d2-panel"
          title={ct('rejectTitle')}
          onClose={() => { setRejectId(null); setRejectError(null); }}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => { setRejectId(null); setRejectError(null); }}>{ct('cancel')}</Button>
              <Button variant="danger" loading={busy} onClick={() => { void reject(); }}>{ct('rejectSubmit')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <p class="cps-note">{rejectEntry.name}　{divisionName(rejectEntry.dvId)}</p>
            {/* 文案盤點 B2：後端拒絕時清空該隊名單（entry.ts reviewEntry prepareClearRoster），先講清楚；沒有球員不畫 */}
            {rejectEntry.rosterCount > 0 ? (
              <p class="cps-note cps-del-warn"><AlertIcon /><span>{ct('rejectClearsRoster', { n: rejectEntry.rosterCount })}</span></p>
            ) : null}
            <Textarea
              label={ct('rejectReason')}
              required
              value={rejectReason}
              maxLength={200}
              placeholder={ct('rejectPlaceholder')}
              onValueChange={setRejectReason}
            />
            {rejectError ? <CpError reason={rejectError.reason} params={rejectError.params} /> : null}
          </div>
        </BottomSheet>
      ) : null}
      {unlockOpen ? (
        <BottomSheet
          open
          class="d2-panel"
          title={ct('unlockTitle')}
          onClose={() => { setUnlockOpen(false); setUnlockError(null); }}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => { setUnlockOpen(false); setUnlockError(null); }}>{ct('cancel')}</Button>
              <Button variant="primary" loading={busy} onClick={() => { void unlock(); }}>{ct('unlockSubmit')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <Textarea
              label={ct('unlockReason')}
              required
              value={unlockReason}
              maxLength={200}
              onValueChange={setUnlockReason}
            />
            {unlockError ? <CpError reason={unlockError.reason} params={unlockError.params} /> : null}
          </div>
        </BottomSheet>
      ) : null}
    </CpFrame>
  );
}

export default function CompetitionManagePage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  if (injected) return <ManageView env={injected} cid={cid} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <ManageView env={{ actor, repo, actions: liveCpActions }} cid={cid} />}
    </LiveBoundary>
  );
}
