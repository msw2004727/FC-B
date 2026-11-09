import { Fragment, type JSX } from 'preact';
import { lt } from '@/i18n/i18n';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import { UserTag } from '@/ui/UserTag';
import { isTeamDetailSectionVisible } from '../../data/team-detail-model';
import type { ClubViewer, TeamDoc, TeamRosterRow } from '../../data/types';
import {
  canChangeMemberRole,
  canEditMemberMatchData,
  canEditMemberNote,
  canKickMember,
  canManageMembers as policyCanManageMembers,
  canViewMemberNote,
  getMemberRoleChangeTargetForUser,
  type MemberRoleTarget,
} from '../../club-policy';
import {
  changeMemberRole,
  getKickErrorMessage,
  getRoleChangeLabels,
  getTeamRoleOfMember,
  kickTeamMember,
  saveMemberActivityNote,
  saveMemberMatchData,
} from './member-management-actions';
import { TeamMemberMatchDialog, type TeamMemberMatchValue } from './TeamMemberMatchDialog';
import { TeamMemberNoteDialog } from './TeamMemberNoteDialog';
import './team-member-compact.css';
import { TeamRoleConfirmDialog } from './TeamRoleConfirmDialog';
import {
  buildMemberIntegratedMeta,
  formatRosterJersey,
  formatRosterPosition,
  getMemberDisplayName,
  getMemberMatchData,
  getMemberRowKey,
  getMemberUserTagRole,
  getTeamMemberFilterOptions,
  readTeamMemberData,
  readTextValue,
  teamMemberMatchesFilter,
  type LegacyMemberFilterKey,
} from './legacy-team-member-model';

export interface LegacyTeamMembersCardProps {
  team: TeamDoc;
  roster: readonly TeamRosterRow[];
  viewer: ClubViewer;
  onTeamChanged: () => void | Promise<void>;
  onOpenProfile: (uid: string) => void;
  /** K4：剔除成功後由頁面就地移除該列（不重讀成員）。 */
  onMemberRemoved?: (uid: string) => void;
}

type MemberDialog =
  | { kind: 'note'; row: TeamRosterRow; initialNote: string }
  | { kind: 'match'; row: TeamRosterRow; initial: TeamMemberMatchValue }
  | { kind: 'role'; row: TeamRosterRow; target: MemberRoleTarget };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderEditSvgIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
    </svg>
  );
}

/** A `_buildTeamMemberSvgIcon('match')`。 */
function renderMatchSvgIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 4h12l-2 7 2 9H6l2-9-2-7Z"></path>
      <path d="M9 4c0 2 1.5 4 3 4s3-2 3-4"></path>
      <path d="M10 14h4"></path>
    </svg>
  );
}

/** A `_buildTeamMemberSvgIcon('trash')`。 */
function renderTrashSvgIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 6h18"></path>
      <path d="M8 6V4h8v2"></path>
      <path d="M19 6l-1 14H6L5 6"></path>
      <path d="M10 11v5"></path>
      <path d="M14 11v5"></path>
    </svg>
  );
}

function renderNoteSvgIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <path d="M14 2v6h6"></path>
      <path d="M8 13h8"></path>
      <path d="M8 17h5"></path>
    </svg>
  );
}

