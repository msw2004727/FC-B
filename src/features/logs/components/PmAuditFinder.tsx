/**
 * 聊天室稽核：找人（暱稱或 UID）→ 選人 → 選對話。保留原三層流程給「想直接找某人」時用，
 * 結果以下拉面板顯示在搜尋列下方，不佔主畫面；選到對話直接開唯讀對話抽屜。
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import { pmFormatTime, type PmAuditThread, type PmAuditUser } from '../data/pm-audit';
import { shortUid } from '../data/pm-audit-view';

export type FinderBox<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: T[] };

export interface PmAuditFinderProps {
  users: FinderBox<PmAuditUser>;
  threads: FinderBox<PmAuditThread>;
  onSearch: (query: string) => void;
  onPickUser: (uid: string) => void;
  onPickThread: (thread: PmAuditThread) => void;
  onClear: () => void;
}

function safeAvatar(url: string): string | null {
  return /^https:\/\//i.test(url) ? url : null;
}

export function PmAuditFinder(props: PmAuditFinderProps): JSX.Element {
  const t = useT();
  const [query, setQuery] = useState('');
  const { users, threads } = props;
  const open = users.status !== 'idle';

  function submit(): void {
    const q = query.trim();
    if (!q) {
      toast.show({ message: t('logs.chat.searchRequired'), tone: 'warning' });
      return;
    }
    props.onSearch(q);
  }

  const note = (text: string): JSX.Element => <div class="pma-note">{text}</div>;

  return (
    <div class="pma-finder">
      <form
        class="pma-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <svg class="pma-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2" />
          <path d="M16 16l4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        </svg>
        <input
          id="pm-audit-user-query"
          type="search"
          placeholder={t('logs.chat.searchPlaceholder')}
          aria-label={t('logs.chat.searchPlaceholder')}
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        {open ? (
          <button
            type="button"
            class="pma-search-clear"
            aria-label={t('logs.chat.clearSearch')}
            onClick={() => {
              setQuery('');
              props.onClear();
            }}
          >
            ×
          </button>
        ) : null}
      </form>

      {open ? (
        <div class="pma-finder-panel">
          {users.status === 'loading' ? <div class="reg-loading" role="status">{t('logs.chat.searching')}</div> : null}
          {users.status === 'error' ? note(t('logs.chat.searchFailed')) : null}
          {users.status === 'ready' && users.items.length === 0 ? note(t('logs.chat.noUsers')) : null}
          {users.status === 'ready' && threads.status === 'idle'
            ? users.items.map((u) => {
              const avatar = safeAvatar(u.pictureUrl);
              return (
                <button key={u.uid} type="button" class="pma-row" onClick={() => props.onPickUser(u.uid)}>
                  {avatar ? <img class="pma-avatar" src={avatar} alt="" /> : <span class="pma-avatar" />}
                  <span class="pma-person-name" data-no-translate>{u.name || t('logs.chat.unnamed')}</span>
                  <span class="pma-uid" data-no-translate>{shortUid(u.uid)}</span>
                </button>
              );
            })
            : null}
          {threads.status === 'loading' ? <div class="reg-loading" role="status">{t('logs.chat.loading')}</div> : null}
          {threads.status === 'error' ? note(t('logs.chat.threadsFailed')) : null}
          {threads.status === 'ready' && threads.items.length === 0 ? note(t('logs.chat.threadsEmpty')) : null}
          {threads.status === 'ready'
            ? threads.items.map((thread) => (
              <button key={thread.id} type="button" class="pma-row pma-thread" onClick={() => props.onPickThread(thread)}>
                <span class="pma-person-name" data-no-translate>{thread.title}</span>
                <small class="pma-time">{pmFormatTime(thread.lastMessageAt)}</small>
                <span class="pma-thread-last">{thread.lastMessageBody}</span>
              </button>
            ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
