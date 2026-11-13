import '../tournaments.css';
// 液態光澤（2026-11-13，與活動頁同一風格；只套 #page-tournaments）
import '../legacy/tournaments-glass.css';
import '@/styles/legacy/reg-loading.css';
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { shouldLeaveAnchorClick } from '@/core/open-external';
import { lt, useT } from '@/i18n/i18n';
import { useViewer } from '@/features/profile/data/viewer';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import { TournamentCardForm } from '../components/TournamentCardForm';
import {
  TOURNAMENT_CARD_TABS,
  canManageTournamentCards,
  filterTournamentCards,
  formatCardDates,
  isTournamentCardEnded,
  sortTournamentCards,
  taipeiTodayKey,
  type TournamentCard,
  type TournamentCardTab,
  type TournamentCardWrite,
} from '../data/card-model';
import {
  TournamentCardError,
  deleteTournamentCard,
  loadTournamentCards,
  newTournamentCardId,
  saveTournamentCard,
  uploadTournamentCardImage,
  type UploadedImage,
} from '../data/cards-repo';
import { openCardLink } from '../data/open-card-link';

type LoadState = 'loading' | 'ready' | 'error';

/** 編輯中的卡片；`card: null` 是新增。 */
interface EditingState {
  card: TournamentCard | null;
  /** 新增時先產生 id，上傳圖片與寫文件共用。 */
  id: string;
}

/**
 * 新站「賽事」頁（路由 `/tournaments`，T-089）：外部連結的賽事卡片清單。
 * - 讀取：進頁只發 1 個查詢；頁籤與「顯示已結束」在前端篩，寫入後直接更新本機清單，不重讀。
 * - 管理：「＋ 新增賽事」、卡片鉛筆與所有寫入共用 `canManageTournamentCards`（R-IAM-011）。
 */
