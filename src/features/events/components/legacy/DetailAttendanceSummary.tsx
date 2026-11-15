import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import * as userRoles from '@/data/user-roles';
import type { UserRole } from '@/ui/Avatar';
import { ownerInitial } from '../../data/companion-groups';
import './detail-attendance-summary.css';

/**
 * 讀既有 users 快取裡的性別。沒快取、過期、或測試 mock 沒提供這個匯出時回 undefined。
 * 用 namespace 取值並接住缺匯出，頁面渲染才不會因為具名綁定被讀到而中斷。
 */
export function rosterGenderOf(uid: string): '男' | '女' | '' | undefined {
  try {
    const reader = userRoles.getCachedUserGender;
    if (typeof reader !== 'function') return undefined;
    return reader(uid);
  } catch {
    return undefined;
  }
}

export interface DetailAttendanceSummaryProps {
  eventId: string;
  confirmedCount: number;
  waitlistCount: number;
  max: number;
  canManage: boolean;
  canViewRecords: boolean;
  disabled?: boolean;
  onOpen: () => void;
  onPrefetch?: () => void;
  /** 正取顯示名。只畫名單裡有的人，不補假頭像。 */
  confirmedPeople?: readonly RosterPerson[];
  /** 候補顯示名。訪客可不傳角色，頭像用一般色。 */
  waitlistPeople?: readonly RosterPerson[];
  roles?: Readonly<Record<string, UserRole | undefined>>;
  /** 性別快取查詢。沒傳、或回傳不是男／女，用一般色。不得在這裡發查詢。 */
  genderOf?: (uid: string) => '男' | '女' | '' | undefined;
}

export interface RosterPerson {
  uid: string;
  name: string;
}

/** 頭像色種類。層級＞性別＞一般。 */
export type RosterAvatarKind =
  | 'user'
  | 'male'
  | 'female'
  | 'coach'
  | 'captain'
  | 'lead'
  | 'venue'
  | 'admin'
  | 'super';

const AVATAR_PX = 26;
const MAX_STEP = 18;
const MIN_STEP = 5;
/** v6 width() 的 +8：空的頭像列是 display:none，不吃 8px gap。 */
const GROUP_EXTRA = 8;

export interface RosterAvatarFit {
  confirmed: number;
  waitlist: number;
  step: number;
}

export interface RosterAvatarPlan extends RosterAvatarFit {
  hideTitle: boolean;
}

/**
 * v6 `split`（MODE fill）：正取／候補依人數比例，兩組都有人時各至少 1 顆。
 * total === 1 時優先給正取。
 */
export function splitRosterAvatarCounts(
  total: number,
  confirmed: number,
  waitlist: number,
): [number, number] {
  if (total === 1) return confirmed ? [1, 0] : [0, 1];
  if (!waitlist) return [Math.min(total, confirmed), 0];
  if (!confirmed) return [0, Math.min(total, waitlist)];
  let confirmedShown = Math.max(1, Math.round(total * confirmed / (confirmed + waitlist)));
  let waitlistShown = Math.max(1, total - confirmedShown);
  if (confirmedShown + waitlistShown > total) confirmedShown = total - waitlistShown;
  confirmedShown = Math.min(confirmedShown, confirmed);
  waitlistShown = Math.min(waitlistShown, waitlist, total - confirmedShown);
  return [confirmedShown, waitlistShown];
}

/** v6 `width`：每組有頭像時為 26 + (顆數-1)*間距 + 8。 */
export function rosterAvatarStackWidth(confirmed: number, waitlist: number, step: number): number {
  const group = (count: number): number => (
    count > 0 ? AVATAR_PX + (count - 1) * step + GROUP_EXTRA : 0
  );
  return group(confirmed) + group(waitlist);
}

/**
 * v6 `fit` 的 fill 模式：不設上限，間距壓在 5～18px。
 * free 是量到的剩餘寬度（grow 寬度減 4）。
 */
