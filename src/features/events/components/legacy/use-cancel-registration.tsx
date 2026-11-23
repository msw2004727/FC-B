import type { JSX } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { useRef, useState } from 'preact/hooks';
import { toast } from '@/ui/Toast';
import { appConfirm } from '@/ui/AppConfirm';
import { useActionRingControl } from '@/ui/action-ring';
import {
  isCompanion,
  registrationId,
  registrationOwner,
  type DetailEvent,
  type DetailRegistration,
} from '../../data/detail-model';
import { eventStartMs } from '../../data/terminal';
import { effectiveEventStatus } from '../../data/my-activities-model';
import { loadEventDetail } from '../../data/event-detail';
import { cancelRegistration, SignupError } from '../../data/signup';
import type { CancelOperationContext } from '../../data/signup';
import type { CompanionCancelTarget, CompanionCancelLateInfo } from './CompanionCancelModal';
import {
  buildLateCancelConfirm,
  isLateCancelRegistration,
  isWithinLateCancelWindow,
  withLateCancelMarked,
  type LateCancelConfirmContent,
  type LateCancelUserInfo,
} from '../../data/late-cancel';
import { LateCancelConfirm } from '../LateCancelConfirm';

// 照 A：同行者取消彈窗只在開啟時 lazy 下載（不新增首屏重量）。
const DetailCompanionCancelModal = lazy(() =>
  import('./CompanionCancelModal')
    .then(module => ({ default: module.CompanionCancelModal })));

export interface CancelFlowSnapshot {
  event: DetailEvent;
  publicId: string;
  owned: DetailRegistration[];
  /** 頁面已有名單的候補人數（臨時取消確認框的候補順位，零額外讀）。 */
  waitlistCount?: number;
}

export interface UseCancelRegistrationOptions {
  getViewerUid(): string | null;
  isAlive(): boolean;
  canRun(): boolean;
  login(): Promise<void>;
  cancelContext: CancelOperationContext;
  onIntegrityError(): void;
  /** deduplicated＝結果未知（含 T-086a 逾時）：呼叫端須 await 重讀名單。 */
  onSelfCancelled(result: {
    deduplicated: boolean;
    updatedEvent: DetailEvent | null;
  }): Promise<void>;
  /** 同上；省略 result（ALREADY_CANCELLED）＝已確認但無投影，呼叫端須重讀活動文件。 */
  onBatchCancelled(result?: { deduplicated: boolean; event?: unknown }): Promise<void>;
  /**
   * 臨時取消確認文案（FC 契約 late-cancel §8）：只在快照是伺服器讀回的活動文件時給（詳情頁）；
   * 不給就沿用原本確認框。回傳操作者的 users 臨取欄位（先用名單同批讀的快取，沒有才補讀一次）；
   * undefined＝讀不到，確認框改寫不含恢復條件的中性文字。
   */
  getLateCancelUser?(uid: string): Promise<LateCancelUserInfo | undefined>;
}

interface CancelModalState {
  targets: CompanionCancelTarget[];
  selectAll: boolean;
  late: CompanionCancelLateInfo | null;
}

