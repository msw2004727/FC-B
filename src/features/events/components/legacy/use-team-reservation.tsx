import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { toast } from '@/ui/Toast';
import { useActionRingControl } from '@/ui/action-ring';
import {
  createTeamReservationController,
  getTeamReservationAction,
  getTeamReservationModalState,
  resolveTeamReservationSignupChoice,
  type TeamReservationEvent,
  type TeamReservationViewer,
  type TeamReservationResult,
} from '../../data/team-reservation';
import type { NormalizedTeamReservationSummary } from '../../data/signup-restrictions';
import { TeamReservationModal, TeamReservationSignupChoiceModal } from './TeamReservationModals';

export type ReservationSuccess = Extract<TeamReservationResult, { deduplicated: false }>;

/** 每個 EventDetailSession 一份；成功後的名單刷新由頁面沿既有讀取路徑處理。 */
export function useTeamReservation(props: {
  event: TeamReservationEvent | null;
  viewer: TeamReservationViewer;
  loading: boolean;
  blocked: boolean;
  now: number;
  sessionKey?: number;
  onSuccess: (result: ReservationSuccess) => void | Promise<void>;
}) {
  const latest = useRef(props);
  latest.current = props;
  const alive = useRef(true);
  const generation = useRef(0);
  const pending = useRef(false);
  const rejected = useRef(false);
  const [busy, setBusy] = useState(false);
  // 團隊報名彈窗「確認」的進度環：本地檢查沒過（同步回傳）不縮圓，寫入成功才打勾後關窗。
  const ring = useActionRingControl();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [courseRejected, setCourseRejected] = useState(false);
  const [choices, setChoices] = useState<NormalizedTeamReservationSummary[] | null>(null);
  const choiceResolve = useRef<((id: string | null) => void) | null>(null);
  const getSnapshot = () => alive.current ? {
    event: latest.current.event,
    viewer: latest.current.viewer,
    loading: latest.current.loading,
    courseRejected: rejected.current,
    generation: generation.current,
  } : null;
  const controller = useRef<ReturnType<typeof createTeamReservationController> | null>(null);
  if (!controller.current) controller.current = createTeamReservationController(getSnapshot);
  useLayoutEffect(() => {
    alive.current = true;
    generation.current += 1;
    setTeamId(null);
    setChoices(null);
    return () => {
      alive.current = false;
      generation.current += 1;
      choiceResolve.current?.(null);
      choiceResolve.current = null;
    };
  }, [props.sessionKey]);

  const action = getTeamReservationAction({
    event: props.event, viewer: props.viewer, loading: props.loading,
    courseRejected, generation: generation.current,
  }, props.now);
  const modalState = teamId !== null && action
    ? getTeamReservationModalState(props.event, props.viewer, teamId) : null;

  function close(): void {
    generation.current += 1;
    setTeamId(null);
  }

  function open(preferredTeamId = ''): void {
    if (pending.current || latest.current.blocked) return;
    const snapshot = getSnapshot();
    if (!snapshot || !getTeamReservationAction(snapshot)) return;
    const state = getTeamReservationModalState(snapshot.event, snapshot.viewer, preferredTeamId);
    if (!state || (preferredTeamId && state.selectedTeam.id !== preferredTeamId)) return;
    generation.current += 1;
    setTeamId(state.selectedTeam.id);
  }

  async function submit(slots: string): Promise<void> {
    if (teamId === null || pending.current || latest.current.blocked) return;
    const request = generation.current;
    pending.current = true;
    setBusy(true);
    ring.start();
    try {
      const result = await controller.current!.submit(teamId, slots);
      if (!alive.current || request !== generation.current) return;
      if (result.status === 'ignored') return;
      if (result.status === 'course-managed') {
        rejected.current = true;
        setCourseRejected(true);
        close();
        return;
      }
      if (result.status === 'success' && !result.deduplicated) {
        await ring.succeed();
        close();
        const committedGeneration = generation.current;
        toast.show({ message: result.message });
        try {
          // 保持 pending 到名單刷新結束；成功寫入後的讀取失敗不能誤報成調整失敗。
          await latest.current.onSuccess(result);
        } catch {
          if (alive.current && committedGeneration === generation.current) {
            toast.show({ message: '團隊名額已更新，但名單更新失敗，請重新整理' });
          }
        }
        return;
      }
      toast.show({ message: result.message });
    } catch {
      if (alive.current && request === generation.current) {
        toast.show({ message: '團隊名額調整失敗，請稍後重試' });
      }
    } finally {
      ring.fail();
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function finishChoice(id: string | null): void {
    const resolve = choiceResolve.current;
    choiceResolve.current = null;
    setChoices(null);
    resolve?.(id);
  }

  async function chooseSignupTeam(event: TeamReservationEvent): Promise<string | null> {
    if (!alive.current) return null;
    const choice = resolveTeamReservationSignupChoice(event, latest.current.viewer);
    if (!choice.requiresSelection) return choice.teamId;
    const uid = latest.current.viewer.uid;
    setChoices(choice.choices);
    const selected = await new Promise<string | null>(resolve => { choiceResolve.current = resolve; });
    if (!alive.current || latest.current.viewer.uid !== uid || selected === null) return null;
    // 視窗開著時身分可能更新；不讓已失效的選擇靜默改用另一隊。
    const current = resolveTeamReservationSignupChoice(event, latest.current.viewer, selected);
    return current.teamId === selected ? selected : null;
  }

  return {
    action, busy, open, chooseSignupTeam, isPending: () => pending.current,
    canAdjustTeam: (id: string) => !!action && !busy && !props.blocked
      && !!props.viewer.staffTeams?.some(team => team.id === id),
    dialogs: <>
      {modalState && <TeamReservationModal key={modalState.selectedTeam.id + ':' + generation.current}
        state={modalState} busy={busy} ring={ring} onSelectTeam={open} onClose={close}
        onConfirm={slots => { void submit(slots); }} />}
      {choices && <TeamReservationSignupChoiceModal choices={choices}
        onClose={() => finishChoice(null)} onConfirm={finishChoice} />}
    </>,
  };
}
