// A. 指派與邀請。新外觀起主辦三頁與受邀者、記分員同一種玻璃卡。

import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Modal } from '@/ui/Modal';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { CpGate } from '../ui/feedback';
import { CpFrame, InfoIcon, LockIcon, TrashIcon } from '../ui/shell';
import { StatusTag, type StatusKind } from '../ui/status-tag';
import {
  S4B_ASSIGN_PEOPLE,
  S4B_COMP_NAME,
  S4B_MATCHES,
  S4B_NOW,
  S4B_SCORER_ID,
  S4B_STAFF,
  canRemoveStaff,
  clockLabel,
  formatMdHm,
  groupMatches,
  matchById,
  matchesByIds,
  scorerMatchOrder,
  staffAssignmentCount,
  weekdayIndex,
  type AssignRole,
  type S4bMatch,
  type S4bStaff,
  type StaffViewer,
} from '../testing/step4b-fixtures';
import { assignRoleLabel, copy, matchStatusLabel, staffRoleLabel, weekdayName } from './copy';
import { Line, MatchBits, S4bCard, S4bFrame, vsLabel } from './ui';

/**
 * 主辦兼記分那一列的角色標籤。外觀沿用 Badge 的類別，但不經過 Text：Text 會在中文詞之間插 <wbr>
 *（ui/Text.tsx 的斷詞設計），窄寬時標籤被壓縮就會把「記分員」拆成兩行（顧問 11-20 staging 量測）。
 */
function RoleTag({ label }: { label: string }): JSX.Element {
  return (
    <span class="ui-badge ui-badge--soft ui-badge--sm d2-tag d2-tag--neutral s4b-role-tag" title={label}>
      <span class="ui-badge__label">{label}</span>
    </span>
  );
}

function dayText(month: number, day: number, weekday: number): string {
  return copy.dayHeading(month, day, weekdayName[weekday] ?? '');
}

export interface StaffListRow {
  id: string;
  name: string;
  role: S4bStaff['role'];
  roleLabel: string;
  countLabel: string;
  removable: boolean;
  /** 記分指派到期（有記分角色且有到期才給）。顯示在名字下一行。 */
  expiresLabel?: string;
  /** 主辦／共同主辦本人也被指派記分時，在主要角色旁多顯示的記分角色（顧問 11-20：到期跟著記分角色，不讓主辦身分看起來會到期）。 */
  extraRoles?: readonly { role: S4bStaff['role']; label: string }[];
}

export interface StaffConfirm {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  error?: string;
}

