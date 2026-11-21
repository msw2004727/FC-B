import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentChildren, ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPETITIONS_ENABLED, FEATURE_OVERRIDES } from '@/feature-overrides';
import { ALL_FEATURES } from '@/features.config';
import { _resetForTest, getActiveRoutes, registerFeatures } from '@/core/feature-registry';
import { competitionRoutes } from '../index';
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
import { loadCompetitionsDict } from '../i18n';
import cpZh from '../locales-lazy/zh-TW.json';
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

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

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
    update: vi.fn(actions.update),
    generateSchedule: vi.fn(actions.generateSchedule),
    clearSchedule: vi.fn(actions.clearSchedule),
    rescheduleMatch: vi.fn(actions.rescheduleMatch),
    shiftMatchDay: vi.fn(actions.shiftMatchDay),
    swapMatches: vi.fn(actions.swapMatches),
    postNotice: vi.fn(actions.postNotice),
    deleteNotice: vi.fn(actions.deleteNotice),
    recordResult: vi.fn(actions.recordResult),
    confirmMatchResult: vi.fn(actions.confirmMatchResult),
    setWalkover: vi.fn(actions.setWalkover),
    resetMatch: vi.fn(actions.resetMatch),
    cancelMatch: vi.fn(actions.cancelMatch),
    endCompetition: vi.fn(actions.endCompetition),
    restoreCompetition: vi.fn(actions.restoreCompetition),
    resolveTie: vi.fn(actions.resolveTie),
    clearTieDecision: vi.fn(actions.clearTieDecision),
    explainTie: vi.fn(actions.explainTie),
    assignStaff: vi.fn(actions.assignStaff),
    removeStaff: vi.fn(actions.removeStaff),
    createInvite: vi.fn(actions.createInvite),
    revokeInvite: vi.fn(actions.revokeInvite),
    acceptInvite: vi.fn(actions.acceptInvite),
    moderate: vi.fn(actions.moderate),
    reviewReport: vi.fn(actions.reviewReport),
    deleteCompetition: vi.fn(actions.deleteCompetition),
  };
}

