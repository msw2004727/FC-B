/**
 * 俱樂部設定彈窗。
 *
 * 對應 A js/modules/team/team-detail.js：
 * - 620–637：設定項目與 switch DOM。
 * - 639–726：分類選項、分類判定與設定 body。
 * - 728–769：開啟、權限守衛與逐控制項寫入。
 * - 771–830：分類、邀請、主題色、遮罩與欄位顯示。
 * 對應 A pages/team.html 的 #team-detail-settings-modal。
 *
 * 欄位對照表（A ↔ B，同名同型）：
 * - type ↔ type：none | competitive | education | leisure。
 * - teachingEnabled ↔ teachingEnabled：boolean。
 * - eduSettings ↔ eduSettings：保留既有內容的教學設定物件。
 *   B patch 的 null 是刪除指令，由寫入層轉換為 A 的 deleteField 語意。
 * - allowMemberInvite ↔ allowMemberInvite：boolean。
 * - themeColor ↔ themeColor：色碼字串或 null（預設）。
 * - themeOverlayEnabled ↔ themeOverlayEnabled：boolean。
 * - detailVisibility ↔ detailVisibility：各欄位 boolean 的完整物件。
 *
 * Rules 邊界：依本卡契約，teams 更新只接受經理三欄位所認定的身分
 * 或 team.manage_all，與 canEditTeamSettings 一致；UI 不自行擴充身分判定。
 * 最終授權仍由 Rules 執行。本路徑沒有 opLog、通知或額外資料寫入。
 */
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { useLegacyT } from '@/i18n/i18n';
import { lockBody } from '@/ui/Modal';
import { toast } from '@/ui/Toast';

import { canEditTeamSettings } from '../../club-policy';
import { getTeamDetailVisibility } from '../../data/team-detail-model';
import {
  getTeamCategoryMeta,
  getTeamCategoryOptions,
  getTeamThemeColor,
  normalizeTeamCategory,
  normalizeTeamThemeColor,
} from '../../data/team-list-model';
import {
  saveTeamSettingsPatch,
  type TeamSettingsPatch,
} from '../../data/teams-write';
import type {
  ClubViewer,
  TeamCategoryKey,
  TeamDoc,
} from '../../data/types';

export interface TeamSettingsModalProps {
  team: TeamDoc;
  viewer: ClubViewer;
  onClose: () => void;
  /** 每次寫入成功後呼叫；回傳 Promise 時會等待完成。 */
  onSaved: () => void | Promise<void>;
  /** 開啟基本資料編輯流程，由父層接線。 */
  onEditBasic: () => void;
}

const CATEGORY_COPY: Record<TeamCategoryKey, { label: string; hint: string }> = {
  none: {
    label: '無',
    hint: '不顯示任何標籤與緞帶，也不啟用課程功能。',
  },
  competitive: {
    label: '競技',
    hint: '競技標籤只作為俱樂部分類，賽事系統設定已預留。',
  },
  education: {
    label: '教學',
    hint: '教學標籤會啟用課程、學員與待審核功能。',
  },
  leisure: {
    label: '休閒',
    hint: '休閒標籤只作為俱樂部分類，未來可銜接友誼賽或休閒賽事設定。',
  },
};

const VISIBILITY_ITEMS = [
  { key: 'events', label: '活動', desc: '俱樂部活動列表' },
  { key: 'courses', label: '俱樂部課程', desc: '課程、分組、學員與待審核頁籤' },
  { key: 'matches', label: '俱樂部賽事', desc: '與俱樂部關聯的賽事列表' },
  { key: 'info', label: '俱樂部資訊', desc: '經理、領隊、教練與地區' },
  { key: 'bio', label: '簡介', desc: '俱樂部介紹文字' },
  { key: 'record', label: '戰績', desc: '勝敗與進失球資料' },
  { key: 'members', label: '成員列表', desc: '隊員與管理名單' },
] as const;

type VisibilityKey = (typeof VISIBILITY_ITEMS)[number]['key'];
type Control = HTMLInputElement | HTMLButtonElement;

interface PendingSettings {
  source: TeamDoc;
  patch: TeamSettingsPatch;
  control: Control;
  busy: boolean;
}

function isVisibilityKey(key: string): key is VisibilityKey {
  return VISIBILITY_ITEMS.some((item) => item.key === key);
}

