import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { _setDictLoaderForTest, setLocale, t } from '@/i18n/i18n';
import { EventCard } from './EventCard';
import type { EventDoc } from '../data/types';

beforeEach(async () => {
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  _setDictLoaderForTest(null);
});

describe('EventCard', () => {
  it('uses the public id, shows details, and supplies image dimensions', () => {
    const event = {
      id: 'public-1',
      _docId: 'firestore-1',
      title: '週末足球',
      date: '2030/10/19 18:30~21:00',
      location: '青埔球場',
      status: 'open',
      image: '/fixture.webp',
      sportTag: 'football',
      current: 3,
      max: 12,
    } satisfies EventDoc & { sportTag: string; current: number; max: number };

    const { container } = render(<EventCard event={event} />);
    expect(screen.getByRole('link', { name: event.title }).getAttribute('href'))
      .toBe('/events/public-1');
    expect(screen.getByText('青埔球場')).toBeTruthy();
    expect(screen.getByText('3/12人')).toBeTruthy();
    expect(screen.getByText(t('events.sport.football'))).toBeTruthy();
    expect(screen.getByText(t('events.status.open'))).toBeTruthy();
    expect(screen.queryByText(t('events.card.dateUnknown'))).toBeNull();

    const image = container.querySelector('img');
    expect(image?.getAttribute('width')).toBe('48');
    expect(image?.getAttribute('height')).toBe('48');
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('decoding')).toBe('async');
    expect(image?.getAttribute('alt')).toBe('');
  });

  it('does not substitute a Firestore document id for a missing public id', () => {
    render(<EventCard event={{ _docId: 'private-doc', title: '缺少公開 ID' }} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('缺少公開 ID')).toBeTruthy();
    expect(screen.getByText('—/—人')).toBeTruthy();
    expect(screen.getByText(t('events.card.dateUnknown'))).toBeTruthy();
  });

  it('encodes public IDs as one route segment', () => {
    render(<EventCard event={{ id: 'public/a ?#', title: 'Encoded' }} />);
    expect(screen.getByRole('link').getAttribute('href'))
      .toBe('/events/public%2Fa%20%3F%23');
  });

  it('replaces a failed image without hiding the event', () => {
    const { container, rerender } = render(
      <EventCard event={{ id: 'a', title: 'Activity', image: '/bad.webp' }} />,
    );
    const image = container.querySelector('img');
    if (!image) throw new Error('Missing fixture image');
    fireEvent.error(image);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'Activity' })).toBeTruthy();

    rerender(<EventCard event={{ id: 'a', title: 'Activity', image: '/good.webp' }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/good.webp');
  });
});
