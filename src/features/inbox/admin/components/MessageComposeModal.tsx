/**
 * 撰寫站內信疊窗。DOM／行內樣式／文案照 A `pages/admin-content.html#msg-compose` 與
 * `message-admin-compose.js`（showMsgCompose、onMsgTargetChange、searchMsgTarget、_selectMsgUser、
 * searchMsgTeam、_selectMsgTeam、sendMessage）。
 *
 * - 收件人搜尋走 `listUserDirectory` Callable（前端 0 讀，同 session 共用快取）；選取與送出前再用 verifyUids 驗證。
 * - 俱樂部搜尋用已載入的俱樂部清單（本彈窗只呼叫 1 次 `loadTeams()`，打字不重複載入；同 session 共用）。
 * - 立即發送：寫 `adminMessages` → `deliverToInbox` → 投遞成功才背景 LINE 推播（全體用戶不推）。排程：只寫紀錄。
 * - 與 A 差異：寫入與投遞都等結果，失敗會提示並留在彈窗（A 不等、失敗無提示）；LINE 推播名單改條件查詢＋上限；
 *   非 admin／super_admin 不顯示也不接受「全體／角色」對象（伺服器 deliverToInbox 同樣只准 admin 群發）；
 *   原始 UID 只對 admin／super_admin 顯示（同 B 其他頁的 canViewRawUid）。
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { loadTeams } from '@/features/clubs/data/teams-repo';
import type { TeamDoc } from '@/features/clubs/data/types';
import { roleLabelOf } from '@/features/events/data/event-form-model';
import { isAdminPlusRole } from '@/features/profile/components/legacy/profile-legacy-helpers';
import {
  getUserDirectory,
  loadUserDirectory,
  verifyUserDirectorySelection,
  type DirectoryUser,
} from '@/features/events/data/user-directory';

import {
  MSG_BODY_MAX,
  MSG_CATEGORIES,
  MSG_TITLE_MAX,
  buildAdminMessageRecord,
  canBroadcastToTarget,
  canComposeMessage,
  composeTargetTypesFor,
  senderNameOf,
  validateCompose,
  type AdminMessage,
  type ComposeInput,
  type MessageViewer,
  type MsgCategory,
  type MsgTargetType,
} from '../data/admin-message-model';
import { createAdminMessage } from '../data/admin-messages-repo';
import { deliverAdminMessage, queueLinePushByTarget } from '../data/admin-message-send';
import { AdminOverlay } from './AdminOverlay';

const DROPDOWN_ITEM_HINT = 'padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)';
const RESULT_STYLE = 'font-size:.75rem;margin-top:.2rem;color:var(--text-muted)';

type Dropdown =
  | { kind: 'closed' }
  | { kind: 'hint'; textKey: string }
  | { kind: 'users'; users: DirectoryUser[] }
  | { kind: 'teams'; teams: TeamDoc[] };

export interface ComposeViewer extends MessageViewer {
  displayName: string | null;
}

export interface MessageComposeModalProps {
  viewer: ComposeViewer;
  onClose: () => void;
  /** 紀錄寫入成功（立即發送時也已投遞）後呼叫。 */
  onSaved: (record: AdminMessage) => void;
}

function matchUsers(users: readonly DirectoryUser[], q: string, byUid: boolean): DirectoryUser[] {
  return users
    .filter((u) => (u.name && u.name.toLowerCase().includes(q)) || (byUid && u.uid && u.uid.toLowerCase().includes(q)))
    .slice(0, 8);
}

function matchTeams(teams: readonly TeamDoc[], q: string): TeamDoc[] {
  return teams.filter((tm) => tm.active !== false && tm.name && tm.name.toLowerCase().includes(q)).slice(0, 8);
}

