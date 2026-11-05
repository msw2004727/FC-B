import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLegacyT } from '@/i18n/i18n';
import { SportIcon } from '@/ui/SportIcon';
import { SPORTS } from '../../data/sports';

/** 原 EventFormFields 的 A 通用 picker；只參數化 ce／cee ID，兩個表單共用。 */
export function SportTagPicker({ prefix, value, onChange }: {
  prefix: 'ce' | 'cee';
  value: string;
  onChange(value: string): void;
}) {
  const lt = useLegacyT();
  const [sportDropdownOpen, setSportDropdownOpen] = useState(false);
  const [sportSearch, setSportSearch] = useState('');
  const sportPickerRef = useRef<HTMLDivElement | null>(null);
  const sportSearchRef = useRef<HTMLInputElement | null>(null);

  // 照 A event-create-sport-picker.js：點擊外部關閉下拉；打開時聚焦搜尋框（`els.search?.focus()`）。
  useEffect(() => {
    if (!sportDropdownOpen) return;
    sportSearchRef.current?.focus();
    const handler = (ev: MouseEvent): void => {
      const picker = sportPickerRef.current;
      if (picker && picker.contains(ev.target as Node)) return;
      setSportDropdownOpen(false);
    };
    document.addEventListener('click', handler);
    return () => {
      document.removeEventListener('click', handler);
    };
  }, [sportDropdownOpen]);

  const selectedSport = SPORTS.find((s) => s.sportTag === value) ?? null;

  const filteredSports = useMemo(() => {
    // 照 A _renderSportPickerOptions：只比對原始 label（中文）與 query。
    const q = sportSearch.trim().toLowerCase();
    if (!q) return SPORTS;
    return SPORTS.filter((item) => item.label.toLowerCase().includes(q));
  }, [sportSearch]);

  return (
        <div class="ce-sport-picker" id={`${prefix}-sport-picker`} ref={sportPickerRef}>
          <button
            type="button"
            class={`ce-sport-selected${sportDropdownOpen ? ' open' : ''}`}
            id={`${prefix}-sport-selected`}
            aria-haspopup="listbox"
            aria-expanded={sportDropdownOpen}
            onClick={() => setSportDropdownOpen((v) => !v)}
          >
            <span class="ce-sport-selected-inner" id={`${prefix}-sport-selected-inner`}>
              {selectedSport ? (
                <span class="ce-sport-value">
                  <SportIcon sportKey={selectedSport.key} />
                  <span>{lt(selectedSport.label, selectedSport.label)}</span>
                </span>
              ) : (
                <span class="ce-sport-placeholder">{lt('請選擇運動 / 場景標籤')}</span>
              )}
            </span>
            <span class="ce-sport-arrow" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M6 9l6 6 6-6"></path>
              </svg>
            </span>
          </button>
          <div
            class={`ce-sport-dropdown${sportDropdownOpen ? ' open' : ''}`}
            id={`${prefix}-sport-dropdown`}
          >
            <input
              type="text"
              id={`${prefix}-sport-search`}
              class="ce-sport-search"
              placeholder={lt('搜尋運動 / 場景標籤')}
              ref={sportSearchRef}
              value={sportSearch}
              onInput={(e) => setSportSearch(e.currentTarget.value)}
              onKeyDown={(ev) => {
                // 照 A：搜尋框按 Escape 關閉下拉。
                if (ev.key === 'Escape') {
                  ev.stopPropagation();
                  setSportDropdownOpen(false);
                }
              }}
            />
            <div id={`${prefix}-sport-list`} class="ce-sport-list" role="listbox">
              {filteredSports.length === 0 ? (
                <div class="ce-sport-empty">{lt('找不到符合的運動')}</div>
              ) : (
                filteredSports.map((item) => {
                  const isActive = item.sportTag === value;
                  return (
                    <button
                      type="button"
                      key={item.key}
                      class={`ce-sport-option${isActive ? ' active' : ''}`}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        onChange(item.sportTag);
                        setSportDropdownOpen(false);
                      }}
                    >
                      <SportIcon sportKey={item.key} />
                      <span>{lt(item.label, item.label)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <input type="hidden" id={`${prefix}-sport-tag`} value={value} />
        </div>
  );
}