export function StaffListScreen(props: {
  viewerRole?: StaffViewer;
  title?: string;
  rows?: readonly StaffListRow[];
  onRemove?: (id: string) => void;
  onAssign?: () => void;
  onBack?: () => void;
  confirm?: StaffConfirm | null;
  onConfirm?: () => void;
  onDismiss?: () => void;
  confirmBusy?: boolean;
  /** 有給才出現「邀請記分員」鈕（與指派並排）。 */
  inviteLabel?: string;
  onInvite?: () => void;
  /** 按鈕下方的區塊（尚未使用的邀請）。 */
  children?: ComponentChildren;
  /** 頁首賽事名小字（拿不到就不畫）。 */
  context?: string;
  /** 垃圾桶的報讀名稱（帶對象）；沒給時用「移除」加名字。 */
  removeLabel?: (name: string) => string;
} = {}): JSX.Element {
  const viewerRole = props.viewerRole ?? 'host';
  const controlled = props.rows != null;
  const [local, setLocal] = useState<readonly S4bStaff[]>(S4B_STAFF);
  const screen = viewerRole === 'host' ? 'staff-list' : 'staff-list-cohost';
  const rows: readonly StaffListRow[] = controlled
    ? props.rows ?? []
    : local.map((staff) => ({
      id: staff.id,
      name: staff.name,
      role: staff.role,
      roleLabel: staffRoleLabel[staff.role],
      countLabel: copy.assigned(staffAssignmentCount(staff)),
      removable: canRemoveStaff(viewerRole, staff.role),
    }));
  return (
    <S4bFrame title={props.title ?? copy.staffTitle} screen={screen} context={props.context} onBack={props.onBack}>
      <S4bCard class="s4b-listcard">
        <ul class="cps-list s4b-staff-list">
          {rows.map((staff) => {
            // 主辦兼記分：第一列只放名字、場次、移除鈕；角色標籤（不壓縮、不拆字、放不下整顆換行）與到期放第二列。
            const multi = (staff.extraRoles?.length ?? 0) > 0;
            const twoLine = multi || !!staff.expiresLabel;
            return (
            <li key={staff.id} class="s4b-li">
              <div class={`s4b-staff${twoLine ? ' s4b-staff--exp' : ''}${multi ? ' s4b-staff--multi' : ''}`}>
                <span class="s4b-staff__name">{staff.name}</span>
                {multi ? (
                  <span class="s4b-staff__roles">
                    <RoleTag label={staff.roleLabel} />
                    {(staff.extraRoles ?? []).map((extra) => <RoleTag key={extra.role} label={extra.label} />)}
                    {staff.expiresLabel ? <span class="s4b-staff__exp-inline">{staff.expiresLabel}</span> : null}
                  </span>
                ) : (
                  <StatusTag kind="neutral" label={staff.roleLabel} />
                )}
                <span class="s4b-staff__meta">{staff.countLabel}</span>
                <span class="s4b-staff__gap" />
                {!multi && staff.expiresLabel ? <span class="s4b-staff__exp">{staff.expiresLabel}</span> : null}
                {staff.removable ? (
                  <span class="s4b-mini">
                    <button
                      type="button"
                      class="cps-iconbtn cps-iconbtn--flat"
                      aria-label={props.removeLabel ? props.removeLabel(staff.name) : `${copy.remove} ${staff.name}`}
                      onClick={() => {
                        if (controlled) props.onRemove?.(staff.id);
                        else setLocal((prev) => prev.filter((row) => row.id !== staff.id));
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </span>
                ) : <span class="s4b-mini" aria-hidden="true" />}
              </div>
            </li>
            );
          })}
        </ul>
      </S4bCard>
      {/* 正式頁在賽事結束後不給 onAssign／onInvite（一致性盤點 #11），兩顆都沒有就整列不畫；示範頁（不受控）照舊。 */}
      {!controlled || props.onAssign || props.onInvite ? (
        <div class="s4b-pair">
          {!controlled || props.onAssign ? <Button variant="primary" onClick={props.onAssign}>{copy.assignScorer}</Button> : null}
          {props.onInvite ? (
            <Button variant="secondary" onClick={props.onInvite}>{props.inviteLabel ?? copy.generateInvite}</Button>
          ) : null}
        </div>
      ) : null}
      {props.children}
      {props.confirm ? (
        <Modal
          open
          class="d2-panel"
          title={props.confirm.title}
          busy={props.confirmBusy}
          error={props.confirm.error}
          onClose={() => {
            if (!props.confirmBusy) props.onDismiss?.();
          }}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" disabled={props.confirmBusy} onClick={props.onDismiss}>{props.confirm.cancelLabel}</Button>
              <Button variant="danger" loading={props.confirmBusy} disabled={props.confirmBusy} onClick={props.onConfirm}>{props.confirm.confirmLabel}</Button>
            </div>
          )}
        >
          <p class="cp3-modal-p">{props.confirm.body}</p>
        </Modal>
      ) : null}
    </S4bFrame>
  );
}

export interface AssignDayGroup {
  key: string;
  heading: string;
  /**
   * label 是完整的一句（勾選框的報讀名稱）。有 vs 時畫成三段：時間（跨日的日期 day 放在上面）｜場地｜對戰；
   * 沒有 vs（示範畫面的內建資料）時畫成共用勾選、整句一行。
   */
  matches: readonly { id: string; label: string; day?: string; time?: string; venue?: string; vs?: string }[];
}

/** 指派表單的一場：外觀沿用勾選元件的 class，標記自己畫（共用 Checkbox 的標籤只收字串）；可及名稱仍是整句。 */
function MatchCheckRow({
  match,
  checked,
  onToggle,
}: {
  match: AssignDayGroup['matches'][number];
  checked: boolean;
  onToggle: (on: boolean) => void;
}): JSX.Element {
  return (
    <div class={`ui-checkbox s4b-mrow${checked ? ' ui-checkbox--checked' : ''}`}>
      <label class="ui-checkbox__label">
        <input
          type="checkbox"
          checked={checked}
          aria-label={match.label}
          onChange={(event) => {
            onToggle(event.currentTarget.checked);
            // 受控：畫面上的勾選以 props 為準，下一次重繪才換（同共用 Checkbox）。
            event.currentTarget.checked = checked;
          }}
        />
        <span class="s4b-mrow__when" aria-hidden="true">
          {match.day ? <small>{match.day}</small> : null}
          {match.time ? <b class="d2-num">{match.time}</b> : null}
        </span>
        <span class="s4b-mrow__court" aria-hidden="true">{match.venue}</span>
        <span class="s4b-mrow__vs" aria-hidden="true">{match.vs}</span>
      </label>
    </div>
  );
}

