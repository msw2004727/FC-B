import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { Modal } from '@/ui/Modal';
import { BottomSheet } from '@/ui/BottomSheet';
import { Text } from '@/ui/Text';

import type { UserProfile } from '../data/profile-model';
import {
  clearSocialLink,
  saveCompanions,
  saveEduChildren,
  saveFirstLoginProfile,
  saveSocialLink,
  type FirstLoginInput,
} from '../data/profile-writes';
import {
  objectValue,
  socialHref,
  stringValue,
  type Platform,
} from './shared';
import './profile-editors.css';
import { generateId } from '@/data/ids';

type Saved = (patch: Record<string, unknown>) => void;

// ASSUMPTION: Modal／BottomSheet 沿用附件中的元件契約。
// 原生 option、placeholder、無障礙屬性及輸入值不包 Text；其他可見文案使用 Text。
function useSubmission() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  async function submit(work: () => Promise<void>, done: () => void): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setFailed(false);
    try {
      await work();
      if (alive.current) done();
    } catch {
      // 不重設表單 state；失敗後保留全部輸入，包括法律同意勾選。
      if (alive.current) setFailed(true);
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }

  return { pending, failed, submit };
}

function Field({
  label,
  children,
  required = false,
}: {
  label: string;
  children: ComponentChildren;
  required?: boolean;
}) {
  const t = useT();
  return (
    <label class="profile-field">
      <Text>{label}</Text>
      {required && <Text class="profile-required" aria-hidden="true">{t('profile.required')}</Text>}
      {children}
    </label>
  );
}

function SaveError({ failed }: { failed: boolean }) {
  const t = useT();
  return failed
    ? <p class="profile-error" role="alert"><Text>{t('profile.saveError')}</Text></p>
    : null;
}

function Actions({
  pending,
  onClose,
  dismiss = false,
}: {
  pending: boolean;
  onClose: () => void;
  dismiss?: boolean;
}) {
  const t = useT();
  return (
    <div class="profile-actions">
      <button type="button" disabled={pending} onClick={onClose}>
        <Text>{t(dismiss ? 'profile.later' : 'profile.cancel')}</Text>
      </button>
      <button type="submit" class="profile-primary" disabled={pending}>
        <Text>{t(pending ? 'profile.saving' : dismiss ? 'profile.agreeSubmit' : 'profile.save')}</Text>
      </button>
    </div>
  );
}

function daysInMonth(year: string, month: string): number {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 1 || !Number.isInteger(m) || m < 1 || m > 12) return 31;
  return new Date(y, m, 0).getDate();
}

function validBirthday(year: string, month: string, day: string): boolean {
  if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) return false;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > daysInMonth(year, month)) return false;
  const now = new Date();
  const date = new Date(y, m - 1, d);
  return date.getTime() <= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function needsFirstLogin(profile: UserProfile): boolean {
  return ['gender', 'birthday', 'region'].some((key) => !stringValue(profile[key]));
}

