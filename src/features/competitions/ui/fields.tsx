import type { JSX } from 'preact';
import { useT } from '@/i18n/i18n';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Input } from '@/ui/Input';
import { Text } from '@/ui/Text';
import { formatFee } from '../format';
import type { PositionChoice } from '../payload';

/** 自訂位置上限：360px 名單列（背號 99＋10 字顯示名）實測 6 字溢出 6px、5 字可放，取 5（與後端 POSITION_TEXT_MAX 一致） */
export const POSITION_TEXT_MAX = 5;

const POSITIONS: readonly PositionChoice[] = ['none', 'GK', 'DF', 'MF', 'FW', 'custom'];

export function DateTimeField({
  id,
  label,
  value,
  onValueChange,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}): JSX.Element {
  return (
    <div class="ui-input">
      <label for={id}><Text>{label}</Text></label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onInput={(event) => onValueChange(event.currentTarget.value)}
      />
    </div>
  );
}

export function DateField({
  id,
  label,
  value,
  onValueChange,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  required?: boolean;
}): JSX.Element {
  const t = useT();
  return (
    <div class="ui-input">
      <label for={id}>
        <Text>{label}</Text>
        {required ? <small><Text>{t('ui.input.required')}</Text></small> : null}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        required={required}
        onInput={(event) => onValueChange(event.currentTarget.value)}
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
  const t = useT();
  const labelOf = (choice: PositionChoice): string => {
    if (choice === 'none') return t('competitions.positionNone');
    if (choice === 'GK') return t('competitions.positionGK');
    if (choice === 'DF') return t('competitions.positionDF');
    if (choice === 'MF') return t('competitions.positionMF');
    if (choice === 'FW') return t('competitions.positionFW');
    return t('competitions.positionCustom');
  };
  return (
    <div>
      <span class="cps-label">{t('competitions.position')}</span>
      <div class="cps-chips">
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
            label={t('competitions.positionCustom')}
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
  const t = useT();
  return (
    <Button variant="secondary" size="sm" disabled title={t('competitions.payComingSoon')}>
      {t('competitions.payOnline')}
    </Button>
  );
}

export function FeeLine({ amount }: { amount: number }): JSX.Element {
  const t = useT();
  return (
    <div class="cps-fee">
      <span class="cps-fee__amount">{formatFee(amount, t('competitions.feeFree'))}</span>
      <PayButton />
    </div>
  );
}
