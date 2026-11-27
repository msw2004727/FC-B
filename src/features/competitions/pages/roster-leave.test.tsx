// CP-PO-08 球員本人退出名單：自己那一列（cpMine 的 plIds）顯示「退出名單」，先確認再呼叫 leaveRoster。
// 顯示條件跟後端 leaveRoster 的 assertRosterPhase 一致（rosterPhaseOpen）：已發布、未下架、未結束、名單未鎖定、尚未開賽。
// 登錄時後端回 ALREADY_IN_ROSTER 要提示先退出原本隊伍。
// 後半段併入 po-host（CP-PO-05）原本同名測試檔的撤回報名與 assertRosterPhase 情境（整合 cp-batch-0930，顧問 §3.852 甲案）。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import coreZh from '@/i18n/messages/zh-TW.json';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import type { CpActions } from '../actions';
import { CpCallError } from '../data/cp-callables';
import type { CompetitionDoc, CpMineItem, EntryStatus } from '../data/types';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict } from '../i18n';
import cpZh from '../locales-lazy/zh-TW.json';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import { FIRST_MATCH, NOW, memberActor, repActor, screenEnv } from '../testing/screen-fixtures';
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

afterEach(() => {
  _resetAppConfirmForTest();
  cleanup();
});

function mount(Page: ComponentType, env: CpInjectedEnv) {
  return render(
    <LocationProvider>
      <CpEnvProvider value={env}>
        <Page />
        <AppConfirmHost />
      </CpEnvProvider>
    </LocationProvider>,
  );
}

function withLeaveSpy(env: CpInjectedEnv) {
  const leaveRoster = vi.fn(async () => ({ removed: true }));
  env.actions = { ...env.actions, leaveRoster: leaveRoster as unknown as CpActions['leaveRoster'] };
  return leaveRoster;
}

/** 名單列（data-roster-row）裡的文字，用顯示名找。 */
function rowOf(name: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('[data-roster-row]')]
    .find((node) => node.querySelector('.cps-player__name')?.textContent === name);
  if (!row) throw new Error(`找不到 ${name} 那一列`);
  return row;
}

const LEAVE = '退出名單';

