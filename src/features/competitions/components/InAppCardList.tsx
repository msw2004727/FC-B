// 站內賽事卡（新外觀清-4，第 1a 批規格 3.5、3.6、3.9）：封面與彩色分類膠囊拿掉，改成玻璃卡；
// 卡板（boardCid 那一張，由 InAppSection 的 pickInAppBoard 挑、已移到第一張）是一圈玻璃框包一塊記分板。
// 第一行「狀態｜重點句」，重點句整句照用現有的鍵；卡板把同一份結構化資料拆成數字格，不解析字串、不多讀。
// 篩選列：站內自己的選單（ui/menu-select）＋「只看我的」＋最右邊「建立賽事」（第 2 步既有入口，文案沿用）。
// 保留 cpl-card、ended、data-cid、data-phase、cpl-st cpl-st--<種類>、cpl-line（測試在用）；不再輸出 tc-card 一族與 tc-chip。

import type { JSX } from 'preact';
import { useId } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { MenuSelect } from '../ui/menu-select';
import type { CompetitionsT } from '../i18n';
import type { InAppListCard, InAppStatusFilter, InAppStatusLine } from '../data/list-cards';
import { IN_APP_STATUS_FILTERS } from '../data/list-cards';
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

function lineText(ct: CompetitionsT, line: InAppStatusLine): string {
  if (line.kind === 'deadline') return ct('lineDeadline', { date: line.date });
  if (line.kind === 'warm') return ct('lineWarm', { n: line.days });
  if (line.kind === 'live') return ct('lineToday', { n: line.count, time: line.time });
  return ct('lineTodayOnly', { n: line.count });
}

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

function InCard({ card, ct, board, onOpen }: {
  card: InAppListCard;
  ct: CompetitionsT;
  board: boolean;
  onOpen: (cid: string, event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => void;
}): JSX.Element {
  const cat = ct(CAT_KEY[card.category]);
  const href = `/competitions/${card.cid}`;
  const open = (event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => onOpen(card.cid, event);
  // 卡板只會是 pickInAppBoard 挑出來的那一張（沒有整場延期或取消、有階段、有重點句）。
  if (board && card.phase && card.line) {
    return (
      <div class="cpl-card cpl-card--board" data-cid={card.cid} data-phase={card.phase}>
        <a class="cpl-card__link" href={href} onClick={open}>
          <div class={`d2-sb${card.phase === 'live' ? ' d2-sb--lit' : ''}`}>
            <div class="cpl-sb__top">
              <span class="d2-sb__st"><i />{ct(statusKey(card.phase))}</span>
              <span class="cpl-sb__cat">{cat}</span>
            </div>
            <div class="cpl-card__name">{card.name}</div>
            {card.date || card.venue ? <div class="cpl-meta"><Meta card={card} /></div> : null}
            <BoardCells ct={ct} line={card.line} />
          </div>
        </a>
      </div>
    );
  }
  // 整場延期或取消的卡不畫重點句（規格第 10 節第 3 題，終審照建議定案：延期還寫「距開賽 N 天」是錯的資訊）。
  const line = card.line && card.statusMark === null ? lineText(ct, card.line) : '';
  const pill = card.statusMark === 'postponed'
    ? { mark: 'postponed', label: ct('compPostponed') }
    : card.statusMark === 'cancelled'
      ? { mark: 'cancelled', label: ct('cancelled') }
      : card.phase
        ? { mark: card.phase, label: ct(statusKey(card.phase)) }
        : null;
  return (
    <div class={`cpl-card${card.ended ? ' ended' : ''}`} data-cid={card.cid} data-phase={card.phase ?? 'unknown'}>
      <a class="cpl-card__link" href={href} onClick={open}>
        {pill || line ? (
          <div class="cpl-card__top">
            {pill ? <span class={`cpl-st cpl-st--${pill.mark}`}>{pill.label}</span> : null}
            {line ? <span class="cpl-line">{line}</span> : null}
          </div>
        ) : null}
        <div class="cpl-card__name">{card.name}</div>
        <div class="cpl-meta">
          <span class="cpl-meta__cat">{cat}</span>
          <Meta card={card} />
        </div>
      </a>
    </div>
  );
}

export function InAppCardList({
  cards,
  ct,
  status,
  onlyMine,
  showCreate,
  boardCid = null,
  onStatus,
  onOnlyMine,
  onCreate,
  onOpen,
}: {
  cards: readonly InAppListCard[];
  ct: CompetitionsT;
  status: InAppStatusFilter;
  onlyMine: boolean;
  showCreate: boolean;
  /** 卡板是哪一張（pickInAppBoard 的結果，已在第一張）；沒傳就是沒有板。 */
  boardCid?: string | null;
  onStatus: (value: InAppStatusFilter) => void;
  onOnlyMine: (value: boolean) => void;
  onCreate: () => void;
  onOpen: (cid: string, event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => void;
}): JSX.Element {
  const onlyMineId = useId();
  return (
    <div data-inapp="competitions">
      <div class="cpl-bar cpl-toolbar">
        <MenuSelect<InAppStatusFilter>
          label={ct('statusLabel')}
          value={status}
          options={IN_APP_STATUS_FILTERS.map((value) => ({ value, label: ct(FILTER_KEY[value]) }))}
          onChange={onStatus}
        />
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
        {/* 顧問 §3.294 P2-3：站內按鈕元件；新外觀搬進篩選列最右邊（規格 3.5） */}
        {showCreate ? <Button variant="primary" size="sm" onClick={onCreate}>{ct('createAction')}</Button> : null}
      </div>
      {cards.map((card) => (
        <InCard key={card.cid} card={card} ct={ct} board={card.cid === boardCid} onOpen={onOpen} />
      ))}
      {/* 站長 11-21 預設站內後，站內 0 場時訪客第一眼不能是空白（顧問 11-21）：一行空狀態，沿用外部清單的 cpl-xmsg。 */}
      {cards.length === 0 ? <p class="cpl-xmsg">{ct('listEmpty')}</p> : null}
    </div>
  );
}