export function fitRosterAvatars(
  free: number,
  confirmedCount: number,
  waitlistCount: number,
): RosterAvatarFit {
  const maxTotal = confirmedCount + waitlistCount;
  let bestConfirmed = 0;
  let bestWaitlist = 0;
  let step = MAX_STEP;
  for (let total = maxTotal; total > 0; total -= 1) {
    const [confirmedShown, waitlistShown] = splitRosterAvatarCounts(total, confirmedCount, waitlistCount);
    const links = Math.max(0, confirmedShown - 1) + Math.max(0, waitlistShown - 1);
    const base = rosterAvatarStackWidth(confirmedShown, waitlistShown, 0);
    if (base > free) continue;
    const nextStep = links ? Math.min(MAX_STEP, (free - base) / links) : MAX_STEP;
    if (nextStep >= MIN_STEP) {
      bestConfirmed = confirmedShown;
      bestWaitlist = waitlistShown;
      step = nextStep;
      break;
    }
  }
  return { confirmed: bestConfirmed, waitlist: bestWaitlist, step };
}

/**
 * 正取與候補都有人、各放 1 顆（間距 0 的佔位）超過 freeWithTitle 時，
 * 隱藏「出席名單」再用 freeWithoutTitle 重算。照 v6 `fit`。
 */
export function planRosterAvatars(input: {
  freeWithTitle: number;
  freeWithoutTitle: number;
  confirmedCount: number;
  waitlistCount: number;
}): RosterAvatarPlan {
  const tight = input.confirmedCount > 0
    && input.waitlistCount > 0
    && rosterAvatarStackWidth(1, 1, 0) > input.freeWithTitle;
  const free = tight ? input.freeWithoutTitle : input.freeWithTitle;
  return {
    ...fitRosterAvatars(free, input.confirmedCount, input.waitlistCount),
    hideTitle: tight,
  };
}

export function rosterAvatarKind(
  role: string | undefined,
  gender: string | undefined,
): RosterAvatarKind {
  switch (role) {
    case 'coach':
      return 'coach';
    case 'captain':
      return 'captain';
    case 'team_leader':
      return 'lead';
    case 'venue_owner':
      return 'venue';
    case 'admin':
      return 'admin';
    case 'super_admin':
      return 'super';
    default:
      break;
  }
  if (gender === '男') return 'male';
  if (gender === '女') return 'female';
  return 'user';
}

const EMPTY_PLAN: RosterAvatarPlan = {
  confirmed: 0,
  waitlist: 0,
  step: MAX_STEP,
  hideTitle: false,
};

function samePlan(left: RosterAvatarPlan, right: RosterAvatarPlan): boolean {
  return left.confirmed === right.confirmed
    && left.waitlist === right.waitlist
    && left.hideTitle === right.hideTitle
    && left.step.toFixed(1) === right.step.toFixed(1);
}

/**
 * 照舊版 A `event-detail.js#_renderDetailAttendanceSummaryShell`（第 142～163 行）。
 * 管理者與可看出席紀錄者維持這塊；一般使用者改走收合卡。
 */