describe('名單頁：球員本人退出（CP-PO-08）', () => {
  it('只有自己那一列有「退出名單」，別人的列沒有；已在本隊名單就不再顯示「登錄名單」', () => {
    mount(RosterPage, screenEnv('roster-self'));
    const buttons = screen.getAllByRole('button', { name: LEAVE });
    expect(buttons).toHaveLength(1);
    expect(rowOf('林示範').contains(buttons[0]!)).toBe(true);
    expect(rowOf('王示範').querySelector('button')).toBeNull();
    // 隊員沒有垃圾桶
    expect(document.querySelector('[data-roster-row] .cps-iconbtn')).toBeNull();
    expect(screen.queryByRole('button', { name: '登錄名單' })).toBeNull();
  });

  it('不在名單上的隊員沒有退出鍵，仍可登錄', () => {
    mount(RosterPage, screenEnv('roster-member'));
    expect(screen.queryByRole('button', { name: LEAVE })).toBeNull();
    expect(screen.getByRole('button', { name: '登錄名單' })).toBeTruthy();
  });

  it('先確認；取消不呼叫，確定後呼叫 leaveRoster、拿掉那一列，並可再去登錄', async () => {
    const env = screenEnv('roster-self');
    const leaveRoster = withLeaveSpy(env);
    const view = mount(RosterPage, env);
    fireEvent.click(screen.getByRole('button', { name: LEAVE }));
    expect(screen.getByRole('alertdialog').textContent ?? '').toContain('確定要退出「示範隊A」的名單？');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(leaveRoster).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: LEAVE }));
    fireEvent.click(screen.getByRole('button', { name: '退出' }));
    await waitFor(() => expect(leaveRoster).toHaveBeenCalledWith({ cid: 'cup', plId: 'pl_2' }));
    await waitFor(() => expect(view.container.textContent ?? '').not.toContain('林示範'));
    expect(screen.queryByRole('button', { name: LEAVE })).toBeNull();
    expect(screen.getByRole('button', { name: '登錄名單' })).toBeTruthy();
  });

  it('退出失敗：列留著，顯示原因', async () => {
    const env = screenEnv('roster-self');
    env.actions = {
      ...env.actions,
      leaveRoster: async () => { throw new CpCallError('ROSTERS_LOCKED', {}); },
    };
    const view = mount(RosterPage, env);
    fireEvent.click(screen.getByRole('button', { name: LEAVE }));
    fireEvent.click(screen.getByRole('button', { name: '退出' }));
    expect(await screen.findByText('名單已鎖定，不能再修改')).toBeTruthy();
    expect(view.container.textContent ?? '').toContain('林示範');
  });

  it('名單已鎖定：沒有退出鍵', () => {
    mount(RosterPage, screenEnv('roster-self-locked'));
    expect(screen.queryByRole('button', { name: LEAVE })).toBeNull();
  });

  it('已開賽（第一場開打後）：沒有退出鍵', () => {
    mount(RosterPage, screenEnv('roster-self-started'));
    expect(screen.getByText('林示範')).toBeTruthy();
    expect(screen.queryByRole('button', { name: LEAVE })).toBeNull();
  });

  it('開賽前一毫秒仍可退出（與後端 nowMs >= firstMatchAt 同一邊界）', () => {
    const env = screenEnv('roster-self');
    env.now = FIRST_MATCH - 1;
    mount(RosterPage, env);
    expect(screen.getByRole('button', { name: LEAVE })).toBeTruthy();
  });

  it('已開賽（直接改 now）：沒有退出鍵', () => {
    const env = screenEnv('roster-self');
    env.now = FIRST_MATCH;
    mount(RosterPage, env);
    expect(screen.queryByRole('button', { name: LEAVE })).toBeNull();
  });

  it('代表自己也在名單上：自己那列是退出鍵，別人的列仍是垃圾桶', () => {
    const env = screenEnv('roster');
    env.bundle = { ...env.bundle!, myPlIds: ['pl_1'] };
    mount(RosterPage, env);
    expect(rowOf('王示範').textContent).toContain(LEAVE);
    expect(rowOf('王示範').querySelector('.cps-iconbtn')).toBeNull();
    expect(rowOf('林示範').querySelector('.cps-iconbtn')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: LEAVE })).toHaveLength(1);
  });
});

