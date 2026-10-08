import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { num } from '../lib/format.js';
import { IconButton } from './Button.jsx';

// Data table. `columns` is [{ key, header, render, align, sortable, width,
// mono, hideOnMobile }]. Below 768px rows become stacked cards: the first
// column is the title and the rest are label/value pairs.
export function Table({ columns, rows, rowKey = 'id', sort, onSort, loading, skeletonRows = 6, empty, footer, onRowClick, caption, className }) {
  const cell = (column, row) => (column.render ? column.render(row) : row[column.key]);
  const keyOf = (row) => (typeof rowKey === 'function' ? rowKey(row) : row[rowKey]);
  const isEmpty = !loading && rows.length === 0;

  return (
    <div className={cx('overflow-hidden rounded-md border border-gray-400', className)}>
      <div className="max-h-[70vh] overflow-auto max-md:hidden">
        <table className="w-full border-collapse copy-13">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-background-200">
            <tr>
              {columns.map((column) => {
                const active = sort?.key === column.key;
                const SortIcon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    style={{ width: column.width }}
                    className={cx('h-10 border-b border-gray-400 px-4 font-medium whitespace-nowrap text-gray-900', column.align === 'right' ? 'text-right' : 'text-left')}
                  >
                    {column.sortable && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort({ key: column.key, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
                        className={cx('inline-flex items-center gap-1 rounded-sm ease-hover hover:text-gray-1000', active && 'text-gray-1000', column.align === 'right' && 'flex-row-reverse')}
                      >
                        {column.header}
                        <SortIcon size={14} strokeWidth={1.5} aria-hidden="true" className={active ? '' : 'text-gray-600'} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }, (_, i) => (
                  <tr key={i} className="border-b border-gray-400 last:border-0">
                    {columns.map((column) => (
                      <td key={column.key} className="h-12 px-4">
                        <div className={cx('skeleton h-4', column.align === 'right' ? 'ml-auto w-14' : 'w-2/3')} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={keyOf(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cx('animate-fade-in border-b border-gray-400 ease-hover last:border-0 hover:bg-gray-alpha-100', onRowClick && 'cursor-pointer')}
                  >
                    {columns.map((column) => (
                      <td key={column.key} className={cx('h-12 px-4 py-2', column.align === 'right' && 'text-right tabular', column.mono && 'font-mono')}>
                        {cell(column, row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {/* Stacked cards for small screens. */}
      <ul className="divide-y divide-gray-400 md:hidden">
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="space-y-2 p-4">
                <div className="skeleton h-4 w-1/2" />
                <div className="skeleton h-4 w-3/4" />
              </li>
            ))
          : rows.map((row) => (
              <li key={keyOf(row)} className="p-4" onClick={onRowClick ? () => onRowClick(row) : undefined}>
                <div className={cx('copy-14 font-medium', columns[0].mono && 'font-mono')}>{cell(columns[0], row)}</div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                  {columns.slice(1).filter((column) => !column.hideOnMobile).map((column) => (
                    <div key={column.key} className={cx(column.wide && 'col-span-2')}>
                      {column.header && <dt className="copy-12 text-gray-900">{column.header}</dt>}
                      <dd className={cx('copy-13', column.align === 'right' && 'tabular', column.mono && 'font-mono')}>{cell(column, row)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
      </ul>

      {isEmpty && <div className="px-4 py-12">{empty}</div>}
      {footer && <div className="border-t border-gray-400 bg-background-200 px-4 py-2">{footer}</div>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="copy-13 text-gray-900 tabular" aria-live="polite">
        {num(first)}–{num(last)} of {num(total)}
      </p>
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <span className="px-1 copy-13 text-gray-900 tabular">
          {num(page)} / {num(pages)}
        </span>
        <IconButton icon={ChevronRight} label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} />
      </div>
    </div>
  );
}