export function FirstLoginEditor({
  uid,
  profile,
  onClose,
  onSaved,
}: {
  uid: string;
  profile: UserProfile;
  onClose: () => void;
  onSaved: Saved;
}) {
  const t = useT();
  const mutation = useSubmission();
  const [gender, setGender] = useState(stringValue(profile['gender']));
  const initialBirthday = stringValue(profile['birthday']).split(/[-/]/);
  const [year, setYear] = useState(initialBirthday[0] ?? '');
  const [month, setMonth] = useState(() => initialBirthday[1] ? String(Number(initialBirthday[1])) : '');
  const [day, setDay] = useState(() => initialBirthday[2] ? String(Number(initialBirthday[2])) : '');
  const [region, setRegion] = useState(stringValue(profile['region']));
  const [email, setEmail] = useState(stringValue(profile['email']));
  const [legalConsent, setLegalConsent] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const currentYear = new Date().getFullYear();

  // A 的欄位順序：性別、生日年月日、地區、選填 email、法律同意。
  // ASSUMPTION: 附件沒有年份清單生成程式；使用今年至 1900 年，拒絕未來生日。
  // ASSUMPTION: 附件沒有地區候選資料／驗證函式；保留自由輸入且要求 trim 後非空。
  // UI 只傳 legalConsent: true；資料層依 A _buildFirstLoginLegalUpdates 寫入法律版本、來源與同意時間。
  // dismiss 僅存在本次頁面掛載期間，不寫入完成／同意旗標。

  function changeYear(value: string): void {
    setYear(value);
    if (Number(day) > daysInMonth(value, month)) setDay('');
  }

  function changeMonth(value: string): void {
    setMonth(value);
    if (Number(day) > daysInMonth(year, value)) setDay('');
  }

  return (
    <Modal
      open
      title={t('profile.firstLogin')}
      loading={mutation.pending}
      closeOnEsc={false}
      closeOnOverlay={false}
      onClose={() => { if (!mutation.pending) onClose(); }}
    >
      <form
        class="profile-form profile-editor-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const valid = event.currentTarget.reportValidity()
            && ['男', '女', '其他'].includes(gender)
            && validBirthday(year, month, day)
            && region.trim().length > 0
            && legalConsent;
          setInvalid(!valid);
          if (!valid) return;

          const input: FirstLoginInput = {
            gender,
            birthday: `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`,
            region: region.trim(),
            ...(email.trim() ? { email: email.trim() } : {}),
            legalConsent: true,
          };

          mutation.submit(
            () => saveFirstLoginProfile(uid, input),
            () => {
              // legalConsent 是提交條件，不當作已持久化的個人資料回填。
              const { legalConsent: _consent, ...patch } = input;
              onSaved(patch);
            },
          ).catch(() => { /* submit 已處理失敗。 */ });
        }}
      >
        <p><Text>{t('profile.firstHint')}</Text></p>
        <p class="profile-note"><Text>{t('profile.eligibilityHint')}</Text></p>

        <fieldset disabled={mutation.pending}>
          <Field label={t('profile.gender')} required>
            <select
              aria-label={t('profile.gender')}
              required
              value={gender}
              onChange={(event) => setGender(event.currentTarget.value)}
            >
              <option value="">{t('profile.choose')}</option>
              <option value="男">{t('profile.male')}</option>
              <option value="女">{t('profile.female')}</option>
              <option value="其他">{t('profile.other')}</option>
            </select>
          </Field>

          <fieldset class="profile-birthday">
            <legend>
              <Text>{t('profile.birthday')}</Text>
              <Text class="profile-required" aria-hidden="true">{t('profile.required')}</Text>
            </legend>
            <div class="profile-birthday-controls">
              <Field label={t('profile.year')}>
                <select required value={year} onChange={(event) => changeYear(event.currentTarget.value)}>
                  <option value="">{t('profile.year')}</option>
                  {Array.from({ length: Math.max(0, currentYear - 1899) }, (_, index) => {
                    const value = String(currentYear - index);
                    return <option key={value} value={value}>{value}</option>;
                  })}
                </select>
              </Field>
              <Field label={t('profile.month')}>
                <select required value={month} onChange={(event) => changeMonth(event.currentTarget.value)}>
                  <option value="">{t('profile.month')}</option>
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index + 1} value={String(index + 1)}>{String(index + 1)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('profile.day')}>
                <select required value={day} onChange={(event) => setDay(event.currentTarget.value)}>
                  <option value="">{t('profile.day')}</option>
                  {Array.from({ length: daysInMonth(year, month) }, (_, index) => (
                    <option key={index + 1} value={String(index + 1)}>{String(index + 1)}</option>
                  ))}
                </select>
              </Field>
            </div>
          </fieldset>

          <Field label={t('profile.region')} required>
            <input
              aria-label={t('profile.region')}
              required
              value={region}
              autoComplete="off"
              placeholder={t('profile.regionPlaceholder')}
              onInput={(event) => setRegion(event.currentTarget.value)}
            />
          </Field>
          <Field label={t('profile.email')}>
            <input
              type="email"
              value={email}
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              spellcheck={false}
              placeholder="you@example.com"
              onInput={(event) => setEmail(event.currentTarget.value)}
            />
          </Field>
          <p class="profile-note"><Text>{t('profile.emailHint')}</Text></p>
        </fieldset>

        <div class="profile-legal">
          <label class="profile-legal-checkbox">
            <input
              type="checkbox"
              required
              checked={legalConsent}
              disabled={mutation.pending}
              autoComplete="off"
              onChange={(event) => setLegalConsent(event.currentTarget.checked)}
            />
            <Text>{t('profile.legalConsent')}</Text>
          </label>
          <div class="profile-legal-links">
            <a href="/terms" target="_blank" rel="noopener noreferrer">
              <Text>{t('profile.terms')}</Text>
            </a>
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              <Text>{t('profile.privacy')}</Text>
            </a>
          </div>
          <p class="profile-note"><Text>{t('profile.legalNotice')}</Text></p>
        </div>

        {invalid && <p role="alert"><Text>{t('profile.invalidFirstLogin')}</Text></p>}
        <SaveError failed={mutation.failed} />
        <Actions pending={mutation.pending} onClose={onClose} dismiss />
      </form>
    </Modal>
  );
}

