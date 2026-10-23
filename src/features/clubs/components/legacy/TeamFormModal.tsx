/**
 * 新增／編輯俱樂部彈窗。DOM 照 A pages/team.html 建立俱樂部表單
 * （附件 .grok-input/A-team-form.html）。資料與送出全部走 useTeamForm。
 * open 為 false 時不掛載內層，hook 只在開啟時建立。
 */
import '../../legacy/team.css';
import '../../legacy/team-form.css';
import '@/features/events/legacy/activity.css';
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { useLegacyT } from '@/i18n/i18n';
import { lockBody } from '@/ui/Modal';

import type { TeamFormApi, TeamFormProps } from './use-team-form';
import { useTeamForm } from './use-team-form';

export function TeamFormModal(
  props: TeamFormProps & { open: boolean },
): JSX.Element | null {
  if (!props.open) return null;
  return <TeamFormModalBody {...props} />;
}

const PLATFORM_GLYPH: Record<string, string> = {
  line: 'LINE',
  facebook: 'f',
  instagram: 'IG',
  threads: '@',
  x: 'X',
  youtube: '▶',
  tiktok: '♪',
  discord: 'D',
  telegram: '✈',
  linktree: 'LT',
  link: '↗',
};

const PLATFORM_IMAGE: Record<string, string> = {
  instagram: '/img/Instagram-Logo--Streamline-Plump-Gradient.png',
  threads: '/img/Thread-Block-Logo--Streamline-Ultimate.png',
};

function settle(task: Promise<void>): void {
  // hook 內部已 toast；這裡只避免未處理拒絕（L-07）。
  task.catch(() => undefined);
}

function coverStyle(url: string | null): string | undefined {
  if (!url) return undefined;
  return `background-image:url(${JSON.stringify(url)})`;
}

function PlatformGlyph({ platform }: { platform: string }): JSX.Element {
  const key = Object.prototype.hasOwnProperty.call(PLATFORM_GLYPH, platform)
    ? platform
    : 'link';
  const image = PLATFORM_IMAGE[key];
  return (
    <span class={`event-social-link-icon event-social-link-icon-${key}`} aria-hidden="true">
      {image ? <img src={image} alt="" /> : PLATFORM_GLYPH[key]}
    </span>
  );
}

function UserSuggest(props: {
  id: string;
  users: readonly { uid: string; name: string }[];
  onPick(uid: string): void;
}): JSX.Element {
  const open = props.users.length > 0;
  return (
    <div id={props.id} class={`team-user-suggest${open ? ' show' : ''}`}>
      {props.users.map((user) => (
        <button
          key={user.uid}
          type="button"
          class="team-user-suggest-item"
          onMouseDown={(event) => {
            event.preventDefault();
            props.onPick(user.uid);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            props.onPick(user.uid);
          }}
        >
          <span class="tus-name">{user.name}</span>
          <span class="tus-uid">{user.uid}</span>
        </button>
      ))}
    </div>
  );
}