export function LegacyTeamMembersCard({
  team,
  roster,
  viewer,
  onTeamChanged,
  onOpenProfile,
  onMemberRemoved,
}: LegacyTeamMembersCardProps): JSX.Element {
  const [selectedFilter, setSelectedFilter] = useState<LegacyMemberFilterKey>('all');
  const [editMode, setEditMode] = useState(false);
  const [dialog, setDialog] = useState<MemberDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const actionLock = useRef(false);
  const contextVersion = useRef(0);
  const teamId = String(team.id ?? team._docId ?? '');
  const latestIdentity = useRef({ uid: viewer.uid, teamId });
  latestIdentity.current = { uid: viewer.uid, teamId };

  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      contextVersion.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    contextVersion.current += 1;
    setDialog(null);
    setEditMode(false);
  }, [viewer.uid, teamId]);

  const canManage = policyCanManageMembers(viewer, team);
  const effectiveEditMode = editMode && canManage;

  useLayoutEffect(() => {
    if (!canManage) setDialog(null);
  }, [canManage]);

  const showCourseSection = isTeamDetailSectionVisible(team, 'courses');
  const filterOptions = getTeamMemberFilterOptions(roster);
  const allowedFilters = new Set<LegacyMemberFilterKey>(filterOptions.map((item) => item.key));
  const activeFilter: LegacyMemberFilterKey = allowedFilters.has(selectedFilter)
    ? selectedFilter
    : 'all';

  const visibleRoster =
    activeFilter === 'all'
      ? roster
      : roster.filter((row) => teamMemberMatchesFilter(row, activeFilter));

  const showPrivateNotes = canViewMemberNote(viewer, team);

  const showNoteForbidden = (): void => {
    toast.show({ message: '您沒有編輯成員的權限', tone: 'error' });
  };

  const toggleEditMode = (event: JSX.TargetedMouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (!policyCanManageMembers(viewer, team)) {
      showNoteForbidden();
      return;
    }
    if (actionLock.current) return;
    setDialog(null);
    setEditMode((value) => !value);
  };

  const closeDialog = (): void => {
    if (!alive.current || actionLock.current) return;
    setDialog(null);
  };

  const openNote = (row: TeamRosterRow): void => {
    if (!canEditMemberNote(viewer, team)) {
      showNoteForbidden();
      return;
    }
    if (!effectiveEditMode || !row.user || actionLock.current) return;
    const initialNote = readTextValue(
      readTeamMemberData(team, row, ['memberActivityData']),
      ['notes', 'note', 'remark', 'activityNotes'],
    );
    setDialog({ kind: 'note', row, initialNote });
  };

  const showRoleUnavailable = (direction: MemberRoleTarget['direction']): void => {
    const actionText = direction === 'promote' ? '晉升' : '降級';
    toast.show({
      message: canChangeMemberRole(viewer, team)
        ? `此成員目前無法${actionText}`
        : '只有俱樂部經理可調整成員層級',
      tone: 'error',
    });
  };

  const openRole = (
    row: TeamRosterRow,
    direction: MemberRoleTarget['direction'],
  ): void => {
    const target = getMemberRoleChangeTargetForUser(viewer, team, row.user, direction);
    if (!target) {
      showRoleUnavailable(direction);
      return;
    }
    if (!effectiveEditMode || !row.isMember || !row.user || actionLock.current) return;
    setDialog({ kind: 'role', row, target });
  };

  const openMatch = (row: TeamRosterRow): void => {
    if (!canEditMemberMatchData(viewer, team)) {
      showNoteForbidden();
      return;
    }
    if (!effectiveEditMode || !row.user || actionLock.current) return;
    const current = getMemberMatchData(team, row);
    setDialog({
      kind: 'match',
      row,
      initial: { jerseyNumber: current.jerseyNumber, position: current.position, notes: current.notes },
    });
  };

  const saveMatch = async (value: TeamMemberMatchValue): Promise<void> => {
    if (!alive.current || actionLock.current || dialog?.kind !== 'match') return;
    if (!canEditMemberMatchData(viewer, team)) {
      showNoteForbidden();
      return;
    }
    const { row } = dialog;
    if (!row.user) return;
    const version = contextVersion.current;
    const isCurrent = (): boolean =>
      alive.current
      && contextVersion.current === version
      && latestIdentity.current.uid === viewer.uid
      && latestIdentity.current.teamId === teamId;

    actionLock.current = true;
    setBusy(true);
    try {
      const result = await saveMemberMatchData({
        team,
        viewer,
        memberKey: row.uid,
        jerseyNumber: value.jerseyNumber,
        position: value.position,
        notes: value.notes,
        memberName: getMemberDisplayName(row),
      });
      if (!isCurrent()) return;
      if (result.ok) {
        setDialog(null);
        toast.show({ message: '賽事數據已更新', tone: 'success' });
        await refreshTeam();
      } else {
        toast.show({
          message: result.reason === 'forbidden' ? '您沒有編輯成員的權限' : '更新失敗，請稍後再試',
          tone: 'error',
        });
      }
    } catch {
      // eslint-disable-next-line no-console
      console.error('[LegacyTeamMembersCard] match data update failed');
      if (isCurrent()) toast.show({ message: '更新失敗，請稍後再試', tone: 'error' });
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  };

  /** K4：按鈕與 handler 共用 canKickMember（只對一般隊員；幹部先降職）。 */
  const kickRow = async (row: TeamRosterRow): Promise<void> => {
    if (!effectiveEditMode || actionLock.current) return;
    if (!canKickMember(viewer, team, row.uid)) {
      toast.show({
        message: policyCanManageMembers(viewer, team) ? '僅可移除一般成員' : '您沒有移除成員的權限',
        tone: 'error',
      });
      return;
    }
    const memberName = getMemberDisplayName(row).trim() || '成員';
    actionLock.current = true;
    const version = contextVersion.current;
    const isCurrent = (): boolean =>
      alive.current
      && contextVersion.current === version
      && latestIdentity.current.uid === viewer.uid
      && latestIdentity.current.teamId === teamId;
    try {
      if (!(await appConfirm(`確定要剔除「${memberName}」？`))) return;
      if (!isCurrent()) return;
      setBusy(true);
      const result = await kickTeamMember({ team, viewer, targetUid: row.uid });
      if (!isCurrent()) return;
      if (!result.ok) {
        toast.show({
          message: result.reason === 'forbidden' ? '您沒有移除成員的權限' : '僅可移除一般成員',
          tone: 'error',
        });
        return;
      }
      toast.show({ message: `已移除成員「${memberName}」`, tone: 'success' });
      onMemberRemoved?.(row.uid);
      await refreshTeam();
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error('[LegacyTeamMembersCard] remove member failed');
      if (isCurrent()) toast.show({ message: getKickErrorMessage(error), tone: 'error' });
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const refreshTeam = async (): Promise<void> => {
    try {
      await onTeamChanged();
    } catch {
      // eslint-disable-next-line no-console
      console.error('[LegacyTeamMembersCard] team refresh failed');
    }
  };

  const saveNote = async (notes: string): Promise<void> => {
    if (!alive.current || actionLock.current || dialog?.kind !== 'note') return;
    if (!canEditMemberNote(viewer, team)) {
      showNoteForbidden();
      return;
    }
    const { row } = dialog;
    if (!row.user) return;

    const activityData = team.memberActivityData;
    const rawRecord = isRecord(activityData) ? activityData[row.uid] : null;
    const existingRecord = isRecord(rawRecord) ? rawRecord : null;
    const version = contextVersion.current;
    const isCurrent = (): boolean =>
      alive.current
      && contextVersion.current === version
      && latestIdentity.current.uid === viewer.uid
      && latestIdentity.current.teamId === teamId;

    actionLock.current = true;
    setBusy(true);
    try {
      const result = await saveMemberActivityNote({
        team,
        viewer,
        memberKey: row.uid,
        notes,
        existingRecord,
      });
      if (!isCurrent()) return;
      if (result.ok) {
        setDialog(null);
        toast.show({ message: '活動備註已更新', tone: 'success' });
        await refreshTeam();
      } else {
        toast.show({
          message: result.reason === 'forbidden'
            ? '您沒有編輯成員的權限'
            : '更新失敗，請稍後再試',
          tone: 'error',
        });
      }
    } catch {
      // eslint-disable-next-line no-console
      console.error('[LegacyTeamMembersCard] activity note update failed');
      if (isCurrent()) {
        toast.show({ message: '更新失敗，請稍後再試', tone: 'error' });
      }
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const confirmRole = async (): Promise<void> => {
    if (!alive.current || actionLock.current || dialog?.kind !== 'role') return;
    const selectedTarget = dialog.target;
    const row = roster.find((candidate) => candidate.uid === dialog.row.uid);
    if (!row || !row.isMember || !row.user) {
      setDialog(null);
      toast.show({ message: '找不到成員資料', tone: 'error' });
      return;
    }

    const direction = selectedTarget.direction;
    const actionText = direction === 'promote' ? '晉升' : '降級';
    const current = getMemberRoleChangeTargetForUser(viewer, team, row.user, direction);
    if (!current || current.key !== selectedTarget.key) {
      setDialog(null);
      toast.show({
        message: current
          ? '此成員層級已是最新狀態'
          : `此成員目前無法${actionText}`,
        tone: 'error',
      });
      return;
    }
    const version = contextVersion.current;
    const isCurrent = (): boolean =>
      alive.current
      && contextVersion.current === version
      && latestIdentity.current.uid === viewer.uid
      && latestIdentity.current.teamId === teamId;

    actionLock.current = true;
    setBusy(true);
    try {
      const result = await changeMemberRole({
        team,
        viewer,
        targetUid: row.uid,
        targetUser: row.user,
        displayName: getMemberDisplayName(row),
        direction,
      });
      if (!isCurrent()) return;
      setDialog(null);
      if (result.ok) {
        const labels = getRoleChangeLabels(result.target);
        toast.show({
          message: `已${labels.actionText}為${labels.roleName}`,
          tone: 'success',
        });
        await refreshTeam();
      } else {
        toast.show({
          message: result.reason === 'forbidden'
            ? '只有俱樂部經理可調整成員層級'
            : `此成員目前無法${actionText}`,
          tone: 'error',
        });
      }
    } catch {
      // eslint-disable-next-line no-console
      console.error('[LegacyTeamMembersCard] member role update failed');
      if (isCurrent()) {
        setDialog(null);
        toast.show({ message: `${actionText}失敗，請稍後再試`, tone: 'error' });
      }
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const renderRoleAction = (
    row: TeamRosterRow,
    target: MemberRoleTarget,
  ): JSX.Element => {
    const { actionText, roleName } = getRoleChangeLabels(target);
    const label = `${actionText}為${roleName}`;
    const promote = target.direction === 'promote';
    return (
      <span class={`td-member-role-action-cell td-member-${target.direction}-cell`}>
        <button
          class={`td-member-role-action-btn ${target.direction} td-mm-icon-btn`}
          type="button"
          title={label}
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            openRole(row, target.direction);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d={promote ? 'M12 19V5' : 'M12 5v14'}></path>
            <path d={promote ? 'M5 12l7-7 7 7' : 'M19 12l-7 7-7-7'}></path>
          </svg>
        </button>
      </span>
    );
  };

  return (
    <section class="td-member-management-panel td-member-compact" id="team-members-section">
      <div class="td-member-panel-pad">
        <div id="team-members-toggle" class="td-member-top">
          <div class="td-member-head-copy">
            <div class="td-member-total">{`${roster.length} 位成員`}</div>
          </div>
          {canManage && (
            <button
              class={`td-member-edit-btn${effectiveEditMode ? ' is-active' : ''}`}
              type="button"
              aria-pressed={effectiveEditMode ? 'true' : 'false'}
              onClick={toggleEditMode}
            >
              <span class="td-member-edit-icon">
                {effectiveEditMode ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M20 6 9 17l-5-5"></path>
                  </svg>
                ) : renderEditSvgIcon()}
              </span>
              <span class="td-member-edit-text">{effectiveEditMode ? '完成' : '成員管理'}</span>
            </button>
          )}
        </div>
        <div class="td-member-filters">
          {filterOptions.map((item) => {
            const selected = item.key === activeFilter;
            return (
              <button
                key={item.key}
                type="button"
                class={`td-member-filter-chip${selected ? ' active' : ''}`}
                aria-selected={selected ? 'true' : 'false'}
                onClick={() => setSelectedFilter(item.key)}
              >
                {item.label}
                <span class="td-member-filter-count">{Number(item.count || 0)}</span>
              </button>
            );
          })}
        </div>
        <div
          class={`td-member-list-shell td-member-list-shell-summary${effectiveEditMode ? ' is-editing' : ''} td-member-filter-${activeFilter}`}
        >
          <div class="td-member-list-head">
            <span class="td-member-list-label">成員</span>
          </div>
          <div class="td-member-list">
            {visibleRoster.length > 0 ? (
              visibleRoster.map((row) => {
                const rowKey = getMemberRowKey(row);
                const matchData = getMemberMatchData(team, row);
                const jersey = formatRosterJersey(matchData.jerseyNumber);
                const position = formatRosterPosition(matchData.position);
                const emptyClass = jersey === '--' && position === '--' ? ' is-empty' : '';
                const displayName = getMemberDisplayName(row);
                const stateClass = row.isMissingName ? ' missing-name' : '';
                const uid = String(row.uid ?? '').trim();
                const userRole = getMemberUserTagRole(row);
                const canEditNote = canEditMemberNote(viewer, team) && Boolean(row.user);
                const up = getMemberRoleChangeTargetForUser(viewer, team, row.user, 'promote');
                const down = getMemberRoleChangeTargetForUser(viewer, team, row.user, 'demote');
                const showUp = row.isMember && Boolean(row.user) && up !== null;
                const showDown = row.isMember && Boolean(row.user) && down !== null;
                const canEditMatch = canEditMemberMatchData(viewer, team) && Boolean(row.user);
                // K4：A 對領隊／教練也顯示剔除鈕（前端多步寫入）；新站只對一般隊員顯示，幹部先降職（站長 11-02）。
                const showRemove = row.isMember && Boolean(row.user) && canKickMember(viewer, team, uid);
                const showActions = effectiveEditMode
                  && (canEditNote || canEditMatch || showRemove || showUp || showDown);
                const meta = buildMemberIntegratedMeta(team, row, {
                  showCourseSection,
                  showPrivateNotes,
                  matchData,
                });

                return (
                  <div
                    key={rowKey || uid}
                    class="td-member-row"
                    data-member-key={rowKey}
                    data-member-filter={activeFilter}
                  >
                    <div class="td-member-row-main">
                      <div class="td-member-line1">
                        {/* 站長 11-02：編輯模式隱藏背號／位置標籤，讓名字在 390px 放得下（一般模式照常顯示）。 */}
                        {!effectiveEditMode && (
                          <span
                            class={`td-member-roster-code${emptyClass}`}
                            aria-label="背號與位置"
                          >
                            <span class="td-member-roster-no">{jersey}</span>
                            <span class="td-member-roster-pos">{position}</span>
                          </span>
                        )}
                        <span class="td-member-name-cell">
                          {uid ? (
                            <span class={`td-member-name-wrap${stateClass}`}>
                              <UserTag
                                uid={uid}
                                name={displayName}
                                role={userRole}
                                nameClass="td-member-name-text"
                                onOpenProfile={onOpenProfile}
                              />
                            </span>
                          ) : (
                            <span
                              class={`td-member-name-static${row.isMissingName ? ' missing-name' : ''}`}
                            >
                              {displayName}
                            </span>
                          )}
                        </span>
                      </div>
                      {/* 站長 11-02 縮高：沒有內容時不出這一列（A 會顯示「-」）。 */}
                      {meta.primaryItems.length > 0 && (
                        <div class="td-member-line2">
                          {meta.primaryItems.map((item, idx) => (
                            <Fragment key={`${idx}-${item.className}`}>
                              {idx > 0 && <span class="td-member-meta-sep"></span>}
                              <span
                                class={`td-member-meta-item${item.className ? ` ${item.className}` : ''}`}
                              >
                                {item.text}
                              </span>
                            </Fragment>
                          ))}
                        </div>
                      )}
                      {meta.noteItems.length > 0 && (
                        <div class="td-member-line3">
                          {meta.noteItems.map((note, idx) => (
                            <span
                              key={`${idx}-${note.label}`}
                              class="td-member-meta-item td-member-note"
                            >
                              {renderNoteSvgIcon()}
                              {note.label && (
                                <span class="td-member-note-label">{note.label}</span>
                              )}
                              {note.text}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {showActions && (
                      <div class="td-member-action-cell td-mm-actions td-member-manage-actions">
                        {canEditNote && (
                          <button
                            class="td-member-row-edit-btn td-mm-icon-btn td-member-note-edit-btn"
                            type="button"
                            title="編輯活動備註"
                            aria-label="編輯活動備註"
                            onClick={(event) => {
                              event.stopPropagation();
                              openNote(row);
                            }}
                          >
                            {renderNoteSvgIcon()}
                            <span class="td-mm-sr-only">編輯活動備註</span>
                          </button>
                        )}
                        {canEditMatch && (
                          <button
                            class="td-member-row-edit-btn td-mm-icon-btn td-member-match-edit-btn"
                            type="button"
                            title="編輯賽事資料"
                            aria-label="編輯賽事資料"
                            onClick={(event) => {
                              event.stopPropagation();
                              openMatch(row);
                            }}
                          >
                            {renderMatchSvgIcon()}
                            <span class="td-mm-sr-only">編輯賽事資料</span>
                          </button>
                        )}
                        {showRemove && (
                          <span class="td-member-remove-cell">
                            <button
                              class="td-member-remove-btn td-mm-icon-btn td-mm-danger"
                              type="button"
                              title="剔除成員"
                              aria-label="剔除成員"
                              disabled={busy}
                              onClick={(event) => {
                                event.stopPropagation();
                                void kickRow(row);
                              }}
                            >
                              {renderTrashSvgIcon()}
                              <span class="td-mm-sr-only">剔除</span>
                            </button>
                          </span>
                        )}
                        {showUp && up && renderRoleAction(row, up)}
                        {showDown && down && renderRoleAction(row, down)}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div class="td-member-empty">{lt('teamDetail.none', '無')}</div>
            )}
          </div>
        </div>
      </div>
      {effectiveEditMode && dialog?.kind === 'note' && (
        <TeamMemberNoteDialog
          key={`note:${dialog.row.uid}`}
          memberName={getMemberDisplayName(dialog.row)}
          initialNote={dialog.initialNote}
          busy={busy}
          onSave={(notes) => { void saveNote(notes); }}
          onCancel={closeDialog}
        />
      )}
      {effectiveEditMode && dialog?.kind === 'match' && (
        <TeamMemberMatchDialog
          key={`match:${dialog.row.uid}`}
          memberName={getMemberDisplayName(dialog.row)}
          initial={dialog.initial}
          busy={busy}
          onSave={(value) => { void saveMatch(value); }}
          onCancel={closeDialog}
        />
      )}
      {effectiveEditMode && dialog?.kind === 'role' && (
        <TeamRoleConfirmDialog
          key={`role:${dialog.row.uid}:${dialog.target.direction}`}
          memberName={getMemberDisplayName(dialog.row)}
          currentRole={getTeamRoleOfMember(team, dialog.row.uid)}
          target={dialog.target}
          busy={busy}
          onConfirm={() => { void confirmRole(); }}
          onCancel={closeDialog}
        />
      )}
    </section>
  );
}
