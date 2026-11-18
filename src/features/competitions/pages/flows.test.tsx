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
  NOW,
  adminActor,
  clubRepActor,
  coHostActor,
  competition,
  hostActor,
  idleActions,
  manageBundle,
  memberActor,
  repActor,
  screenEnv,
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
  'host-pending': CompetitionManagePage,
  'host-approved': CompetitionManagePage,
  'host-rejected': CompetitionManagePage,
  'host-reject': CompetitionManagePage,
  'host-lock': CompetitionManagePage,
  'host-unlock': CompetitionManagePage,
  'position-measure': RosterPage,
};

afterEach(() => {
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
    mount(JoinRosterPage, { ...screenEnv('form-self-adult', adult) });
    fireEvent.click(screen.getByRole('checkbox', { name: '我了解名單會公開顯示暱稱與背號' }));
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(adult.joinRoster).toHaveBeenCalledWith({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', nickname: '阿範', privacyAck: true,
    }));

    cleanup();
    const minor = spyActions();
    mount(JoinRosterPage, { ...screenEnv('form-self-minor', minor) });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(minor.joinRoster).toHaveBeenCalledWith({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', privacyAck: true,
      realName: '歐陽示範', publicName: '歐陽', guardianConsent: true,
    }));

    cleanup();
    const added = spyActions();
    mount(AddRosterPage, { ...screenEnv('form-rep', added) });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    await waitFor(() => expect(added.addRosterByRep).toHaveBeenCalledWith({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', privacyAck: true,
      realName: '歐陽示範', publicName: '歐陽', guardianConsent: true, birthday: '2016-05-20',
    }));

    cleanup();
    const repAdult = spyActions();
    mount(AddRosterPage, { ...screenEnv('form-rep-adult', repAdult) });
    fireEvent.click(screen.getByRole('checkbox', { name: '我了解名單會公開顯示暱稱與背號' }));
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    await waitFor(() => expect(repAdult.addRosterByRep).toHaveBeenCalledWith({
      cid: 'cup', enId: 'en_a', number: 10, position: 'MF', privacyAck: true,
      realName: '王示範', publicName: '王', birthday: '1990-05-20',
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
});