export function StaffAssignScreen(props: {
  title?: string;
  people?: readonly { id: string; name: string }[];
  person?: string;
  onPerson?: (id: string) => void;
  days?: readonly AssignDayGroup[];
  picked?: ReadonlySet<string>;
  onToggle?: (id: string, on: boolean) => void;
  role?: AssignRole;
  onRole?: (role: AssignRole) => void;
  roleLabel?: string;
  scorerLabel?: string;
  refereeLabel?: string;
  personLabel?: string;
  saveLabel?: string;
  saving?: boolean;
  error?: string;
  onSave?: () => void;
  onBack?: () => void;
  /** false：不顯示人員下拉（邀請表單）。 */
  showPerson?: boolean;
  /** 外框標題旁的 data-screen。 */
  screen?: string;
  /** 頁首賽事名小字（拿不到就不畫）。 */
  context?: string;
} = {}): JSX.Element {
  const controlled = props.days != null;
  const [personState, setPersonState] = useState<string>(S4B_ASSIGN_PEOPLE[0].id);
  const [pickedState, setPickedState] = useState<ReadonlySet<string>>(new Set());
  const [roleState, setRoleState] = useState<AssignRole>('scorer');
  const person = controlled ? (props.person ?? '') : personState;
  const picked = controlled ? (props.picked ?? new Set<string>()) : pickedState;
  const role = controlled ? (props.role ?? 'scorer') : roleState;
  const people = controlled
    ? (props.people ?? [])
    : S4B_ASSIGN_PEOPLE.map((item) => ({ id: item.id, name: item.name }));
  const days: readonly AssignDayGroup[] = controlled
    ? props.days ?? []
    : groupMatches(S4B_MATCHES).map((group) => ({
      key: group.key,
      heading: dayText(group.month, group.day, group.weekday),
      matches: group.matches.map((match) => ({
        id: match.id,
        label: `${clockLabel(match.kickoffAt).time} ${match.venue} ${vsLabel(match)}`,
      })),
    }));
  function toggle(id: string, on: boolean): void {
    if (controlled) {
      props.onToggle?.(id, on);
      return;
    }
    setPickedState((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function setRole(value: AssignRole): void {
    if (controlled) props.onRole?.(value);
    else setRoleState(value);
  }
  const error = props.error ?? '';
  return (
    <S4bFrame title={props.title ?? copy.assignTitle} screen={props.screen ?? 'staff-assign'} context={props.context} onBack={props.onBack}>
      <S4bCard>
        <div class="s4b-gap">
          {props.showPerson === false ? null : <Select
            label={props.personLabel ?? copy.person}
            value={person}
            onValueChange={(value) => {
              if (controlled) props.onPerson?.(value);
              else setPersonState(value);
            }}
            options={people.map((item) => ({ value: item.id, label: item.name }))}
          />}
          {days.map((group) => (
            <div key={group.key} class="s4b-daygroup">
              <p class="s4b-day">{group.heading}</p>
              {group.matches.map((match) => (match.vs != null ? (
                <MatchCheckRow key={match.id} match={match} checked={picked.has(match.id)} onToggle={(on) => toggle(match.id, on)} />
              ) : (
                <Checkbox
                  key={match.id}
                  label={match.label}
                  checked={picked.has(match.id)}
                  onCheckedChange={(on) => toggle(match.id, on)}
                />
              )))}
            </div>
          ))}
          <RadioGroup
            name="s4b-assign-role"
            label={props.roleLabel ?? copy.role}
            value={role}
            onValueChange={(value) => setRole(value === 'referee' ? 'referee' : 'scorer')}
            options={[
              { value: 'scorer', label: props.scorerLabel ?? assignRoleLabel.scorer },
              { value: 'referee', label: props.refereeLabel ?? assignRoleLabel.referee },
            ]}
          />
          {error ? <p class="s4b-err" role="alert">{error}</p> : null}
          <div class="s4b-blockbtn">
            <Button
              variant="primary"
              loading={props.saving === true}
              disabled={props.saving === true}
              onClick={props.onSave}
            >
              {props.saveLabel ?? copy.save}
            </Button>
          </div>
        </div>
      </S4bCard>
    </S4bFrame>
  );
}

function AcceptBody({ title, sentence }: { title: string; sentence: string }): JSX.Element {
  return (
    <S4bCard>
      <h2 class="s4b-h">{title}</h2>
      <p class="s4b-alert">{sentence}</p>
    </S4bCard>
  );
}

export type InviteAcceptStatus = 'active' | 'revoked' | 'expired' | 'cancelled';

const INVITE_DEAD: Record<Exclude<InviteAcceptStatus, 'active'>, { title: string; sentence: string }> = {
  revoked: { title: copy.inviteRevokedTitle, sentence: copy.inviteRevoked },
  expired: { title: copy.inviteExpiredTitle, sentence: copy.inviteExpired },
  cancelled: { title: copy.compCancelledTitle, sentence: copy.compCancelled },
};

export function InviteAcceptScreen({ status = 'active' }: { status?: InviteAcceptStatus }): JSX.Element {
  const screen = status === 'active' ? 'invite-accept' : 'invite-accept-invalid';
  if (status !== 'active') {
    const dead = INVITE_DEAD[status];
    return (
      <S4bFrame title={copy.acceptTitle} screen={screen}>
        <AcceptBody title={dead.title} sentence={dead.sentence} />
      </S4bFrame>
    );
  }
  const matches = matchesByIds(['m_1400', 'm_2200']);
  return (
    <S4bFrame title={copy.acceptTitle} screen={screen}>
      <S4bCard>
        <div class="s4b-gap">
          <h2 class="s4b-h">{S4B_COMP_NAME}</h2>
          <Line text={copy.kv(copy.role, assignRoleLabel.scorer)} />
          {matches.map((match) => (
            <div key={match.id} class="s4b-m__top">
              <MatchBits match={match} />
              <span class="s4b-k">{vsLabel(match)}</span>
            </div>
          ))}
          <div class="s4b-blockbtn">
            <Button variant="primary">{copy.accept}</Button>
          </div>
        </div>
      </S4bCard>
    </S4bFrame>
  );
}

export interface ScorerMatchRow {
  id: string;
  match: S4bMatch;
  statusLabel: string;
  /** 狀態標籤長相；null＝不放標籤（未開賽，共同裁定第 12 條）。 */
  statusKind: StatusKind | null;
  showEnter: boolean;
  /** 沒有開賽時間時改寫時刻，不用窄體字。 */
  timeLabel?: string;
  /** 升成記分板卡的那一場（全頁最多一場）：lit＝進行中或中場（亮燈），off＝最早一場未開賽。 */
  board?: 'lit' | 'off';
}

export interface ScorerDay {
  key: string;
  heading: string;
  matches: readonly ScorerMatchRow[];
}

/**
 * 挑記分板卡（新外觀卡 3-3，第 3 批 3.6）：只在已讀進來的清單裡挑，不另外查。
 * 進行中或中場（statusKind live）優先；沒有就挑清單順序（由早到晚）最前面的一場未開賽（statusKind null）；都沒有就不放板。
 */
export function markScorerBoard(days: readonly ScorerDay[]): ScorerDay[] {
  const rows = days.flatMap((day) => day.matches);
  const lit = rows.find((row) => row.statusKind === 'live');
  const pick = lit ?? rows.find((row) => row.statusKind === null);
  if (!pick) return [...days];
  const board: 'lit' | 'off' = lit ? 'lit' : 'off';
  return days.map((day) => ({
    ...day,
    matches: day.matches.map((row) => (row === pick ? { ...row, board } : row)),
  }));
}

function fixtureScorerDays(): ScorerDay[] {
  const staff = S4B_STAFF.find((row) => row.id === S4B_SCORER_ID);
  const matches = scorerMatchOrder(matchesByIds(staff?.matchIds ?? []), S4B_NOW);
  return markScorerBoard(groupMatches(matches).map((group) => ({
    key: group.key,
    heading: dayText(group.month, group.day, weekdayIndex(group.key) ?? group.weekday),
    matches: group.matches.map((match) => ({
      id: match.id,
      match,
      statusLabel: matchStatusLabel[match.status],
      statusKind: match.status === 'live' ? 'live' as const : match.status === 'scheduled' ? null : 'neutral' as const,
      showEnter: true,
    })),
  })));
}

/** 開賽時間：有時間＝窄體數字（跨日另給「隔日」）；沒有時間＝中文「時間待定」用一般字。 */
function rowClock(row: ScorerMatchRow): { time: string; nextDay: boolean; tbd: boolean } {
  if (row.timeLabel) return { time: row.timeLabel, nextDay: false, tbd: true };
  const clock = clockLabel(row.match.kickoffAt);
  return { time: clock.time, nextDay: clock.nextDay, tbd: false };
}

/** 記分板卡：外面一圈玻璃、上面嵌板、板下玻璃上放這一頁唯一的實心青綠鈕。最外層保留 .s4b-m（測試靠它找「進行中」那一場）。 */
function ScorerBoardCard({ row, enterLabel, onEnter }: { row: ScorerMatchRow; enterLabel: string; onEnter?: (id: string) => void }): JSX.Element {
  const lit = row.board === 'lit';
  const clock = rowClock(row);
  return (
    <div class="s4b-m s4b-mb">
      <div class={lit ? 'd2-sb d2-sb--lit s4b-mb__sb' : 'd2-sb s4b-mb__sb'}>
        <div class="s4b-mb__top">
          {lit ? <span class="d2-sb__st"><i aria-hidden="true" />{row.statusLabel}</span> : null}
          {row.match.venue ? <span class="s4b-mb__venue">{row.match.venue}</span> : null}
        </div>
        <div class={clock.nextDay ? 's4b-mb__main s4b-mb__main--2' : 's4b-mb__main'}>
          <span class={clock.tbd ? 's4b-mb__tbd' : 'd2-num s4b-mb__time'}>{clock.time}</span>
          {clock.nextDay ? <span class="s4b-mb__next">{copy.nextDay}</span> : null}
          {/* 主隊｜對｜客隊三段相連（讀起來仍是「甲對乙」），兩隊各自省略、客隊不會整個消失（11-21 實量補定） */}
          <span class="s4b-mb__vs">
            <span class="s4b-mb__team">{row.match.home}</span>
            <span class="s4b-mb__x">{copy.vs('', '')}</span>
            <span class="s4b-mb__team">{row.match.away}</span>
          </span>
        </div>
      </div>
      {row.showEnter ? (
        <div class="s4b-mb__act">
          <Button variant="primary" onClick={() => onEnter?.(row.id)}>{enterLabel}</Button>
        </div>
      ) : null}
    </div>
  );
}

/** 其餘各場：時間（窄體）＋場地＋（跨日）隔日＋靠右的狀態標籤；第二行對戰＋小顆次要鈕。 */
function ScorerListRow({ row, enterLabel, onEnter }: { row: ScorerMatchRow; enterLabel: string; onEnter?: (id: string) => void }): JSX.Element {
  const clock = rowClock(row);
  return (
    <div class="s4b-m">
      <div class="s4b-mr__top">
        <span class={clock.tbd ? 's4b-mr__tbd' : 'd2-num s4b-mr__time'}>{clock.time}</span>
        {row.match.venue ? <span class="s4b-mr__venue">{row.match.venue}</span> : null}
        {clock.nextDay ? <StatusTag kind="neutral" label={copy.nextDay} /> : null}
        {row.statusKind ? <StatusTag kind={row.statusKind} label={row.statusLabel} class="s4b-mr__st" /> : null}
      </div>
      <div class="s4b-between">
        <span class="s4b-k s4b-mr__vs">{vsLabel(row.match)}</span>
        {row.showEnter ? (
          <Button variant="secondary" size="sm" onClick={() => onEnter?.(row.id)}>{enterLabel}</Button>
        ) : null}
      </div>
    </div>
  );
}

export function ScorerMatchesScreen(props: {
  title?: string;
  days?: readonly ScorerDay[];
  empty?: string;
  enterLabel?: string;
  onEnter?: (id: string) => void;
  onBack?: () => void;
} = {}): JSX.Element {
  const days = props.days ?? fixtureScorerDays();
  const enterLabel = props.enterLabel ?? copy.enterScore;
  return (
    <S4bFrame title={props.title ?? copy.scorerTitle} screen="scorer-my-matches" onBack={props.onBack}>
      {days.length === 0 ? (
        <S4bCard><p class="s4b-mempty">{props.empty ?? ''}</p></S4bCard>
      ) : null}
      {days.map((group) => {
        const board = group.matches.find((row) => row.board);
        const rest = group.matches.filter((row) => !row.board);
        return (
          <div key={group.key} class="s4b-mgroup">
            <p class="s4b-mday">{group.heading}</p>
            {board ? <ScorerBoardCard row={board} enterLabel={enterLabel} onEnter={props.onEnter} /> : null}
            {rest.length > 0 ? (
              <section class="cps-card s4b-mlist">
                {rest.map((row) => <ScorerListRow key={row.id} row={row} enterLabel={enterLabel} onEnter={props.onEnter} />)}
              </section>
            ) : null}
          </div>
        );
      })}
    </S4bFrame>
  );
}

export function StaffDeniedScreen({
  title,
  message,
  backLabel,
  onBack,
  failed = false,
}: {
  title: string;
  message: string;
  backLabel: string;
  onBack: () => void;
  /** 讀取失敗用圓圈 i；沒有權限（預設）用鎖頭。 */
  failed?: boolean;
}): JSX.Element {
  return (
    <CpFrame title={title} onBack={onBack}>
      <CpGate icon={failed ? <InfoIcon /> : <LockIcon />} text={message}>
        <Button variant="primary" onClick={onBack}>{backLabel}</Button>
      </CpGate>
    </CpFrame>
  );
}

/** 真資料的邀請列。roleLabel、countLabel、expiresLabel 由頁面組好。 */
export interface OpenInviteRow {
  id: string;
  roleLabel: string;
  countLabel: string;
  expiresLabel: string;
}

export function OpenInviteList(props: {
  title: string;
  empty: string;
  rows: readonly OpenInviteRow[];
  revokeLabel: string;
  /** 沒給就不畫撤銷鈕（賽事結束後撤銷會被後端拒絕）。 */
  onRevoke?: (id: string) => void;
  /** 讀取失敗：顯示訊息與重試，不顯示「沒有」。 */
  failed?: { message: string; retryLabel: string; onRetry: () => void } | null;
}): JSX.Element {
  return (
    <S4bCard>
      <h2 class="s4b-h s4b-inv__h">{props.title}</h2>
      {props.failed ? (
        <div class="s4b-gap">
          <p class="s4b-alert s4b-inv__once" role="alert"><InfoIcon /><span>{props.failed.message}</span></p>
          <span class="s4b-mini">
            <Button variant="secondary" size="sm" onClick={props.failed.onRetry}>{props.failed.retryLabel}</Button>
          </span>
        </div>
      ) : props.rows.length === 0 ? <p class="s4b-foot">{props.empty}</p> : (
        <ul class="cps-list s4b-inv-list">
          {props.rows.map((row) => (
            <li key={row.id} class="s4b-li" data-invite={row.id}>
              <div class="s4b-gap s4b-inv">
                <div class="s4b-m__top">
                  <span class="s4b-k s4b-inv__role">{row.roleLabel}</span>
                  <span class="s4b-k s4b-inv__n">{row.countLabel}</span>
                  <span class="s4b-staff__gap" />
                  {props.onRevoke ? (
                    <span class="s4b-mini">
                      <Button variant="danger" size="sm" onClick={() => props.onRevoke?.(row.id)}>{props.revokeLabel}</Button>
                    </span>
                  ) : null}
                </div>
                <p class="s4b-inv__exp">{row.expiresLabel}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </S4bCard>
  );
}

/** 建立成功後的連結。連結只在這一頁的記憶體裡，離開就沒有。 */
export function InviteLinkCard(props: {
  title: string;
  url: string;
  once: string;
  roleLine: string;
  expiresLine: string;
  copyLabel: string;
  shareLabel: string;
  onCopy: () => void;
  onShare: () => void;
}): JSX.Element {
  return (
    <S4bCard>
      <div class="s4b-gap s4b-link">
        <h2 class="s4b-h">{props.title}</h2>
        <Line text={props.roleLine} />
        <Line text={props.expiresLine} />
        <p class="s4b-inv__url" data-invite-url>{props.url}</p>
        <p class="s4b-alert s4b-inv__once" role="note"><InfoIcon /><span>{props.once}</span></p>
        <div class="s4b-pair">
          <Button variant="primary" onClick={props.onCopy}>{props.copyLabel}</Button>
          <Button variant="secondary" onClick={props.onShare}>{props.shareLabel}</Button>
        </div>
      </div>
    </S4bCard>
  );
}