describe('名單頁：代表也能自己登錄（CP-PO-08 追加）', () => {
  const JOIN = '登錄名單';

  it('代表在自己隊的名單頁：同時有「代為新增球員」、確認名單與「登錄名單」，按下去到登錄表單', () => {
    mount(RosterPage, screenEnv('roster'));
    expect(screen.getByRole('button', { name: '代為新增球員' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '確認名單' })).toBeTruthy();
    const join = screen.getByRole('button', { name: JOIN });
    // 代表的主要鈕是確認名單，登錄是次要鈕
    expect(join.className).toContain('ui-button--secondary');
    fireEvent.click(join);
    expect(window.location.pathname).toBe('/competitions/cup/entries/en_a/join');
  });

  it('代表已在本隊名單：不顯示「登錄名單」，代為新增與確認名單照舊', () => {
    mount(RosterPage, screenEnv('roster-rep-self'));
    expect(rowOf('王示範').textContent).toContain(LEAVE);
    expect(screen.queryByRole('button', { name: JOIN })).toBeNull();
    expect(screen.getByRole('button', { name: '代為新增球員' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '確認名單' })).toBeTruthy();
  });

  it('代表：名單已鎖定或已開賽、報隊被拒時不顯示「登錄名單」', () => {
    const locked = screenEnv('roster-locked');
    const lockedView = mount(RosterPage, locked);
    expect(screen.queryByRole('button', { name: JOIN })).toBeNull();
    lockedView.unmount();

    const started = screenEnv('roster');
    started.now = FIRST_MATCH;
    const startedView = mount(RosterPage, started);
    expect(screen.queryByRole('button', { name: JOIN })).toBeNull();
    startedView.unmount();

    for (const status of ['rejected', 'withdrawn'] as const) {
      const env = screenEnv('roster');
      env.bundle = { ...env.bundle!, entries: env.bundle!.entries.map((row) => ({ ...row, status })) };
      const view = mount(RosterPage, env);
      expect(screen.queryByRole('button', { name: JOIN }), status).toBeNull();
      view.unmount();
    }
  });

  it('代表報隊待審時也能登錄（與一般成員同條件）', () => {
    const env = screenEnv('roster');
    env.bundle = { ...env.bundle!, entries: env.bundle!.entries.map((row) => ({ ...row, status: 'pending' as const })) };
    mount(RosterPage, env);
    expect(screen.getByRole('button', { name: JOIN })).toBeTruthy();
  });

  it('只當代表、不在成員清單也能登錄；別隊代表不能', () => {
    const repOnly = screenEnv('roster');
    repOnly.actor = { ...repActor, memberClubIds: [] };
    const view = mount(RosterPage, repOnly);
    expect(screen.getByRole('button', { name: JOIN })).toBeTruthy();
    view.unmount();

    const otherRep = screenEnv('roster');
    otherRep.actor = { ...repActor, repClubs: [{ id: 'club_b', name: '示範隊B' }], memberClubIds: ['club_b'] };
    mount(RosterPage, otherRep);
    expect(screen.queryByRole('button', { name: JOIN })).toBeNull();
    expect(screen.queryByRole('button', { name: '代為新增球員' })).toBeNull();
  });

  it('一般成員維持原行為；非成員沒有登錄鍵', () => {
    const member = mount(RosterPage, screenEnv('roster-member'));
    expect(screen.getByRole('button', { name: JOIN }).className).toContain('ui-button--primary');
    expect(screen.queryByRole('button', { name: '代為新增球員' })).toBeNull();
    member.unmount();

    const stranger = screenEnv('roster-member');
    stranger.actor = { ...memberActor, memberClubIds: [] };
    mount(RosterPage, stranger);
    expect(screen.queryByRole('button', { name: JOIN })).toBeNull();
  });
});

describe('名單頁正式讀取：用 cpMine 認出自己', () => {
  function liveEnv(mine: Record<string, CpMineItem[]>, override: Partial<ReturnType<typeof createFakeCpRepo>> = {}): CpInjectedEnv {
    const seed = screenEnv('roster-member').bundle!;
    const base = createFakeCpRepo({
      competitions: [seed.competition!],
      divisions: { cup: seed.divisions },
      entries: { cup: seed.entries },
      roster: { cup: seed.roster },
      mine,
    });
    const env = screenEnv('roster-member');
    // 不帶 bundle：頁面自己讀 repo（跟正式頁一樣）
    return { ...env, bundle: undefined, repo: { ...base, ...override } };
  }

  const MINE: CpMineItem = { id: 'cup', cid: 'cup', roles: ['player'], host: false, category: 'league', plIds: ['pl_2'] };

  it('mine 的 plIds 有這一列 → 顯示退出鍵', async () => {
    mount(RosterPage, liveEnv({ uid_member: [MINE] }));
    expect(await screen.findByRole('button', { name: LEAVE })).toBeTruthy();
    expect(rowOf('林示範').textContent).toContain(LEAVE);
  });

  it('別場賽事的 mine 不算', async () => {
    mount(RosterPage, liveEnv({ uid_member: [{ ...MINE, id: 'other', cid: 'other' }] }));
    expect(await screen.findByRole('button', { name: '登錄名單' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: LEAVE })).toBeNull();
  });

  it('讀 mine 失敗：名單照常顯示，只是沒有退出鍵', async () => {
    mount(RosterPage, liveEnv({}, { getMine: async () => { throw new Error('讀取失敗'); } }));
    expect(await screen.findByText('林示範')).toBeTruthy();
    expect(screen.queryByRole('button', { name: LEAVE })).toBeNull();
  });

  it('沒登入不讀 mine', async () => {
    const getMine = vi.fn(async () => MINE);
    const env = liveEnv({}, { getMine });
    env.actor = { ...memberActor, uid: '' };
    mount(RosterPage, env);
    expect(await screen.findByText('林示範')).toBeTruthy();
    expect(getMine).not.toHaveBeenCalled();
  });

  it('uid 延後才出現：到位後才讀 mine，並顯示退出鍵（L-43）', async () => {
    const env = liveEnv({ uid_member: [MINE] });
    const getMine = vi.fn(env.repo.getMine);
    const pending: CpInjectedEnv = { ...env, actor: { ...memberActor, uid: '' }, repo: { ...env.repo, getMine } };
    const view = mount(RosterPage, pending);
    expect(await screen.findByText('林示範')).toBeTruthy();
    expect(getMine).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: LEAVE })).toBeNull();
    view.rerender(
      <LocationProvider>
        <CpEnvProvider value={{ ...pending, actor: memberActor }}>
          <RosterPage />
          <AppConfirmHost />
        </CpEnvProvider>
      </LocationProvider>,
    );
    expect(await screen.findByRole('button', { name: LEAVE })).toBeTruthy();
    expect(getMine).toHaveBeenCalledWith('uid_member', 'cup');
  });

  it('換帳號：新帳號的 mine 回來前，先拿掉上一個帳號的退出鍵（審查 P3-4）', async () => {
    const env = liveEnv({ uid_member: [MINE] });
    const view = mount(RosterPage, env);
    expect(await screen.findByRole('button', { name: LEAVE })).toBeTruthy();
    const never = new Promise<never>(() => {});
    const other: CpInjectedEnv = {
      ...env,
      actor: { ...memberActor, uid: 'uid_other' },
      repo: { ...env.repo, getMine: () => never },
    };
    view.rerender(
      <LocationProvider>
        <CpEnvProvider value={other}>
          <RosterPage />
          <AppConfirmHost />
        </CpEnvProvider>
      </LocationProvider>,
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: LEAVE })).toBeNull());
  });

  it('代表帳號也照 mine 認自己', async () => {
    const env = liveEnv({ uid_rep: [{ ...MINE, plIds: ['pl_1'] }] });
    env.actor = repActor;
    mount(RosterPage, env);
    await waitFor(() => expect(rowOf('王示範').textContent).toContain(LEAVE));
  });
});

