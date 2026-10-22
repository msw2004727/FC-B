import type { JSX } from 'preact';
import { Suspense, lazy } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { lt, useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { STATUS_CONFIG, TYPE_CONFIG } from '@/features/events/components/legacy/TimelineEventCard';
import { runEventLifecycleAction } from '@/features/events/components/legacy/event-lifecycle-action';
import {
  useCancelRegistration,
  type CancelFlowSnapshot,
} from '@/features/events/components/legacy/use-cancel-registration';
import { operateContextFromViewer } from '@/features/events/data/event-create-context';
import { loadEventDetail } from '@/features/events/data/event-detail';
import {
  canCancelOwnActivity,
  canEditOwnActivityBasic,
  type OperateContext,
} from '@/features/events/data/operate-permissions';
import { createDetailSignupContexts } from '@/features/events/data/signup-context';
import {
  sortRegistrations,
  type DetailEvent,
  type DetailRegistration,
} from '@/features/events/data/detail-model';
import type { EventDoc } from '@/features/events/data/types';
import { loadViewerRegistrations } from '@/features/events/data/viewer-registrations';

import { useViewer } from '../../data/viewer';
import type { UserProfile } from '../../data/profile-model';
import {
  loadRelatedActivities,
  type EventRecord,
  type HostedActivity,
  type RegisteredActivity,
} from '../../data/related-activities';
import {
  Failure,
  Loading,
  objectValue,
  stringValue,
  useRemote,
  type Platform,
} from '../../ui/shared';
import { sanitizeHttpAvatarUrl } from './profile-legacy-helpers';

const HOSTED_PAGE_SIZE = 10;

// L-05：lazy 元件在 module 級建立，避免每次 render 產生新元件型別。
const LazyEventFormModal = lazy(() =>
  import('@/features/events/components/EventFormModal')
    .then(module => ({ default: module.EventFormModal })));

export function LegacySocialGrid({
  profile,
  onEdit,
}: {
  profile: UserProfile;
  onEdit: (platform: Platform) => void;
}): JSX.Element {
  const t = useT();
  const links = objectValue(profile['socialLinks']);
  const isActive = (p: Platform): boolean => Boolean(stringValue(links[p]));
  const editAria = (p: Platform): string =>
    `${t('profile.socialEdit')}：${t(`profile.platform.${p}`)}`;

  return (
    <div class="social-grid" id="social-grid">
      <button
        type="button"
        class={`social-btn${isActive('fb') ? ' active' : ''}`}
        data-platform="fb"
        title="Facebook"
        aria-label={editAria('fb')}
        onClick={() => onEdit('fb')}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </button>
      <button
        type="button"
        class={`social-btn${isActive('ig') ? ' active' : ''}`}
        data-platform="ig"
        title="Instagram"
        aria-label={editAria('ig')}
        onClick={() => onEdit('ig')}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      </button>
      <button
        type="button"
        class={`social-btn${isActive('threads') ? ' active' : ''}`}
        data-platform="threads"
        title="Threads"
        aria-label={editAria('threads')}
        onClick={() => onEdit('threads')}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.59 12c.025 3.086.718 5.496 2.057 7.164 1.432 1.781 3.632 2.695 6.54 2.717 2.227-.017 4.074-.517 5.49-1.482 1.2-.82 2.12-2.012 2.7-3.508l1.942.672a10.987 10.987 0 01-3.335 4.397C17.165 23.275 14.898 23.98 12.186 24zm4.394-8.858c-.095-1.17-.584-2.098-1.422-2.698-.7-.5-1.6-.775-2.617-.8-.87.02-1.653.26-2.262.687-.66.47-1.065 1.12-1.138 1.822-.078.78.225 1.41.85 1.776.54.313 1.19.48 1.92.49.95-.01 1.82-.32 2.42-.86.44-.39.7-.86.77-1.38.03-.16.04-.32.04-.48v-.01c-.005-.185-.02-.365-.046-.537l-.015-.01zm1.87-1.06c.068.36.113.73.134 1.11.03.52.003 1.04-.084 1.55-.242 1.39-.98 2.56-2.14 3.38-1.15.82-2.54 1.257-4.02 1.267h-.05c-1.12-.01-2.1-.275-2.913-.786-1.125-.706-1.68-1.844-1.54-3.15.12-1.13.747-2.097 1.76-2.72.88-.54 1.96-.837 3.12-.86h.06c.68.01 1.33.11 1.93.29-.16-.6-.48-1.07-.96-1.4-.58-.4-1.32-.61-2.16-.61h-.04c-.96.01-1.79.24-2.46.67l-.96-1.72c.97-.61 2.15-.95 3.44-.97h.06c1.34.02 2.5.4 3.39 1.1.78.62 1.3 1.45 1.55 2.44l.04.17z" />
        </svg>
      </button>
      <button
        type="button"
        class={`social-btn${isActive('yt') ? ' active' : ''}`}
        data-platform="yt"
        title="YouTube"
        aria-label={editAria('yt')}
        onClick={() => onEdit('yt')}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      </button>
      <button
        type="button"
        class={`social-btn${isActive('twitter') ? ' active' : ''}`}
        data-platform="twitter"
        title="X (Twitter)"
        aria-label={editAria('twitter')}
        onClick={() => onEdit('twitter')}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </button>
      <button
        type="button"
        class={`social-btn${isActive('line') ? ' active' : ''}`}
        data-platform="line"
        title="LINE"
        aria-label={editAria('line')}
        onClick={() => onEdit('line')}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.627.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.07 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
        </svg>
      </button>
    </div>
  );
}

interface RelatedActivityCardRowProps {
  event: EventRecord;
  effectiveStatus: string;
  kind: 'registered' | 'hosted';
  registrationStatus?: string;
  onSelect: (id: string) => void;
  operateCtx: OperateContext;
  onEditHosted: (event: EventRecord) => void;
  onCancelHosted: (event: EventRecord) => void;
  onCancelRegistration: (event: EventRecord) => void;
  actionBusy: boolean;
}

function RelatedActivityCardRow({
  event,
  effectiveStatus,
  kind,
  registrationStatus,
  onSelect,
  operateCtx,
  onEditHosted,
  onCancelHosted,
  onCancelRegistration,
  actionBusy,
}: RelatedActivityCardRowProps): JSX.Element {
  const id = String(event.id || '').trim();
  // A `_getEventDisplayTypeKey`：type 在 TYPE_CONFIG 才採用，否則 friendly（課程連動活動 B 尚無欄位，下一批補）。
  const rawType = typeof event['type'] === 'string' ? event['type'].trim() : '';
  const typeKey = rawType && TYPE_CONFIG[rawType] ? rawType : 'friendly';
  const typeLabel = (TYPE_CONFIG[typeKey] ?? TYPE_CONFIG.friendly)?.label ?? '活動';
  const statusConf =
    STATUS_CONFIG[effectiveStatus]
    ?? STATUS_CONFIG[String(event.status || '')]
    ?? STATUS_CONFIG.open
    ?? { label: '開放', css: 'open' };
  const isEnded = effectiveStatus === 'ended' || effectiveStatus === 'cancelled';
  const variants = event['imageVariants'] as Record<string, unknown> | undefined;
  const eventImage = sanitizeHttpAvatarUrl(variants?.['cover'] || event['image']);
  const title = String(event.title || '活動');
  const dateStr = typeof event.date === 'string' ? event.date : '';
  const dateParts = dateStr.split(' ');
  const dateText = dateParts[0] || '';
  const timeText = (dateParts[1] || '').trim();
  const locationText = typeof event['location'] === 'string' ? event['location'] : '';
  const teamOnly = Boolean(event['teamOnly']);
  const rowBaseClass = teamOnly ? 'tl-type-teamonly' : `tl-type-${typeKey}`;
  const metaParts = [typeLabel, timeText, locationText].filter(Boolean);
  const isWaitlisted = registrationStatus === 'waitlisted';

  // 照 A `_renderProfileRelatedActivityActions` / `_profileRelatedActionIcon`
  const actions: JSX.Element[] = [];
  if (id) {
    if (kind === 'registered') {
      const regLabel = isWaitlisted ? '取消候補' : '取消報名';
      actions.push(
        <button
          key="cancel-registration"
          type="button"
          class="profile-related-icon-btn danger"
          data-event-id={id}
          disabled={actionBusy}
          aria-label={lt(regLabel, regLabel)}
          title={lt(regLabel, regLabel)}
          onClick={(e) => {
            e.stopPropagation();
            onCancelRegistration(event);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
            <path d="M9 12h11" />
            <path d="M4 5v14" />
          </svg>
        </button>,
      );
    } else {
      // 照 A：無權限時不顯示；handler 內再以同 helper 檢查一次（R-IAM-011）。
      if (canEditOwnActivityBasic(operateCtx, event)) {
        actions.push(
          <button
            key="edit"
            type="button"
            class="profile-related-icon-btn"
            data-event-id={id}
            disabled={actionBusy}
            aria-label={lt('編輯活動', '編輯活動')}
            title={lt('編輯活動', '編輯活動')}
            onClick={(e) => {
              e.stopPropagation();
              onEditHosted(event);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>,
        );
      }
      if (!isEnded && canCancelOwnActivity(operateCtx, event)) {
        actions.push(
          <button
            key="cancel-event"
            type="button"
            class="profile-related-icon-btn danger"
            data-event-id={id}
            disabled={actionBusy}
            aria-label={lt('取消活動', '取消活動')}
            title={lt('取消活動', '取消活動')}
            onClick={(e) => {
              e.stopPropagation();
              onCancelHosted(event);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 8l8 8" />
              <path d="M16 8l-8 8" />
            </svg>
          </button>,
        );
      }
    }
  }

  return (
    <div
      class={`tl-event-row profile-related-event-card ${rowBaseClass}${isEnded ? ' tl-past' : ''}`}
      data-event-id={id}
      onClick={() => {
        if (id) onSelect(id);
      }}
    >
      {eventImage && (
        <div class="tl-event-thumb profile-related-thumb">
          <img src={eventImage} alt={title} width={42} height={42} loading="lazy" decoding="async" />
          {kind === 'registered' && registrationStatus && (
            <span class={`profile-related-registration-stamp ${isWaitlisted ? 'waitlisted' : 'confirmed'}`}>
              {isWaitlisted ? '候補' : '正取'}
            </span>
          )}
        </div>
      )}
      <div class="tl-event-info">
        <div class="tl-event-title-row">
          <div class="tl-event-title">
            {title}
            {teamOnly && <span class="tl-teamonly-badge">限定</span>}
          </div>
        </div>
        <div class="tl-event-meta">
          {`${dateText ? `${dateText} ・ ` : ''}${metaParts.join(' ・ ')}`}
        </div>
      </div>
      <div class="profile-related-card-right">
        <span class={`tl-event-status ${statusConf.css}`}>{statusConf.label}</span>
        <div class="profile-related-event-actions">{actions}</div>
        <span class="tl-event-arrow">›</span>
      </div>
    </div>
  );
}

export function LegacyRelatedActivities({ uid }: { uid: string }): JSX.Element {
  const location = useLocation();
  const viewer = useViewer();
  const operateCtx = useMemo(() => operateContextFromViewer(viewer), [viewer]);

  // ASSUMPTION: useRemote 以第一個參數值變動重跑載入；用拼上 reloadCount 的 key 觸發重新載入。
  const [reloadCount, setReloadCount] = useState(0);
  const reloadKey = `${uid}:${reloadCount}`;
  const { state, retry } = useRemote(reloadKey, (key: string) => {
    const raw = key.split(':')[0] || uid;
    return loadRelatedActivities(raw);
  });

  // M-170：預設收起（不記憶展開狀態）。
  const [regOpen, setRegOpen] = useState(false);
  const [hostedOpen, setHostedOpen] = useState(false);
  const [hostedLimit, setHostedLimit] = useState(HOSTED_PAGE_SIZE);
  const [editing, setEditing] = useState<EventDoc | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [actionIds, setActionIds] = useState<Record<string, true>>({});

  const busyRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const snapshotRef = useRef<CancelFlowSnapshot | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = (): void => {
    setReloadCount((n) => n + 1);
  };

  // 讓 getViewer 每次都拿到最新 viewer，避免非同步流程取得舊值。
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;

  // 照詳情頁：cancelContext 由 createDetailSignupContexts 提供。
  const contexts = useMemo(
    () => createDetailSignupContexts({
      getViewer: () => viewerRef.current,
      generation: 0,
      getProfile: () => null,
      getCompanionGender: () => undefined,
    }),
    [],
  );

  async function login(): Promise<void> {
    // 照詳情頁：動態載入 auth 後登入；不讓個人頁靜態依賴 auth。
    // ASSUMPTION: `@/data/auth` 匯出 `signIn()`（與 EventDetailPage 相同用法）。
    const auth = await import('@/data/auth');
    await auth.signIn();
  }

  const cancelFlow = useCancelRegistration({
    // 與 cancelContext.getViewer 共用同一個 viewerRef，避免非同步流程取得舊世代登入者。
    getViewerUid: () => viewerRef.current.uid ?? null,
    isAlive: () => mountedRef.current,
    canRun: () => mountedRef.current,
    login,
    cancelContext: contexts.cancel,
    onIntegrityError: () => {
      toast.show({ message: '報名資料尚未同步完成，請重新整理後再試' });
    },
    onSelfCancelled: async () => {
      reload();
    },
    onBatchCancelled: async () => {
      reload();
    },
  });

  // 登入者改變時清掉既有 snapshot 並關閉彈窗，避免交付他人 snapshot。
  const closeModalRef = useRef(cancelFlow.closeModal);
  closeModalRef.current = cancelFlow.closeModal;
  const prevUidRef = useRef(viewer.uid);
  useEffect(() => {
    if (prevUidRef.current === viewer.uid) return;
    prevUidRef.current = viewer.uid;
    snapshotRef.current = null;
    closeModalRef.current();
  }, [viewer.uid]);

  const registered: RegisteredActivity[] =
    state.status === 'ready' ? state.data.registered : [];
  const hosted: HostedActivity[] =
    state.status === 'ready' ? state.data.hosted : [];

  const handleOpenEvent = (eventId: string): void => {
    if (!eventId) return;
    location.route(`/events/${encodeURIComponent(eventId)}`);
  };

  const handleEditHosted = (event: EventRecord): void => {
    // 顯示端與 handler 都走同一 helper 驗權（R-IAM-011）。
    if (!canEditOwnActivityBasic(operateCtx, event)) {
      toast.show({ message: '您只能管理自己的活動', tone: 'error' });
      return;
    }
    setEditing(event as unknown as EventDoc);
  };

  const handleCancelHosted = async (event: EventRecord): Promise<void> => {
    const publicId = String(event.id ?? '').trim();
    if (!publicId) return;
    try {
      // 重讀活動以取得正確 `_docId`（related-activities 的 EventRecord 可能缺 `_docId`）。
      const detail = await loadEventDetail(publicId);
      if (!mountedRef.current) return;
      if (!detail) {
        toast.show({ message: '找不到此活動', tone: 'error' });
        return;
      }
      // 照 A `cancelMyActivity`／`runEventLifecycleAction`；以同一 helper 再檢查權限。
      await runEventLifecycleAction('cancel', detail.event, {
        viewer,
        operateCtx,
        busy: busyRef.current,
        onDone: reload,
      });
    } catch {
      // L-12：獨立非同步流程自行吞錯，不依賴 ErrorBoundary。
    }
  };

  const handleCancelRegistration = async (event: EventRecord): Promise<void> => {
    const publicId = String(event.id ?? '').trim();
    if (!publicId) return;
    if (!viewer.uid) {
      await login();
      return;
    }
    const currentUid = viewer.uid;
    setActionIds((prev) => ({ ...prev, [publicId]: true }));
    try {
      const [detail, regs] = await Promise.all([
        loadEventDetail(publicId),
        loadViewerRegistrations(currentUid),
      ]);
      if (!mountedRef.current) return;
      // 非同步期間登入者改變：丟棄結果、不呼叫 beginCancel。
      if (viewerRef.current.uid !== currentUid) return;
      if (!detail) {
        toast.show({ message: '找不到此活動', tone: 'error' });
        return;
      }
      // 照詳情頁：先以 detail 頁的 sortRegistrations 過濾有效報名（去除已取消／已移除）
      // 並依 registeredAt／promotionOrder 排序，只留本活動的本人與同行者。
      // owned 為空時交由 hook 顯示「你尚未報名此活動」。
      // ASSUMPTION: RegistrationDoc 帶 eventId 欄位；同 A 資料結構（既有格式）。
      const owned = sortRegistrations(
        regs
          .filter((reg) => {
            const eventId = (reg as { eventId?: unknown }).eventId;
            return typeof eventId === 'string' && eventId.trim() === publicId;
          })
          .map((reg) => reg as unknown as DetailRegistration),
      );
      const snapshot: CancelFlowSnapshot = {
        event: detail.event as unknown as DetailEvent,
        publicId,
        owned,
      };
      snapshotRef.current = snapshot;
      await cancelFlow.beginCancel(snapshot);
    } finally {
      if (mountedRef.current) {
        setActionIds((prev) => {
          if (!(publicId in prev)) return prev;
          const next = { ...prev };
          delete next[publicId];
          return next;
        });
      }
    }
  };

  const handleConfirmCancel = async (ids: string[]): Promise<void> => {
    const snapshot = snapshotRef.current;
    if (!snapshot) return;
    setModalBusy(true);
    try {
      await cancelFlow.confirmCancel(snapshot, ids);
    } finally {
      if (mountedRef.current) setModalBusy(false);
    }
  };

  const isActionBusy = (eventId: string | undefined): boolean =>
    typeof eventId === 'string' && eventId.length > 0 && Boolean(actionIds[eventId]);

  const snapshotTitle = snapshotRef.current?.event.title;
  const modalEventTitle = typeof snapshotTitle === 'string' ? snapshotTitle : '';

  return (
    <>
      <div class="info-card profile-related-card" id="profile-registered-activities-card">
        <div
          class={`info-title profile-collapse-toggle${regOpen ? ' open' : ''}`}
          role="button"
          tabIndex={0}
          aria-expanded={regOpen}
          onClick={() => setRegOpen((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setRegOpen((prev) => !prev);
            }
          }}
        >
          <span style="display:flex;align-items:center;gap:.45rem">
            我的報名
            <span class="fav-count-badge" id="profile-registered-activities-count">
              {String(registered.length)}
            </span>
          </span>
          <span class="profile-collapse-arrow">▶</span>
        </div>
        {/* M-170：只有展開時才渲染清單內容（照 A `toggleProfileSection` 展開才重繪） */}
        {regOpen && (
          <div
            class="profile-collapse-content profile-related-activity-list"
            id="profile-registered-activities-list"
          >
            {state.status === 'loading' && <Loading />}
            {state.status === 'error' && <Failure retry={retry} />}
            {state.status === 'ready' && (
              registered.length === 0 ? (
                <div class="profile-related-empty">目前沒有正取或候補中的報名活動</div>
              ) : (
                registered.map((item, idx) => (
                  <RelatedActivityCardRow
                    key={item.event.id || `reg-${idx}`}
                    event={item.event}
                    effectiveStatus={item.effectiveStatus}
                    kind="registered"
                    registrationStatus={item.registrationStatus}
                    onSelect={handleOpenEvent}
                    operateCtx={operateCtx}
                    onEditHosted={handleEditHosted}
                    onCancelHosted={handleCancelHosted}
                    onCancelRegistration={handleCancelRegistration}
                    actionBusy={isActionBusy(item.event.id)}
                  />
                ))
              )
            )}
          </div>
        )}
      </div>

      <div class="info-card profile-related-card" id="profile-hosted-activities-card">
        <div
          class={`info-title profile-collapse-toggle${hostedOpen ? ' open' : ''}`}
          role="button"
          tabIndex={0}
          aria-expanded={hostedOpen}
          onClick={() => setHostedOpen((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setHostedOpen((prev) => !prev);
            }
          }}
        >
          <span style="display:flex;align-items:center;gap:.45rem">
            我開的團
            <span class="fav-count-badge" id="profile-hosted-activities-count">
              {String(hosted.length)}
            </span>
          </span>
          <span class="profile-collapse-arrow">▶</span>
        </div>
        {/* M-170：只有展開時才渲染清單內容（照 A `toggleProfileSection` 展開才重繪） */}
        {hostedOpen && (
          <div
            class="profile-collapse-content profile-related-activity-list"
            id="profile-hosted-activities-list"
          >
            {state.status === 'loading' && <Loading />}
            {state.status === 'error' && <Failure retry={retry} />}
            {state.status === 'ready' && (
              hosted.length === 0 ? (
                <div class="profile-related-empty">目前沒有報名中的主辦活動</div>
              ) : (
                <>
                  {hosted.slice(0, hostedLimit).map((item, idx) => (
                    <RelatedActivityCardRow
                      key={item.event.id || `hosted-${idx}`}
                      event={item.event}
                      effectiveStatus={item.effectiveStatus}
                      kind="hosted"
                      onSelect={handleOpenEvent}
                      operateCtx={operateCtx}
                      onEditHosted={handleEditHosted}
                      onCancelHosted={handleCancelHosted}
                      onCancelRegistration={handleCancelRegistration}
                      actionBusy={isActionBusy(item.event.id)}
                    />
                  ))}
                  {hostedLimit < hosted.length && (
                    <div class="profile-related-load-more">
                      <div class="profile-related-load-more-note">
                        {`已顯示 ${Math.min(hostedLimit, hosted.length)} / ${hosted.length}`}
                      </div>
                      <button
                        type="button"
                        class="outline-btn profile-related-load-more-btn"
                        onClick={() => setHostedLimit((prev) => prev + HOSTED_PAGE_SIZE)}
                      >
                        查看更多
                      </button>
                    </div>
                  )}
                </>
              )
            )}
          </div>
        )}
      </div>

      {/* 編輯活動：lazy 載入表單，不讓個人頁靜態依賴 EventFormModal。 */}
      {editing && (
        <Suspense fallback={null}>
          <LazyEventFormModal
            open
            mode="edit"
            existing={editing}
            viewer={viewer}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        </Suspense>
      )}

      {/* 同行者取消彈窗：由 hook 渲染，只在本元件內。 */}
      {cancelFlow.renderModal({
        busy: modalBusy,
        eventTitle: modalEventTitle,
        onConfirm: (ids) => {
          void handleConfirmCancel(ids);
        },
      })}
    </>
  );
}
