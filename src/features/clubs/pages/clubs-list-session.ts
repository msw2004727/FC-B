/**
 * M-114：俱樂部列表篩選的本頁記憶。
 * 只活在記憶體，讓 /teams 與 /teams/:id 換頁後還原搜尋字、地區、類型頁籤與篩選面板。
 * 不寫 localStorage／sessionStorage，不寫 history。運動篩選由 core/sport-filter 全站處理，不在這裡。
 */

export interface ClubListFilters {
  query: string;
  region: string;
  typeTab: string;
  filtersOpen: boolean;
}

const DEFAULT_CLUB_LIST_FILTERS: ClubListFilters = {
  query: '',
  region: '',
  typeTab: '',
  filtersOpen: false,
};

let clubListFilters: ClubListFilters = { ...DEFAULT_CLUB_LIST_FILTERS };

export function getClubListFilters(): ClubListFilters {
  return { ...clubListFilters };
}

export function saveClubListFilters(partial: Partial<ClubListFilters>): void {
  const next: ClubListFilters = { ...clubListFilters };
  if (partial.query !== undefined) next.query = partial.query;
  if (partial.region !== undefined) next.region = partial.region;
  if (partial.typeTab !== undefined) next.typeTab = partial.typeTab;
  if (partial.filtersOpen !== undefined) next.filtersOpen = partial.filtersOpen;
  clubListFilters = next;
}

export function resetClubListFilters(): void {
  clubListFilters = { ...DEFAULT_CLUB_LIST_FILTERS };
}
