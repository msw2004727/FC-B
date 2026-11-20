import type { JSX } from 'preact';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import type { MatchSideName, RosterPublicDoc } from '../data/types';
import { LIVE_COPY, minuteMark, playerChoiceLabel } from './copy';
import type { RecordAction } from './present';
import type { GoalKind } from './types';

/** 背號由小到大。這次不分成先發／替補，名單上也沒有先發標記。 */
function byNumber(a: RosterPublicDoc, b: RosterPublicDoc): number {
  return a.number - b.number || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function actionLabel(action: RecordAction): string {
  if (action === 'goal') return LIVE_COPY.goal;
  if (action === 'yellow') return LIVE_COPY.yellow;
  if (action === 'red') return LIVE_COPY.red;
  if (action === 'pk-in') return LIVE_COPY.pkIn;
  return LIVE_COPY.pkMiss;
}

export function RosterGrid({
  roster,
  selectedId,
  onPick,
}: {
  roster: readonly RosterPublicDoc[];
  /** 有傳才標出目前選到的人。記分選人是點了就送出，不標。 */
  selectedId?: string | null;
  onPick: (plId: string) => void;
}): JSX.Element {
  const ordered = [...roster].sort(byNumber);
  return (
    <div class="s4-grid">
      {ordered.map((player) => {
        const on = selectedId === player.id;
        return (
          <button
            key={player.id}
            type="button"
            class={on ? 's4-pl s4-pl--on' : 's4-pl'}
            aria-label={playerChoiceLabel(player.number, player.displayName)}
            aria-pressed={selectedId !== undefined ? on : undefined}
            onClick={() => onPick(player.id)}
          >
            <span class="s4-pl__no">{player.number}</span>
            <span class="s4-pl__name">{player.displayName}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PlayerSheet({
  open,
  teamName,
  action,
  minute,
  roster,
  goalKind,
  onGoalKind,
  onPick,
  onClose,
  side,
}: {
  open: boolean;
  teamName: string;
  action: RecordAction;
  minute: number;
  roster: readonly RosterPublicDoc[];
  goalKind: GoalKind;
  onGoalKind: (kind: GoalKind) => void;
  onPick: (plId: string | null) => void;
  onClose: () => void;
  /** 哪一隊在記：面板上緣一條隊色。 */
  side?: MatchSideName;
}): JSX.Element {
  const label = actionLabel(action);
  const allowSkip = action === 'goal' || action === 'pk-in' || action === 'pk-miss';
  const kinds: { id: GoalKind; label: string }[] = [
    { id: 'normal', label: LIVE_COPY.goalNormal },
    { id: 'penalty', label: LIVE_COPY.goalPenalty },
    { id: 'own', label: LIVE_COPY.goalOwn },
  ];

  return (
    <BottomSheet
      open={open}
      class={`s4-sheet${roster.length > 8 ? ' s4-sheet--long' : ''} d2-panel${side ? ` s4-sheet--${side}` : ''}`}
      title={`${teamName} ${label} ${minuteMark(minute)}`}
      onClose={onClose}
    >
      {action === 'goal' ? (
        <div class="s4-kinds">
          {kinds.map((kind) => (
            <Chip
              key={kind.id}
              label={kind.label}
              size="sm"
              selected={goalKind === kind.id}
              onSelect={() => onGoalKind(kind.id)}
            />
          ))}
        </div>
      ) : null}
      {!allowSkip && roster.length === 0 ? <p class="s4-note">{LIVE_COPY.cardNoRoster}</p> : null}
      <div class="s4-pick">
        <RosterGrid roster={roster} onPick={onPick} />
        {allowSkip ? (
          <Button class="s4-unspecified s4-unspecified--pin" variant="secondary" onClick={() => onPick(null)}>
            {LIVE_COPY.unspecified}
          </Button>
        ) : null}
      </div>
    </BottomSheet>
  );
}
