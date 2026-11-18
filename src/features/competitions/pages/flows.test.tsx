import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentChildren, ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_OVERRIDES } from '@/feature-overrides';
import { ALL_FEATURES } from '@/features.config';
import { _resetForTest, getActiveRoutes, registerFeatures } from '@/core/feature-registry';
import coreZh from '@/i18n/messages/zh-TW.json';
import { CpCallError } from '../data/cp-callables';
import { CpEnvProvider, type CpActor, type CpInjectedEnv } from '../env';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import {
  HARNESS_SCREENS,
  FIRST_MATCH,
  NOW,
  REG_OPEN,
  adminActor,
  adultDivision,
  clubRepActor,
  coHostActor,
  competition,
  hostActor,
  idleActions,
  manageBundle,
  memberActor,
  repActor,
  screenEnv,
  wizardActor,
  wizardSeed,
} from '../testing/screen-fixtures';
import cpZh from '../locales/zh-TW.json';
import AddRosterPage from './AddRosterPage';
import CompetitionDetailPage from './CompetitionDetailPage';
import CompetitionManagePage from './CompetitionManagePage';
import JoinRosterPage from './JoinRosterPage';
import NewCompetitionPage from './NewCompetitionPage';
import RosterPage from './RosterPage';
import { InAppSection } from '../components/InAppSection';

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

const birthdayBox = vi.hoisted(() => ({
  load: null as null | ((uid: string) => Promise<string | null>),
}));

vi.mock('../rep-clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rep-clubs')>();
  return {
    ...actual,
    loadMyBirthday: (uid: string) => (birthdayBox.load ? birthdayBox.load(uid) : Promise.resolve(null)),
  };
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

function spyActions() {
  const actions = idleActions();
  return {
    create: vi.fn(actions.create),
    publish: vi.fn(actions.publish),
    registerEntry: vi.fn(actions.registerEntry),
    review: vi.fn(actions.review),
    joinRoster: vi.fn(actions.joinRoster),
    addRosterByRep: vi.fn(actions.addRosterByRep),
    leaveRoster: vi.fn(actions.leaveRoster),
    confirmRoster: vi.fn(actions.confirmRoster),
    lockRosters: vi.fn(actions.lockRosters),
    unlockRosters: vi.fn(actions.unlockRosters),
    setPaymentStatus: vi.fn(actions.setPaymentStatus),
    report: vi.fn(actions.report),
  };
}

function draw(node: ComponentChildren) {
  return render(<LocationProvider>{node}</LocationProvider>);
}

function mount(Page: ComponentType, env: CpInjectedEnv) {
  return draw(
    <CpEnvProvider value={env}>
      <Page />
      <AppConfirmHost />
    </CpEnvProvider>,
  );
}

const PAGES: Record<string, ComponentType> = {
  'wizard-1': NewCompetitionPage,
  'wizard-1-club': NewCompetitionPage,
  'wizard-1-error': NewCompetitionPage,
  'wizard-2': NewCompetitionPage,
  'wizard-3': NewCompetitionPage,
  'wizard-done': NewCompetitionPage,
  'detail-rep': CompetitionDetailPage,
  'detail-member': CompetitionDetailPage,
  'detail-report': CompetitionDetailPage,
  roster: RosterPage,
  'roster-ready': RosterPage,
  'roster-locked': RosterPage,
  'form-self-adult': JoinRosterPage,
  'form-self-minor': JoinRosterPage,
  'form-rep': AddRosterPage,
  'form-rep-adult': AddRosterPage,
  'form-rep-adult-nick': AddRosterPage,
  'host-pending': CompetitionManagePage,
  'host-approved': CompetitionManagePage,
  'host-rejected': CompetitionManagePage,
  'host-reject': CompetitionManagePage,
  'host-lock': CompetitionManagePage,
  'host-unlock': CompetitionManagePage,
  'position-measure': RosterPage,
};

afterEach(() => {
  birthdayBox.load = null;
  _resetAppConfirmForTest();
  cleanup();
  _resetForTest();
  FEATURE_OVERRIDES.competitions = false;
});

