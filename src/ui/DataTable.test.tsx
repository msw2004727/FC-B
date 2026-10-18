import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { DataTable, type DataTableColumn } from '@/ui/DataTable';
import { t } from '@/i18n/i18n';
import { installUi4TestLocale } from './ui4-test-helpers';

installUi4TestLocale();

interface Row {
  id: string;
  name: string;
  count: number;
}

const rows: Row[] = [
  { id: 'b', name: 'Beta', count: 2 },
  { id: 'a', name: 'Alpha', count: 1 },
];

const columns: DataTableColumn<Row>[] = [
  {
    id: 'name',
    header: 'Name',
    value: (row) => row.name,
    compare: (a, b) => a.name.localeCompare(b.name),
  },
  {
    id: 'count',
    header: 'Count',
    value: (row) => row.count,
    compare: (a, b) => a.count - b.count,
    numeric: true,
  },
];

describe('DataTable', () => {
  it('sorts without changing input and exposes aria-sort', () => {
    render(
      <DataTable caption="Roster" columns={columns} rows={rows} rowKey={(r) => r.id} />,
    );
    const name = screen.getByRole('button', { name: 'Name' });
    fireEvent.click(name);
    const header = screen.getByRole('columnheader', { name: 'Name' });
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    const first = screen.getAllByRole('row')[1];
    if (!first) throw new Error('Expected a data row');
    expect(within(first).getByText('Alpha')).toBeTruthy();

    fireEvent.click(name);
    expect(header.getAttribute('aria-sort')).toBe('descending');
    expect(rows[0]?.name).toBe('Beta');
    expect(name.getAttribute('title')).toBe('Name');
    expect(header.getAttribute('scope')).toBe('col');
  });

  it.each(['default', 'compact', 'sticky-header', 'sticky-first-col'] as const)(
    'renders the %s variant with a focusable scroll region',
    (variant) => {
      render(
        <DataTable
          caption="Roster"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          variant={variant}
        />,
      );
      const region = screen.getByRole('region', { name: 'Roster' });
      expect(region.classList.contains(`ui-data-table--${variant}`)).toBe(true);
      expect(region.tabIndex).toBe(0);
    },
  );

  it('shows translated empty and loading states', () => {
    const view = render(
      <DataTable caption="Roster" columns={columns} rows={[]} rowKey={(r) => r.id} />,
    );
    expect(screen.getByText(t('ui.dataTable.emptyTitle'))).toBeTruthy();
    expect(screen.getByText(t('ui.dataTable.emptyDescription'))).toBeTruthy();
    view.rerender(
      <DataTable
        caption="Roster"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        loading
      />,
    );
    expect(screen.getByRole('status').textContent).toBe(t('ui.dataTable.loading'));
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
  });

  it('disables sorting and selection', () => {
    const sort = vi.fn();
    const select = vi.fn();
    render(
      <DataTable
        caption="Roster"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        disabled
        onSortChange={sort}
        onSelectionChange={select}
      />,
    );
    const button = screen.getByRole('button', { name: 'Name' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect((checkbox as HTMLInputElement).disabled).toBe(true);
      fireEvent.click(checkbox);
    }
    expect(sort).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('uses controlled selection and excludes disabled rows from select-all', () => {
    const select = vi.fn();
    render(
      <DataTable
        caption="Roster"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.name}
        selectedKeys={['a']}
        onSelectionChange={select}
        isRowDisabled={(r) => r.id === 'b'}
      />,
    );
    const all = screen.getByRole('checkbox', { name: t('ui.dataTable.selectAll') });
    expect((all as HTMLInputElement).checked).toBe(true);
    fireEvent.click(all);
    expect(select).toHaveBeenCalledWith([]);
    const alpha = screen.getByRole('checkbox', {
      name: t('ui.dataTable.selectRow', { name: 'Alpha' }),
    });
    expect(alpha.closest('tr')?.getAttribute('aria-selected')).toBe('true');
  });
});
