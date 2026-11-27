// FC-B 賽事名單暱稱：斜方身分標籤 B 版、改暱稱面板、登錄頁預設 LINE 暱稱。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import coreZh from '@/i18n/messages/zh-TW.json';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import type { CpActions } from '../actions';
import { CpCallError } from '../data/cp-callables';
import type { RosterPublicDoc } from '../data/types';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict } from '../i18n';
import cpZh from '../locales-lazy/zh-TW.json';
import { memberActor, screenEnv } from '../testing/screen-fixtures';
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
  return {
    ...actual,
    loadMyRosterProfile: () => Promise.resolve({
      birthday: '2000-01-01',
      lineDisplayName: '王示範LINE',
      displayName: null,
      role: 'user',
      stealth: false,
    }),
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

const SAMPLE = screenEnv('roster').bundle!.roster[0]!;

function makeRow(overrides: Partial<RosterPublicDoc> & { id: string; number: number; displayName: string }): RosterPublicDoc {
  return { ...SAMPLE, enId: 'en_a', ...overrides } as RosterPublicDoc;
}

function envWithRows(rows: RosterPublicDoc[], myPlIds: string[] = []): CpInjectedEnv {
  const env = screenEnv('roster');
  env.actor = { ...memberActor };
  env.bundle = { ...env.bundle!, roster: rows, myPlIds };
  return env;
}

describe('名單頁：斜方身分標籤 B 版（暱稱改過才有第二段原始名）', () => {
  it('改過的列一個 data-roster-name、class 含 uc-coach 與 cpn-tag、文字含阿範與 .cpn-seg 王示範；沒改與舊列只有主名', () => {
    const rows = [
      makeRow({ id: 'pl_changed', number: 7, displayName: '阿範', nickname: '阿範', originalName: '王示範', role: 'coach' }),
      makeRow({ id: 'pl_unchanged', number: 10, displayName: '林示範', nickname: null, originalName: '林示範', role: 'user' }),
      makeRow({ id: 'pl_old', number: 11, displayName: '舊名', nickname: null, originalName: null }),
    ];
    const env = envWithRows(rows, []);
    mount(RosterPage, env);
    const tags = document.querySelectorAll<HTMLElement>('[data-roster-name]');
    expect(tags).toHaveLength(3);
    const [changed, unchanged, old] = [tags[0]!, tags[1]!, tags[2]!];
    expect(changed.className).toContain('uc-coach');
    expect(changed.className).toContain('cpn-tag');
    expect(changed.textContent ?? '').toContain('阿範');
    expect(changed.querySelector('.cpn-seg')?.textContent).toBe('王示範');
    expect(unchanged.querySelector('.cpn-seg')).toBeNull();
    expect(unchanged.textContent ?? '').toContain('林示範');
    expect(old.querySelector('.cpn-seg')).toBeNull();
    expect(old.textContent).toBe('舊名');
    expect(old.className).toContain('uc-user');
  });

  it('自己的新列有「改暱稱」鍵；別人的列、自己的舊列、未成年列沒有', () => {
    const rows = [
      makeRow({ id: 'pl_mine', number: 7, displayName: '王示範', nickname: null, originalName: '王示範', role: 'user' }),
      makeRow({ id: 'pl_other', number: 10, displayName: '林示範', nickname: null, originalName: '林示範', role: 'user' }),
      makeRow({ id: 'pl_old', number: 11, displayName: '舊名', nickname: null, originalName: null }),
      makeRow({ id: 'pl_minor', number: 12, displayName: '小明', nickname: null, originalName: '歐陽小明', role: 'user', isMinor: true }),
    ];
    const env = envWithRows(rows, ['pl_mine']);
    mount(RosterPage, env);
    const buttons = screen.getAllByRole('button', { name: '改暱稱' });
    expect(buttons).toHaveLength(1);
    const mineRow = [...document.querySelectorAll<HTMLElement>('[data-roster-row]')]
      .find((r) => r.textContent?.includes('王示範'));
    expect(mineRow?.contains(buttons[0]!)).toBe(true);
  });

  it('按改暱稱 → 面板；輸入「小黑」→ 預覽顯示小黑與 .cpn-seg 王示範；按儲存 → updateRosterNickname 收到參數、面板關閉、列顯示小黑', async () => {
    const rows = [makeRow({ id: 'pl_mine', number: 7, displayName: '王示範', nickname: null, originalName: '王示範', role: 'user' })];
    const env = envWithRows(rows, ['pl_mine']);
    const updateRosterNickname = vi.fn(async () => ({ cid: 'cup', plId: 'pl_mine', changed: true, displayName: '小黑' }));
    env.actions = { ...env.actions, updateRosterNickname: updateRosterNickname as unknown as CpActions['updateRosterNickname'] };
    mount(RosterPage, env);
    fireEvent.click(screen.getByRole('button', { name: '改暱稱' }));
    const input = screen.getByLabelText('暱稱') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '小黑' } });
    const previewTag = document.querySelector('.cpn-preview [data-roster-name]');
    expect(previewTag?.textContent ?? '').toContain('小黑');
    expect(previewTag?.querySelector('.cpn-seg')?.textContent).toBe('王示範');
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => {
      expect(updateRosterNickname).toHaveBeenCalledWith({ cid: 'cup', plId: 'pl_mine', nickname: '小黑' });
      expect(screen.queryByRole('button', { name: '儲存' })).toBeNull();
      expect(document.querySelector('[data-roster-row] [data-roster-name]')?.textContent ?? '').toContain('小黑');
    });
  });

  it('輸入「阿(範)」按儲存 → 顯示「暱稱不能有括號或換行」，updateRosterNickname 沒被呼叫', async () => {
    const rows = [makeRow({ id: 'pl_mine', number: 7, displayName: '王示範', nickname: null, originalName: '王示範', role: 'user' })];
    const env = envWithRows(rows, ['pl_mine']);
    const updateRosterNickname = vi.fn();
    env.actions = { ...env.actions, updateRosterNickname: updateRosterNickname as unknown as CpActions['updateRosterNickname'] };
    mount(RosterPage, env);
    fireEvent.click(screen.getByRole('button', { name: '改暱稱' }));
    const input = screen.getByLabelText('暱稱') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '阿(範)' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('暱稱不能有括號或換行')).toBeTruthy();
    expect(updateRosterNickname).not.toHaveBeenCalled();
  });

  it('updateRosterNickname reject NICK_EDIT_LIMIT → 面板內顯示含 5 的錯誤、面板不關', async () => {
    const rows = [makeRow({ id: 'pl_mine', number: 7, displayName: '王示範', nickname: null, originalName: '王示範', role: 'user' })];
    const env = envWithRows(rows, ['pl_mine']);
    env.actions = {
      ...env.actions,
      updateRosterNickname: (async () => { throw new CpCallError('NICK_EDIT_LIMIT', { max: 5 }); }) as unknown as CpActions['updateRosterNickname'],
    };
    mount(RosterPage, env);
    fireEvent.click(screen.getByRole('button', { name: '改暱稱' }));
    const input = screen.getByLabelText('暱稱') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '小黑' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => {
      expect(document.querySelector('.cps-fields')?.textContent ?? '').toContain('5');
    });
    expect(screen.getByRole('button', { name: '儲存' })).toBeTruthy();
  });
});

