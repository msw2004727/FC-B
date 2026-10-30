import type { JSX } from 'preact';
import { LEGACY_SETTLE_URL } from './legacy-links';
import { useT } from '@/i18n/i18n';
import { ROSTER_STATUS_CALLABLES_DEPLOYED } from '@/data/roster-status-deployed';
import type { RosterEventInput, RosterRegistrationInput } from '../data/attendance-roster-model';
import { isRosterStatusCourseEvent, isRosterStatusCourseTarget, type RosterStatusAction } from '../data/roster-status-policy';

export function RosterStatusCourseNote({ event, editing }: {
  event: RosterEventInput; editing: boolean;
}): JSX.Element | null {
  const t = useT();
  if (!ROSTER_STATUS_CALLABLES_DEPLOYED || !editing || !isRosterStatusCourseEvent(event)) return null;
  return <div role="note"
    style="display:flex;align-items:center;flex-wrap:wrap;gap:.4rem;margin:.25rem 0 .45rem;padding:.25rem .5rem;border-radius:var(--radius-sm);background:rgba(245,158,11,.14);color:var(--text-primary);font-size:.75rem;line-height:1.4">
    <span>{t('events.roster.useLegacyForCourse')}</span>
    <a href={LEGACY_SETTLE_URL} target="_blank" rel="noopener noreferrer"
      style="color:var(--primary);font-weight:600;text-decoration:underline;white-space:nowrap">
      {t('events.roster.goLegacy')}
    </a>
  </div>;
}
export function RosterStatusCell({ action, userId, name, registrations, empty, submitting, pending, onClick }: {
  action: RosterStatusAction; userId: string; name: string;
  registrations: readonly RosterRegistrationInput[];
  empty?: boolean; submitting?: boolean; pending?: boolean; onClick: () => void;
}): JSX.Element {
  const t = useT();
  const demote = action === 'demote';
  if (empty || !userId) return <td style={demote ? 'padding:.35rem .2rem' : undefined} />;
  const blocked = isRosterStatusCourseTarget(action, registrations, userId);
  const disabled = !!(submitting || pending);
  const style = (demote
    ? 'font-size:.7rem;padding:.2rem .4rem;border:1px solid #8b5cf6;color:#8b5cf6;background:transparent;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap'
    : 'font-size:.72rem;padding:.2rem .45rem;background:#8b5cf6;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer')
    + (disabled ? ';opacity:.65;cursor:not-allowed' : '');
  return <td style={demote ? 'padding:.35rem .2rem;text-align:center' : 'padding:.35rem .3rem;text-align:center;width:3rem'}>
    {blocked ? <span style="font-size:.7rem;color:var(--text-muted)"
      title={t('events.roster.useLegacyForCourse')} aria-label={t('events.roster.useLegacyForCourse')}>
      {t('events.roster.legacyTag')}
    </span> : <button type="button" style={style} disabled={disabled}
      aria-label={t('events.roster.' + action + 'Aria', { name })}
      data-roster-action={action} onClick={() => { if (!disabled) onClick(); }}>
      {t('events.roster.' + action + (pending ? 'Pending' : 'Button'))}
    </button>}
  </td>;
}
