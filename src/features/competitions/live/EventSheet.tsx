import type { JSX } from 'preact';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import type { RosterPublicDoc } from '../data/types';
import { LIVE_COPY, withEvent } from './copy';
import { PkGoalLock } from './score-states';
import { RosterGrid } from './PlayerSheet';
import type { GoalKind } from './types';

/** 最近事件點開：復原，或改判（先復原原紀錄，再記新的）。 */
export function EventSheet({
  summary,
  label,
  kind,
  roster,
  goalKind,
  cardChoice,
  playerId,
  blocked,
  undoOnly = false,
  goalLocked = false,
  halftimeGoal = false,
  onGoalKind,
  onCardChoice,
  onPlayer,
  onUnspecified,
  onUndo,
  onAmend,
  onShowCard,
  onClose,
}: {
  summary: string;
  label: string;
  kind: 'goal' | 'card';
  roster: readonly RosterPublicDoc[];
  goalKind: GoalKind;
  cardChoice: 'yellow' | 'red';
  playerId: string | null;
  blocked: boolean;
  /** PK 的一腳只復原，不改判。 */
  undoOnly?: boolean;
  /** PK 已經開始時，一般進球不能復原或改判。 */
  goalLocked?: boolean;
  /** 疊加狀態是中場時，進球只能復原（Rules 中場不收進球，改判會掉分）。 */
  halftimeGoal?: boolean;
  onGoalKind: (kind: GoalKind) => void;
  onCardChoice: (choice: 'yellow' | 'red') => void;
  onPlayer: (plId: string) => void;
  onUnspecified: () => void;
  onUndo: () => void;
  onAmend: () => void;
  onShowCard: () => void;
  onClose: () => void;
}): JSX.Element {
  const goalKinds: { id: GoalKind; label: string }[] = [
    { id: 'normal', label: LIVE_COPY.goalNormal },
    { id: 'penalty', label: LIVE_COPY.goalPenalty },
    { id: 'own', label: LIVE_COPY.goalOwn },
  ];
  const cardKinds: { id: 'yellow' | 'red'; label: string }[] = [
    { id: 'yellow', label: LIVE_COPY.yellow },
    { id: 'red', label: LIVE_COPY.red },
  ];
  const lockGoal = goalLocked && kind === 'goal' && !undoOnly;
  const restGoal = halftimeGoal && kind === 'goal' && !undoOnly && !lockGoal;
  const showPick = !undoOnly && !lockGoal && !restGoal;

  return (
    <BottomSheet open class="s4-sheet" title={undoOnly ? LIVE_COPY.undo : LIVE_COPY.amend} onClose={onClose}>
      {showPick ? <p class="s4-note">{LIVE_COPY.amendNote}</p> : null}
      {restGoal ? <p class="s4-note">{LIVE_COPY.halftimeGoalUndoOnly}</p> : null}
      <p class="s4-evsum">{summary}</p>
      <div class="s4-amend-act">
        <Button
          variant="ghost"
          disabled={blocked || lockGoal}
          aria-label={withEvent(LIVE_COPY.undo, label)}
          onClick={onUndo}
        >
          {LIVE_COPY.undo}
        </Button>
        {undoOnly ? null : (
          <Button
            disabled={blocked || lockGoal || restGoal || (kind === 'card' && playerId == null)}
            aria-label={withEvent(LIVE_COPY.amend, label)}
            onClick={onAmend}
          >
            {LIVE_COPY.amend}
          </Button>
        )}
      </div>
      {showPick && kind === 'card' ? (
        <Button variant="secondary" data-show-card="true" aria-label={withEvent(LIVE_COPY.showCard, label)} onClick={onShowCard}>
          {LIVE_COPY.showCard}
        </Button>
      ) : null}
      {showPick && kind === 'goal' ? (
        <div class="s4-kinds">
          {goalKinds.map((item) => (
            <Chip
              key={item.id}
              label={item.label}
              size="sm"
              selected={goalKind === item.id}
              onSelect={() => onGoalKind(item.id)}
            />
          ))}
        </div>
      ) : null}
      {showPick && kind === 'card' ? (
        <div class="s4-kinds">
          {cardKinds.map((item) => (
            <Chip
              key={item.id}
              label={item.label}
              size="sm"
              selected={cardChoice === item.id}
              onSelect={() => onCardChoice(item.id)}
            />
          ))}
        </div>
      ) : null}
      {showPick ? (
        <div class="s4-pick">
          <RosterGrid roster={roster} selectedId={playerId} onPick={onPlayer} />
          {kind === 'goal' ? (
            <Button
              class="s4-unspecified"
              variant="secondary"
              aria-pressed={playerId == null}
              onClick={onUnspecified}
            >
              {LIVE_COPY.unspecified}
            </Button>
          ) : null}
        </div>
      ) : null}
      {lockGoal ? <PkGoalLock /> : null}
    </BottomSheet>
  );
}
