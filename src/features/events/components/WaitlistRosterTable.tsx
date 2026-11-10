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
import { GroupLink } from './AttendanceRosterTable';
import {
  companionGroupColorVar,
  ownerInitial,
  type CompanionRowMeta,
} from '../data/companion-groups';
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

type WlRowKind = 'main' | 'companion';

interface WlRow {
  key: string;
  kind: WlRowKind;
  item: WaitlistRosterItem;
  itemIndex: number;
  companion?: WaitlistCompanionItem;
    /** 排隊號碼；本人已正取的報名人只是同行組的組頭，沒有號碼。 */
  serial: number | null;
  /** 組色與連線資訊，與正取名單同一套（companion-groups）。 */
  meta: CompanionRowMeta;
  /** 同行組的列（主報名人、同行者、註記）：不吃斑馬，改用組的上下細線。 */
  grp: string;
  /** 斑馬只在「單獨報名」的列之間交替。 */
  zebra: '' | 'att-zebra-odd' | 'att-zebra-even';
  /** 空字串＝不畫排隊連線（只有一列）。 */
  link: string;
}

function buildRows(items: readonly WaitlistRosterItem[]): WlRow[] {
  const draft: Array<Omit<WlRow, 'zebra' | 'link' | 'grp'>> = [];
  let serial = 0;
  let nextSlot = 0;
  items.forEach((item, itemIndex) => {
    const rowKey = `${item.registrationId || item.userId || item.name}:${itemIndex}`;
    const mateCount = item.companions.length;
    const slot = mateCount > 0 ? nextSlot % 4 : 0;
    if (mateCount > 0) nextSlot += 1;
    const ownerMeta: CompanionRowMeta = mateCount > 0
      ? { kind: 'lead', slot, mateCount }
      : { kind: 'solo', slot: 0 };
    const ownerConfirmed = Boolean(item.selfOrphanInfo);
    if (!ownerConfirmed) serial += 1;
    draft.push({ key: rowKey, kind: 'main', item, itemIndex, serial: ownerConfirmed ? null : serial, meta: ownerMeta });
    item.companions.forEach((companion, cIdx) => {
      const cKey = `${rowKey}:comp:${companion.companionId || cIdx}`;
      const last = cIdx === mateCount - 1;
      const mateMeta: CompanionRowMeta = {
        kind: 'mate', slot, ownerInitial: ownerInitial(item.name), connected: true, last, dashed: false,
      };
      serial += 1;
      draft.push({ key: cKey, kind: 'companion', item, itemIndex, companion, serial, meta: mateMeta });
    });
  });
  // 排隊連線只串有號碼的列：第一個號碼往下、最後一個號碼往上，中間（含沒有號碼的組頭列）貫穿。
  const numbered = draft.flatMap((row, index) => (row.serial === null ? [] : [index]));
  const firstNo = numbered[0] ?? -1;
  const lastNo = numbered[numbered.length - 1] ?? -1;
  const multi = numbered.length > 1;
  let soloStripe = 0;
  const soloStripeOf = new Map<number, number>();
  return draft.map((row, index) => {
    let link = '';
    if (multi && index >= firstNo && index <= lastNo) {
      if (index === firstNo) link = 'att-wl-link att-wl-link-first';
      else if (index === lastNo) link = 'att-wl-link att-wl-link-last';
      else link = 'att-wl-link';
    }
    const inGroup = items[row.itemIndex] !== undefined && (items[row.itemIndex]?.companions.length ?? 0) > 0;
    let grp = '';
    let zebra: WlRow['zebra'] = '';
    if (inGroup) {
      const groupRows = draft.filter((d) => d.itemIndex === row.itemIndex);
      grp = 'att-grp';
      if (groupRows[0] === row) grp += ' att-grp-first';
      if (groupRows[groupRows.length - 1] === row) grp += ' att-grp-last';
    } else {
      let stripe = soloStripeOf.get(row.itemIndex);
      if (stripe === undefined) {
        soloStripe += 1;
        stripe = soloStripe;
        soloStripeOf.set(row.itemIndex, stripe);
      }
      zebra = stripe % 2 === 1 ? 'att-zebra-odd' : 'att-zebra-even';
    }
    return { ...row, zebra, grp, link };
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
  const { items } = buildWaitlistRoster(event, registrations);

  // 對照 A：if (items.length === 0) { container.innerHTML = ''; return; }
  if (items.length === 0) return null;

  const rows = buildRows(items);
  // 「下一位遞補」＝第一個有排隊號碼的人。
  const nextKey = rows.find((r) => r.serial !== null)?.key;
  // 標題人數只算真的在排隊的人（本人已正取的組頭不是在排隊）。
  const waitingCount = rows.filter((r) => r.serial !== null).length;

  function renderSerial(row: WlRow): JSX.Element {
    if (row.serial === null) return <span class="att-wl-gap" aria-hidden="true" />;
    return <span class={`att-no${row.key === nextKey ? ' att-wl-next' : ''}`}>{row.serial}</span>;
  }

  function renderName(row: WlRow): JSX.Element {
    const groupStyle = `--cr-g:${companionGroupColorVar(row.meta.slot)}`;
    if (row.kind === 'main') {
      const tag = (
        <UserTag
          uid={row.item.userId}
          name={row.item.name}
          role={roles[row.item.userId]}
          disabled={!row.item.userId}
          nameClass="reg-name-ellipsis"
          onOpenProfile={onOpenProfile}
        />
      );
      // 報名人本人已在正取名單（只會出現在有同行者的組）：名片右邊掛「已正取」小標籤（站長 2026-11-10 指定位置）。
      return row.meta.kind === 'lead' ? (
        <span class="reg-name-text">
          <span class="cr-lead" style={groupStyle}>
            {tag}
            {row.item.selfOrphanInfo && <span class="att-wl-confirmed" data-no-translate>已正取</span>}
            <span class="cr-plus">{`+${row.meta.mateCount}`}</span>
          </span>
        </span>
      ) : (
        <span class="reg-name-text">{tag}</span>
      );
    }
    const initial = row.meta.kind === 'mate' ? row.meta.ownerInitial : '?';
    return (
      <span class="reg-name-text cr-mate-text">
        <span class="cr-pair" style={groupStyle}>
          <span class="cr-owner att-skew">{initial}</span>
          <span class="cr-cap att-skew"><span class="att-straight">{row.companion?.name ?? ''}</span></span>
        </span>
      </span>
    );
  }

  function renderNameTd(row: WlRow, className: string): JSX.Element {
    const style = `padding:.35rem .3rem;text-align:left;--cr-g:${companionGroupColorVar(row.meta.slot)}`;
    return (
      <td class={`cr-name-cell ${className}`} style={style}>
        <span class="att-name-line">
          {renderSerial(row)}
          <span class="att-name-anchor">
            {row.meta.kind !== 'solo' && <GroupLink meta={row.meta} />}
            {renderName(row)}
          </span>
        </span>
      </td>
    );
  }

  return (
    <div class="detail-section att-wl-section">
      <div class="detail-section-title att-wl-title">
        <Hourglass />
        <span>{`候補名單（${waitingCount}）`}</span>
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
              const trClass = [row.zebra, row.grp].filter(Boolean).join(' ');
              return (
                <tr key={row.key} class={trClass || undefined}>
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
                  {renderNameTd(row, nameClass)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
