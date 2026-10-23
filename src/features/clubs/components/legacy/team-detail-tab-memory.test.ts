/**
 * M-118(a)：驗證 A switchTeamDetailV2Tab／_getTeamDetailV2ActiveTab
 * 的記憶體頁籤契約，以及 B 的 50 筆淘汰上限。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { V2TabKey } from './TeamDetailV2Header';
import {
  _resetTeamTabMemoryForTest,
  getRememberedTeamTab,
  rememberTeamTab,
} from './team-detail-tab-memory';

const ALL_TABS: readonly V2TabKey[] = [
  'overview',
  'courses',
  'events',
  'members',
  'record',
  'feed',
];

describe('俱樂部詳情頁籤記憶', () => {
  beforeEach(() => {
    _resetTeamTabMemoryForTest();
  });

  it('沒記過時回傳總覽', () => {
    expect(getRememberedTeamTab('team-a', ALL_TABS)).toBe('overview');
  });

  it('記住後可以讀取並更新頁籤', () => {
    rememberTeamTab('team-a', 'events');
    expect(getRememberedTeamTab('team-a', ALL_TABS)).toBe('events');

    rememberTeamTab('team-a', 'members');
    expect(getRememberedTeamTab('team-a', ALL_TABS)).toBe('members');
  });

  it('記憶頁籤不在允許清單時回傳總覽且不刪除記憶', () => {
    rememberTeamTab('team-a', 'courses');

    expect(getRememberedTeamTab('team-a', ['overview', 'events'])).toBe('overview');
    expect(getRememberedTeamTab('team-a', [])).toBe('overview');
    expect(getRememberedTeamTab('team-a', ALL_TABS)).toBe('courses');
  });

  it('不同俱樂部的頁籤互不影響', () => {
    rememberTeamTab('team-a', 'events');
    rememberTeamTab('team-b', 'feed');

    expect(getRememberedTeamTab('team-a', ALL_TABS)).toBe('events');
    expect(getRememberedTeamTab('team-b', ALL_TABS)).toBe('feed');
  });

  it('俱樂部識別碼前後空白視為同一筆', () => {
    rememberTeamTab('  team-a \n', 'record');
    expect(getRememberedTeamTab('team-a', ALL_TABS)).toBe('record');

    rememberTeamTab('team-a', 'members');
    expect(getRememberedTeamTab('\tteam-a  ', ALL_TABS)).toBe('members');
  });

  it('空字串與純空白識別碼不會被記住或占用容量', () => {
    rememberTeamTab('', 'events');
    rememberTeamTab(' \t\n ', 'members');

    expect(getRememberedTeamTab('', ALL_TABS)).toBe('overview');
    expect(getRememberedTeamTab('   ', ALL_TABS)).toBe('overview');

    for (let index = 0; index < 50; index += 1) {
      rememberTeamTab(`team-${index}`, 'events');
    }
    expect(getRememberedTeamTab('team-0', ALL_TABS)).toBe('events');
  });

  it('最多保留五十筆，超過後依首次加入順序淘汰', () => {
    for (let index = 0; index < 50; index += 1) {
      rememberTeamTab(`team-${index}`, 'events');
    }
    expect(getRememberedTeamTab('team-0', ALL_TABS)).toBe('events');

    rememberTeamTab('team-0', 'members');
    rememberTeamTab('team-50', 'feed');

    expect(getRememberedTeamTab('team-0', ALL_TABS)).toBe('overview');
    for (let index = 1; index < 50; index += 1) {
      expect(getRememberedTeamTab(`team-${index}`, ALL_TABS)).toBe('events');
    }
    expect(getRememberedTeamTab('team-50', ALL_TABS)).toBe('feed');

    rememberTeamTab('team-51', 'record');
    expect(getRememberedTeamTab('team-1', ALL_TABS)).toBe('overview');
    expect(getRememberedTeamTab('team-51', ALL_TABS)).toBe('record');
  });

  it('重設後清空所有俱樂部記憶', () => {
    rememberTeamTab('team-a', 'events');
    rememberTeamTab('team-b', 'members');
    _resetTeamTabMemoryForTest();

    expect(getRememberedTeamTab('team-a', ALL_TABS)).toBe('overview');
    expect(getRememberedTeamTab('team-b', ALL_TABS)).toBe('overview');
  });
});
