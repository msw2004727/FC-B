/**
 * 活動詳情「報名名單（出席表）」檢視與管理編輯元件。
 *
 * 對照舊版 A `event-manage-attendance.js#_doRenderAttendanceTable`。
 *
 * 分隊徽章與排序照 A；不提供名單內球衣挑選器。
 * 已接線：`CALLABLES_DEPLOYED === true` 顯示「完成」，由父層執行伺服器結算；false 回退「關閉編輯」與舊版提示。
 * - 任何以名字比對身分的分支（R-ID-002 刻意不移植）
 */

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import './companion-roster.css';
import { getSplitTeams, getTeamSplit, type TeamSplitConfig } from '../data/team-split';
import { Jersey } from './legacy/TeamSplitSection';
import { NO_SHOW_FEATURE_ENABLED, participantNoShowCount } from '../data/noshow-roster';
import type { RosterNoShowData } from './useRosterNoShow';
import { LEGACY_SETTLE_URL } from './legacy-links';
import { useT } from '@/i18n/i18n';
import { canAdjustRosterStatus } from '../data/roster-status-policy';
import type { OperateContext } from '../data/operate-permissions';
import { RosterStatusCell, RosterStatusCourseNote } from './RosterStatusControls';
import { CALLABLES_DEPLOYED } from '@/data/callables-deployed';
import { UserTag } from '@/ui/UserTag';
import type { UserRole } from '@/ui/Avatar';
import {
  getAttendancePersonKey,
  type AttendanceSelection,
} from '../data/attendance-edit';
import {
  attendanceStateFor,
  buildConfirmedRoster,
  type ConfirmedRosterPerson,
  type RosterAttendanceRecordInput,
  type RosterEventInput,
  type RosterRegistrationInput,
} from '../data/attendance-roster-model';
import {
  buildCompanionRowMeta,
  companionGroupColorVar,
  type CompanionRowMeta,
} from '../data/companion-groups';

export interface AttendanceRosterTableProps {
  event: RosterEventInput & { teamSplit?: TeamSplitConfig };
  registrations: readonly RosterRegistrationInput[];
  attendanceRecords: readonly RosterAttendanceRecordInput[];
  roles: Readonly<Record<string, UserRole>>;
  onOpenProfile: (uid: string) => void;
  /** 目前使用者是否具備現場操作權限 `canOperateEventSite === true`。 */
  canManage?: boolean;
  /** 頁面共用既有出席紀錄權限判斷，不在表格重新計算。 */
  canViewNoShow?: boolean;
  /** null／未傳代表未完成或失敗：欄位空白，膠囊不染色、不畫泡泡。 */
  noShowData?: RosterNoShowData | null;
  /** 目前使用者是否具備移除正取參加者權限 `canRemoveConfirmedParticipant === true`。 */
  canRemoveConfirmed?: boolean;
  /** 僅顯示公開名單（隱藏簽到／簽退／備註三欄）。 */
  publicRosterOnly?: boolean;
  /** 是否處於「管理名單」編輯模式。 */
  editing?: boolean;
  /** 是否正在 flush／送出中（顯示「儲存中...」並 disabled）。 */
  submitting?: boolean;
  canAdjustTeamReservation?: (teamId: string) => boolean;
  onAdjustTeamReservation?: (teamId: string) => void;
  onStartEdit?: () => void;
  onCloseEdit?: () => void;
  onKickParticipant?: (person: ConfirmedRosterPerson) => void;
  rosterContext?: OperateContext;
  demotePendingKeys?: Readonly<Record<string, boolean>>;
  onDemoteParticipant?: (person: ConfirmedRosterPerson) => void;
  getRowSelection?: (person: ConfirmedRosterPerson) => AttendanceSelection;
  inFlightKeys?: Readonly<Record<string, boolean>>;
  savedFlashKeys?: Readonly<Record<string, boolean>>;
  failedFlashKeys?: Readonly<Record<string, boolean>>;
  onToggleCheckbox?: (
    person: ConfirmedRosterPerson,
    field: 'checkin' | 'checkout',
    checked: boolean,
  ) => void;
  onChangeNote?: (person: ConfirmedRosterPerson, noteValue: string) => void;
}