function StaffTags(props: {
  id: string;
  tags: TeamFormApi['leaders']['tags'];
  onRemove(key: string): void;
  style?: string;
}): JSX.Element {
  const lt = useLegacyT();
  const unresolved = lt('舊資料尚未連結用戶', '舊資料尚未連結用戶');
  return (
    <div id={props.id} style={props.style}>
      {props.tags.map((tag) => (
        <span
          key={tag.key}
          class="team-tag"
          title={tag.uid ? undefined : unresolved}
        >
          {tag.name}
          <button
            type="button"
            class="team-tag-x"
            aria-label={lt('移除', '移除')}
            onClick={() => props.onRemove(tag.key)}
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

function TeamFormModalBody(props: TeamFormProps & { open: boolean }): JSX.Element {
  const api = useTeamForm(props);
  const lt = useLegacyT();
  const latest = useRef(props);
  latest.current = props;
  const closeButton = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFileRef = useRef(api.image.pickFile);
  pickFileRef.current = api.image.pickFile;

  useEffect(() => {
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
      releaseBack();
      unlock();
      document.removeEventListener('keydown', handleKey, true);
    };
  }, []);

  useEffect(() => {
    const input = fileRef.current;
    if (!input) return;
    const handler = (): void => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      settle(pickFileRef.current(file));
    };
    input.addEventListener('change', handler);
    return () => {
      input.removeEventListener('change', handler);
    };
  }, []);

  const previewUrl = api.image.previewUrl;
  const requiredMark = (): JSX.Element => (
    <span class="required">{lt('*必填', '*必填')}</span>
  );

  function renderPreview(
    preview: { platform: string; label: string } | null,
  ): JSX.Element {
    if (!preview) {
      return <span class="ce-social-link-empty">{lt('待判斷', '待判斷')}</span>;
    }
    return (
      <>
        <PlatformGlyph platform={preview.platform} />
        <span>{preview.label}</span>
      </>
    );
  }

  return createPortal(
    <div class="legacy-ui">
      <div class="modal-overlay open" aria-hidden="true" />
      <div
        class="modal open"
        id="create-team-modal"
        data-no-backdrop-close="1"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ct-team-modal-title"
      >
        <div class="modal-header">
          <h3 id="ct-team-modal-title">{lt(api.title, api.title)}</h3>
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
          <div class="ce-form">
            <div class="ce-row">
              <label for="ct-team-image">{lt('俱樂部封面', '俱樂部封面')}</label>
              <div
                class={`ce-upload-placeholder${previewUrl ? ' has-image' : ''}`}
                id="ct-team-preview"
                role="button"
                tabIndex={0}
                style={coverStyle(previewUrl)}
                aria-label={previewUrl ? lt('上傳俱樂部圖片', '上傳俱樂部圖片') : undefined}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  fileRef.current?.click();
                }}
              >
                {previewUrl ? null : (
                  <>
                    <span class="ce-upload-icon">+</span>
                    <span class="ce-upload-text">{lt('上傳俱樂部圖片', '上傳俱樂部圖片')}</span>
                    <span class="ce-upload-hint">
                      {lt(
                        '一張原圖裁切封面 800 x 300 與卡片 800 x 800',
                        '一張原圖裁切封面 800 x 300 與卡片 800 x 800',
                      )}
                    </span>
                  </>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                id="ct-team-image"
                accept=".jpg,.jpeg,.png,.webp"
                hidden
              />
            </div>

            <div class="ce-row" id="ct-team-type-settings">
              <label>{lt('俱樂部標籤', '俱樂部標籤')}</label>
              <div
                class="ct-type-tag-group"
                id="ct-team-type-tags"
                role="radiogroup"
                aria-label={lt('俱樂部標籤', '俱樂部標籤')}
              >
                {api.categoryOptions.map((option) => {
                  const active = api.values.type === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      class={`ct-type-tag-btn ct-type-tag-${option.key}${active ? ' active' : ''}`}
                      data-team-type-option={option.key}
                      aria-pressed={active ? 'true' : 'false'}
                      onClick={() => api.setValue('type', option.key)}
                    >
                      <span>{lt(option.label, option.label)}</span>
                      <small>{lt(option.description, option.description)}</small>
                    </button>
                  );
                })}
              </div>
              <div class="ct-type-tag-hint" id="ct-team-type-hint">
                {lt(api.categoryHint, api.categoryHint)}
              </div>
            </div>

            {api.showEduSettings ? (
              <div class="ce-row" id="ct-edu-settings">
                <label for="ct-edu-accepting">{lt('學員招募狀態', '學員招募狀態')}</label>
                <div class="ct-edu-toggle-wrap">
                  <div class="ct-edu-toggle-row">
                    <span class="ct-edu-toggle-label">{lt('接受新學員報名', '接受新學員報名')}</span>
                    <label class="toggle-switch" style="margin:0;transform:scale(.85)">
                      <input
                        type="checkbox"
                        id="ct-edu-accepting"
                        checked={api.values.eduAccepting}
                        onChange={(event) => {
                          api.setValue('eduAccepting', event.currentTarget.checked);
                        }}
                      />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                  <div class="ct-edu-toggle-hint">
                    {lt(
                      '開啟後新學員可透過俱樂部頁面申請加入，關閉後將暫停招收新學員，已報名學員不受影響。',
                      '開啟後新學員可透過俱樂部頁面申請加入，關閉後將暫停招收新學員，已報名學員不受影響。',
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <div class="ce-row">
              <label for="ct-team-sport-tag">
                運動類型 {requiredMark()}
              </label>
              <select
                id="ct-team-sport-tag"
                style="width:100%;padding:.45rem .6rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.85rem;background:var(--surface);color:var(--text-primary)"
                value={api.values.sportTag}
                onChange={(event) => api.setValue('sportTag', event.currentTarget.value)}
              >
                {api.sportOptions.map((option) => (
                  <option key={option.key || 'unset'} value={option.key}>
                    {lt(option.label, option.label)}
                  </option>
                ))}
              </select>
            </div>

            <div class="ce-row">
              <label for="ct-team-name">
                俱樂部名稱（最多 15 字） {requiredMark()}
              </label>
              <input
                type="text"
                id="ct-team-name"
                maxLength={15}
                placeholder={lt('例：雷霆隊', '例：雷霆隊')}
                value={api.values.name}
                onInput={(event) => api.setValue('name', event.currentTarget.value)}
              />
            </div>

            <div class="ce-row">
              <label for="ct-team-name-en">{lt('英文名稱', '英文名稱')}</label>
              <input
                type="text"
                id="ct-team-name-en"
                placeholder={lt('例：Thunder FC', '例：Thunder FC')}
                value={api.values.nameEn}
                onInput={(event) => api.setValue('nameEn', event.currentTarget.value)}
              />
            </div>

            <div class="ce-row" style="display:flex;gap:.5rem">
              <div style="flex:1">
                <label for="ct-team-nationality">{lt('國籍', '國籍')}</label>
                <input
                  type="text"
                  id="ct-team-nationality"
                  maxLength={20}
                  placeholder={lt('例：台灣', '例：台灣')}
                  value={api.values.nationality}
                  onInput={(event) => api.setValue('nationality', event.currentTarget.value)}
                />
              </div>
              <div style="flex:1;position:relative">
                <label for="ct-team-region">
                  地區 {requiredMark()}
                </label>
                <input
                  type="text"
                  id="ct-team-region"
                  maxLength={20}
                  placeholder={lt('輸入或選擇縣市', '輸入或選擇縣市')}
                  autocomplete="off"
                  value={api.values.region}
                  onFocus={() => api.region.onFocus()}
                  onInput={(event) => api.region.onInput(event.currentTarget.value)}
                  onBlur={() => api.region.onBlur()}
                />
                <div
                  id="ct-team-region-suggest"
                  class={`team-user-suggest${api.region.open && api.region.suggestions.length > 0 ? ' show' : ''}`}
                >
                  {api.region.open ? api.region.suggestions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      class="team-user-suggest-item"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        api.region.pick(name);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        api.region.pick(name);
                      }}
                    >
                      {name}
                    </button>
                  )) : null}
                </div>
              </div>
            </div>

            <div class="ce-row">
              <label for="ct-team-founded">{lt('創立年份', '創立年份')}</label>
              <input
                type="number"
                id="ct-team-founded"
                min={1900}
                max={2099}
                placeholder={lt('例：2024', '例：2024')}
                value={api.values.founded}
                onInput={(event) => api.setValue('founded', event.currentTarget.value)}
              />
            </div>

            <div class="ce-row" id="ct-captain-row" style="position:relative">
              <label for={api.captain.transferVisible ? 'ct-captain-search' : undefined}>
                俱樂部經理 {requiredMark()}
              </label>
              <div
                id="ct-captain-display"
                style="font-size:.85rem;font-weight:600;color:var(--text-primary);padding:.3rem 0"
              >
                {api.captain.displayText}
              </div>
              {api.captain.transferVisible ? (
                <div id="ct-captain-transfer">
                  <div class="ct-captain-transfer-warning">
                    {lt(
                      '轉移俱樂部經理前請確認：俱樂部經理只能有一位，不是可複選的領隊欄位。儲存後管理權限會轉給新經理，原經理可能失去此俱樂部管理權限。',
                      '轉移俱樂部經理前請確認：俱樂部經理只能有一位，不是可複選的領隊欄位。儲存後管理權限會轉給新經理，原經理可能失去此俱樂部管理權限。',
                    )}
                  </div>
                  <div
                    class="ct-captain-hint"
                    style="font-size:.75rem;color:var(--text-muted);margin-bottom:.3rem"
                  >
                    {lt(
                      '如需轉移，請搜尋新任俱樂部經理（暱稱或 UID）並點選；未選擇新用戶則維持目前經理。',
                      '如需轉移，請搜尋新任俱樂部經理（暱稱或 UID）並點選；未選擇新用戶則維持目前經理。',
                    )}
                  </div>
                  <input
                    type="text"
                    id="ct-captain-search"
                    placeholder={lt('搜尋用戶...', '搜尋用戶...')}
                    autocomplete="off"
                    value={api.captain.transferPicker.query}
                    onInput={(event) => {
                      api.captain.transferPicker.setQuery(event.currentTarget.value);
                    }}
                  />
                  <UserSuggest
                    id="ct-captain-suggest"
                    users={api.captain.transferPicker.suggestions}
                    onPick={(uid) => settle(api.captain.select(uid))}
                  />
                  <div id="ct-captain-selected">
                    {api.captain.pendingName ? (
                      <span class="team-tag">
                        {api.captain.pendingName}
                        <button
                          type="button"
                          class="team-tag-x"
                          aria-label={lt('移除', '移除')}
                          onClick={() => api.captain.clear()}
                        >
                          ✕
                        </button>
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div
                id="ct-captain-locked"
                style={api.captain.lockedText
                  ? 'font-size:.8rem;color:var(--text-muted);padding:.3rem 0'
                  : 'display:none'}
              >
                {api.captain.lockedText
                  ? lt(api.captain.lockedText, api.captain.lockedText)
                  : null}
              </div>
            </div>

            <div class="ce-row" id="ct-leader-row" style="position:relative">
              <label for="ct-leader-search">
                俱樂部領隊 {requiredMark()}
              </label>
              <StaffTags
                id="ct-leaders-tags"
                tags={api.leaders.tags}
                onRemove={(key) => api.leaders.remove(key)}
                style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.4rem"
              />
              <div id="ct-leader-add-section">
                <div
                  class="ct-leader-hint"
                  style="font-size:.75rem;color:var(--text-muted);margin-bottom:.3rem"
                >
                  {lt(
                    '搜尋俱樂部領隊：輸入暱稱後點選加入（可複數）',
                    '搜尋俱樂部領隊：輸入暱稱後點選加入（可複數）',
                  )}
                </div>
                <input
                  type="text"
                  id="ct-leader-search"
                  placeholder={lt('搜尋用戶...', '搜尋用戶...')}
                  autocomplete="off"
                  value={api.leaders.picker.query}
                  onInput={(event) => api.leaders.picker.setQuery(event.currentTarget.value)}
                />
                <UserSuggest
                  id="ct-leader-suggest"
                  users={api.leaders.picker.suggestions}
                  onPick={(uid) => settle(api.leaders.add(uid))}
                />
              </div>
            </div>

            <div class="ce-row">
              <label for="ct-team-contact">{lt('聯繫方式', '聯繫方式')}</label>
              <input
                type="text"
                id="ct-team-contact"
                maxLength={100}
                placeholder={lt('例：LINE ID、電話、Email', '例：LINE ID、電話、Email')}
                value={api.values.contact}
                onInput={(event) => api.setValue('contact', event.currentTarget.value)}
              />
            </div>

            <div class="ce-row ce-value-item ce-social-links-row">
              <div class="ce-label-row">
                <label for="ct-contact-links-enabled">{lt('社群聯繫按鈕', '社群聯繫按鈕')}</label>
              </div>
              <div class="ce-toggle-control">
                <label class="toggle-switch" style="margin:0">
                  <input
                    type="checkbox"
                    id="ct-contact-links-enabled"
                    checked={api.values.contactLinksEnabled}
                    onChange={(event) => {
                      api.contactLinks.setEnabled(event.currentTarget.checked);
                    }}
                  />
                  <span class="toggle-slider"></span>
                </label>
                <span class="ce-toggle-status" id="ct-contact-links-label">
                  {api.values.contactLinksEnabled ? lt('開啟', '開啟') : lt('關閉', '關閉')}
                </span>
              </div>
              <div
                class="ce-social-links-options"
                id="ct-contact-links-options"
                style={api.values.contactLinksEnabled ? undefined : 'display:none'}
              >
                <div class="ce-social-links-list" id="ct-contact-links-list">
                  {api.contactLinks.drafts.map((draft, index) => (
                    <div class="ce-social-link-row" data-index={index} key={index}>
                      <input
                        type="url"
                        class="ce-social-link-input"
                        value={draft}
                        onInput={(event) => {
                          api.contactLinks.setDraft(index, event.currentTarget.value);
                        }}
                      />
                      <span class="ce-social-link-preview">
                        {renderPreview(api.contactLinks.previews[index] ?? null)}
                      </span>
                      <button
                        type="button"
                        class="ce-social-link-remove"
                        disabled={api.contactLinks.drafts.length <= 1}
                        onClick={() => {
                          if (api.contactLinks.drafts.length <= 1) return;
                          api.contactLinks.remove(index);
                        }}
                      >
                        {lt('移除', '移除')}
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  class="ce-social-links-add"
                  id="ct-contact-links-add"
                  disabled={!api.contactLinks.canAdd}
                  onClick={() => {
                    if (!api.contactLinks.canAdd) return;
                    api.contactLinks.add();
                  }}
                >
                  {lt('+ 新增連結', '+ 新增連結')}
                </button>
                <div class="ce-social-links-tip">
                  {lt(
                    '貼上 LINE、Facebook、Instagram、YouTube 等網址，系統會自動辨識並顯示為聯繫按鈕。最多 5 個。',
                    '貼上 LINE、Facebook、Instagram、YouTube 等網址，系統會自動辨識並顯示為聯繫按鈕。最多 5 個。',
                  )}
                </div>
              </div>
            </div>

            <div class="ce-row" style="position:relative">
              <label for="ct-coach-search">{lt('教練（可多位）', '教練（可多位）')}</label>
              <input
                type="text"
                id="ct-coach-search"
                placeholder={lt('搜尋用戶...', '搜尋用戶...')}
                autocomplete="off"
                value={api.coaches.picker.query}
                onInput={(event) => api.coaches.picker.setQuery(event.currentTarget.value)}
              />
              <UserSuggest
                id="ct-coach-suggest"
                users={api.coaches.picker.suggestions}
                onPick={(uid) => settle(api.coaches.add(uid))}
              />
              <StaffTags
                id="ct-coach-tags"
                tags={api.coaches.tags}
                onRemove={(key) => api.coaches.remove(key)}
              />
            </div>

            <div class="ce-row">
              <label for="ct-team-bio">{lt('俱樂部簡介', '俱樂部簡介')}</label>
              <textarea
                id="ct-team-bio"
                maxLength={500}
                rows={3}
                placeholder={lt('簡短介紹俱樂部（最多 500 字）', '簡短介紹俱樂部（最多 500 字）')}
                value={api.values.bio}
                onInput={(event) => api.setValue('bio', event.currentTarget.value)}
              />
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button
            type="button"
            class="outline-btn"
            onClick={() => latest.current.onClose()}
          >
            {lt('取消', '取消')}
          </button>
          <button
            type="button"
            class="primary-btn"
            id="ct-team-save-btn"
            disabled={api.busy || !api.canSubmit}
            style={api.busy || !api.canSubmit ? 'opacity:.72;cursor:not-allowed' : undefined}
            onClick={() => {
              if (api.busy || !api.canSubmit) return;
              settle(api.submit());
            }}
          >
            {api.busy ? lt(api.busyLabel, api.busyLabel) : lt(api.submitLabel, api.submitLabel)}
          </button>
        </div>
      </div>
      {api.image.cropper}
    </div>,
    document.body,
  );
}
