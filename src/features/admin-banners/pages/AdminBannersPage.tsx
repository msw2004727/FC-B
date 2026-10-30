import '@/styles/legacy/admin-banners.css';
import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useGoBack } from '@/core/back-guard';
import { useT } from '@/i18n/i18n';
import { useViewer } from '@/features/profile/data/viewer';
import { appConfirm } from '@/ui/AppConfirm';
import { EmptyState } from '@/ui/EmptyState';
import { toast } from '@/ui/Toast';
import { BannerForm } from '../components/BannerForm';
import { BannerSlotCard } from '../components/BannerSlotCard';
import {
  BannerWriteError,
  applyDueBannerTransitions,
  canManageBanners,
  clearBannerSlot,
  delistBanner,
  loadBannerSlots,
  relistBanner,
  saveBanner,
} from '../data/banner-admin';
import type { BannerCardAction, BannerSaveWrite, BannerSlot } from '../data/banner-model';
import { BannerImageError, uploadBannerImage } from '../data/banner-upload';

/**
 * Banner 後台頁開著時，每隔多久重跑一次惰性狀態轉換（scheduled→active、到期→expired）。
 * 來源：A 的 `_autoExpireAds` 每 60 秒（A `app.js` 的 `setInterval(() => App._autoExpireAds(), 60000)`）。
 * 顧問 2026-10-27 裁定（D1 觸發面採 (2)：這一頁開著就定時跑）；伺服器排程另案 T-064。
 * 只在這個管理員頁內執行，首頁公開路徑與其他頁面絕不寫。登記於 FC `docs/tunables.md`（R-TUNE-001）。
 */
export const BANNER_TRANSITION_INTERVAL_MS = 60_000;

type LoadState = 'loading' | 'ready' | 'error';

interface LoadOptions {
  /** 載入後套用惰性狀態轉換（D1 (b)）；刪除／下架後的重讀不需要。 */
  transitions: boolean;
  /** 顯示「載入中」；寫入後的重讀不閃爍，維持原畫面。 */
  showLoading: boolean;
}

/** 已上傳過的圖片：同一張裁切結果重試儲存時直接用網址，不重傳（F10）。 */
interface UploadedImage {
  docId: string;
  dataUrl: string;
  url: string;
}

/**
 * 後台「首頁管理」頁（路由 `/admin/banners`，A `page-admin-banners`）。
 * 範圍：只做「Banner 廣告（3 個廣告位）」一個折疊區塊；其餘 10 個區塊（排版順序、觀賽底圖…）等切換後再補。
 * - 權限：入口與所有寫入動作共用 `canManageBanners`（`admin.banners.entry`），寫入函式內部也驗。
 * - 惰性狀態轉換（D1 採 (b)）：只在管理員開這一頁、載入完成後執行；首頁公開路徑不寫。
 * - 寫入成功之後的重讀失敗不算寫入失敗（F9）：只顯示載入錯誤與重試，不會再跳「儲存失敗」。
 */