function LegacyAttendanceSummary({
  eventId,
  confirmedCount,
  waitlistCount,
  max,
  canManage,
  canViewRecords,
  disabled = false,
  onOpen,
  onPrefetch,
}: DetailAttendanceSummaryProps): JSX.Element {
  const safeId = String(eventId || '').trim();
  const title = canManage || canViewRecords ? '出席管理' : '出席名單';
  const actionLabel = canManage
    ? '管理名單 / 出席紀錄'
    : canViewRecords
      ? '查看出席紀錄'
      : '查看出席名單';

  return (
    <div
      class="detail-attendance-summary"
      data-attendance-on-demand="true"
      style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;padding:.55rem .75rem;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface, var(--bg-card));"
    >
      <div style="min-width:0;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
        <div
          class="detail-section-title"
          style="margin:0;border-bottom:0;padding-bottom:0;"
        >
          {title}
        </div>
        <span style="font-size:.9rem;font-weight:700;color:var(--text-primary);font-variant-numeric:tabular-nums;white-space:nowrap;">
          {`${Math.max(0, confirmedCount)}/${Math.max(0, max)}`}
        </span>
        {waitlistCount > 0 && (
          <span style="font-size:.78rem;color:var(--text-secondary);background:var(--bg-elevated, var(--bg-card));border-radius:999px;padding:.1rem .45rem;white-space:nowrap;">
            {`候補 ${waitlistCount}`}
          </span>
        )}
      </div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap">
        <button
          type="button"
          class="detail-toolbar-btn"
          data-detail-attendance-open-button={safeId}
          disabled={disabled}
          onPointerDown={onPrefetch}
          onClick={onOpen}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

function avatarNodes(
  people: readonly RosterPerson[],
  shown: number,
  step: number,
  roles: Readonly<Record<string, UserRole | undefined>>,
  genderOf: (uid: string) => '男' | '女' | '' | undefined,
): JSX.Element[] {
  const count = Math.min(shown, people.length);
  const nodes: JSX.Element[] = [];
  for (let index = 0; index < count; index += 1) {
    const person = people[index];
    if (!person) continue;
    const kind = rosterAvatarKind(roles[person.uid], genderOf(person.uid));
    const z = count - index;
    const style = index === 0
      ? `z-index:${z}`
      : `z-index:${z};margin-left:${(step - AVATAR_PX).toFixed(1)}px`;
    nodes.push(
      <span
        key={`${person.uid}:${index}`}
        class={`detail-attendance-av detail-attendance-av--${kind}`}
        style={style}
        aria-hidden="true"
      >
        {ownerInitial(person.name)}
      </span>,
    );
  }
  return nodes;
}

function RosterSlab({
  eventId,
  confirmedCount,
  waitlistCount,
  max,
  disabled = false,
  onOpen,
  onPrefetch,
  confirmedPeople = [],
  waitlistPeople = [],
  roles = {},
  genderOf = rosterGenderOf,
}: DetailAttendanceSummaryProps): JSX.Element {
  const safeId = String(eventId || '').trim();
  const confirmed = Math.max(0, confirmedCount);
  const capacity = Math.max(0, max);
  const waiting = Math.max(0, waitlistCount);
  const drawableConfirmed = confirmed > 0 ? confirmedPeople.length : 0;
  const drawableWaitlist = waiting > 0 ? waitlistPeople.length : 0;
  const described = `出席名單，正取 ${confirmed} 人，候補 ${waiting} 人，點擊展開`;
  const domId = safeId.replace(/[^A-Za-z0-9_-]/g, '') || 'event';
  const nameId = `roster-slab-name-${domId}`;
  const descId = `roster-slab-desc-${domId}`;

  const titleRef = useRef<HTMLSpanElement>(null);
  const confirmedStackRef = useRef<HTMLSpanElement>(null);
  const waitlistStackRef = useRef<HTMLSpanElement>(null);
  const growRef = useRef<HTMLSpanElement>(null);
  const [plan, setPlan] = useState<RosterAvatarPlan>(EMPTY_PLAN);

  useLayoutEffect(() => {
    const grow = growRef.current;
    if (!grow) return;
    let alive = true;
    let measuring = false;

    const commit = (next: RosterAvatarPlan): void => {
      if (!alive) return;
      setPlan((prev) => (samePlan(prev, next) ? prev : next));
    };

    const measure = (): void => {
      if (!alive || measuring) return;
      const title = titleRef.current;
      const confirmedStack = confirmedStackRef.current;
      const waitlistStack = waitlistStackRef.current;
      measuring = true;
      try {
        if (confirmedStack) confirmedStack.style.display = 'none';
        if (waitlistStack) waitlistStack.style.display = 'none';
        if (title) title.style.display = '';
        const rawWithTitle = grow.getBoundingClientRect().width;
        if (rawWithTitle <= 0) {
          if (title) title.style.display = '';
          commit(EMPTY_PLAN);
          return;
        }
        const freeWithTitle = rawWithTitle - 4;
        let freeWithoutTitle = freeWithTitle;
        const tight = drawableConfirmed > 0
          && drawableWaitlist > 0
          && rosterAvatarStackWidth(1, 1, 0) > freeWithTitle;
        if (tight && title) {
          title.style.display = 'none';
          freeWithoutTitle = grow.getBoundingClientRect().width - 4;
        }
        let next = planRosterAvatars({
          freeWithTitle,
          freeWithoutTitle,
          confirmedCount: drawableConfirmed,
          waitlistCount: drawableWaitlist,
        });
        // 藏標題沒有多出寬度（尚未排版）時留著標題，避免 0 寬度量測把字藏掉。
        if (next.hideTitle && freeWithoutTitle <= freeWithTitle) {
          next = {
            ...fitRosterAvatars(freeWithTitle, drawableConfirmed, drawableWaitlist),
            hideTitle: false,
          };
        }
        if (title) title.style.display = next.hideTitle ? 'none' : '';
        commit(next);
      } finally {
        if (confirmedStack) confirmedStack.style.display = '';
        if (waitlistStack) waitlistStack.style.display = '';
        measuring = false;
      }
    };

    measure();
    const Observer = window.ResizeObserver;
    if (typeof Observer !== 'function') return () => { alive = false; };
    const observer = new Observer(() => measure());
    observer.observe(grow);
    if (grow.parentElement) observer.observe(grow.parentElement);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [drawableConfirmed, drawableWaitlist]);

  const open = (): void => {
    if (disabled) return;
    onOpen();
  };
  const prefetch = (): void => {
    if (disabled) return;
    onPrefetch?.();
  };

  const children: JSX.Element[] = [
    <span key="name" id={nameId} class="detail-attendance-slab__sr">查看出席名單</span>,
    <span key="desc" id={descId} class="detail-attendance-slab__sr">{described}</span>,
    <span key="count-text" class="detail-attendance-slab__sr">{`${confirmed}/${capacity}`}</span>,
    <span
      key="title"
      ref={titleRef}
      class="detail-attendance-slab__title"
      style={plan.hideTitle ? 'display:none' : undefined}
    >出席名單</span>,
    <span key="confirmed" ref={confirmedStackRef} class="detail-attendance-slab__stack">{avatarNodes(confirmedPeople, plan.confirmed, plan.step, roles, genderOf)}</span>,
    <span key="confirmed-count" class="detail-attendance-slab__count">{confirmed}<small>/{capacity}</small></span>,
  ];
  if (waiting > 0) {
    children.push(
      <span key="wait-text" class="detail-attendance-slab__sr">{`候補 ${waiting}`}</span>,
      <span key="sep" class="detail-attendance-slab__sep" />,
      <span key="waitlist" ref={waitlistStackRef} class="detail-attendance-slab__stack">{avatarNodes(waitlistPeople, plan.waitlist, plan.step, roles, genderOf)}</span>,
      <span key="wait-count" class="detail-attendance-slab__count detail-attendance-slab__count--waitlist">{waiting}</span>,
    );
  }
  children.push(
    <span key="grow" ref={growRef} class="detail-attendance-slab__grow" />,
    <span key="knob" class="detail-attendance-slab__knob" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>,
  );

  return (
    <button
      type="button"
      class="detail-attendance-summary detail-attendance-slab"
      data-attendance-on-demand="true"
      data-detail-attendance-open-button={safeId}
      aria-labelledby={nameId}
      aria-describedby={descId}
      aria-label={described}
      aria-expanded="false"
      disabled={disabled}
      onPointerDown={prefetch}
      onClick={open}
    >
      {children}
    </button>
  );
}

export function DetailAttendanceSummary(props: DetailAttendanceSummaryProps): JSX.Element {
  if (props.canManage || props.canViewRecords) return <LegacyAttendanceSummary {...props} />;
  return <RosterSlab {...props} />;
}

/** 照舊版 A `event-detail.js#_renderDetailAttendanceLoadingHtml`（第 165～172 行，結構與文字原樣）。 */
export function DetailAttendanceLoading(_props: { canManage: boolean; canViewRecords: boolean }): JSX.Element {
  return (
    <div
      class="detail-attendance-summary"
      data-attendance-loading="true"
      aria-live="polite"
      aria-busy="true"
      style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;padding:.75rem;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);"
    >
      <div style="min-width:0">
        <div class="detail-section-title" style="margin:0 0 .25rem">出席名單</div>
        <div class="reg-loading" style="padding:0;text-align:left">名單載入中...</div>
      </div>
    </div>
  );
}
