// 詳情頁的公告與聯絡主辦。公告要進這頁才看得到。
// 俱樂部主辦連到既有俱樂部頁。個人主辦只顯示公開聯絡文字，不開站內私訊。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Badge } from '@/ui/Badge';
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
import { CpCard } from './shell';

const NOTICE_TOGGLE_ID = 'cp-notice-toggle';
const NOTICE_COMPOSE_ID = 'cp-notice-compose';

/** 俱樂部頁既有路由。id 照路徑編碼，避免斜線被當成下一層。 */
export function clubPagePath(teamId: string): string {
  return `/teams/${encodeURIComponent(teamId)}`;
}

export function PublicBoard({
  ct,
  notices,
  contactNote,
  hostName,
  hostOps,
  busy,
  clubTeamId,
  onOpenClub,
  onPost,
  onDelete,
}: {
  ct: CompetitionsT;
  notices: readonly CompetitionNotice[];
  contactNote: string | null;
  hostName: string;
  hostOps: boolean;
  busy: boolean;
  /** 俱樂部主辦且有 hostTeamId 才有值。沒有就不顯示連到俱樂部的連結。 */
  clubTeamId: string | null;
  onOpenClub: (teamId: string) => void;
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
  const clubPath = clubTeamId ? clubPagePath(clubTeamId) : null;
  // 個人主辦沒有公開文字時，整區不顯示。俱樂部主辦一定留連結（聯絡方式在俱樂部頁）。
  const showContact = clubPath != null || contactNote != null;

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
          <h2 class="cpm-h">{ct('announce')}</h2>
          {visible.length > 0 ? (
            <ul class="cpm-ann">
              {visible.map((notice) => (
                <li key={notice.id}>
                  <div class="cpm-ann__row">
                    {notice.kind === 'system' && !hostOps ? <Badge tone="neutral" label={ct('system')} size="sm" /> : null}
                    <span class="cpm-ann__txt">{notice.text}</span>
                  </div>
                  {hostOps ? (
                    // 顧問 §R2：主辦視角公告文字佔滿整列（「系統」標籤與刪除鈕都移到日期那一行：日期靠左、刪除靠右），
                    // 不再替刪除留一欄把字擠成三行。非主辦維持原樣。
                    <div class="cpm-ann__meta">
                      <span class="cpm-ann__when">
                        {notice.kind === 'system' ? <Badge tone="neutral" label={ct('system')} size="sm" /> : null}
                        <span class="cpm-ann__time">{noticeWhen(notice.at)}</span>
                      </span>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void onDelete(notice.id); }}>
                        {ct('noticeDelete')}
                      </Button>
                    </div>
                  ) : (
                    <span class="cpm-ann__time">{noticeWhen(notice.at)}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {more ? (
            <button type="button" class="cp3-textlink" onClick={() => setShowAll(true)}>{ct('more')}</button>
          ) : null}
          {hostOps && !composing ? (
            <div class="cps-actions">
              <Button
                id={NOTICE_TOGGLE_ID}
                variant="secondary"
                aria-expanded={false}
                aria-controls={NOTICE_COMPOSE_ID}
                onClick={() => setCompose(true)}
              >
                {ct('publishNotice')}
              </Button>
            </div>
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
      {showContact ? (
        <CpCard>
          <h2 class="cpm-h">{ct('contactHost')}</h2>
          {clubPath && clubTeamId ? (
            <div class="cpm-contact">
              {hostName ? <span class="cpm-host">{hostName}</span> : null}
              <a
                class="cpm-pm"
                href={clubPath}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation(); // 不讓 preact-iso LocationProvider 的全域連結攔截再推一筆歷史（11-20 預演：返回要按兩次）。
                  onOpenClub(clubTeamId);
                }}
              >
                {ct('contactHost')}
              </a>
            </div>
          ) : null}
          {contactNote ? <p class="cpm-public">{contactNote}</p> : null}
        </CpCard>
      ) : null}
    </>
  );
}