const PROXY_ROW_STYLE =
  'border-bottom:1px solid var(--border);background:linear-gradient(90deg, rgba(148,163,184,.16), rgba(148,163,184,.04) 55%, transparent)';

const NAME_CELL_STYLE = 'padding:.35rem .3rem;text-align:left';

function ProxyBadgeIcon(): JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  );
}

/** 連線畫在名字 td 內。代報組的圓弧與水平段是同一條虛線路徑。 */
function GroupLink({ meta }: { meta: CompanionRowMeta }): JSX.Element | null {
  if ((meta.kind === 'lead' || meta.kind === 'proxyLead') && meta.mateCount > 0) {
    const dashed = meta.kind === 'proxyLead';
    return <span class={`cr-link cr-link-down${dashed ? ' cr-link-dashed' : ''}`} aria-hidden="true" />;
  }
  if (meta.kind === 'mate' && meta.connected) {
    const dashed = meta.dashed;
    return (
      <span class={`cr-link cr-link-mate${dashed ? ' cr-link-dashed' : ''}`} aria-hidden="true">
        <span class="cr-v cr-v-top" />
        <svg class="cr-corner" width="18" height="11" overflow="hidden" aria-hidden="true">
          <path
            d="M1 0 Q1 9 10 9 H64"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap={dashed ? 'butt' : 'round'}
            stroke-dasharray={dashed ? '6 5' : undefined}
          />
        </svg>
        {!meta.last && <span class="cr-v cr-v-bot" />}
      </span>
    );
  }
  return null;
}

// 照 A App._attendanceSortByTeam：跨活動保留，重載重置，不寫入儲存空間。
let attendanceSortByTeam = false;

