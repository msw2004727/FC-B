// 俱樂部成員雙鍵（顧問 §3.846）：報隊 entry.teamId 是 teams 文件 id，users.teamIds 可能只有自訂 id。
// 名單頁「登錄名單」與自己登錄頁都要認任一把鍵；teams 讀取用假 reader，不連 Firestore。

import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import coreZh from '@/i18n/messages/zh-TW.json';
import { resetViewerTeamScanForTest, seedViewerTeamScanForTest } from '@/features/profile/data/viewer-team-scan';
import {
  clubMemberKeysOf,
  isClubMemberByKeys,
  loadClubMemberKeys,
  resetClubMemberKeysForTest,
} from '../club-member-keys';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict } from '../i18n';
import cpZh from '../locales-lazy/zh-TW.json';
import { memberActor, repActor, screenEnv } from '../testing/screen-fixtures';
import JoinRosterPage from './JoinRosterPage';
import RosterPage from './RosterPage';

function flatten(obj: Record<string, unknown>, prefix = '', out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value as Record<string, unknown>, path, out);
    else out[path] = String(value);
  }
  return out;
}

const dict = {
  ...flatten(coreZh as unknown as Record<string, unknown>),
  ...flatten(cpZh as unknown as Record<string, unknown>, 'competitions'),
};

vi.mock('../rep-clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rep-clubs')>();
  return { ...actual, loadMyBirthday: () => Promise.resolve(null) };
});

vi.mock('@/i18n/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/i18n')>();
  return {
    ...actual,
    useT: () => (key: string, params?: Record<string, unknown>) => {
      let text = dict[key] ?? key;
      for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value));
      return text;
    },
  };
});

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

beforeEach(() => {
  resetClubMemberKeysForTest();
  resetViewerTeamScanForTest();
  portCalls.length = 0;
});

afterEach(() => {
  cleanup();
});

const JOIN_BTN = '登錄名單';
/**
 * 換算結果寫回畫面後才做否定斷言，避免「還在換算所以沒按鈕」的假綠。
 * 等的是頁面 hook 實際拿到的那個 promise（hook 的 then 先註冊、先跑），再由 act 把畫面更新清乾淨；不用固定毫秒（整合 cp-batch-0930，Opus 審 P2-2）。
 */
const portCalls: Array<Promise<readonly string[]>> = [];
async function settle(): Promise<void> {
  await waitFor(() => expect(portCalls.length).toBeGreaterThan(0));
  await act(async () => {
    await Promise.allSettled(portCalls);
  });
}
const BLOCKED = '只有俱樂部成員可以做這個操作';

/** 名單頁 fixture 的報隊 en_a 屬 club_a（teams 文件 id）。reader 回 teams/club_a 的 id 欄位（undefined＝文件不存在）。 */
function envWith(memberClubIds: string[], idField: unknown, screenName: 'roster' | 'roster-member' | 'form-self-adult' = 'roster') {
  const reader = vi.fn(async (_teamId: string) => idField);
  const env: CpInjectedEnv = {
    ...screenEnv(screenName),
    actor: { ...memberActor, memberClubIds },
    clubKeys: (uid, teamId) => {
      const call = loadClubMemberKeys(uid, teamId, reader);
      portCalls.push(call);
      return call;
    },
  };
  return { env, reader };
}

function mount(Page: ComponentType, env: CpInjectedEnv) {
  return render(
    <LocationProvider>
      <CpEnvProvider value={env}>
        <Page />
      </CpEnvProvider>
    </LocationProvider>,
  );
}

describe('雙鍵純函式', () => {
  it('鍵：相等一把、不相等兩把、缺漏或形狀錯一把', () => {
    expect(clubMemberKeysOf('club_a', 'club_a')).toEqual(['club_a']);
    expect(clubMemberKeysOf('club_a', 'legacy_a')).toEqual(['club_a', 'legacy_a']);
    expect(clubMemberKeysOf('club_a', undefined)).toEqual(['club_a']);
    for (const bad of [null, 42, ['legacy_a'], { v: 'legacy_a' }, '', 'legacy a', 'a/b', 'x'.repeat(65)]) {
      expect(clubMemberKeysOf('club_a', bad)).toEqual(['club_a']);
    }
  });
  it('成員判斷：任一把命中；teamId 形狀錯一律不算', () => {
    expect(isClubMemberByKeys(['legacy_a'], 'club_a', ['club_a', 'legacy_a'])).toBe(true);
    expect(isClubMemberByKeys(['legacy_b'], 'club_a', ['club_a', 'legacy_a'])).toBe(false);
    expect(isClubMemberByKeys([''], '', [''])).toBe(false);
  });
});

