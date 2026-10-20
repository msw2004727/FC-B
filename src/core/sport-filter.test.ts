import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/preact';
import { on } from '@/core/events';
import {
  ACTIVE_SPORT_STORAGE_KEY,
  _resetSportFilterForTest,
  getActiveSport,
  getPickerSportLabel,
  normalizeActiveSport,
  resolveTeamSportFilterSync,
  setActiveSport,
  subscribeActiveSport,
  useActiveSport,
} from './sport-filter';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  window.history.replaceState({}, '', '/');
  _resetSportFilterForTest();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('sport-filter', () => {
  it('defaults to "all" when localStorage and URL are empty', () => {
    expect(getActiveSport()).toBe('all');
    expect(getPickerSportLabel('all')).toBe('全部運動');
  });

  it('restores initial sport from localStorage sporthub_active_sport', () => {
    localStorage.setItem(ACTIVE_SPORT_STORAGE_KEY, 'basketball');
    _resetSportFilterForTest();
    expect(getActiveSport()).toBe('basketball');
    expect(getPickerSportLabel('basketball')).toBe('籃球');
  });

  it('prioritizes URL ?sport= over localStorage on init', () => {
    localStorage.setItem(ACTIVE_SPORT_STORAGE_KEY, 'basketball');
    window.history.replaceState({}, '', '/activities?sport=pickleball');
    _resetSportFilterForTest();
    expect(getActiveSport()).toBe('pickleball');
  });

  it('persists to localStorage and notifies subscribers and event bus', () => {
    const listener = vi.fn();
    const busListener = vi.fn();
    const unsub = subscribeActiveSport(listener);
    const unsubBus = on('sport:picker-open', busListener);

    try {
      const result = setActiveSport('tennis');
      expect(result).toBe('tennis');
      expect(getActiveSport()).toBe('tennis');
      expect(localStorage.getItem(ACTIVE_SPORT_STORAGE_KEY)).toBe('tennis');
      expect(listener).toHaveBeenCalledWith('tennis');
      expect(busListener).toHaveBeenCalledOnce();
    } finally {
      unsub();
      unsubBus();
    }
  });

  it('falls back to football when setting unknown non-all sport key (legacy A behavior)', () => {
    const result = setActiveSport('unknown_sport_xyz');
    expect(result).toBe('football');
    expect(normalizeActiveSport('unknown_sport_xyz')).toBe('all');
  });

  it('tolerates localStorage throwing errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => setActiveSport('badminton')).not.toThrow();
    expect(getActiveSport()).toBe('badminton');
  });

  it('updates useActiveSport hook when setActiveSport is called', () => {
    const { result } = renderHook(() => useActiveSport());
    expect(result.current[0]).toBe('all');

    act(() => {
      setActiveSport('volleyball');
    });
    expect(result.current[0]).toBe('volleyball');
  });

  it('resolves team sport filter sync matching legacy A _resolveTeamSportFilterSync', () => {
    const forced = resolveTeamSportFilterSync('basketball', 'basketball', 'tennis', true);
    expect(forced).toEqual({
      value: 'tennis',
      syncedGlobalSport: 'tennis',
      effectiveSport: 'tennis',
    });

    const cleared = resolveTeamSportFilterSync('tennis', 'tennis', 'all', true);
    expect(cleared).toEqual({
      value: '',
      syncedGlobalSport: '',
      effectiveSport: '',
    });
  });
});