export default function AdminBannersPage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const goBack = useGoBack('/');
  const canManage = canManageBanners(viewer);
  const uid = viewer.uid;

  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<BannerSlot[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [editing, setEditing] = useState<BannerSlot | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const loadSeq = useRef(0);
  const savingRef = useRef(false);
  const busyRef = useRef(false);
  const uploadedRef = useRef<UploadedImage | null>(null);
  const tickingRef = useRef(false);

  // F5：「重新上架」等依時間顯示的判斷用每次 render 當下的時間，不是載入當下凍結的時間。
  const nowMs = Date.now();

  /** 讀取並（選擇性）套用轉換；不會丟錯，失敗時畫面進入「載入失敗，可重試」。 */
  const load = useCallback(async (options: LoadOptions): Promise<void> => {
    const seq = ++loadSeq.current;
    if (options.showLoading) setState('loading');
    try {
      let list = await loadBannerSlots();
      if (seq !== loadSeq.current) return;
      if (options.transitions) {
        const { applied } = await applyDueBannerTransitions(list, viewerRef.current);
        if (seq !== loadSeq.current) return;
        if (applied.length > 0) {
          list = await loadBannerSlots();
          if (seq !== loadSeq.current) return;
        }
      }
      setSlots(list);
      setState('ready');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[banners] load failed', err);
      if (seq !== loadSeq.current) return;
      setState('error');
    }
  }, []);

  // L-43：uid／權限到位才載入；uid 或權限改變時重讀，過期結果丟棄。
  useEffect(() => {
    if (!canManage) return undefined;
    load({ transitions: true, showLoading: true }).catch(() => {
      // load 內部已處理錯誤。
    });
    return () => {
      loadSeq.current += 1;
    };
  }, [canManage, uid, load]);

  // 定時轉換：頁面開著每 60 秒重跑一次（只在這個管理員頁）。
  // - 上一輪還沒結束不重疊；使用者正在儲存／操作（含寫入後的重讀）時略過，避免互相干擾。
  //   不看 `document.hidden`：A 的 `_autoExpireAds` 不管分頁是否隱藏都跑，瀏覽器本來就會把背景分頁的計時器節流到約每分鐘一次。
  // - 冪等：狀態已正確時 `applyDueBannerTransitions` 0 寫入、不寫日誌、不清快照。
  // - 失敗只 `console.warn`，不改變頁面狀態（不顯示載入失敗）。
  // - 卸載、權限或 uid 改變時清除計時器，並讓進行中的那一輪結果作廢。
  useEffect(() => {
    if (!canManage) return undefined;
    let alive = true;
    const tick = async (): Promise<void> => {
      if (!alive || tickingRef.current || savingRef.current || busyRef.current) return;
      const actor = viewerRef.current;
      if (!canManageBanners(actor)) return;
      tickingRef.current = true;
      const seq = ++loadSeq.current;
      try {
        let list = await loadBannerSlots();
        if (!alive || seq !== loadSeq.current) return;
        const { applied } = await applyDueBannerTransitions(list, actor);
        if (!alive || seq !== loadSeq.current) return;
        if (applied.length > 0) {
          list = await loadBannerSlots();
          if (!alive || seq !== loadSeq.current) return;
        }
        setSlots(list);
        setState('ready');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[banners] periodic transition failed', err);
      } finally {
        tickingRef.current = false;
      }
    };
    const timer = setInterval(() => {
      tick().catch(() => {
        // tick 內部已處理錯誤。
      });
    }, BANNER_TRANSITION_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [canManage, uid]);

  const closeEditor = useCallback((): void => {
    uploadedRef.current = null;
    setEditing(null);
  }, []);

  const runAction = useCallback(
    async (action: BannerCardAction, slot: BannerSlot): Promise<void> => {
      if (!canManageBanners(viewerRef.current)) {
        toast.show({ message: t('admin-banners.toast.denied'), tone: 'error' });
        return;
      }
      if (action === 'edit') {
        uploadedRef.current = null;
        setEditing(slot);
        return;
      }
      if (busyRef.current) return;
      if (action === 'clear' && !(await appConfirm(t('admin-banners.confirm.clear')))) return;
      // 忙碌狀態（卡片按鈕停用、定時輪略過）一路維持到寫入後的重讀完成，避免寫入成功到畫面更新之間按鈕又能按，
      // 或定時輪插進來讓這次重讀作廢（Opus 終驗 R-2）。`load` 不會丟錯，外層 finally 保證一定解除。
      busyRef.current = true;
      setBusyDocId(slot.docId);
      try {
        let written = false;
        let expiredRelist = false;
        try {
          const actor = viewerRef.current;
          if (action === 'delist') await delistBanner(slot, actor);
          else if (action === 'relist') await relistBanner(slot, actor);
          else await clearBannerSlot(slot, actor);
          written = true;
          const message =
            action === 'delist'
              ? t('admin-banners.toast.delisted')
              : action === 'relist'
                ? t('admin-banners.toast.relisted')
                : t('admin-banners.toast.cleared');
          toast.show({ message, tone: 'success' });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[banners] action failed', action, err);
          expiredRelist = err instanceof BannerWriteError && err.code === 'relist-expired';
          toast.show({
            message: expiredRelist
              ? t('admin-banners.toast.relistExpired')
              : t('admin-banners.toast.actionError'),
            tone: 'error',
          });
        }
        // 寫入成功後才重讀（F9：重讀失敗不再顯示「操作失敗」）。上架要套用轉換（F5）；
        // 重新上架被擋（結束時間已過）時也重讀，讓畫面的按鈕跟上現況。
        if (written || expiredRelist) {
          await load({ transitions: action === 'relist' || expiredRelist, showLoading: false });
        }
      } finally {
        busyRef.current = false;
        setBusyDocId(null);
      }
    },
    [load, t],
  );

  const handleSubmit = useCallback(
    async (write: BannerSaveWrite): Promise<void> => {
      const target = editing;
      if (!target || savingRef.current) return;
      const actor = viewerRef.current;
      if (!canManageBanners(actor)) {
        toast.show({ message: t('admin-banners.toast.denied'), tone: 'error' });
        return;
      }
      // 「儲存中」（含定時輪略過）一路維持到寫入後的重讀完成（Opus 終驗 R-2）；`load` 不會丟錯，外層 finally 保證一定解除。
      savingRef.current = true;
      setSaving(true);
      let busyHeld = false;
      try {
        let written = false;
        try {
          let image = write.image;
          if (image && image.startsWith('data:')) {
            const uploaded = uploadedRef.current;
            if (uploaded && uploaded.docId === target.docId && uploaded.dataUrl === image) {
              // F10：同一張圖上次已經傳成功（後面寫文件失敗才重試），直接用網址。
              image = uploaded.url;
            } else {
              toast.show({ message: t('admin-banners.toast.uploading'), tone: 'info' });
              // 上傳失敗（回 null）時 `uploadImageDataUrl` 已經顯示過錯誤提示。
              const url = await uploadBannerImage(image, target.id, actor);
              if (!url) return;
              uploadedRef.current = { docId: target.docId, dataUrl: image, url };
              image = url;
            }
          }
          await saveBanner(target, { ...write, image }, actor);
          written = true;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[banners] save failed', err);
          const message =
            err instanceof BannerImageError
              ? err.code === 'too-large'
                ? t('admin-banners.toast.imageTooLarge')
                : t('admin-banners.toast.imageProcessError')
              : t('admin-banners.toast.saveError');
          toast.show({ message, tone: 'error' });
        }
        if (!written) return;
        toast.show({
          message:
            write.status === 'scheduled'
              ? t('admin-banners.toast.savedScheduled', { time: write.publishAt })
              : t('admin-banners.toast.savedNow'),
          tone: 'success',
        });
        closeEditor();
        // 彈窗關了以後到重讀完成之前，卡片上的按鈕也維持停用。
        busyRef.current = true;
        busyHeld = true;
        setBusyDocId(target.docId);
        // F5：儲存後的重讀要套用轉換（例如預約時間已經到的立刻轉成啟用）；F9：重讀失敗不影響「已儲存」。
        await load({ transitions: true, showLoading: false });
      } finally {
        savingRef.current = false;
        setSaving(false);
        if (busyHeld) {
          busyRef.current = false;
          setBusyDocId(null);
        }
      }
    },
    [closeEditor, editing, load, t],
  );

  const header = (
    <div class="page-header">
      <button type="button" class="back-btn" aria-label={t('admin-banners.back')} onClick={goBack}>
        <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M15 6l-6 6 6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <h2>{t('admin-banners.title')}</h2>
    </div>
  );

  if (!canManage) {
    return (
      <div class="legacy-ui">
        <section class="page active" id="page-admin-banners">
          {header}
          <EmptyState
            title={t('admin-banners.permissionDenied')}
            body={t('admin-banners.permissionDeniedBody')}
          />
        </section>
      </div>
    );
  }

  const toggle = (): void => setOpen((value) => !value);

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-admin-banners">
        {header}
        {/* Banner 廣告（A 的第 2 個折疊區塊；其餘區塊本批不做） */}
        <div class="ad-collapse-section">
          <div
            class={`admin-section-label ad-collapse-toggle${open ? ' open' : ''}`}
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onClick={toggle}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggle();
              }
            }}
          >
            <span>{t('admin-banners.sectionTitle')}</span>
            <span class="ad-collapse-arrow">▶</span>
          </div>
          <div class="ad-collapse-content" style={open ? undefined : 'display:none'}>
            <div class="card-list" id="banner-manage-list">
              {state === 'loading' && slots.length === 0 ? (
                <p style="color:var(--text-muted);padding:.5rem" role="status">
                  {t('admin-banners.loading')}
                </p>
              ) : null}
              {state === 'error' ? (
                <div style="padding:.5rem" role="alert">
                  <p style="color:var(--text-muted)">{t('admin-banners.loadError')}</p>
                  <button
                    type="button"
                    class="outline-btn"
                    style="margin-top:.5rem"
                    onClick={() => {
                      load({ transitions: true, showLoading: true }).catch(() => {
                        // 內部已處理。
                      });
                    }}
                  >
                    {t('admin-banners.retry')}
                  </button>
                </div>
              ) : null}
              {state === 'ready' && slots.length === 0 ? (
                <p style="color:var(--text-muted);padding:.5rem">{t('admin-banners.empty')}</p>
              ) : null}
              {slots.map((slot) => (
                <BannerSlotCard
                  key={slot.docId}
                  slot={slot}
                  nowMs={nowMs}
                  canManage={canManage}
                  busy={busyDocId !== null}
                  onAction={(action, target) => {
                    runAction(action, target).catch(() => {
                      // runAction 內部已處理。
                    });
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        {editing ? (
          <BannerForm
            key={editing.docId}
            slot={editing}
            saving={saving}
            onSubmit={handleSubmit}
            onCancel={closeEditor}
          />
        ) : null}
      </section>
    </div>
  );
}
