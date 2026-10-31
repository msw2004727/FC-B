import type { ComponentChildren } from 'preact';
import { useT } from '@/i18n/i18n';

interface SearchProps<T> {
  kind: 'event' | 'user';
  query: string;
  onQuery: (query: string) => void;
  results: T[];
  onSelect: (value: T) => void;
  label: (value: T) => string;
  meta: (value: T) => string;
  selected: ComponentChildren;
  disabled: boolean;
  status?: 'idle' | 'loading' | 'ready' | 'error';
  partial?: boolean;
}

export function BlocklistSearch<T>(props: SearchProps<T>) {
  const t = useT();
  const key = (suffix: string) => t('data-repair.blocklist.' + suffix);
  const isEvent = props.kind === 'event';
  const open = !!props.query.trim();
  return <div class="form-card eb-search-card">
    <label class="eb-step" for={'eb-' + props.kind + '-search'}>{key(isEvent ? 'stepEvent' : 'stepUser')}</label>
    <input id={'eb-' + props.kind + '-search'} type="text" autoComplete="off"
      placeholder={key(isEvent ? 'eventPlaceholder' : 'userPlaceholder')}
      value={props.query} disabled={props.disabled}
      onInput={event => props.onQuery(event.currentTarget.value)} />
    <div class={'ce-delegate-dropdown' + (open ? ' open' : '')}>
      {open && (props.status === 'loading' ? <div class="eb-result-note" role="status">{key('loading')}</div>
        : props.status === 'error' ? <div class="eb-result-note" role="alert">{key('usersLoadFailed')}</div>
        : props.results.length === 0 ? <div class="eb-result-note">{key(isEvent ? 'noEventMatch' : 'noUserMatch')}</div>
        : props.results.map((value, index) => <button type="button" class="ce-delegate-item" key={index}
          disabled={props.disabled} onClick={() => props.onSelect(value)}>
          <span class="ce-delegate-item-name">{props.label(value)}</span>
          <span class="ce-delegate-item-meta">{props.meta(value)}</span>
        </button>))}
    </div>
    <div class="eb-selected">{props.selected || key(isEvent ? 'noEventSelected' : 'noUserSelected')}</div>
    {props.partial && <div class="eb-note" role="status">{key('usersPartial')}</div>}
  </div>;
}