const TWO_CLUBS = [
  { id: 'club_a', name: '示範隊A' },
  { id: 'club_b', name: '示範隊B' },
];

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
  it('建置期開關決定 /competitions 路由是否啟用', () => {
    FEATURE_OVERRIDES.competitions = COMPETITIONS_ENABLED;
    registerFeatures(ALL_FEATURES);
    const paths = getActiveRoutes().map((route) => route.path).filter((path) => path.startsWith('/competitions'));
    if (COMPETITIONS_ENABLED) {
      expect(paths).toEqual(competitionRoutes().map((route) => route.path));
    } else {
      expect(paths).toEqual([]);
    }
  });

  it('每個預覽畫面都畫得出標題，而且不出現英文 reason 代碼', () => {
    for (const name of HARNESS_SCREENS) {
      const view = mount(PAGES[name] ?? NewCompetitionPage, screenEnv(name));
      expect(view.container.querySelector('.cps-root'), name).toBeTruthy();
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

  it('報名費只限俱樂部主辦（顧問 §3.257）：個人主辦不顯示費用欄、線上支付鈕、繳費標籤與開關', () => {
    const wizard = mount(NewCompetitionPage, screenEnv('wizard-2'));
    expect(wizard.container.textContent ?? '').not.toContain('每隊報名費');
    cleanup();
    mount(CompetitionDetailPage, { ...screenEnv('detail-personal') });
    expect(screen.queryAllByRole('button', { name: /線上支付/ })).toHaveLength(0);
    cleanup();
    mount(CompetitionManagePage, { ...screenEnv('host-approved-personal') });
    expect(screen.queryAllByRole('button', { name: /線上支付/ })).toHaveLength(0);
    expect(screen.queryAllByRole('switch', { name: '標示已繳費' })).toHaveLength(0);
    expect(document.body.textContent ?? '').not.toMatch(/未繳費|已繳費/);
  });

  it('聯絡文字（顧問 §3.292）：個人主辦建賽提示「沒填的話觀眾無法聯絡你」，俱樂部主辦不提示；都註明會公開顯示', () => {
    const personal = mount(NewCompetitionPage, screenEnv('wizard-1'));
    expect(personal.container.textContent ?? '').toContain('會公開顯示');
    expect(personal.container.textContent ?? '').toContain('沒填的話觀眾無法聯絡你');
    cleanup();
    const club = mount(NewCompetitionPage, screenEnv('wizard-1-club'));
    expect(club.container.textContent ?? '').toContain('會公開顯示');
    expect(club.container.textContent ?? '').not.toContain('沒填的話觀眾無法聯絡你');
  });

  it('整場取消、沒有冠軍時不出現「冠軍」卡；已結束有冠軍時照常顯示', async () => {
    const cancelled = mount(CompetitionDetailPage, screenEnv('real-cancelled-comp'));
    expect(await screen.findByText(/報名隊伍不足/)).toBeTruthy();
    expect(cancelled.container.textContent ?? '').not.toContain('冠軍');
    // 上方原因卡已標「已取消」，下面不再多一張只剩標籤的空卡（顧問 §3.294 P3）
    expect(screen.getAllByText('已取消')).toHaveLength(1);
    cleanup();
    mount(CompetitionDetailPage, screenEnv('real-done'));
    expect(await screen.findByText('冠軍')).toBeTruthy();
  });

  it('線上支付鈕沒有行為；標示已繳費才呼叫 setPaymentStatus', async () => {
    const actions = spyActions();
    mount(CompetitionManagePage, { ...screenEnv('host-approved', actions) });
    const pay = screen.getAllByRole('button', { name: '線上支付（未開放）' });
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

  it('成年自己登錄：組別要求真名才顯示並送出，不要求時不送', async () => {
    const required = spyActions();
    const env = screenEnv('form-self-adult', required);
    if (env.bundle) {
      env.bundle = {
        ...env.bundle,
        divisions: env.bundle.divisions.map((row) => ({ ...row, requireRealName: true })),
      };
    }
    const view = mount(JoinRosterPage, env);
    expect(screen.getByRole('textbox', { name: /真實姓名/ })).toBeTruthy();
    expect(view.container.textContent ?? '').toContain('真實姓名僅供主辦核對資格，不會公開。');
    expect(view.container.textContent ?? '').not.toContain('公開顯示：');
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    expect((await screen.findByRole('alert')).textContent).toBe('請填寫真實姓名');
    expect(required.joinRoster).not.toHaveBeenCalled();
    fireEvent.input(screen.getByRole('textbox', { name: /真實姓名/ }), { target: { value: '王小範' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '我了解名單會公開顯示暱稱與背號' }));
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(required.joinRoster).toHaveBeenCalledWith({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', nickname: '阿範',
      realName: '王小範', privacyAck: true,
    }));
    expect(required.joinRoster.mock.calls[0]?.[0]).not.toHaveProperty('publicName');

    cleanup();
    const optional = spyActions();
    mount(JoinRosterPage, { ...screenEnv('form-self-adult', optional) });
    expect(screen.queryByRole('textbox', { name: /真實姓名/ })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: '我了解名單會公開顯示暱稱與背號' }));
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(optional.joinRoster).toHaveBeenCalled());
    expect(optional.joinRoster.mock.calls[0]?.[0]).not.toHaveProperty('realName');
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
    expect(first.container.textContent ?? '').not.toContain('只看我的');
    expect(first.container.textContent ?? '').not.toContain('尚未對外');
    first.unmount();

    const tester: CpActor = { ...repActor, authPending: false };
    draw(
      <CpEnvProvider value={{ actor: tester, repo: hiddenRepo, actions: idleActions(), now: NOW }}>
        <InAppSection />
      </CpEnvProvider>,
    );
    expect(await screen.findByText('內部示範盃')).toBeTruthy();
    expect(screen.getByText('只看我的')).toBeTruthy();
    expect(await screen.findByRole('button', { name: '建立賽事' })).toBeTruthy();

    cleanup();
    const publicRepo = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      mine: { uid_rep: [{ id: 'mine_cup', cid: 'cup', roles: ['rep'], host: false, category: 'league' }] },
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
    expect(await screen.findByText('示範盃')).toBeTruthy();
    expect(screen.getByText('公開示範盃')).toBeTruthy();
    const mineLink = listed.container.querySelector('a[href="/competitions/cup"]');
    const publicLink = listed.container.querySelector('a[href="/competitions/open_cup"]');
    expect(mineLink?.textContent).toContain('示範盃');
    expect(publicLink?.textContent).toContain('公開示範盃');
    expect(listed.container.querySelectorAll('a[href="/competitions/cup"]').length).toBe(1);
    fireEvent.click(screen.getByRole('checkbox', { name: '只看我的' }));
    expect(listed.container.textContent ?? '').toContain('示範盃');
    expect(listed.container.textContent ?? '').not.toContain('公開示範盃');
  });

  it('只有一個俱樂部、從空白開始會帶入那個俱樂部；沒有俱樂部不顯示選項；晚到也會補', async () => {
    // 建賽的俱樂部欄是必填，標籤後面多「* 必填」：用開頭比對（不會對到「我管理的俱樂部」選項）
    const only = mount(NewCompetitionPage, {
      ...screenEnv('wizard-1'),
      actor: { ...wizardActor, repClubs: [{ id: 'only_club', name: '唯一隊' }] },
      preview: { wizardStep: 1 },
      wizardSeed: { ...wizardSeed(), hostType: 'personal', hostTeamId: '' },
    });
    expect(screen.queryByLabelText(/^俱樂部/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '我管理的俱樂部' }));
    await waitFor(() => expect((screen.getByLabelText(/^俱樂部/) as HTMLSelectElement).value).toBe('only_club'));
    only.unmount();

    const none = mount(NewCompetitionPage, {
      ...screenEnv('wizard-1'),
      actor: { ...wizardActor, repClubs: [] },
      preview: { wizardStep: 1 },
      wizardSeed: { ...wizardSeed(), hostType: 'personal', hostTeamId: '' },
    });
    expect(screen.queryByRole('radio', { name: '我管理的俱樂部' })).toBeNull();
    none.unmount();

    let clubs: { id: string; name: string }[] = [];
    const lateEnv = () => ({
      ...screenEnv('wizard-1'),
      actor: { ...wizardActor, repClubs: clubs, repClubsPending: clubs.length === 0 },
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
    await waitFor(() => expect((screen.getByLabelText(/^俱樂部/) as HTMLSelectElement).value).toBe('late_club'));
  });

  it('建賽選了俱樂部但沒有可用俱樂部時改回個人', async () => {
    mount(NewCompetitionPage, {
      ...screenEnv('wizard-1'),
      actor: { ...wizardActor, repClubs: [] },
      preview: { wizardStep: 1, wizardClub: true },
      wizardSeed: { ...wizardSeed(), hostType: 'club', hostTeamId: '' },
    });
    await waitFor(() => {
      expect((screen.getByRole('radio', { name: '個人' }) as HTMLInputElement).checked).toBe(true);
    });
    expect(screen.queryByRole('radio', { name: '我管理的俱樂部' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByText('組別')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('詳情頁 repClubs 晚到：只有一個俱樂部自動帶入，兩個以上不預選', async () => {
    const actions = spyActions();
    const envWith = (clubs: { id: string; name: string }[]) => ({
      ...screenEnv('detail-rep', actions),
      actor: { ...repActor, repClubs: clubs },
    });
    const redraw = (view: ReturnType<typeof mount>, clubs: { id: string; name: string }[]) => view.rerender(
      <LocationProvider>
        <CpEnvProvider value={envWith(clubs)}>
          <CompetitionDetailPage />
          <AppConfirmHost />
        </CpEnvProvider>
      </LocationProvider>,
    );
    const view = mount(CompetitionDetailPage, envWith([]));
    expect(screen.queryByRole('button', { name: '以俱樂部報隊' })).toBeNull();
    redraw(view, [{ id: 'club_b', name: '示範隊B' }]);
    fireEvent.click(await screen.findByRole('button', { name: '以俱樂部報隊' }));
    expect(screen.queryByLabelText('俱樂部')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '送出報名' }));
    await waitFor(() => expect(actions.registerEntry).toHaveBeenCalledWith({
      cid: 'cup', dvId: 'dv_adult', teamId: 'club_b',
    }));

    cleanup();
    const late = mount(CompetitionDetailPage, envWith([]));
    redraw(late, TWO_CLUBS);
    fireEvent.click(await screen.findByRole('button', { name: '以俱樂部報隊' }));
    expect((screen.getByLabelText('俱樂部') as HTMLSelectElement).value).toBe('');
  });

  describe('報隊面板選俱樂部（開放前）', () => {
    let toastShow: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      // 前面測試留下的彈窗返回紀錄會在這裡退掉面板；先清乾淨。
      _resetOverlayBackForTest();
      toastShow = vi.spyOn(toast, 'show').mockImplementation(() => 1);
    });
    afterEach(() => {
      toastShow.mockRestore();
    });

    const twoClubEnv = (actions: ReturnType<typeof spyActions>) => ({
      ...screenEnv('detail-rep', actions),
      actor: { ...repActor, repClubs: TWO_CLUBS },
    });
    const clubSelect = () => screen.getByLabelText('俱樂部') as HTMLSelectElement;
    const fieldError = () => document.querySelector('[data-field-error]');
    // BottomSheet 在 portal 裡，fireEvent.change 會被改送成 input；照 host-ops 的做法直接發原生 change。
    const pickClub = async (value: string) => {
      const select = clubSelect();
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      // 受控元件會先退回舊值，等父層重繪後才是新值。
      await new Promise((resolve) => setTimeout(resolve, 0));
      await waitFor(() => expect(clubSelect().value).toBe(value));
    };

    it('只代表一個俱樂部：不顯示下拉、自動帶入並送出，成功跳提示', async () => {
      const actions = spyActions();
      mount(CompetitionDetailPage, screenEnv('detail-rep', actions));
      fireEvent.click(screen.getByRole('button', { name: '以俱樂部報隊' }));
      expect(screen.queryByLabelText('俱樂部')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '送出報名' }));
      await waitFor(() => expect(actions.registerEntry).toHaveBeenCalledWith({
        cid: 'cup', dvId: 'dv_adult', teamId: 'club_a',
      }));
      await waitFor(() => expect(toastShow).toHaveBeenCalledWith({ message: '已送出報隊，等主辦審核', tone: 'success' }));
    });

    it('兩個俱樂部：預設空白、第一項是停用的請選擇；沒選送出不呼叫後端並在欄位顯示必選', async () => {
      const actions = spyActions();
      mount(CompetitionDetailPage, twoClubEnv(actions));
      fireEvent.click(screen.getByRole('button', { name: '以俱樂部報隊' }));
      const select = clubSelect();
      expect(select.value).toBe('');
      expect(select.options[0]?.label).toBe('請選擇俱樂部');
      expect(select.options[0]?.disabled).toBe(true);
      expect(Array.from(select.options).map((option) => option.value)).toEqual(['', 'club_a', 'club_b']);
      fireEvent.click(screen.getByRole('button', { name: '送出報名' }));
      await waitFor(() => expect(clubSelect().getAttribute('aria-invalid')).toBe('true'));
      expect(fieldError()?.textContent).toBe('還有必填項目沒填');
      expect(actions.registerEntry).not.toHaveBeenCalled();
      expect(toastShow).not.toHaveBeenCalled();
    });

    it('兩個俱樂部：選第二個就送第二個的 teamId，選了之後錯誤消失', async () => {
      const actions = spyActions();
      mount(CompetitionDetailPage, twoClubEnv(actions));
      fireEvent.click(screen.getByRole('button', { name: '以俱樂部報隊' }));
      fireEvent.click(screen.getByRole('button', { name: '送出報名' }));
      await waitFor(() => expect(fieldError()).toBeTruthy());
      await pickClub('club_b');
      await waitFor(() => expect(fieldError()).toBeNull());
      fireEvent.click(screen.getByRole('button', { name: '送出報名' }));
      await waitFor(() => expect(actions.registerEntry).toHaveBeenCalledWith({
        cid: 'cup', dvId: 'dv_adult', teamId: 'club_b',
      }));
      expect(actions.registerEntry).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(toastShow).toHaveBeenCalledWith({ message: '已送出報隊，等主辦審核', tone: 'success' }));
    });

    it('兩個俱樂部：關掉再打開面板，選擇與錯誤都重設', async () => {
      const actions = spyActions();
      mount(CompetitionDetailPage, twoClubEnv(actions));
      fireEvent.click(screen.getByRole('button', { name: '以俱樂部報隊' }));
      fireEvent.click(screen.getByRole('button', { name: '送出報名' }));
      await waitFor(() => expect(fieldError()).toBeTruthy());
      await pickClub('club_b');
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
      await waitFor(() => expect(screen.queryByLabelText('俱樂部')).toBeNull());
      fireEvent.click(screen.getByRole('button', { name: '以俱樂部報隊' }));
      expect(clubSelect().value).toBe('');
      expect(fieldError()).toBeNull();
      expect(actions.registerEntry).not.toHaveBeenCalled();
    });

    it('報隊失敗不跳成功提示，面板留著', async () => {
      const actions = spyActions();
      actions.registerEntry.mockRejectedValue(new CpCallError('NOT_A_REAL_CODE', {}));
      mount(CompetitionDetailPage, twoClubEnv(actions));
      fireEvent.click(screen.getByRole('button', { name: '以俱樂部報隊' }));
      await pickClub('club_a');
      fireEvent.click(screen.getByRole('button', { name: '送出報名' }));
      await waitFor(() => expect(actions.registerEntry).toHaveBeenCalledWith({
        cid: 'cup', dvId: 'dv_adult', teamId: 'club_a',
      }));
      await waitFor(() => expect(screen.getByRole('button', { name: '送出報名' }).hasAttribute('disabled')).toBe(false));
      expect(clubSelect()).toBeTruthy();
      expect(toastShow).not.toHaveBeenCalled();
    });
  });

  it('名單已鎖定：報隊管理頁沒按確認的隊也顯示名單已確認，未確認計數不算它（顧問 §3.450）', async () => {
    const lockedBundle = manageBundle({ uid: 'uid_host', roles: ['host'] }, true);
    const locked = mount(CompetitionManagePage, { ...screenEnv('host-approved'), bundle: lockedBundle });
    expect(locked.container.textContent ?? '').toContain('示範隊E');
    expect(locked.container.textContent ?? '').toContain('名單已確認');
    expect(locked.container.textContent ?? '').not.toContain('名單未確認');
    locked.unmount();

    const open = mount(CompetitionManagePage, screenEnv('host-approved'));
    expect(open.container.textContent ?? '').toContain('名單未確認');
    open.unmount();

    mount(CompetitionManagePage, { ...screenEnv('host-lock'), bundle: lockedBundle });
    // 顧問 §3.505 第 3 項：全部已確認時換一句，不寫「還有 0 隊」。
    const allDone = (await screen.findByRole('alertdialog')).textContent ?? '';
    expect(allDone).toContain('鎖定後各隊不能再改名單，確定？');
    expect(allDone).not.toContain('還有 0 隊');
    cleanup();
    _resetAppConfirmForTest();
    mount(CompetitionManagePage, screenEnv('host-lock'));
    expect((await screen.findByRole('alertdialog')).textContent ?? '').toContain('還有 1 隊尚未確認名單');
  });

  it('報隊管理三個分頁沒有隊伍時顯示空狀態，有隊伍時不顯示（顧問 §3.505 第 2 項）', () => {
    const empty = { ...manageBundle(), entries: [], privates: [] };
    for (const [tab, text] of [['pending', '目前沒有待審的隊伍'], ['approved', '目前沒有已核准的隊伍'], ['rejected', '目前沒有已拒絕的隊伍']] as const) {
      const none = mount(CompetitionManagePage, { ...screenEnv(`host-${tab}`), bundle: empty });
      // 設計審：包進玻璃卡、置中，與「目前沒有被指派的場次」同一種樣子（.cps-card > .s4b-mempty）。
      expect([...none.container.querySelectorAll('.cps-card > .s4b-mempty')].map((node) => node.textContent)).toContain(text);
      none.unmount();
      const some = mount(CompetitionManagePage, screenEnv(`host-${tab}`));
      expect(some.container.textContent ?? '').not.toContain(text);
      some.unmount();
    }
  });

  it('本隊名單照背號排，同號再比 id（顧問 §3.505 第 4 項）', () => {
    const env = screenEnv('roster');
    const roster = env.bundle!.roster;
    env.bundle = { ...env.bundle!, roster: [...roster, { ...roster[0]!, id: 'pl_0', number: 10, displayName: '同號示範' }] };
    const view = mount(RosterPage, env);
    const nums = [...view.container.querySelectorAll('[data-roster-row] .cps-num')].map((node) => node.textContent);
    expect(nums).toEqual(['7', '8', '9', '10', '10', '11']);
    const names = [...view.container.querySelectorAll('[data-roster-row] .cps-player__name')].map((node) => node.textContent);
    expect(names.slice(3, 5)).toEqual(['同號示範', '王示範']);
  });

  it('名單已確認時「確認名單」降成次要鈕、仍可按（顧問 §3.505 第 5 項）', () => {
    const open = mount(RosterPage, screenEnv('roster-ready'));
    expect(screen.getByRole('button', { name: '確認名單' }).className).toContain('ui-button--primary');
    open.unmount();

    const env = screenEnv('roster-ready');
    env.bundle = { ...env.bundle!, entries: env.bundle!.entries.map((row) => ({ ...row, rosterConfirmed: true })) };
    mount(RosterPage, env);
    const button = screen.getByRole('button', { name: '確認名單' });
    expect(button.className).toContain('ui-button--secondary');
    expect(button).toHaveProperty('disabled', false);
  });

  it('詳情頁比賽期間與抬頭同一種寫法，同一天只寫一次（顧問 §3.505 第 6 項）', () => {
    const periodOf = (root: Element): string => {
      const dt = [...root.querySelectorAll('.cps-row dt')].find((node) => node.textContent === '比賽期間');
      return (dt?.nextElementSibling?.textContent ?? '').trim();
    };
    const twoDays = mount(CompetitionDetailPage, screenEnv('detail-rep'));
    expect(periodOf(twoDays.container)).toBe('2027/01/09 – 01/10');
    twoDays.unmount();

    const env = screenEnv('detail-rep');
    env.bundle = { ...env.bundle!, competition: { ...env.bundle!.competition!, lastMatchAt: FIRST_MATCH + 4 * 60 * 60 * 1000 } };
    const oneDay = mount(CompetitionDetailPage, env);
    expect(periodOf(oneDay.container)).toBe('2027/01/09');
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
    expect(await screen.findByText('草稿盃')).toBeTruthy();
    expect(screen.getByText('公開示範盃')).toBeTruthy();
    expect(drafted.container.querySelectorAll('a[href="/competitions/draft_cup"]').length).toBe(1);
    fireEvent.click(screen.getByRole('checkbox', { name: '只看我的' }));
    expect(drafted.container.textContent ?? '').toContain('草稿盃');
    expect(drafted.container.textContent ?? '').not.toContain('公開示範盃');
    drafted.unmount();

    const namedBase = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      mine: { uid_rep: [{ id: 'm1', cid: 'named', roles: ['host'], host: true, name: '已有名稱盃', category: 'league' }] },
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
          { id: 'a', cid: 'good', roles: ['player'], host: false, category: 'league' },
          { id: 'b', cid: 'bad', roles: ['player'], host: false, category: 'league' },
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
    expect(mixed.container.textContent ?? '').toContain('只看我的');
    expect(mixed.container.textContent ?? '').not.toContain('bad');
  });

  it('俱樂部清單晚到只補讀主辦賽事，不重讀開賽、我的賽事、公開清單', async () => {
    let clubs: { id: string; name: string }[] = [];
    const base = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      competitions: [
        competition({ id: 'draft_cup', name: '草稿盃', status: 'draft', hostTeamId: 'club_a', visibility: 'public' }),
        competition({ id: 'open_cup', name: '公開示範盃', hostType: 'personal', hostTeamId: null, hostDisplay: '王示範', feeNote: null }),
      ],
    });
    const counts = { launch: 0, tester: 0, mine: 0, public: 0, host: 0 };
    const repo = {
      ...base,
      getLaunch: async () => {
        counts.launch += 1;
        return base.getLaunch();
      },
      getLaunchTester: async (uid: string) => {
        counts.tester += 1;
        return base.getLaunchTester(uid);
      },
      listMine: async (uid: string) => {
        counts.mine += 1;
        return base.listMine(uid);
      },
      listPublic: async (includeInternal?: boolean) => {
        counts.public += 1;
        return base.listPublic(includeInternal);
      },
      listByHostTeam: async (teamId: string, publicOnly: boolean) => {
        counts.host += 1;
        return base.listByHostTeam(teamId, publicOnly);
      },
    };
    const envFor = () => ({
      actor: { ...repActor, repClubs: clubs },
      repo,
      actions: idleActions(),
      now: NOW,
    });
    const view = draw(
      <CpEnvProvider value={envFor()}>
        <InAppSection />
      </CpEnvProvider>,
    );
    expect(await screen.findByText('公開示範盃')).toBeTruthy();
    await waitFor(() => expect(counts.launch).toBe(1));
    expect(counts.mine).toBe(1);
    expect(counts.public).toBe(1);
    expect(counts.tester).toBe(0);
    expect(counts.host).toBe(0);

    clubs = [{ id: 'club_a', name: '示範隊A' }];
    view.rerender(
      <LocationProvider>
        <CpEnvProvider value={envFor()}>
          <InAppSection />
        </CpEnvProvider>
      </LocationProvider>,
    );
    expect(await screen.findByText('草稿盃')).toBeTruthy();
    expect(view.container.querySelectorAll('a[href="/competitions/draft_cup"]').length).toBe(1);
    expect(view.container.textContent ?? '').toContain('公開示範盃');
    expect(counts.launch).toBe(1);
    expect(counts.mine).toBe(1);
    expect(counts.public).toBe(1);
    expect(counts.tester).toBe(0);
    expect(counts.host).toBe(1);
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
    expect(outsider.container.textContent ?? '').not.toContain('只看我的');

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
          rosterCount: 0, rosterConfirmed: false, teamLogo: null,
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
    const repOnly = screenEnv('form-self-adult');
    repOnly.actor = { ...memberActor, memberClubIds: [], repClubs: [{ id: 'club_a', name: '示範隊A' }] };
    const asRep = mount(JoinRosterPage, repOnly);
    expect(screen.getByLabelText('暱稱')).toBeTruthy();
    expect(asRep.container.textContent ?? '').not.toContain('只有俱樂部成員可以做這個操作');
    asRep.unmount();

    const stranger = screenEnv('form-self-adult');
    stranger.actor = { ...memberActor, memberClubIds: [] };
    const blocked = mount(JoinRosterPage, stranger);
    expect(blocked.container.textContent ?? '').toContain('只有俱樂部成員可以做這個操作');
    // 第 3 批小修（設計總監 05:08）：「返回名單」從連結改成整列寬次要鈕、句子中性色（原本斷言 role=link 與 href）
    const back = screen.getByRole('button', { name: '返回名單' });
    expect(back.className).toContain('ui-button--secondary');
    expect(screen.getByRole('alert').className).not.toContain('cps-warn');
    fireEvent.click(back);
    expect(window.location.pathname).toBe('/competitions/cup/entries/en_a');
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

  it('代表不是成員時自己登錄看得到表單並能送出', async () => {
    const actions = spyActions();
    const env = screenEnv('form-self-adult', actions);
    env.actor = { ...memberActor, memberClubIds: [], repClubs: [{ id: 'club_a', name: '示範隊A' }] };
    const view = mount(JoinRosterPage, env);
    expect(screen.getByLabelText('暱稱')).toBeTruthy();
    expect(view.container.textContent ?? '').not.toContain('只有俱樂部成員可以做這個操作');
    fireEvent.click(screen.getByRole('checkbox', { name: '我了解名單會公開顯示暱稱與背號' }));
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(actions.joinRoster).toHaveBeenCalled());
  });

  it('代表清單還沒到時自己登錄先顯示載入中，不判成不是成員', () => {
    const env = screenEnv('form-self-adult');
    env.actor = { ...memberActor, memberClubIds: [], repClubs: [], repClubsPending: true };
    const view = mount(JoinRosterPage, env);
    expect(view.container.querySelector('.ui-page-spinner')).toBeTruthy();
    expect(view.container.textContent ?? '').not.toContain('只有俱樂部成員可以做這個操作');
    expect(screen.queryByLabelText('暱稱')).toBeNull();
  });

  it('換帳號時站內賽事不留下上一個人的名稱', async () => {
    const repo = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      mine: {
        uid_a: [{ id: 'mine_a', cid: 'cup_a', roles: ['host'], host: true, name: '甲的賽事', category: 'league' }],
        uid_b: [{ id: 'mine_b', cid: 'cup_b', roles: ['host'], host: true, name: '乙的賽事', category: 'league' }],
      },
      competitions: [
        competition({ id: 'cup_a', name: '甲的賽事', visibility: 'unlisted' }),
        competition({ id: 'cup_b', name: '乙的賽事', visibility: 'unlisted' }),
      ],
    });
    const actorA: CpActor = { ...repActor, uid: 'uid_a' };
    const actorB: CpActor = { ...repActor, uid: 'uid_b', repClubs: [] };
    const view = draw(
      <CpEnvProvider value={{ actor: actorA, repo, actions: idleActions(), now: NOW }}>
        <InAppSection />
      </CpEnvProvider>,
    );
    expect(await screen.findByText('甲的賽事')).toBeTruthy();
    view.rerender(
      <LocationProvider>
        <CpEnvProvider value={{ actor: actorB, repo, actions: idleActions(), now: NOW }}>
          <InAppSection />
        </CpEnvProvider>
      </LocationProvider>,
    );
    expect(view.container.textContent ?? '').not.toContain('甲的賽事');
    expect(await screen.findByText('乙的賽事')).toBeTruthy();
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

  it('報隊管理矮板：待審與已核准兩格；讀到上限不放待審、沒有組別不放已核准，兩格都沒有就不放板（第 4 批 3.3）', () => {
    const view = mount(CompetitionManagePage, screenEnv('host-pending'));
    const cells = (root: Element) => [...root.querySelectorAll('.d2-sb--row .d2-cell__k')].map((el) => el.textContent);
    expect(cells(view.container)).toEqual(['待審', '已核准']);
    expect(view.container.querySelector('.d2-sb--row .d2-cells')?.getAttribute('aria-hidden')).toBe('true');
    expect(view.container.querySelector('.d2-sb--row .cps-vh')?.textContent ?? '').toContain('待審 ');
    view.unmount();

    const base = screenEnv('host-pending');
    const full = base.bundle ? {
      ...base.bundle,
      entries: Array.from({ length: 100 }, (_, i) => ({ ...base.bundle!.entries[0]!, id: `en_${i}` })),
    } : undefined;
    const atLimit = mount(CompetitionManagePage, { ...base, bundle: full });
    expect(cells(atLimit.container)).toEqual(['已核准']);
    atLimit.unmount();

    const noDiv = screenEnv('host-pending');
    const bare = mount(CompetitionManagePage, { ...noDiv, bundle: noDiv.bundle ? { ...noDiv.bundle, divisions: [] } : undefined });
    expect(cells(bare.container)).toEqual(['待審']);
    bare.unmount();

    const none = screenEnv('host-pending');
    const empty = mount(CompetitionManagePage, {
      ...none,
      bundle: none.bundle ? {
        ...none.bundle,
        divisions: [],
        entries: Array.from({ length: 100 }, (_, i) => ({ ...none.bundle!.entries[0]!, id: `en_${i}` })),
      } : undefined,
    });
    expect(empty.container.querySelector('.d2-sb--row')).toBeNull();
    expect(screen.getByRole('button', { name: '排賽程' })).toBeTruthy();
  });

  it('鎖定全部名單的確認框是危險確認：開著時掛紅框 class，預設焦點在取消（顧問 §3.465）', async () => {
    mount(CompetitionManagePage, { ...screenEnv('host-approved', spyActions()) });
    fireEvent.click(screen.getByRole('button', { name: '鎖定全部名單' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(document.documentElement.classList.contains('cp-danger-confirm')).toBe(true);
    await waitFor(() => expect(document.activeElement?.textContent ?? '').toBe('取消'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(document.documentElement.classList.contains('cp-danger-confirm')).toBe(false));
  });

  it('時間已過時精靈步驟 1 擋下：報名截止在首場之前，錯誤畫在截止欄並聚焦', () => {
    mount(NewCompetitionPage, { ...screenEnv('wizard-1'), now: FIRST_MATCH });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('步驟 1／3')).toBeTruthy();
    expect(document.getElementById('cp-reg-close-error')?.textContent).toBe('截止須晚於現在');
    expect(document.getElementById('cp-reg-close')?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement?.id).toBe('cp-reg-close');
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
