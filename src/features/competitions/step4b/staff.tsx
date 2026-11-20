// A. 指派與邀請。主辦三頁是後台，平面卡片；受邀者與記分員沿用賽事頁卡片。

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Modal } from '@/ui/Modal';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { CpFrame } from '../ui/shell';
import {
  S4B_ASSIGN_PEOPLE,
  S4B_COMP_NAME,
  S4B_INVITE_EXPIRES,
  S4B_INVITE_PATH,
  S4B_INVITES,
  S4B_MATCHES,
  S4B_NOW,
  S4B_SCORER_ID,
  S4B_STAFF,
  canRemoveStaff,
  canRevokeInvite,
  clockLabel,
  formatMdHm,
  groupMatches,
  inviteLife,
  matchById,
  matchesByIds,
  scorerMatchOrder,
  staffAssignmentCount,
  weekdayIndex,
  type AssignRole,
  type S4bInvite,
  type S4bMatch,
  type S4bStaff,
  type StaffViewer,
} from '../testing/step4b-fixtures';
import { assignRoleLabel, copy, inviteLifeLabel, matchStatusLabel, staffRoleLabel, weekdayName } from './copy';
import { Line, MatchBits, S4bCard, S4bFrame, vsLabel } from './ui';

function roleTone(role: S4bStaff['role']): 'brand' | 'neutral' | 'info' | 'warning' {
  if (role === 'host') return 'brand';
  if (role === 'scorer') return 'info';
  if (role === 'referee') return 'warning';
  return 'neutral';
}

