/**
 * 建立／編輯活動表單「進階功能區」（T-013 UI 第 5 批第 2 段／卡 2A）。
 * DOM、class、id、inline style 與文字皆照 A `pages/activity.html#401-603` 與
 * `event-create-options.js`、`event-team-split.js` 的對應函式。
 */
import type { JSX } from 'preact';
import { useLegacyT } from '@/i18n/i18n';
import {
  normalizeEventSocialLinks,
  normalizeEventSocialUrl,
  renderEventSocialIcon,
} from '../../data/event-social-links';
import type { CeInfoKey } from './ce-info';
import type { EventFormAddonState, TeamSplitMode } from './form-types';
import {
  TEAM_SPLIT_COLORS,
  TeamJerseyIcon,
  type TeamSplitColor,
} from './TeamJerseyIcon';

export interface EventFormAddonsProps {
  state: EventFormAddonState;
  onPatch(patch: Partial<EventFormAddonState>): void;
  /** 加值開關要被打開時先問（A `_guardActivityAddonToggle`）：回 false 就不打開（由呼叫端顯示提示）。 */
  guardAddon(): boolean;
  /** 預留佔位被點到（A `_handleReservedActivityAddonClick`：只顯示提示，零寫入）。 */
  onReservedClick(): void;
  /** 俱樂部限定的選擇器區塊（下一張卡做；這裡只放到 A `ce-team-select`／`ce-team-picker` 的位置）。 */
  teamPicker: JSX.Element | null;
  /** 開關是否鎖住（A：非總管編輯俱樂部限定活動時 `teamOnlyToggle.disabled = true`）。 */
  teamOnlyToggleDisabled: boolean;
  /** 開啟時的狀態文字（A `_updateTeamOnlyLabel`，依候選與已選俱樂部組成，由選擇器提供）。 */
  teamOnlyLabel?: string;
  /** 打開說明視窗（同 EventFormFields 的 ? 鈕）。 */
  onInfo(key: CeInfoKey): void;
}

const TEAM_KEYS = ['A', 'B', 'C', 'D'] as const;
const LOCK_HOURS = [1, 2, 3, 6, 12, 24] as const;
const SOCIAL_LINKS_MAX = 5;

const FALLBACK_TEAM_COLOR: TeamSplitColor =
  TEAM_SPLIT_COLORS[0] ?? { hex: '#EF4444', stroke: '#DC2626', name: '紅隊' };

const RESERVED_ADDONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'ce-reserved-noshow-detection', label: '放鴿子偵測' },
  { id: 'ce-reserved-cancel-limit', label: '取消報名限制' },
  { id: 'ce-reserved-questionnaire', label: '報名前問卷' },
  { id: 'ce-reserved-reminder', label: '行前提醒' },
  { id: 'ce-reserved-feedback', label: '活動後評分' },
];

const TEAM_MODES: ReadonlyArray<{ value: TeamSplitMode; label: string }> = [
  { value: 'random', label: '🎲 隨機' },
  { value: 'self-select', label: '👆 自選' },
  { value: 'manual', label: '📋 主辦' },
];

// 照 A `_normalizeEarlyBirdCost`。
function normalizeEarlyBirdCost(value: string | number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 10;
  return Math.max(10, Math.min(500, Math.floor(num)));
}

function teamColorIndexAt(state: EventFormAddonState, index: number): number {
  const raw = state.teamSplitColorIdx[index];
  if (typeof raw === 'number' && raw >= 0 && raw < TEAM_SPLIT_COLORS.length) {
    return raw;
  }
  return index % TEAM_SPLIT_COLORS.length;
}

function teamColorAt(state: EventFormAddonState, index: number): TeamSplitColor {
  return TEAM_SPLIT_COLORS[teamColorIndexAt(state, index)] ?? FALLBACK_TEAM_COLOR;
}

