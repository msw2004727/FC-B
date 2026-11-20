// 比賽列共用的兩小塊（新外觀卡 1b-4）：時間與場地、對戰與比分。觀眾版（schedule-board 的 MatchSchedule）
// 與主辦版（HostMatchesPage）的 <li> 各自保留，只有列內這兩段共用一份標記與樣式（.cp3-m*、.cp3-tn*）。
// 只管顯示：時間字串、比分、PK 文字都由呼叫端算好傳進來，這裡不讀狀態、不送出。

import type { JSX } from 'preact';
import type { EntryDoc } from '../data/types';
import { crestFromEntry, TeamCrest } from './TeamCrest';

/** 純時間（HH:mm）才用窄體數字；「隔日 01:30」「時間待定」「待定」「已取消」是一般字（窄體字沒有中文）。 */
const PLAIN_TIME = /^\d{1,2}:\d{2}$/;

export function SideName({
  entryId,
  name,
  crests,
  align,
  logo,
}: {
  entryId: string;
  name: string;
  crests: readonly EntryDoc[];
  align: 'home' | 'away';
  /** 摘要 h.l／a.l。有值就用這張；沒有才用報名隊徽或字首。 */
  logo?: string | null;
}): JSX.Element {
  const crest = crestFromEntry(entryId, name, crests);
  const mark = <TeamCrest teamId={crest.teamId} name={crest.name} teamLogo={logo || crest.teamLogo} size={24} />;
  if (align === 'home') {
    return <span class="cp3-tn cp3-tn--h"><em>{name}</em>{mark}</span>;
  }
  return <span class="cp3-tn">{mark}<em>{name}</em></span>;
}

/** 上排左邊：時間（純時間用窄體數字）＋場地（太長省略）。 */
export function MatchWhen({ time, venue }: { time: string; venue?: string | null }): JSX.Element {
  return (
    <span class="cp3-m__when">
      <b class={PLAIN_TIME.test(time) ? 'd2-num' : undefined}>{time}</b>
      {venue ? <span class="cp3-m__court">{venue}</span> : null}
    </span>
  );
}

export interface MatchSide {
  id: string;
  name: string;
  logo?: string | null;
}

/**
 * 下排：主隊｜比分（或 vs）｜客隊，有 PK 時比分正下方一行。
 * 比分畫成「數字 : 數字」三格（對報讀隱藏），另留一段視覺隱藏的完整比分（照原文，含全形冒號）給報讀與整句比對。
 */
export function MatchVs({
  home,
  away,
  crests,
  score,
  pk,
}: {
  home: MatchSide;
  away: MatchSide;
  crests: readonly EntryDoc[];
  /** null＝畫 vs。 */
  score: readonly [number, number] | null;
  /** 已格式化的 PK 文字；沒有 PK 是 null。 */
  pk?: string | null;
}): JSX.Element {
  return (
    <div class="cp3-m__vs">
      <span class="h"><SideName entryId={home.id} name={home.name} crests={crests} align="home" logo={home.logo} /></span>
      {score ? (
        <span class="s">
          <span class="cps-vh">{score[0]}：{score[1]}</span>
          <b class="d2-num" aria-hidden="true">{score[0]}</b>
          <i aria-hidden="true">:</i>
          <b class="d2-num" aria-hidden="true">{score[1]}</b>
        </span>
      ) : (
        <span class="s vs">vs</span>
      )}
      <span class="a"><SideName entryId={away.id} name={away.name} crests={crests} align="away" logo={away.logo} /></span>
      {pk ? <span class="cp3-m__pk">{pk}</span> : null}
    </div>
  );
}
