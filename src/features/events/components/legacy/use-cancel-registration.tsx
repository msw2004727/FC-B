import type { JSX } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { useRef, useState } from 'preact/hooks';
import { toast } from '@/ui/Toast';
import { appConfirm } from '@/ui/AppConfirm';
import {
  isCompanion,
  registrationId,
  registrationOwner,
  type DetailEvent,
  type DetailRegistration,
} from '../../data/detail-model';
import { eventStartMs } from '../../data/terminal';
import { loadEventDetail } from '../../data/event-detail';
import { cancelRegistration, SignupError } from '../../data/signup';
import type { CancelOperationContext } from '../../data/signup';
import type { CompanionCancelTarget } from './CompanionCancelModal';

// 照 A：同行者取消彈窗只在開啟時 lazy 下載（不新增首屏重量）。
const DetailCompanionCancelModal = lazy(() =>
  import('./CompanionCancelModal')
    .then(module => ({ default: module.CompanionCancelModal })));

export interface CancelFlowSnapshot {
  event: DetailEvent;
  publicId: string;
  owned: DetailRegistration[];
}

export interface UseCancelRegistrationOptions {
  getViewerUid(): string | null;
  isAlive(): boolean;
  canRun(): boolean;
  login(): Promise<void>;
  cancelContext: CancelOperationContext;
  onIntegrityError(): void;
  onSelfCancelled(result: {
    deduplicated: boolean;
    updatedEvent: DetailEvent | null;
  }): Promise<void>;
  onBatchCancelled(): Promise<void>;
}

interface CancelModalState {
  targets: CompanionCancelTarget[];
  selectAll: boolean;
}

export interface UseCancelRegistrationResult {
  beginCancel(snapshot: CancelFlowSnapshot): Promise<void>;
  confirmCancel(snapshot: CancelFlowSnapshot, ids: string[]): Promise<void>;
  modal: CancelModalState | null;
  closeModal(): void;
  renderModal(props: {
    busy: boolean;
    eventTitle: string;
    onConfirm(ids: string[]): void;
  }): JSX.Element | null;
}

/**
 * 照 A `handleCancelSignup`；把詳情頁原 `beginCancel`／`confirmCancel` 逐行抽成
 * 可重用 hook，行為、文案、toast、寫入呼叫與順序都不變。
 */