describe('loadClubMemberKeys', () => {
  it('viewer 已載入的俱樂部文件優先，不補讀 teams', async () => {
    seedViewerTeamScanForTest(memberActor.uid!, {
      fields: new Set(['captainUid']),
      docs: [{ docId: 'club_a', data: { id: 'legacy_a' } }],
    });
    const reader = vi.fn(async () => 'other');
    expect(await loadClubMemberKeys(memberActor.uid, 'club_a', reader)).toEqual(['club_a', 'legacy_a']);
    expect(reader).not.toHaveBeenCalled();
  });
  it('補讀一次後記住；讀失敗只回文件 id 且不記住', async () => {
    const reader = vi.fn(async () => 'legacy_a');
    expect(await loadClubMemberKeys('u1', 'club_a', reader)).toEqual(['club_a', 'legacy_a']);
    expect(await loadClubMemberKeys('u1', 'club_a', reader)).toEqual(['club_a', 'legacy_a']);
    expect(reader).toHaveBeenCalledTimes(1);
    const failing = vi.fn(async () => { throw new Error('offline'); });
    expect(await loadClubMemberKeys('u1', 'club_b', failing)).toEqual(['club_b']);
    expect(await loadClubMemberKeys('u1', 'club_b', failing)).toEqual(['club_b']);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe('名單頁與自己登錄頁（六種情況）', () => {
  it('1. 文件 id 等於自訂 id：成員有文件 id 就看得到登錄，不讀 teams', async () => {
    const { env, reader } = envWith(['club_a'], 'club_a');
    mount(RosterPage, env);
    expect(screen.getByRole('button', { name: JOIN_BTN })).toBeTruthy();
    expect(reader).not.toHaveBeenCalled();
  });
  it('2.（主案）兩者不相等、成員只有自訂 id：名單頁出現登錄、登錄頁出表單', async () => {
    const roster = envWith(['legacy_a'], 'legacy_a');
    const view = mount(RosterPage, roster.env);
    await waitFor(() => expect(screen.getByRole('button', { name: JOIN_BTN })).toBeTruthy());
    expect(roster.reader).toHaveBeenCalledWith('club_a');
    view.unmount();
    resetClubMemberKeysForTest();
    const join = envWith(['legacy_a'], 'legacy_a', 'form-self-adult');
    const form = mount(JoinRosterPage, join.env);
    await waitFor(() => expect(form.container.querySelector('input[type="number"]')).toBeTruthy());
    expect(form.container.textContent ?? '').not.toContain(BLOCKED);
  });
  it('3. 兩者不相等、成員只有文件 id：直接看得到登錄，不讀 teams', async () => {
    const { env, reader } = envWith(['club_a'], 'legacy_a');
    mount(RosterPage, env);
    expect(screen.getByRole('button', { name: JOIN_BTN })).toBeTruthy();
    expect(reader).not.toHaveBeenCalled();
  });
  it('4. teams 文件不存在：只認文件 id，只有自訂 id 的人看不到登錄、登錄頁擋下', async () => {
    const roster = envWith(['legacy_a'], undefined);
    const view = mount(RosterPage, roster.env);
    await waitFor(() => expect(roster.reader).toHaveBeenCalled());
    await settle();
    expect(screen.queryByRole('button', { name: JOIN_BTN })).toBeNull();
    view.unmount();
    resetClubMemberKeysForTest();
    const join = envWith(['legacy_a'], undefined, 'form-self-adult');
    const form = mount(JoinRosterPage, join.env);
    await waitFor(() => expect(form.container.textContent ?? '').toContain(BLOCKED));
  });
  it('5. id 欄位形狀錯：只認文件 id', async () => {
    for (const bad of [42, 'legacy a', ['legacy_a'], null]) {
      resetClubMemberKeysForTest();
      const join = envWith(['legacy_a'], bad, 'form-self-adult');
      const form = mount(JoinRosterPage, join.env);
      await waitFor(() => expect(form.container.textContent ?? '').toContain(BLOCKED));
      form.unmount();
    }
  });
  it('6. 別隊的自訂 id 不能拿來進本隊', async () => {
    const roster = envWith(['legacy_b', 'club_b'], 'legacy_a');
    const view = mount(RosterPage, roster.env);
    await waitFor(() => expect(roster.reader).toHaveBeenCalledWith('club_a'));
    await settle();
    expect(screen.queryByRole('button', { name: JOIN_BTN })).toBeNull();
    view.unmount();
    resetClubMemberKeysForTest();
    const join = envWith(['legacy_b', 'club_b'], 'legacy_a', 'form-self-adult');
    const form = mount(JoinRosterPage, join.env);
    await waitFor(() => expect(form.container.textContent ?? '').toContain(BLOCKED));
  });
  it('沒注入 clubKeys（harness）：只用文件 id、不讀網路，行為與改前相同', async () => {
    const env: CpInjectedEnv = { ...screenEnv('roster'), actor: { ...memberActor, memberClubIds: ['legacy_a'] } };
    mount(RosterPage, env);
    expect(screen.queryByRole('button', { name: JOIN_BTN })).toBeNull();
  });
});

describe('整合版名單頁（cp-batch-0930）：canSelfJoin＝代表或雙鍵成員', () => {
  /** 換算永遠不回來：用來確認「換算中」的畫面。 */
  const never = () => new Promise<readonly string[]>(() => {});

  it('只有自訂 id 的成員：換算完看得到「登錄名單」（主要鈕）', async () => {
    const { env, reader } = envWith(['legacy_a'], 'legacy_a', 'roster-member');
    mount(RosterPage, env);
    const join = await screen.findByRole('button', { name: JOIN_BTN });
    expect(join.className).toContain('ui-button--primary');
    expect(reader).toHaveBeenCalledWith('club_a');
  });

  it('換算中：只有自訂 id 的成員先看不到「登錄名單」', () => {
    const env: CpInjectedEnv = {
      ...screenEnv('roster-member'),
      actor: { ...memberActor, memberClubIds: ['legacy_a'] },
      clubKeys: never,
    };
    mount(RosterPage, env);
    expect(screen.queryByRole('button', { name: JOIN_BTN })).toBeNull();
  });

  it('代表不必等換算：換算中也直接看得到「登錄名單」（次要鈕）', () => {
    const env: CpInjectedEnv = {
      ...screenEnv('roster'),
      actor: { ...repActor, memberClubIds: ['legacy_a'] },
      clubKeys: never,
    };
    mount(RosterPage, env);
    expect(screen.getByRole('button', { name: JOIN_BTN }).className).toContain('ui-button--secondary');
  });

  it('只有自訂 id 的成員：賽事延期時仍看不到「登錄名單」（rosterPhaseOpen 照整合版）', async () => {
    const { env, reader } = envWith(['legacy_a'], 'legacy_a', 'roster-member');
    env.bundle = { ...env.bundle!, competition: { ...env.bundle!.competition!, status: 'postponed' } };
    mount(RosterPage, env);
    await settle();
    expect(reader).toHaveBeenCalledWith('club_a');
    expect(screen.queryByRole('button', { name: JOIN_BTN })).toBeNull();
  });

  it('只有自訂 id 的成員、已在本隊名單：不顯示「登錄名單」，自己那列是「退出名單」', async () => {
    const { env } = envWith(['legacy_a'], 'legacy_a', 'roster-member');
    env.bundle = { ...env.bundle!, myPlIds: ['pl_2'] };
    mount(RosterPage, env);
    // 退出鍵不看換算，一 render 就有；登錄鍵要等換算完成才能下「不顯示」的結論（Opus 審 P2-1）。
    await settle();
    expect(screen.getByRole('button', { name: '退出名單' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: JOIN_BTN })).toBeNull();
  });

  it('登錄頁：代表不必等換算，換算中也直接出表單（Opus 審 P3-2）', () => {
    const env: CpInjectedEnv = {
      ...screenEnv('form-rep'),
      actor: { ...repActor, memberClubIds: ['legacy_a'] },
      clubKeys: never,
    };
    const view = mount(JoinRosterPage, env);
    expect(view.container.querySelector('input[type="number"]')).toBeTruthy();
    expect(view.container.textContent ?? '').not.toContain(BLOCKED);
  });

  it('對照：登錄頁一般成員換算中轉圈、不出表單也不擋', () => {
    const env: CpInjectedEnv = {
      ...screenEnv('form-self-adult'),
      actor: { ...memberActor, memberClubIds: ['legacy_a'] },
      clubKeys: never,
    };
    const view = mount(JoinRosterPage, env);
    expect(view.container.querySelector('input[type="number"]')).toBeNull();
    expect(view.container.textContent ?? '').not.toContain(BLOCKED);
  });
});