// 照 A `_tsCycleColor`：循環到下一個顏色，跳過其他隊已用的顏色。
function cycleTeamColor(state: EventFormAddonState, teamIdx: number): number[] {
  const count = state.teamSplitCount;
  const current = teamColorIndexAt(state, teamIdx);
  const used = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    if (i !== teamIdx) used.add(teamColorIndexAt(state, i));
  }
  let next = (current + 1) % TEAM_SPLIT_COLORS.length;
  let attempts = 0;
  while (used.has(next) && attempts < TEAM_SPLIT_COLORS.length) {
    next = (next + 1) % TEAM_SPLIT_COLORS.length;
    attempts += 1;
  }
  const nextIndexes = [...state.teamSplitColorIdx];
  for (let i = 0; i < 4; i += 1) {
    if (typeof nextIndexes[i] !== 'number') nextIndexes[i] = i;
  }
  nextIndexes[teamIdx] = next;
  return nextIndexes;
}

/**
 * 受控 checkbox：瀏覽器在 change 時已把 DOM 勾選切換，若守門拒絕（state 沒變）Preact 不會重繪，
 * 畫面會停在「已打開」。先把 DOM 拉回目前 state，成功時由 state 更新重繪（照 A `toggle.checked = false`）。
 */
function keepControlled(el: HTMLInputElement, current: boolean, run: () => void): void {
  run();
  el.checked = current;
}

