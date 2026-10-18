import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/i18n';
import { Icon } from '@/ui/Icon';
import { ListRow } from './ListRow';
import {
  expectBlockedLink,
  expectNativeKeyboard,
  installUiTestLocale,
} from './ui1-test-utils';

installUiTestLocale();

describe('ListRow', () => {
  it('renders valid list structure with translated content and slots', () => {
    render(
      <ul>
        <ListRow
          title={t('fixture.heading')}
          subtitle={t('fixture.subtitle')}
          leading={<Icon name="calendar" />}
          trailing={<Icon name="user" />}
        />
      </ul>,
    );
    const row = screen.getByRole('listitem');
    expect(row.parentElement?.tagName).toBe('UL');
    expect(row.querySelector('.ui-list-row__leading svg')).not.toBeNull();
    expect(row.querySelector('.ui-list-row__trailing svg')).not.toBeNull();
    expect(row.querySelector('.ui-list-row__title')?.getAttribute('title')).toBe(t('fixture.heading'));
    expect(row.querySelector('.ui-list-row__title .ui-text')?.textContent).toBe(t('fixture.heading'));
    expect(row.querySelector('.ui-list-row__subtitle')?.textContent).toBe(t('fixture.subtitle'));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders selected button semantics and native keyboard behavior', () => {
    const onClick = vi.fn();
    render(
      <ul>
        <ListRow title={t('fixture.heading')} selected onClick={onClick} />
      </ul>,
    );
    const button = screen.getByRole('button', { name: t('fixture.heading') });
    expect(screen.getByRole('listitem').classList.contains('ui-list-row--selected')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expectNativeKeyboard(button, ['Enter', ' ']);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not invent toggle semantics for an ordinary action', () => {
    render(<ul><ListRow title={t('fixture.heading')} onClick={() => undefined} /></ul>);
    expect(screen.getByRole('button').hasAttribute('aria-pressed')).toBe(false);
  });

  it('blocks disabled button actions', () => {
    const onClick = vi.fn();
    render(<ul><ListRow title={t('fixture.heading')} disabled onClick={onClick} /></ul>);
    const button = screen.getByRole('button');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('listitem').classList.contains('ui-list-row--disabled')).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps list semantics around a navigation link', () => {
    render(
      <ul>
        <ListRow title={t('fixture.heading')} href="/activities" selected aria-current="page" />
      </ul>,
    );
    const link = screen.getByRole('link', { name: t('fixture.heading') });
    expect(link.parentElement).toBe(screen.getByRole('listitem'));
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(link.hasAttribute('aria-pressed')).toBe(false);
    expectNativeKeyboard(link, ['Enter']);
  });

  it('blocks disabled anchor navigation', () => {
    const onClick = vi.fn();
    render(
      <ul>
        <ListRow title={t('fixture.heading')} href="/activities" disabled onClick={onClick} />
      </ul>,
    );
    expectBlockedLink(screen.getByRole('link'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('allows independent trailing controls in a static row', () => {
    render(
      <ul>
        <ListRow
          title={t('fixture.heading')}
          trailing={<button type="button" aria-label={t('fixture.icon')}><Icon name="calendar" /></button>}
        />
      </ul>,
    );
    const button = screen.getByRole('button', { name: t('fixture.icon') });
    expect(button.closest('.ui-list-row__body')?.tagName).toBe('DIV');
    expect(button.parentElement?.closest('button')).toBeNull();
  });
});
