import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetScrollRestoreForTest,
  isDetailRouteForList,
  markListScrollForRestore,
  saveListScrollPosition,
  scheduleAutoListScrollRestore,
} from './scroll-restore';

describe('scroll-restore（U-010 列表返回保留捲動位置）', () => {
  afterEach(() => {
    _resetScrollRestoreForTest();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('只有從該列表的詳情頁退回才還原', () => {
    expect(isDetailRouteForList('/events/e1', '/activities')).toBe(true);
    expect(isDetailRouteForList('/teams/t1', '/teams')).toBe(true);
    expect(isDetailRouteForList('/profile', '/activities')).toBe(false);
    saveListScrollPosition('/activities', 640);
    expect(markListScrollForRestore('/events/e1', '/activities')).toBe(true);
    expect(markListScrollForRestore('/profile', '/activities')).toBe(false);
  });

  it('等列表載入完（沒有 aria-busy）才捲回', () => {
    vi.useFakeTimers();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    document.body.innerHTML =
      '<div id="page-activities"><div aria-busy="true">載入中</div></div>';
    saveListScrollPosition('/activities', 640);
    markListScrollForRestore('/events/e1', '/activities');
    const stop = scheduleAutoListScrollRestore('/activities');
    vi.advanceTimersByTime(1000);
    expect(scrollTo).not.toHaveBeenCalled();
    document.body.innerHTML = '<div id="page-activities"><div class="card">A</div></div>';
    vi.advanceTimersByTime(150);
    expect(scrollTo).toHaveBeenCalledWith(0, 640);
    stop();
  });

  it('等超過 5 秒就放棄，不硬捲', () => {
    vi.useFakeTimers();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    document.body.innerHTML =
      '<div id="page-teams"><div class="reg-loading">載入中</div></div>';
    saveListScrollPosition('/teams', 300);
    markListScrollForRestore('/teams/t1', '/teams');
    scheduleAutoListScrollRestore('/teams');
    vi.advanceTimersByTime(6000);
    document.body.innerHTML = '<div id="page-teams"></div>';
    vi.advanceTimersByTime(500);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