function lifeTone(life: ReturnType<typeof inviteLife>): 'success' | 'neutral' | 'danger' | 'warning' {
  if (life === 'active') return 'success';
  if (life === 'revoked') return 'danger';
  if (life === 'expired') return 'warning';
  return 'neutral';
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
    <S4bFrame title={props.title ?? copy.staffTitle} admin screen={screen} onBack={props.onBack}>
      <S4bCard plain>
        <ul class="cps-list s4b-staff-list">
          {rows.map((staff) => (
            <li key={staff.id} class="s4b-li">
              <div class="s4b-staff">
                <span class="s4b-staff__name">{staff.name}</span>
                <Badge tone={roleTone(staff.role)} size="sm" label={staff.roleLabel} />
                <span class="s4b-staff__meta">{staff.countLabel}</span>
                <span class="s4b-staff__gap" />
                {staff.removable ? (
                  <span class="s4b-mini">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (controlled) props.onRemove?.(staff.id);
                        else setLocal((prev) => prev.filter((row) => row.id !== staff.id));
                      }}
                    >
                      {copy.remove}
                    </Button>
                  </span>
                ) : <span class="s4b-mini" aria-hidden="true" />}
              </div>
            </li>
          ))}
        </ul>
      </S4bCard>
      <div class="s4b-pair">
        <Button variant="primary" onClick={props.onAssign}>{copy.assignScorer}</Button>
      </div>
      {props.confirm ? (
        <Modal
          open
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
  matches: readonly { id: string; label: string }[];
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
  const days = controlled
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
    <S4bFrame title={props.title ?? copy.assignTitle} admin screen="staff-assign" onBack={props.onBack}>
      <S4bCard plain>
        <div class="s4b-gap">
          <Select
            label={props.personLabel ?? copy.person}
            value={person}
            onValueChange={(value) => {
              if (controlled) props.onPerson?.(value);
              else setPersonState(value);
            }}
            options={people.map((item) => ({ value: item.id, label: item.name }))}
          />
          {days.map((group) => (
            <div key={group.key}>
              <p class="s4b-day">{group.heading}</p>
              {group.matches.map((match) => (
                <Checkbox
                  key={match.id}
                  label={match.label}
                  checked={picked.has(match.id)}
                  onCheckedChange={(on) => toggle(match.id, on)}
                />
              ))}
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

function InviteRow({ row, onRevoke }: { row: S4bInvite; onRevoke: (id: string) => void }): JSX.Element {
  const life = inviteLife(row, S4B_NOW);
  const match = matchById(row.matchIds[0] ?? '');
  return (
    <li class="s4b-li">
      <div class="s4b-gap" style="width:100%">
        <div class="s4b-m__top">
          <span class="s4b-k">{assignRoleLabel[row.role]}</span>
          {match ? <span class="s4b-k">{clockLabel(match.kickoffAt).time}</span> : null}
          <Badge tone={lifeTone(life)} size="sm" label={inviteLifeLabel[life]} />
          <span class="s4b-staff__gap" />
          {canRevokeInvite(life) ? (
            <span class="s4b-mini">
              <Button variant="danger" size="sm" onClick={() => onRevoke(row.id)}>{copy.revoke}</Button>
            </span>
          ) : null}
        </div>
        <p class="s4b-status">{copy.expireOn(formatMdHm(row.expiresAt))}</p>
      </div>
    </li>
  );
}

export function StaffInviteScreen(): JSX.Element {
  const [rows, setRows] = useState<readonly S4bInvite[]>(S4B_INVITES);
  const sample = matchById('m_1400');
  return (
    <S4bFrame title={copy.inviteTitle} admin screen="staff-invite">
      <S4bCard plain>
        <div class="s4b-gap">
          <Line text={copy.kv(copy.role, assignRoleLabel.scorer)} />
          {sample ? (
            <div class="s4b-m__top">
              <span class="s4b-k">{copy.matches}</span>
              <MatchBits match={sample} />
            </div>
          ) : null}
          {sample ? <Line text={vsLabel(sample)} /> : null}
          <Line text={copy.kv(copy.expiry, formatMdHm(S4B_INVITE_EXPIRES))} />
          <p class="s4b-line"><span class="s4b-k">{S4B_INVITE_PATH}</span></p>
          <div class="s4b-pair">
            <Button variant="secondary" size="sm">{copy.copyLink}</Button>
            <Button variant="secondary" size="sm">{copy.shareLine}</Button>
          </div>
        </div>
      </S4bCard>
      <S4bCard plain>
        <ul class="cps-list">
          {rows.map((row) => (
            <InviteRow
              key={row.id}
              row={row}
              onRevoke={(id) => setRows((prev) => prev.map((item) => item.id === id ? { ...item, revoked: true } : item))}
            />
          ))}
        </ul>
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
  statusTone: 'brand' | 'neutral';
  showEnter: boolean;
  /** 沒有開賽時間時改寫時刻，不走 MatchBits。 */
  timeLabel?: string;
}

export interface ScorerDay {
  key: string;
  heading: string;
  matches: readonly ScorerMatchRow[];
}

function fixtureScorerDays(): ScorerDay[] {
  const staff = S4B_STAFF.find((row) => row.id === S4B_SCORER_ID);
  const matches = scorerMatchOrder(matchesByIds(staff?.matchIds ?? []), S4B_NOW);
  return groupMatches(matches).map((group) => ({
    key: group.key,
    heading: dayText(group.month, group.day, weekdayIndex(group.key) ?? group.weekday),
    matches: group.matches.map((match) => ({
      id: match.id,
      match,
      statusLabel: matchStatusLabel[match.status],
      statusTone: match.status === 'live' ? 'brand' as const : 'neutral' as const,
      showEnter: true,
    })),
  }));
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
      <S4bCard>
        {days.length === 0 ? <p class="s4b-foot">{props.empty ?? ''}</p> : null}
        {days.map((group) => (
          <div key={group.key}>
            <p class="s4b-day">{group.heading}</p>
            {group.matches.map((row) => (
              <div key={row.id} class="s4b-m">
                <div class="s4b-m__top">
                  {row.timeLabel ? (
                    <>
                      <span class="s4b-k">{row.timeLabel}</span>
                      <span class="s4b-k">{row.match.venue}</span>
                    </>
                  ) : (
                    <MatchBits match={row.match} />
                  )}
                  <Badge tone={row.statusTone} size="sm" label={row.statusLabel} />
                </div>
                <div class="s4b-between">
                  <span class="s4b-k">{vsLabel(row.match)}</span>
                  {row.showEnter ? (
                    <Button variant="primary" size="sm" onClick={() => props.onEnter?.(row.id)}>{enterLabel}</Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ))}
      </S4bCard>
    </S4bFrame>
  );
}

export function StaffDeniedScreen({
  title,
  message,
  backLabel,
  onBack,
}: {
  title: string;
  message: string;
  backLabel: string;
  onBack: () => void;
}): JSX.Element {
  return (
    <CpFrame title={title} onBack={onBack}>
      <p class="cps-note cps-nowrap" role="alert">{message}</p>
      <div class="cps-actions">
        <Button variant="secondary" onClick={onBack}>{backLabel}</Button>
      </div>
    </CpFrame>
  );
}