interface DraftRow {
  key: string;
  original: unknown;
  name: string;
  gender: string;
  notes: string;
  changed: boolean;
  added: boolean;
}


export function PeopleEditor({
  uid,
  profile,
  kind,
  onClose,
  onSaved,
}: {
  uid: string;
  profile: UserProfile;
  kind: 'companions' | 'eduChildren';
  onClose: () => void;
  onSaved: Saved;
}) {
  const t = useT();
  const mutation = useSubmission();
  const sequence = useRef(0);
  const [rows, setRows] = useState<DraftRow[]>(() => {
    const values = profile[kind];
    return Array.isArray(values) ? values.map((original, index) => ({
      key: `existing-${index}`,
      original,
      name: stringValue(objectValue(original)['name']),
      gender: stringValue(objectValue(original)['gender']),
      notes: stringValue(objectValue(original)['notes']),
      changed: false,
      added: false,
    })) : [];
  });

  // A 同行者欄位：隱藏 id、必填 name（20 字）、選填 gender（空／男／女）、
  // 選填 notes（50 字）。保留既有 ID、未知欄位與未編輯資料。
  // 子女由教育課程審核自動綁定；此處只列姓名與俱樂部並依 id 解除綁定，剩餘原始物件原樣送出。
  const title = t(kind === 'companions' ? 'profile.companions' : 'profile.children');

  function addRow(): void {
    sequence.current += 1;
    // R-ID-006：用 generateId；comp_ 前綴是 A 與 Functions 辨識同行者的依據（isCompanionPseudoUid）。
    const id = generateId('comp_');
    setRows((previous) => [...previous, {
      key: `new-${sequence.current}`,
      original: { id },
      name: '',
      gender: '',
      notes: '',
      changed: true,
      added: true,
    }]);
  }

  function changeRow(key: string, patch: Partial<Pick<DraftRow, 'name' | 'gender' | 'notes'>>): void {
    setRows((previous) => previous.map((row) =>
      row.key === key ? { ...row, ...patch, changed: true } : row));
  }

  return (
    <BottomSheet
      open
      title={title}
      loading={mutation.pending}
      closeOnEsc={!mutation.pending}
      closeOnOverlay={!mutation.pending}
      onClose={() => { if (!mutation.pending) onClose(); }}
    >
      <form
        class="profile-form profile-editor-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!event.currentTarget.reportValidity()) return;
          if (kind === 'companions' && rows.some((row) => (row.changed || row.added) && (
            !row.name.trim()
            || row.name.length > 20
            || row.notes.length > 50
            || !['', '男', '女'].includes(row.gender)
          ))) return;

          const values = kind === 'eduChildren'
            ? rows.map((row) => row.original)
            : rows.map((row) => row.changed || row.added
              ? {
                ...objectValue(row.original),
                name: row.name.trim(),
                gender: row.gender,
                notes: row.notes,
              }
              : row.original);

          mutation.submit(
            () => kind === 'companions'
              ? saveCompanions(uid, values)
              : saveEduChildren(uid, values),
            () => onSaved({ [kind]: values }),
          ).catch(() => { /* submit 已處理。 */ });
        }}
      >
        <fieldset disabled={mutation.pending}>
          {rows.length === 0 && (
            <Text>{t(kind === 'eduChildren' ? 'profile.emptyChildren' : 'profile.emptyPeople')}</Text>
          )}
          {kind === 'eduChildren' ? (
            rows.map((row, index) => (
              <div class="profile-person-row profile-person-fields" key={row.key}>
                <Text>{row.name}</Text>
                <Text>{stringValue(objectValue(row.original)['teamName'])}</Text>
                <button
                  type="button"
                  class="profile-danger"
                  aria-label={`${t('profile.unlinkChild')} ${index + 1}`}
                  onClick={() => {
                    const childId = objectValue(row.original)['id'];
                    setRows((previous) => previous.filter((item) =>
                      objectValue(item.original)['id'] !== childId));
                  }}
                >
                  <Text>{t('profile.unlinkChild')}</Text>
                </button>
              </div>
            ))
          ) : (
            <>
              {rows.map((row, index) => (
                <div class="profile-person-row profile-person-fields" key={row.key}>
                  <input type="hidden" value={stringValue(objectValue(row.original)['id'])} />
                  <Field label={`${t('profile.name')} ${index + 1}`} required>
                    <input
                      aria-label={`${t('profile.name')} ${index + 1}`}
                      value={row.name}
                      required={row.changed || row.added}
                      maxLength={20}
                      onInput={(event) => changeRow(row.key, { name: event.currentTarget.value })}
                    />
                  </Field>
                  <Field label={`${t('profile.gender')} ${index + 1}`}>
                    <select
                      value={row.gender}
                      onChange={(event) => changeRow(row.key, { gender: event.currentTarget.value })}
                    >
                      <option value="">{t('profile.omit')}</option>
                      <option value="男">{t('profile.male')}</option>
                      <option value="女">{t('profile.female')}</option>
                    </select>
                  </Field>
                  <Field label={`${t('profile.notes')} ${index + 1}`}>
                    <textarea
                      rows={2}
                      maxLength={50}
                      value={row.notes}
                      onInput={(event) => changeRow(row.key, { notes: event.currentTarget.value })}
                    />
                  </Field>
                  <button
                    type="button"
                    class="profile-danger"
                    aria-label={`${t('profile.remove')} ${index + 1}`}
                    onClick={() => setRows((previous) => previous.filter((item) => item.key !== row.key))}
                  >
                    <Text>{t('profile.remove')}</Text>
                  </button>
                </div>
              ))}
              <button type="button" onClick={addRow}><Text>{t('profile.add')}</Text></button>
            </>
          )}
        </fieldset>
        <SaveError failed={mutation.failed} />
        <Actions pending={mutation.pending} onClose={onClose} />
      </form>
    </BottomSheet>
  );
}

