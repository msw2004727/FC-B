/**
 * 活動詳情「報名名單（出席表）」檢視與管理編輯元件。
 *
 * 對照舊版 A `event-manage-attendance.js#_doRenderAttendanceTable`。
 *
 * 本批不做（下一批補）：
 * - 降候補待新 Callable（「候」欄表頭與欄位都不輸出）
 * - 放鴿子欄與出席率染色（R-STAT-000）
 * - 分隊排序與分隊徽章
 * - 伺服器結算 `CALLABLES_DEPLOYED === true` 的「完成」路徑（本批 CALLABLES_DEPLOYED 為 false，只顯示「關閉編輯」與前往舊版提示）
 * - 任何以名字比對身分的分支（R-ID-002 刻意不移植）
 */

import type { JSX } from 'preact';
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

export interface AttendanceRosterTableProps {
  event: RosterEventInput;
  registrations: readonly RosterRegistrationInput[];
  attendanceRecords: readonly RosterAttendanceRecordInput[];
  roles: Readonly<Record<string, UserRole>>;
  onOpenProfile: (uid: string) => void;
  /** 目前使用者是否具備現場操作權限 `canOperateEventSite === true`。 */
  canManage?: boolean;
  /** 目前使用者是否具備移除正取參加者權限 `canRemoveConfirmedParticipant === true`。 */
  canRemoveConfirmed?: boolean;
  /** 僅顯示公開名單（隱藏簽到／簽退／備註三欄）。 */
  publicRosterOnly?: boolean;
  /** 是否處於「管理名單」編輯模式。 */
  editing?: boolean;
  /** 是否正在 flush／送出中（顯示「儲存中...」並 disabled）。 */
  submitting?: boolean;
  onStartEdit?: () => void;
  onCloseEdit?: () => void;
  onKickParticipant?: (person: ConfirmedRosterPerson) => void;
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

const LEGACY_SETTLE_URL = 'https://toosterx.com/';
const PROXY_ROW_STYLE =
  'border-bottom:1px solid var(--border);background:linear-gradient(90deg, rgba(148,163,184,.16), rgba(148,163,184,.04) 55%, transparent)';

export function AttendanceRosterTable({
  event,
  registrations,
  attendanceRecords,
  roles,
  onOpenProfile,
  canManage = false,
  canRemoveConfirmed = false,
  publicRosterOnly = false,
  editing = false,
  submitting = false,
  onStartEdit,
  onCloseEdit,
  onKickParticipant,
  getRowSelection,
  inFlightKeys,
  savedFlashKeys,
  failedFlashKeys,
  onToggleCheckbox,
  onChangeNote,
}: AttendanceRosterTableProps): JSX.Element {
  const { people, count: renderedRosterCount } = buildConfirmedRoster(event, registrations);
  const maxCount = Number(event.max || 0) || 0;
  const showManage = Boolean(canManage && !publicRosterOnly);
  const tableEditing = Boolean(showManage && editing);
  const isSubmitting = Boolean(showManage && submitting);
  const showAttendanceRecordColumns = !publicRosterOnly;
  const showKickColumn = Boolean(tableEditing && canRemoveConfirmed);
  // 降候補待新 Callable（「候」欄表頭與欄位都不輸出）
  const attendanceRecordColumnCount = showAttendanceRecordColumns ? 3 : 0;
  const tableColSpan = (tableEditing ? (canRemoveConfirmed ? 1 : 0) + 1 : 1) + attendanceRecordColumnCount;
  const kickStyle =
    'font-size:.7rem;padding:.2rem .4rem;border:1px solid var(--danger);color:var(--danger);background:transparent;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap'
    + (isSubmitting ? ';opacity:.65;cursor:not-allowed' : '');
  const noteInputStyle =
    'width:100%;font-size:.72rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:3px;box-sizing:border-box'
    + (isSubmitting ? ';opacity:.7;cursor:not-allowed' : '');

  function renderManageButton(): JSX.Element | null {
    if (!showManage) return null;
    if (tableEditing) {
      // CALLABLES_DEPLOYED === true 的伺服器結算路徑於下一批實作；
      // 本批旗標為 false，按鈕文字固定為「關閉編輯」（送出中顯示「儲存中...」），按鈕外觀照 A 綠底樣式。
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
          {isSubmitting ? '儲存中...' : '關閉編輯'}
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
        <div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">尚無報名</div>
      </div>
    );
  }

  function renderNameCell(p: ConfirmedRosterPerson): JSX.Element {
    const isProxyOnly = Boolean(p.proxyOnly || p.isProxyOnly);
    let nameInner: JSX.Element;

    if (isProxyOnly) {
      nameInner = (
        <span class="reg-name-text" style="color:var(--text-muted);font-weight:600">
          {p.displayName}
        </span>
      );
    } else if (p.isCompanion) {
      nameInner = (
        <span class="reg-name-text" style="padding-left:1.2rem;color:var(--text-secondary)">
          {`↳ ${p.displayName}`}
        </span>
      );
    } else if (p.isTeamPlaceholder) {
      nameInner = (
        <span class="reg-name-text team-reservation-placeholder-name">
          {p.displayName}
        </span>
      );
    } else if (p.hasSelfReg) {
      nameInner = (
        <span class="reg-name-text">
          <UserTag
            uid={p.uid}
            name={p.displayName}
            role={roles[p.uid]}
            disabled={!p.uid}
            onOpenProfile={onOpenProfile}
          />
        </span>
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
      <table style="width:100%;border-collapse:collapse;font-size:.8rem;table-layout:fixed">
        <thead>
          <tr style="border-bottom:2px solid var(--border)">
            {showKickColumn && (
              <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2rem">踢</th>
            )}
            {/* 降候補待新 Callable */}
            <th style="text-align:left;padding:.4rem .3rem;font-weight:600">
              <div style="display:flex;align-items:center;gap:.4rem;white-space:nowrap">
                {`報名名單（${renderedRosterCount}/${maxCount}）`}
                {renderManageButton()}
              </div>
            </th>
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
                          俱
                        </span>
                        <strong class="team-reservation-section-name">
                          {p.teamReservationTeamName || p.displayName}
                        </strong>
                      </div>
                      <span class="team-reservation-summary">
                        <span>{`佔位: ${Number(p.reservedSlots || 0)}`}</span>
                        <span>{`已使用: ${Number(p.usedSlots || 0)}`}</span>
                        <span>{`剩餘: ${Number(p.remainingSlots || 0)}`}</span>
                      </span>
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
                    {/* 降候補待新 Callable */}
                    <td style="padding:.35rem .3rem;text-align:left">{renderNameCell(p)}</td>
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
                    {/* 降候補待新 Callable */}
                    <td style="padding:.35rem .3rem;text-align:left">{renderNameCell(p)}</td>
                    {renderEmptyAttendanceCells('保留席位')}
                  </tr>
                );
              }
            } else {
              if (p.isTeamPlaceholder) {
                return (
                  <tr key={rowKey} class="team-reservation-placeholder-row">
                    <td style="padding:.35rem .3rem;text-align:left">{renderNameCell(p)}</td>
                    {renderEmptyAttendanceCells('保留席位')}
                  </tr>
                );
              }
              if (isProxyOnly) {
                return (
                  <tr key={rowKey} style={PROXY_ROW_STYLE}>
                    <td style="padding:.35rem .3rem;text-align:left">{renderNameCell(p)}</td>
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
                  {/* 降候補待新 Callable */}
                  <td style="padding:.35rem .3rem;text-align:left">{renderNameCell(p)}</td>
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
                  {/* 降候補待新 Callable */}
                  <td style="padding:.35rem .3rem;text-align:left">{renderNameCell(p)}</td>
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
                <td style="padding:.35rem .3rem;text-align:left">{renderNameCell(p)}</td>
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
