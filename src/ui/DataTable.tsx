import './data-table.css';
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { Icon } from '@/ui/Icon';
import { getCurrentLocale, useT } from '@/i18n/i18n';

export interface DataTableSort {
  column: string;
  direction: 'ascending' | 'descending';
}

export interface DataTableColumn<Row> {
  id: string;
  header: string;
  value: (row: Row) => string | number | null | undefined;
  /** 自訂節點中的文字由呼叫端使用 Text。 */
  render?: (row: Row) => ComponentChildren;
  /** 有 compare 才顯示排序按鈕；字串可傳入 Intl.Collator.compare。 */
  compare?: (a: Row, b: Row) => number;
  numeric?: boolean;
}

export interface DataTableProps<Row> {
  caption: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  variant?: 'default' | 'compact' | 'sticky-header' | 'sticky-first-col';
  initialSort?: DataTableSort;
  onSortChange?: (sort: DataTableSort) => void;
  loading?: boolean;
  disabled?: boolean;
  /** 傳入此 callback 啟用受控勾選欄位。 */
  onSelectionChange?: (keys: readonly string[]) => void;
  selectedKeys?: readonly string[];
  rowLabel?: (row: Row) => string;
  isRowDisabled?: (row: Row) => boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /** 兩行預設；單行省略模式同時提供完整 title。 */
  truncateHeaders?: boolean;
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  variant = 'default',
  initialSort,
  onSortChange,
  loading = false,
  disabled = false,
  onSelectionChange,
  selectedKeys = [],
  rowLabel,
  isRowDisabled,
  emptyTitle,
  emptyDescription,
  truncateHeaders = false,
}: DataTableProps<Row>) {
  const t = useT();
  const locale = getCurrentLocale();
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [sort, setSort] = useState<DataTableSort | undefined>(initialSort);
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const sortedRows = useMemo(() => {
    const column = columns.find((item) => item.id === sort?.column);
    const compare = column?.compare;
    if (!sort || !compare) return rows;

    const direction = sort.direction === 'ascending' ? 1 : -1;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => compare(a.row, b.row) * direction || a.index - b.index)
      .map(({ row }) => row);
  }, [rows, columns, sort]);

  const selectable = onSelectionChange !== undefined;
  const eligibleKeys = rows
    .filter((row) => !isRowDisabled?.(row))
    .map(rowKey);
  const allSelected =
    eligibleKeys.length > 0 && eligibleKeys.every((key) => selected.has(key));
  const someSelected = eligibleKeys.some((key) => selected.has(key));
  const colSpan = Math.max(1, columns.length + (selectable ? 1 : 0));

  const toggleAll = (): void => {
    if (!onSelectionChange || disabled || loading) return;
    const next = new Set(selectedKeys);
    for (const key of eligibleKeys) {
      if (allSelected) next.delete(key);
      else next.add(key);
    }
    onSelectionChange([...next]);
  };

  const changeSort = (column: DataTableColumn<Row>): void => {
    if (!column.compare || disabled || loading) return;
    const next: DataTableSort = {
      column: column.id,
      direction:
        sort?.column === column.id && sort.direction === 'ascending'
          ? 'descending'
          : 'ascending',
    };
    setSort(next);
    onSortChange?.(next);
  };

  function renderCell(column: DataTableColumn<Row>, row: Row): ComponentChildren {
    if (column.render) {
      const result = column.render(row);
      return typeof result === 'string' || typeof result === 'number'
        ? <Text>{result}</Text>
        : result;
    }
    const value = column.value(row);
    const text =
      value === null || value === undefined || value === ''
        ? t('ui.dataTable.notProvided')
        : typeof value === 'number'
          ? numberFormatter.format(value)
          : value;
    return <Text>{text}</Text>;
  }

  return (
    <div
      class={`ui-data-table ui-data-table--${variant}${
        loading ? ' ui-data-table--loading' : ''
      }${disabled ? ' ui-data-table--disabled' : ''}${
        truncateHeaders ? ' ui-data-table--truncate-headers' : ''
      }`}
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table class="ui-data-table__table" aria-busy={loading}>
        <caption class="ui-data-table__caption">
          <Text>{caption}</Text>
        </caption>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" class="ui-data-table__selection">
                <label class="ui-data-table__check-target">
                  <input
                    type="checkbox"
                    aria-label={t('ui.dataTable.selectAll')}
                    checked={allSelected}
                    ref={(element) => {
                      if (element) {
                        element.indeterminate = someSelected && !allSelected;
                      }
                    }}
                    disabled={disabled || loading || eligibleKeys.length === 0}
                    onChange={toggleAll}
                  />
                </label>
              </th>
            )}
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                aria-sort={
                  column.compare
                    ? sort?.column === column.id
                      ? sort.direction
                      : 'none'
                    : undefined
                }
                class={column.numeric ? 'ui-data-table__numeric' : undefined}
              >
                {column.compare ? (
                  <button
                    type="button"
                    class="ui-data-table__sort"
                    disabled={disabled || loading}
                    title={column.header}
                    onClick={() => changeSort(column)}
                  >
                    <span class="ui-data-table__header-text" title={column.header}>
                      <Text>{column.header}</Text>
                    </span>
                    {/* Icon.tsx 尚無排序圖示；使用本地 inline SVG。 */}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                      focusable="false"
                    >
                      {sort?.column === column.id ? (
                        sort.direction === 'ascending'
                          ? <path d="m6 15 6-6 6 6" />
                          : <path d="m6 9 6 6 6-6" />
                      ) : (
                        <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
                      )}
                    </svg>
                  </button>
                ) : (
                  <span class="ui-data-table__header-text" title={column.header}>
                    <Text>{column.header}</Text>
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colSpan}>
                <div class="ui-data-table__loading" role="status">
                  <Text>{t('ui.dataTable.loading')}</Text>
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      class="ui-data-table__skeleton"
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </td>
            </tr>
          ) : sortedRows.length === 0 ? (
            <tr>
              <td colSpan={colSpan}>
                <div class="ui-data-table__empty">
                  <span aria-hidden="true"><Icon name="inbox" size={48} /></span>
                  <Text as="p" class="ui-data-table__empty-title">
                    {emptyTitle ?? t('ui.dataTable.emptyTitle')}
                  </Text>
                  <Text as="p">
                    {emptyDescription ?? t('ui.dataTable.emptyDescription')}
                  </Text>
                </div>
              </td>
            </tr>
          ) : (
            sortedRows.map((row) => {
              const key = rowKey(row);
              const rowDisabled = disabled || Boolean(isRowDisabled?.(row));
              const isSelected = selected.has(key);

              return (
                <tr
                  key={key}
                  aria-selected={selectable ? isSelected : undefined}
                  class={isSelected ? 'ui-data-table__row--selected' : undefined}
                >
                  {selectable && (
                    <td class="ui-data-table__selection">
                      <label class="ui-data-table__check-target">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={rowDisabled}
                          aria-label={t('ui.dataTable.selectRow', {
                            name: rowLabel?.(row) ?? key,
                          })}
                          onChange={() => {
                            if (rowDisabled || !onSelectionChange) return;
                            const next = new Set(selectedKeys);
                            if (isSelected) next.delete(key);
                            else next.add(key);
                            onSelectionChange([...next]);
                          }}
                        />
                      </label>
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      class={column.numeric ? 'ui-data-table__numeric' : undefined}
                    >
                      {renderCell(column, row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