export function SocialEditor({
  uid,
  profile,
  platform,
  onClose,
  onSaved,
}: {
  uid: string;
  profile: UserProfile;
  platform: Platform;
  onClose: () => void;
  onSaved: Saved;
}) {
  const t = useT();
  const mutation = useSubmission();
  const links = objectValue(profile['socialLinks']);
  const [value, setValue] = useState(stringValue(links[platform]));
  const [invalid, setInvalid] = useState(false);

  function save(clear: boolean): void {
    const raw = value.trim();
    if (!clear && !socialHref(platform, raw)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    mutation.submit(
      () => clear ? clearSocialLink(uid, platform) : saveSocialLink(uid, platform, raw),
      () => onSaved({
        socialLinks: {
          ...links,
          [platform]: clear ? '' : platform === 'line' ? socialHref(platform, raw) ?? '' : raw,
        },
      }),
    ).catch(() => { /* submit 已處理。 */ });
  }

  return (
    <Modal
      open
      title={`${t('profile.socialEdit')}：${t(`profile.platform.${platform}`)}`}
      loading={mutation.pending}
      closeOnEsc={!mutation.pending}
      closeOnOverlay={!mutation.pending}
      onClose={() => { if (!mutation.pending) onClose(); }}
    >
      <form class="profile-form profile-editor-form" onSubmit={(event) => {
        event.preventDefault();
        if (event.currentTarget.reportValidity()) save(false);
      }}>
        <Field label={t('profile.socialValue')}>
          <input
            value={value}
            maxLength={2048}
            disabled={mutation.pending}
            required
            onInput={(event) => setValue(event.currentTarget.value)}
          />
        </Field>
        {invalid && <p role="alert"><Text>{t('profile.invalidLink')}</Text></p>}
        <SaveError failed={mutation.failed} />
        <div class="profile-actions">
          <button type="button" class="profile-danger" disabled={mutation.pending} onClick={() => save(true)}>
            <Text>{t('profile.clear')}</Text>
          </button>
          <button type="submit" class="profile-primary" disabled={mutation.pending}>
            <Text>{t(mutation.pending ? 'profile.saving' : 'profile.save')}</Text>
          </button>
        </div>
      </form>
    </Modal>
  );
}

// M-123：IdentityEditor 已移除，改由 `components/legacy/LegacyIdentityCard.tsx`
// 照 A `#profile-identity-card` 行內編輯流程輸出。
