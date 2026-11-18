import '../tournaments.css';
// 液態光澤（2026-11-13，與活動頁同一風格；只套 #page-tournaments）
import '../legacy/tournaments-glass.css';
// 分類色與隊徽底色。只在賽事頁這個 chunk，不進首頁入口。
import '@/styles/category-tokens.css';
// 列表 v2（來源切換、封面、分類色小標）。開關關閉時沒有這些 class，既有卡片不受影響。
import '../list-v2.css';
import '@/styles/legacy/reg-loading.css';
import type { ComponentType, JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { COMPETITIONS_ENABLED } from '@/feature-overrides';
import { useLocation } from 'preact-iso';
import { shouldLeaveAnchorClick } from '@/core/open-external';
import { lt, useT } from '@/i18n/i18n';
import { getLastKnownAuthUid } from '@/data/auth';
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
import { readCardsCache, writeCardsCache } from '../data/cards-cache';
import {
  competitionSourceFromQuery,
  tournamentsSourcePath,
  type CompetitionSource,
} from '../source';

/** 讀取超過這麼久沒回來就走既有的錯誤＋重試；晚到的結果照常收尾。 */
export const TOURNAMENTS_LOAD_TIMEOUT_MS = 8_000;

const EXTERNAL_CHIP = {
  league: 'cpl-chip--league',
  cup: 'cpl-chip--cup',
  friendly: 'cpl-chip--friendly',
} as const;

/**
 * 外部卡分類 class。只接受 league／cup／friendly。
 * 其他類型不加分類 class，原字串不進 class。
 */
export function externalChipClass(type: unknown, themed: boolean): string {
  if (!themed) return 'tc-chip';
  if (type !== 'league' && type !== 'cup' && type !== 'friendly') return 'tc-chip cpl-chip';
  return `tc-chip cpl-chip ${EXTERNAL_CHIP[type]}`;
}

interface InAppSlotProps {
  tab: TournamentCardTab;
  /** 閘門開著且目前選站內時才畫卡。外部來源時元件留著，避免重讀。 */
  active: boolean;
  onGate: (open: boolean) => void;
}

/** 站內賽事整區。字面常數關閉時，打包器連 InAppSection 的 chunk 一起刪。 */
function InAppCompetitionsSlot(props: InAppSlotProps): JSX.Element | null {
  if (!COMPETITIONS_ENABLED) return null;
  return <InAppCompetitionsLoader {...props} />;
}

function InAppCompetitionsLoader(props: InAppSlotProps): JSX.Element | null {
  const [Slot, setSlot] = useState<ComponentType<InAppSlotProps> | null>(null);
  useEffect(() => {
    let alive = true;
    void import('@/features/competitions/components/InAppSection').then((mod) => {
      if (alive) setSlot(() => mod.InAppSection);
    }).catch(() => {
      // 這個 chunk 載入失敗時整區不顯示，賽事頁其餘卡片照常。
      if (alive) setSlot(null);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!Slot) return null;
  return <Slot {...props} />;
}

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
  // 只在登入狀態已確定、且與畫面帳號一致時才用快取（同活動詳情先畫的規則）。
  const [cards, setCards] = useState<TournamentCard[]>(() => {
    const uid = viewer.uid ?? null;
    return getLastKnownAuthUid() === uid ? readCardsCache(uid) ?? [] : [];
  });
  const [state, setState] = useState<LoadState>('loading');
  // 管理入口等伺服器結果與權限都到齊才出現（§3.232 (d)）；先顯示的快取期間不出現。
  const canManage = state === 'ready' && canManageTournamentCards(viewer);
  const [tab, setTab] = useState<TournamentCardTab>('all');
  const [showEnded, setShowEnded] = useState(true);
  // 閘門沒過維持 false：不畫來源切換，外部卡維持原本的小標。
  const [inAppOpen, setInAppOpen] = useState(false);
  // 非法 ?src 只影響畫面預設，這裡不改網址。
  const source = competitionSourceFromQuery(location.query?.src);
  const showInApp = inAppOpen && source === 'in';
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [busy, setBusy] = useState(false);

  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const busyRef = useRef(false);
  const loadSeq = useRef(0);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  // 目前這份清單是替哪個帳號讀的；寫快取一律用它，不用寫入當下的帳號（避免換帳號後寫錯格）。
  const loadedUid = useRef<string | null>(viewer.uid ?? null);

  const load = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current;
    const uid = viewerRef.current.uid ?? null;
    setState('loading');
    const timer = setTimeout(() => {
      if (seq === loadSeq.current) setState('error');
    }, TOURNAMENTS_LOAD_TIMEOUT_MS);
    try {
      const list = await loadTournamentCards();
      if (seq !== loadSeq.current) return;
      // 只有伺服器確認過的清單（與之後寫入的本機更新）才寫進快取。
      // 進頁後立刻離開時，晚到的結果被序號丟棄、也不寫快取；下次進頁照常重讀（顧問 §3.233 ① MiMo P3-5，接受）。
      loadedUid.current = uid;
      writeCardsCache(uid, list);
      setCards(list);
      setState('ready');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[tournaments] load failed', err);
      if (seq !== loadSeq.current) return;
      setState('error');
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadSeq.current += 1;
    };
  }, [load]);

  // 停在頁面上時換帳號或登出：清掉前一個帳號的清單並重讀（只有換帳號時才多這一次讀取）。
  const mountedUid = useRef(viewer.uid ?? null);
  useEffect(() => {
    const uid = viewer.uid ?? null;
    if (uid === mountedUid.current) return;
    mountedUid.current = uid;
    setCards([]);
    void load();
  }, [viewer.uid, load]);

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
      const next = sortTournamentCards([saved, ...cardsRef.current.filter((card) => card.id !== saved.id)]);
      writeCardsCache(loadedUid.current, next);
      setCards(next);
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
      const next = cardsRef.current.filter((item) => item.id !== card.id);
      writeCardsCache(loadedUid.current, next);
      setCards(next);
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

  const chooseSource = (next: CompetitionSource): void => {
    const path = tournamentsSourcePath(window.location.pathname, window.location.search, next);
    const go = location.route as undefined | ((url: string, replace?: boolean) => void);
    if (typeof go === 'function') go(path, true);
  };

  return (
    <div class="legacy-ui tournaments-root" data-v2={inAppOpen ? '1' : undefined}>
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

        {inAppOpen ? (
          <div class="cpl-src" role="tablist" aria-label="賽事來源">
            <button
              type="button"
              role="tab"
              aria-selected={source === 'in'}
              class={source === 'in' ? 'on' : ''}
              onClick={() => chooseSource('in')}
            >
              站內賽事
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={source === 'ext'}
              class={source === 'ext' ? 'on' : ''}
              onClick={() => chooseSource('ext')}
            >
              外部賽事
            </button>
          </div>
        ) : null}

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
          <InAppCompetitionsSlot tab={tab} active={showInApp} onGate={setInAppOpen} />
          {showInApp ? null : (
          <>
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
                    <span class={externalChipClass(card.type, inAppOpen)}>{t(`tournaments.tab.${card.type}`)}</span>
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
          </>
          )}
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
