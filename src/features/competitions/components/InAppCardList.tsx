// 站內賽事卡（新外觀清-4，第 1a 批規格 3.5、3.6、3.9）。站長 11-22（顧問 §3.565）：每一張都是記分板卡
// （一圈玻璃框包一塊深色記分板，原本只有 pickInAppBoard 挑的那一張），取代「淺色一般卡＋小縮圖」；有封面就在板後
// 套直切由右往左淡出（11-22 由斜切改直切）。重點句拆成數字格（結構化資料，不解析字串、不多讀）；進行中的當日摘要沒回來前預留那一列的高度。
// 狀態篩選：下拉選單（ui/menu-select）放在賽事頁分類分段同一列的右邊（站長 11-24，取代 11-22 的狀態頁籤獨立一列，少一列畫面較乾淨）；
// 頁面給 statusSlot 就畫進那一格（portal），沒給（預覽 harness、單元測試）就畫在篩選列最前面。
// 篩選列：「只看我的」＋最右邊「建立賽事」（第 2 步既有入口，文案沿用）。
// 保留 cpl-card、cpl-card--board、ended、data-cid、data-phase（測試在用）；不再輸出 tc-card 一族與 tc-chip。

import type { JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Button } from '@/ui/Button';
import { MenuSelect } from '../ui/menu-select';
import type { CompetitionsT } from '../i18n';
import type { InAppListCard, InAppStatusFilter, InAppStatusLine } from '../data/list-cards';
import type { CompetitionCategory } from '../data/types';
import type { CompetitionPhase } from '../data/present';

const CAT_KEY: Record<CompetitionCategory, 'catLeague' | 'catCup' | 'catFriendly'> = {
  league: 'catLeague',
  cup: 'catCup',
  friendly: 'catFriendly',
};

function statusKey(phase: CompetitionPhase): 'recruiting' | 'statusWarm' | 'statusLive' | 'statusDone' {
  if (phase === 'recruit') return 'recruiting';
  if (phase === 'warm') return 'statusWarm';
  if (phase === 'live') return 'statusLive';
  return 'statusDone';
}

/** 狀態選項（站長 11-22）：全部在最前且是預設；「未結束」不再單獨一項。 */
const STATUS_OPTIONS: readonly InAppStatusFilter[] = ['all', 'recruit', 'warm', 'live', 'done'];

const FILTER_KEY: Record<InAppStatusFilter, 'statusOpen' | 'recruiting' | 'statusWarm' | 'statusLive' | 'statusDone' | 'filterAll'> = {
  open: 'statusOpen',
  recruit: 'recruiting',
  warm: 'statusWarm',
  live: 'statusLive',
  done: 'statusDone',
  all: 'filterAll',
};

function Meta({ card }: { card: InAppListCard }): JSX.Element | null {
  if (!card.date && !card.venue) return null;
  return (
    <>
      {card.date ? <span class="cpl-meta__date">{card.date}</span> : null}
      {card.venue ? <span class="cpl-meta__venue">{card.venue}</span> : null}
    </>
  );
}

function BoardCells({ ct, line }: { ct: CompetitionsT; line: InAppStatusLine }): JSX.Element {
  const unit = (key: 'matchUnit' | 'boardDayUnit') => <small>{ct(key)}</small>;
  if (line.kind === 'live') {
    return (
      <div class="d2-cells d2-cells--row">
        <div class="d2-cell d2-cell--now">
          <span class="d2-cell__k">{ct('boardNext')}</span>
          <span class="d2-cell__v"><b class="d2-num">{line.time}</b></span>
        </div>
        <div class="d2-cell">
          <span class="d2-cell__k">{ct('boardToday')}</span>
          <span class="d2-cell__v"><b class="d2-num">{line.count}</b>{unit('matchUnit')}</span>
        </div>
      </div>
    );
  }
  const [k, v, u] = line.kind === 'today'
    ? [ct('boardToday'), String(line.count), unit('matchUnit')]
    : line.kind === 'warm'
      ? [ct('boardToStart'), String(line.days), unit('boardDayUnit')]
      : line.kind === 'opens'
        ? [ct('boardOpens'), line.date, null]
        : [ct('boardDeadline'), line.date, null];
  return (
    <div class="d2-cells d2-cells--row">
      <div class="d2-cell">
        <span class="d2-cell__k">{k}</span>
        <span class="d2-cell__v"><b class="d2-num">{v}</b>{u}</span>
      </div>
    </div>
  );
}

/** 招募中（沒有延期或取消、報名已開始）的卡才有光軌與星芒。 */
function isRecruitFx(card: InAppListCard): boolean {
  return card.phase === 'recruit' && card.statusMark === null && !card.soon;
}

/** 清單裡前幾張有圖的卡立即載入（顧問設計稿「卡片縮圖與載入策略」第 6 節）；其餘捲到才載。 */
export const EAGER_IMAGES = 3;

