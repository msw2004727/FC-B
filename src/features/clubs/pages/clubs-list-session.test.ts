import { beforeEach, describe, expect, it } from 'vitest';
import {
  getClubListFilters,
  resetClubListFilters,
  saveClubListFilters,
} from './clubs-list-session';

const EMPTY = {
  query: '',
  region: '',
  typeTab: '',
  filtersOpen: false,
};

describe('clubs-list-session', () => {
  beforeEach(() => {
    resetClubListFilters();
  });

  it('starts empty and merges partial updates', () => {
    expect(getClubListFilters()).toEqual(EMPTY);
    saveClubListFilters({ query: 'alpha' });
    saveClubListFilters({ region: '台北市', filtersOpen: true });
    expect(getClubListFilters()).toEqual({
      query: 'alpha',
      region: '台北市',
      typeTab: '',
      filtersOpen: true,
    });
    saveClubListFilters({ typeTab: 'leisure', query: '' });
    expect(getClubListFilters()).toEqual({
      query: '',
      region: '台北市',
      typeTab: 'leisure',
      filtersOpen: true,
    });
  });

  it('returns a copy and resetClubListFilters restores defaults', () => {
    saveClubListFilters({ query: 'keep', filtersOpen: true });
    const snapshot = getClubListFilters();
    snapshot.query = 'mutated';
    snapshot.filtersOpen = false;
    expect(getClubListFilters().query).toBe('keep');
    expect(getClubListFilters().filtersOpen).toBe(true);

    resetClubListFilters();
    expect(getClubListFilters()).toEqual(EMPTY);
  });
});
