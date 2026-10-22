import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { getToasts, toast } from '@/ui/Toast';
import type { LegacyEventDoc } from './TimelineEventCard';
import { ExternalTransitCard, extractYouTubeVideoId } from './ExternalTransitCard';

afterEach(() => {
  cleanup();
  toast.clear();
  _resetOverlayBackForTest();
});

const baseEvent = {
  id: 'ext-1',
  title: 'External Event',
  type: 'external',
  externalUrl: 'https://example.com/event',
  date: '2030/10/19 18:00',
  location: '台北市大安區',
  status: 'open',
} as unknown as LegacyEventDoc;

describe('extractYouTubeVideoId', () => {
  it('extracts ID from watch/embed/shorts/youtu.be', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube or empty URLs', () => {
    expect(extractYouTubeVideoId('https://example.com')).toBeNull();
    expect(extractYouTubeVideoId('')).toBeNull();
    expect(extractYouTubeVideoId(null)).toBeNull();
  });
});

describe('ExternalTransitCard', () => {
  it('renders A DOM: overlay, card, close, title, meta, external link with rel', () => {
    const onClose = vi.fn();
    const { container } = render(<ExternalTransitCard event={baseEvent} onClose={onClose} />);

    expect(container.querySelector('#ext-transit-overlay.ext-transit-overlay')).toBeTruthy();
    expect(container.querySelector('.ext-transit-card')).toBeTruthy();
    expect(container.querySelector('#ext-transit-close')).toBeTruthy();
    expect(container.querySelector('.ext-transit-title')?.textContent).toContain('External Event');
    expect(container.querySelector('.ext-transit-info')).toBeTruthy();
    expect(container.querySelectorAll('.ext-transit-meta').length).toBe(2);

    const link = container.querySelector('a.ext-transit-btn-primary');
    expect(link?.getAttribute('href')).toBe('https://example.com/event');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders YouTube embed + secondary button when URL is a YouTube video', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ExternalTransitCard
        event={{ ...baseEvent, externalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } as unknown as LegacyEventDoc}
        onClose={onClose}
      />,
    );
    const iframe = container.querySelector('.ext-transit-yt-wrap iframe');
    expect(iframe?.getAttribute('src')).toContain('youtube.com/embed/dQw4w9WgXcQ');
    expect(container.querySelector('a.ext-transit-btn-secondary')).toBeTruthy();
  });

  it('hides external link and shows disabled span when URL is not http/https', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ExternalTransitCard
        event={{ ...baseEvent, externalUrl: 'javascript:alert(1)' } as unknown as LegacyEventDoc}
        onClose={onClose}
      />,
    );
    expect(container.querySelector('a.ext-transit-btn-primary')).toBeNull();
    expect(container.querySelector('span.ext-transit-btn-primary')).toBeTruthy();
  });

  it('shows UNAVAILABLE toast when share button is clicked', () => {
    const onClose = vi.fn();
    render(<ExternalTransitCard event={baseEvent} onClose={onClose} />);
    const share = document.querySelector('#ext-transit-share') as HTMLElement;
    fireEvent.click(share);
    expect(getToasts().at(-1)?.message).toBe('此功能尚未開放，請先使用舊版');
  });

  it('clicking overlay background closes card via onClose', async () => {
    const onClose = vi.fn();
    const { container } = render(<ExternalTransitCard event={baseEvent} onClose={onClose} />);
    const overlay = container.querySelector('#ext-transit-overlay') as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 1500 });
  });

  it('clicking ✕ closes card via onClose', async () => {
    const onClose = vi.fn();
    const { container } = render(<ExternalTransitCard event={baseEvent} onClose={onClose} />);
    fireEvent.click(container.querySelector('#ext-transit-close') as HTMLElement);
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 1500 });
  });
});
