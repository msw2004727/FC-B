import { Fragment, type JSX } from 'preact';
import { lt } from '@/i18n/i18n';
import { useState } from 'preact/hooks';
import { toast } from '@/ui/Toast';
import { UserTag } from '@/ui/UserTag';
import { isTeamDetailSectionVisible } from '../../data/team-detail-model';
import type { TeamDoc, TeamRosterRow } from '../../data/types';
import {
  buildMemberIntegratedMeta,
  formatRosterJersey,
  formatRosterPosition,
  getMemberDisplayName,
  getMemberMatchData,
  getMemberRowKey,
  getMemberUserTagRole,
  getTeamMemberFilterOptions,
  teamMemberMatchesFilter,
  type LegacyMemberFilterKey,
} from './legacy-team-member-model';

export interface LegacyTeamMembersCardProps {
  team: TeamDoc;
  roster: readonly TeamRosterRow[];
  canManageMembers: boolean;
  onOpenProfile: (uid: string) => void;
}

function renderEditSvgIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
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
  canManageMembers,
  onOpenProfile,
}: LegacyTeamMembersCardProps): JSX.Element {
  const [selectedFilter, setSelectedFilter] = useState<LegacyMemberFilterKey>('all');

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

  // B 沒有 staffIdentity，用 canManageMembers 作為 _canViewTeamMemberPrivateNotes 的條件（A 的 fallback 即為 !!canManageMembers）。
  const showPrivateNotes = Boolean(canManageMembers);

  const handleManageClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    // 編輯模式下一批補
    toast.show({ message: '此功能尚未開放，請先使用舊版' });
  };

  return (
    <section class="td-member-management-panel" id="team-members-section">
      <div class="td-member-panel-pad">
        <div id="team-members-toggle" class="td-member-top">
          <div class="td-member-head-copy">
            <div class="td-member-total">{`${roster.length} 位成員`}</div>
          </div>
          {canManageMembers && (
            <button
              class="td-member-edit-btn"
              type="button"
              aria-pressed="false"
              onClick={handleManageClick}
            >
              <span class="td-member-edit-icon">{renderEditSvgIcon()}</span>
              <span class="td-member-edit-text">成員管理</span>
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
          class={`td-member-list-shell td-member-list-shell-summary td-member-filter-${activeFilter}`}
        >
          <div class="td-member-list-head">
            <span class="td-member-list-label">成員資料</span>
            {showPrivateNotes && (
              <span class="td-member-list-note-hint">備註僅職員可見</span>
            )}
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
                        <span
                          class={`td-member-roster-code${emptyClass}`}
                          aria-label="背號與位置"
                        >
                          <span class="td-member-roster-no">{jersey}</span>
                          <span class="td-member-roster-pos">{position}</span>
                        </span>
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
                      <div class="td-member-line2">
                        {meta.primaryItems.length > 0 ? (
                          meta.primaryItems.map((item, idx) => (
                            <Fragment key={`${idx}-${item.className}`}>
                              {idx > 0 && <span class="td-member-meta-sep"></span>}
                              <span
                                class={`td-member-meta-item${item.className ? ` ${item.className}` : ''}`}
                              >
                                {item.text}
                              </span>
                            </Fragment>
                          ))
                        ) : (
                          <span class="td-member-meta-muted">-</span>
                        )}
                      </div>
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
                  </div>
                );
              })
            ) : (
              <div class="td-member-empty">{lt('teamDetail.none', '無')}</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
