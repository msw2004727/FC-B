import { createElement } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';

vi.mock('@/features/sport-prefs/SportPrefsGate', () => ({
  SportPrefsGate: (props: { uid: string; home?: boolean }) =>
    createElement('div', { 'data-testid': 'gate' }, `${props.uid}${props.home ? ':home' : ''}`),
}));

import { SportPrefsLoader } from './SportPrefsLoader';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SportPrefsLoader', () => {
  it('due=false 或 uid=null 不 import、不渲染 Gate', async () => {
    render(<SportPrefsLoader uid={null} due />);
    await vi.advanceTimersByTimeAsync(1300);
    expect(screen.queryByTestId('gate')).toBeNull();
    cleanup();
    render(<SportPrefsLoader uid="u1" due={false} />);
    await vi.advanceTimersByTimeAsync(1300);
    expect(screen.queryByTestId('gate')).toBeNull();
  });

  it('due=true 1200ms 後渲染 Gate', async () => {
    render(<SportPrefsLoader uid="u1" due />);
    expect(screen.queryByTestId('gate')).toBeNull();
    await vi.advanceTimersByTimeAsync(1200);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByTestId('gate').textContent).toBe('u1:home');
  });
});
