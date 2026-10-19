/**
 * 活動詳情「報名名單（出席表）」檢視與管理編輯元件。
 *
 * 對照舊版 A `event-manage-attendance.js#_doRenderAttendanceTable`。
 *
 * 本批不做（下一批補）：
 * - 「踢」「候」欄（移除正取、降為候補）
 * - 未報名掃碼表（`_renderUnregTable`）
 * - 放鴿子欄與出席率染色（R-STAT-000）
 * - 分隊排序與分隊徽章
 * - 伺服器結算 `CALLABLES_DEPLOYED === true` 的「完成」路徑（本批 CALLABLES_DEPLOYED 為 false，只顯示「關閉編輯」與前往舊版提示）
 * - 任何以名字比對身分的分支（R-ID-002 刻意不移植）
 */

import './attendance-roster.css';
import type { JSX } from 'preact';
import { CALLABLES_DEPLOYED } from '@/data/callables-deployed';
import { useT } from '@/i18n/i18n';
import { Text } from '@/ui/Text';
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
  /** 是否處於「管理名單」編輯模式。 */
  editing?: boolean;
  /** 是否正在 flush／送出中（顯示「儲存中...」並 disabled）。 */
  submitting?: boolean;
  onStartEdit?: () => void;
  onCloseEdit?: () => void;
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

const TABLE_COLSPAN = 4; // 姓名 + 簽到 + 簽退 + 備註（本批不含踢／候／放鴿子欄）
const LEGACY_SETTLE_URL = 'https://toosterx.com/';

