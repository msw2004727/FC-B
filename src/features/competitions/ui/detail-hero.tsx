// 詳情頂部（新外觀卡 1b-3）：招募、預熱是不亮燈的記分板，進行中亮燈；已結束、延期、取消是同排法的玻璃卡。
// 要畫什麼由 data/schedule-present.ts 的 detailHero 算好，這裡只照結果畫。
// .d2-hero／.d2-hero--bare／.d2-foot 寫成不綁詳情頁的 class，別頁的玻璃頂部直接套。

import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { CompetitionsT } from '../i18n';
import { formatTaipeiShort } from '../format';
import type { DetailHero as HeroModel, HeroCell } from '../data/schedule-present';
import { scheduleDayLabel } from '../data/schedule-present';
import { scheduleLabels } from './schedule-board';

/** 「冠軍」多組時最多列三行，超過用「等 N 組」收尾。 */
export const HERO_CHAMPION_ROWS = 3;

function Cell({ ct, cell, now, lit }: { ct: CompetitionsT; cell: HeroCell; now: number; lit: boolean }): JSX.Element {
  if (cell.kind === 'next' || cell.kind === 'first') {
    const labels = scheduleLabels(ct);
    const keys = [
      cell.kind === 'next' ? ct('boardNext') : ct('firstMatch'),
      cell.kind === 'first' ? scheduleDayLabel(cell.at, now, labels.today, labels.weekdays) : null,
      cell.venue,
    ].filter((text): text is string => !!text);
    return (
      <div class={`d2-cell${lit && cell.kind === 'next' ? ' d2-cell--now' : ''}`}>
        <span class="d2-cell__k">{keys.map((text) => <span key={text}>{text}</span>)}</span>
        <span class="d2-cell__v">
          <b class="d2-num">{cell.time}</b>
          {cell.home && cell.away ? (
            <span class="d2-cell__t"><span>{cell.home}</span><i>vs</i><span>{cell.away}</span></span>
          ) : null}
        </span>
      </div>
    );
  }
  let key: string;
  let value: string;
  let unit = '';
  if (cell.kind === 'today') {
    [key, value, unit] = [ct('boardToday'), String(cell.n), ct('matchUnit')];
  } else if (cell.kind === 'countdown') {
    [key, value, unit] = [ct('boardToStart'), String(cell.n), ct('boardDayUnit')];
  } else if (cell.kind === 'deadline') {
    [key, value] = [ct('boardDeadline'), formatTaipeiShort(cell.at)];
  } else {
    [key, value, unit] = [ct('approved'), String(cell.teams), ct('heroMaxTeams', { max: cell.max })];
  }
  return (
    <div class="d2-cell">
      <span class="d2-cell__k">{key}</span>
      <span class="d2-cell__v"><b class="d2-num">{value}</b>{unit ? <small>{unit}</small> : null}</span>
    </div>
  );
}

function Champions({ ct, hero }: { ct: CompetitionsT; hero: HeroModel }): JSX.Element | null {
  const rows = hero.champions;
  if (rows.length === 0) return null;
  const nameOf = (name: string | null): string => name ?? ct('championPending');
  const only = rows.length === 1 && !rows[0]?.group ? rows[0] : undefined;
  if (only) {
    return <p class="d2-plain__champ"><b>{ct('champion')}</b><span>{nameOf(only.name)}</span></p>;
  }
  const shown = rows.slice(0, HERO_CHAMPION_ROWS);
  return (
    <>
      <p class="d2-plain__champk">{ct('champion')}</p>
      <dl class="d2-plain__champs">
        {shown.map((row, index) => [
          <dt key={`${row.id}-k`}>{row.group?.name ?? ct('divisionFallback', { n: row.group?.n ?? index + 1 })}</dt>,
          <dd key={`${row.id}-v`}>{nameOf(row.name)}</dd>,
        ])}
      </dl>
      {rows.length > HERO_CHAMPION_ROWS ? <p class="d2-plain__more">{ct('heroMoreGroups', { n: rows.length })}</p> : null}
    </>
  );
}

export function DetailHero({
  ct,
  hero,
  status,
  danger,
  category,
  name,
  date,
  venue,
  now,
  foot,
  cover,
}: {
  ct: CompetitionsT;
  hero: HeroModel;
  /** 狀態字（現在 statusBadge／phaseBadge 的 label）。 */
  status: string;
  /** 已取消：狀態字紅字（只會是玻璃卡，紅色不上板）。 */
  danger: boolean;
  category: string;
  name: string;
  /** 空字串就不出現那一段。 */
  date: string;
  venue: string;
  now: number;
  /** 主辦列；沒有就加 d2-hero--bare。 */
  foot?: ComponentChildren;
  /** 封面圖網址（站長定案：記分板上面，玻璃框內）；沒有就不畫，版面與現況相同。下架的判斷在呼叫端（data/cover.ts#shownCover）。 */
  cover?: string;
}): JSX.Element {
  const notes = !hero.board && (hero.reason || hero.champions.length > 0);
  // 封面載不到（被刪、網路斷、token 失效）：整塊收起，版面回到沒封面的樣子，不留空白框。記網址，換新網址再試。
  // 圖本身沒有淡入動畫或 onload 才加的 class，載好就看得到（背景分頁、動畫被節流也一樣）。
  const [broken, setBroken] = useState<string | null>(null);
  const shown = cover && cover !== broken ? cover : null;
  return (
    <section class={`d2-hero${foot ? '' : ' d2-hero--bare'}`}>
      {shown ? <img class="d2-hero__cover" src={shown} alt="" width={1200} height={450} decoding="async" onError={() => setBroken(shown)} /> : null}
      <div class={hero.board ? `d2-sb d2-board${hero.lit ? ' d2-sb--lit' : ''}` : 'd2-plain'}>
        <div class="d2-board__top">
          <span class={`d2-sb__st${danger ? ' d2-sb__st--danger' : ''}`}><i aria-hidden="true" />{status}</span>
          <span class="d2-board__cat">{category}</span>
        </div>
        <h1 class="d2-board__name">{name}</h1>
        {date || venue ? (
          <p class="d2-board__meta">
            {date ? <span>{date}</span> : null}
            {venue ? <span>{venue}</span> : null}
          </p>
        ) : null}
        {hero.board ? (
          <div class="d2-cells">
            {hero.cells.map((cell) => <Cell key={cell.kind} ct={ct} cell={cell} now={now} lit={hero.lit} />)}
          </div>
        ) : null}
        {notes ? (
          <div class="d2-plain__notes">
            {hero.reason ? <p class="cpm-reason"><b>{ct('reasonPrefix')}</b>　{hero.reason}</p> : null}
            <Champions ct={ct} hero={hero} />
          </div>
        ) : null}
      </div>
      {foot ? <div class="d2-foot">{foot}</div> : null}
    </section>
  );
}