describe('登錄：已在本賽事其他隊伍名單', () => {
  it('後端回 ALREADY_IN_ROSTER → 提示先退出原本隊伍', async () => {
    mount(JoinRosterPage, screenEnv('form-already'));
    fireEvent.click(screen.getByRole('checkbox', { name: '我了解名單會公開顯示暱稱與背號' }));
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    expect(await screen.findByText('你已在本賽事其他隊伍名單，要換隊請先退出原本隊伍')).toBeTruthy();
  });

  it('七語都有這句（目前七語同一份繁中）與退出鍵文字', async () => {
    const files = import.meta.glob<Record<string, unknown>>('../locales-lazy/*.json', { import: 'default', eager: true });
    expect(Object.keys(files)).toHaveLength(7);
    for (const [file, json] of Object.entries(files)) {
      const flat = flatten(json);
      expect(flat['reason.ALREADY_IN_ROSTER'], file).toBe('你已在本賽事其他隊伍名單，要換隊請先退出原本隊伍');
      expect(flat.leaveRoster, file).toBe('退出名單');
      expect(flat.leaveRosterConfirm, file).toContain('{team}');
    }
  });
});

/** 把賽事或報隊狀態改掉（注入的 bundle 不讀 repo）。 */
function withComp(env: CpInjectedEnv, comp: Partial<CompetitionDoc>): CpInjectedEnv {
  env.bundle = { ...env.bundle!, competition: { ...env.bundle!.competition!, ...comp } };
  return env;
}

function withEntryStatus(env: CpInjectedEnv, status: EntryStatus): CpInjectedEnv {
  env.bundle = { ...env.bundle!, entries: env.bundle!.entries.map((row) => ({ ...row, status })) };
  return env;
}

