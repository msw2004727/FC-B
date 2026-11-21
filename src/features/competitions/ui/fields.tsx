import type { JSX } from 'preact';
import { useT } from '@/i18n/i18n';
import { ctOrKey, useCompetitionsT } from '../i18n';
import { CpI18nPending } from './shell';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Input } from '@/ui/Input';
import { Text } from '@/ui/Text';
import { formatFee } from '../format';
import type { PositionChoice } from '../payload';

/** 自訂位置上限：360px 名單列（背號 99＋10 字顯示名）實測 6 字溢出 6px、5 字可放，取 5（與後端 POSITION_TEXT_MAX 一致） */
export const POSITION_TEXT_MAX = 5;

const POSITIONS: readonly PositionChoice[] = ['none', 'GK', 'DF', 'MF', 'FW', 'custom'];

function changedValue(event: Event, onValueChange: (value: string) => void): void {
  const target = event.target;
  if (target instanceof HTMLInputElement && !target.disabled) onValueChange(target.value);
}

export function DateTimeField({
  id,
  label,
  value,
  onValueChange,
  error,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** 欄位層級錯誤：紅框＋紅底驚嘆號圓點那一句（與 Input 的 error 同一套樣式）。 */
  error?: string;
  /** 必填標記與 Input、DateField 同一種（標籤後的「* 必填」）。 */
  required?: boolean;
}): JSX.Element {
  const t = useT();
  // iOS 的時間選擇器可能只送 change、不送 input。正式環境載了 preact/compat，<input> 上的 onChange 會被改寫成 input 監聽，
  // 所以 change 接在外層（change 會冒泡），兩種事件都寫進表單。
  return (
    <div class={`ui-input${error ? ' ui-input--error' : ''}`} onChange={(event) => changedValue(event, onValueChange)}>
      <label for={id}>
        <Text>{label}</Text>
        {required ? <small><Text>{t('ui.input.required')}</Text></small> : null}
      </label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onInput={(event) => onValueChange(event.currentTarget.value)}
      />
      {error ? <div id={`${id}-error`} data-field-error aria-live="polite"><Text>{error}</Text></div> : null}
    </div>
  );
}

export function DateField({
  id,
  label,
  value,
  onValueChange,
  required = false,
  disabled = false,
  min,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** YYYY-MM-DD。整天順延只能選更晚的日期。 */
  min?: string;
}): JSX.Element {
  const t = useT();
  return (
    <div class="ui-input" onChange={(event) => changedValue(event, onValueChange)}>
      <label for={id}>
        <Text>{label}</Text>
        {required ? <small><Text>{t('ui.input.required')}</Text></small> : null}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        required={required}
        disabled={disabled}
        min={min}
        onInput={(event) => {
          if (!disabled) onValueChange(event.currentTarget.value);
        }}
      />
    </div>
  );
}

export function PositionField({
  value,
  text,
  onChange,
}: {
  value: PositionChoice;
  text: string;
  onChange: (value: PositionChoice, text: string) => void;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const labelOf = (choice: PositionChoice): string => {
    if (choice === 'none') return ct('positionNone');
    if (choice === 'GK') return ct('positionGK');
    if (choice === 'DF') return ct('positionDF');
    if (choice === 'MF') return ct('positionMF');
    if (choice === 'FW') return ct('positionFW');
    return ct('positionCustom');
  };
  return (
    <div>
      <span class="cps-label">{ct('position')}</span>
      {/* 新外觀卡 3-2：位置六個選項固定三欄兩列（.cps-chips 另有建立賽事在用，只加修飾 class） */}
      <div class="cps-chips cp3-pos">
        {POSITIONS.map((choice) => (
          <Chip
            key={choice}
            label={labelOf(choice)}
            size="sm"
            selected={value === choice}
            onSelect={() => onChange(choice, text)}
          />
        ))}
      </div>
      {value === 'custom' ? (
        <div style="margin-top:12px">
          <Input
            label={ct('positionCustom')}
            value={text}
            maxLength={POSITION_TEXT_MAX}
            onValueChange={(next) => onChange('custom', next)}
          />
        </div>
      ) : null}
    </div>
  );
}

/** 金額旁的線上支付只是預留位置：停用，沒有 onClick，不接金流。 */
export function PayButton(): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  return (
    <Button variant="secondary" size="sm" disabled title={ct('payComingSoon')}>
      {ct('payOnline')}
    </Button>
  );
}

/** tag：金額後面的節點（報隊管理放繳費標籤）；沒傳時標記與原本相同。 */
export function FeeLine({ amount, tag }: { amount: number; tag?: JSX.Element | null }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const amountNode = <span class="cps-fee__amount">{formatFee(amount, ct('feeFree'))}</span>;
  return (
    <div class="cps-fee">
      {tag ? <span class="cps-fee__lead">{amountNode}{tag}</span> : amountNode}
      <PayButton />
    </div>
  );
}