export interface UseCancelRegistrationResult {
  /** 臨時取消確認框（預覽 ②③④⑤-3）：由 renderModal 一起畫；true＝仍要取消。 */
  askLateConfirm(content: LateCancelConfirmContent): Promise<boolean>;
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
 * T-086a：確認視窗前不再讀活動（改用畫面快照提早拒絕）；逾時視同結果未知並重讀名單。
 */
export function useCancelRegistration(
  options: UseCancelRegistrationOptions,
): UseCancelRegistrationResult {
  const [modal, setModal] = useState<CancelModalState | null>(null);
  const [confirmContent, setConfirmContent] = useState<LateCancelConfirmContent | null>(null);
  const confirmResolve = useRef<((ok: boolean) => void) | null>(null);
  // 同行者取消彈窗「確認取消」的進度環：寫入成功才打勾後關窗。
  const ring = useActionRingControl();
  // 呼叫端最新值：每次 render 更新 ref，避免非同步流程拿到舊的 options。
  const ref = useRef(options);
  ref.current = options;

  function askLateConfirm(content: LateCancelConfirmContent): Promise<boolean> {
    confirmResolve.current?.(false);
    return new Promise<boolean>((resolve) => {
      confirmResolve.current = resolve;
      setConfirmContent(content);
    });
  }

  function settleLateConfirm(ok: boolean): void {
    const resolve = confirmResolve.current;
    confirmResolve.current = null;
    setConfirmContent(null);
    resolve?.(ok);
  }

  async function beginCancel(snapshot: CancelFlowSnapshot): Promise<void> {
    const {
      getViewerUid,
      isAlive,
      canRun,
      login,
      cancelContext,
      onSelfCancelled,
      getLateCancelUser,
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
          lateEligible: isLateCancelRegistration(reg, snapshot.event),
        };
      });
      // 複審 P3-1：時限內且有可能記點的報名才讀操作者資料，平常不多讀。
      const needLateUser = !!getLateCancelUser && targets.some(target => target.lateEligible)
        && isWithinLateCancelWindow(snapshot.event, Date.now());
      const lateUser = needLateUser && getLateCancelUser ? await getLateCancelUser(uid) : undefined;
      if (!isAlive() || getViewerUid() !== uid) return;
      setModal({
        targets,
        selectAll: selfKeys.size === 1,
        late: getLateCancelUser ? {
          event: snapshot.event,
          waitlistCount: snapshot.waitlistCount ?? 0,
          user: lateUser,
        } : null,
      });
      return;
    }

    const eventId = snapshot.event.id ?? snapshot.publicId;
    // T-086a：確認視窗前先用畫面已有的活動判斷（狀態同 context 的有效狀態），可取消時不再讀；
    // 快照顯示不可取消才重讀最新活動確認後再拒絕（避免快照過時誤擋）。
    // 確認後 cancelRegistration 內仍重讀最新活動再檢查（顧問規則 1）。
    const refusal = (event: DetailEvent): string | null => {
      if (['ended', 'cancelled'].includes(effectiveEventStatus(event))) {
        return '活動已開始，無法再取消報名';
      }
      const start = eventStartMs(event);
      return start > 0 && start <= Date.now() ? '活動已於開始時間結束，無法取消報名' : null;
    };
    if (refusal(snapshot.event)) {
      const latest = await cancelContext.load(eventId);
      if (!isAlive()) return;
      const message = refusal(latest.event);
      if (message) {
        toast.show({ message });
        return;
      }
    }
    const waitlisted = selfRegs.every(reg => reg.status === 'waitlisted');
    // 臨時取消（預覽 ②③④）：活動層條件不成立、或只取消候補時沿用原本確認框。
    const eligibleCount = selfRegs.filter(reg => isLateCancelRegistration(reg, snapshot.event)).length;
    // 複審 P3-1：時限內且有可能記點的報名才讀操作者資料，平常不多讀。
    const needLateUser = !waitlisted && !!getLateCancelUser && eligibleCount > 0
      && isWithinLateCancelWindow(snapshot.event, Date.now());
    const lateUser = needLateUser && getLateCancelUser ? await getLateCancelUser(uid) : undefined;
    if (!isAlive() || getViewerUid() !== uid) return;
    const lateContent = !waitlisted && getLateCancelUser ? buildLateCancelConfirm({
      event: snapshot.event,
      nowMs: Date.now(),
      eligibleCount,
      confirmedCount: selfRegs.filter(reg => reg.status === 'confirmed').length,
      waitlistCount: snapshot.waitlistCount ?? 0,
      user: lateUser,
    }) : null;
    const confirmed = lateContent
      ? await askLateConfirm(lateContent)
      : await appConfirm(waitlisted ? '確定要取消候補？' : '確定要取消報名？');
    if (!confirmed) return;
    if (!isAlive() || getViewerUid() !== uid) return;
    const ids = selfRegs.map(registrationId);
    if (ids.some(id => !id)) {
      toast.show({ message: '報名資料尚未同步完成，請重新整理後再試' });
      return;
    }
    let response: Awaited<ReturnType<typeof cancelRegistration>>;
    try {
      response = await cancelRegistration({
        eventId,
        userId: uid,
        registrationIds: ids,
        kind: 'self',
        context: cancelContext,
      });
    } catch (error) {
      // T-086a：逾時＝結果未知，顯示既有逾時訊息後重讀名單回到伺服器真相；不自動重送。
      if (error instanceof SignupError && error.originalCode === 'CALLABLE_TIMEOUT') {
        if (!isAlive()) return;
        toast.show({ message: `取消失敗：${error.message}` });
        await onSelfCancelled({ deduplicated: true, updatedEvent: null });
        return;
      }
      throw error;
    }
    if (!isAlive()) return;
    if (response.deduplicated) {
      toast.show({ message: '取消處理中，請稍候' });
      await onSelfCancelled({ deduplicated: true, updatedEvent: null });
      return;
    }
    toast.show({ message: withLateCancelMarked(waitlisted ? '已取消候補' : '已取消報名', response.lateCancelMarked) });
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
    ring.start();
    try {
      const response = await cancelRegistration({
        eventId,
        userId: uid,
        registrationIds: ids,
        kind: targets.every(reg => !isCompanion(reg)) ? 'self' : 'companion',
        context: cancelContext,
      });
      if (!isAlive()) return;
      // deduplicated＝結果未知：不打勾、直接展開回原狀，照原流程提示後關窗。
      if (response.deduplicated) ring.fail();
      else if (!(await ring.succeed())) return; // 等 ✓ 期間卸載就不再關窗、提示、重讀。
      toast.show({ message: response.deduplicated
        ? '取消處理中，請稍候' : withLateCancelMarked(`已取消 ${ids.length} 筆報名`, response.lateCancelMarked) });
      setModal(null);
      // R-REG-002：成功時把伺服器佔位投影交給呼叫端套用，名單重讀不再自行計數。
      await onBatchCancelled({
        deduplicated: response.deduplicated === true,
        ...(response.event ? { event: response.event } : {}),
      });
    } catch (error) {
      if (!isAlive()) return;
      if (error instanceof SignupError && error.originalCode === 'ALREADY_CANCELLED') {
        if (!(await ring.succeed())) return;
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
        REQUEST_ID_CONFLICT: '請重新整理後再試',
      };
      const code = error instanceof SignupError ? error.originalCode : '';
      ring.fail();
      toast.show({ message: `取消失敗：${messages[code] || '連線逾時，請檢查網路後重新整理再試'}` });
      // T-086a：逾時＝結果未知，訊息後重讀名單；不自動重送。
      if (code === 'CALLABLE_TIMEOUT') await onBatchCancelled({ deduplicated: true });
    } finally {
      ring.fail();
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
    const confirmBox = confirmContent
      ? <LateCancelConfirm content={confirmContent} onSettle={settleLateConfirm} />
      : null;
    if (!modal) return confirmBox;
    const targets = modal.targets;
    const selectAll = modal.selectAll;
    return (
      <>
        {confirmBox}
        <Suspense fallback={null}>
          <DetailCompanionCancelModal
            open
            targets={targets}
            selectAll={selectAll}
            busy={props.busy}
            ring={ring}
            eventTitle={props.eventTitle}
            lateCancel={modal.late}
            onClose={() => { if (!props.busy) setModal(null); }}
            onConfirm={props.onConfirm}
          />
        </Suspense>
      </>
    );
  }

  return {
    askLateConfirm,
    beginCancel,
    confirmCancel,
    modal,
    closeModal,
    renderModal,
  };
}
