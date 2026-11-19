import type { JSX } from 'preact';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import type { RosterPublicDoc } from '../data/types';
import type { GoalKind } from '../testing/step4-fixtures';
import { LIVE_COPY, minuteMark, playerChoiceLabel } from './copy';
import type { RecordAction } from './present';

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
}): JSX.Element {
  const actionLabel = action === 'goal' ? LIVE_COPY.goal : action === 'yellow' ? LIVE_COPY.yellow : LIVE_COPY.red;
  const kinds: { id: GoalKind; label: string }[] = [
    { id: 'normal', label: LIVE_COPY.goalNormal },
    { id: 'penalty', label: LIVE_COPY.goalPenalty },
    { id: 'own', label: LIVE_COPY.goalOwn },
  ];

  return (
    <BottomSheet
      open={open}
      class="s4-sheet"
      title={`${teamName} ${actionLabel} ${minuteMark(minute)}`}
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
      <div class="s4-grid">
        {roster.map((player) => (
          <button
            key={player.id}
            type="button"
            class="s4-pl"
            aria-label={playerChoiceLabel(player.number, player.displayName)}
            onClick={() => onPick(player.id)}
          >
            <span class="s4-pl__no">{player.number}</span>
            <span class="s4-pl__name">{player.displayName}</span>
          </button>
        ))}
      </div>
      {action === 'goal' ? (
        <Button class="s4-unspecified" variant="secondary" onClick={() => onPick(null)}>
          {LIVE_COPY.unspecified}
        </Button>
      ) : null}
    </BottomSheet>
  );
}