export function AttendanceRosterTable({
  event,
  registrations,
  attendanceRecords,
  roles,
  onOpenProfile,
  canManage = false,
  canViewNoShow = false,
  noShowData = null,
  canRemoveConfirmed = false,
  publicRosterOnly = false,
  editing = false,
  submitting = false,
  canAdjustTeamReservation,
  onAdjustTeamReservation,
  onStartEdit,
  onCloseEdit,
  onKickParticipant,
  rosterContext,
  demotePendingKeys,
  onDemoteParticipant,
  getRowSelection,
  inFlightKeys,
  savedFlashKeys,
  failedFlashKeys,
  onToggleCheckbox,
  onChangeNote,
}: AttendanceRosterTableProps): JSX.Element {
  const [, redrawSort] = useState(0);
  const sortByTeam = attendanceSortByTeam;
  const { people, count: renderedRosterCount } = buildConfirmedRoster(event, registrations);
  const showJersey = Boolean(getTeamSplit(event)?.enabled);
  const teams = getSplitTeams(event);
  const showTeamSort = showJersey && teams.length > 0;
  if (showTeamSort && sortByTeam) {
    const teamOrder = new Map(teams.map((team, index) => [team.key, index]));
    // A 對整個 people 穩定排序；無 teamKey 的標頭、保留席位及分隔列一併墊底。
    people.sort((a, b) => (teamOrder.get(a.teamKey ?? '') ?? 999)
      - (teamOrder.get(b.teamKey ?? '') ?? 999));
  }
  // 含標頭與分隔列的實際順序。這些列是 solo，會打斷緊接，連線不跨區段。
  const rowMeta = buildCompanionRowMeta(people);
  const maxCount = Number(event.max || 0) || 0;
  const showManage = Boolean(canManage && !publicRosterOnly);
  const tableEditing = Boolean(showManage && editing);
  const isSubmitting = Boolean(showManage && submitting);
  const showAttendanceRecordColumns = !publicRosterOnly;
  const showKickColumn = Boolean(tableEditing && canRemoveConfirmed);
  const canShowNoShow = showAttendanceRecordColumns && NO_SHOW_FEATURE_ENABLED && canViewNoShow;
  const showNoShowColumn = canShowNoShow && tableEditing;
  const t = useT();
  const showDemoteColumn = Boolean(tableEditing && rosterContext
    && canAdjustRosterStatus('demote', rosterContext, event));
  const attendanceRecordColumnCount = showAttendanceRecordColumns ? 3 : 0;
  const tableColSpan = (tableEditing ? (canRemoveConfirmed ? 1 : 0) + 1 : 1) + attendanceRecordColumnCount + (showDemoteColumn ? 1 : 0) + (showNoShowColumn ? 1 : 0);
  const kickStyle =
    'font-size:.7rem;padding:.2rem .4rem;border:1px solid var(--danger);color:var(--danger);background:transparent;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap'
    + (isSubmitting ? ';opacity:.65;cursor:not-allowed' : '');
  const noteInputStyle =
    'width:100%;font-size:.72rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:3px;box-sizing:border-box'
    + (isSubmitting ? ';opacity:.7;cursor:not-allowed' : '');

  function renderDemoteCell(p: ConfirmedRosterPerson): JSX.Element | null {
    if (!showDemoteColumn) return null;
    return <RosterStatusCell action="demote" userId={p.uid} name={p.name || p.displayName}
      registrations={registrations}
      empty={p.isCompanion || p.isTeamPlaceholder || p.proxyOnly || p.isProxyOnly || p.attendanceAmbiguous}
      submitting={isSubmitting} pending={demotePendingKeys?.[p.uid]}
      onClick={() => onDemoteParticipant?.(p)} />;
  }

  function renderManageButton(): JSX.Element | null {
    if (!showManage) return null;
    if (tableEditing) {
      // 旗標 true 顯示「完成」，由 onCloseEdit 執行伺服器結算；false 回退「關閉編輯」。
      // 送出中顯示「儲存中...」，按鈕外觀照 A 綠底樣式。
      const finishStyle = `font-size:.75rem;padding:.25rem .6rem;background:#2e7d32;color:#fff;border:none;border-radius:var(--radius-sm);${
        isSubmitting ? 'cursor:not-allowed;opacity:.72' : 'cursor:pointer'
      }`;
      return (
        <button
          type="button"
          style={finishStyle}
          disabled={isSubmitting}
          onClick={() => onCloseEdit?.()}
        >
          {isSubmitting ? '儲存中...' : CALLABLES_DEPLOYED ? '完成' : '關閉編輯'}
        </button>
      );
    }
    return (
      <button
        type="button"
        style="font-size:.75rem;padding:.25rem .6rem;background:#1565c0;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer"
        onClick={() => onStartEdit?.()}
      >
        管理名單
      </button>
    );
  }

  function renderLegacySettleBanner(): JSX.Element | null {
    if (!tableEditing || CALLABLES_DEPLOYED) return null;
    return (
      <div
        role="note"
        style="display:flex;align-items:center;flex-wrap:wrap;gap:.4rem;margin:.25rem 0 .45rem;padding:.25rem .5rem;border-radius:var(--radius-sm);background:rgba(245,158,11,.14);color:var(--text-primary);font-size:.75rem;line-height:1.4"
      >
        <span>請在舊版按完成以結算經驗值與放鴿子</span>
        <a
          href={LEGACY_SETTLE_URL}
          target="_blank"
          rel="noopener noreferrer"
          style="color:var(--primary, #1565c0);font-weight:600;text-decoration:underline;white-space:nowrap"
        >
          前往舊版
        </a>
      </div>
    );
  }

  if (people.length === 0) {
    if (!showManage) {
      return (
        <div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">尚無報名</div>
      );
    }
    return (
      <div>
        <div style="display:flex;align-items:center;gap:.4rem;white-space:nowrap;margin:.2rem 0 .4rem;font-size:.8rem;font-weight:600">
          {`報名名單（0/${maxCount}）`}
          {renderManageButton()}
        </div>
        {renderLegacySettleBanner()}
        <RosterStatusCourseNote event={event} editing={tableEditing} />
        <div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">尚無報名</div>
      </div>
    );
  }

  function renderNoShowCell(p: ConfirmedRosterPerson): JSX.Element | null {
    if (!showNoShowColumn) return null;
    if (!noShowData) return <td style="padding:.35rem .2rem;text-align:center;width:3rem" />;
    if (p.proxyOnly || p.isProxyOnly || p.isTeamPlaceholder) {
      return <td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>;
    }
    const count = participantNoShowCount(p, noShowData.counts);
    // 站長 11-06：🕊 只在管理名單顯示「放鴿子/計入」，計入滿 3 場且比例 ≥50% 才標紅。
    const counted = count === null ? 0 : Number(noShowData.endedCounts.get(p.uid.trim()) || 0);
    const high = count !== null && counted >= 3 && count / counted >= 0.5;
    const text = count === null ? '—' : counted > 0 ? `${count}/${counted}` : count > 0 ? String(count) : '';
    return (
      <td style="padding:.35rem .2rem;text-align:center;width:3rem">
        <span
          title="放鴿子／計入場次"
          aria-label={count === null ? undefined : `放鴿子 ${count}，計入 ${counted}`}
          style={`font-size:.76rem;font-variant-numeric:tabular-nums;font-weight:${high ? '700' : '600'};color:${high ? 'var(--danger)' : 'var(--text-muted)'}`}
        >
          {text}
        </span>
      </td>
    );
  }

  function renderNameCell(p: ConfirmedRosterPerson, meta: CompanionRowMeta): JSX.Element {
    let nameInner: JSX.Element;
    const groupStyle = `--cr-g:${companionGroupColorVar(meta.slot)}`;

    if (meta.kind === 'proxyLead') {
      nameInner = (
        <span class="cr-proxy-line" style={groupStyle}>
          <span class="cr-ghost">{p.displayName}</span>
          <span class="cr-proxy-badge">
            <ProxyBadgeIcon />
            {t('events.roster.proxyBadge')}
          </span>
        </span>
      );
    } else if (p.isCompanion) {
      const initial = meta.kind === 'mate' ? meta.ownerInitial : '?';
      nameInner = (
        <span class="reg-name-text cr-mate-text">
          <span class="cr-pair" style={groupStyle}>
            <span class="cr-owner">{initial}</span>
            <span class="cr-cap">{p.displayName}</span>
          </span>
        </span>
      );
    } else if (p.isTeamPlaceholder) {
      nameInner = (
        <span class="team-reservation-seat-pill" title={p.displayName}>
          保留<span class="team-reservation-sr">{`：${p.teamReservationTeamName || p.displayName}`}</span>
        </span>
      );
    } else if (p.hasSelfReg) {
      const team = p.teamKey ? teams.find(candidate => candidate.key === p.teamKey) : undefined;
      const tag = (
        <UserTag
          uid={p.uid}
          name={p.displayName}
          role={roles[p.uid]}
          disabled={!p.uid}
          nameClass="reg-name-ellipsis"
          jersey={showJersey ? (
            <Jersey
              color={team?.color || ''}
              letter={team?.key || '?'}
              width={20}
              inline={false}
              ariaLabel={team ? `${team.key} 隊 - ${team.name || ''}` : undefined}
            />
          ) : undefined}
          onOpenProfile={onOpenProfile}
        />
      );
      nameInner = meta.kind === 'lead' ? (
        <span class="reg-name-text">
          <span class="cr-lead" style={groupStyle}>
            {tag}
            <span class="cr-plus">{`+${meta.mateCount}`}</span>
          </span>
        </span>
      ) : (
        <span class="reg-name-text">{tag}</span>
      );
    } else {
      nameInner = <span class="reg-name-text">{p.displayName}</span>;
    }

    const badges = p.displayBadges.filter((b) => Boolean(b.image));
    if (badges.length === 0) {
      return nameInner;
    }

    return (
      <div class="reg-name-badges-wrap">
        <div class="reg-name-badges">
          {nameInner}
          <span class="reg-badge-list">
            {badges.map((b, idx) => (
              <img
                key={`${b.image ?? ''}:${idx}`}
                class="reg-badge-icon"
                src={b.image ?? ''}
                alt={b.name ?? ''}
                loading="lazy"
              />
            ))}
          </span>
        </div>
      </div>
    );
  }

  function renderNameTd(p: ConfirmedRosterPerson, index: number): JSX.Element {
    const meta = rowMeta[index] ?? { kind: 'solo' as const, slot: 0 as const };
    if (meta.kind === 'solo') {
      return <td style={NAME_CELL_STYLE}>{renderNameCell(p, meta)}</td>;
    }
    return (
      <td
        class={`cr-name-cell${meta.kind === 'mate' ? ' cr-mate-cell' : ''}`}
        style={`${NAME_CELL_STYLE};--cr-g:${companionGroupColorVar(meta.slot)}`}
      >
        <GroupLink meta={meta} />
        {renderNameCell(p, meta)}
      </td>
    );
  }

  function renderEmptyKickCell(): JSX.Element | null {
    if (!showKickColumn) return null;
    return <td style="padding:.35rem .2rem" />;
  }

  function renderKickCell(p: ConfirmedRosterPerson): JSX.Element | null {
    if (!showKickColumn) return null;
    return (
      <td style="padding:.35rem .2rem;text-align:center">
        <button
          type="button"
          style={kickStyle}
          disabled={isSubmitting}
          onClick={() => onKickParticipant?.(p)}
        >
          踢
        </button>
      </td>
    );
  }

  // 站長 11-06 選「座位點」樣式：保留席位列只放「保留」膠囊，簽到／簽退／備註留白。
  function renderBlankAttendanceCells(): JSX.Element | null {
    if (!showAttendanceRecordColumns) return null;
    return (
      <>
        <td />
        <td />
        <td />
      </>
    );
  }

  // 實心＝已使用、空心＝剩餘；超過 10 位或已使用超過佔位（後端允許超用）改顯示「已用／總數」。
  function renderSeatSummary(p: ConfirmedRosterPerson): JSX.Element {
    const reserved = Math.max(0, Math.floor(Number(p.reservedSlots || 0)));
    const used = Math.max(0, Math.floor(Number(p.usedSlots || 0)));
    const remaining = Math.max(0, Math.floor(Number(p.remainingSlots || 0)));
    return (
      <span class="team-reservation-seats" role="img" aria-label={`佔位 ${reserved}，已使用 ${used}，剩餘 ${remaining}`}>
        {reserved > 0 && reserved <= 10 && used <= reserved ? (
          <span class="team-reservation-seat-dots" aria-hidden="true">
            {Array.from({ length: reserved }, (_, i) => (
              <i key={i} class={i < used ? 'is-used' : undefined} />
            ))}
          </span>
        ) : (
          <span class="team-reservation-seat-count" aria-hidden="true">{`${used}/${reserved}`}</span>
        )}
        <span class="team-reservation-seat-left" aria-hidden="true">{`剩 ${remaining}`}</span>
      </span>
    );
  }

  function renderEmptyAttendanceCells(label: string): JSX.Element | null {
    if (!showAttendanceRecordColumns) return null;
    return (
      <>
        <td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>
        <td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>
        <td style="padding:.35rem .3rem;font-size:.72rem;color:var(--text-muted)">{label}</td>
      </>
    );
  }

  function renderEditableAttendanceCells(
    p: ConfirmedRosterPerson,
    attendanceKey: string,
    fallbackState: { hasCheckin: boolean; hasCheckout: boolean; noteText: string },
  ): JSX.Element | null {
    if (!showAttendanceRecordColumns) return null;
    const sel = getRowSelection
      ? getRowSelection(p)
      : {
          checkin: fallbackState.hasCheckin,
          checkout: fallbackState.hasCheckout,
          note: fallbackState.noteText,
        };
    const rowBusy = isSubmitting || Boolean(inFlightKeys?.[attendanceKey]);
    const checkinId = `manual-checkin-${attendanceKey}`;
    const checkoutId = `manual-checkout-${attendanceKey}`;
    const noteId = `manual-note-${attendanceKey}`;

    return (
      <>
        <td style="padding:.35rem .2rem;text-align:center">
          <input
            type="checkbox"
            id={checkinId}
            class="att-cb"
            checked={sel.checkin}
            disabled={rowBusy}
            aria-label={`${p.displayName} 簽到`}
            onChange={(e) => {
              onToggleCheckbox?.(p, 'checkin', e.currentTarget.checked);
            }}
          />
          <label for={checkinId} class="att-lbl">
            <span class="att-box" />
          </label>
        </td>
        <td style="padding:.35rem .2rem;text-align:center">
          <input
            type="checkbox"
            id={checkoutId}
            class="att-cb"
            checked={sel.checkout}
            disabled={rowBusy}
            aria-label={`${p.displayName} 簽退`}
            onChange={(e) => {
              onToggleCheckbox?.(p, 'checkout', e.currentTarget.checked);
            }}
          />
          <label for={checkoutId} class="att-lbl">
            <span class="att-box" />
          </label>
        </td>
        <td style="padding:.35rem .3rem">
          <input
            type="text"
            maxLength={20}
            value={sel.note}
            id={noteId}
            placeholder="備註"
            disabled={isSubmitting}
            style={noteInputStyle}
            aria-label={`${p.displayName} 備註`}
            onInput={(e) => {
              onChangeNote?.(p, e.currentTarget.value);
            }}
          />
        </td>
      </>
    );
  }

  return (
    <div style="overflow-x:auto">
      {renderLegacySettleBanner()}
      <RosterStatusCourseNote event={event} editing={tableEditing} />
      <table
        class={tableEditing ? 'att-roster-managing' : undefined}
        style="width:100%;border-collapse:collapse;font-size:.8rem;table-layout:fixed"
      >
        <thead>
          <tr style="border-bottom:2px solid var(--border)">
            {showKickColumn && (
              <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2rem">踢</th>
            )}
            {showDemoteColumn && <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2rem">{t('events.roster.demoteColumn')}</th>}
            <th style="text-align:left;padding:.4rem .3rem;font-weight:600">
              <div style="display:flex;align-items:center;gap:.4rem;white-space:nowrap">
                {showTeamSort && (
                  <button
                    type="button"
                    class={`att-team-sort-btn${sortByTeam ? ' active' : ''}`}
                    title="依球衣顏色排序"
                    aria-label="依球衣顏色排序"
                    aria-pressed={sortByTeam}
                    onClick={e => {
                      e.stopPropagation();
                      attendanceSortByTeam = !attendanceSortByTeam;
                      redrawSort(value => value + 1);
                    }}
                  >
                    <svg viewBox="0 0 20 20" width="18" height="18" fill="none"
                      stroke={sortByTeam ? '#fff' : 'var(--text-secondary)'}
                      stroke-width="2" stroke-linecap="round" aria-hidden="true">
                      <path d="M6 4v12M6 4l-3 3M6 4l3 3" />
                      <path d="M14 16V4M14 16l-3-3M14 16l3-3" />
                    </svg>
                  </button>
                )}
                {`報名名單（${renderedRosterCount}/${maxCount}）`}
                {renderManageButton()}
              </div>
            </th>
            {showNoShowColumn && (
              <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:3rem" title="放鴿子／計入場次" aria-label="放鴿子／計入場次">🕊</th>
            )}
            {showAttendanceRecordColumns && (
              <>
                <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
                <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
                <th style="text-align:left;padding:.4rem .3rem;font-weight:600;width:4.5rem">備註</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {people.map((p, index) => {
            const rowKey = `${p.regDocId || p.uid || 'row'}:${index}`;

            if (p.isTeamGeneralSeparator) {
              return (
                <tr key={rowKey} class="team-reservation-general-row">
                  <td colSpan={tableColSpan}>
                    <div class="team-reservation-general-divider">
                      <span>一般報名</span>
                    </div>
                  </td>
                </tr>
              );
            }

            if (p.isTeamHeader) {
              return (
                <tr key={rowKey} class="team-reservation-header-row">
                  <td colSpan={tableColSpan} class="team-reservation-header-cell">
                    <div class="team-reservation-section-title">
                      <div class="team-reservation-section-main">
                        <span class="team-reservation-section-avatar" aria-hidden="true">
                          {Array.from(p.teamReservationTeamName || p.displayName || '俱')[0]}
                        </span>
                        <strong class="team-reservation-section-name">
                          {p.teamReservationTeamName || p.displayName}
                        </strong>
                      </div>
                      {renderSeatSummary(p)}
                      {!submitting && p.teamReservationTeamId
                        && canAdjustTeamReservation?.(p.teamReservationTeamId) && (
                        <button type="button" class="team-reservation-adjust-btn"
                          aria-label="快速調整"
                          onClick={() => onAdjustTeamReservation?.(p.teamReservationTeamId!)}>調整</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            }

            const attendanceKey = getAttendancePersonKey(p);
            const isProxyOnly = Boolean(p.proxyOnly || p.isProxyOnly);

            if (tableEditing) {
              if (isProxyOnly) {
                return (
                  <tr
                    key={rowKey}
                    data-attendance-key={attendanceKey}
                    style={PROXY_ROW_STYLE}
                  >
                    {renderEmptyKickCell()}
                    {renderDemoteCell(p)}
                    {renderNameTd(p, index)}
                    {renderNoShowCell(p)}
                    {renderEmptyAttendanceCells('僅代報')}
                  </tr>
                );
              }
              if (p.isTeamPlaceholder) {
                return (
                  <tr
                    key={rowKey}
                    data-attendance-key={attendanceKey}
                    class="team-reservation-placeholder-row"
                  >
                    {renderEmptyKickCell()}
                    {renderDemoteCell(p)}
                    {renderNameTd(p, index)}
                    {renderNoShowCell(p)}
                    {renderBlankAttendanceCells()}
                  </tr>
                );
              }
            } else {
              if (p.isTeamPlaceholder) {
                return (
                  <tr key={rowKey} class="team-reservation-placeholder-row">
                    {renderNameTd(p, index)}
                    {renderNoShowCell(p)}
                    {renderBlankAttendanceCells()}
                  </tr>
                );
              }
              if (isProxyOnly) {
                return (
                  <tr key={rowKey} style={PROXY_ROW_STYLE}>
                    {renderNameTd(p, index)}
                    {renderNoShowCell(p)}
                    {renderEmptyAttendanceCells('僅代報')}
                  </tr>
                );
              }
            }

            const state = attendanceStateFor(p, attendanceRecords, '僅代報');
            const flashClass = savedFlashKeys?.[attendanceKey]
              ? 'att-row-saved'
              : failedFlashKeys?.[attendanceKey]
                ? 'att-row-failed'
                : '';
            const rowClasses = [
              p.teamReservationTeamId ? 'team-reservation-member-row' : '',
              flashClass,
            ]
              .filter(Boolean)
              .join(' ');

            if (state.ambiguous) {
              return (
                <tr
                  key={rowKey}
                  data-attendance-key={tableEditing ? attendanceKey : undefined}
                  class={rowClasses || undefined}
                  style="border-bottom:1px solid var(--border)"
                >
                  {tableEditing && renderKickCell(p)}
                  {renderDemoteCell(p)}
                  {renderNameTd(p, index)}
                  {renderNoShowCell(p)}
                  {renderEmptyAttendanceCells('請至課程點名')}
                </tr>
              );
            }

            if (tableEditing) {
              return (
                <tr
                  key={rowKey}
                  data-attendance-key={attendanceKey}
                  class={rowClasses || undefined}
                  style="border-bottom:1px solid var(--border)"
                >
                  {renderKickCell(p)}
                  {renderDemoteCell(p)}
                  {renderNameTd(p, index)}
                  {renderNoShowCell(p)}
                  {renderEditableAttendanceCells(p, attendanceKey, state)}
                </tr>
              );
            }

            return (
              <tr
                key={rowKey}
                class={rowClasses || undefined}
                style="border-bottom:1px solid var(--border)"
              >
                {renderNameTd(p, index)}
                {renderNoShowCell(p)}
                {showAttendanceRecordColumns && (
                  <>
                    <td style="padding:.35rem .2rem;text-align:center">
                      {state.hasCheckin ? (
                        <span style="color:var(--success);font-size:1rem">✓</span>
                      ) : null}
                    </td>
                    <td style="padding:.35rem .2rem;text-align:center">
                      {state.hasCheckout ? (
                        <span style="color:var(--success);font-size:1rem">✓</span>
                      ) : null}
                    </td>
                    <td style="padding:.35rem .3rem;font-size:.72rem;color:var(--text-muted)">
                      {state.combinedNote}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
