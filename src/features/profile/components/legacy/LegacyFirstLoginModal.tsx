// 照 A index.html#first-login-modal（`profile-form.js#saveFirstLoginProfile`／`dismissFirstLoginModal`）。
// DOM、class、id、inline style 逐字對齊 A；資料層呼叫 `saveFirstLoginProfile`（不改寫入）。
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';

import { useLegacyT } from '@/i18n/i18n';
import { lockBody } from '@/ui/Modal';
import { toast } from '@/ui/Toast';

import { saveFirstLoginProfile, type FirstLoginInput } from '../../data/profile-writes';

export interface FirstLoginInitial {
  gender: string;
  birthday: string;
  region: string;
  email: string;
}

export interface LegacyFirstLoginModalProps {
  uid: string;
  initial: FirstLoginInitial;
  onClose: () => void;
  onSaved: (patch: Record<string, unknown>) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 照 A profile-form.js#_populateBirthdaySelects 的預填：`YYYY/MM/DD` 或 `YYYY-M-D`。 */
function parseBirthday(raw: string): { year: string; month: string; day: string } {
  const normalized = raw.replace(/\//g, '-');
  const parts = normalized.split('-');
  const year = parts[0] ?? '';
  const month = parts[1] ? parts[1].padStart(2, '0') : '';
  const day = parts[2] ? parts[2].padStart(2, '0') : '';
  return { year, month, day };
}

/** 對齊 A：月份未選時 day 列表用預設 31。 */
function daysInMonth(year: string, month: string): number {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 1 || !Number.isInteger(m) || m < 1 || m > 12) return 31;
  return new Date(y, m, 0).getDate();
}

export function LegacyFirstLoginModal(props: LegacyFirstLoginModalProps): JSX.Element {
  const { uid, initial, onClose, onSaved } = props;
  const lt = useLegacyT();

  const parsed = parseBirthday(initial.birthday);
  const [gender, setGender] = useState(initial.gender);
  const [year, setYear] = useState(parsed.year);
  const [month, setMonth] = useState(parsed.month);
  const [day, setDay] = useState(parsed.day);
  const [region, setRegion] = useState(initial.region);
  const [email, setEmail] = useState(initial.email);
  const [legalConsent, setLegalConsent] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [pending, setPending] = useState(false);

  const aliveRef = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const consentRef = useRef<HTMLInputElement>(null);
  const genderRef = useRef<HTMLSelectElement>(null);
  const yearRef = useRef<HTMLSelectElement>(null);
  const monthRef = useRef<HTMLSelectElement>(null);
  const dayRef = useRef<HTMLSelectElement>(null);
  const regionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    aliveRef.current = true;
    const unlock = lockBody(document.body);
    // 照 A `data-no-backdrop-close="1"`：不關遮罩、不關 Esc、不關返回鍵。
    return () => {
      aliveRef.current = false;
      unlock();
    };
  }, []);

  const currentYear = new Date().getFullYear();
  const yearOptions: string[] = [];
  for (let y = currentYear; y >= 1930; y -= 1) yearOptions.push(String(y));

  const maxDay = daysInMonth(year, month);
  const dayOptions: string[] = [];
  for (let d = 1; d <= maxDay; d += 1) dayOptions.push(pad2(d));

  function changeYear(value: string): void {
    setYear(value);
    if (Number(day) > daysInMonth(value, month)) setDay('');
  }

  function changeMonth(value: string): void {
    setMonth(value);
    if (Number(day) > daysInMonth(year, value)) setDay('');
  }

  function handleDismiss(): void {
    if (pending) return;
    setErrorText('');
    onCloseRef.current();
  }

  function handleSubmit(): void {
    if (pending) return;
    setErrorText('');

    // 照 A `_requireFirstLoginLegalConsent`：未勾選同意先跳 toast 並聚焦 checkbox。
    if (!legalConsent) {
      toast.show({
        message: lt(
          '請先勾選同意服務條款與隱私權政策。',
          '請先勾選同意服務條款與隱私權政策。',
        ),
      });
      try {
        consentRef.current?.focus({ preventScroll: false });
      } catch {
        // noop：jsdom 不支援 options 時退回預設。
      }
      return;
    }

    const birthday = year && month && day ? `${year}/${month}/${day}` : '';
    if (!gender || !birthday || !region.trim()) {
      toast.show({
        message: lt(
          '請填寫所有必填欄位（性別、生日、地區）',
          '請填寫所有必填欄位（性別、生日、地區）',
        ),
      });
      const target = !gender
        ? genderRef.current
        : !year
          ? yearRef.current
          : !month
            ? monthRef.current
            : !day
              ? dayRef.current
              : regionRef.current;
      try {
        target?.focus({ preventScroll: false });
      } catch {
        // noop
      }
      return;
    }

    const emailTrimmed = email.trim();
    if (emailTrimmed && !EMAIL_RE.test(emailTrimmed)) {
      setErrorText(
        lt('請輸入有效的電子郵件，或留空略過。', '請輸入有效的電子郵件，或留空略過。'),
      );
      return;
    }

    const input: FirstLoginInput = {
      gender,
      birthday,
      region: region.trim(),
      ...(emailTrimmed ? { email: emailTrimmed } : {}),
      legalConsent: true,
    };

    setPending(true);
    saveFirstLoginProfile(uid, input)
      .then(() => {
        if (!aliveRef.current) return;
        // legalConsent 是提交條件，不回填為已保存的個資。
        const { legalConsent: _consent, ...patch } = input;
        onSaved(patch);
        toast.show({ message: lt('個人資料已儲存', '個人資料已儲存') });
        onCloseRef.current();
      })
      .catch(() => {
        if (!aliveRef.current) return;
        setErrorText(
          lt(
            '儲存失敗，請檢查網路後重試。若持續失敗可重新整理頁面。',
            '儲存失敗，請檢查網路後重試。若持續失敗可重新整理頁面。',
          ),
        );
        setPending(false);
      });
  }

  return createPortal(
    <div class="legacy-ui">
      <div
        class="modal profile-complete-modal open"
        id="first-login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-login-title"
        data-no-backdrop-close="1"
      >
        <div class="modal-header">
          <h3 id="first-login-title">{lt('完善個人資料', '完善個人資料')}</h3>
        </div>
        <div class="modal-body">
          <p class="fl-hint">
            {lt(
              '完成基本資料後，即可報名活動、加入俱樂部與使用互動功能。',
              '完成基本資料後，即可報名活動、加入俱樂部與使用互動功能。',
            )}
          </p>
          <p class="fl-alert">
            {lt(
              '部分活動可能會依性別、年齡或地區設定參與條件，請協助填寫相關資料以利系統判定。',
              '部分活動可能會依性別、年齡或地區設定參與條件，請協助填寫相關資料以利系統判定。',
            )}
          </p>
          <div class="ce-form fl-form">
            <div class="ce-row fl-field">
              <label for="fl-gender">
                {lt('性別', '性別')} <span class="required">{lt('*必填', '*必填')}</span>
              </label>
              <select
                id="fl-gender"
                ref={genderRef}
                value={gender}
                disabled={pending}
                onChange={(event) => setGender(event.currentTarget.value)}
              >
                <option value="">{lt('請選擇', '請選擇')}</option>
                <option value="男">{lt('男', '男')}</option>
                <option value="女">{lt('女', '女')}</option>
                <option value="其他">{lt('其他', '其他')}</option>
              </select>
            </div>
            <div class="ce-row fl-field">
              <label>
                {lt('生日', '生日')} <span class="required">{lt('*必填', '*必填')}</span>
              </label>
              <div class="fl-birthday-row">
                <select
                  id="fl-birthday-y"
                  ref={yearRef}
                  value={year}
                  disabled={pending}
                  onChange={(event) => changeYear(event.currentTarget.value)}
                >
                  <option value="">{lt('年', '年')}</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{`${y}${lt('年', '年')}`}</option>
                  ))}
                </select>
                <select
                  id="fl-birthday-m"
                  ref={monthRef}
                  value={month}
                  disabled={pending}
                  onChange={(event) => changeMonth(event.currentTarget.value)}
                >
                  <option value="">{lt('月', '月')}</option>
                  {Array.from({ length: 12 }, (_, i) => {
                    const n = i + 1;
                    return (
                      <option key={n} value={pad2(n)}>
                        {`${n}${lt('月', '月')}`}
                      </option>
                    );
                  })}
                </select>
                <select
                  id="fl-birthday-d"
                  ref={dayRef}
                  value={day}
                  disabled={pending}
                  onChange={(event) => setDay(event.currentTarget.value)}
                >
                  <option value="">{lt('日', '日')}</option>
                  {dayOptions.map((d) => (
                    <option key={d} value={d}>{`${Number(d)}${lt('日', '日')}`}</option>
                  ))}
                </select>
              </div>
            </div>
            <div class="ce-row fl-field">
              <label for="fl-region-input">
                {lt('地區', '地區')} <span class="required">{lt('*必填', '*必填')}</span>
              </label>
              <input
                type="text"
                id="fl-region-input"
                ref={regionRef}
                placeholder={lt('輸入縣市名稱', '輸入縣市名稱')}
                autoComplete="off"
                value={region}
                disabled={pending}
                onInput={(event) => setRegion(event.currentTarget.value)}
              />
              {/* ASSUMPTION: B 無 filterTwRegions 資料源；#fl-region-list 保持空，改為自由輸入。 */}
              <div id="fl-region-list" />
            </div>
            <div class="ce-row fl-field fl-email-field">
              <label for="fl-email">
                {lt('電子郵件', '電子郵件')}{' '}
                <span class="fl-optional">{lt('非必填', '非必填')}</span>
              </label>
              <input
                type="email"
                id="fl-email"
                placeholder="you@example.com"
                autoComplete="email"
                inputMode="email"
                spellcheck={false}
                maxLength={254}
                value={email}
                disabled={pending}
                onInput={(event) => setEmail(event.currentTarget.value)}
              />
              <p class="fl-field-hint">
                {lt(
                  '填寫 Email 後，未來可收到第一手運動活動通知、早鳥名額提醒、候補釋出與平台重要訊息；不填也可以完成資料。',
                  '填寫 Email 後，未來可收到第一手運動活動通知、早鳥名額提醒、候補釋出與平台重要訊息；不填也可以完成資料。',
                )}
              </p>
            </div>
          </div>
        </div>
        <div id="fl-error-msg" style={{ display: errorText ? 'block' : 'none' }}>
          {errorText}
        </div>
        <div class="modal-actions fl-actions">
          <div class="fl-legal-consent">
            <input
              type="checkbox"
              id="fl-legal-consent"
              ref={consentRef}
              autoComplete="off"
              checked={legalConsent}
              disabled={pending}
              onChange={(event) => setLegalConsent(event.currentTarget.checked)}
            />
            <div class="fl-legal-copy">
              <label for="fl-legal-consent">
                {lt('我已閱讀並同意', '我已閱讀並同意')}
              </label>
              <a href="/terms" target="_blank" rel="noopener noreferrer">
                {lt('服務條款', '服務條款')}
              </a>{' '}
              {lt('與', '與')}{' '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer">
                {lt('隱私權政策', '隱私權政策')}
              </a>
              <p>
                {lt(
                  '包含個人資料蒐集、處理與利用告知；勾選後按下下方按鈕，即表示同意平台依上述條款處理資料。',
                  '包含個人資料蒐集、處理與利用告知；勾選後按下下方按鈕，即表示同意平台依上述條款處理資料。',
                )}
              </p>
            </div>
          </div>
          <div class="fl-action-buttons">
            <button
              type="button"
              class="fl-secondary-btn"
              disabled={pending}
              onClick={handleDismiss}
            >
              {lt('稍後填寫', '稍後填寫')}
            </button>
            <button
              type="button"
              class="primary-btn fl-submit-btn"
              disabled={pending}
              onClick={handleSubmit}
            >
              {pending ? lt('儲存中...', '儲存中...') : lt('同意並送出', '同意並送出')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
