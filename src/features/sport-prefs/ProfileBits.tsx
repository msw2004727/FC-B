import type { JSX } from 'preact';
import { sportName, useSportPrefsT } from './i18n';
import './sport-prefs.css';

export interface FavSportTagsProps {
  tags: readonly string[];
  editing?: boolean;
  onRemove?: (key: string) => void;
  onAdd?: () => void;
  legacyText?: string;
}

export function FavSportTags({
  tags,
  editing = false,
  onRemove,
  onAdd,
  legacyText,
}: FavSportTagsProps): JSX.Element {
  const t = useSportPrefsT();
  const showLegacy = tags.length === 0 && typeof legacyText === 'string' && legacyText.length > 0;
  return (
    <span class="fav-tags">
      {showLegacy ? <span class="fav-legacy">{legacyText}</span> : null}
      {tags.map((k) => {
        const name = sportName(t, k);
        return (
          <span key={k} class="fav-tag">
            {name}
            {editing ? (
              <button
                type="button"
                class="fav-tag-x"
                aria-label={t('remove', { name })}
                onClick={() => onRemove?.(k)}
              >
                ×
              </button>
            ) : null}
          </span>
        );
      })}
      <button type="button" class="fav-add" onClick={onAdd}>{t('add')}</button>
    </span>
  );
}

export interface NewEventToggleRowProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

export function NewEventToggleRow({ checked, disabled = false, onChange }: NewEventToggleRowProps): JSX.Element {
  const t = useSportPrefsT();
  return (
    <div class="ne-block">
      <span>
        <span class="ne-title">{t('toggle')}</span>
        <span class="ne-sub">{t('toggleSub')}</span>
      </span>
      <label class="toggle-switch">
        <input
          type="checkbox"
          aria-label={t('toggle')}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
        />
        <span class="toggle-slider"></span>
      </label>
    </div>
  );
}
