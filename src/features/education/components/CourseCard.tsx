// 課程卡（K1-1）：名稱、類型、時間、地點、人數／名額、價格、一顆動作鈕。
import type { JSX } from 'preact';
import type { CourseT } from '../i18n';
import type { CardState, CoursePlan } from '../data/course-model';
import { isPlanFull } from '../data/course-model';
import { countText, priceText, scheduleText, typeChipText } from '../data/course-format';
import { IconClock, IconPin } from './icons';

export interface CourseCardProps {
  ct: CourseT;
  plan: CoursePlan;
  state: CardState;
  effectiveCount: number | null;
  /** 幹部看到「管理」取代報名鈕；pendingReview＞0 時加數字。 */
  staff?: { pendingReview: number } | null;
  busy?: boolean;
  onOpen: () => void;
  onSignup: () => void;
  onCancelPending: () => void;
  onLessons: () => void;
  onManage: () => void;
}

function stop(fn: () => void): (e: Event) => void {
  return (e) => {
    e.stopPropagation();
    fn();
  };
}

export function CourseCard({
  ct,
  plan,
  state,
  effectiveCount,
  staff,
  busy,
  onOpen,
  onSignup,
  onCancelPending,
  onLessons,
  onManage,
}: CourseCardProps): JSX.Element {
  const schedule = scheduleText(ct, plan);
  const price = priceText(ct, plan);
  const count = countText(ct, effectiveCount, plan.maxCapacity);
  const full = isPlanFull(plan, effectiveCount);

  let action: JSX.Element;
  if (staff) {
    action = (
      <button type="button" class="ck-btn ck-btn-o" data-action="manage" onClick={stop(onManage)}>
        {ct('btn.manage')}
        {staff.pendingReview > 0 ? <span class="ck-badge">{staff.pendingReview}</span> : null}
      </button>
    );
  } else if (state === 'pending') {
    action = (
      <button type="button" class="ck-btn ck-btn-red" data-action="cancel-pending" disabled={busy} onClick={stop(onCancelPending)}>
        {ct('btn.cancelApply')}
      </button>
    );
  } else if (state === 'enrolled') {
    action = (
      <button type="button" class="ck-btn ck-btn-o" data-action="lessons" onClick={stop(onLessons)}>
        {ct('btn.lessons')}
      </button>
    );
  } else if (state === 'closed' || state === 'full') {
    action = (
      <button type="button" class="ck-btn ck-btn-dis" data-action={state} disabled>
        {ct(state === 'full' ? 'btn.full' : 'btn.closed')}
      </button>
    );
  } else {
    action = (
      <button type="button" class="ck-btn" data-action="signup" disabled={busy} onClick={stop(onSignup)}>
        {ct('btn.signup')}
      </button>
    );
  }

  return (
    <div
      class="ck-card ck-card-tap"
      data-plan-id={plan.id}
      data-state={state}
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
    >
      <div class="ck-card-h">
        <b>{plan.name}</b>
        {state === 'pending' ? <span class="ck-chip ck-chip-warn">{ct('chip.pending')}</span> : null}
        {state === 'enrolled' ? <span class="ck-chip ck-chip-acc">{ct('chip.enrolled')}</span> : null}
        <span class="ck-chip">{typeChipText(ct, plan)}</span>
      </div>
      {schedule ? (
        <div class="ck-meta">
          <IconClock />
          <span>{schedule}</span>
        </div>
      ) : null}
      {plan.location ? (
        <div class="ck-meta">
          <IconPin />
          <span>{plan.location}</span>
        </div>
      ) : null}
      <div class="ck-card-f">
        {count ? <span class={full ? 'ck-cnt ck-cnt-full' : 'ck-cnt'}>{count}</span> : null}
        {price ? <span class="ck-price">{price}</span> : null}
        {action}
      </div>
      {/* 顧問 §3.60 (c)：已核准不提供學員自行取消（伺服器只取消審核中的報名），改一行請聯繫教練；教練移除留 K3。 */}
      {state === 'enrolled' && !staff ? <div class="ck-hint" data-hint="contact-coach">{ct('hint.contactCoach')}</div> : null}
    </div>
  );
}