export default function TournamentsPage(): JSX.Element {
  const t = useT();
  const location = useLocation();
  const viewer = useViewer();
  const canManage = canManageTournamentCards(viewer);

  const [cards, setCards] = useState<TournamentCard[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [tab, setTab] = useState<TournamentCardTab>('all');
  const [showEnded, setShowEnded] = useState(true);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [busy, setBusy] = useState(false);

  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const busyRef = useRef(false);
  const loadSeq = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current;
    setState('loading');
    try {
      const list = await loadTournamentCards();
      if (seq !== loadSeq.current) return;
      setCards(list);
      setState('ready');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[tournaments] load failed', err);
      if (seq !== loadSeq.current) return;
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadSeq.current += 1;
    };
  }, [load]);

  const todayKey = taipeiTodayKey(Date.now());
  const visible = useMemo(
    () => filterTournamentCards(cards, tab, showEnded, todayKey),
    [cards, tab, showEnded, todayKey],
  );

  const openEditor = (card: TournamentCard | null): void => {
    if (!canManageTournamentCards(viewerRef.current)) {
      toast.show({ message: t('tournaments.toast.denied'), tone: 'error' });
      return;
    }
    setEditing({ card, id: card ? card.id : newTournamentCardId() });
  };

  const closeEditor = (): void => {
    if (busyRef.current) return;
    setEditing(null);
  };

  const handleSubmit = async (write: TournamentCardWrite, imageDataUrl: string | null): Promise<void> => {
    const target = editing;
    if (!target || busyRef.current) return;
    const actor = viewerRef.current;
    if (!canManageTournamentCards(actor)) {
      toast.show({ message: t('tournaments.toast.denied'), tone: 'error' });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      let image: UploadedImage | null = null;
      if (imageDataUrl) {
        toast.show({ message: t('tournaments.toast.uploading'), tone: 'info' });
        image = await uploadTournamentCardImage(target.id, imageDataUrl, actor);
        if (!image) {
          toast.show({ message: t('tournaments.toast.saveError'), tone: 'error' });
          return;
        }
      }
      const saved = await saveTournamentCard(
        { existing: target.card, id: target.id, write, image },
        actor,
      );
      setCards((prev) => sortTournamentCards([saved, ...prev.filter((card) => card.id !== saved.id)]));
      toast.show({ message: t('tournaments.toast.saved'), tone: 'success' });
      busyRef.current = false;
      setEditing(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[tournaments] save failed', err);
      const message = err instanceof TournamentCardError && err.code === 'image-too-large'
        ? t('tournaments.toast.imageTooLarge')
        : t('tournaments.toast.saveError');
      toast.show({ message, tone: 'error' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleDelete = async (card: TournamentCard): Promise<void> => {
    if (busyRef.current) return;
    const actor = viewerRef.current;
    if (!canManageTournamentCards(actor)) {
      toast.show({ message: t('tournaments.toast.denied'), tone: 'error' });
      return;
    }
    if (!(await appConfirm(t('tournaments.confirmDelete', { name: card.name })))) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await deleteTournamentCard(card, actor);
      setCards((prev) => prev.filter((item) => item.id !== card.id));
      toast.show({ message: t('tournaments.toast.deleted'), tone: 'success' });
      busyRef.current = false;
      setEditing(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[tournaments] delete failed', err);
      toast.show({ message: t('tournaments.toast.deleteError'), tone: 'error' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleCardClick = (event: JSX.TargetedMouseEvent<HTMLAnchorElement>, url: string): void => {
    if (shouldLeaveAnchorClick(event)) return;
    event.preventDefault();
    openCardLink(url);
  };

  return (
    <div class="legacy-ui tournaments-root">
      <section class="page active tc-page" id="page-tournaments">
        <div class="page-header">
          <button
            class="back-btn"
            type="button"
            aria-label={lt('返回', '返回')}
            data-i18n-aria-label="返回"
            onClick={() => location.route('/')}
          >
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
          <h2 class="page-header-title">{t('tournaments.heading')}</h2>
        </div>

        <div class="tc-tabs" role="tablist">
          {TOURNAMENT_CARD_TABS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              class={`tc-tab${tab === value ? ' active' : ''}`}
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              {t(`tournaments.tab.${value}`)}
            </button>
          ))}
          {canManage ? (
            <button
              type="button"
              class="primary-btn small tc-add-btn"
              id="tc-add-btn"
              onClick={() => openEditor(null)}
            >
              {t('tournaments.add')}
            </button>
          ) : null}
        </div>
        <div class="tc-panel" role="tabpanel">
          <div class="tc-toolbar">
            <label>
              <span>{t('tournaments.showEnded')}</span>
              <span class="toggle-switch">
                <input
                  type="checkbox"
                  id="tc-show-ended"
                  checked={showEnded}
                  onChange={(event) => setShowEnded(event.currentTarget.checked)}
                />
                <span class="toggle-slider" />
              </span>
            </label>
          </div>

          {state === 'loading' && cards.length === 0 ? (
            <div aria-busy="true">
              <div class="reg-loading" role="status" style="white-space:nowrap">{t('tournaments.loading')}</div>
              <div class="reg-loading-skeleton" aria-hidden="true">
                <div class="reg-loading-skeleton-row" />
                <div class="reg-loading-skeleton-row" />
                <div class="reg-loading-skeleton-row" />
              </div>
            </div>
          ) : null}
          {state === 'error' ? (
            <div class="tc-status" role="alert">
              <p>{t('tournaments.loadError')}</p>
              <button type="button" class="outline-btn" onClick={() => void load()}>
                {t('tournaments.retry')}
              </button>
            </div>
          ) : null}
          {state === 'ready' && visible.length === 0 ? (
            <p class="tc-status">{t('tournaments.empty')}</p>
          ) : null}

          {visible.map((card) => {
            const ended = isTournamentCardEnded(card, todayKey);
            return (
              <div key={card.id} class={`tc-card${ended ? ' ended' : ''}`} data-card-id={card.id}>
                <a
                  class="tc-card-link"
                  href={card.url}
                  onClick={(event) => handleCardClick(event, card.url)}
                >
                  {card.image ? (
                    <img class="tc-card-img" src={card.image} alt="" loading="lazy" />
                  ) : (
                    <div class="tc-card-img" aria-hidden="true" />
                  )}
                  <div class="tc-card-body">
                    <div class="tc-card-text">
                      <div class="tc-card-name">{card.name}</div>
                      <div class="tc-card-dates">{formatCardDates(card)}</div>
                    </div>
                    <span class="tc-chip">{t(`tournaments.tab.${card.type}`)}</span>
                  </div>
                </a>
                {canManage ? (
                  <button
                    type="button"
                    class="tc-edit"
                    aria-label={t('tournaments.edit')}
                    onClick={() => openEditor(card)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
                    </svg>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {editing ? (
          <TournamentCardForm
            key={editing.id}
            card={editing.card}
            busy={busy}
            onSubmit={(write, imageDataUrl) => void handleSubmit(write, imageDataUrl)}
            onDelete={(card) => void handleDelete(card)}
            onClose={closeEditor}
          />
        ) : null}
      </section>
    </div>
  );
}
