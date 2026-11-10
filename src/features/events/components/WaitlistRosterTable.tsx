/**
 * 活動詳情候補名單與名單狀態調整。
 *
 * 對照舊版 A `event-detail.js#_renderGroupedWaitlistSection` 與 `event-manage-waitlist.js#_renderWaitlistSection`（檢視表格與編輯模式正取操作）。
 * 表格骨架與正取名單共用 `.att-roster`（companion-roster.css）；候補差異是 W3 排隊連線（waitlist-roster.css）。
 *
 * 不移植的行為：
 * - 以名字比對或重排（R-ID-002 刻意不移植）
 */

import type { JSX } from 'preact';
import { useT } from '@/i18n/i18n';
import type { OperateContext } from '../data/operate-permissions';
import { canAdjustRosterStatus } from '../data/roster-status-policy';
import { RosterStatusCell, RosterStatusCourseNote } from './RosterStatusControls';
import { UserTag } from '@/ui/UserTag';
import type { UserRole } from '@/ui/Avatar';
import {
  buildWaitlistRoster,
  type RosterEventInput,
  type WaitlistCompanionItem,
  type WaitlistRosterItem,
  type RosterRegistrationInput,
} from '../data/attendance-roster-model';
import './companion-roster.css';
import './waitlist-roster.css';

export interface WaitlistRosterTableProps {
  event: RosterEventInput;
  registrations: readonly RosterRegistrationInput[];
  roles: Readonly<Record<string, UserRole>>;
  onOpenProfile: (uid: string) => void;
  editing?: boolean;
  submitting?: boolean;
  rosterContext?: OperateContext;
  promotePendingKeys?: Readonly<Record<string, boolean>>;
  onPromoteParticipant?: (item: WaitlistRosterItem) => void;
}

type WlRowKind = 'main' | 'self-orphan' | 'companion' | 'companion-orphan';

interface WlRow {
  key: string;
  kind: WlRowKind;
  item: WaitlistRosterItem;
  itemIndex: number;
  companion?: WaitlistCompanionItem;
  zebra: 'att-zebra-odd' | 'att-zebra-even';
  /** 空字串＝不畫連線（只有一列）。 */
  link: string;
}

function buildRows(items: readonly WaitlistRosterItem[]): WlRow[] {
  const draft: Array<Omit<WlRow, 'zebra' | 'link'>> = [];
  items.forEach((item, itemIndex) => {
    const rowKey = `${item.registrationId || item.userId || item.name}:${itemIndex}`;
    draft.push({ key: rowKey, kind: 'main', item, itemIndex });
    if (item.selfOrphanInfo) {
      draft.push({ key: `${rowKey}:self-orphan`, kind: 'self-orphan', item, itemIndex });
    }
    item.companions.forEach((companion, cIdx) => {
      const cKey = `${rowKey}:comp:${companion.companionId || cIdx}`;
      draft.push({ key: cKey, kind: 'companion', item, itemIndex, companion });
      if (companion.orphanInfo) {
        draft.push({
          key: `${cKey}:orphan`,
          kind: 'companion-orphan',
          item,
          itemIndex,
          companion,
        });
      }
    });
  });
  const multi = draft.length > 1;
  return draft.map((row, index) => {
    let link = '';
    if (multi) {
      if (index === 0) link = 'att-wl-link att-wl-link-first';
      else if (index === draft.length - 1) link = 'att-wl-link att-wl-link-last';
      else link = 'att-wl-link';
    }
    return {
      ...row,
      zebra: row.itemIndex % 2 === 0 ? 'att-zebra-odd' : 'att-zebra-even',
      link,
    };
  });
}

function Hourglass(): JSX.Element {
  return (
    <svg
      class="att-wl-hourglass"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3h12M6 21h12M7 3c0 5 5 5 5 9s-5 4-5 9M17 3c0 5-5 5-5 9s5 4 5 9" />
    </svg>
  );
}

export function WaitlistRosterTable({
  event,
  registrations,
  roles,
  onOpenProfile,
  editing = false,
  submitting = false,
  rosterContext,
  promotePendingKeys,
  onPromoteParticipant,
}: WaitlistRosterTableProps): JSX.Element | null {
  const t = useT();
  const showPromoteColumn = Boolean(editing && rosterContext
    && canAdjustRosterStatus('promote', rosterContext, event));
  const { items, totalCount } = buildWaitlistRoster(event, registrations);

  // 對照 A：if (items.length === 0) { container.innerHTML = ''; return; }
  if (items.length === 0) return null;

  const rows = buildRows(items);

  function renderMain(row: WlRow): JSX.Element {
    return (
      <span class="att-name-line">
        <span class={`att-no${row.itemIndex === 0 ? ' att-wl-next' : ''}`}>{row.itemIndex + 1}</span>
        <UserTag
          uid={row.item.userId}
          name={row.item.name}
          role={roles[row.item.userId]}
          disabled={!row.item.userId}
          onOpenProfile={onOpenProfile}
        />
      </span>
    );
  }

  function renderFollow(row: WlRow): JSX.Element {
    if (row.kind === 'companion') {
      return (
        <span class="att-name-line">
          <span class="att-wl-follow">{`↳ ${row.companion?.name ?? ''}`}</span>
        </span>
      );
    }
    const who = row.kind === 'self-orphan' ? row.item.selfOrphanInfo : row.companion?.orphanInfo;
    const noteClass = row.kind === 'companion-orphan' ? 'att-wl-note att-wl-note-deep' : 'att-wl-note';
    return (
      <span class="att-name-line">
        <span class={noteClass}>
          {`↳ 報名人：${who ?? ''}（`}
          <span class="att-wl-ok">已正取</span>
          {'）'}
        </span>
      </span>
    );
  }

  return (
    <div class="detail-section att-wl-section">
      <div class="detail-section-title att-wl-title">
        <Hourglass />
        <span>{`候補名單（${totalCount}）`}</span>
      </div>
      <RosterStatusCourseNote event={event} editing={editing} />
      <div class="att-wl-scroll">
        <table class="att-roster att-roster-waitlist">
          <thead>
            <tr>
              {showPromoteColumn && (
                <th class="att-wl-promote-h">{t('events.roster.promoteColumn')}</th>
              )}
              <th class="att-wl-name-h" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const nameClass = row.link ? `att-wl-name ${row.link}` : 'att-wl-name';
              return (
                <tr key={row.key} class={row.zebra}>
                  {showPromoteColumn && (row.kind === 'main' ? (
                    <RosterStatusCell
                      action="promote"
                      userId={row.item.userId}
                      name={row.item.name}
                      registrations={registrations}
                      submitting={submitting}
                      pending={promotePendingKeys?.[row.item.userId]}
                      onClick={() => onPromoteParticipant?.(row.item)}
                    />
                  ) : (
                    <td />
                  ))}
                  {row.kind === 'main' ? (
                    <td class={nameClass}>{renderMain(row)}</td>
                  ) : (
                    <td class={nameClass} data-no-translate>{renderFollow(row)}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
