import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { pushOverlay } from '@/core/overlay-back';
import { ActionRingButton, type ActionRingControl } from '@/ui/action-ring';
import {
  getTeamReservationInitialSlots,
  type getTeamReservationModalState,
} from '../../data/team-reservation';
import type { NormalizedTeamReservationSummary } from '../../data/signup-restrictions';

function ReservationDialog({ id, title, onClose, children, actions }: {
  id: string;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  actions: ComponentChildren;
}): JSX.Element {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const hadLock = document.body.classList.contains('modal-open');
    document.body.classList.add('modal-open');
    const release = pushOverlay(() => { closeRef.current(); return true; });
    return () => {
      release();
      if (!hadLock) document.body.classList.remove('modal-open');
    };
  }, []);
  const titleId = id.replace(/-modal$/, '') + '-title';
  return createPortal(
    <div class="legacy-ui">
      <div id={id} class="team-reservation-overlay open" role="presentation">
        <div class="team-reservation-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div class="team-reservation-dialog-header">
            <h3 id={titleId}>{title}</h3>
            <button type="button" class="team-reservation-close" onClick={onClose} aria-label="關閉">×</button>
          </div>
          <div class="team-reservation-dialog-body">{children}</div>
          <div class="team-reservation-dialog-actions">{actions}</div>
        </div>
      </div>
    </div>, document.body,
  );
}

/** A openTeamReservationModal：沿用 activity.css 與原有文案。 */
export function TeamReservationModal({ state, busy, ring, onSelectTeam, onClose, onConfirm }: {
  state: NonNullable<ReturnType<typeof getTeamReservationModalState>>;
  busy: boolean;
  ring: ActionRingControl;
  onSelectTeam: (teamId: string) => void;
  onClose: () => void;
  onConfirm: (slots: string) => void;
}): JSX.Element {
  const [slots, setSlots] = useState(() => String(getTeamReservationInitialSlots(state)));
  return (
    <ReservationDialog id="team-reservation-modal" title="團隊報名" onClose={onClose} actions={
      <>
        <button type="button" class="outline-btn" onClick={onClose}>取消</button>
        <ActionRingButton control={ring} busyLabel="處理中..." type="button" class="primary-btn"
          id="team-reservation-confirm-btn" disabled={busy}
          onClick={() => onConfirm(slots)}>{busy ? '處理中...' : '確認'}</ActionRingButton>
      </>
    }>
      <div class="team-reservation-note">團隊名額不包含你本人；如果你也要參加，請再點「個人報名」。</div>
      <label class="team-reservation-label" for="team-reservation-team-select">俱樂部</label>
      <select id="team-reservation-team-select" class="team-reservation-control"
        value={state.selectedTeam.id} disabled={busy} onChange={e => onSelectTeam(e.currentTarget.value)}>
        {state.teams.map(team => <option key={team.id} value={team.id}>{team.name || team.id}</option>)}
      </select>
      <label class="team-reservation-label" for="team-reservation-slots-input">團隊名額</label>
      <input id="team-reservation-slots-input" class="team-reservation-control" type="number" inputMode="numeric"
        min={state.used} max={state.maxReserved} value={slots} disabled={busy}
        onInput={e => setSlots(e.currentTarget.value)} />
      <div class="team-reservation-help">
        此人數佔位僅於相同俱樂部成員報名時適用。<br />
        已被俱樂部成員使用：{state.used}　剩餘佔位：{state.remaining}<br />
        可調整範圍：{state.used} - {state.maxReserved}
      </div>
    </ReservationDialog>
  );
}

export function TeamReservationSignupChoiceModal({ choices, onClose, onConfirm }: {
  choices: readonly NormalizedTeamReservationSummary[];
  onClose: () => void;
  onConfirm: (teamId: string) => void;
}): JSX.Element {
  const [selected, setSelected] = useState(choices[0]?.teamId ?? '');
  const confirmed = useRef(false);
  return (
    <ReservationDialog id="team-reservation-signup-choice-modal" title="選擇報名俱樂部" onClose={onClose} actions={
      <>
        <button type="button" class="outline-btn" onClick={onClose}>取消</button>
        <button type="button" class="primary-btn" id="team-reservation-signup-choice-confirm-btn"
          onClick={() => {
            if (confirmed.current || !choices.some(item => item.teamId === selected)) return;
            confirmed.current = true;
            onConfirm(selected);
          }}>確認報名</button>
      </>
    }>
      <div class="team-reservation-note">你符合多個俱樂部席位，請選擇本次要使用的俱樂部。</div>
      <div class="team-reservation-choice-list" role="radiogroup" aria-label="報名俱樂部">
        {choices.map(item => (
          <button key={item.teamId} data-team-id={item.teamId} type="button"
            class={'team-reservation-choice-card' + (selected === item.teamId ? ' is-selected' : '')}
            role="radio" aria-checked={selected === item.teamId} onClick={() => setSelected(item.teamId)}>
            <span class="team-reservation-choice-mark" aria-hidden="true" />
            <span class="team-reservation-choice-main">
              <span class="team-reservation-choice-name">{item.teamName || item.teamId}</span>
              <span class="team-reservation-choice-meta">席位 {item.reservedSlots} · 已用 {item.usedSlots} · 剩 {item.remainingSlots}</span>
            </span>
          </button>
        ))}
      </div>
    </ReservationDialog>
  );
}
