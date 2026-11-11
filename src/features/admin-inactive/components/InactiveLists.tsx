import type { JSX } from 'preact';

import { lt, useT } from '@/i18n/i18n';

import {
  fetchInactiveEventsPage,
  fetchInactiveTeamsPage,
  loadInactiveEvents,
  loadInactiveTeams,
} from '../data/inactive-data';
import { usePagedList } from './use-paged-list';

// 文字與行內樣式照 A `user-admin-roles.js#_renderInactiveTeams`／`#_renderInactiveEvents`。
const EMPTY_STYLE = 'text-align:center;padding:2rem;color:var(--text-muted)';
const META_STYLE = 'font-size:.78rem;color:var(--text-muted)';

export function CenterNote(props: { text: string; role?: 'status' | 'alert' }): JSX.Element {
  return <div role={props.role} style={EMPTY_STYLE}>{props.text}</div>;
}

export function LoadState(props: { status: 'loading' | 'error'; onRetry: () => void }): JSX.Element {
  const t = useT();
  if (props.status === 'loading') {
    return (
      <>
        <div class="reg-loading" role="status" aria-busy="true">{lt('common.loading', '載入中...')}</div>
        <div class="reg-loading-skeleton" aria-hidden="true">
          <div class="reg-loading-skeleton-row" />
          <div class="reg-loading-skeleton-row" />
          <div class="reg-loading-skeleton-row" />
        </div>
      </>
    );
  }
  return (
    <div role="alert" style={EMPTY_STYLE}>
      <div>{t('admin-inactive.loadError')}</div>
      <button type="button" class="outline-btn" style="margin-top:.65rem" onClick={props.onRetry}>
        {t('admin-inactive.retry')}
      </button>
    </div>
  );
}

export function LoadMoreButton(props: { busy: boolean; onClick: () => void }): JSX.Element {
  const t = useT();
  return (
    <div style="text-align:center;padding:.5rem 0">
      <button
        type="button"
        class="outline-btn"
        style="font-size:.78rem;padding:.3rem .8rem"
        disabled={props.busy}
        onClick={props.onClick}
      >
        {t('admin-inactive.loadMore')}
      </button>
    </div>
  );
}

export function InactiveTeamsPanel(): JSX.Element {
  const list = usePagedList(loadInactiveTeams, fetchInactiveTeamsPage);
  if (list.status !== 'ready') return <LoadState status={list.status} onRetry={list.retry} />;
  if (list.items.length === 0) return <CenterNote text="目前沒有已解散俱樂部" />;
  return (
    <>
      {list.items.map((team) => (
        <div class="inactive-card" key={team.id} data-team-id={team.id}>
          <div style="font-weight:700">{team.name}</div>
          <div style={`${META_STYLE};margin-top:.3rem`}>
            原領隊：{team.captain || '—'} ・ 原成員：{team.members} 人
          </div>
          <div style={META_STYLE}>{team.region || '—'}</div>
        </div>
      ))}
      {list.hasMore ? <LoadMoreButton busy={list.loadingMore} onClick={list.loadMore} /> : null}
    </>
  );
}

export function InactiveEventsPanel(): JSX.Element {
  const list = usePagedList(loadInactiveEvents, fetchInactiveEventsPage);
  if (list.status !== 'ready') return <LoadState status={list.status} onRetry={list.retry} />;
  if (list.items.length === 0) return <CenterNote text="沒有已結束的活動" />;
  return (
    <>
      {list.items.map((event) => (
        <div class="inactive-card" key={event.id} data-event-id={event.id}>
          <div style="font-weight:700">
            {event.title}{' '}
            <span style="font-weight:400;font-size:.78rem;color:var(--text-muted)">
              {event.status === 'ended' ? '已結束' : '已取消'}
            </span>
          </div>
          <div style={`${META_STYLE};margin-top:.3rem`}>{event.date} ・ {event.location}</div>
          <div style={META_STYLE}>
            建立者：{event.creator} ・ 參加：{event.current}/{event.max}
          </div>
        </div>
      ))}
      {list.hasMore ? <LoadMoreButton busy={list.loadingMore} onClick={list.loadMore} /> : null}
    </>
  );
}