export function useCancelRegistration(
  options: UseCancelRegistrationOptions,
): UseCancelRegistrationResult {
  const [modal, setModal] = useState<CancelModalState | null>(null);
  // 呼叫端最新值：每次 render 更新 ref，避免非同步流程拿到舊的 options。
  const ref = useRef(options);
  ref.current = options;

  async function beginCancel(snapshot: CancelFlowSnapshot): Promise<void> {
    const {
      getViewerUid,
      isAlive,
      canRun,
      login,
      cancelContext,
      onSelfCancelled,
    } = ref.current;
    const uid = getViewerUid();
    if (!uid) {
      await login();
      return;
    }
    if (!canRun()) return;
    const owned = snapshot.owned;
    const selfRegs = owned.filter(reg => !isCompanion(reg));
    if (selfRegs.length === 0) {
      toast.show({ message: '你尚未報名此活動' });
      return;
    }
    const selfKeys = new Set(selfRegs.map(reg => {
      const course = reg as DetailRegistration & {
        courseStudentId?: string;
        courseLinkId?: string;
      };
      const student = String(course.courseStudentId || '').trim();
      const link = String(course.courseLinkId || '').trim();
      return student || link
        ? `course:${link}:${student || registrationId(reg)}`
        : `ordinary:${registrationOwner(reg) || uid}`;
    }));
    if (owned.some(isCompanion) || selfKeys.size > 1) {
      // 照 A：selfRegs.concat(companionRegs)，本人在前。
      const ordered = [...selfRegs, ...owned.filter(isCompanion)];
      const targets: CompanionCancelTarget[] = ordered.map(reg => {
        const course = reg as DetailRegistration & {
          courseStudentId?: string;
          courseLinkId?: string;
        };
        return {
          registrationId: registrationId(reg),
          isSelf: !isCompanion(reg),
          name: reg.companionName || reg.userName || '',
          status: reg.status === 'waitlisted' ? 'waitlisted' : 'confirmed',
          courseStudentId: course.courseStudentId,
          courseLinkId: course.courseLinkId,
        };
      });
      setModal({ targets, selectAll: selfKeys.size === 1 });
      return;
    }

    const eventId = snapshot.event.id ?? snapshot.publicId;
    const latest = await cancelContext.load(eventId);
    if (!isAlive()) return;
    if (latest.event.status === 'ended' || latest.event.status === 'cancelled') {
      toast.show({ message: '活動已開始，無法再取消報名' });
      return;
    }
    const start = eventStartMs(latest.event);
    if (start > 0 && start <= Date.now()) {
      toast.show({ message: '活動已於開始時間結束，無法取消報名' });
      return;
    }
    const waitlisted = selfRegs.every(reg => reg.status === 'waitlisted');
    if (!await appConfirm(waitlisted ? '確定要取消候補？' : '確定要取消報名？')) return;
    if (!isAlive() || getViewerUid() !== uid) return;
    const ids = selfRegs.map(registrationId);
    if (ids.some(id => !id)) {
      toast.show({ message: '報名資料尚未同步完成，請重新整理後再試' });
      return;
    }
    const response = await cancelRegistration({
      eventId,
      userId: uid,
      registrationIds: ids,
      kind: 'self',
      context: cancelContext,
    });
    if (!isAlive()) return;
    if (response.deduplicated) {
      toast.show({ message: '取消處理中，請稍候' });
      await onSelfCancelled({ deduplicated: true, updatedEvent: null });
      return;
    }
    toast.show({ message: waitlisted ? '已取消候補' : '已取消報名' });
    const rawEvent: unknown = (response as { event?: unknown }).event;
    // ASSUMPTION: 舊 Callable 無 event 投影時，重讀活動以判斷取消後是否仍額滿。
    const updated = rawEvent && typeof rawEvent === 'object' && !Array.isArray(rawEvent)
      ? { ...snapshot.event, ...rawEvent } as DetailEvent
      : (await loadEventDetail(eventId))?.event ?? null;
    if (!isAlive()) return;
    await onSelfCancelled({ deduplicated: false, updatedEvent: updated });
  }

  async function confirmCancel(
    snapshot: CancelFlowSnapshot,
    ids: string[],
  ): Promise<void> {
    const {
      getViewerUid,
      isAlive,
      canRun,
      cancelContext,
      onIntegrityError,
      onBatchCancelled,
    } = ref.current;
    const uid = getViewerUid();
    if (!canRun() || !uid) return;
    if (!ids.length) {
      toast.show({ message: '請選擇要取消的報名' });
      return;
    }
    const targets = snapshot.owned.filter(reg => ids.includes(registrationId(reg)));
    if (new Set(ids).size !== ids.length || targets.length !== ids.length
      || targets.some(reg => !registrationId(reg))) {
      onIntegrityError();
      return;
    }
    const eventId = snapshot.event.id ?? snapshot.publicId;
    try {
      const response = await cancelRegistration({
        eventId,
        userId: uid,
        registrationIds: ids,
        kind: targets.every(reg => !isCompanion(reg)) ? 'self' : 'companion',
        context: cancelContext,
      });
      if (!isAlive()) return;
      toast.show({ message: response.deduplicated
        ? '取消處理中，請稍候' : `已取消 ${ids.length} 筆報名` });
      setModal(null);
      await onBatchCancelled();
    } catch (error) {
      if (!isAlive()) return;
      if (error instanceof SignupError && error.originalCode === 'ALREADY_CANCELLED') {
        toast.show({ message: `已取消 ${ids.length} 筆報名` });
        setModal(null);
        await onBatchCancelled();
        return;
      }
      const messages: Record<string, string> = {
        REG_NOT_FOUND: '找不到報名紀錄',
        EVENT_NOT_FOUND: '活動不存在',
        PERMISSION_DENIED: '無權限執行此操作',
        EVENT_ENDED: '活動已開始，無法再取消報名',
        EVENT_STARTED: '活動已於開始時間結束，無法取消報名',
      };
      const code = error instanceof SignupError ? error.originalCode : '';
      toast.show({ message: `取消失敗：${messages[code] || '連線逾時，請檢查網路後重新整理再試'}` });
    }
  }

  function closeModal(): void {
    setModal(null);
  }

  function renderModal(props: {
    busy: boolean;
    eventTitle: string;
    onConfirm(ids: string[]): void;
  }): JSX.Element | null {
    if (!modal) return null;
    const targets = modal.targets;
    const selectAll = modal.selectAll;
    return (
      <Suspense fallback={null}>
        <DetailCompanionCancelModal
          open
          targets={targets}
          selectAll={selectAll}
          busy={props.busy}
          eventTitle={props.eventTitle}
          onClose={() => { if (!props.busy) setModal(null); }}
          onConfirm={props.onConfirm}
        />
      </Suspense>
    );
  }

  return {
    beginCancel,
    confirmCancel,
    modal,
    closeModal,
    renderModal,
  };
}
