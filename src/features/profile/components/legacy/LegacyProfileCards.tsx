import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { lt, useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { UserProfile } from '../../data/profile-model';
import { updateProfileFields } from '../../data/profile-writes';
import { stringValue } from '../../ui/shared';
import { LegacyAvatar } from './LegacyProfileHeader';
import {
  TW_REGIONS,
  UNAVAILABLE_MSG,
  extractSecondaryIdentity,
  filterTwRegions,
  formatCreatedAt,
  getUserTeamEntries,
} from './profile-legacy-helpers';

function daysInMonth(year: string, month: string): number {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 1 || !Number.isInteger(m) || m < 1 || m > 12) return 31;
  return new Date(y, m, 0).getDate();
}

export function LegacyIdentityCard({
  profile,
  onOpenEditor,
}: {
  profile: UserProfile;
  onOpenEditor: () => void;
}): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const secondary = extractSecondaryIdentity(profile);
  const previewName = secondary.displayName || '次身份';
  const summaryName = secondary.enabled
    ? (secondary.displayName || '次身份')
    : (secondary.displayName || '使用主身份');

  return (
    <div
      class={`info-card${secondary.enabled ? ' is-secondary-enabled' : ''}`}
      id="profile-identity-card"
      data-permission-code="profile.secondary_identity"
    >
      <div
        class={`info-title profile-collapse-toggle${open ? ' open' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span style="display:flex;align-items:center;gap:.35rem">
          <button
            type="button"
            class="edu-info-btn"
            title={lt('說明', '說明')}
            data-i18n-title="說明"
            onClick={(e) => {
              e.stopPropagation();
              toast.show({ message: UNAVAILABLE_MSG });
            }}
          >
            ?
          </button>
          <span data-i18n="第二身份">{lt('第二身份', '第二身份')}</span>
        </span>
        <span class="profile-collapse-arrow">▶</span>
      </div>
      <div class="profile-collapse-content" style={open ? undefined : 'display:none'}>
        {/* 下一批補：A 的第二身份行內編輯與頭像上傳；本批開關與編輯按鈕先開啟 B 既有 IdentityEditor */}
        <div class="profile-identity-control">
          <label class={`profile-identity-toggle${secondary.enabled ? ' active' : ''}`}>
            <span data-i18n="啟用">{lt('啟用', '啟用')}</span>
            <span class="toggle-switch">
              <input
                type="checkbox"
                id="profile-secondary-enabled"
                checked={secondary.enabled}
                onChange={() => onOpenEditor()}
              />
              <span class="toggle-slider" />
            </span>
          </label>
        </div>
        <div class="profile-identity-summary">
          <LegacyAvatar
            id="profile-secondary-avatar-preview"
            url={secondary.avatarUrl}
            name={previewName}
            baseClass="profile-identity-avatar"
            imageContainerClass="profile-identity-avatar"
            crown
          />
          <div class="profile-identity-summary-copy">
            <div
              class="profile-identity-summary-name"
              id="profile-secondary-summary-name"
              data-i18n="使用主身份"
            >
              {summaryName}
            </div>
            <div
              class="profile-identity-summary-status"
              id="profile-secondary-summary-status"
              data-i18n="啟用後會直接以第二身份顯示"
            >
              {secondary.enabled ? (
                <>
                  目前身份已啟用
                  <ul class="profile-identity-capability-list">
                    <li>活動留言與回覆</li>
                    <li>用戶資料卡片</li>
                    <li>右上角與我的資料顯示</li>
                  </ul>
                </>
              ) : (
                lt('啟用後會直接以第二身份顯示', '啟用後會直接以第二身份顯示')
              )}
            </div>
          </div>
          <button
            type="button"
            class="outline-btn small profile-identity-edit-btn"
            id="profile-identity-edit-btn"
            aria-label={t('profile.identity')}
            data-i18n="編輯"
            onClick={onOpenEditor}
          >
            {lt('編輯', '編輯')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LegacyProfileInfoCard({
  uid,
  profile,
  onSaved,
}: {
  uid: string;
  profile: UserProfile;
  onSaved: (patch: Record<string, unknown>) => void;
}): JSX.Element {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);

  const [gender, setGender] = useState('');
  const [bdY, setBdY] = useState('');
  const [bdM, setBdM] = useState('');
  const [bdD, setBdD] = useState('');
  const [region, setRegion] = useState('');
  const [regionMatches, setRegionMatches] = useState<string[]>([]);
  const [phone, setPhone] = useState('');

  const currentYear = new Date().getFullYear();
  const teams = getUserTeamEntries(profile);
  const joinDateText = formatCreatedAt(profile['createdAt']);

  function startEdit(): void {
    setGender(stringValue(profile['gender']));
    const rawBd = stringValue(profile['birthday']);
    const parts = rawBd.split(/[-/]/);
    setBdY(parts[0] ?? '');
    setBdM(parts[1] ? String(Number(parts[1])) : '');
    setBdD(parts[2] ? String(Number(parts[2])) : '');
    setRegion(stringValue(profile['region']));
    setRegionMatches([]);
    setPhone(stringValue(profile['phone']));
    setEditing(true);
  }

  function cancelEdit(): void {
    setEditing(false);
    setRegionMatches([]);
  }

  function handleRegionInput(val: string): void {
    setRegion(val);
    setRegionMatches(filterTwRegions(val, true));
  }

  async function handleSave(): Promise<void> {
    if (pending) return;
    const regionVal = region.trim();
    const normalizedRegionCheck = regionVal.replace(/臺/g, '台');
    if (regionVal && !TW_REGIONS.includes(normalizedRegionCheck)) {
      toast.show({ message: '請從 22 縣市中選擇有效地區', tone: 'error' });
      return;
    }

    const patch: Record<string, unknown> = {
      gender: gender || null,
      region: regionVal || null,
      phone: phone.trim() || null,
    };
    if (bdY && bdM && bdD) {
      // A `_getBirthdayFromSelects`：YYYY/MM/DD。
      patch['birthday'] = `${bdY}/${bdM.padStart(2, '0')}/${bdD.padStart(2, '0')}`;
    }

    setPending(true);
    try {
      await updateProfileFields(uid, patch);
      onSaved(patch);
      setEditing(false);
      setRegionMatches([]);
      toast.show({ message: '個人資料已更新', tone: 'success' });
    } catch {
      toast.show({ message: '個人資料更新失敗，請稍後再試', tone: 'error' });
    } finally {
      setPending(false);
    }
  }

  const renderTeams = (): JSX.Element | string => {
    if (teams.length === 0) return '無';
    return (
      <>
        {teams.map((team, idx) => (
          <span
            key={team.id || `${team.name}-${idx}`}
            class="uc-team-link"
            onClick={() => {
              if (team.id) location.route(`/teams/${encodeURIComponent(team.id)}`);
            }}
          >
            {team.name}
          </span>
        ))}
      </>
    );
  };

  return (
    <div class="info-card" id="profile-info-card">
      <div
        class={`info-title profile-collapse-toggle${open ? ' open' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span style="display:flex;align-items:center;gap:.35rem">
          <button
            type="button"
            class="edu-info-btn"
            title={lt('說明', '說明')}
            data-i18n-title="說明"
            onClick={(e) => {
              e.stopPropagation();
              toast.show({ message: UNAVAILABLE_MSG });
            }}
          >
            ?
          </button>
          <span data-i18n="profile.myProfile">{lt('profile.myProfile', '我的資料')}</span>
        </span>
        <span class="profile-collapse-arrow">▶</span>
      </div>
      <div class="profile-collapse-content" style={open ? undefined : 'display:none'}>
        <div id="profile-info-display" style={editing ? 'display:none' : undefined}>
          <div class="info-row">
            <span data-i18n="profile.gender">{lt('profile.gender', '性別')}</span>
            <span id="profile-gender">{stringValue(profile['gender']) || '-'}</span>
          </div>
          <div class="info-row">
            <span data-i18n="profile.birthday">{lt('profile.birthday', '生日')}</span>
            <span id="profile-birthday">{stringValue(profile['birthday']) || '-'}</span>
          </div>
          <div class="info-row">
            <span data-i18n="profile.region">{lt('profile.region', '地區')}</span>
            <span id="profile-region">{stringValue(profile['region']) || '-'}</span>
          </div>
          <div class="info-row">
            <span data-i18n="profile.sports">{lt('profile.sports', '運動類別')}</span>
            <span id="profile-sports">{stringValue(profile['sports']) || '-'}</span>
          </div>
          <div class="info-row">
            <span data-i18n="profile.team">{lt('profile.team', '所屬俱樂部')}</span>
            <span id="profile-team">{renderTeams()}</span>
          </div>
          <div class="info-row">
            <span data-i18n="profile.phone">{lt('profile.phone', '聯繫方式')}</span>
            <span id="profile-phone">{stringValue(profile['phone']) || '-'}</span>
          </div>
          <div class="info-row">
            <span data-i18n="profile.joinDate">{lt('profile.joinDate', '加入時間')}</span>
            <span id="profile-join-date">{joinDateText}</span>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:.4rem">
            <button
              type="button"
              class="outline-btn"
              style="font-size:.7rem;padding:.2rem .6rem"
              id="profile-edit-btn"
              data-i18n="編輯"
              onClick={startEdit}
            >
              {lt('編輯', '編輯')}
            </button>
          </div>
        </div>

        <div id="profile-info-edit" style={editing ? undefined : 'display:none'}>
          <div class="info-row">
            <span data-i18n="profile.gender">{lt('profile.gender', '性別')}</span>
            <select
              id="profile-edit-gender"
              class="profile-edit-input"
              aria-label="性別"
              value={gender}
              onChange={(e) => setGender(e.currentTarget.value)}
            >
              <option value="" data-i18n="請選擇">{lt('請選擇', '請選擇')}</option>
              <option value="男" data-i18n="男">{lt('男', '男')}</option>
              <option value="女" data-i18n="女">{lt('女', '女')}</option>
              <option value="其他" data-i18n="其他">{lt('其他', '其他')}</option>
            </select>
          </div>
          <div class="info-row">
            <span data-i18n="profile.birthday">{lt('profile.birthday', '生日')}</span>
            <div style="display:flex;gap:.2rem;flex:1">
              <select
                id="profile-edit-birthday-y"
                class="profile-edit-input"
                style="flex:1.2"
                aria-label="生日年"
                value={bdY}
                onChange={(e) => {
                  const nextY = e.currentTarget.value;
                  setBdY(nextY);
                  if (Number(bdD) > daysInMonth(nextY, bdM)) setBdD('');
                }}
              >
                <option value="" data-i18n="年">{lt('年', '年')}</option>
                {Array.from({ length: Math.max(0, currentYear - 1899) }, (_, i) => {
                  const y = String(currentYear - i);
                  return <option key={y} value={y}>{y}</option>;
                })}
              </select>
              <select
                id="profile-edit-birthday-m"
                class="profile-edit-input"
                style="flex:1"
                aria-label="生日月"
                value={bdM}
                onChange={(e) => {
                  const nextM = e.currentTarget.value;
                  setBdM(nextM);
                  if (Number(bdD) > daysInMonth(bdY, nextM)) setBdD('');
                }}
              >
                <option value="" data-i18n="月">{lt('月', '月')}</option>
                {Array.from({ length: 12 }, (_, i) => {
                  const m = String(i + 1);
                  return <option key={m} value={m}>{m}</option>;
                })}
              </select>
              <select
                id="profile-edit-birthday-d"
                class="profile-edit-input"
                style="flex:1"
                aria-label="生日日"
                value={bdD}
                onChange={(e) => setBdD(e.currentTarget.value)}
              >
                <option value="" data-i18n="日">{lt('日', '日')}</option>
                {Array.from({ length: daysInMonth(bdY, bdM) }, (_, i) => {
                  const d = String(i + 1);
                  return <option key={d} value={d}>{d}</option>;
                })}
              </select>
            </div>
          </div>
          <div class="info-row">
            <span data-i18n="profile.region">{lt('profile.region', '地區')}</span>
            <input
              type="text"
              id="profile-edit-region"
              class="profile-edit-input"
              aria-label="地區"
              placeholder={lt('輸入搜尋縣市...', '輸入搜尋縣市...')}
              data-i18n-placeholder="輸入搜尋縣市..."
              autoComplete="off"
              value={region}
              onInput={(e) => handleRegionInput(e.currentTarget.value)}
            />
          </div>
          <div
            id="profile-region-list"
            style={`max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);${regionMatches.length > 0 ? '' : 'display:none'}`}
          >
            {regionMatches.map((name) => (
              <div
                key={name}
                data-region={name}
                style="padding:6px 10px;font-size:.78rem;border-bottom:1px solid var(--border);cursor:pointer"
                onClick={() => {
                  setRegion(name);
                  setRegionMatches([]);
                }}
              >
                {name}
              </div>
            ))}
          </div>
          <div class="info-row">
            <span data-i18n="profile.sports">{lt('profile.sports', '運動類別')}</span>
            <span id="profile-sports-display">{stringValue(profile['sports']) || '-'}</span>
          </div>
          <div class="info-row">
            <span data-i18n="profile.team">{lt('profile.team', '所屬俱樂部')}</span>
            <span id="profile-team-display">{renderTeams()}</span>
          </div>
          <div class="info-row">
            <span data-i18n="profile.phone">{lt('profile.phone', '聯繫方式')}</span>
            <input
              type="tel"
              id="profile-edit-phone"
              class="profile-edit-input"
              aria-label="聯繫方式"
              placeholder={lt('例：0912-345-678', '例：0912-345-678')}
              data-i18n-placeholder="例：0912-345-678"
              value={phone}
              onInput={(e) => setPhone(e.currentTarget.value)}
            />
          </div>
          <div class="info-row">
            <span data-i18n="profile.joinDate">{lt('profile.joinDate', '加入時間')}</span>
            <span id="profile-join-date-edit">{joinDateText}</span>
          </div>
          <div style="display:flex;gap:.5rem;margin-top:.5rem;justify-content:flex-end">
            <button
              type="button"
              class="outline-btn"
              style="font-size:.75rem;padding:.3rem .8rem"
              disabled={pending}
              data-i18n="取消"
              onClick={cancelEdit}
            >
              {lt('取消', '取消')}
            </button>
            <button
              type="button"
              class="primary-btn small"
              disabled={pending}
              data-i18n="儲存"
              onClick={() => {
                handleSave().catch(() => {});
              }}
            >
              {lt('儲存', '儲存')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
