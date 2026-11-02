/**
 * 俱樂部管理頁（K1a／K2／K5）。照 A `pages/team.html#page-team-manage` 與
 * `js/modules/team/team-list-render.js#renderTeamManage` 的 DOM／class／文案。
 *
 * - 入口：`canAccessTeamManagePage`（A `_canAccessPage('page-team-manage')` → `team.manage.entry`）；無權不讀資料。
 * - 清單：`team.manage_all` 看全部，其他人只看 `canAccessTeamManageRecord` 的卡；套全域運動篩選；
 *   上架中在前，「已下架俱樂部」分段在後，各段 `sortTeams`。
 * - 讀取預算：進頁只呼叫 1 次 `loadTeams()`（同 session 已有快取則 0 讀）；置頂／上下架／光跡／刪除後就地更新，不重讀。
 * - 按鈕顯示與 handler 共用同一個 club-policy 判斷（R-IAM-011）。
 * - 與 A 刻意差異：上下架 await 寫入、失敗回滾並提示（A 不 await、不回滾）；刪除走 Callable `deleteTeam`，刪完留在本頁；
 *   光跡開關下的說明小字不顯示（站長 11-02 裁定）。
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useGoBack } from '@/core/back-guard';
import { useActiveSport } from '@/core/sport-filter';
import { getLastKnownAuthUid } from '@/data/auth';
import { lt, useT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { SportIcon } from '@/ui/SportIcon';
import { toast } from '@/ui/Toast';
import { useViewer } from '@/features/profile/data/viewer';
import '@/features/events/legacy/activity.css';
import {
  canAccessTeamManagePage,
  canAccessTeamManageRecord,
  canCreateTeam,
  canDeleteTeam,
  canEditTeamSettings,
  canManageAllTeams,
} from '../club-policy';
import { TeamFormModal } from '../components/legacy/TeamFormModal';
import { sortTeams } from '../data/team-list-model';
import {
  deleteTeamViaCallable,
  getTeamAdminErrorMessage,
  normalizeTeamAttentionColor,
  saveTeamActive,
  saveTeamAttentionColor,
  saveTeamAttentionEnabled,
  saveTeamPinned,
} from '../data/teams-admin-write';
import { loadTeams } from '../data/teams-repo';
import type { TeamDoc } from '../data/types';
import '../legacy/team.css';

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; teams: TeamDoc[] };

type FormState = { mode: 'create'; uid: string } | { mode: 'edit'; uid: string; team: TeamDoc } | null;

function teamKey(team: TeamDoc): string {
  return String(team.id || team._docId || '').trim();
}

function toSportFilter(globalSport: string): string {
  return globalSport && globalSport !== 'all' ? globalSport : '';
}

function stop(event: Event): void {
  event.stopPropagation();
}

export default function TeamManagePage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const location = useLocation();
  const goBack = useGoBack('/');
  const [globalSport] = useActiveSport();
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<FormState>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const busyRef = useRef<Set<string>>(new Set());
  const alive = useRef(true);

  const canAccess = canAccessTeamManagePage(viewer);
  const isAdmin = canManageAllTeams(viewer);
  const showCreate = canCreateTeam(viewer);
  const authPending = !viewer.uid && getLastKnownAuthUid() !== null;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setForm(null);
  }, [viewer.uid]);

  useEffect(() => {
    if (!canAccess) return undefined;
    let disposed = false;
    setState({ status: 'loading' });
    loadTeams().then(
      (teams) => {
        if (!disposed) setState({ status: 'ready', teams });
      },
      () => {
        if (!disposed) setState({ status: 'error' });
      },
    );
    return () => {
      disposed = true;
    };
  }, [attempt, canAccess]);

  const sections = useMemo(() => {
    if (state.status !== 'ready') return null;
    let teams = isAdmin
      ? state.teams
      : state.teams.filter((team) => canAccessTeamManageRecord(viewer, team));
    const sport = toSportFilter(globalSport);
    if (sport) teams = teams.filter((team) => team.sportTag === sport);
    return {
      total: teams.length,
      active: sortTeams(teams.filter((team) => team.active)),
      inactive: sortTeams(teams.filter((team) => !team.active)),
    };
  }, [state, isAdmin, viewer, globalSport]);

  function patchLocal(key: string, patch: Partial<TeamDoc>): void {
    setState((prev) => (prev.status === 'ready'
      ? { status: 'ready', teams: prev.teams.map((team) => (teamKey(team) === key ? { ...team, ...patch } : team)) }
      : prev));
  }

  async function runExclusive(key: string, label: string, action: () => Promise<void>): Promise<void> {
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
    setBusy((prev) => ({ ...prev, [key]: label }));
    try {
      await action();
    } finally {
      busyRef.current.delete(key);
      if (alive.current) {
        setBusy((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    }
  }

  const actor = { uid: viewer.uid, displayName: viewer.displayName };

  function handleOpenCreate(): void {
    if (!viewer.uid || !canCreateTeam(viewer)) {
      toast.show({ message: '目前未開啟建立俱樂部權限' });
      return;
    }
    setForm({ mode: 'create', uid: viewer.uid });
  }

  function handleEdit(team: TeamDoc): void {
    if (!viewer.uid || !canEditTeamSettings(viewer, team)) {
      toast.show({ message: '權限不足' });
      return;
    }
    setForm({ mode: 'edit', uid: viewer.uid, team });
  }

  function handleFormSaved(): void {
    setForm(null);
    // 新增／編輯沿用既有寫入（會清快取），這裡重讀一次清單。
    setAttempt((value) => value + 1);
  }

  async function handleTogglePin(team: TeamDoc): Promise<void> {
    if (!canManageAllTeams(viewer)) {
      toast.show({ message: '權限不足' });
      return;
    }
    const key = teamKey(team);
    const pinned = team.pinned !== true;
    await runExclusive(key, 'pin', async () => {
      try {
        const loaded = state.status === 'ready' ? state.teams : [];
        const updates = await saveTeamPinned(team, pinned, loaded, actor);
        patchLocal(key, updates);
        toast.show({ message: pinned ? '已置頂俱樂部' : '已取消置頂' });
      } catch (error) {
        console.error('[TeamManagePage.togglePin]', error);
        toast.show({ message: '置頂更新失敗，請稍後再試', tone: 'error' });
      }
    });
  }

  async function handleToggleActive(team: TeamDoc): Promise<void> {
    if (!canManageAllTeams(viewer)) {
      toast.show({ message: '權限不足' });
      return;
    }
    const key = teamKey(team);
    const previous = Boolean(team.active);
    const next = !previous;
    await runExclusive(key, 'active', async () => {
      patchLocal(key, { active: next });
      try {
        await saveTeamActive(team, next);
        toast.show({ message: next ? `已上架「${team.name ?? ''}」` : `已下架「${team.name ?? ''}」` });
      } catch (error) {
        console.error('[TeamManagePage.toggleActive]', error);
        patchLocal(key, { active: previous });
        toast.show({ message: '更新失敗，請稍後再試', tone: 'error' });
      }
    });
  }

  async function handleToggleAttention(team: TeamDoc, enabled: boolean, input: HTMLInputElement): Promise<void> {
    if (!canManageAllTeams(viewer)) {
      input.checked = !enabled;
      toast.show({ message: '只有管理員可以調整光跡效果' });
      return;
    }
    const key = teamKey(team);
    const previous = team.attentionEffectEnabled === true;
    const color = normalizeTeamAttentionColor(team.attentionEffectColor);
    await runExclusive(key, 'attention', async () => {
      try {
        await saveTeamAttentionEnabled(team, enabled, team.attentionEffectColor, actor);
        patchLocal(key, { attentionEffectEnabled: enabled, attentionEffectColor: color });
        toast.show({ message: enabled ? '光跡效果已開啟' : '光跡效果已關閉' });
      } catch (error) {
        console.error('[TeamManagePage.toggleAttention]', error);
        input.checked = previous;
        toast.show({ message: '光跡效果更新失敗，請稍後再試', tone: 'error' });
      }
    });
  }

  async function handleAttentionColor(team: TeamDoc, value: string, input: HTMLInputElement): Promise<void> {
    const previous = normalizeTeamAttentionColor(team.attentionEffectColor);
    if (!canManageAllTeams(viewer)) {
      input.value = previous;
      toast.show({ message: '只有管理員可以調整光跡顏色' });
      return;
    }
    const key = teamKey(team);
    await runExclusive(key, 'attention', async () => {
      try {
        const color = await saveTeamAttentionColor(team, value, team.attentionEffectColor, actor);
        patchLocal(key, { attentionEffectColor: color });
        toast.show({ message: '光跡顏色已更新' });
      } catch (error) {
        console.error('[TeamManagePage.attentionColor]', error);
        input.value = previous;
        toast.show({ message: '光跡顏色更新失敗，請稍後再試', tone: 'error' });
      }
    });
  }

  async function handleDelete(team: TeamDoc): Promise<void> {
    if (!canDeleteTeam(viewer, team)) {
      toast.show({ message: '權限不足' });
      return;
    }
    const key = teamKey(team);
    if (busyRef.current.has(key)) return;
    const name = team.name ?? '';
    if (!(await appConfirm(`確定要刪除「${name}」？此操作無法復原。`))) return;
    await runExclusive(key, 'delete', async () => {
      try {
        const result = await deleteTeamViaCallable(team);
        if (!alive.current) return;
        if (result.status === 'partial') {
          toast.show({ message: '部分成員資料尚未清除，請再按一次刪除', tone: 'error' });
          return;
        }
        setState((prev) => (prev.status === 'ready'
          ? { status: 'ready', teams: prev.teams.filter((item) => teamKey(item) !== key) }
          : prev));
        toast.show({ message: `已刪除「${name}」` });
      } catch (error) {
        console.error('[TeamManagePage.delete]', error);
        toast.show({ message: getTeamAdminErrorMessage(error, '刪除俱樂部失敗，請稍後再試'), tone: 'error' });
      }
    });
  }

  function renderAttentionControls(team: TeamDoc): JSX.Element | null {
    if (!isAdmin) return null;
    const disabled = busy[teamKey(team)] !== undefined;
    return (
      <div class="team-attention-controls" onClick={stop}>
        <div class="team-attention-label-wrap">
          <span class="team-attention-label">光跡效果</span>
        </div>
        <label class="td-settings-switch team-attention-switch" aria-label="光跡效果">
          <input
            type="checkbox"
            checked={team.attentionEffectEnabled === true}
            disabled={disabled}
            onChange={(event) => {
              const input = event.currentTarget;
              void handleToggleAttention(team, input.checked, input);
            }}
          />
          <span class="td-settings-switch-track"><span class="td-settings-switch-thumb" /></span>
        </label>
        <label class="team-attention-color" aria-label="光跡顏色">
          <span>顏色</span>
          <input
            type="color"
            value={normalizeTeamAttentionColor(team.attentionEffectColor)}
            disabled={disabled}
            onChange={(event) => {
              const input = event.currentTarget;
              void handleAttentionColor(team, input.value, input);
            }}
          />
        </label>
      </div>
    );
  }

  function renderCard(team: TeamDoc): JSX.Element {
    const key = teamKey(team);
    const canEdit = canEditTeamSettings(viewer, team);
    const canRemove = canDeleteTeam(viewer, team);
    const busyLabel = busy[key];
    const nameEn = String(team.nameEn ?? '').trim();
    return (
      <div
        key={key}
        class={`event-card${team.active ? '' : ' team-inactive'}`}
        style="cursor:pointer"
        data-team-id={key}
        onClick={() => {
          if (key) location.route(`/teams/${encodeURIComponent(key)}`);
        }}
      >
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title team-manage-title">
              <span class="team-manage-title-main">
                {team.sportTag ? <><SportIcon sportKey={team.sportTag} className="team-title-sport-icon" />{' '}</> : null}
                {team.name ?? ''}
              </span>
              {nameEn ? <span class="team-manage-title-en">{nameEn}</span> : null}
            </div>
            <div style="display:flex;gap:.4rem;align-items:center">
              {isAdmin && team.pinned ? (
                <span style="font-size:.72rem;color:var(--warning);font-weight:600">置頂</span>
              ) : null}
              <span style={`font-size:.72rem;color:${team.active ? 'var(--success)' : 'var(--danger)'}`}>
                {team.active ? '上架中' : '已下架'}
              </span>
            </div>
          </div>
          {renderAttentionControls(team)}
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem" onClick={stop}>
            {canEdit ? (
              <button type="button" class="primary-btn small" onClick={() => handleEdit(team)}>編輯</button>
            ) : null}
            {isAdmin ? (
              <button
                type="button"
                class={`outline-btn team-pin-btn${team.pinned ? ' is-pinned' : ''}`}
                disabled={busyLabel !== undefined}
                onClick={() => { void handleTogglePin(team); }}
              >
                {team.pinned ? '已置頂' : '置頂'}
              </button>
            ) : null}
            {isAdmin ? (
              <button
                type="button"
                class="outline-btn"
                style="font-size:.75rem;padding:.3rem .6rem"
                disabled={busyLabel !== undefined}
                onClick={() => { void handleToggleActive(team); }}
              >
                {team.active ? '下架' : '上架'}
              </button>
            ) : null}
            {canRemove ? (
              <button
                type="button"
                class="outline-btn"
                style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)"
                disabled={busyLabel !== undefined}
                onClick={() => { void handleDelete(team); }}
              >
                {busyLabel === 'delete' ? '刪除中...' : '刪除'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  function renderBody(): JSX.Element {
    if (!canAccess) {
      if (authPending) return <div class="skeleton skeleton-team-card" />;
      return (
        <div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">權限不足</div>
      );
    }
    if (state.status === 'loading') {
      return (
        <>
          <div class="skeleton skeleton-team-card" />
          <div class="skeleton skeleton-team-card" />
        </>
      );
    }
    if (state.status === 'error') {
      return (
        <div role="alert" style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">
          <div>{t('clubs.loadError')}</div>
          <button type="button" class="outline-btn" style="margin-top:.65rem" onClick={() => setAttempt((v) => v + 1)}>
            {t('clubs.retry')}
          </button>
        </div>
      );
    }
    if (!sections || sections.total === 0) {
      return (
        <div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">
          {lt('尚無俱樂部資料', '尚無俱樂部資料')}
        </div>
      );
    }
    return (
      <>
        {sections.active.map(renderCard)}
        {sections.inactive.length > 0 ? (
          <>
            <hr class="team-section-divider" />
            <div class="team-section-label">{lt('已下架俱樂部', '已下架俱樂部')}</div>
            {sections.inactive.map(renderCard)}
          </>
        ) : null}
      </>
    );
  }

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-team-manage">
        <div class="page-header">
          <button
            class="back-btn"
            type="button"
            aria-label={lt('返回', '返回')}
            data-i18n-aria-label="返回"
            onClick={goBack}
          >
            <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M15 6l-6 6 6 6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <h2 data-i18n="俱樂部管理">{lt('俱樂部管理', '俱樂部管理')}</h2>
          {canAccess && showCreate ? (
            <button
              type="button"
              class="primary-btn small"
              id="team-manage-create-btn"
              data-i18n="＋ 新增俱樂部"
              onClick={handleOpenCreate}
            >
              {lt('＋ 新增俱樂部', '＋ 新增俱樂部')}
            </button>
          ) : null}
        </div>
        <div class="card-list" id="team-manage-list" aria-busy={canAccess && state.status === 'loading' ? 'true' : undefined}>
          {renderBody()}
        </div>
      </section>
      {form && form.uid === viewer.uid ? (
        <TeamFormModal
          key={`${form.mode}:${form.mode === 'edit' ? teamKey(form.team) : form.uid}`}
          open
          mode={form.mode}
          team={form.mode === 'edit' ? form.team : undefined}
          viewer={viewer}
          onClose={() => setForm(null)}
          onSaved={handleFormSaved}
        />
      ) : null}
    </div>
  );
}