describe('名單頁：退出鍵與 assertRosterPhase 同一組條件（rosterPhaseOpen）', () => {
  const blocked: Array<[string, Partial<CompetitionDoc>]> = [
    ['賽事延期', { status: 'postponed' }],
    ['下架', { hidden: true, hiddenReason: '資料不實' }],
    ['已結束', { endedAt: NOW - 60_000 }],
    ['未發布', { status: 'draft' }],
  ];

  it.each(blocked)('%s：自己那列看不到退出鍵，名單照常顯示', (_label, comp) => {
    mount(RosterPage, withComp(screenEnv('roster-self'), comp));
    expect(screen.getByText('林示範')).toBeTruthy();
    expect(screen.queryByRole('button', { name: LEAVE })).toBeNull();
  });

  it.each(blocked)('%s：代表自己那列也看不到退出鍵', (_label, comp) => {
    mount(RosterPage, withComp(screenEnv('roster-rep-self'), comp));
    expect(screen.queryByRole('button', { name: LEAVE })).toBeNull();
  });
});

describe('名單頁：代表撤回報名與名單權限（CP-PO-05，原 po-host 測試）', () => {
  it.each(['pending', 'approved'] as EntryStatus[])('代表（entry=%s）看得到撤回報名與垃圾桶', (status) => {
    mount(RosterPage, withEntryStatus(screenEnv('roster'), status));
    expect(screen.getByRole('button', { name: '撤回報名' })).toBeTruthy();
    expect(screen.getByLabelText('移除 林示範')).toBeTruthy();
  });

  it('報隊待審：代表看得到垃圾桶（代表刪人跟後端 leaveRoster 一致，不看報隊狀態）', () => {
    mount(RosterPage, withEntryStatus(screenEnv('roster'), 'pending'));
    expect(rowOf('林示範').querySelector('.cps-iconbtn')).toBeTruthy();
  });

  // 被拒、已退出時後端已清空名單（reviewEntry／withdrawEntry 的 prepareClearRoster）；撤回（withdrawEntry）要審核中或已核准。
  it.each(['rejected', 'withdrawn'] as EntryStatus[])('代表（entry=%s）看不到撤回報名', (status) => {
    mount(RosterPage, withEntryStatus(screenEnv('roster'), status));
    expect(screen.queryByRole('button', { name: '撤回報名' })).toBeNull();
  });

  it('延期中：代表看不到代為新增球員、垃圾桶與撤回報名，成員看不到登錄名單；開放時成員看得到', () => {
    const rep = mount(RosterPage, withComp(screenEnv('roster'), { status: 'postponed' }));
    expect(screen.queryByRole('button', { name: '代為新增球員' })).toBeNull();
    expect(screen.queryByRole('button', { name: '撤回報名' })).toBeNull();
    expect(screen.queryByLabelText('移除 林示範')).toBeNull();
    rep.unmount();
    const member = mount(RosterPage, withComp(screenEnv('roster-member'), { status: 'postponed' }));
    expect(screen.queryByRole('button', { name: '登錄名單' })).toBeNull();
    member.unmount();
    mount(RosterPage, screenEnv('roster-member'));
    expect(screen.getByRole('button', { name: '登錄名單' })).toBeTruthy();
  });

  it('代表按撤回報名：確認句含隊名，確定後 withdrawEntry 收到參數', async () => {
    const env = screenEnv('roster');
    const withdrawEntry = vi.fn(async () => ({}));
    env.actions = { ...env.actions, withdrawEntry: withdrawEntry as unknown as CpActions['withdrawEntry'] };
    mount(RosterPage, env);
    fireEvent.click(screen.getByRole('button', { name: '撤回報名' }));
    const box = screen.getByRole('alertdialog');
    expect(box.textContent ?? '').toContain('示範隊A');
    fireEvent.click([...box.querySelectorAll('button')].find((node) => node.textContent?.trim() === '撤回報名')!);
    await waitFor(() => expect(withdrawEntry).toHaveBeenCalledWith({ cid: 'cup', enId: 'en_a' }));
  });

  it('一般成員與未登入看不到撤回報名', () => {
    const member = mount(RosterPage, screenEnv('roster-self'));
    expect(screen.queryByRole('button', { name: '撤回報名' })).toBeNull();
    member.unmount();
    const guest = screenEnv('roster-member');
    guest.actor = { ...memberActor, uid: '', memberClubIds: [] };
    mount(RosterPage, guest);
    expect(screen.queryByRole('button', { name: '撤回報名' })).toBeNull();
    expect(screen.queryByRole('button', { name: LEAVE })).toBeNull();
  });
});
