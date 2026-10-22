/**
 * EventFormAddons 單元測試（T-013 卡 2A）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import type { CeInfoKey } from './ce-info';
import type { EventFormAddonState } from './form-types';
import { EventFormAddons, type EventFormAddonsProps } from './EventFormAddons';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
});

function baseState(overrides: Partial<EventFormAddonState> = {}): EventFormAddonState {
  return {
    feeEnabled: false,
    fee: '0',
    teamOnly: false,
    teamOnlyTeamIds: [],
    genderRestrictionEnabled: false,
    allowedGender: '',
    privateEvent: false,
    teamSplitEnabled: false,
    teamSplitCount: 2,
    teamSplitColorIdx: [0, 1, 2, 3],
    teamSplitBalanceCap: true,
    teamSplitMode: 'random',
    teamSplitLockHours: 2,
    socialLinksEnabled: false,
    socialLinkInputs: [],
    earlyBirdEnabled: false,
    earlyBirdCost: '10',
    gpsEnabled: false,
    ...overrides,
  };
}

function renderAddons(state: EventFormAddonState) {
  const onPatch = vi.fn((patch: Partial<EventFormAddonState>): void => {
    void patch;
  });
  const guardAddon = vi.fn((): boolean => true);
  const onReservedClick = vi.fn((): void => {});
  const onInfo = vi.fn((key: CeInfoKey): void => {
    void key;
  });
  const props: EventFormAddonsProps = {
    state,
    onPatch,
    guardAddon,
    onReservedClick,
    teamPicker: null,
    teamOnlyToggleDisabled: false,
    onInfo,
  };
  const result = render(<EventFormAddons {...props} />);
  return { ...result, props, onPatch, guardAddon, onReservedClick, onInfo };
}

describe('EventFormAddons', () => {
  it('<details> 預設收合', () => {
    const { container } = renderAddons(baseState());
    const details = container.querySelector<HTMLDetailsElement>('details.ce-value-section');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
  });

  it('各加值開關關→開先 guardAddon，回 false 不 onPatch、回 true 才 onPatch；開→關不問', () => {
    const toggles: ReadonlyArray<{ id: string; patch: Partial<EventFormAddonState> }> = [
      { id: 'ce-fee-enabled', patch: { feeEnabled: true, fee: '0' } },
      { id: 'ce-team-only', patch: { teamOnly: true } },
      { id: 'ce-gender-restriction-enabled', patch: { genderRestrictionEnabled: true } },
      { id: 'ce-private-event', patch: { privateEvent: true } },
      { id: 'ce-team-split-enabled', patch: { teamSplitEnabled: true } },
      { id: 'ce-social-links-enabled', patch: { socialLinksEnabled: true, socialLinkInputs: [''] } },
      { id: 'ce-early-bird-enabled', patch: { earlyBirdEnabled: true, earlyBirdCost: '10' } },
      { id: 'ce-gps-enabled', patch: { gpsEnabled: true } },
    ];

    for (const item of toggles) {
      const blocked = renderAddons(baseState());
      blocked.guardAddon.mockReturnValue(false);
      const blockedInput = blocked.container.querySelector<HTMLInputElement>(`#${item.id}`);
      expect(blockedInput).not.toBeNull();
      if (blockedInput) fireEvent.change(blockedInput, { target: { checked: true } });
      expect(blocked.onPatch).not.toHaveBeenCalled();
      cleanup();

      const allowed = renderAddons(baseState());
      const allowedInput = allowed.container.querySelector<HTMLInputElement>(`#${item.id}`);
      expect(allowedInput).not.toBeNull();
      if (allowedInput) fireEvent.change(allowedInput, { target: { checked: true } });
      expect(allowed.onPatch).toHaveBeenCalledWith(item.patch);
      cleanup();

      const wasOn = renderAddons(baseState(item.patch));
      const wasOnInput = wasOn.container.querySelector<HTMLInputElement>(`#${item.id}`);
      expect(wasOnInput).not.toBeNull();
      wasOn.guardAddon.mockClear();
      if (wasOnInput) fireEvent.change(wasOnInput, { target: { checked: false } });
      expect(wasOn.guardAddon).not.toHaveBeenCalled();
      expect(wasOn.onPatch).toHaveBeenCalled();
      cleanup();
    }
  });

  it('守門拒絕時開關畫面維持未勾（PM 補測：瀏覽器 change 已切換 DOM，需拉回）', () => {
    const rendered = renderAddons(baseState());
    rendered.guardAddon.mockReturnValue(false);
    const fee = rendered.container.querySelector<HTMLInputElement>('#ce-fee-enabled')!;
    fee.checked = true;
    fireEvent.change(fee);
    expect(rendered.onPatch).not.toHaveBeenCalled();
    expect(fee.checked).toBe(false);
  });

  it('5 個預留佔位 click／Enter／Space 只呼叫 onReservedClick，checkbox 永遠未勾且零寫入', () => {
    const { container, onPatch, onReservedClick } = renderAddons(baseState());
    const rows = Array.from(container.querySelectorAll<HTMLDivElement>('.ce-value-reserved'));
    expect(rows).toHaveLength(5);

    rows.forEach((row) => {
      const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(checkbox).not.toBeNull();
      expect(checkbox?.checked).toBe(false);
      expect(checkbox?.disabled).toBe(true);
      expect(checkbox?.getAttribute('aria-disabled')).toBe('true');
      expect(row.getAttribute('role')).toBe('button');
      expect(row.getAttribute('tabindex')).toBe('0');
      expect(row.getAttribute('aria-disabled')).toBe('true');
    });

    const first = rows[0];
    const second = rows[1];
    const third = rows[2];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    if (first) fireEvent.click(first);
    if (second) fireEvent.keyDown(second, { key: 'Enter' });
    if (third) fireEvent.keyDown(third, { key: ' ' });

    expect(onReservedClick).toHaveBeenCalledTimes(3);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('分隊換色會跳過其他隊已用顏色', () => {
    const { container, onPatch } = renderAddons(baseState({
      teamSplitEnabled: true,
      teamSplitCount: 3,
      teamSplitColorIdx: [0, 1, 2],
    }));
    const colorDivs = container.querySelectorAll<HTMLDivElement>('#ce-team-split-colors > div');
    expect(colorDivs).toHaveLength(3);
    const first = colorDivs[0];
    expect(first).toBeDefined();
    if (first) fireEvent.click(first);
    // PM 修正：照 A `_tsTeamColorIdx` 永遠保留 4 隊的索引（第 4 隊沿用預設 3）。
    expect(onPatch).toHaveBeenCalledWith({ teamSplitColorIdx: [3, 1, 2, 3] });
  });

  it('隊數改 3 會 onPatch，且 3 隊時出現 3 件隊衣', () => {
    const state = baseState({ teamSplitEnabled: true, teamSplitCount: 2 });
    const rendered = renderAddons(state);
    const select = rendered.container.querySelector<HTMLSelectElement>('#ce-team-split-count');
    expect(select).not.toBeNull();
    if (select) fireEvent.change(select, { target: { value: '3' } });
    expect(rendered.onPatch).toHaveBeenCalledWith({ teamSplitCount: 3 });

    const nextState = { ...state, teamSplitCount: 3 };
    rendered.rerender(<EventFormAddons {...rendered.props} state={nextState} />);
    expect(
      rendered.container.querySelectorAll('#ce-team-split-colors .uc-team-jersey'),
    ).toHaveLength(3);
  });

  it('自選模式才顯示鎖定小時', () => {
    const state = baseState({ teamSplitEnabled: true, teamSplitMode: 'random' });
    const rendered = renderAddons(state);
    const before = rendered.container.querySelector<HTMLDivElement>('#ce-team-split-lock-wrap');
    expect(before?.style.display).toBe('none');

    const selfSelect = rendered.container.querySelector<HTMLButtonElement>(
      '#ce-team-split-mode [data-value="self-select"]',
    );
    expect(selfSelect).not.toBeNull();
    if (selfSelect) fireEvent.click(selfSelect);
    expect(rendered.onPatch).toHaveBeenCalledWith({ teamSplitMode: 'self-select' });

    const nextState = { ...state, teamSplitMode: 'self-select' as const };
    rendered.rerender(<EventFormAddons {...rendered.props} state={nextState} />);
    const after = rendered.container.querySelector<HTMLDivElement>('#ce-team-split-lock-wrap');
    expect(after?.style.display).toBe('');
  });

  it('社群連結最多 5 列，只剩一列時移除停用', () => {
    const five = renderAddons(baseState({
      socialLinksEnabled: true,
      socialLinkInputs: ['a', 'b', 'c', 'd', 'e'],
    }));
    expect(five.container.querySelectorAll('.ce-social-link-row')).toHaveLength(5);
    const add = five.container.querySelector<HTMLButtonElement>('#ce-social-links-add');
    expect(add?.disabled).toBe(true);
    const removes = five.container.querySelectorAll<HTMLButtonElement>('.ce-social-link-remove');
    expect(removes).toHaveLength(5);
    removes.forEach((button) => {
      expect(button.disabled).toBe(false);
    });
    cleanup();

    const one = renderAddons(baseState({
      socialLinksEnabled: true,
      socialLinkInputs: ['a'],
    }));
    const remove = one.container.querySelector<HTMLButtonElement>('.ce-social-link-remove');
    expect(remove?.disabled).toBe(true);
  });

  it('早鳥積分 blur 時夾到 10～500', () => {
    const low = renderAddons(baseState({
      earlyBirdEnabled: true,
      earlyBirdCost: '5',
    }));
    const lowInput = low.container.querySelector<HTMLInputElement>('#ce-early-bird-cost');
    expect(lowInput).not.toBeNull();
    if (lowInput) fireEvent.blur(lowInput);
    expect(low.onPatch).toHaveBeenCalledWith({ earlyBirdCost: '10' });
    cleanup();

    const high = renderAddons(baseState({
      earlyBirdEnabled: true,
      earlyBirdCost: '999',
    }));
    const highInput = high.container.querySelector<HTMLInputElement>('#ce-early-bird-cost');
    expect(highInput).not.toBeNull();
    if (highInput) fireEvent.blur(highInput);
    expect(high.onPatch).toHaveBeenCalledWith({ earlyBirdCost: '500' });
  });
});
