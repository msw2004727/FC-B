// A. 指派與邀請。主辦三頁是後台，平面卡片；受邀者與記分員沿用賽事頁卡片。

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
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

export function StaffListScreen({ viewerRole = 'host' }: { viewerRole?: StaffViewer }): JSX.Element {
  const [rows, setRows] = useState<readonly S4bStaff[]>(S4B_STAFF);
  const screen = viewerRole === 'host' ? 'staff-list' : 'staff-list-cohost';
  return (
    <S4bFrame title={copy.staffTitle} admin screen={screen}>
      <S4bCard plain>
        <ul class="cps-list">
          {rows.map((staff) => (
            <li key={staff.id} class="s4b-li">
              <div class="s4b-staff">
                <span class="s4b-staff__name">{staff.name}</span>
                <Badge tone={roleTone(staff.role)} size="sm" label={staffRoleLabel[staff.role]} />
                <span class="s4b-staff__meta">{copy.assigned(staffAssignmentCount(staff))}</span>
                <span class="s4b-staff__gap" />
                {canRemoveStaff(viewerRole, staff.role) ? (
                  <span class="s4b-mini">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setRows((prev) => prev.filter((row) => row.id !== staff.id))}
                    >
                      {copy.remove}
                    </Button>
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </S4bCard>
      <div class="s4b-pair">
        <Button variant="primary">{copy.assignScorer}</Button>
        <Button variant="secondary">{copy.generateInvite}</Button>
      </div>
    </S4bFrame>
  );
}

export function StaffAssignScreen(): JSX.Element {
  const [person, setPerson] = useState<string>(S4B_ASSIGN_PEOPLE[0].id);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [role, setRole] = useState<AssignRole>('scorer');
  const groups = groupMatches(S4B_MATCHES);
  function toggle(id: string, on: boolean): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  return (
    <S4bFrame title={copy.assignTitle} admin screen="staff-assign">
      <S4bCard plain>
        <div class="s4b-gap">
          <Select
            label={copy.person}
            value={person}
            onValueChange={setPerson}
            options={S4B_ASSIGN_PEOPLE.map((item) => ({ value: item.id, label: item.name }))}
          />
          {groups.map((group) => (
            <div key={group.key}>
              <p class="s4b-day">{dayText(group.month, group.day, group.weekday)}</p>
              {group.matches.map((match) => {
                const clock = clockLabel(match.kickoffAt);
                return (
                  <Checkbox
                    key={match.id}
                    label={`${clock.time} ${match.venue} ${vsLabel(match)}`}
                    checked={picked.has(match.id)}
                    onCheckedChange={(on) => toggle(match.id, on)}
                  />
                );
              })}
            </div>
          ))}
          <RadioGroup
            name="s4b-assign-role"
            label={copy.role}
            value={role}
            onValueChange={(value) => setRole(value === 'referee' ? 'referee' : 'scorer')}
            options={[
              { value: 'scorer', label: assignRoleLabel.scorer },
              { value: 'referee', label: assignRoleLabel.referee },
            ]}
          />
          <div class="s4b-blockbtn">
            <Button variant="primary">{copy.save}</Button>
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

export function ScorerMatchesScreen(): JSX.Element {
  const staff = S4B_STAFF.find((row) => row.id === S4B_SCORER_ID);
  const matches = scorerMatchOrder(matchesByIds(staff?.matchIds ?? []), S4B_NOW);
  const groups = groupMatches(matches);
  return (
    <S4bFrame title={copy.scorerTitle} screen="scorer-my-matches">
      <S4bCard>
        {groups.map((group) => (
          <div key={group.key}>
            <p class="s4b-day">{dayText(group.month, group.day, weekdayIndex(group.key) ?? group.weekday)}</p>
            {group.matches.map((match) => (
              <div key={match.id} class="s4b-m">
                <div class="s4b-m__top">
                  <MatchBits match={match} />
                  <Badge
                    tone={match.status === 'live' ? 'brand' : 'neutral'}
                    size="sm"
                    label={matchStatusLabel[match.status]}
                  />
                </div>
                <div class="s4b-between">
                  <span class="s4b-k">{vsLabel(match)}</span>
                  <Button variant="primary" size="sm">{copy.enterScore}</Button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </S4bCard>
    </S4bFrame>
  );
}