describe('賽事第 2 步畫面', () => {
  it('關閉開關時沒有啟用中的 /competitions 路由', () => {
    registerFeatures(ALL_FEATURES);
    expect(getActiveRoutes().some((route) => route.path.startsWith('/competitions'))).toBe(false);
  });

  it('每個預覽畫面都畫得出標題，而且不出現英文 reason 代碼', () => {
    for (const name of HARNESS_SCREENS) {
      const view = mount(PAGES[name] ?? NewCompetitionPage, screenEnv(name));
      expect(view.container.querySelector('.cps-root, .cps-inapp'), name).toBeTruthy();
      expect(view.container.textContent ?? '', name).not.toMatch(/BANNED_WORD|UNKNOWN_FIELD|NOT_HOST/);
      view.unmount();
    }
  });

  it('審核鈕只給主辦、共同主辦、俱樂部現任代表與管理員', () => {
    const cases: Array<[string, CpActor, CpInjectedEnv['bundle']]> = [
      ['host', hostActor, manageBundle({ uid: 'uid_host', roles: ['host'] })],
      ['coHost', coHostActor, manageBundle({ uid: 'uid_co', roles: ['coHost'] })],
      ['clubRep', clubRepActor, manageBundle(null)],
      ['admin', adminActor, manageBundle(null)],
      ['member', memberActor, manageBundle(null)],
      ['repOfOther', repActor, manageBundle(null)],
    ];
    for (const [label, who, bundle] of cases) {
      const view = mount(CompetitionManagePage, {
        ...screenEnv('host-pending'),
        actor: who,
        bundle,
      });
      const approve = screen.queryAllByRole('button', { name: '核准' });
      if (label === 'member' || label === 'repOfOther') expect(approve, label).toHaveLength(0);
      else expect(approve.length, label).toBeGreaterThan(0);
      view.unmount();
    }
  });

  it('以俱樂部報隊只給代表，送出只有 cid、dvId、teamId', async () => {
    const actions = spyActions();
    mount(CompetitionDetailPage, { ...screenEnv('detail-rep', actions) });
    expect(screen.getByRole('button', { name: '以俱樂部報隊' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '以俱樂部報隊' }));
    fireEvent.click(screen.getByRole('button', { name: '送出報名' }));
    await waitFor(() => expect(actions.registerEntry).toHaveBeenCalledWith({
      cid: 'cup', dvId: 'dv_adult', teamId: 'club_a',
    }));

    cleanup();
    mount(CompetitionDetailPage, { ...screenEnv('detail-member') });
    expect(screen.queryByRole('button', { name: '以俱樂部報隊' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: '檢舉' })).toBeTruthy();
  });

  it('線上支付鈕沒有行為；標示已繳費才呼叫 setPaymentStatus', async () => {
    const actions = spyActions();
    mount(CompetitionManagePage, { ...screenEnv('host-approved', actions) });
    const pay = screen.getAllByRole('button', { name: '線上支付' });
    expect(pay.length).toBeGreaterThan(0);
    for (const button of pay) {
      expect(button).toHaveProperty('disabled', true);
      fireEvent.click(button);
    }
    expect(actions.setPaymentStatus).not.toHaveBeenCalled();
    const switches = screen.getAllByRole('switch', { name: '標示已繳費' });
    fireEvent.click(switches[1]!);
    await waitFor(() => expect(actions.setPaymentStatus).toHaveBeenCalledWith({
      cid: 'cup', enId: 'en_d', paymentStatus: 'paid',
    }));
  });

  it('鎖定先確認，同意後才鎖定', async () => {
    const actions = spyActions();
    mount(CompetitionManagePage, { ...screenEnv('host-approved', actions) });
    fireEvent.click(screen.getByRole('button', { name: '鎖定全部名單' }));
    expect(screen.getByRole('alertdialog').textContent ?? '').toContain('還有 1 隊尚未確認名單');
    fireEvent.click(screen.getByRole('button', { name: '鎖定' }));
    await waitFor(() => expect(actions.lockRosters).toHaveBeenCalledWith({ cid: 'cup' }));
  });

  it('自己登錄與代填送出的欄位符合契約', async () => {
    const adult = spyActions();
    const adultView = mount(JoinRosterPage, { ...screenEnv('form-self-adult', adult) });
    expect(adultView.container.textContent ?? '').toContain('我了解名單會公開顯示暱稱與背號');
    expect(adultView.container.textContent ?? '').not.toContain('公開顯示：');
    fireEvent.click(screen.getByRole('checkbox', { name: '我了解名單會公開顯示暱稱與背號' }));
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(adult.joinRoster).toHaveBeenCalledWith({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', nickname: '阿範', privacyAck: true,
    }));

    cleanup();
    const minor = spyActions();
    const minorView = mount(JoinRosterPage, { ...screenEnv('form-self-minor', minor) });
    expect(minorView.container.textContent ?? '').toContain('公開顯示：歐陽O明');
    expect(minorView.container.textContent ?? '').toContain('未成年球員公開時會遮住名字第一個字，\n例：王O明。');
    expect(minorView.container.textContent ?? '').toContain('真實姓名僅供主辦核對資格，不會公開。');
    expect(minorView.container.textContent ?? '').toContain('我了解名單會公開遮字後的姓名與背號');
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(minor.joinRoster).toHaveBeenCalledWith({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', privacyAck: true,
      realName: '歐陽小明', guardianConsent: true,
    }));
    expect(minor.joinRoster.mock.calls[0]?.[0]).not.toHaveProperty('publicName');

    cleanup();
    const added = spyActions();
    const repView = mount(AddRosterPage, { ...screenEnv('form-rep', added) });
    expect(repView.container.textContent ?? '').toContain('公開顯示：歐陽O明');
    expect(screen.queryByLabelText('暱稱')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    await waitFor(() => expect(added.addRosterByRep).toHaveBeenCalledWith({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', privacyAck: true,
      realName: '歐陽小明', guardianConsent: true, birthday: '2016-05-20',
    }));
    expect(added.addRosterByRep.mock.calls[0]?.[0]).not.toHaveProperty('publicName');

    cleanup();
    const repAdult = spyActions();
    const adultRep = mount(AddRosterPage, { ...screenEnv('form-rep-adult', repAdult) });
    expect(adultRep.container.textContent ?? '').toContain('公開顯示：王O範');
    expect(adultRep.container.textContent ?? '').toContain('我了解名單會公開遮字後的姓名與背號');
    fireEvent.click(screen.getByRole('checkbox', { name: '我了解名單會公開遮字後的姓名與背號' }));
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    await waitFor(() => expect(repAdult.addRosterByRep).toHaveBeenCalledWith({
      cid: 'cup', enId: 'en_a', number: 10, position: 'MF', privacyAck: true,
      realName: '王小範', birthday: '1990-05-20',
    }));

    cleanup();
    const nick = spyActions();
    const nickView = mount(AddRosterPage, { ...screenEnv('form-rep-adult-nick', nick) });
    expect(nickView.container.textContent ?? '').toContain('公開顯示：阿範');
    expect(nickView.container.textContent ?? '').toContain('我了解名單會公開顯示暱稱與背號');
    fireEvent.click(screen.getByRole('checkbox', { name: '我了解名單會公開顯示暱稱與背號' }));
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    await waitFor(() => expect(nick.addRosterByRep).toHaveBeenCalledWith({
      cid: 'cup', enId: 'en_a', number: 10, position: 'MF', privacyAck: true,
      realName: '王小範', nickname: '阿範', birthday: '1990-05-20',
    }));
  });

  it('禁用字只顯示文案；缺生日連到個人資料', async () => {
    const view = mount(NewCompetitionPage, screenEnv('wizard-1-error'));
    const error = view.container.querySelector('[data-field-error]');
    expect(error?.textContent).toBe('名稱包含不允許的字詞');
    expect(view.container.textContent ?? '').not.toContain('BANNED_WORD');
    view.unmount();

    const actions = spyActions();
    actions.joinRoster.mockRejectedValue(new CpCallError('BIRTHDAY_REQUIRED', {}));
    const minor = mount(JoinRosterPage, { ...screenEnv('form-self-minor', actions) });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    const link = await screen.findByRole('link', { name: '前往個人資料' });
    expect(link.getAttribute('href')).toBe('/profile');
    expect(minor.container.textContent ?? '').toContain('請先補上生日');
    expect(minor.container.textContent ?? '').not.toContain('BIRTHDAY_REQUIRED');
  });

  it('人數不足不能確認；鎖定後唯讀', () => {
    const short = mount(RosterPage, screenEnv('roster'));
    expect(short.container.textContent ?? '').toContain('還需 2 人');
    expect(screen.getByRole('button', { name: '確認名單' })).toHaveProperty('disabled', true);
    short.unmount();

    const ready = mount(RosterPage, screenEnv('roster-ready'));
    expect(screen.getByRole('button', { name: '確認名單' })).toHaveProperty('disabled', false);
    ready.unmount();

    const locked = mount(RosterPage, screenEnv('roster-locked'));
    expect(locked.container.textContent ?? '').toContain('名單已鎖定，不能再修改');
    expect(screen.queryByRole('button', { name: '確認名單' })).toBeNull();
    expect(locked.container.querySelectorAll('[data-roster-row]').length).toBe(7);
  });

  it('已退出的報隊不出現在三個分頁，已拒絕分頁看得到原因', () => {
    const view = mount(CompetitionManagePage, screenEnv('host-pending'));
    expect(view.container.textContent ?? '').not.toContain('示範隊G');
    expect(view.container.textContent ?? '').toContain('示範隊A');
    view.unmount();
    const rejected = mount(CompetitionManagePage, screenEnv('host-rejected'));
    expect(screen.getByRole('tab', { selected: true }).textContent ?? '').toContain('已拒絕');
    expect(rejected.container.textContent ?? '').toContain('示範隊F');
    expect(rejected.container.textContent ?? '').toContain('報名資料不齊全');
  });

  it('站內賽事：未定案時不先判關閉；通過閘門才顯示，我的賽事不重複出現在公開清單', async () => {
    const hiddenRepo = createFakeCpRepo({
      launch: { isPublic: false, bannedWords: [] },
      testers: ['uid_rep'],
      competitions: [competition({ id: 'cup', name: '內部示範盃' })],
    });
    const pendingActor: CpActor = { ...memberActor, uid: null, authPending: true, role: 'user' };
    const first = draw(
      <CpEnvProvider value={{ actor: pendingActor, repo: hiddenRepo, actions: idleActions(), now: NOW }}>
        <InAppSection />
      </CpEnvProvider>,
    );
    expect(first.container.textContent ?? '').not.toContain('站內賽事');
    expect(first.container.textContent ?? '').not.toContain('尚未對外');
    first.unmount();

    const tester: CpActor = { ...repActor, authPending: false };
    draw(
      <CpEnvProvider value={{ actor: tester, repo: hiddenRepo, actions: idleActions(), now: NOW }}>
        <InAppSection />
      </CpEnvProvider>,
    );
    expect(await screen.findByText('站內賽事')).toBeTruthy();
    expect(await screen.findByRole('button', { name: '建立賽事' })).toBeTruthy();

    cleanup();
    const publicRepo = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      mine: { uid_rep: [{ id: 'mine_cup', cid: 'cup', roles: ['rep'], host: false }] },
      competitions: [
        competition({ id: 'cup', name: '示範盃' }),
        competition({ id: 'open_cup', name: '公開示範盃', hostType: 'personal', hostTeamId: null, hostDisplay: '王示範', feeNote: null }),
      ],
    });
    const listed = draw(
      <CpEnvProvider value={{ actor: repActor, repo: publicRepo, actions: idleActions(), now: NOW }}>
        <InAppSection />
      </CpEnvProvider>,
    );
    expect(await screen.findByText('我的賽事')).toBeTruthy();
    expect(await screen.findByText('公開清單')).toBeTruthy();
    const mineLink = listed.container.querySelector('a[href="/competitions/cup"]');
    const publicLink = listed.container.querySelector('a[href="/competitions/open_cup"]');
    expect(mineLink?.textContent).toContain('示範盃');
    expect(publicLink?.textContent).toContain('公開示範盃');
    expect(listed.container.querySelectorAll('a[href="/competitions/cup"]').length).toBe(1);
  });

  it('只有一個俱樂部、從空白開始會帶入那個俱樂部；沒有俱樂部不顯示選項；晚到也會補', async () => {
    const only = mount(NewCompetitionPage, {
      ...screenEnv('wizard-1'),
      actor: { ...wizardActor, repClubs: [{ id: 'only_club', name: '唯一隊' }], managedClubs: [] },
      preview: { wizardStep: 1 },
      wizardSeed: { ...wizardSeed(), hostType: 'personal', hostTeamId: '' },
    });
    expect(screen.queryByLabelText('俱樂部')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '我管理的俱樂部' }));
    await waitFor(() => expect((screen.getByLabelText('俱樂部') as HTMLSelectElement).value).toBe('only_club'));
    only.unmount();

    const none = mount(NewCompetitionPage, {
      ...screenEnv('wizard-1'),
      actor: { ...wizardActor, repClubs: [], managedClubs: [] },
      preview: { wizardStep: 1 },
      wizardSeed: { ...wizardSeed(), hostType: 'personal', hostTeamId: '' },
    });
    expect(screen.queryByRole('radio', { name: '我管理的俱樂部' })).toBeNull();
    none.unmount();

    let clubs: { id: string; name: string }[] = [];
    const lateEnv = () => ({
      ...screenEnv('wizard-1'),
      actor: { ...wizardActor, repClubs: clubs, managedClubs: [] },
      preview: { wizardStep: 1 as const, wizardClub: true },
      wizardSeed: { ...wizardSeed(), hostType: 'club' as const, hostTeamId: '' },
    });
    const late = mount(NewCompetitionPage, lateEnv());
    expect(screen.queryByRole('radio', { name: '我管理的俱樂部' })).toBeNull();
    clubs = [{ id: 'late_club', name: '晚到隊' }];
    late.rerender(
      <LocationProvider>
        <CpEnvProvider value={lateEnv()}>
          <NewCompetitionPage />
          <AppConfirmHost />
        </CpEnvProvider>
      </LocationProvider>,
    );
    await waitFor(() => expect((screen.getByLabelText('俱樂部') as HTMLSelectElement).value).toBe('late_club'));
  });

  it('詳情頁 repClubs 晚到仍能以第一個俱樂部報隊', async () => {
    const actions = spyActions();
    const view = mount(CompetitionDetailPage, {
      ...screenEnv('detail-rep', actions),
      actor: { ...repActor, repClubs: [] },
    });
    expect(screen.queryByRole('button', { name: '以俱樂部報隊' })).toBeNull();
    const clubs = [
      { id: 'club_a', name: '示範隊A' },
      { id: 'club_b', name: '示範隊B' },
    ];
    view.rerender(
      <LocationProvider>
        <CpEnvProvider value={{ ...screenEnv('detail-rep', actions), actor: { ...repActor, repClubs: clubs } }}>
          <CompetitionDetailPage />
          <AppConfirmHost />
        </CpEnvProvider>
      </LocationProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '以俱樂部報隊' }));
    await waitFor(() => expect((screen.getByLabelText('俱樂部') as HTMLSelectElement).value).toBe('club_a'));
    fireEvent.click(screen.getByRole('button', { name: '送出報名' }));
    await waitFor(() => expect(actions.registerEntry).toHaveBeenCalledWith({
      cid: 'cup', dvId: 'dv_adult', teamId: 'club_a',
    }));
  });

  it('我的賽事併入俱樂部主辦的草稿；有名稱不再讀文件；單筆失敗不藏整區', async () => {
    const draftRepo = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      competitions: [
        competition({ id: 'draft_cup', name: '草稿盃', status: 'draft', hostTeamId: 'club_a', visibility: 'public' }),
        competition({ id: 'open_cup', name: '公開示範盃', hostType: 'personal', hostTeamId: null, hostDisplay: '王示範', feeNote: null }),
      ],
    });
    const drafted = draw(
      <CpEnvProvider value={{ actor: repActor, repo: draftRepo, actions: idleActions(), now: NOW }}>
        <InAppSection />
      </CpEnvProvider>,
    );
    expect((await screen.findByText('我的賽事')).parentElement?.textContent ?? '').toContain('草稿盃');
    expect(screen.getByText('公開清單').parentElement?.textContent ?? '').not.toContain('草稿盃');
    expect(screen.getByText('公開清單').parentElement?.textContent ?? '').toContain('公開示範盃');
    drafted.unmount();

    const namedBase = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      mine: { uid_rep: [{ id: 'm1', cid: 'named', roles: ['host'], host: true, name: '已有名稱盃' }] },
    });
    let reads = 0;
    const namedRepo = {
      ...namedBase,
      getCompetition: async (cid: string) => {
        reads += 1;
        return namedBase.getCompetition(cid);
      },
    };
    draw(
      <CpEnvProvider value={{ actor: repActor, repo: namedRepo, actions: idleActions(), now: NOW }}>
        <InAppSection />
      </CpEnvProvider>,
    );
    expect(await screen.findByText('已有名稱盃')).toBeTruthy();
    expect(reads).toBe(0);

    cleanup();
    const mixedBase = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      mine: {
        uid_rep: [
          { id: 'a', cid: 'good', roles: ['player'], host: false },
          { id: 'b', cid: 'bad', roles: ['player'], host: false },
        ],
      },
      competitions: [competition({ id: 'good', name: '存活盃' })],
    });
    const mixedRepo = {
      ...mixedBase,
      getCompetition: async (cid: string) => {
        if (cid === 'bad') throw new Error('讀取失敗');
        return mixedBase.getCompetition(cid);
      },
    };
    const mixed = draw(
      <CpEnvProvider value={{ actor: repActor, repo: mixedRepo, actions: idleActions(), now: NOW }}>
        <InAppSection />
      </CpEnvProvider>,
    );
    expect(await screen.findByText('存活盃')).toBeTruthy();
    expect(mixed.container.textContent ?? '').toContain('站內賽事');
    expect(mixed.container.textContent ?? '').not.toContain('bad');
  });

  it('內部期的測試者與管理員看得到內部賽，一般會員看不到', async () => {
    const repo = createFakeCpRepo({
      launch: { isPublic: false, bannedWords: [] },
      testers: [memberActor.uid ?? ''],
      competitions: [competition({ id: 'inner', name: '內部盃', visibility: 'internal' })],
    });
    draw(
      <CpEnvProvider value={{ actor: memberActor, repo, actions: idleActions(), now: NOW }}>
        <InAppSection />
      </CpEnvProvider>,
    );
    expect(await screen.findByText('內部盃')).toBeTruthy();

    cleanup();
    let saw = false;
    const hiddenRepo = {
      ...repo,
      getLaunch: async () => {
        saw = true;
        return repo.getLaunch();
      },
    };
    const outsider = draw(
      <CpEnvProvider value={{
        actor: { ...memberActor, uid: 'uid_other' },
        repo: hiddenRepo,
        actions: idleActions(),
        now: NOW,
      }}
      >
        <InAppSection />
      </CpEnvProvider>,
    );
    await waitFor(() => expect(saw).toBe(true));
    await expect(screen.findByText('內部盃', {}, { timeout: 400 })).rejects.toThrow();
    expect(outsider.container.textContent ?? '').not.toContain('站內賽事');

    cleanup();
    draw(
      <CpEnvProvider value={{ actor: adminActor, repo, actions: idleActions(), now: NOW }}>
        <InAppSection />
      </CpEnvProvider>,
    );
    expect(await screen.findByText('內部盃')).toBeTruthy();
  });

  it('管理頁等 repClubs 到了才讀得到聯絡人', async () => {
    const repo = createFakeCpRepo({
      competitions: [competition({ id: 'cup', hostTeamId: 'club_host' })],
      divisions: { cup: [adultDivision] },
      entries: {
        cup: [{
          id: 'en_pa', name: '示範隊A', status: 'pending', dvId: 'dv_adult', teamId: 'club_1',
          rosterCount: 0, rosterConfirmed: false,
        }],
      },
      entryPrivate: {
        cup: [{
          id: 'en_pa', teamId: 'club_1', contactName: '王聯絡', contactPhone: null,
          paymentStatus: 'none', reviewNote: null,
        }],
      },
    });
    const envFor = (clubs: { id: string; name: string }[]) => ({
      actor: { ...clubRepActor, repClubs: clubs },
      repo,
      actions: idleActions(),
      now: NOW,
      route: { cid: 'cup' },
    });
    const view = mount(CompetitionManagePage, envFor([]));
    expect(await screen.findByText('示範盃')).toBeTruthy();
    expect(view.container.textContent ?? '').not.toContain('王聯絡');
    view.rerender(
      <LocationProvider>
        <CpEnvProvider value={envFor([{ id: 'club_host', name: '示範俱樂部' }])}>
          <CompetitionManagePage />
          <AppConfirmHost />
        </CpEnvProvider>
      </LocationProvider>,
    );
    expect(await screen.findByText('王聯絡')).toBeTruthy();
  });

  it('發布成功後重讀；失敗只顯示通用文案', async () => {
    let published = false;
    const baseRepo = createFakeCpRepo({
      competitions: [competition({ id: 'cup', name: '示範盃', status: 'draft' })],
      divisions: { cup: [adultDivision] },
      entries: { cup: [] },
    });
    const repo = {
      ...baseRepo,
      getCompetition: async (cid: string) => {
        const doc = await baseRepo.getCompetition(cid);
        if (!doc) return null;
        return published
          ? { ...doc, status: 'published' as const, name: '已發布盃' }
          : { ...doc, status: 'draft' as const };
      },
    };
    const actions = spyActions();
    actions.publish.mockImplementation(async () => {
      published = true;
      return { cid: 'cup', status: 'published' as const };
    });
    const view = mount(CompetitionDetailPage, {
      actor: clubRepActor, repo, actions, now: NOW, route: { cid: 'cup' },
    });
    expect(await screen.findByRole('button', { name: '發布' })).toBeTruthy();
    expect(view.container.textContent ?? '').toContain('草稿');
    fireEvent.click(screen.getByRole('button', { name: '發布' }));
    await waitFor(() => expect(view.container.textContent ?? '').toContain('已發布盃'));
    expect(view.container.textContent ?? '').not.toContain('草稿');
    view.unmount();

    const fail = spyActions();
    fail.publish.mockRejectedValue(new CpCallError('NOT_A_REAL_CODE', {}));
    const failed = mount(CompetitionDetailPage, {
      actor: clubRepActor, repo: baseRepo, actions: fail, now: NOW, route: { cid: 'cup' },
    });
    fireEvent.click(await screen.findByRole('button', { name: '發布' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(failed.container.textContent ?? '').toContain('操作失敗，請稍後再試');
    expect(failed.container.textContent ?? '').not.toContain('NOT_A_REAL_CODE');
  });

  it('詳情組別標籤跟報名期間走，不固定寫招募中', () => {
    const early = mount(CompetitionDetailPage, { ...screenEnv('detail-rep'), now: REG_OPEN - 1 });
    expect(early.container.textContent ?? '').toContain('報名尚未開始');
    expect(early.container.textContent ?? '').not.toContain('招募中');
    early.unmount();

    const env = screenEnv('detail-rep');
    if (env.bundle?.competition) {
      env.bundle = { ...env.bundle, competition: { ...env.bundle.competition, status: 'postponed' } };
    }
    const postponed = mount(CompetitionDetailPage, env);
    expect(postponed.container.textContent ?? '').toContain('延期');
    expect(postponed.container.textContent ?? '').not.toContain('招募中');
  });

  it('名單頁標籤依報隊狀態；代表任何狀態都有代填入口；刪除先確認並把名單改回未確認', async () => {
    const pending = screenEnv('roster');
    pending.actor = memberActor;
    if (pending.bundle) {
      pending.bundle = {
        ...pending.bundle,
        entries: pending.bundle.entries.map((row) => ({ ...row, status: 'pending' as const })),
      };
    }
    const member = mount(RosterPage, pending);
    expect(member.container.textContent ?? '').toContain('待審');
    expect(screen.getByRole('button', { name: '登錄名單' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '代為新增球員' })).toBeNull();
    member.unmount();

    const rejected = screenEnv('roster');
    if (rejected.bundle) {
      rejected.bundle = {
        ...rejected.bundle,
        entries: rejected.bundle.entries.map((row) => ({ ...row, status: 'rejected' as const })),
      };
    }
    const repView = mount(RosterPage, rejected);
    expect(repView.container.textContent ?? '').toContain('已拒絕');
    expect(screen.getByRole('button', { name: '代為新增球員' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '登錄名單' })).toBeNull();
    repView.unmount();

    const started = mount(RosterPage, { ...screenEnv('roster'), now: FIRST_MATCH });
    expect(screen.queryByRole('button', { name: '代為新增球員' })).toBeNull();
    started.unmount();

    const actions = spyActions();
    const confirmed = screenEnv('roster', actions);
    if (confirmed.bundle) {
      confirmed.bundle = {
        ...confirmed.bundle,
        entries: confirmed.bundle.entries.map((row) => (
          row.id === 'en_a' ? { ...row, rosterConfirmed: true } : row
        )),
      };
    }
    const roster = mount(RosterPage, confirmed);
    expect(roster.container.textContent ?? '').toContain('名單已確認');
    fireEvent.click(screen.getByRole('button', { name: '移除 王示範' }));
    expect(screen.getByRole('alertdialog').textContent ?? '').toContain('確定要移除 王示範？');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(actions.leaveRoster).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移除 王示範' }));
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    await waitFor(() => expect(actions.leaveRoster).toHaveBeenCalledWith({ cid: 'cup', plId: 'pl_1' }));
    expect(roster.container.textContent ?? '').toContain('名單未確認');
    expect(roster.container.textContent ?? '').not.toContain('名單已確認');
  });

  it('登錄表單不符資格時顯示原因與回名單連結，不畫表單', () => {
    const stranger = screenEnv('form-self-adult');
    stranger.actor = { ...memberActor, memberClubIds: [] };
    const blocked = mount(JoinRosterPage, stranger);
    expect(blocked.container.textContent ?? '').toContain('只有俱樂部成員可以做這個操作');
    expect(screen.getByRole('link', { name: '返回名單' }).getAttribute('href')).toBe('/competitions/cup/entries/en_a');
    expect(screen.queryByLabelText('背號')).toBeNull();
    blocked.unmount();

    const closed = screenEnv('form-self-adult');
    if (closed.bundle) {
      closed.bundle = {
        ...closed.bundle,
        entries: closed.bundle.entries.map((row) => ({ ...row, status: 'rejected' as const })),
      };
    }
    const rejected = mount(JoinRosterPage, closed);
    expect(rejected.container.textContent ?? '').toContain('這份報隊目前不能登錄名單');
    expect(screen.queryByLabelText('暱稱')).toBeNull();
    rejected.unmount();

    const notRep = mount(AddRosterPage, { ...screenEnv('form-rep'), actor: memberActor });
    expect(notRep.container.textContent ?? '').toContain('只有俱樂部代表可以做這個操作');
    expect(screen.queryByLabelText('真實姓名')).toBeNull();
    notRep.unmount();

    const lockedEnv = screenEnv('form-self-adult');
    if (lockedEnv.bundle?.competition) {
      lockedEnv.bundle = {
        ...lockedEnv.bundle,
        competition: { ...lockedEnv.bundle.competition, rostersLockedAt: NOW },
      };
    }
    const locked = mount(JoinRosterPage, lockedEnv);
    expect(locked.container.textContent ?? '').toContain('名單已鎖定，不能再修改');
    locked.unmount();

    const started = mount(JoinRosterPage, { ...screenEnv('form-self-adult'), now: FIRST_MATCH });
    expect(started.container.textContent ?? '').toContain('賽事已開始，不能再改');
  });

  it('自訂位置超過 5 字、拒絕原因不足 2 字會擋下；底部面板重開會清掉自己的錯誤', async () => {
    mount(JoinRosterPage, screenEnv('form-self-adult'));
    fireEvent.click(screen.getByRole('button', { name: '自訂' }));
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '字數須介於 1 與 5 之間');
    cleanup();

    const actions = spyActions();
    mount(CompetitionManagePage, screenEnv('host-pending', actions));
    fireEvent.click(screen.getAllByRole('button', { name: '拒絕', exact: true })[0]!);
    fireEvent.input(screen.getByLabelText(/拒絕原因/), { target: { value: '短' } });
    fireEvent.click(screen.getByRole('button', { name: '確認拒絕' }));
    expect((await screen.findByRole('alert')).textContent).toBe('字數須介於 2 與 200 之間');
    expect(actions.review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getAllByRole('button', { name: '拒絕', exact: true })[0]!);
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    mount(CompetitionManagePage, screenEnv('host-unlock', actions));
    fireEvent.input(screen.getByLabelText(/解鎖原因/), { target: { value: '短' } });
    fireEvent.click(screen.getByRole('button', { name: '確認解鎖' }));
    expect((await screen.findByRole('alert')).textContent).toBe('字數須介於 2 與 200 之間');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '解鎖名單' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('核准後畫面上的組別已核准數加一', async () => {
    const actions = spyActions();
    const view = mount(CompetitionManagePage, screenEnv('host-pending', actions));
    expect(view.container.textContent ?? '').toContain('已核准 2／8 隊');
    fireEvent.click(screen.getAllByRole('button', { name: '核准' })[0]!);
    await waitFor(() => expect(actions.review).toHaveBeenCalledWith({
      cid: 'cup', enId: 'en_pa', decision: 'approve',
    }));
    expect(view.container.textContent ?? '').toContain('已核准 3／8 隊');
    expect(view.container.textContent ?? '').not.toContain('已核准 2／8 隊');
  });

  it('首場不在未來時精靈步驟 1 顯示時間不能早於現在', async () => {
    mount(NewCompetitionPage, { ...screenEnv('wizard-1'), now: FIRST_MATCH });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect((await screen.findByRole('alert')).textContent).toBe('時間不能早於現在');
  });

  it('生日載入前不顯示成年欄位', async () => {
    let resolveBirthday: (value: string | null) => void = () => {};
    birthdayBox.load = () => new Promise((resolve) => {
      resolveBirthday = resolve;
    });
    const waiting = mount(JoinRosterPage, { ...screenEnv('form-self-adult'), preview: undefined });
    expect(screen.getByRole('status', { name: '載入中…' })).toBeTruthy();
    expect(screen.queryByLabelText('暱稱')).toBeNull();
    expect(screen.queryByLabelText('真實姓名')).toBeNull();
    resolveBirthday('1990-05-20');
    expect(await screen.findByLabelText('暱稱')).toBeTruthy();
    expect(screen.queryByLabelText('真實姓名')).toBeNull();
    expect(waiting.container.textContent ?? '').toContain('我了解名單會公開我的顯示名稱與背號');
    waiting.unmount();

    let resolveMinor: (value: string | null) => void = () => {};
    birthdayBox.load = () => new Promise((resolve) => {
      resolveMinor = resolve;
    });
    mount(JoinRosterPage, { ...screenEnv('form-self-minor'), preview: undefined });
    expect(screen.queryByRole('textbox', { name: /暱稱/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /真實姓名/ })).toBeNull();
    resolveMinor('2016-05-20');
    expect(await screen.findByRole('textbox', { name: /真實姓名/ })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /暱稱/ })).toBeNull();
  });

  it('檢舉面板關掉再打開不會留下上一次的錯誤', async () => {
    mount(CompetitionDetailPage, screenEnv('detail-report'));
    fireEvent.click(screen.getByRole('radio', { name: '其他' }));
    fireEvent.click(screen.getByRole('button', { name: '送出檢舉' }));
    expect((await screen.findByRole('alert')).textContent).toBe('還有必填項目沒填');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '檢舉' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
