import '../tournaments.css';
// 液態光澤（2026-11-13，與活動頁同一風格；只套 #page-tournaments）
import '../legacy/tournaments-glass.css';
// 分類色與隊徽底色。只在賽事頁這個 chunk，不進首頁入口。
import '@/styles/category-tokens.css';
// 列表 v2（來源切換、封面、分類色小標）。開關關閉時沒有這些 class，既有卡片不受影響。
import '../list-v2.css';
import '@/styles/legacy/reg-loading.css';
import type { ComponentType, JSX } from 'preact';
import { Button } from '@/ui/Button';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { COMPETITIONS_ENABLED } from '@/feature-overrides';
import { useLocation } from 'preact-iso';
import { shouldLeaveAnchorClick } from '@/core/open-external';
import { lt, useT } from '@/i18n/i18n';
import { getLastKnownAuthUid } from '@/data/auth';
import { readAuthHint } from '@/data/auth-hint';
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
  COMPETITIONS_DEFAULT_SOURCE,
  tournamentsSourcePath,
  type CompetitionSource,
} from '../source';
import { readInAppHint, writeInAppHint } from '../inapp-hint';

/** 讀取超過這麼久沒回來就走既有的錯誤＋重試；晚到的結果照常收尾。 */
export const TOURNAMENTS_LOAD_TIMEOUT_MS = 8_000;

/**
 * 站內賽事閘門（載入站內區塊程式檔＋讀 cpConfig/launch）多久沒回就先當作沒過（顧問 §3.368 P2-1）。
 * 外部清單從頭到尾不等閘門；逾時只是先定案「不顯示切換」，晚到的通過仍會補上切換。
 */