describe('名單頁：名字補正（只在有 myRosterProfile 且需補時呼叫 syncRosterName）', () => {
  it('自己那列 nameSource=profile、lineDisplayName 有值 → syncRosterName 一次', async () => {
    const rows = [makeRow({ id: 'pl_mine', number: 7, displayName: '王示範', nickname: null, originalName: '王示範', role: 'user', nameSource: 'profile' })];
    const env = envWithRows(rows, ['pl_mine']);
    env.myRosterProfile = vi.fn(async () => ({ birthday: null, lineDisplayName: '王示範LINE', displayName: null, role: 'user', stealth: false }));
    const syncRosterName = vi.fn(async () => ({ cid: 'cup', plId: 'pl_mine', changed: false }));
    env.actions = { ...env.actions, syncRosterName: syncRosterName as unknown as CpActions['syncRosterName'] };
    mount(RosterPage, env);
    await waitFor(() => expect(syncRosterName).toHaveBeenCalledTimes(1));
    expect(syncRosterName).toHaveBeenCalledWith({ cid: 'cup', plId: 'pl_mine' });
  });

  it('自己那列 nameSource=line 且角色相同 → 有讀 myRosterProfile 但不呼叫 syncRosterName', async () => {
    const rows = [makeRow({ id: 'pl_mine', number: 7, displayName: '王示範', nickname: null, originalName: '王示範', role: 'user', nameSource: 'line' })];
    const env = envWithRows(rows, ['pl_mine']);
    const myRosterProfile = vi.fn(async () => ({ birthday: null, lineDisplayName: '王示範LINE', displayName: null, role: 'user', stealth: false }));
    env.myRosterProfile = myRosterProfile;
    const syncRosterName = vi.fn(async () => ({ cid: 'cup', plId: 'pl_mine', changed: false }));
    env.actions = { ...env.actions, syncRosterName: syncRosterName as unknown as CpActions['syncRosterName'] };
    mount(RosterPage, env);
    await waitFor(() => expect(myRosterProfile).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(syncRosterName).not.toHaveBeenCalled();
  });
});

describe('登錄頁：預設帶 LINE 暱稱、動過才送', () => {
  function setupAdultPreview(): { env: CpInjectedEnv; joinRoster: ReturnType<typeof vi.fn> } {
    const env = screenEnv('form-self-adult');
    env.actor = { ...env.actor, displayName: '王示範' };
    if (env.preview) env.preview = { ...env.preview, prefillForm: false };
    const joinRoster = vi.fn(async () => ({}));
    env.actions = { ...env.actions, joinRoster: joinRoster as unknown as CpActions['joinRoster'] };
    mount(JoinRosterPage, env);
    return { env, joinRoster };
  }

  function fillRequired(): void {
    const numberInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.input(numberInput, { target: { value: '14' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /我了解名單會公開/ }));
  }

  it('預覽模式：暱稱欄 value 是 actor.displayName（王示範）', () => {
    setupAdultPreview();
    const nick = document.querySelector('input[maxlength="20"]') as HTMLInputElement;
    expect(nick.value).toBe('王示範');
  });

  it('不動直接送 → joinRoster 收到的 input 沒有 nickname', async () => {
    const { joinRoster } = setupAdultPreview();
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(joinRoster).toHaveBeenCalledTimes(1));
    const input = joinRoster.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.nickname ?? '').toBe('');
  });

  it('改成「阿範」再送 → 有 nickname: 阿範', async () => {
    const { joinRoster } = setupAdultPreview();
    const nick = document.querySelector('input[maxlength="20"]') as HTMLInputElement;
    fireEvent.input(nick, { target: { value: '阿範' } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(joinRoster).toHaveBeenCalledTimes(1));
    const input = joinRoster.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.nickname).toBe('阿範');
  });

  it('改成「阿(範)」→ 不送、顯示「暱稱不能有括號或換行」', async () => {
    const { joinRoster } = setupAdultPreview();
    const nick = document.querySelector('input[maxlength="20"]') as HTMLInputElement;
    fireEvent.input(nick, { target: { value: '阿(範)' } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    expect(await screen.findByText('暱稱不能有括號或換行')).toBeTruthy();
    expect(joinRoster).not.toHaveBeenCalled();
  });
});