export function AttendanceRosterTable({
  event,
  registrations,
  attendanceRecords,
  roles,
  onOpenProfile,
  canManage = false,
  editing = false,
  submitting = false,
  onStartEdit,
  onCloseEdit,
  getRowSelection,
  inFlightKeys,
  savedFlashKeys,
  failedFlashKeys,
  onToggleCheckbox,
  onChangeNote,
}: AttendanceRosterTableProps): JSX.Element {
  const t = useT();
  const { people, count: renderedRosterCount } = buildConfirmedRoster(event, registrations);
  const maxCount = Number(event.max || 0) || 0;
  const tableEditing = Boolean(canManage && editing);
  const isSubmitting = Boolean(canManage && submitting);

  function renderManageButton(): JSX.Element | null {
    if (!canManage) return null;
    if (tableEditing) {
      // CALLABLES_DEPLOYED === true 的伺服器結算路徑於下一批實作；
      // 本批旗標為 false，按鈕文字固定為「關閉編輯」（送出中顯示「儲存中...」）。
      const label = isSubmitting
        ? t('events.roster.saving')
        : t('events.roster.closeEdit');
      return (
        <button
          type="button"
          class="att-roster-manage-btn att-roster-manage-btn--finish"
          disabled={isSubmitting}
          onClick={() => onCloseEdit?.()}
        >
          <Text>{label}</Text>
        </button>
      );
    }
    return (
      <button
        type="button"
        class="att-roster-manage-btn att-roster-manage-btn--start"
        onClick={() => onStartEdit?.()}
      >
        <Text>{t('events.roster.manage')}</Text>
      </button>
    );
  }

  function renderLegacySettleBanner(): JSX.Element | null {
    if (!tableEditing || CALLABLES_DEPLOYED) return null;
    return (
      <div class="att-roster-legacy-hint" role="note">
        <Text>{t('events.roster.settleInLegacy')}</Text>
        <a
          class="att-roster-legacy-link"
          href={LEGACY_SETTLE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Text>{t('events.roster.goLegacy')}</Text>
        </a>
      </div>
    );
  }

  if (people.length === 0) {
    if (!canManage) {
      return (
        <div class="att-roster-empty">
          <Text>{t('events.roster.empty')}</Text>
        </div>
      );
    }
    return (
      <div>
        <div class="att-roster-empty-header">
          <Text>{t('events.roster.title', { count: 0, max: maxCount })}</Text>
          {renderManageButton()}
        </div>
        {renderLegacySettleBanner()}
        <div class="att-roster-empty">
          <Text>{t('events.roster.empty')}</Text>
        </div>
      </div>
    );
  }

  function renderNameCell(p: ConfirmedRosterPerson): JSX.Element {
    const isProxyOnly = Boolean(p.proxyOnly || p.isProxyOnly);
    let nameInner: JSX.Element;

    if (isProxyOnly) {
      nameInner = (
        <span class="reg-name-text reg-name-text--proxy">
          <Text>{p.displayName}</Text>
        </span>
      );
    } else if (p.isCompanion) {
      nameInner = (
        <span class="reg-name-text reg-name-text--companion">
          <Text>{`↳ ${p.displayName}`}</Text>
        </span>
      );
    } else if (p.isTeamPlaceholder) {
      nameInner = (
        <span class="reg-name-text team-reservation-placeholder-name">
          <Text>{p.displayName}</Text>
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
      nameInner = (
        <span class="reg-name-text">
          <Text>{p.displayName}</Text>
        </span>
      );
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

  function renderEmptyAttendanceCells(label: string): JSX.Element {
    return (
      <>
        <td class="att-roster-td-dash"><Text>--</Text></td>
        <td class="att-roster-td-dash"><Text>--</Text></td>
        <td class="att-roster-td-note"><Text>{label}</Text></td>
      </>
    );
  }

  function renderEditableAttendanceCells(
    p: ConfirmedRosterPerson,
    attendanceKey: string,
    fallbackState: { hasCheckin: boolean; hasCheckout: boolean; noteText: string },
  ): JSX.Element {
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
        <td class="att-roster-td-check">
          <input
            type="checkbox"
            id={checkinId}
            class="att-cb"
            checked={sel.checkin}
            disabled={rowBusy}
            aria-label={`${p.displayName} ${t('events.roster.checkin')}`}
            onChange={(e) => {
              onToggleCheckbox?.(p, 'checkin', e.currentTarget.checked);
            }}
          />
          <label for={checkinId} class="att-lbl">
            <span class="att-box" />
          </label>
        </td>
        <td class="att-roster-td-check">
          <input
            type="checkbox"
            id={checkoutId}
            class="att-cb"
            checked={sel.checkout}
            disabled={rowBusy}
            aria-label={`${p.displayName} ${t('events.roster.checkout')}`}
            onChange={(e) => {
              onToggleCheckbox?.(p, 'checkout', e.currentTarget.checked);
            }}
          />
          <label for={checkoutId} class="att-lbl">
            <span class="att-box" />
          </label>
        </td>
        <td class="att-roster-td-note">
          <input
            type="text"
            id={noteId}
            class="att-roster-note-input"
            maxLength={20}
            value={sel.note}
            placeholder={t('events.roster.note')}
            disabled={isSubmitting}
            aria-label={`${p.displayName} ${t('events.roster.note')}`}
            onInput={(e) => {
              onChangeNote?.(p, e.currentTarget.value);
            }}
          />
        </td>
      </>
    );
  }

  return (
    <div class="att-roster-scroll">
      {renderLegacySettleBanner()}
      <table class="att-roster-table">
        <thead>
          <tr class="att-roster-thead-row">
            <th class="att-roster-th-name">
              <div class="att-roster-th-name-inner">
                <Text>
                  {t('events.roster.title', { count: renderedRosterCount, max: maxCount })}
                </Text>
                {renderManageButton()}
              </div>
            </th>
            <th class="att-roster-th-check"><Text>{t('events.roster.checkin')}</Text></th>
            <th class="att-roster-th-check"><Text>{t('events.roster.checkout')}</Text></th>
            <th class="att-roster-th-note"><Text>{t('events.roster.note')}</Text></th>
          </tr>
        </thead>
        <tbody>
          {people.map((p, index) => {
            const rowKey = `${p.regDocId || p.uid || 'row'}:${index}`;

            if (p.isTeamGeneralSeparator) {
              return (
                <tr key={rowKey} class="team-reservation-general-row">
                  <td colSpan={TABLE_COLSPAN}>
                    <div class="team-reservation-general-divider">
                      <Text>{t('events.roster.generalSection')}</Text>
                    </div>
                  </td>
                </tr>
              );
            }

            if (p.isTeamHeader) {
              return (
                <tr key={rowKey} class="team-reservation-header-row">
                  <td colSpan={TABLE_COLSPAN} class="team-reservation-header-cell">
                    <div class="team-reservation-section-title">
                      <div class="team-reservation-section-main">
                        <span class="team-reservation-section-avatar" aria-hidden="true">
                          <Text>{t('events.roster.clubBadge')}</Text>
                        </span>
                        <strong class="team-reservation-section-name">
                          <Text>{p.teamReservationTeamName || p.displayName}</Text>
                        </strong>
                      </div>
                      <span class="team-reservation-summary">
                        <Text>
                          {t('events.roster.reservedSlots', { count: Number(p.reservedSlots || 0) })}
                        </Text>
                        <Text>
                          {t('events.roster.usedSlots', { count: Number(p.usedSlots || 0) })}
                        </Text>
                        <Text>
                          {t('events.roster.remainingSlots', { count: Number(p.remainingSlots || 0) })}
                        </Text>
                      </span>
                    </div>
                  </td>
                </tr>
              );
            }

            const attendanceKey = getAttendancePersonKey(p);

            if (p.isTeamPlaceholder) {
              return (
                <tr
                  key={rowKey}
                  data-attendance-key={tableEditing ? attendanceKey : undefined}
                  class="team-reservation-placeholder-row att-roster-row--placeholder"
                >
                  <td class="att-roster-td-name">{renderNameCell(p)}</td>
                  {renderEmptyAttendanceCells(t('events.roster.reservedSeat'))}
                </tr>
              );
            }

            const isProxyOnly = Boolean(p.proxyOnly || p.isProxyOnly);
            if (isProxyOnly) {
              return (
                <tr
                  key={rowKey}
                  data-attendance-key={tableEditing ? attendanceKey : undefined}
                  class="att-roster-row--proxy"
                >
                  <td class="att-roster-td-name">{renderNameCell(p)}</td>
                  {renderEmptyAttendanceCells(t('events.roster.proxyOnly'))}
                </tr>
              );
            }

            const state = attendanceStateFor(
              p,
              attendanceRecords,
              t('events.roster.proxyOnly'),
            );
            const flashClass = savedFlashKeys?.[attendanceKey]
              ? ' att-row-saved'
              : failedFlashKeys?.[attendanceKey]
                ? ' att-row-failed'
                : '';
            const memberRowClass = `${
              p.teamReservationTeamId
                ? 'team-reservation-member-row att-roster-row'
                : 'att-roster-row'
            }${flashClass}`;

            if (state.ambiguous) {
              return (
                <tr
                  key={rowKey}
                  data-attendance-key={tableEditing ? attendanceKey : undefined}
                  class={memberRowClass}
                >
                  <td class="att-roster-td-name">{renderNameCell(p)}</td>
                  {renderEmptyAttendanceCells(t('events.roster.courseRollcall'))}
                </tr>
              );
            }

            if (tableEditing) {
              return (
                <tr
                  key={rowKey}
                  data-attendance-key={attendanceKey}
                  class={memberRowClass}
                >
                  <td class="att-roster-td-name">{renderNameCell(p)}</td>
                  {renderEditableAttendanceCells(p, attendanceKey, state)}
                </tr>
              );
            }

            return (
              <tr key={rowKey} class={memberRowClass}>
                <td class="att-roster-td-name">{renderNameCell(p)}</td>
                <td class="att-roster-td-check">
                  {state.hasCheckin ? (
                    <span class="att-roster-check-mark"><Text>✓</Text></span>
                  ) : null}
                </td>
                <td class="att-roster-td-check">
                  {state.hasCheckout ? (
                    <span class="att-roster-check-mark"><Text>✓</Text></span>
                  ) : null}
                </td>
                <td class="att-roster-td-note">
                  {state.combinedNote ? <Text>{state.combinedNote}</Text> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
