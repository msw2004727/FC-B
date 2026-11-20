// 詳情頁的公告卡與頂部主辦列。公告要進這頁才看得到。
// 俱樂部主辦連到既有俱樂部頁。個人主辦只顯示公開聯絡文字，不開站內私訊。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { Textarea } from '@/ui/Textarea';
import { clipCodePoints } from '../format';
import {
  HOST_NOTICE_MAX,
  NOTICE_PREVIEW_COUNT,
  hostNoticeCount,
  noticeWhen,
  noticesNewestFirst,
} from '../data/flex-schedule';
import type { CompetitionNotice } from '../data/types';
import type { CompetitionsT } from '../i18n';
import { CpCard, TrashIcon } from './shell';
import { StatusTag } from './status-tag';

const NOTICE_TOGGLE_ID = 'cp-notice-toggle';
const NOTICE_COMPOSE_ID = 'cp-notice-compose';

/** 俱樂部頁既有路由。id 照路徑編碼，避免斜線被當成下一層。 */
export function clubPagePath(teamId: string): string {
  return `/teams/${encodeURIComponent(teamId)}`;
}

export function PublicBoard({
  ct,
  notices,
  hostOps,
  busy,
  onPost,
  onDelete,
}: {
  ct: CompetitionsT;
  notices: readonly CompetitionNotice[];
  hostOps: boolean;
  busy: boolean;
  onPost: (text: string) => Promise<boolean>;
  onDelete: (noticeId: string) => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  // 站長「畫面要簡潔」：主辦的公告輸入框預設收成一顆按鈕，點了才展開；發布成功或取消後收回。
  const [composing, setComposing] = useState(false);
  const focusAfter = useRef<'field' | 'toggle' | null>(null);
  const [showAll, setShowAll] = useState(false);
  const ordered = noticesNewestFirst(notices);
  const visible = showAll ? ordered : ordered.slice(0, NOTICE_PREVIEW_COUNT);
  const more = ordered.length > NOTICE_PREVIEW_COUNT && !showAll;
  const posted = hostNoticeCount(notices);
  const showNotices = ordered.length > 0 || hostOps;

  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === 'field') document.querySelector<HTMLElement>(`#${NOTICE_COMPOSE_ID} textarea`)?.focus();
    if (target === 'toggle') document.getElementById(NOTICE_TOGGLE_ID)?.focus();
  }, [composing]);

  function setCompose(open: boolean): void {
    focusAfter.current = open ? 'field' : 'toggle';
    setComposing(open);
  }

  async function publish(): Promise<void> {
    const ok = await onPost(draft);
    if (ok) {
      setDraft('');
      setCompose(false);
    }
  }

  return (
    <>
      {showNotices ? (
        <CpCard>
          {/* 卡片標題列（新外觀卡 1b-5）：左標題、右邊這張卡自己的動作「發布公告」小鈕 */}
          <div class="d2-cardhead">
            <h2 class="cpm-h">{ct('announce')}</h2>
            {hostOps && !composing ? (
              <Button
                id={NOTICE_TOGGLE_ID}
                variant="secondary"
                size="sm"
                aria-expanded={false}
                aria-controls={NOTICE_COMPOSE_ID}
                onClick={() => setCompose(true)}
              >
                {ct('publishNotice')}
              </Button>
            ) : null}
          </div>
          {visible.length > 0 ? (
            <ul class="cpm-ann">
              {visible.map((notice) => (
                <li key={notice.id}>
                  <div class="cpm-ann__row">
                    <span class="cpm-ann__txt">{notice.text}</span>
                  </div>
                  {/* 兩種視角同一種排法（顧問 §3.465 同意統一）：內文佔滿整列；下一行左邊「系統」標籤＋時間，
                      主辦右邊一顆灰色垃圾桶（名稱仍是「刪除」）。 */}
                  <div class="cpm-ann__meta">
                    <span class="cpm-ann__when">
                      {notice.kind === 'system' ? <StatusTag kind="neutral" label={ct('system')} /> : null}
                      <span class="cpm-ann__time">{noticeWhen(notice.at)}</span>
                    </span>
                    {hostOps ? (
                      <button
                        type="button"
                        class="cps-iconbtn cps-iconbtn--flat"
                        aria-label={ct('noticeDelete')}
                        disabled={busy}
                        onClick={() => { void onDelete(notice.id); }}
                      >
                        <TrashIcon />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {more ? (
            <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>{ct('more')}</Button>
          ) : null}
          {hostOps && composing ? (
            <div id={NOTICE_COMPOSE_ID}>
              <Textarea
                label={ct('annLabel')}
                hint={ct('annLimit')}
                value={draft}
                maxLength={300}
                rows={3}
                disabled={busy}
                onValueChange={(value) => setDraft(clipCodePoints(value, 300))}
              />
              <div class="cpm-ann__foot">
                <span class="cpm-meta">{ct('posted', { n: posted, max: HOST_NOTICE_MAX })}</span>
                <span class="cpm-ann__btns">
                  <Button variant="ghost" disabled={busy} onClick={() => setCompose(false)}>
                    {ct('cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy || posted >= HOST_NOTICE_MAX || draft.trim() === ''}
                    onClick={() => { void publish(); }}
                  >
                    {ct('publishNotice')}
                  </Button>
                </span>
              </div>
            </div>
          ) : null}
        </CpCard>
      ) : null}
    </>
  );
}

/** 有沒有主辦列：俱樂部主辦一定有（聯絡方式在俱樂部頁）；個人主辦要有公開聯絡文字。 */
export function hostLineShown(clubTeamId: string | null, contactNote: string | null): boolean {
  return clubTeamId != null || contactNote != null;
}

/**
 * 頂部下半的主辦列（新外觀卡 1b-3）：小字「主辦」｜主辦名稱｜（招募中）主辦類型｜靠右「聯絡主辦」小鈕，公開聯絡文字接下一行。
 * 個人主辦只有聯絡文字時，小字「主辦」自己一行、下面聯絡文字。沒有任何聯絡（個人主辦、沒填）回 null，頂部只剩板。
 */
export function HostLine({
  ct,
  hostName,
  hostType,
  contactNote,
  clubTeamId,
  onOpenClub,
}: {
  ct: CompetitionsT;
  hostName: string;
  /** 只有招募中才傳（主辦類型標籤只在招募中出現）。 */
  hostType?: string;
  contactNote: string | null;
  /** 俱樂部主辦且有 hostTeamId 才有值。沒有就不顯示連到俱樂部的連結。 */
  clubTeamId: string | null;
  onOpenClub: (teamId: string) => void;
}): JSX.Element | null {
  if (!hostLineShown(clubTeamId, contactNote)) return null;
  if (!clubTeamId) {
    return (
      <>
        <span class="cpm-h">{ct('host')}</span>
        <p class="cpm-public">{contactNote}</p>
      </>
    );
  }
  const clubPath = clubPagePath(clubTeamId);
  return (
    <>
      <div class="cpm-contact">
        <span class="cpm-h">{ct('host')}</span>
        {hostName ? <span class="cpm-host">{hostName}</span> : null}
        {hostType ? <StatusTag kind="neutral" label={hostType} /> : null}
        <Button
          href={clubPath}
          variant="secondary"
          size="sm"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation(); // 不讓 preact-iso LocationProvider 的全域連結攔截再推一筆歷史（11-20 預演：返回要按兩次）。
            onOpenClub(clubTeamId);
          }}
        >
          {ct('contactHost')}
        </Button>
      </div>
      {contactNote ? <p class="cpm-public">{contactNote}</p> : null}
    </>
  );
}