/** 省流量：瀏覽器回報 saveData 或連線等級 2g（含 slow-2g）。iPhone 沒有這個介面，等於只對 Android 有效。 */
export function saveDataMode(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (c.saveData === true || c.effectiveType === '2g' || c.effectiveType === 'slow-2g');
}

function InCard({ card, ct, imgRank, lean, onOpen, onDelete }: {
  card: InAppListCard;
  ct: CompetitionsT;
  /** 這張是清單裡第幾張有圖的卡（0 起算）；沒圖是 -1。 */
  imgRank: number;
  /** 省流量模式：只畫前 EAGER_IMAGES 張的圖，其餘用沒有圖的版面。 */
  lean: boolean;
  onOpen: (cid: string, event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => void;
  /** 管理員以上才有（站長 11-22）：右下角垃圾桶，按了先問第一次；進行中的卡不放。 */
  onDelete?: (cid: string, name: string) => void;
}): JSX.Element {
  const cat = ct(CAT_KEY[card.category]);
  const href = `/competitions/${card.cid}`;
  const open = (event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => onOpen(card.cid, event);
  // 封面載不到：改畫沒封面的版面（不留空格）。記網址，換新網址再試。
  const [brokenCover, setBrokenCover] = useState<string | null>(null);
  // 站長 11-21／11-22：板的右半邊放清單用圖（data/cover.ts#listImage：card，舊賽事退原圖），直切、由右往左淡進板底
  const eager = imgRank >= 0 && imgRank < EAGER_IMAGES;
  const cover = card.cover && card.cover !== brokenCover && (eager || !lean) ? card.cover : '';
  // 寬高寫實際像素（圖是絕對定位、不佔版面，載入前後不跳）；不用 srcset、不做 preload（設計稿第 6 節）。
  const img = cover ? (
    <img
      class="cpl-sb__img"
      src={cover}
      alt=""
      width={800}
      height={300}
      loading={eager ? 'eager' : 'lazy'}
      fetchpriority={imgRank === 0 ? 'high' : undefined}
      decoding="async"
      onError={() => setBrokenCover(cover)}
    />
  ) : null;
  // 整場延期或取消的卡不畫數字格（規格第 10 節第 3 題，終審照建議定案：延期還寫「距開賽 N 天」是錯的資訊）。
  const line = card.statusMark === null ? card.line : null;
  const label = card.statusMark === 'postponed'
    ? ct('compPostponed')
    : card.statusMark === 'cancelled'
      ? ct('cancelled')
      : card.soon
        ? ct('statusSoon')
        : card.phase
          ? ct(statusKey(card.phase))
          : '';
  const lit = card.phase === 'live' && card.statusMark === null;
  // data-mark：整場延期或取消（邊框色、灰罩、取消紅字吃這個）；招募中才放光軌掛點（recruit-orbit.ts 動態載入後填）。
  return (
    <div class={`cpl-card cpl-card--board${card.ended ? ' ended' : ''}`} data-cid={card.cid} data-phase={card.phase ?? 'unknown'} data-mark={card.statusMark ?? undefined} data-soon={card.soon && card.statusMark === null ? '' : undefined}>
      <a class="cpl-card__link" href={href} onClick={open}>
        {isRecruitFx(card) ? <i class="cpl-fx-slot" aria-hidden="true" /> : null}
        <div class={`d2-sb${lit ? ' d2-sb--lit' : ''}${cover ? ' cpl-sb--img' : ''}`}>
          {img}
          <div class="cpl-sb__top">
            <span class="d2-sb__st"><i />{label}</span>
            <span class="cpl-sb__cat">{cat}</span>
          </div>
          <div class="cpl-card__name">{card.name}</div>
          {card.date || card.venue ? <div class="cpl-meta"><Meta card={card} /></div> : null}
          {line ? <BoardCells ct={ct} line={line} /> : lit ? (
            // 進行中而當日摘要還沒回來（或今天沒有場次）：不畫那一列，但預留同樣高度，摘要晚到時卡片不跳（顧問 §3.565 第 2 點）。
            <div class="d2-cells d2-cells--row cpl-cells--wait" aria-hidden="true"><div class="d2-cell" /></div>
          ) : null}
        </div>
      </a>
      {/* 刪除鈕在連結外面（按鈕不能包在連結裡）；只有名稱的舊「我的賽事」沒有文件，不畫。
          進行中（phase live，含整場延期／取消但階段仍是 live）一律不放，要刪從詳情頁（站長 11-22 按鈕答覆） */}
      {onDelete && card.phase && card.phase !== 'live' ? (
        <button type="button" class="cpl-del" aria-label={`${ct('deleteComp')}：${card.name}`} onClick={() => onDelete(card.cid, card.name)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
        </button>
      ) : null}
    </div>
  );
}

export function InAppCardList({
  cards,
  ct,
  status,
  onlyMine,
  showCreate,
  onStatus,
  onOnlyMine,
  onCreate,
  onOpen,
  onDelete,
  filtered,
  statusSlot,
  onRetry,
}: {
  cards: readonly InAppListCard[];
  ct: CompetitionsT;
  status: InAppStatusFilter;
  onlyMine: boolean;
  showCreate: boolean;
  onStatus: (value: InAppStatusFilter) => void;
  onOnlyMine: (value: boolean) => void;
  onCreate: () => void;
  onOpen: (cid: string, event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => void;
  onDelete?: (cid: string, name: string) => void;
  /** 有套分類、狀態或只看我的。 */
  filtered?: boolean;
  /** 賽事頁分類分段右邊那一格；有就把狀態選單畫進去。 */
  statusSlot?: HTMLElement | null;
  /** 公開清單讀取失敗：清單是空的時不說「目前沒有賽事」，改顯示讀取失敗與重試（文案盤點 B10）。 */
  onRetry?: () => void;
}): JSX.Element {
  const onlyMineId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  // 招募中卡的光軌：有招募中卡才動態載入；卡片組成變了（含快照先畫再換成讀回的清單）先整組清掉再重掛，不殘留。
  const fxKey = cards.filter(isRecruitFx).map((card) => card.cid).join(',');
  useEffect(() => {
    if (!fxKey) return;
    let alive = true;
    let stop: (() => void) | null = null;
    void import('./recruit-orbit')
      .then((mod) => {
        if (alive && listRef.current) stop = mod.startRecruitFx(listRef.current);
      })
      .catch(() => {
        // 載不到只是沒有光軌，邊框色照常。
      });
    return () => {
      alive = false;
      stop?.();
    };
  }, [fxKey]);
  const lean = saveDataMode();
  // 「建立賽事」反光（站長 11-24）：有按鈕、不是省流量才動態載入；減少動態、分頁在背景、捲出畫面由 startCreateSheen 處理。
  const sheenRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!showCreate || lean) return undefined;
    let alive = true;
    let stop: (() => void) | null = null;
    void import('./create-sheen')
      .then((mod) => {
        if (alive && sheenRef.current) stop = mod.startCreateSheen(sheenRef.current);
      })
      .catch(() => {
        // 載不到只是沒有反光。
      });
    return () => {
      alive = false;
      stop?.();
    };
  }, [showCreate, lean]);
  let rank = 0;
  const statusMenu = (
    <MenuSelect<InAppStatusFilter>
      label={ct('statusLabel')}
      value={status}
      options={STATUS_OPTIONS.map((value) => ({ value, label: ct(FILTER_KEY[value]) }))}
      onChange={onStatus}
      buttonText={status === 'all' ? ct('statusLabel') : undefined}
      active={status !== 'all'}
    />
  );
  return (
    <div data-inapp="competitions" ref={listRef}>
      {statusSlot ? createPortal(statusMenu, statusSlot) : null}
      <div class="cpl-bar cpl-toolbar">
        {statusSlot ? null : statusMenu}
        <label class="cpl-sw" for={onlyMineId}>
          <span>{ct('onlyMine')}</span>
          <span class="toggle-switch">
            <input
              type="checkbox"
              id={onlyMineId}
              checked={onlyMine}
              onChange={(event) => onOnlyMine(event.currentTarget.checked)}
            />
            <span class="toggle-slider" />
          </span>
        </label>
        {/* 新外觀搬進篩選列最右邊（規格 3.5）。站長 11-24 選「反光每 3 秒一次」：ui/Button 的 trailing 會多包一層並吃到間距，
            這裡照 ui/menu-select 借 ui-button 三個 class 自己畫（取代顧問 §3.294 P2-3 的 <Button>，外觀相同）；
            反光掛點 <i class="cpl-sheen"> 行內先絕對定位、不佔版面，其餘樣式在 create-sheen.ts。 */}
        {showCreate ? (
          <button type="button" class="ui-button ui-button--primary ui-button--sm" onClick={onCreate}>
            <span class="ui-text ui-button__label">{ct('createAction')}</span>
            <i class="cpl-sheen" ref={sheenRef} style="position:absolute" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {cards.map((card) => (
        <InCard key={card.cid} card={card} ct={ct} imgRank={card.cover ? rank++ : -1} lean={lean} onOpen={onOpen} onDelete={onDelete} />
      ))}
      {/* 站長 11-21 預設站內後，站內 0 場時訪客第一眼不能是空白（顧問 11-21）：一行空狀態，沿用外部清單的 cpl-xmsg。 */}
      {cards.length === 0 && onRetry ? (
        <div class="cpl-xmsg" role="alert">
          <p>{ct('loadFailed')}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>{ct('retry')}</Button>
        </div>
      ) : cards.length === 0 ? <p class="cpl-xmsg">{filtered ? ct('listEmptyFiltered') : ct('listEmpty')}</p> : null}
    </div>
  );
}