export function TeamSettingsModal(props: TeamSettingsModalProps): JSX.Element {
  const { team, viewer } = props;
  const lt = useLegacyT();
  const [pending, setPending] = useState<PendingSettings | null>(null);
  const confirmed = useRef<{ source: TeamDoc; patch: TeamSettingsPatch }>({
    source: team,
    patch: {},
  });
  // 父層傳入新物件時立即以新 prop 為準，不讓舊成功 patch 跨越資料版本。
  if (confirmed.current.source !== team) {
    confirmed.current = { source: team, patch: {} };
  }
  const alive = useRef(true);
  const writing = useRef(false);
  const latest = useRef(props);
  const closeButton = useRef<HTMLButtonElement>(null);
  const themeColorInput = useRef<HTMLInputElement>(null);
  const themeColorChange = useRef<((input: HTMLInputElement) => void) | null>(null);
  latest.current = props;

  useEffect(() => {
    alive.current = true;
    const unlock = lockBody(document.body);
    const releaseBack = pushOverlay(() => {
      latest.current.onClose();
      return true;
    });
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onClose();
    };
    document.addEventListener('keydown', handleKey, true);
    closeButton.current?.focus();

    return () => {
      alive.current = false;
      releaseBack();
      unlock();
      document.removeEventListener('keydown', handleKey, true);
    };
  }, []);

  // 顯示順序：prop → 已成功寫入 → 同一 prop 的進行中 patch。
  const optimistic = pending?.source === team ? pending.patch : undefined;
  const patch: TeamSettingsPatch = {
    ...confirmed.current.patch,
    ...optimistic,
  };
  const detailVisibility = {
    ...(team.detailVisibility && typeof team.detailVisibility === 'object'
      ? team.detailVisibility
      : {}),
    ...confirmed.current.patch.detailVisibility,
    ...optimistic?.detailVisibility,
  };
  const category = patch.type ?? (getTeamCategoryMeta(team)?.key ?? 'competitive');
  const visibility = {
    ...getTeamDetailVisibility(team),
    ...detailVisibility,
  };
  const memberInvite = patch.allowMemberInvite ?? (team.allowMemberInvite !== false);
  const overlayEnabled = patch.themeOverlayEnabled ?? (team.themeOverlayEnabled !== false);
  const themeColor = patch.themeColor !== undefined
    ? patch.themeColor ?? ''
    : getTeamThemeColor(team);
  const eduSettings = patch.eduSettings !== undefined
    ? patch.eduSettings
    : team.eduSettings;

  function isBusy(control: Control | null): boolean {
    return !!pending?.busy && pending.control === control;
  }

  async function commit(
    updates: TeamSettingsPatch,
    revert: () => void,
    control: Control,
  ): Promise<void> {
    if (!canEditTeamSettings(viewer, team)) {
      revert();
      toast.show({
        message: lt('您沒有編輯此俱樂部的權限', '您沒有編輯此俱樂部的權限'),
        tone: 'error',
      });
      return;
    }
    if (writing.current) {
      revert();
      return;
    }

    writing.current = true;
    control.disabled = true;
    setPending({ source: team, patch: updates, control, busy: true });

    try {
      await saveTeamSettingsPatch(team, updates);
      if (!alive.current) return;

      if (confirmed.current.source === team && latest.current.team === team) {
        const previous = confirmed.current.patch;
        confirmed.current.patch = {
          ...previous,
          ...updates,
          ...(updates.detailVisibility !== undefined
            ? {
                detailVisibility: {
                  ...previous.detailVisibility,
                  ...updates.detailVisibility,
                },
              }
            : {}),
        };
      }

      try {
        await latest.current.onSaved();
      } catch (error) {
        // 寫入已完成；重讀失敗不可回報為寫入失敗或回復已寫入資料。
        console.error('[TeamSettingsModal] onSaved', error);
      }

      if (alive.current) {
        toast.show({
          message: lt('設定已更新', '設定已更新'),
          tone: 'success',
        });
      }
    } catch (error) {
      console.error('[TeamSettingsModal]', error);
      if (alive.current) {
        revert();
        toast.show({
          message: lt('設定更新失敗，請稍後再試', '設定更新失敗，請稍後再試'),
          tone: 'error',
        });
      }
    } finally {
      writing.current = false;
      if (alive.current) {
        control.disabled = false;
        // 成功值已移入 confirmed；失敗只移除本次樂觀值。
        setPending(null);
      }
    }
  }

  // 每次 render 更新閉包，原生 listener 始終使用最新 team、viewer 與 commit。
  themeColorChange.current = (input): void => {
    const color = normalizeTeamThemeColor(input.value);
    const revert = (): void => {
      input.value = themeColor || '#0d9488';
    };
    if (!color) {
      revert();
      toast.show({
        message: lt('主題色格式不正確', '主題色格式不正確'),
        tone: 'error',
      });
      return;
    }
    void commit({ themeColor: color }, revert, input);
  };

  useEffect(() => {
    const input = themeColorInput.current;
    if (!input) return;

    // 避開 compat 的 onChange 映射，只在原生 change 確認選色時寫入。
    const handleChange = (): void => {
      themeColorChange.current?.(input);
    };
    input.addEventListener('change', handleChange);
    return () => {
      input.removeEventListener('change', handleChange);
    };
  }, []);

  function renderSwitch(
    label: string,
    checked: boolean,
    makePatch: (next: boolean) => TeamSettingsPatch,
    field: 'allowMemberInvite' | 'themeOverlayEnabled' | VisibilityKey,
  ): JSX.Element {
    const disabled = !!pending?.busy && (
      field === 'allowMemberInvite'
        ? pending.patch.allowMemberInvite !== undefined
        : field === 'themeOverlayEnabled'
          ? pending.patch.themeOverlayEnabled !== undefined
          : pending.control.getAttribute('data-visibility-key') === field
    );

    return (
      <label class="td-settings-switch" aria-label={label}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          data-visibility-key={isVisibilityKey(field) ? field : undefined}
          onChange={(event) => {
            const input = event.currentTarget;
            const next = input.checked;
            // 用事件前的顯示值還原，包含權限拒絕與 ref 鎖拒絕的情況。
            const revert = (): void => { input.checked = checked; };
            commit(makePatch(next), revert, input);
          }}
        />
        <span class="td-settings-switch-track">
          <span class="td-settings-switch-thumb"></span>
        </span>
      </label>
    );
  }

  function changeCategory(value: TeamCategoryKey, button: HTMLButtonElement): void {
    const key = normalizeTeamCategory(value);
    // B 的小改良：目前分類不重複寫入；結果資料與 A 相同。
    if (key === category) return;
    const isTeaching = key === 'education';
    commit({
      type: key,
      teachingEnabled: isTeaching,
      eduSettings: isTeaching
        ? {
            ...(eduSettings ?? {}),
            acceptingStudents: eduSettings?.acceptingStudents !== false,
            teachingEnabled: true,
          }
        : null,
    }, () => {
      // 分類由 prop / confirmed / pending 推導；失敗只清除 pending。
    }, button);
  }

  const memberInviteLabel = lt('teamDetail.memberCanInvite', '隊員可邀請');
  const themeLabel = lt('俱樂部主題色', '俱樂部主題色');
  const overlayLabel = lt('半透明遮罩', '半透明遮罩');

  return createPortal(
    <div class="legacy-ui">
      <div
        class="modal open"
        id="team-detail-settings-modal"
        data-no-backdrop-close="1"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-detail-settings-title"
      >
        <div class="modal-header">
          <h3 id="team-detail-settings-title">{lt('俱樂部設定', '俱樂部設定')}</h3>
          <button
            ref={closeButton}
            type="button"
            class="modal-close"
            aria-label={lt('關閉', '關閉')}
            onClick={() => latest.current.onClose()}
          >
            ✕
          </button>
        </div>
        <div class="modal-body">
          <div id="team-detail-settings-body">
            <div class="td-settings-group">
              <div class="td-settings-row td-settings-row-primary td-category-settings-row">
                <div>
                  <strong>{lt('俱樂部標籤', '俱樂部標籤')}</strong>
                  <span>
                    {lt(
                      '四種標籤僅能擇一；「無」不顯示標籤與緞帶，只有教學標籤會開啟課程與學員功能。',
                      '四種標籤僅能擇一；「無」不顯示標籤與緞帶，只有教學標籤會開啟課程與學員功能。',
                    )}
                  </span>
                </div>
                <div
                  class="td-category-tag-group"
                  role="radiogroup"
                  aria-label={lt('俱樂部標籤', '俱樂部標籤')}
                >
                  {getTeamCategoryOptions().map((option) => {
                    // ASSUMPTION: 依附件實際簽章使用 labelKey / formHintKey，
                    // fallback 取 MiMo Q2 原文；分類 key 的回傳形狀無需調整。
                    const copy = CATEGORY_COPY[option.key];
                    const active = option.key === category;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        class={`td-category-tag-btn td-category-tag-${option.key}${active ? ' active' : ''}`}
                        aria-pressed={active}
                        disabled={!!pending?.busy
                          && pending.control.classList.contains(`td-category-tag-${option.key}`)}
                        onClick={(event) => changeCategory(option.key, event.currentTarget)}
                      >
                        <strong>{lt(option.labelKey, copy.label)}</strong>
                        <span>{lt(option.formHintKey, copy.hint)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div class="td-settings-row">
                <div>
                  <strong>{memberInviteLabel}</strong>
                  <span>
                    {lt(
                      '開啟後，現有隊員可以產生邀請 QR Code。',
                      '開啟後，現有隊員可以產生邀請 QR Code。',
                    )}
                  </span>
                </div>
                {renderSwitch(
                  memberInviteLabel,
                  memberInvite,
                  (checked) => ({ allowMemberInvite: checked }),
                  'allowMemberInvite',
                )}
              </div>
              <div class="td-settings-row td-theme-settings-row">
                <div>
                  <strong>{themeLabel}</strong>
                  <span>
                    {lt(
                      '選擇後會套用在俱樂部卡片與詳情重點容器；留空則使用系統預設配色。',
                      '選擇後會套用在俱樂部卡片與詳情重點容器；留空則使用系統預設配色。',
                    )}
                  </span>
                </div>
                <div class="td-theme-control">
                  <span
                    class="td-theme-current"
                    style={themeColor ? { background: themeColor } : undefined}
                  ></span>
                  <input
                    ref={themeColorInput}
                    class="td-theme-color-input"
                    type="color"
                    value={themeColor || '#0d9488'}
                    aria-label={themeLabel}
                    disabled={!!pending?.busy
                      && pending.control.classList.contains('td-theme-color-input')}
                  />
                  <button
                    type="button"
                    class="td-theme-reset-btn"
                    disabled={!!pending?.busy
                      && pending.control.classList.contains('td-theme-reset-btn')}
                    onClick={(event) => {
                      const button = event.currentTarget;
                      if (isBusy(button)) return;
                      commit({ themeColor: null }, () => {
                        // 清除 pending 後由 confirmed 覆蓋 prop 還原色碼與圓點。
                      }, button);
                    }}
                  >
                    {lt('預設', '預設')}
                  </button>
                </div>
              </div>
              <div class="td-settings-row td-theme-overlay-row">
                <div>
                  <strong>{overlayLabel}</strong>
                  <span>
                    {lt(
                      '開啟後會在主題色與文字之間加上淺色或深色遮罩，讓文字更清楚；關閉後顏色會更接近實際選色，但文字對比可能降低。',
                      '開啟後會在主題色與文字之間加上淺色或深色遮罩，讓文字更清楚；關閉後顏色會更接近實際選色，但文字對比可能降低。',
                    )}
                  </span>
                </div>
                {renderSwitch(
                  overlayLabel,
                  overlayEnabled,
                  (checked) => ({ themeOverlayEnabled: checked }),
                  'themeOverlayEnabled',
                )}
              </div>
            </div>
            <div class="td-settings-group">
              <div class="td-settings-title">{lt('欄位容器顯示', '欄位容器顯示')}</div>
              {VISIBILITY_ITEMS
                .filter((item) => item.key !== 'courses' || category === 'education')
                .map((item) => {
                  const label = lt(item.label, item.label);
                  return (
                    <div class="td-settings-row" key={item.key}>
                      <div>
                        <strong>{label}</strong>
                        <span>{lt(item.desc, item.desc)}</span>
                      </div>
                      {renderSwitch(label, visibility[item.key] !== false, (checked) => {
                        const current = { ...detailVisibility };
                        if (isVisibilityKey(item.key)) current[item.key] = checked;
                        return { detailVisibility: current };
                      }, item.key)}
                    </div>
                  );
                })}
            </div>
            <button
              class="outline-btn td-settings-edit-btn"
              type="button"
              onClick={() => latest.current.onEditBasic()}
            >
              {lt('編輯基本資料', '編輯基本資料')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