export const COMPETITIONS_GATE_TIMEOUT_MS = 2_000;

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
  onGate: (open: boolean, reason?: 'denied') => void;
  onReady?: () => void;
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
      // 這個 chunk 載入失敗時整區不顯示，賽事頁其餘卡片照常。閘門視為沒過，避免一直空白。
      if (!alive) return;
      setSlot(null);
      props.onGate?.(false);
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
  // 開關打開時閘門在背景判定；判定中、逾時、沒過都照開關關閉時的樣子畫外部清單（含本機快取）。
  // 通過才補上「站內／外部」切換與站內區塊（顧問 §3.368 P2-1，取代「判定中先顯示骨架、不畫外部清單」）。
  const [gate, setGate] = useState<'pending' | 'open' | 'closed'>(COMPETITIONS_ENABLED ? 'pending' : 'closed');
  const gateRef = useRef(gate);
  gateRef.current = gate;
  // 非法 ?src 只影響畫面預設，這裡不改網址。
  const rawSrc = location.query?.src;
  // 這台裝置上次閘門有過、上次是登入狀態、網址沒有指定外部：一進來就先畫站內（顧問 11-20 選方案 2，
  // 取代 §3.373「預設一律停在外部」）。只在進頁當下判斷一次。沒有線索的人走原本的路徑，一個字都不變。
  const [preferIn] = useState(() => COMPETITIONS_ENABLED && rawSrc !== 'ext' && readAuthHint() && readInAppHint());
  // 沒有 ?src 時的來源。閘門先定案沒過（逾時、未登入定案前）之後才通過，使用者已經在看外部清單，
  // 這時預設留在外部、只補切換，不把畫面整個換成站內。使用者點選後改回點選的那一側。
  const [fallbackSource, setFallbackSource] = useState<CompetitionSource>(preferIn ? 'in' : COMPETITIONS_DEFAULT_SOURCE);
  const inAppOpen = gate === 'open';
  const onGate = useCallback((open: boolean, reason?: 'denied') => {
    if (open && gateRef.current === 'closed') setFallbackSource('ext');
    // 通過就記下；只有伺服器明確判定看不到才清。逾時與讀取失敗不清（只讓這一次退回外部）。
    if (open) writeInAppHint(true);
    else if (reason === 'denied') writeInAppHint(false);
    gateRef.current = open ? 'open' : 'closed';
    setGate(open ? 'open' : 'closed');
  }, []);
  // 閘門延後開始（顧問 §3.377）：外部清單讀取結束（成功、失敗、8 秒逾時都算，即 state 離開 loading）之後，
  // 才掛站內區塊、才 import 它的程式檔、才讀 cpConfig/launch；2 秒逾時從那時起算。網址帶 ?src=in 也一樣先等。
  // 有本機快取時也一樣等伺服器結果（顧問 §3.381：快取畫出時伺服器讀取與 8 秒逾時仍在進行，
  // 此時啟動閘門又會搶資源；取代「有快取就在下一個 idle 開始」）。
  // 在那之前開關開或關走同一條路徑。（11-20 staging 冷開實測：閘門同時載入 chunk＋第二條連線，
  // 把外部清單既有的 8 秒逾時推過界；取代「進頁立刻開始」。）
  // 有線索（preferIn）時一進頁就開始，2 秒逾時也從進頁起算；逾時就這一次退回外部。
  const [gateArmed, setGateArmed] = useState(preferIn);
  useEffect(() => {
    if (!COMPETITIONS_ENABLED || gateArmed) return;
    if (state !== 'loading') setGateArmed(true);
  }, [gateArmed, state]);
  useEffect(() => {
    if (!COMPETITIONS_ENABLED || !gateArmed) return undefined;
    const timer = setTimeout(() => {
      if (gateRef.current !== 'pending') return;
      gateRef.current = 'closed';
      setGate('closed');
    }, COMPETITIONS_GATE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [gateArmed]);
  const source: CompetitionSource = rawSrc === 'in' || rawSrc === 'ext' ? rawSrc : fallbackSource;
  const showInApp = inAppOpen && source === 'in';
  // 有線索、停在站內、閘門判定中或已通過但站內清單還沒讀好：先畫切換列與站內的載入骨架，不畫外部清單，
  // 避免先閃外部再切站內；骨架留到站內卡出現，中間不空白（11-20 實測骨架消失到卡片出現之間有一段空白）。
  const [inAppReady, setInAppReady] = useState(false);
  const onInAppReady = useCallback(() => setInAppReady(true), []);
  const pendingIn = preferIn && source === 'in' && (gate === 'pending' || (gate === 'open' && !inAppReady));
  // 閘門通過後站內清單 8 秒還沒好：骨架不無限留，這一次改看外部（切換列還在，可再點站內）；使用者自己選過就不動
  // （11-20 Opus 審 P2-2）。線索不清。
  useEffect(() => {
    if (!preferIn || gate !== 'open' || inAppReady) return undefined;
    const timer = setTimeout(() => {
      if (new URLSearchParams(window.location.search).has('src')) return;
      setFallbackSource('ext');
    }, TOURNAMENTS_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [preferIn, gate, inAppReady]);
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
    setFallbackSource(next);
    if (typeof go === 'function') go(path, true);
  };

  const onSourceKey = (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next: CompetitionSource = source === 'in' ? 'ext' : 'in';
    chooseSource(next);
    const nextId = next === 'in' ? 'tournaments-source-in' : 'tournaments-source-ext';
    queueMicrotask(() => document.getElementById(nextId)?.focus());
  };

  return (
    <div class="legacy-ui tournaments-root" data-v2={inAppOpen ? '1' : undefined} data-cp-gate={COMPETITIONS_ENABLED ? gate : undefined}>
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

        {inAppOpen || pendingIn ? (
          <div class="cpl-src" role="tablist" aria-label={t('tournaments.sourceLabel')}>
            <button
              id="tournaments-source-in"
              type="button"
              role="tab"
              aria-selected={source === 'in'}
              aria-controls="tournaments-source-panel"
              class={source === 'in' ? 'on' : ''}
              onClick={() => chooseSource('in')}
              onKeyDown={onSourceKey}
            >
              {t('tournaments.sourceIn')}
            </button>
            <button
              id="tournaments-source-ext"
              type="button"
              role="tab"
              aria-selected={source === 'ext'}
              aria-controls="tournaments-source-panel"
              class={source === 'ext' ? 'on' : ''}
              onClick={() => chooseSource('ext')}
              onKeyDown={onSourceKey}
            >
              {t('tournaments.sourceOut')}
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
        </div>
        <div class="tc-panel" role="tabpanel" id={inAppOpen || pendingIn ? 'tournaments-source-panel' : undefined}>
          {gateArmed ? <InAppCompetitionsSlot tab={tab} active={showInApp} onGate={onGate} onReady={onInAppReady} /> : null}
          {pendingIn ? (
            <div aria-busy="true" data-cp-pending-in="1">
              <div class="reg-loading" role="status" style="white-space:nowrap">{t('tournaments.loading')}</div>
              <div class="reg-loading-skeleton" aria-hidden="true">
                <div class="reg-loading-skeleton-row" />
                <div class="reg-loading-skeleton-row" />
                <div class="reg-loading-skeleton-row" />
              </div>
            </div>
          ) : null}
          {showInApp || pendingIn ? null : (
          <>
          {/* 「＋ 新增賽事」搬進外部清單框內，位置與樣式比照站內「建立賽事」（.cpl-create），切換分頁不跳動
              （站長 11-20：取代原本放在分類分頁列、與「建立賽事」同時出現兩顆新增鈕）。 */}
          {canManage ? (
            <div class="cpl-create">
              <Button variant="primary" size="sm" id="tc-add-btn" onClick={() => openEditor(null)}>{t('tournaments.add')}</Button>
            </div>
          ) : null}
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