export function MessageComposeModal(props: MessageComposeModalProps): JSX.Element {
  const t = useT();
  const targetTypes = composeTargetTypesFor(props.viewer);
  // A `_canViewRawUid`：只有 admin／super_admin 看得到（也搜得到）原始 UID。
  const canViewRawUid = isAdminPlusRole(props.viewer.role);
  const [category, setCategory] = useState<MsgCategory>('system');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [schedule, setSchedule] = useState('');
  const [targetType, setTargetType] = useState<MsgTargetType>(targetTypes[0] ?? 'individual');
  const [userQuery, setUserQuery] = useState('');
  const [teamQuery, setTeamQuery] = useState('');
  const [userDropdown, setUserDropdown] = useState<Dropdown>({ kind: 'closed' });
  const [teamDropdown, setTeamDropdown] = useState<Dropdown>({ kind: 'closed' });
  const [userResult, setUserResult] = useState('');
  const [teamResult, setTeamResult] = useState('');
  const [matchedUser, setMatchedUser] = useState<DirectoryUser | null>(null);
  const [matchedTeam, setMatchedTeam] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const userSeq = useRef(0);
  const teamSeq = useRef(0);
  const alive = useRef(true);
  /** 本彈窗共用一次俱樂部載入（失敗清掉可再試），避免每打一字或載入中重複讀整個 teams。 */
  const teamsPromise = useRef<Promise<TeamDoc[]> | null>(null);
  const targetRef = useRef(targetType);
  targetRef.current = targetType;
  const userQueryRef = useRef(userQuery);
  userQueryRef.current = userQuery;
  const teamQueryRef = useRef(teamQuery);
  teamQueryRef.current = teamQuery;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      userSeq.current += 1;
      teamSeq.current += 1;
    };
  }, []);

  function userMeta(u: DirectoryUser): string {
    return [canViewRawUid ? u.uid : '', roleLabelOf(u.role) ?? u.role].filter(Boolean).join(' · ');
  }

  function uidSuffix(uid: string): string {
    return canViewRawUid && uid ? `（${uid}）` : '';
  }

  function loadTeamsOnce(): Promise<TeamDoc[]> {
    if (!teamsPromise.current) {
      teamsPromise.current = loadTeams().catch((err: unknown) => {
        teamsPromise.current = null;
        throw err;
      });
    }
    return teamsPromise.current;
  }

  function renderUserMatches(raw: string, q: string, refreshed: boolean, loadFailed: boolean): void {
    const users = getUserDirectory();
    const matches = matchUsers(users, q, canViewRawUid);
    if (matches.length) setUserDropdown({ kind: 'users', users: matches });
    else if (!refreshed) setUserDropdown({ kind: 'hint', textKey: users.length ? 'refreshingUsers' : 'loadingUsers' });
    else setUserDropdown({ kind: 'hint', textKey: loadFailed ? 'userLoadFailed' : 'noUser' });
    // A：即時精準匹配提示
    const exact = users.find((u) => (canViewRawUid && u.uid === raw) || u.name === raw);
    setUserResult(exact ? t('inbox.admin.compose.found', { name: exact.name, uid: uidSuffix(exact.uid), role: exact.role }) : '');
  }

  async function onUserInput(value: string): Promise<void> {
    setUserQuery(value);
    const raw = value.trim();
    const seq = ++userSeq.current;
    if (!raw) {
      setUserResult('');
      setMatchedUser(null);
      setUserDropdown({ kind: 'closed' });
      return;
    }
    if (matchedUser && matchedUser.name.trim() !== raw && matchedUser.uid.trim() !== raw) setMatchedUser(null);
    const q = raw.toLowerCase();
    renderUserMatches(raw, q, false, false);
    const ready = await loadUserDirectory();
    if (!alive.current || seq !== userSeq.current || userQueryRef.current.trim() !== raw || targetRef.current !== 'individual') return;
    const hasMatch = matchUsers(getUserDirectory(), q, canViewRawUid).length > 0;
    renderUserMatches(raw, q, true, !ready && !hasMatch);
  }

  async function selectUser(uid: string): Promise<void> {
    const seq = userSeq.current;
    const query = userQueryRef.current.trim();
    const verification = await verifyUserDirectorySelection([uid]);
    if (!alive.current || seq !== userSeq.current || userQueryRef.current.trim() !== query || targetRef.current !== 'individual') return;
    const match = verification.users.find((u) => u.uid === uid);
    if (!verification.ok || !match) {
      setMatchedUser(null);
      setUserResult('');
      toast.show({
        message: t(verification.reason === 'missing-users' ? 'inbox.admin.validation.selectMissing' : 'inbox.admin.validation.selectVerifyFailed'),
        tone: 'error',
      });
      return;
    }
    userSeq.current += 1;
    setMatchedUser(match);
    setUserQuery(match.name);
    setUserDropdown({ kind: 'closed' });
    setUserResult(t('inbox.admin.compose.selected', { name: match.name, uid: uidSuffix(match.uid), role: match.role }));
  }

  async function onTeamInput(value: string): Promise<void> {
    setTeamQuery(value);
    const raw = value.trim();
    const seq = ++teamSeq.current;
    if (!raw) {
      setTeamResult('');
      setMatchedTeam(null);
      setTeamDropdown({ kind: 'closed' });
      return;
    }
    if (matchedTeam && matchedTeam.name.trim() !== raw) {
      setMatchedTeam(null);
      setTeamResult('');
    }
    const q = raw.toLowerCase();
    setTeamDropdown({ kind: 'hint', textKey: 'loadingTeams' });
    let teams: TeamDoc[] = [];
    let failed = false;
    try {
      teams = await loadTeamsOnce();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[MessageAdmin] team directory load failed:', err);
      failed = true;
    }
    if (!alive.current || seq !== teamSeq.current || teamQueryRef.current.trim() !== raw || targetRef.current !== 'team') return;
    const matches = matchTeams(teams, q);
    if (matches.length) setTeamDropdown({ kind: 'teams', teams: matches });
    else setTeamDropdown({ kind: 'hint', textKey: failed ? 'teamLoadFailed' : 'noTeam' });
  }

  function selectTeam(team: TeamDoc): void {
    const id = String(team.id || team._docId || '');
    const name = String(team.name || '');
    teamSeq.current += 1;
    setMatchedTeam({ id, name });
    setTeamQuery(name);
    setTeamDropdown({ kind: 'closed' });
    setTeamResult(t('inbox.admin.compose.teamSelected', { name }));
  }

  function onTargetChange(value: MsgTargetType): void {
    userSeq.current += 1;
    setTargetType(value);
    if (value === 'team') {
      loadTeamsOnce().catch(() => {
        // 搜尋時會再試並提示。
      });
    }
  }

  async function send(): Promise<void> {
    if (busy) return;
    if (!canComposeMessage(props.viewer)) {
      toast.show({ message: t('inbox.admin.toast.noPermission'), tone: 'error' });
      return;
    }
    // 與選項同一判斷（R-IAM-011）：非 admin 不能發送或排程全體／角色群發。
    if (!canBroadcastToTarget(props.viewer, targetType)) {
      toast.show({ message: t('inbox.admin.toast.noPermission'), tone: 'error' });
      return;
    }
    const input: ComposeInput = {
      category,
      title,
      body,
      targetType,
      schedule,
      team: matchedTeam,
      user: matchedUser ? { uid: matchedUser.uid, name: matchedUser.name } : null,
    };
    const error = validateCompose(input);
    if (error) {
      toast.show({ message: t(`inbox.admin.validation.${error}`), tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      if (targetType === 'individual' && matchedUser) {
        const selectedUid = matchedUser.uid;
        const seq = ++userSeq.current;
        const verification = await verifyUserDirectorySelection([selectedUid]);
        if (!alive.current || seq !== userSeq.current || targetRef.current !== 'individual') return;
        const verified = verification.users.find((u) => u.uid === selectedUid);
        if (!verification.ok || !verified) {
          setMatchedUser(null);
          toast.show({
            message: t(verification.reason === 'missing-users' ? 'inbox.admin.validation.userMissing' : 'inbox.admin.validation.userVerifyFailed'),
            tone: 'error',
          });
          return;
        }
        input.user = { uid: verified.uid, name: verified.name };
      }

      const record = buildAdminMessageRecord(input, senderNameOf(props.viewer.displayName));
      let saved: AdminMessage;
      try {
        saved = await createAdminMessage(record);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[sendMessage] create failed:', err);
        toast.show({ message: t('inbox.admin.toast.actionFailed'), tone: 'error' });
        return;
      }

      if (saved.status === 'sent') {
        try {
          await deliverAdminMessage(saved, props.viewer.uid);
        } catch (err) {
          // 站內信沒送出：不推 LINE、不當成功，留在彈窗讓管理員再試（紀錄已寫，同 A 先寫紀錄）。
          // eslint-disable-next-line no-console
          console.error('[deliverMsg:inbox]', err);
          toast.show({ message: t('inbox.admin.toast.deliverFailed'), tone: 'error' });
          return;
        }
        void pushLineInBackground(saved);
      }

      props.onSaved(saved);
      toast.show({ message: t(saved.status === 'sent' ? 'inbox.admin.toast.sent' : 'inbox.admin.toast.scheduled'), tone: 'success' });
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function pushLineInBackground(saved: AdminMessage): Promise<void> {
    const outcome = await queueLinePushByTarget(saved);
    if (outcome.status === 'overLimit') {
      toast.show({ message: t('inbox.admin.toast.lineOverLimit', { limit: outcome.limit }), tone: 'warning' });
    } else if (outcome.status === 'error' || (outcome.status === 'queued' && outcome.failed > 0)) {
      toast.show({ message: t('inbox.admin.toast.lineFailed'), tone: 'warning' });
    }
  }

  function renderDropdown(dropdown: Dropdown, id: string): JSX.Element {
    const open = dropdown.kind !== 'closed';
    return (
      <div id={id} class={`ce-delegate-dropdown${open ? ' open' : ''}`}>
        {dropdown.kind === 'hint' ? <div style={DROPDOWN_ITEM_HINT}>{t(`inbox.admin.compose.${dropdown.textKey}`)}</div> : null}
        {dropdown.kind === 'users'
          ? dropdown.users.map((u) => (
            <div
              key={u.uid}
              class="ce-delegate-item"
              data-uid={u.uid}
              onMouseDown={(event) => {
                event.preventDefault();
                void selectUser(u.uid);
              }}
            >
              <span class="ce-delegate-item-name">{u.name}</span>
              <span class="ce-delegate-item-meta">{userMeta(u)}</span>
            </div>
          ))
          : null}
        {dropdown.kind === 'teams'
          ? dropdown.teams.map((tm) => (
            <div
              key={String(tm.id || tm._docId)}
              class="ce-delegate-item"
              data-tid={String(tm.id || tm._docId || '')}
              onMouseDown={(event) => {
                event.preventDefault();
                selectTeam(tm);
              }}
            >
              <span class="ce-delegate-item-name">{tm.name}</span>
              <span class="ce-delegate-item-meta">
                {t('inbox.admin.compose.teamMeta', { count: String(Number(tm.members || 0)), region: String(tm.region || '') })}
              </span>
            </div>
          ))
          : null}
      </div>
    );
  }

  return (
    <AdminOverlay
      id="msg-compose"
      boxStyle="background:var(--bg-card);border-radius:var(--radius-lg);max-width:440px;width:92%;max-height:85vh;overflow-y:auto;padding:1.2rem;position:relative"
      closeOnBackdrop
      busy={busy}
      labelledBy="msg-compose-title"
      onClose={props.onClose}
    >
      <div class="role-editor-header" style="margin-bottom:.6rem">
        <span id="msg-compose-title" style="font-size:.95rem;font-weight:700">{t('inbox.admin.compose.title')}</span>
        <button
          type="button"
          aria-label={t('inbox.admin.close')}
          style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--text-muted)"
          onClick={() => {
            if (!busy) props.onClose();
          }}
        >
          ✕
        </button>
      </div>
      <div class="form-row">
        <label for="msg-category">{t('inbox.admin.compose.category')}</label>
        <select id="msg-category" value={category} onChange={(e) => setCategory(e.currentTarget.value as MsgCategory)}>
          {MSG_CATEGORIES.map((c) => (
            <option key={c} value={c}>{t(`inbox.admin.categories.${c}`)}</option>
          ))}
        </select>
      </div>
      <div class="form-row">
        <label for="msg-title">
          {t('inbox.admin.compose.titleLabel')} <span class="required">{t('inbox.admin.compose.required')}</span>
        </label>
        <input
          type="text"
          id="msg-title"
          placeholder={t('inbox.admin.compose.titlePlaceholder')}
          maxLength={MSG_TITLE_MAX}
          value={title}
          onInput={(e) => setTitle(e.currentTarget.value)}
        />
      </div>
      <div class="form-row">
        <label for="msg-target">{t('inbox.admin.compose.target')}</label>
        <select id="msg-target" value={targetType} onChange={(e) => onTargetChange(e.currentTarget.value as MsgTargetType)}>
          {targetTypes.map((type) => (
            <option key={type} value={type}>{t(`inbox.admin.targets.${type}`)}</option>
          ))}
        </select>
      </div>
      {targetType === 'individual' ? (
        <div class="form-row" id="msg-individual-row">
          <label for="msg-individual-target">{t('inbox.admin.compose.individualLabel')}</label>
          <div style="position:relative">
            <input
              type="text"
              id="msg-individual-target"
              placeholder={t('inbox.admin.compose.individualPlaceholder')}
              autocomplete="off"
              value={userQuery}
              onInput={(e) => {
                void onUserInput(e.currentTarget.value);
              }}
            />
            {renderDropdown(userDropdown, 'msg-user-dropdown')}
          </div>
          <div id="msg-target-result" style={RESULT_STYLE}>
            {userResult ? <span style="color:var(--success)" data-no-translate>{userResult}</span> : null}
          </div>
        </div>
      ) : null}
      {targetType === 'team' ? (
        <div class="form-row" id="msg-team-row">
          <label for="msg-team-target">{t('inbox.admin.compose.teamLabel')}</label>
          <div style="position:relative">
            <input
              type="text"
              id="msg-team-target"
              placeholder={t('inbox.admin.compose.teamPlaceholder')}
              autocomplete="off"
              value={teamQuery}
              onInput={(e) => {
                void onTeamInput(e.currentTarget.value);
              }}
            />
            {renderDropdown(teamDropdown, 'msg-team-dropdown')}
          </div>
          <div id="msg-team-result" style={RESULT_STYLE}>
            {teamResult ? <span style="color:var(--success)">{teamResult}</span> : null}
          </div>
        </div>
      ) : null}
      <div class="form-row">
        <label for="msg-body">
          {t('inbox.admin.compose.bodyLabel')} <span class="required">{t('inbox.admin.compose.required')}</span>
        </label>
        <textarea
          id="msg-body"
          rows={4}
          placeholder={t('inbox.admin.compose.bodyPlaceholder')}
          maxLength={MSG_BODY_MAX}
          value={body}
          onInput={(e) => setBody(e.currentTarget.value)}
        />
      </div>
      <div class="form-row">
        <label for="msg-schedule">{t('inbox.admin.compose.scheduleLabel')}</label>
        <input type="datetime-local" id="msg-schedule" value={schedule} onInput={(e) => setSchedule(e.currentTarget.value)} />
      </div>
      <button type="button" class="primary-btn full-width" disabled={busy} onClick={() => void send()}>
        {t('inbox.admin.compose.submit')}
      </button>
    </AdminOverlay>
  );
}