export function EventFormAddons(props: EventFormAddonsProps): JSX.Element {
  const { state, onPatch, guardAddon, onReservedClick, teamPicker, teamOnlyToggleDisabled, onInfo } = props;
  const lt = useLegacyT();

  const teamCount = state.teamSplitCount === 3 || state.teamSplitCount === 4
    ? state.teamSplitCount
    : 2;
  const socialRows = state.socialLinkInputs.length > 0 ? state.socialLinkInputs : [''];

  const feeLabelText = state.feeEnabled ? lt('開啟 — 收費活動') : lt('關閉 — 不收費');

  let genderLabelText: string;
  let genderLabelColor: string;
  if (!state.genderRestrictionEnabled) {
    genderLabelText = lt('關閉 — 不限制性別');
    genderLabelColor = 'var(--text-muted)';
  } else if (!state.allowedGender) {
    genderLabelText = lt('已開啟 — 請選擇限定性別');
    genderLabelColor = 'var(--warning)';
  } else if (state.allowedGender === '男') {
    genderLabelText = lt('已開啟 — 僅限男性報名');
    genderLabelColor = '#dc2626';
  } else {
    genderLabelText = lt('已開啟 — 僅限女性報名');
    genderLabelColor = '#dc2626';
  }

  const privateLabelText = state.privateEvent
    ? lt('已開啟 — 僅限連結可見')
    : lt('關閉 — 所有人可見');
  const privateLabelColor = state.privateEvent ? '#dc2626' : 'var(--text-muted)';

  const teamSplitLabelText = state.teamSplitEnabled ? lt('開啟') : lt('關閉');
  const socialLabelText = state.socialLinksEnabled ? lt('開啟') : lt('關閉');
  const socialLabelColor = state.socialLinksEnabled ? 'var(--accent)' : 'var(--text-muted)';
  const earlyBirdLabelText = state.earlyBirdEnabled ? lt('開啟') : lt('關閉');
  const earlyBirdLabelColor = state.earlyBirdEnabled ? 'var(--accent)' : 'var(--text-muted)';
  const gpsLabelText = state.gpsEnabled ? lt('開啟') : lt('關閉');
  const gpsLabelColor = state.gpsEnabled ? 'var(--accent)' : 'var(--text-muted)';

  // 照 A `_updateTeamOnlyLabel`：關閉「未啟用：所有人都可見」（muted）；開啟時文字由選擇器依選取結果提供、顏色 #e11d48（PM 依 A 原文修正）。
  const teamOnlyLabelText = state.teamOnly
    ? (props.teamOnlyLabel ?? lt('已啟用：請至少選擇 1 支俱樂部'))
    : lt('未啟用：所有人都可見');
  const teamOnlyLabelColor = state.teamOnly ? '#e11d48' : 'var(--text-muted)';

  function handleFeeToggle(checked: boolean): void {
    if (!checked) {
      onPatch({ feeEnabled: false });
      return;
    }
    if (!guardAddon()) return;
    const fee = (parseInt(state.fee, 10) || 0) <= 0 ? '0' : state.fee;
    onPatch({ feeEnabled: true, fee });
  }

  function handleTeamOnlyToggle(checked: boolean): void {
    if (!checked) {
      onPatch({ teamOnly: false });
      return;
    }
    if (!guardAddon()) return;
    onPatch({ teamOnly: true });
  }

  function handleGenderToggle(checked: boolean): void {
    if (!checked) {
      onPatch({ genderRestrictionEnabled: false, allowedGender: '' });
      return;
    }
    if (!guardAddon()) return;
    onPatch({ genderRestrictionEnabled: true });
  }

  function handleGenderChip(value: '男' | '女'): void {
    if (!state.genderRestrictionEnabled) return;
    if (!guardAddon()) return;
    onPatch({ allowedGender: value });
  }

  function handlePrivateToggle(checked: boolean): void {
    if (!checked) {
      onPatch({ privateEvent: false });
      return;
    }
    if (!guardAddon()) return;
    onPatch({ privateEvent: true });
  }

  function handleTeamSplitToggle(checked: boolean): void {
    if (!checked) {
      onPatch({ teamSplitEnabled: false });
      return;
    }
    if (!guardAddon()) return;
    onPatch({ teamSplitEnabled: true });
  }

  function handleTeamCountChange(value: string): void {
    // 照 A bindTeamSplitToggle：隊數下拉只重繪色票，不檢查加值權限（Gemini 審 P3，原規格誤列）。
    const next = Number(value);
    onPatch({ teamSplitCount: next });
  }

  function handleCycleColor(teamIdx: number): void {
    if (!guardAddon()) return;
    onPatch({ teamSplitColorIdx: cycleTeamColor(state, teamIdx) });
  }

  function handleModeChange(mode: TeamSplitMode): void {
    if (!guardAddon()) return;
    onPatch({ teamSplitMode: mode });
  }

  function handleBalanceToggle(next: boolean): void {
    if (next && !guardAddon()) return;
    onPatch({ teamSplitBalanceCap: next });
  }

  function handleLockHoursChange(value: string): void {
    onPatch({ teamSplitLockHours: Number(value) });
  }

  function handleSocialLinksToggle(checked: boolean): void {
    if (!checked) {
      onPatch({ socialLinksEnabled: false });
      return;
    }
    if (!guardAddon()) return;
    if (state.socialLinkInputs.length === 0) {
      onPatch({ socialLinksEnabled: true, socialLinkInputs: [''] });
      return;
    }
    onPatch({ socialLinksEnabled: true });
  }

  function updateSocialLink(index: number, value: string): void {
    const next = [...socialRows];
    next[index] = value;
    onPatch({ socialLinkInputs: next });
  }

  function addSocialLink(): void {
    if (socialRows.length >= SOCIAL_LINKS_MAX) return;
    onPatch({ socialLinkInputs: [...socialRows, ''] });
  }

  function removeSocialLink(index: number): void {
    if (socialRows.length <= 1) return;
    onPatch({ socialLinkInputs: socialRows.filter((_, i) => i !== index) });
  }

  function handleEarlyBirdToggle(checked: boolean): void {
    if (!checked) {
      onPatch({ earlyBirdEnabled: false });
      return;
    }
    if (!guardAddon()) return;
    onPatch({
      earlyBirdEnabled: true,
      earlyBirdCost: String(normalizeEarlyBirdCost(state.earlyBirdCost)),
    });
  }

  function handleEarlyBirdBlur(value: string): void {
    onPatch({ earlyBirdCost: String(normalizeEarlyBirdCost(value)) });
  }

  function handleGpsToggle(checked: boolean): void {
    if (!checked) {
      onPatch({ gpsEnabled: false });
      return;
    }
    if (!guardAddon()) return;
    onPatch({ gpsEnabled: true });
  }

  function renderInfoBtn(key: CeInfoKey, stopPropagation = false): JSX.Element {
    return (
      <button
        type="button"
        class="edu-info-btn"
        title={lt('說明')}
        onClick={(ev) => {
          if (stopPropagation) ev.stopPropagation();
          onInfo(key);
        }}
      >
        ?
      </button>
    );
  }

  function renderSocialPreview(value: string): JSX.Element {
    const normalized = normalizeEventSocialUrl(value);
    const link = normalized
      ? normalizeEventSocialLinks([{ url: normalized }])[0]
      : undefined;
    if (!link) {
      return <span class="ce-social-link-empty">{lt('待判斷')}</span>;
    }
    return (
      <>
        <span dangerouslySetInnerHTML={{ __html: renderEventSocialIcon(link) }} />
        <span>{link.label}</span>
      </>
    );
  }

  return (
    <details
      class="ce-value-section"
      id="ce-value-section"
      aria-labelledby="ce-value-section-title"
    >
      <summary class="ce-value-section-title" id="ce-value-section-title">
        {lt('進階功能')}
      </summary>
      <div class="ce-value-section-body">
        <div class="ce-row ce-value-item">
          <div class="ce-fee-toggle-wrap">
            <div class="ce-label-row">
              {renderInfoBtn('fee')}
              <label for="ce-fee-enabled" class="ce-fee-title">{lt('費用 ($)')}</label>
            </div>
            <div class="ce-toggle-control">
              <label class="toggle-switch" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  id="ce-fee-enabled"
                  checked={state.feeEnabled}
                  onChange={(ev) => keepControlled(ev.currentTarget, state.feeEnabled, () => handleFeeToggle(ev.currentTarget.checked))}
                />
                <span class="toggle-slider"></span>
              </label>
              <span id="ce-fee-enabled-label" class="ce-toggle-status">{feeLabelText}</span>
            </div>
            <div
              id="ce-fee-input-wrap"
              class="ce-fee-input-wrap"
              style={{ display: state.feeEnabled ? '' : 'none' }}
            >
              <input
                type="number"
                id="ce-fee"
                placeholder="0"
                value={state.fee}
                min={0}
                inputMode="numeric"
                disabled={!state.feeEnabled}
                onInput={(ev) => onPatch({ fee: ev.currentTarget.value })}
              />
            </div>
          </div>
        </div>

        <div class="ce-row ce-value-item">
          <div class="ce-label-row">
            {renderInfoBtn('teamOnly')}
            <label>{lt('俱樂部限定')}</label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <label class="toggle-switch" style={{ margin: 0 }}>
              <input
                type="checkbox"
                id="ce-team-only"
                checked={state.teamOnly}
                disabled={teamOnlyToggleDisabled}
                onChange={(ev) => keepControlled(ev.currentTarget, state.teamOnly, () => handleTeamOnlyToggle(ev.currentTarget.checked))}
              />
              <span class="toggle-slider"></span>
            </label>
            <span
              id="ce-team-only-label"
              style={{ fontSize: '.78rem', color: teamOnlyLabelColor }}
            >
              {teamOnlyLabelText}
            </span>
            <select id="ce-team-select" multiple size={4} style={{ display: 'none' }} />
            {state.teamOnly ? teamPicker : null}
          </div>
        </div>

        <div class="ce-row ce-value-item">
          <div class="ce-label-row">
            {renderInfoBtn('gender')}
            <label>{lt('性別限定')}</label>
          </div>
          <div class="ce-gender-limit-wrap">
            <div class="ce-gender-limit-header">
              <label class="toggle-switch" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  id="ce-gender-restriction-enabled"
                  checked={state.genderRestrictionEnabled}
                  onChange={(ev) => keepControlled(ev.currentTarget, state.genderRestrictionEnabled, () => handleGenderToggle(ev.currentTarget.checked))}
                />
                <span class="toggle-slider"></span>
              </label>
              <span
                id="ce-gender-restriction-label"
                style={{ fontSize: '.78rem', color: genderLabelColor }}
              >
                {genderLabelText}
              </span>
            </div>
            <div
              id="ce-gender-restriction-options"
              class="ce-gender-limit-options"
              style={{ display: state.genderRestrictionEnabled ? 'flex' : 'none' }}
            >
              {(['男', '女'] as const).map((value) => {
                const active = state.allowedGender === value;
                return (
                  <button
                    type="button"
                    class={`ce-gender-chip${active ? ' active' : ''}`}
                    data-value={value}
                    aria-pressed={active ? 'true' : 'false'}
                    onClick={() => handleGenderChip(value)}
                  >
                    {lt(value, value)}
                  </button>
                );
              })}
            </div>
            <input type="hidden" id="ce-allowed-gender" value={state.allowedGender} />
            <div class="ce-gender-limit-tip">
              {lt('非必選；開啟後僅限所選性別報名，性別空白或其他不可報名')}
            </div>
          </div>
        </div>

        <div class="ce-row ce-value-item">
          <div class="ce-label-row">
            {renderInfoBtn('private')}
            <label>{lt('私密活動')}</label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <label class="toggle-switch" style={{ margin: 0 }}>
              <input
                type="checkbox"
                id="ce-private-event"
                checked={state.privateEvent}
                onChange={(ev) => keepControlled(ev.currentTarget, state.privateEvent, () => handlePrivateToggle(ev.currentTarget.checked))}
              />
              <span class="toggle-slider"></span>
            </label>
            <span
              id="ce-private-event-label"
              style={{ fontSize: '.78rem', color: privateLabelColor }}
            >
              {privateLabelText}
            </span>
          </div>
          <div class="ce-gender-limit-tip">
            {lt('開啟後活動不會顯示在列表中，僅能透過分享連結查看')}
          </div>
        </div>

        <div class="ce-row ce-value-item">
          <div class="ce-label-row">
            {renderInfoBtn('teamSplit', true)}
            <label>{lt('分隊功能')}</label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <label class="toggle-switch" style={{ margin: 0 }}>
              <input
                type="checkbox"
                id="ce-team-split-enabled"
                checked={state.teamSplitEnabled}
                onChange={(ev) => keepControlled(ev.currentTarget, state.teamSplitEnabled, () => handleTeamSplitToggle(ev.currentTarget.checked))}
              />
              <span class="toggle-slider"></span>
            </label>
            <span
              id="ce-team-split-label"
              style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}
            >
              {teamSplitLabelText}
            </span>
          </div>
          <div
            id="ce-team-split-options"
            style={{
              display: state.teamSplitEnabled ? '' : 'none',
              marginTop: '.5rem',
              background: 'var(--bg-elevated)',
              borderRadius: '8px',
              padding: '.55rem .6rem',
              fontSize: '.78rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '.35rem',
                marginBottom: '.45rem',
                flexWrap: 'wrap',
              }}
            >
              <select
                id="ce-team-split-count"
                style={{
                  fontSize: '.78rem',
                  padding: '.2rem .25rem',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  width: '4.5rem',
                  textAlign: 'center',
                }}
                value={String(teamCount)}
                onChange={(ev) => handleTeamCountChange(ev.currentTarget.value)}
              >
                <option value="2">{lt('2')}</option>
                <option value="3">{lt('3')}</option>
                <option value="4">{lt('4')}</option>
              </select>
              <span style={{ color: 'var(--text-muted)' }}>{lt('隊')}</span>
              <div
                id="ce-team-split-colors"
                style={{ display: 'flex', gap: '.25rem', alignItems: 'center' }}
              >
                {Array.from({ length: teamCount }, (_, index) => {
                  const color = teamColorAt(state, index);
                  return (
                    <div
                      key={index}
                      style={{ cursor: 'pointer', padding: '.1rem' }}
                      title={lt('點擊換色：{name}', '點擊換色：{name}', { name: color.name })}
                      onClick={() => handleCycleColor(index)}
                    >
                      <TeamJerseyIcon
                        color={color.hex}
                        stroke={color.stroke}
                        letter={TEAM_KEYS[index] ?? '?'}
                        width={26}
                      />
                    </div>
                  );
                })}
              </div>
              <span
                style={{ fontSize: '.62rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
              >
                {lt('點擊換色')}
              </span>
              <label
                id="ce-team-split-balance-card"
                for="ce-team-split-balance"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '.3rem',
                  padding: '.2rem .5rem',
                  borderRadius: '6px',
                  border: `1.5px solid ${state.teamSplitBalanceCap ? 'var(--accent)' : 'var(--border)'}`,
                  background: state.teamSplitBalanceCap ? 'rgba(13,148,136,.08)' : 'transparent',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  marginLeft: 'auto',
                  transition: 'all .15s',
                }}
                onClick={(ev) => {
                  ev.preventDefault();
                  handleBalanceToggle(!state.teamSplitBalanceCap);
                }}
              >
                <input
                  type="checkbox"
                  id="ce-team-split-balance"
                  checked={state.teamSplitBalanceCap}
                  style={{ display: 'none' }}
                  onChange={(ev) => keepControlled(ev.currentTarget, state.teamSplitBalanceCap, () => handleBalanceToggle(ev.currentTarget.checked))}
                />
                <span id="ce-team-split-balance-icon" style={{ fontSize: '.85rem', lineHeight: 1 }}>
                  {state.teamSplitBalanceCap ? '✅' : '⬜'}
                </span>
                <span style={{ fontSize: '.7rem', fontWeight: 600, color: 'var(--accent)' }}>
                  {lt('均分上限')}
                </span>
              </label>
            </div>
            <div style={{ marginBottom: '.45rem' }}>
              <div
                style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginBottom: '.2rem' }}
              >
                {lt('報名時用戶可以')}
              </div>
              <div id="ce-team-split-mode" style={{ display: 'flex', gap: '.2rem', flexWrap: 'wrap' }}>
                {TEAM_MODES.map((mode) => {
                  const active = state.teamSplitMode === mode.value;
                  return (
                    <button
                      type="button"
                      key={mode.value}
                      class={`ce-gender-chip${active ? ' active' : ''}`}
                      data-value={mode.value}
                      onClick={() => handleModeChange(mode.value)}
                    >
                      {lt(mode.label, mode.label)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div
              id="ce-team-split-lock-wrap"
              style={{ display: state.teamSplitMode === 'self-select' ? '' : 'none' }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '.25rem', whiteSpace: 'nowrap' }}
              >
                <span>{lt('開始前')}</span>
                <select
                  id="ce-team-split-lock-hours"
                  style={{
                    fontSize: '.78rem',
                    padding: '.2rem .25rem',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    width: '4.5rem',
                    textAlign: 'center',
                  }}
                  value={String(state.teamSplitLockHours)}
                  onChange={(ev) => handleLockHoursChange(ev.currentTarget.value)}
                >
                  {LOCK_HOURS.map((hour) => (
                    <option key={hour} value={String(hour)}>{lt(String(hour))}</option>
                  ))}
                </select>
                <span>{lt('小時鎖定')}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="ce-row ce-value-item ce-social-links-row">
          <div class="ce-label-row">
            {renderInfoBtn('socialLinks', true)}
            <label>{lt('社群連結')}</label>
          </div>
          <div class="ce-toggle-control">
            <label class="toggle-switch" style={{ margin: 0 }}>
              <input
                type="checkbox"
                id="ce-social-links-enabled"
                checked={state.socialLinksEnabled}
                onChange={(ev) => keepControlled(ev.currentTarget, state.socialLinksEnabled, () => handleSocialLinksToggle(ev.currentTarget.checked))}
              />
              <span class="toggle-slider"></span>
            </label>
            <span
              id="ce-social-links-label"
              class="ce-toggle-status"
              style={{ color: socialLabelColor }}
            >
              {socialLabelText}
            </span>
          </div>
          <div
            id="ce-social-links-options"
            class="ce-social-links-options"
            style={{ display: state.socialLinksEnabled ? '' : 'none' }}
          >
            <div id="ce-social-links-list" class="ce-social-links-list">
              {socialRows.map((value, index) => (
                <div class="ce-social-link-row" data-index={index} key={index}>
                  <input
                    type="url"
                    class="ce-social-link-input"
                    value={value}
                    placeholder={lt('貼上社群網址，例如 https://line.me/...')}
                    onInput={(ev) => updateSocialLink(index, ev.currentTarget.value)}
                  />
                  <span class="ce-social-link-preview">{renderSocialPreview(value)}</span>
                  <button
                    type="button"
                    class="ce-social-link-remove"
                    disabled={socialRows.length <= 1}
                    onClick={() => removeSocialLink(index)}
                  >
                    {lt('移除')}
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              id="ce-social-links-add"
              class="ce-social-links-add"
              disabled={socialRows.length >= SOCIAL_LINKS_MAX}
              onClick={addSocialLink}
            >
              {lt('+ 新增連結')}
            </button>
            <div class="ce-social-links-tip">
              {lt('最多 5 個。系統會依網址自動判斷 LINE、Facebook、Instagram、YouTube 等常見社群圖示。')}
            </div>
          </div>
        </div>

        <div class="ce-row ce-value-item ce-early-bird-row">
          <div class="ce-label-row">
            {renderInfoBtn('earlyBird', true)}
            <label>{lt('早鳥報名')}</label>
          </div>
          <div class="ce-toggle-control">
            <label class="toggle-switch" style={{ margin: 0 }}>
              <input
                type="checkbox"
                id="ce-early-bird-enabled"
                checked={state.earlyBirdEnabled}
                onChange={(ev) => keepControlled(ev.currentTarget, state.earlyBirdEnabled, () => handleEarlyBirdToggle(ev.currentTarget.checked))}
              />
              <span class="toggle-slider"></span>
            </label>
            <span
              id="ce-early-bird-label"
              class="ce-toggle-status"
              style={{ color: earlyBirdLabelColor }}
            >
              {earlyBirdLabelText}
            </span>
          </div>
          <div
            id="ce-early-bird-options"
            class="ce-early-bird-options"
            style={{ display: state.earlyBirdEnabled ? '' : 'none' }}
          >
            <label class="ce-early-bird-cost-row" for="ce-early-bird-cost">
              <span>{lt('消耗積分')}</span>
              <input
                type="number"
                id="ce-early-bird-cost"
                min={10}
                max={500}
                step={10}
                value={state.earlyBirdCost}
                inputMode="numeric"
                disabled={!state.earlyBirdEnabled}
                onInput={(ev) => onPatch({ earlyBirdCost: ev.currentTarget.value })}
                onBlur={(ev) => handleEarlyBirdBlur(ev.currentTarget.value)}
              />
              <span>{lt('分')}</span>
            </label>
            <div class="ce-early-bird-tip">
              {lt('正式開放報名前可提前報名。扣點只套用在本人正取報名；活動取消會退回，用戶自行取消不退回。')}
            </div>
          </div>
        </div>

        <div class="ce-row ce-value-item ce-gps-row">
          <div class="ce-label-row">
            {renderInfoBtn('gps', true)}
            <label for="ce-gps-enabled">{lt('GPS功能')}</label>
          </div>
          <div class="ce-toggle-control">
            <label class="toggle-switch" style={{ margin: 0 }}>
              <input
                type="checkbox"
                id="ce-gps-enabled"
                checked={state.gpsEnabled}
                onChange={(ev) => keepControlled(ev.currentTarget, state.gpsEnabled, () => handleGpsToggle(ev.currentTarget.checked))}
              />
              <span class="toggle-slider"></span>
            </label>
            <span
              id="ce-gps-label"
              class="ce-toggle-status"
              style={{ color: gpsLabelColor }}
            >
              {gpsLabelText}
            </span>
          </div>
        </div>

        {RESERVED_ADDONS.map((item) => (
          <div
            class="ce-row ce-value-item ce-value-reserved"
            key={item.id}
            role="button"
            tabIndex={0}
            aria-disabled="true"
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              onReservedClick();
            }}
            onKeyDown={(ev) => {
              if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
              ev.preventDefault();
              ev.stopPropagation();
              onReservedClick();
            }}
          >
            <div class="ce-label-row">
              <label for={item.id}>{lt(item.label, item.label)}</label>
            </div>
            <div class="ce-toggle-control">
              <label class="toggle-switch" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  id={item.id}
                  checked={false}
                  disabled
                  aria-disabled="true"
                />
                <span class="toggle-slider"></span>
              </label>
              <span class="ce-toggle-status">{lt('預留 — 尚未啟用')}</span>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
