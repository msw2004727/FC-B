import { getFirebase } from '@/data/firebase';
import { lt } from '@/i18n/i18n';
import {
  applyTeamAssignments,
  buildTeamAssignments,
  teamKeyUpdatePayload,
  writableTeamAssignments,
  type SplitTeam,
  type TeamAssignment,
  type TeamBatchAction,
  type TeamRegistration,
} from './team-split';

const pending = new Set<string>();

export interface TeamBatchDependencies {
  eventDocId: string;
  action: TeamBatchAction;
  teams: readonly SplitTeam[];
  canManage: () => boolean;
  isCurrent: () => boolean;
  loadRegistrations: () => Promise<readonly TeamRegistration[]>;
  confirm: (message: string) => Promise<boolean>;
  notify: (message: string) => void;
  publish: (registrations: TeamRegistration[]) => void;
}

function writeErrorMessage(error: unknown): string {
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? String(error.code) : '';
  return code === 'permission-denied'
    ? '分隊權限被拒絕，請確認你是活動主辦或有操作權限'
    : '分隊更新失敗，請稍後再試';
}

// 照 A _tsCommitTeamAssignments；本單明定一次 batch，保留整批原子性。
export async function commitTeamAssignments(
  eventDocId: string,
  assignments: readonly TeamAssignment[],
): Promise<number> {
  if (!eventDocId || eventDocId.includes('/')) throw new Error('eventDocId missing');
  const valid = writableTeamAssignments(assignments);
  if (valid.length === 0) return 0;
  const [{ db }, { doc, writeBatch, serverTimestamp }] = await Promise.all([
    getFirebase(),
    import('firebase/firestore'),
  ]);
  const batch = writeBatch(db);
  for (const item of valid) {
    const regDocId = String(item.reg._docId || '').trim();
    if (regDocId.includes('/')) throw new Error('invalid registration docId');
    batch.update(
      doc(db, 'events', eventDocId, 'registrations', regDocId),
      { ...teamKeyUpdatePayload(item.teamKey, serverTimestamp()) },
    );
  }
  await batch.commit();
  return valid.length;
}

// 照 A _tsBatchRandom／Fill／Reset；鎖以文件 ID 跨元件共用。
export async function runTeamSplitBatch(deps: TeamBatchDependencies): Promise<void> {
  const current = (): boolean => deps.isCurrent();
  const notify = (message: string): void => {
    if (current()) deps.notify(message);
  };
  if (!current()) return;
  if (!deps.canManage()) {
    notify('權限不足');
    return;
  }

  if (deps.action === 'random' || deps.action === 'reset') {
    const message = deps.action === 'random'
      ? lt('teamSplit.batch.confirmRandom', '重新分隊不會通知參加者，確認繼續？')
      : lt('teamSplit.batch.confirmReset', '確定清除所有隊伍分配？');
    try {
      if (!await deps.confirm(message)) return;
    } catch (error) {
      notify(writeErrorMessage(error));
      return;
    }
  }
  if (!current()) return;
  if (!deps.canManage()) {
    notify('權限不足');
    return;
  }
  if (deps.action !== 'reset' && deps.teams.length === 0) return;
  if (pending.has(deps.eventDocId)) {
    notify('分隊更新中，請稍候');
    return;
  }

  pending.add(deps.eventDocId);
  let previous: readonly TeamRegistration[] | null = null;
  let optimistic = false;
  try {
    const rows = await deps.loadRegistrations();
    if (!current()) return;
    if (!deps.canManage()) {
      notify('權限不足');
      return;
    }
    const assignments = buildTeamAssignments(deps.action, deps.teams, rows);
    if (assignments.length === 0) {
      notify(deps.action === 'random'
        ? '沒有可分隊的名單'
        : deps.action === 'fill'
          ? '目前沒有未分隊名單'
          : '目前沒有已分隊名單');
      return;
    }
    const writable = writableTeamAssignments(assignments);
    if (writable.length === 0) {
      notify('分隊資料尚未載入，請重新開啟活動後再試');
      return;
    }

    previous = rows;
    optimistic = true;
    deps.publish(applyTeamAssignments(rows, writable));
    const written = await commitTeamAssignments(deps.eventDocId, writable);
    if (!written) throw new Error('registration write skipped');
  } catch (error) {
    if (current() && optimistic && previous) deps.publish([...previous]);
    notify(writeErrorMessage(error));
  } finally {
    pending.delete(deps.eventDocId);
  }
}
